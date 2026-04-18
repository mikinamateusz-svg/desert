import { NextRequest, NextResponse } from 'next/server';
import { fetchStationsWithPrices } from '../../../lib/api';

/**
 * Client-side proxy for fetching stations with prices.
 * Keeps INTERNAL_API_URL server-side only — the browser calls /api/stations
 * and this route forwards to the backend.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lng = parseFloat(searchParams.get('lng') ?? '');
  const radius = parseFloat(searchParams.get('radius') ?? '50000');

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Invalid lat/lng' }, { status: 400 });
  }

  try {
    const stations = await fetchStationsWithPrices(lat, lng, Math.min(radius, 50_000));
    return NextResponse.json(stations);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
