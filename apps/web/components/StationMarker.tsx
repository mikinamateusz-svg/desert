'use client';

import { Marker } from 'react-map-gl';
import type { CSSProperties } from 'react';
import type { StationWithPrice } from '../lib/api';

type PriceColor = 'cheap' | 'mid' | 'expensive' | 'nodata';

const COLORS: Record<PriceColor, string> = {
  cheap:     '#22c55e',
  mid:       '#f59e0b',
  expensive: '#ef4444',
  nodata:    '#94a3b8',
};

// Pin is a 32×32 square with border-radius 50% 50% 50% 0 (sharp bottom-left)
// rotated -45° so the sharp corner points straight down — classic map-pin teardrop.
const PIN_SIZE = 32;

interface Props {
  station: StationWithPrice;
  priceColor: PriceColor;
  onClick: () => void;
}

export default function StationMarker({ station, priceColor, onClick }: Props) {
  const pb95  = station.price?.prices['PB_95'];
  const range = station.price?.priceRanges?.['PB_95'];
  const isEstimated = range !== undefined || station.price?.estimateLabel?.['PB_95'] !== undefined;

  let pinLabel: string;
  if (range) {
    pinLabel = `~${((range.low + range.high) / 2).toFixed(2)}`;
  } else if (pb95 !== undefined) {
    pinLabel = `${isEstimated ? '~' : ''}${pb95.toFixed(2)}`;
  } else {
    pinLabel = '?';
  }

  const color = COLORS[priceColor];
  const isEstimatedWithColor = isEstimated && priceColor !== 'nodata';

  const pinStyle: CSSProperties = {
    width:        PIN_SIZE,
    height:       PIN_SIZE,
    borderRadius: '50% 50% 50% 0',
    transform:    'rotate(-45deg)',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    backgroundColor: isEstimatedWithColor ? '#e5e7eb' : color,
    boxShadow: isEstimatedWithColor
      ? `0 0 0 2.5px ${color}, 0 2px 8px rgba(0,0,0,0.12)`
      : '0 2px 8px rgba(0,0,0,0.20)',
    cursor:      'pointer',
    flexShrink:  0,
  };

  const labelStyle: CSSProperties = {
    transform:  'rotate(45deg)',
    fontSize:   '7px',
    fontWeight: 800,
    color:      isEstimatedWithColor ? color : 'white',
    lineHeight: 1,
    textAlign:  'center',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  return (
    <Marker longitude={station.lng} latitude={station.lat} anchor="bottom">
      <button
        onClick={onClick}
        aria-label={`${station.name}: PB 95 ${pinLabel} zł/l`}
        style={{ ...pinStyle, border: 'none', padding: 0, outline: 'none' }}
      >
        <span style={labelStyle}>{pinLabel}</span>
      </button>
    </Marker>
  );
}
