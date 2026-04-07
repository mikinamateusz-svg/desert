import type { FuelType } from '@desert/types';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';

interface Props {
  stations: StationWithPrice[];
  t: Translations;
  selectedFuel: FuelType;
  selected: StationWithPrice | null;
  onSelect: (station: StationWithPrice) => void;
  onClose: () => void;
}

const FUEL_ORDER = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'] as const;
const FUEL_BADGE: Record<string, { label: string; bg: string; color: string }> = {
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

function stationPrice(station: StationWithPrice, fuelType: string): number | null {
  const exact = station.price?.prices[fuelType];
  if (exact !== undefined) return exact;
  const range = station.price?.priceRanges?.[fuelType];
  if (range) return (range.low + range.high) / 2;
  return null;
}

export default function MapSidebar({ stations, t, selectedFuel, selected, onSelect, onClose }: Props) {
  const sorted = [...stations]
    .filter(s => stationPrice(s, selectedFuel) !== null)
    .sort((a, b) => (stationPrice(a, selectedFuel) ?? Infinity) - (stationPrice(b, selectedFuel) ?? Infinity))
    .slice(0, 30);

  const brandKey = selected?.brand?.toLowerCase();
  const brandStyle = brandKey ? BRAND_BADGE[brandKey] : null;
  const mapsUrl = selected
    ? `https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Selected station detail — desktop only */}
      {selected && (
        <div className="border-b border-gray-200 bg-white flex-shrink-0">
          {/* Header */}
          <div className="flex items-start gap-3 px-4 pt-4 pb-3">
            <div
              className="flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-xs font-black border"
              style={brandStyle
                ? { backgroundColor: brandStyle.bg, color: brandStyle.color, borderColor: brandStyle.bg }
                : { backgroundColor: '#f3f4f6', color: '#6b7280', borderColor: '#e5e7eb' }}
            >
              {brandStyle ? brandStyle.label : '⛽'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-gray-900 leading-tight">{selected.name}</p>
              {selected.address && (
                <p className="text-xs text-gray-500 mt-0.5">{selected.address}</p>
              )}
            </div>
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

          {/* Prices */}
          <div className="px-4 pb-3 space-y-2">
            {FUEL_ORDER.map(ft => {
              const val = selected.price?.prices[ft];
              if (val === undefined) return null;
              const badge = FUEL_BADGE[ft];
              const isEst = selected.price?.estimateLabel?.[ft] !== undefined;
              const range = selected.price?.priceRanges?.[ft];
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
            })}
          </div>

          {/* Navigate */}
          <div className="px-4 pb-4">
            <a
              href={mapsUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-sm font-semibold text-center py-2.5 rounded-xl bg-brand-ink hover:bg-brand-ink-hover text-white transition-colors"
            >
              {t.station.navigate} →
            </a>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{t.sidebar.nearbyStations}</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          {t.fuelTypes[selectedFuel]} · {t.sidebar.sortedByPrice.split('·')[1]?.trim() ?? t.sidebar.sortedByPrice}
        </p>
      </div>

      {/* Station list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">{t.sidebar.noStations}</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {sorted.map(station => {
              const price = stationPrice(station, selectedFuel);
              const range = station.price?.priceRanges?.[selectedFuel];
              const isEstimated = !!station.price?.estimateLabel?.[selectedFuel];
              const isSelected = selected?.id === station.id;

              return (
                <li key={station.id}>
                  <button
                    onClick={() => onSelect(station)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left group ${
                      isSelected ? 'bg-amber-50' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate transition-colors ${
                        isSelected ? 'text-brand-ink font-semibold' : 'text-gray-900 group-hover:text-brand-ink'
                      }`}>
                        {station.name}
                      </p>
                      {station.address && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">{station.address}</p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {price !== null ? (
                        <>
                          <p className="text-sm font-semibold text-gray-900">
                            {isEstimated && range
                              ? `~${range.low.toFixed(2)}–${range.high.toFixed(2)}`
                              : `${price.toFixed(2)}`}
                          </p>
                          <p className="text-xs text-gray-400">zł/l</p>
                        </>
                      ) : (
                        <p className="text-xs text-gray-400">{t.noData}</p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
