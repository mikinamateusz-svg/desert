'use client';

import ReactMap, { NavigationControl, type MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useState, useRef } from 'react';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';
import StationMarker from './StationMarker';
import StationPopup from './StationPopup';

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

interface Props {
  stations: StationWithPrice[];
  defaultLat: number;
  defaultLng: number;
  t: Translations;
}

export default function MapView({ stations, defaultLat, defaultLng, t }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [selected, setSelected] = useState<StationWithPrice | null>(null);
  const [showContributePrompt, setShowContributePrompt] = useState(false);
  const [noneInView, setNoneInView] = useState(false);
  const priceTiers = computePriceTiers(stations);

  function handleContribute() {
    setSelected(null);
    setShowContributePrompt(true);
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

    map.flyTo({ center: [cheapest.lng, cheapest.lat], zoom: 15, duration: 800 });
    setSelected(cheapest);
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
            onClick={() => setSelected(station)}
          />
        ))}

        {selected && (
          <StationPopup
            station={selected}
            t={t}
            onClose={() => setSelected(null)}
            onContribute={handleContribute}
          />
        )}
      </ReactMap>

      {/* Contribute CTA — top-right overlay */}
      <button
        onClick={() => setShowContributePrompt(true)}
        className="absolute top-4 right-4 z-10 px-4 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-sm font-semibold shadow-md transition-colors"
      >
        {t.contribute}
      </button>

      {/* Cheapest in viewport — mobile only, bottom-centre floating pill */}
      <button
        onClick={handleFindCheapest}
        className="lg:hidden absolute bottom-10 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white shadow-lg border border-gray-200 text-sm font-semibold text-gray-900 hover:bg-gray-50 active:scale-95 transition-all whitespace-nowrap"
      >
        🏆 {t.cheapestFinder.button}
      </button>

      {/* "None in view" feedback toast */}
      {noneInView && (
        <div className="lg:hidden absolute bottom-24 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-gray-900/90 text-white text-xs whitespace-nowrap">
          {t.cheapestFinder.none}
        </div>
      )}

      {/* Login prompt modal */}
      {showContributePrompt && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
          onClick={() => setShowContributePrompt(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-6 mx-6 max-w-sm w-full"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 mb-2">{t.contributePromptTitle}</h2>
            <p className="text-sm text-gray-600 mb-4">{t.contributePrompt}</p>
            <button
              onClick={() => setShowContributePrompt(false)}
              className="w-full py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-sm font-semibold transition-colors"
            >
              {t.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
