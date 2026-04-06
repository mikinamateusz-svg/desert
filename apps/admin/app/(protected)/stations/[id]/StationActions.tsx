'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { overridePrice, refreshCache } from '../actions';
import type { StationsTranslations } from '../../../../lib/i18n';

const FUEL_TYPES = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

interface StationActionsProps {
  stationId: string;
  t: StationsTranslations;
}

export function StationActions({ stationId, t }: StationActionsProps) {
  const [isOverridePending, startOverrideTransition] = useTransition();
  const [isRefreshPending, startRefreshTransition] = useTransition();
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideSuccess, setOverrideSuccess] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const router = useRouter();

  // Override form state
  const [fuelType, setFuelType] = useState(FUEL_TYPES[0]);
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');

  function handleOverride(e: React.FormEvent) {
    e.preventDefault();
    const parsedPrice = parseFloat(price);
    if (!fuelType || isNaN(parsedPrice) || parsedPrice <= 0 || !reason.trim()) return;

    setOverrideError(null);
    setOverrideSuccess(false);
    startOverrideTransition(async () => {
      const result = await overridePrice(stationId, fuelType, parsedPrice, reason);
      if (result.error) {
        setOverrideError(result.error);
      } else {
        setOverrideSuccess(true);
        setPrice('');
        setReason('');
        router.refresh();
      }
    });
  }

  function handleRefresh() {
    if (!confirm(t.confirmRefresh)) return;
    setRefreshError(null);
    setRefreshSuccess(false);
    startRefreshTransition(async () => {
      const result = await refreshCache(stationId);
      if (result.error) {
        setRefreshError(result.error);
      } else {
        setRefreshSuccess(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Override price form */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.overrideTitle}</h2>
        <form onSubmit={handleOverride} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.fuelTypeLabel}</label>
            <select
              value={fuelType}
              onChange={e => setFuelType(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full max-w-xs"
              disabled={isOverridePending}
            >
              {FUEL_TYPES.map(ft => (
                <option key={ft} value={ft}>{ft}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.priceLabel}</label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              value={price}
              onChange={e => setPrice(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full max-w-xs"
              disabled={isOverridePending}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.reasonLabel}</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t.reasonPlaceholder}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full max-w-md"
              rows={3}
              disabled={isOverridePending}
              required
            />
          </div>

          <button
            type="submit"
            disabled={isOverridePending}
            className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 disabled:opacity-50"
          >
            {isOverridePending ? '…' : t.submitOverride}
          </button>

          {overrideSuccess && (
            <p className="text-sm text-green-700">{t.overrideSuccess}</p>
          )}
          {overrideError && (
            <p className="text-sm text-red-600">{overrideError}</p>
          )}
        </form>
      </div>

      {/* Cache refresh */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <button
          onClick={handleRefresh}
          disabled={isRefreshPending}
          className="px-4 py-2 bg-gray-700 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-50"
        >
          {isRefreshPending ? '…' : t.refreshCache}
        </button>
        {refreshSuccess && (
          <p className="mt-2 text-sm text-green-700">{t.refreshSuccess}</p>
        )}
        {refreshError && (
          <p className="mt-2 text-sm text-red-600">{refreshError}</p>
        )}
      </div>
    </div>
  );
}
