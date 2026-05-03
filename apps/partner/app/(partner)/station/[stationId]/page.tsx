import Link from 'next/link';
import { redirect } from 'next/navigation';
import { detectLocale, getTranslations } from '../../../../lib/i18n';
import { partnerFetch, partnerFetchPublic, PartnerApiError } from '../../../../lib/partner-api';
import type { MyClaim, PartnerStation } from '../../../../lib/types';

interface PageProps {
  params: Promise<{ stationId: string }>;
}

/**
 * Placeholder station-management screen — Story 7.3 (self-service price
 * update) and Story 7.4 (performance metrics) fill this in.
 *
 * P6 (CR fix): ownership is enforced HERE (not just in 7.3's mutating
 * endpoints) so future stories can't silently render management UI to
 * non-owners. Pattern: fetch the user's claims and require an APPROVED
 * one for this stationId. Anyone else gets bounced to /home.
 *
 * APPROVED status is the only valid state — PENDING / AWAITING_DOCS /
 * REJECTED applicants don't get to manage the station even if they
 * deep-linked here.
 */
export default async function StationManagePage({ params }: PageProps) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const { stationId } = await params;

  // P6: ownership gate. Server-side fetch happens before any station
  // data is rendered. If the request fails, treat as "not authorised"
  // and redirect (fail-closed).
  let myClaims: MyClaim[] = [];
  try {
    myClaims = await partnerFetch<MyClaim[]>('/v1/me/station-claims');
  } catch {
    redirect('/home');
  }
  const ownsStation = myClaims.some(
    (c) => c.station_id === stationId && c.status === 'APPROVED',
  );
  if (!ownsStation) {
    redirect('/home');
  }

  let station: PartnerStation | null = null;
  try {
    station = await partnerFetchPublic<PartnerStation>(`/v1/stations/${stationId}`);
  } catch (e) {
    if (e instanceof PartnerApiError && e.status !== 404) throw e;
  }

  return (
    <div className="space-y-6">
      <Link href="/home" className="text-sm text-blue-600 hover:underline">
        {t.station.backToHome}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          {station?.name ?? t.station.placeholderTitle}
        </h1>
        {station?.address && (
          <p className="mt-1 text-sm text-gray-500">{station.address}</p>
        )}
      </div>

      <div className="rounded-md border border-dashed border-gray-300 bg-white p-8 text-center">
        <p className="text-sm text-gray-500">{t.station.placeholderSubtitle}</p>
      </div>
    </div>
  );
}
