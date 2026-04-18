'use client';

import { forwardRef } from 'react';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';

const FUEL_ORDER = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'] as const;
type FuelType = typeof FUEL_ORDER[number];

const FUEL_BADGE: Record<FuelType, { label: string; bg: string; star?: boolean }> = {
  PB_95:      { label: '95',  bg: '#22c55e' },
  PB_98:      { label: '98',  bg: '#15803d' },
  ON:         { label: 'ON',  bg: '#1c1c1e' },
  ON_PREMIUM: { label: 'ON',  bg: '#1c1c1e', star: true },
  LPG:        { label: 'LPG', bg: '#ef4444' },
};

const BRAND_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  orlen:     { bg: '#e30613', color: '#fff',    label: 'O' },
  shell:     { bg: '#FFD500', color: '#cc0000', label: 'S' },
  bp:        { bg: '#006600', color: '#fff',    label: 'bp' },
  circle_k:  { bg: '#ee2e24', color: '#fff',    label: 'CK' },
  lotos:     { bg: '#003da5', color: '#fff',    label: 'L' },
  huzar:     { bg: '#1a1a1a', color: '#f59e0b', label: 'H' },
  moya:      { bg: '#ffffff', color: '#003366', label: 'M' },
  amic:      { bg: '#e84e0f', color: '#fff',    label: 'A' },
  auchan:    { bg: '#ffffff', color: '#e30613', label: 'Au' },
  carrefour: { bg: '#004f9f', color: '#fff',    label: 'C' },
};

interface Props {
  station: StationWithPrice;
  selectedFuel: FuelType;
  t: Translations;
  onClose: () => void;
}

const StationDetailPanel = forwardRef<HTMLDivElement, Props>(function StationDetailPanel({ station, selectedFuel, t, onClose }, ref) {
  const { price } = station;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;
  const brandKey = station.brand?.toLowerCase();
  const brandStyle = brandKey ? BRAND_BADGE[brandKey] : null;

  // Render order: highlighted selected fuel (if has price), then other available, then unavailable
  const availableFuels = FUEL_ORDER.filter(ft => price?.prices[ft] !== undefined);
  const unavailableFuels = FUEL_ORDER.filter(ft => price?.prices[ft] === undefined);
  const highlightedFuel = availableFuels.includes(selectedFuel) ? selectedFuel : null;
  const secondaryFuels = availableFuels.filter(ft => ft !== highlightedFuel);
  const orderedFuels = [
    ...(highlightedFuel ? [highlightedFuel] : []),
    ...secondaryFuels,
    ...unavailableFuels,
  ];

  return (
    <div ref={ref} data-testid="station-detail-panel" className={[
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
      <div className="px-4 py-3 space-y-1">
        {orderedFuels.map(ft => {
          const val = price?.prices[ft];
          const badge = FUEL_BADGE[ft];
          const isUnavailable = val === undefined;
          const isHighlighted = ft === highlightedFuel;
          const isEst = price?.estimateLabel?.[ft] !== undefined;
          const range = price?.priceRanges?.[ft];
          const display = isUnavailable
            ? null
            : range
              ? `~${range.low.toFixed(2)}–${range.high.toFixed(2)}`
              : isEst ? `~${val!.toFixed(2)}` : val!.toFixed(2);

          return (
            <div
              key={ft}
              className={[
                'flex items-center gap-2.5 px-2 py-1.5 rounded-lg',
                isHighlighted ? 'bg-amber-50' : '',
                isUnavailable ? 'opacity-40' : '',
              ].filter(Boolean).join(' ')}
            >
              <span
                className="relative flex-shrink-0 w-9 h-6 rounded text-xs font-black flex items-center justify-center text-white"
                style={{ backgroundColor: badge.bg }}
              >
                {badge.label}
                {badge.star && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 flex items-center justify-center text-[7px] leading-none text-white font-black">
                    ★
                  </span>
                )}
              </span>
              <span className={`flex-1 text-sm ${isHighlighted ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                {t.fuelTypes[ft] ?? ft}
              </span>
              {isUnavailable ? (
                <span className="text-sm text-gray-400 tabular-nums">∅</span>
              ) : (
                <span className={`text-sm font-semibold tabular-nums ${isEst ? 'text-gray-400' : 'text-gray-900'}`}>
                  {display} <span className="text-xs font-normal text-gray-400">zł/l</span>
                </span>
              )}
            </div>
          );
        })}
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
