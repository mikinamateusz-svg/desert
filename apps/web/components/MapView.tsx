'use client';

import ReactMap, { NavigationControl, type MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useState, useRef, useCallback } from 'react';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';
import StationMarker from './StationMarker';
import StationDetailPanel from './StationDetailPanel';

type PriceColor = 'cheap' | 'mid' | 'expensive' | 'nodata';

function getRepresentativePrice(station: StationWithPrice): number | undefined {
  const pb95 = station.price?.prices['PB_95'];
  if (pb95 !== undefined) return pb95;
  const range = station.price?.priceRanges?.['PB_95'];
  if (range) return (range.low + range.high) / 2;
  return undefined;
}

function computePriceTiers(stations: StationWithPrice[]): Map<string, PriceColor> {
  const result = new Map<string, PriceColor>();
  const withPrices = stations
    .map(s => ({ id: s.id, price: getRepresentativePrice(s) }))
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
    const price = getRepresentativePrice(s);
    if (price === undefined) { result.set(s.id, 'nodata'); return; }
    if (spread === 0) { result.set(s.id, 'mid'); return; }
    const ratio = (price - min) / spread;
    result.set(s.id, ratio <= 0.33 ? 'cheap' : ratio <= 0.66 ? 'mid' : 'expensive');
  });

  return result;
}

// On mobile the bottom sheet covers ~50% of the map height.
// Offset the fly-to so the pin lands in the upper visible portion.
const MOBILE_PAN_OFFSET_PX = 120;

interface Props {
  stations: StationWithPrice[];
  defaultLat: number;
  defaultLng: number;
  t: Translations;
}

export default function MapView({ stations, defaultLat, defaultLng, t }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [selected, setSelected] = useState<StationWithPrice | null>(null);
  const [noneInView, setNoneInView] = useState(false);
  const priceTiers = computePriceTiers(stations);

  const selectStation = useCallback((station: StationWithPrice) => {
    setSelected(station);
    const map = mapRef.current;
    if (!map) return;

    // On mobile (<lg = <1024px) pan so the pin sits above the bottom sheet.
    // On desktop the panel is a floating card and doesn't cover the pin.
    const isMobile = window.innerWidth < 1024;
    if (isMobile) {
      map.flyTo({
        center: [station.lng, station.lat],
        offset: [0, MOBILE_PAN_OFFSET_PX],
        duration: 400,
      });
    }
  }, []);

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
      s.price?.prices['PB_95'] !== undefined,
    );

    if (inView.length === 0) {
      setNoneInView(true);
      setTimeout(() => setNoneInView(false), 2500);
      return;
    }

    const cheapest = inView.reduce((best, s) =>
      (s.price!.prices['PB_95']! < best.price!.prices['PB_95']!) ? s : best,
    );

    selectStation(cheapest);
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
      >
        <NavigationControl position="bottom-left" />

        {stations.map(station => (
          <StationMarker
            key={station.id}
            station={station}
            priceColor={priceTiers.get(station.id) ?? 'nodata'}
            isSelected={selected?.id === station.id}
            onClick={() => selectStation(station)}
          />
        ))}
      </ReactMap>

      {/* Station detail panel — outside ReactMap to avoid z-index issues */}
      {selected && (
        <StationDetailPanel
          station={selected}
          t={t}
          onClose={() => setSelected(null)}
        />
      )}

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
