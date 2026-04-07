import type { FuelType } from '@desert/types';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';

interface Props {
  stations: StationWithPrice[];
  t: Translations;
  selectedFuel: FuelType;
  selected: StationWithPrice | null;
  onSelect: (station: StationWithPrice) => void;
}

function stationPrice(station: StationWithPrice, fuelType: string): number | null {
  const exact = station.price?.prices[fuelType];
  if (exact !== undefined) return exact;
  const range = station.price?.priceRanges?.[fuelType];
  if (range) return (range.low + range.high) / 2;
  return null;
}

export default function MapSidebar({ stations, t, selectedFuel, selected, onSelect }: Props) {
  const sorted = [...stations]
    .filter(s => stationPrice(s, selectedFuel) !== null)
    .sort((a, b) => (stationPrice(a, selectedFuel) ?? Infinity) - (stationPrice(b, selectedFuel) ?? Infinity))
    .slice(0, 30);

  return (
    <div className="flex flex-col h-full">
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
                      isSelected ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate transition-colors ${
                        isSelected ? 'text-blue-700' : 'text-gray-900 group-hover:text-blue-700'
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
