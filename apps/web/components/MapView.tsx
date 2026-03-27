'use client';

import Map, { NavigationControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useState } from 'react';
import type { StationWithPrice } from '../lib/api';
import type { Translations } from '../lib/i18n';
import StationMarker from './StationMarker';
import StationPopup from './StationPopup';

interface Props {
  stations: StationWithPrice[];
  defaultLat: number;
  defaultLng: number;
  t: Translations;
}

export default function MapView({ stations, defaultLat, defaultLng, t }: Props) {
  const [selected, setSelected] = useState<StationWithPrice | null>(null);
  const [showContributePrompt, setShowContributePrompt] = useState(false);

  function handleContribute() {
    setSelected(null);
    setShowContributePrompt(true);
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Map
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
      </Map>

      {/* Contribute CTA — top-right overlay (AC4) */}
      <button
        onClick={() => setShowContributePrompt(true)}
        className="absolute top-4 right-4 z-10 px-4 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-sm font-semibold shadow-md transition-colors"
      >
        {t.contribute}
      </button>

      {/* Login prompt modal (AC4) */}
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
