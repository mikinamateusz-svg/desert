'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { FuelType } from '@desert/types';
import type { MapRef } from 'react-map-gl';
import type { StationWithPrice } from '../lib/api';
import type { Locale, Translations } from '../lib/i18n';
import MapView, { type MapBounds } from './MapView';
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

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? '';

async function fetchStationsAt(lat: number, lng: number, radius: number): Promise<StationWithPrice[]> {
  const [sRes, pRes] = await Promise.all([
    fetch(`${API_BASE}/v1/stations/nearby?lat=${lat}&lng=${lng}&radius=${radius}`),
    fetch(`${API_BASE}/v1/prices/nearby?lat=${lat}&lng=${lng}&radius=${radius}`),
  ]);
  if (!sRes.ok || !pRes.ok) return [];
  const [rawStations, rawPrices] = await Promise.all([sRes.json(), pRes.json()]) as [unknown, unknown];
  const stationsList = (rawStations as { id: string; [k: string]: unknown }[]) ?? [];
  const pricesList = (rawPrices as { stationId: string; [k: string]: unknown }[]) ?? [];
  const priceMap = new Map(pricesList.map(p => [p.stationId, p]));
  return stationsList.map(s => ({
    ...(s as unknown as StationWithPrice),
    price: (priceMap.get(s.id) as unknown as StationWithPrice['price']) ?? null,
  }));
}

export default function MapContainer({ stations: initialStations, defaultLat, defaultLng, t }: Props) {
  const mapRef = useRef<MapRef>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<StationWithPrice | null>(null);
  const [selectedFuel, setSelectedFuel] = useState<FuelType>('PB_95');
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [stations, setStations] = useState<StationWithPrice[]>(initialStations);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refetch stations when viewport changes — merge with existing so pins don't vanish.
  // Debounced to avoid spamming the API during pan/zoom.
  useEffect(() => {
    if (!mapBounds) return;
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      const centerLat = (mapBounds.north + mapBounds.south) / 2;
      const centerLng = (mapBounds.east + mapBounds.west) / 2;
      // Radius = distance from centre to north-east corner (metres)
      const EARTH_M = 6_371_000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(mapBounds.north - centerLat);
      const dLng = toRad(mapBounds.east - centerLng);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(centerLat)) ** 2 * Math.sin(dLng / 2) ** 2;
      const radius = Math.min(50_000, 2 * EARTH_M * Math.asin(Math.sqrt(a)));
      void fetchStationsAt(centerLat, centerLng, radius).then(fresh => {
        if (fresh.length === 0) return;
        setStations(prev => {
          const map = new Map(prev.map(s => [s.id, s]));
          for (const s of fresh) map.set(s.id, s);
          return Array.from(map.values());
        });
      });
    }, 500);
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };
  }, [mapBounds]);

  const stationsInView = mapBounds
    ? stations.filter(s =>
        s.lat >= mapBounds.south && s.lat <= mapBounds.north &&
        s.lng >= mapBounds.west  && s.lng <= mapBounds.east,
      )
    : stations;

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
          onBoundsChange={setMapBounds}
        />
      </div>

      {/* Right sidebar — lg+ */}
      <aside className="hidden lg:flex flex-col w-80 xl:w-96 border-l border-gray-200 bg-white overflow-y-auto flex-shrink-0">
        <MapSidebar
          stations={stationsInView}
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
          selectedFuel={selectedFuel}
          t={t}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
