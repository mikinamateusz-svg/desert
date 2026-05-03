'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveClaim,
  rejectClaim,
  requestDocs,
  type ApproveInput,
} from './actions';
import type { ClaimStatusValue } from '../../../../lib/types';
import type { Translations } from '../../../../lib/i18n';

interface Props {
  claimId: string;
  status: ClaimStatusValue;
  t: Translations['stationClaims'];
}

/**
 * Action panel for the admin claim detail page. Renders three forms
 * (approve / reject / requestDocs) inline.
 *
 * Hidden when the claim is finalised (APPROVED / REJECTED) — admins can
 * see the prior decision in the timeline section above but can't keep
 * flipping a final status. AWAITING_DOCS is treated as still-actionable
 * (admin may have received the docs and want to approve / reject from
 * here).
 *
 * Each form fires its server action through `useTransition` so the UI
 * stays interactive during the round-trip; on success, `router.refresh()`
 * pulls the updated detail (the actions also call `revalidatePath`,
 * so the next render is fresh data).
 */
export function ActionPanel({ claimId, status, t }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Approve form state
  const [approveMethod, setApproveMethod] = useState<ApproveInput['method']>('PHONE_CALLBACK');
  const [approveNotes, setApproveNotes] = useState('');

  // Reject form state
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');

  // Request-docs form state
  const [requestDocsNotes, setRequestDocsNotes] = useState('');

  if (status === 'APPROVED' || status === 'REJECTED') {
    return (
      <div className="rounded-md bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600">
        {t.finalisedNote}
      </div>
    );
  }

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approveClaim(claimId, {
        method: approveMethod,
        reviewerNotes: approveNotes.trim() || undefined,
      });
      if (res.error) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleReject() {
    setError(null);
    if (!rejectionReason.trim()) {
      setError(t.rejectionReasonLabel);
      return;
    }
    startTransition(async () => {
      const res = await rejectClaim(claimId, {
        rejectionReason: rejectionReason.trim(),
        reviewerNotes: rejectNotes.trim() || undefined,
      });
      if (res.error) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleRequestDocs() {
    setError(null);
    startTransition(async () => {
      const res = await requestDocs(claimId, {
        reviewerNotes: requestDocsNotes.trim() || undefined,
      });
      if (res.error) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Approve ──────────────────────────────────────────────── */}
      <section className="border border-gray-200 rounded-md p-4 bg-white">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">{t.actionApprove}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t.methodLabel}</label>
            <select
              value={approveMethod}
              onChange={(e) => setApproveMethod(e.target.value as ApproveInput['method'])}
              disabled={isPending}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="PHONE_CALLBACK">{t.methodPhoneCallback}</option>
              <option value="DOCUMENT">{t.methodDocument}</option>
              <option value="HEAD_OFFICE_EMAIL">{t.methodHeadOfficeEmail}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t.reviewerNotesLabel}</label>
            <textarea
              value={approveNotes}
              onChange={(e) => setApproveNotes(e.target.value)}
              placeholder={t.reviewerNotesPlaceholder}
              disabled={isPending}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {t.actionApprove}
          </button>
        </div>
      </section>

      {/* ── Reject ──────────────────────────────────────────────── */}
      <section className="border border-gray-200 rounded-md p-4 bg-white">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">{t.actionReject}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t.rejectionReasonLabel}</label>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={t.rejectionReasonPlaceholder}
              disabled={isPending}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t.reviewerNotesLabel}</label>
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder={t.reviewerNotesPlaceholder}
              disabled={isPending}
              rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleReject}
            disabled={isPending || !rejectionReason.trim()}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {t.actionReject}
          </button>
        </div>
      </section>

      {/* ── Request docs ─────────────────────────────────────────── */}
      <section className="border border-gray-200 rounded-md p-4 bg-white">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">{t.actionRequestDocs}</h3>
        <p className="text-xs text-gray-500 mb-3">{t.requestDocsHint}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t.reviewerNotesLabel}</label>
            <textarea
              value={requestDocsNotes}
              onChange={(e) => setRequestDocsNotes(e.target.value)}
              placeholder={t.reviewerNotesPlaceholder}
              disabled={isPending}
              rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleRequestDocs}
            disabled={isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {t.actionRequestDocs}
          </button>
        </div>
      </section>
    </div>
  );
}
