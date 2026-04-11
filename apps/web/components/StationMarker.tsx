'use client';

import { Marker } from 'react-map-gl';
import type { CSSProperties } from 'react';
import type { FuelType } from '@desert/types';
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
const PIN_SIZE_SELECTED = 38;

interface Props {
  station: StationWithPrice;
  priceColor: PriceColor;
  isSelected: boolean;
  selectedFuel: FuelType;
  onClick: () => void;
}

export default function StationMarker({ station, priceColor, isSelected, selectedFuel, onClick }: Props) {
  const pb95  = station.price?.prices[selectedFuel];
  const range = station.price?.priceRanges?.[selectedFuel];
  const isEstimated = range !== undefined || station.price?.estimateLabel?.[selectedFuel] !== undefined;

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
  const size = isSelected ? PIN_SIZE_SELECTED : PIN_SIZE;

  const pinStyle: CSSProperties = {
    width:           size,
    height:          size,
    borderRadius:    '50% 50% 50% 0',
    transform:       'rotate(-45deg)',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: isEstimatedWithColor ? '#e5e7eb' : color,
    boxShadow: isSelected
      ? `0 0 0 3px #fff, 0 0 0 5px ${color}, 0 4px 12px rgba(0,0,0,0.30)`
      : isEstimatedWithColor
        ? `0 0 0 2.5px ${color}, 0 2px 8px rgba(0,0,0,0.12)`
        : '0 2px 8px rgba(0,0,0,0.20)',
    cursor:    'pointer',
    flexShrink: 0,
    transition: 'width 0.15s, height 0.15s, box-shadow 0.15s',
  };

  const labelStyle: CSSProperties = {
    transform:  'rotate(45deg)',
    fontSize:   isSelected ? '8px' : '7px',
    fontWeight: 800,
    color:      isEstimatedWithColor ? color : 'white',
    lineHeight: 1,
    textAlign:  'center',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  return (
    <Marker
      longitude={station.lng}
      latitude={station.lat}
      anchor="bottom"
      onClick={(e) => { e.originalEvent.stopPropagation(); onClick(); }}
    >
      {/* button kept for accessibility label; click is handled by Marker */}
      <button
        data-testid="station-marker"
        aria-label={`${station.name}: ${selectedFuel} ${pinLabel} zł/l`}
        style={{ ...pinStyle, border: 'none', padding: 0, outline: 'none' }}
        tabIndex={-1}
      >
        <span style={labelStyle}>{pinLabel}</span>
      </button>
    </Marker>
  );
}
