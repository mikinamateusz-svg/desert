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
  const range = station.price?.priceRanges?.['PB_95'];

  let priceLine: string;
  if (range) {
    priceLine = `~${range.low.toFixed(2)}–${range.high.toFixed(2)}`;
  } else if (pb95 !== undefined) {
    priceLine = `${isEstimated ? '~' : ''}${pb95.toFixed(2)}`;
  } else {
    priceLine = '?';
  }

  return (
    <Marker longitude={station.lng} latitude={station.lat} anchor="bottom">
      <button
        onClick={onClick}
        className="flex flex-col items-center px-1.5 py-0.5 rounded text-xs shadow cursor-pointer border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors whitespace-nowrap leading-tight"
        aria-label={`${station.name}: PB 95 ${priceLine} zł/l`}
      >
        <span className="text-gray-400 font-normal" style={{ fontSize: '0.6rem' }}>PB 95</span>
        <span className="font-semibold">{priceLine}</span>
      </button>
    </Marker>
  );
}
