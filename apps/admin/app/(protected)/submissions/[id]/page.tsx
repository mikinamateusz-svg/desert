import Link from 'next/link';
import { notFound } from 'next/navigation';
import { detectLocale, getTranslations } from '../../../../lib/i18n';
import { adminFetch, AdminApiError } from '../../../../lib/admin-api';
import type { FlaggedSubmissionDetail } from '../../../../lib/types';
import ReviewActions from './ReviewActions';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SubmissionDetailPage({ params }: Props) {
  const { id } = await params;
  const locale = await detectLocale();
  const t = getTranslations(locale);

  let submission: FlaggedSubmissionDetail | null = null;
  let fetchError: string | null = null;

  try {
    submission = await adminFetch<FlaggedSubmissionDetail>(`/v1/admin/submissions/${id}`);
  } catch (e) {
    if (e instanceof AdminApiError && (e.status === 404 || e.status === 409)) {
      notFound();
    }
    fetchError = t.review.errorGeneric;
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/submissions"
        className="mb-6 inline-block text-sm text-gray-500 hover:text-gray-900"
      >
        {t.review.back}
      </Link>

      <h1 className="text-2xl font-semibold text-gray-900">{t.sections.submissions.title}</h1>

      {fetchError && (
        <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{fetchError}</p>
      )}

      {submission && (
        <>
          <dl className="mt-6 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            <DetailRow label={t.review.stationLabel}>
              {submission.station_name ?? t.review.unknown}
            </DetailRow>
            <DetailRow label={t.review.brandLabel}>
              {submission.station_brand ?? t.review.unknown}
            </DetailRow>
            <DetailRow label={t.review.flagLabel}>
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {t.review.flagReason[submission.flag_reason] ?? submission.flag_reason}
              </span>
            </DetailRow>
            <DetailRow label={t.review.columns.prices}>
              <ul className="space-y-0.5">
                {Array.isArray(submission.price_data) &&
                  submission.price_data.map((p) => {
                    const priceText =
                      typeof p.price_per_litre === 'number' && Number.isFinite(p.price_per_litre)
                        ? `${p.price_per_litre.toFixed(3)} zł/l`
                        : '— zł/l';
                    return (
                      <li key={p.fuel_type} className="text-sm">
                        <span className="font-mono text-xs text-gray-500">{p.fuel_type}</span>{' '}
                        <span className="font-medium">{priceText}</span>
                      </li>
                    );
                  })}
              </ul>
            </DetailRow>
            <DetailRow label={t.review.confidenceLabel}>
              {submission.ocr_confidence_score != null
                ? `${(submission.ocr_confidence_score * 100).toFixed(0)}%`
                : t.review.na}
            </DetailRow>
            <DetailRow label={t.review.submittedLabel}>
              {new Date(submission.created_at).toLocaleString(locale)}
            </DetailRow>
            <DetailRow label={t.review.contributorLabel}>
              <span className="font-mono text-xs">{submission.user_id}</span>
            </DetailRow>
            {submission.gps_lat != null && submission.gps_lng != null && (
              <DetailRow label={t.review.gpsLabel}>
                <span className="font-mono text-xs">
                  {submission.gps_lat}, {submission.gps_lng}
                </span>
              </DetailRow>
            )}
            {submission.photo_url && (
              <DetailRow label={t.review.photoLabel}>
                <div>
                  <img
                    src={submission.photo_url}
                    alt="submission photo"
                    className="max-h-64 rounded-md border border-gray-200 object-contain"
                  />
                  <p className="mt-1 text-xs text-gray-400">{t.review.photoExpires}</p>
                </div>
              </DetailRow>
            )}
          </dl>

          <ReviewActions submissionId={submission.id} t={t.review} />
        </>
      )}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <dt className="w-36 shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  );
}
