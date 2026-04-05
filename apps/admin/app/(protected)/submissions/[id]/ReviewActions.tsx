'use client';

import { useActionState, useState } from 'react';
import { approveSubmission, rejectSubmission, type ActionResult } from '../actions';
import type { Translations } from '../../../../lib/i18n';

type ReviewTranslations = Translations['review'];

interface Props {
  submissionId: string;
  t: ReviewTranslations;
}

function getErrorMessage(t: ReviewTranslations, error: string): string {
  if (error === 'conflict') return t.errorConflict;
  return t.errorGeneric;
}

export default function ReviewActions({ submissionId, t }: Props) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [notes, setNotes] = useState('');

  const [approveState, approveAction, approvePending] = useActionState<ActionResult, FormData>(
    async () => approveSubmission(submissionId),
    null,
  );

  const [rejectState, rejectAction, rejectPending] = useActionState<ActionResult, FormData>(
    async () => rejectSubmission(submissionId, notes.trim() || null),
    null,
  );

  const error = approveState?.error ?? rejectState?.error ?? null;

  return (
    <div className="mt-6 space-y-4">
      {error && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {getErrorMessage(t, error)}
        </p>
      )}

      {!showRejectForm ? (
        <div className="flex gap-3">
          <form action={approveAction}>
            <button
              type="submit"
              disabled={approvePending || rejectPending}
              className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
            >
              {approvePending ? '…' : t.approve}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setShowRejectForm(true)}
            disabled={approvePending || rejectPending}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {t.reject}
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 p-4">
          <label className="block text-sm font-medium text-gray-700">{t.rejectNotesLabel}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
          <div className="mt-3 flex gap-3">
            <form action={rejectAction}>
              <button
                type="submit"
                disabled={approvePending || rejectPending}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                {rejectPending ? '…' : t.rejectConfirm}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setShowRejectForm(false)}
              className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
