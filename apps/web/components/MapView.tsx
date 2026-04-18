'use client';

import ReactMap, { NavigationControl, type MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useState, useMemo } from 'react';
import type { RefObject } from 'react';
import type { FuelType } from '@desert/types';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';
import StationMarker from './StationMarker';
import FuelTypePills from './FuelTypePills';

export type PriceColor = 'cheapest' | 'cheap' | 'mid' | 'pricey' | 'expensive' | 'nodata';

/** Minimum price spread (PLN) to distinguish quintiles. Below this, all stations show as 'mid'. */
const MIN_SPREAD_PLN = 0.10;

/** Minimum radius in metres for the color population. */
const MIN_COLOR_RADIUS_M = 20_000;

function getRepresentativePrice(station: StationWithPrice, fuelType: string): number | undefined {
  const exact = station.price?.prices[fuelType];
  if (exact !== undefined) return exact;
  const range = station.price?.priceRanges?.[fuelType];
  if (range) return (range.low + range.high) / 2;
  return undefined;
}

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

const QUINTILES: PriceColor[] = ['cheapest', 'cheap', 'mid', 'pricey', 'expensive'];

function computePriceTiers(
  stations: StationWithPrice[],
  fuelType: string,
  centerLat?: number,
  centerLng?: number,
  viewportRadiusM?: number,
): Map<string, PriceColor> {
  const result = new Map<string, PriceColor>();

  // Determine population: stations within max(20km, viewport radius) of center
  let population = stations;
  if (centerLat !== undefined && centerLng !== undefined) {
    const radius = Math.max(MIN_COLOR_RADIUS_M, viewportRadiusM ?? MIN_COLOR_RADIUS_M);
    population = stations.filter(
      s => haversineMetres(centerLat, centerLng, s.lat, s.lng) <= radius,
    );
  }

  const withPrice: { id: string; price: number }[] = [];
  for (const s of population) {
    const price = getRepresentativePrice(s, fuelType);
    if (price !== undefined) {
      withPrice.push({ id: s.id, price });
    } else {
      result.set(s.id, 'nodata');
    }
  }

  if (withPrice.length < 2) {
    withPrice.forEach(s => result.set(s.id, 'nodata'));
    return result;
  }

  // Cluster guard
  const min = Math.min(...withPrice.map(s => s.price));
  const max = Math.max(...withPrice.map(s => s.price));
  if (max - min < MIN_SPREAD_PLN) {
    withPrice.forEach(s => result.set(s.id, 'mid'));
    return result;
  }

  // Percentile-based quintiles
  withPrice.sort((a, b) => a.price - b.price);
  const count = withPrice.length;
  for (let i = 0; i < count; i++) {
    const rank = i / (count - 1);
    const bucket = Math.min(Math.floor(rank * 5), 4);
    result.set(withPrice[i]!.id, QUINTILES[bucket]!);
  }

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
  const [viewCenter, setViewCenter] = useState<{ lat: number; lng: number }>({ lat: defaultLat, lng: defaultLng });
  const [viewportRadiusM, setViewportRadiusM] = useState(MIN_COLOR_RADIUS_M);

  const priceTiers = useMemo(
    () => computePriceTiers(stations, selectedFuel, viewCenter.lat, viewCenter.lng, viewportRadiusM),
    [stations, selectedFuel, viewCenter.lat, viewCenter.lng, viewportRadiusM],
  );

  function handleMoveEnd(e: { target: mapboxgl.Map }) {
    const b = e.target.getBounds();
    if (b) {
      onBoundsChange({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() });
      const cLat = b.getCenter().lat;
      const cLng = b.getCenter().lng;
      setViewCenter({ lat: cLat, lng: cLng });
      setViewportRadiusM(haversineMetres(cLat, cLng, b.getNorth(), b.getEast()));
    }
  }

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
        onLoad={e => handleMoveEnd(e)}
        onMoveEnd={e => handleMoveEnd(e)}
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
          {t.cheapestFinder.button}
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
