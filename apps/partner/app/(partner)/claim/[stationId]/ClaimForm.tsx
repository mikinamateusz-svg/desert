'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { submitClaim } from './actions';
import type { Translations } from '../../../../lib/i18n';
import type { MyClaim } from '../../../../lib/types';

interface Props {
  stationId: string;
  t: Translations['claim'];
}

/**
 * Submission form for the partner claim flow. Renders inline success
 * state — distinguishing auto-approved (DOMAIN_MATCH) from PENDING in
 * the success copy so the partner immediately knows whether they can
 * start managing the station now or wait for review.
 *
 * Conflict errors are localised via the typed `error` field returned
 * by the server action, so the user gets the specific reason
 * (already-pending / already-approved / claimed-by-other) without
 * the client needing to parse API messages.
 */
export function ClaimForm({ stationId, t }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<MyClaim | null>(null);
  const [notes, setNotes] = useState('');

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await submitClaim(stationId, notes);
      if (!res.ok) {
        if (res.error === 'alreadyClaimed') setError(t.errorAlreadyClaimed);
        else if (res.error === 'alreadyPending') setError(t.errorAlreadyPending);
        else if (res.error === 'alreadyApproved') setError(t.errorAlreadyApproved);
        else setError(t.errorGeneric);
        return;
      }
      setSuccess(res.claim);
    });
  }

  if (success) {
    const wasAutoApproved = success.status === 'APPROVED';
    return (
      <div className="space-y-4">
        <div
          className={`rounded-md p-4 ${wasAutoApproved ? 'bg-green-50 border border-green-200' : 'bg-blue-50 border border-blue-200'}`}
        >
          <h3 className={`text-sm font-semibold mb-2 ${wasAutoApproved ? 'text-green-900' : 'text-blue-900'}`}>
            {t.successTitle}
          </h3>
          <p className={`text-sm ${wasAutoApproved ? 'text-green-800' : 'text-blue-800'}`}>
            {wasAutoApproved ? t.successAutoApproved : t.successPending}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          {wasAutoApproved && (
            <Link
              href={`/station/${success.station_id}`}
              className="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700"
            >
              {t.goToStation}
            </Link>
          )}
          <Link
            href="/home"
            className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-md hover:bg-gray-50"
          >
            {t.backToHome}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
          {t.notesLabel}
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t.notesPlaceholder}
          disabled={isPending}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {t.submitButton}
        </button>
        <Link
          href="/claim"
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50"
        >
          {t.backToSearch}
        </Link>
      </div>
    </div>
  );
}
