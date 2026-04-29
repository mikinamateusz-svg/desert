'use client';

import { useState, useTransition } from 'react';
import { approveSubmission, rejectSubmission, searchStations } from '../actions';
import type { Translations } from '../../../../lib/i18n';
import type { StationRow } from '../../../../lib/types';

type ReviewTranslations = Translations['review'];

const FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'] as const;

interface Props {
  submissionId: string;
  initialPrices: Array<{ fuel_type: string; price_per_litre: number | null }>;
  initialStationId: string | null;
  initialStationName: string | null;
  t: ReviewTranslations;
}

function initPriceMap(
  prices: Array<{ fuel_type: string; price_per_litre: number | null }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of prices) {
    if (p.price_per_litre != null) map[p.fuel_type] = p.price_per_litre.toFixed(3);
  }
  return map;
}

export default function ReviewActions({
  submissionId,
  initialPrices,
  initialStationId,
  initialStationName: _initialStationName,
  t,
}: Props) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [notes, setNotes] = useState('');

  const [prices, setPrices] = useState<Record<string, string>>(initPriceMap(initialPrices));

  const [stationQuery, setStationQuery] = useState('');
  const [stationResults, setStationResults] = useState<StationRow[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedStationName, setSelectedStationName] = useState<string | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [searchPending, startSearchTransition] = useTransition();

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, startActionTransition] = useTransition();

  function handleSearch() {
    if (!stationQuery.trim()) return;
    setSearchError(false);
    setStationResults([]);
    startSearchTransition(async () => {
      try {
        const results = await searchStations(stationQuery.trim());
        setStationResults(results);
      } catch {
        setSearchError(true);
        setStationResults([]);
      }
    });
  }

  function handleApprove() {
    if (!selectedStationId && !initialStationId) {
      setActionError('no_station');
      return;
    }
    setActionError(null);
    startActionTransition(async () => {
      const overridePrices = FUEL_TYPES.filter((ft) => prices[ft]?.trim())
        .map((ft) => ({ fuel_type: ft, price_per_litre: parseFloat(prices[ft]) }))
        .filter((p) => Number.isFinite(p.price_per_litre) && p.price_per_litre > 0 && p.price_per_litre < 50);

      const result = await approveSubmission(
        submissionId,
        overridePrices.length > 0 ? overridePrices : undefined,
        selectedStationId ?? undefined,
      );
      if (result?.error) setActionError(result.error);
    });
  }

  function handleReject() {
    setActionError(null);
    startActionTransition(async () => {
      const result = await rejectSubmission(submissionId, notes.trim() || null);
      if (result?.error) setActionError(result.error);
    });
  }

  const errorMessage = actionError
    ? actionError === 'conflict'
      ? t.errorConflict
      : actionError === 'no_station'
        ? t.errorNoStation
        : t.errorGeneric
    : null;

  return (
    <div className="mt-6 space-y-4">
      {errorMessage && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</p>
      )}

      {/* Price correction */}
      <div className="rounded-lg border border-gray-200 p-4">
        <p className="text-sm font-medium text-gray-700">{t.priceOverrideLabel}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FUEL_TYPES.map((ft) => (
            <div key={ft}>
              <label className="block text-xs text-gray-500">{ft}</label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={prices[ft] ?? ''}
                onChange={(e) => setPrices((prev) => ({ ...prev, [ft]: e.target.value }))}
                className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none"
                placeholder="—"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Station reassignment */}
      <div className="rounded-lg border border-gray-200 p-4">
        <p className="text-sm font-medium text-gray-700">{t.stationReassignLabel}</p>
        {selectedStationId ? (
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-700">
            <span>
              {t.stationSelected} <strong>{selectedStationName}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedStationId(null);
                setSelectedStationName(null);
                setStationResults([]);
              }}
              className="text-xs text-gray-400 underline hover:text-gray-700"
            >
              {t.stationClear}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={stationQuery}
                onChange={(e) => setStationQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={t.stationSearchPlaceholder}
                className="flex-1 rounded border border-gray-300 px-3 py-1 text-sm focus:border-gray-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSearch}
                disabled={searchPending}
                className="rounded border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {searchPending ? '…' : '↵'}
              </button>
            </div>
            {searchError && (
              <p className="mt-1 text-xs text-red-600">{t.stationSearchError}</p>
            )}
            {stationResults.length > 0 && (
              <ul className="mt-2 divide-y divide-gray-100 rounded border border-gray-200 bg-white">
                {stationResults.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStationId(s.id);
                        setSelectedStationName(s.name);
                        setStationResults([]);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium">{s.name}</span>
                      {s.address && (
                        <span className="ml-2 text-xs text-gray-400">{s.address}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Action buttons */}
      {!showRejectForm ? (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleApprove}
            disabled={actionPending}
            className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
          >
            {actionPending ? '…' : t.approve}
          </button>
          <button
            type="button"
            onClick={() => setShowRejectForm(true)}
            disabled={actionPending}
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
            <button
              type="button"
              onClick={handleReject}
              disabled={actionPending}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
            >
              {actionPending ? '…' : t.rejectConfirm}
            </button>
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
