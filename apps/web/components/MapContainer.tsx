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
  const panelRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<StationWithPrice | null>(null);
  const [selectedFuel, setSelectedFuel] = useState<FuelType>('PB_95');

  // Pan/zoom to selected station.
  // Mobile: fixed offset above bottom sheet.
  // Desktop: measure the card's actual DOM position to compute exact offsetY so the
  // pin lands in the centre of the visible map area above the card.
  useEffect(() => {
    if (!selected) return;
    const map = mapRef.current;
    if (!map) return;
    const isMobile = window.innerWidth < 1024;

    if (isMobile) {
      map.flyTo({ center: [selected.lng, selected.lat], zoom: MOBILE_SELECT_ZOOM, offset: [0, -150], duration: 600 });
      return;
    }

    // React commits DOM before effects fire, so panelRef.current is available here.
    const canvas = map.getCanvas();
    const canvasRect = canvas.getBoundingClientRect();
    let offsetY = 0;
    if (panelRef.current) {
      const cardRect = panelRef.current.getBoundingClientRect();
      // Usable map height = distance from canvas top to card top
      const usableHeight = cardRect.top - canvasRect.top;
      // Place pin at centre of usable area; offsetY is relative to canvas centre
      offsetY = usableHeight / 2 - canvasRect.height / 2;
    }
    map.flyTo({ center: [selected.lng, selected.lat], zoom: MOBILE_SELECT_ZOOM, offset: [0, offsetY], duration: 600 });
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
          ref={panelRef}
          station={selected}
          t={t}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
