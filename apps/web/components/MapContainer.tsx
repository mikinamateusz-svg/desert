'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { FuelType } from '@desert/types';
import type { MapRef } from 'react-map-gl';
import type { StationWithPrice } from '../lib/api';
import type { Locale, Translations } from '../lib/i18n';
import MapView from './MapView';
import MapSidebar from './MapSidebar';
import StationDetailPanel from './StationDetailPanel';

const MOBILE_SELECT_ZOOM = 15;

interface Props {
  stations: StationWithPrice[];
  defaultLat: number;
  defaultLng: number;
  t: Translations;
  locale: Locale;
}

export default function MapContainer({ stations, defaultLat, defaultLng, t }: Props) {
  const mapRef = useRef<MapRef>(null);
  const [selected, setSelected] = useState<StationWithPrice | null>(null);
  const [selectedFuel, setSelectedFuel] = useState<FuelType>('PB_95');

  // Pan/zoom to selected station.
  // setPadding defines the "usable" viewport so flyTo centers within the visible area.
  // Reset to zero when panel closes to avoid stale padding on the next selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selected) {
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      return;
    }
    const isMobile = window.innerWidth < 1024;
    map.setPadding(isMobile
      ? { top: 60, bottom: 320, left: 0, right: 0 }
      : { top: 0, bottom: 360, left: 0, right: 0 },
    );
    map.flyTo({
      center: [selected.lng, selected.lat],
      zoom: MOBILE_SELECT_ZOOM,
      duration: 600,
    });
  }, [selected]);

  const handleSelect = useCallback((station: StationWithPrice) => {
    setSelected(station);
  }, []);

  return (
    <div className="flex flex-1 min-h-0 min-w-0 relative">
      {/* Map */}
      <div className="flex-1 relative min-w-0">
        <ul className="sr-only">
          {stations.map(s => {
            const price = s.price?.prices[selectedFuel];
            return (
              <li key={s.id}>
                {s.name}
                {s.address ? `, ${s.address}` : ''}
                {price !== undefined ? ` — ${t.fuelTypes[selectedFuel]}: ${price.toFixed(2)} zł/l` : ''}
              </li>
            );
          })}
        </ul>
        <MapView
          mapRef={mapRef}
          stations={stations}
          defaultLat={defaultLat}
          defaultLng={defaultLng}
          t={t}
          selected={selected}
          onSelect={handleSelect}
          selectedFuel={selectedFuel}
          onFuelChange={setSelectedFuel}
        />
      </div>

      {/* Right sidebar — lg+ */}
      <aside className="hidden lg:flex flex-col w-80 xl:w-96 border-l border-gray-200 bg-white overflow-y-auto flex-shrink-0">
        <MapSidebar
          stations={stations}
          t={t}
          selectedFuel={selectedFuel}
          selected={selected}
          onSelect={handleSelect}
        />
      </aside>

      {/* Station detail panel — rendered here (not inside MapView) so it positions
          relative to the full map+sidebar container, avoiding nested stacking issues */}
      {selected && (
        <StationDetailPanel
          station={selected}
          t={t}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
