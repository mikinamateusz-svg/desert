import { notFound } from 'next/navigation';
import { detectLocale, getTranslations } from '../../../../lib/i18n';
import { partnerFetchPublic, PartnerApiError } from '../../../../lib/partner-api';
import type { PartnerStation } from '../../../../lib/types';
import { ClaimForm } from './ClaimForm';

interface PageProps {
  params: Promise<{ stationId: string }>;
}

export default async function ClaimSubmitPage({ params }: PageProps) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const { stationId } = await params;

  let station: PartnerStation | null = null;
  try {
    station = await partnerFetchPublic<PartnerStation>(`/v1/stations/${stationId}`);
  } catch (e) {
    if (e instanceof PartnerApiError && e.status === 404) {
      notFound();
    }
    throw e;
  }

  if (!station) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t.claim.submitTitle}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.claim.submitSubtitle}</p>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-4">
        <div className="font-medium text-gray-900">{station.name}</div>
        <div className="text-sm text-gray-500 mt-1">
          {station.address ?? '—'}
          {station.brand ? ` · ${station.brand}` : ''}
        </div>
      </section>

      <ClaimForm stationId={station.id} t={t.claim} />
    </div>
  );
}
