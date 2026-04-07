'use client';

import { forwardRef } from 'react';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';

const FUEL_ORDER = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'] as const;
type FuelType = typeof FUEL_ORDER[number];

const FUEL_BADGE: Record<FuelType, { label: string; bg: string; color: string }> = {
  PB_95:      { label: '95',  bg: '#22c55e', color: '#fff' },
  PB_98:      { label: '98',  bg: '#15803d', color: '#fff' },
  ON:         { label: 'ON',  bg: '#1c1c1e', color: '#fff' },
  ON_PREMIUM: { label: 'ON+', bg: '#1c1c1e', color: '#f59e0b' },
  LPG:        { label: 'LPG', bg: '#ef4444', color: '#fff' },
};

const BRAND_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  orlen:     { bg: '#e30613', color: '#fff',    label: 'ORLEN' },
  shell:     { bg: '#FFD500', color: '#cc0000', label: 'SHELL' },
  bp:        { bg: '#006600', color: '#fff',    label: 'BP' },
  circle_k:  { bg: '#cc0000', color: '#fff',    label: 'CK' },
  lotos:     { bg: '#003da5', color: '#fff',    label: 'LOTOS' },
  huzar:     { bg: '#1a1a1a', color: '#f59e0b', label: 'HUZAR' },
  moya:      { bg: '#e30613', color: '#fff',    label: 'MOYA' },
  amic:      { bg: '#e30613', color: '#fff',    label: 'AMIC' },
  auchan:    { bg: '#e30613', color: '#fff',    label: 'AUCHAN' },
  carrefour: { bg: '#004f9f', color: '#fff',    label: 'CARR.' },
};

interface Props {
  station: StationWithPrice;
  t: Translations;
  onClose: () => void;
}

const StationDetailPanel = forwardRef<HTMLDivElement, Props>(function StationDetailPanel({ station, t, onClose }, ref) {
  const { price } = station;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;
  const brandKey = station.brand?.toLowerCase();
  const brandStyle = brandKey ? BRAND_BADGE[brandKey] : null;
  const hasPrices = FUEL_ORDER.some(ft => price?.prices[ft] !== undefined);

  return (
    <div ref={ref} className={[
      'fixed z-50 bg-white shadow-xl',
      // Mobile: full-width bottom sheet
      'bottom-0 left-0 right-0 rounded-t-2xl',
      // Desktop: floating card bottom-left (above nav controls)
      'lg:bottom-16 lg:left-4 lg:right-auto lg:rounded-xl lg:w-72',
    ].join(' ')}>

      {/* Drag handle — mobile only */}
      <div className="flex justify-center pt-3 pb-1 lg:hidden">
        <div className="w-10 h-1 rounded-full bg-gray-300" />
      </div>

      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-3 pb-3 lg:pt-4">
        {/* Brand badge */}
        <div
          className="flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-xs font-black border"
          style={brandStyle
            ? { backgroundColor: brandStyle.bg, color: brandStyle.color, borderColor: brandStyle.bg }
            : { backgroundColor: '#f3f4f6', color: '#6b7280', borderColor: '#e5e7eb' }
          }
        >
          {brandStyle ? brandStyle.label : '⛽'}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900 leading-tight">{station.name}</p>
          {station.address && (
            <p className="text-xs text-gray-500 mt-0.5 leading-snug">{station.address}</p>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          aria-label={t.close}
          className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100 mx-4" />

      {/* Fuel prices */}
      <div className="px-4 py-3 space-y-2">
        {hasPrices ? FUEL_ORDER.map(ft => {
          const val = price?.prices[ft];
          if (val === undefined) return null;
          const badge = FUEL_BADGE[ft];
          const isEst = price?.estimateLabel?.[ft] !== undefined;
          const range = price?.priceRanges?.[ft];
          const display = range
            ? `~${range.low.toFixed(2)}–${range.high.toFixed(2)}`
            : isEst ? `~${val.toFixed(2)}` : val.toFixed(2);

          return (
            <div key={ft} className="flex items-center gap-2.5">
              <span
                className="flex-shrink-0 w-9 h-6 rounded text-xs font-black flex items-center justify-center"
                style={{ backgroundColor: badge.bg, color: badge.color }}
              >
                {badge.label}
              </span>
              <span className="flex-1 text-sm text-gray-600">{t.fuelTypes[ft] ?? ft}</span>
              <span className={`text-sm font-semibold tabular-nums ${isEst ? 'text-gray-400' : 'text-gray-900'}`}>
                {display} <span className="text-xs font-normal text-gray-400">zł/l</span>
              </span>
            </div>
          );
        }) : (
          <p className="text-sm text-gray-400 text-center py-2">{t.noData}</p>
        )}
      </div>

      {/* Navigate button */}
      <div className="px-4 pb-5 pt-1 lg:pb-4">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-sm font-semibold text-center py-2.5 rounded-xl bg-brand-ink hover:bg-brand-ink-hover text-white transition-colors"
        >
          {t.station.navigate} →
        </a>
      </div>
    </div>
  );
});

export default StationDetailPanel;
