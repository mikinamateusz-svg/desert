'use client';

import ReactMap, { NavigationControl, type MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useState } from 'react';
import type { RefObject } from 'react';
import type { FuelType } from '@desert/types';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';
import StationMarker from './StationMarker';
import FuelTypePills from './FuelTypePills';

type PriceColor = 'cheap' | 'mid' | 'expensive' | 'nodata';

function getRepresentativePrice(station: StationWithPrice, fuelType: string): number | undefined {
  const exact = station.price?.prices[fuelType];
  if (exact !== undefined) return exact;
  const range = station.price?.priceRanges?.[fuelType];
  if (range) return (range.low + range.high) / 2;
  return undefined;
}

function computePriceTiers(stations: StationWithPrice[], fuelType: string): Map<string, PriceColor> {
  const result = new Map<string, PriceColor>();
  const withPrices = stations
    .map(s => ({ id: s.id, price: getRepresentativePrice(s, fuelType) }))
    .filter((x): x is { id: string; price: number } => x.price !== undefined);

  if (withPrices.length < 2) {
    stations.forEach(s => result.set(s.id, 'nodata'));
    return result;
  }

  const prices = withPrices.map(x => x.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min;

  stations.forEach(s => {
    const price = getRepresentativePrice(s, fuelType);
    if (price === undefined) { result.set(s.id, 'nodata'); return; }
    if (spread === 0) { result.set(s.id, 'mid'); return; }
    const ratio = (price - min) / spread;
    result.set(s.id, ratio <= 0.33 ? 'cheap' : ratio <= 0.66 ? 'mid' : 'expensive');
  });

  return result;
}

export interface MapBounds {
  north: number; south: number; east: number; west: number;
}

interface Props {
  mapRef: RefObject<MapRef | null>;
  stations: StationWithPrice[];
  defaultLat: number;
  defaultLng: number;
  t: Translations;
  selected: StationWithPrice | null;
  onSelect: (station: StationWithPrice) => void;
  selectedFuel: FuelType;
  onFuelChange: (ft: FuelType) => void;
  onBoundsChange: (bounds: MapBounds) => void;
}

export default function MapView({
  mapRef,
  stations,
  defaultLat,
  defaultLng,
  t,
  selected,
  onSelect,
  selectedFuel,
  onFuelChange,
  onBoundsChange,
}: Props) {
  const [noneInView, setNoneInView] = useState(false);

  const priceTiers = computePriceTiers(stations, selectedFuel);

  function handleFindCheapest() {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    if (!bounds) return;

    const inView = stations.filter(s =>
      s.lat >= bounds.getSouth() &&
      s.lat <= bounds.getNorth() &&
      s.lng >= bounds.getWest() &&
      s.lng <= bounds.getEast() &&
      getRepresentativePrice(s, selectedFuel) !== undefined,
    );

    if (inView.length === 0) {
      setNoneInView(true);
      setTimeout(() => setNoneInView(false), 2500);
      return;
    }

    const cheapest = inView.reduce((best, s) =>
      getRepresentativePrice(s, selectedFuel)! < getRepresentativePrice(best, selectedFuel)! ? s : best,
    );

    onSelect(cheapest);
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactMap
        ref={mapRef}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        initialViewState={{
          longitude: defaultLng,
          latitude: defaultLat,
          zoom: 6,
        }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        style={{ width: '100%', height: '100%' }}
        onLoad={() => {
          const b = mapRef.current?.getBounds();
          if (b) onBoundsChange({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() });
        }}
        onMoveEnd={() => {
          const b = mapRef.current?.getBounds();
          if (b) onBoundsChange({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() });
        }}
      >
        <NavigationControl position="bottom-left" />

        {stations.map(station => (
          <StationMarker
            key={station.id}
            station={station}
            priceColor={priceTiers.get(station.id) ?? 'nodata'}
            isSelected={selected?.id === station.id}
            selectedFuel={selectedFuel}
            onClick={() => onSelect(station)}
          />
        ))}
      </ReactMap>

      {/* Fuel type selector — floats at top-centre, always visible */}
      <FuelTypePills selected={selectedFuel} onChange={onFuelChange} t={t} />

      {/* Cheapest in viewport pill — mobile only, hidden while panel is open */}
      {!selected && (
        <button
          onClick={handleFindCheapest}
          className="lg:hidden absolute bottom-10 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white shadow-lg border border-gray-200 text-sm font-semibold text-gray-900 hover:bg-gray-50 active:scale-95 transition-all whitespace-nowrap"
        >
          🏆 {t.cheapestFinder.button}
        </button>
      )}

      {/* "None in view" toast */}
      {noneInView && (
        <div className="lg:hidden absolute bottom-24 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-gray-900/90 text-white text-xs whitespace-nowrap">
          {t.cheapestFinder.none}
        </div>
      )}
    </div>
  );
}
