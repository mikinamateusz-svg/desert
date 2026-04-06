import Link from 'next/link';
import type { StationWithPrice } from '../lib/api';
import type { Locale, Translations } from '../lib/i18n';
interface Props {
  stations: StationWithPrice[];
  t: Translations;
  locale: Locale;
}

const FUEL_ORDER = ['PB_95', 'ON', 'LPG', 'PB_98', 'ON_PREMIUM'];

function bestPrice(station: StationWithPrice): number | null {
  const pb95 = station.price?.prices['PB_95'];
  if (pb95 !== undefined) return pb95;
  for (const f of FUEL_ORDER) {
    const p = station.price?.prices[f];
    if (p !== undefined) return p;
  }
  return null;
}

export default function MapSidebar({ stations, t, locale }: Props) {
  const stationPrefix = locale === 'en' ? '/en/stations' : locale === 'uk' ? '/uk/stations' : '/stacje';

  const sorted = [...stations]
    .filter(s => bestPrice(s) !== null)
    .sort((a, b) => (bestPrice(a) ?? Infinity) - (bestPrice(b) ?? Infinity))
    .slice(0, 30);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{t.sidebar.nearbyStations}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{t.sidebar.sortedByPrice}</p>
      </div>

      {/* Station list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">{t.sidebar.noStations}</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {sorted.map(station => {
              const price = bestPrice(station);
              const range = station.price?.priceRanges?.['PB_95'];
              const isEstimated = !!station.price?.estimateLabel?.['PB_95'];

              return (
                <li key={station.id}>
                  <Link
                    href={`${stationPrefix}/${station.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate group-hover:text-blue-700 transition-colors">
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
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </div>
  );
}
