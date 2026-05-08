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
    // Story 3.18 — getDetail no longer returns 409 (every status is readable
    // now that the firehose page links here). Only 404 → notFound; anything
    // else surfaces as a generic error so the operator can retry.
    if (e instanceof AdminApiError && e.status === 404) {
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
                {submission.flag_reason
                  ? (t.review.flagReason[submission.flag_reason] ?? submission.flag_reason)
                  : t.review.unknown}
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
            {/* Story 3.17 AC6 — restored_from_submission_id surfacing for
             * user_flagged_wrong rows. Null `restored_from_submission_id`
             * means the cache fell back to estimates (no prior verified
             * existed); we still render the row so admin sees the explicit
             * "no prior to restore" signal. Section omitted entirely for
             * any other flag_reason. */}
            {submission.flag_reason === 'user_flagged_wrong' && (
              <DetailRow label={t.review.restoredFromLabel}>
                {submission.restored_from_submission_id ? (
                  <Link
                    href={`/submissions/${submission.restored_from_submission_id}`}
                    className="font-mono text-xs text-gray-900 hover:underline"
                  >
                    {truncateId(submission.restored_from_submission_id)}
                  </Link>
                ) : (
                  <span className="text-sm text-gray-500">{t.review.restoredFromNone}</span>
                )}
              </DetailRow>
            )}
            {/* Story 3.20 — capture-screen telemetry. Section omitted entirely
             * when all four fields are null (pre-3.20 rows). Surfaces the four
             * diagnostic values used to tune the GPS gate timeout post-launch. */}
            {(submission.gps_acquired_at_capture != null
              || submission.gps_acquisition_ms != null
              || submission.override_used != null
              || submission.nearby_stations_count != null) && (
              <>
                <DetailRow label={t.review.captureGpsAtCaptureLabel}>
                  {submission.gps_acquired_at_capture == null
                    ? '—'
                    : submission.gps_acquired_at_capture
                      ? t.review.yes
                      : t.review.no}
                </DetailRow>
                <DetailRow label={t.review.captureGpsAcquisitionMsLabel}>
                  {submission.gps_acquisition_ms == null
                    ? '—'
                    : `${submission.gps_acquisition_ms} ms`}
                </DetailRow>
                <DetailRow label={t.review.captureOverrideUsedLabel}>
                  {submission.override_used == null
                    ? '—'
                    : submission.override_used
                      ? t.review.yes
                      : t.review.no}
                </DetailRow>
                <DetailRow label={t.review.captureNearbyStationsCountLabel}>
                  {submission.nearby_stations_count == null
                    ? '—'
                    : String(submission.nearby_stations_count)}
                </DetailRow>
              </>
            )}
          </dl>

          {/* Story 3.18 — ReviewActions (approve/reject/requeue) only valid
           * for `shadow_rejected`. The detail page is now reachable from the
           * firehose for every status; non-shadow rows render as read-only. */}
          {submission.status === 'shadow_rejected' && (
            <ReviewActions
              submissionId={submission.id}
              initialPrices={submission.price_data}
              initialStationId={submission.station_id}
              initialStationName={submission.station_name}
              t={t.review}
            />
          )}
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

/**
 * P-15 (3.17 review) — render the first 8 characters of an id, appending an
 * ellipsis only when the input is actually longer. Avoids a stray '…' on
 * shorter strings (defensive — UUIDs are always 36 chars, but the helper
 * is shared with the conflict_group_id badge which gets the same truncation).
 */
function truncateId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
