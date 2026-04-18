'use client';

import { Marker } from 'react-map-gl';
import type { CSSProperties } from 'react';
import type { FuelType } from '@desert/types';
import type { StationWithPrice } from '../lib/api';
import type { PriceColor } from './MapView';

const COLORS: Record<PriceColor, string> = {
  cheapest:  '#1a9641',
  cheap:     '#66bd63',
  mid:       '#f5c542',
  pricey:    '#f46d43',
  expensive: '#d7191c',
  nodata:    '#94a3b8',
};

// Dark text on light pin backgrounds, white on dark
const TEXT_COLORS: Record<PriceColor, string> = {
  cheapest:  '#ffffff',
  cheap:     '#1a1a1a',
  mid:       '#1a1a1a',
  pricey:    '#ffffff',
  expensive: '#ffffff',
  nodata:    '#ffffff',
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
    backgroundColor: isEstimatedWithColor ? '#6b7280' : color,
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
    color:      isEstimatedWithColor ? '#ffffff' : TEXT_COLORS[priceColor],
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
