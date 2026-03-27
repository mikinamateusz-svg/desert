'use client';

import { Marker } from 'react-map-gl';
import type { StationWithPrice } from '../lib/api';

interface Props {
  station: StationWithPrice;
  onClick: () => void;
}

export default function StationMarker({ station, onClick }: Props) {
  const pb95 = station.price?.prices['PB_95'];
  const isEstimated = station.price?.estimateLabel?.['PB_95'] !== undefined;

  const label = pb95 !== undefined
    ? `${isEstimated ? '~' : ''}${pb95.toFixed(2)}`
    : '?';

  return (
    <Marker longitude={station.lng} latitude={station.lat} anchor="bottom">
      <button
        onClick={onClick}
        className="px-1.5 py-0.5 rounded text-xs font-semibold shadow cursor-pointer border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors whitespace-nowrap"
        aria-label={`${station.name}: ${label} zł/l`}
      >
        {label}
      </button>
    </Marker>
  );
}
