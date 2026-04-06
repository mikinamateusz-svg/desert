'use client';

import { Popup } from 'react-map-gl';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';

const FUEL_ORDER = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'] as const;

interface Props {
  station: StationWithPrice;
  t: Translations;
  onClose: () => void;
}

export default function StationPopup({ station, t, onClose }: Props) {
  const { price } = station;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;

  return (
    <Popup
      longitude={station.lng}
      latitude={station.lat}
      anchor="bottom"
      onClose={onClose}
      closeButton={false}
      maxWidth="220px"
    >
      <div className="p-3 min-w-[180px]">
        <p className="font-semibold text-sm text-gray-900 mb-0.5 leading-tight">{station.name}</p>
        {station.address && (
          <p className="text-xs text-gray-500 mb-2 leading-tight">{station.address}</p>
        )}

        {price ? (
          <div className="space-y-1 mb-3">
            {FUEL_ORDER.map(ft => {
              const val = price.prices[ft];
              if (val === undefined) return null;
              const isEst = price.estimateLabel?.[ft] !== undefined;
              const range = price.priceRanges?.[ft];
              const display = range
                ? `~${range.low.toFixed(2)}–${range.high.toFixed(2)}`
                : isEst
                  ? `~${val.toFixed(2)}`
                  : val.toFixed(2);
              return (
                <div key={ft} className="flex justify-between items-center text-xs">
                  <span className="text-gray-700">{t.fuelTypes[ft] ?? ft}</span>
                  <span className={`font-semibold tabular-nums ${isEst ? 'text-gray-400' : 'text-gray-900'}`}>
                    {display} <span className="font-normal">zł/l</span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400 mb-3">{t.noData}</p>
        )}

        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-xs font-semibold text-center py-1.5 px-2 rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          {t.station.navigate}
        </a>
      </div>
    </Popup>
  );
}
