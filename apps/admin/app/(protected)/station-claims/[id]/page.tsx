import Link from 'next/link';
import { notFound } from 'next/navigation';
import { detectLocale, getTranslations } from '../../../../lib/i18n';
import { adminFetch, AdminApiError } from '../../../../lib/admin-api';
import type { ClaimStatusValue, StationClaimRow } from '../../../../lib/types';
import { ActionPanel } from './ActionPanel';

const STATUS_BADGE: Record<ClaimStatusValue, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  AWAITING_DOCS: 'bg-blue-50 text-blue-700',
  APPROVED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function StationClaimDetailPage({ params }: PageProps) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const { id } = await params;

  let claim: StationClaimRow | null = null;
  let error: string | null = null;
  try {
    claim = await adminFetch<StationClaimRow>(`/v1/admin/station-claims/${id}`);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) {
      notFound();
    }
    // P7 (CR fix): don't render the raw API error verbatim — it can
    // include stack hints / validation guts. Map to user-safe categories.
    if (e instanceof AdminApiError) {
      console.error('[admin claim detail] AdminApiError', e.status, e.message);
      error = e.status >= 500 ? 'API error — please retry.' : 'Failed to load claim.';
    } else {
      error = 'Failed to load claim.';
    }
  }

  if (error || !claim) {
    return (
      <div>
        <Link href="/station-claims" className="text-blue-600 hover:underline text-sm">
          {t.stationClaims.backToList}
        </Link>
        <div className="mt-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  // CEIDG / KRS quick-lookup links — opens the public Polish business
  // registries pre-filled with the station address, so admins can verify
  // the registered owner matches the applicant's name (per the design
  // discussion, this is the manual cross-check that complements the
  // phone callback).
  const addressForLookup = claim.station.address?.trim() ?? '';
  const ceidgUrl = `https://aplikacja.ceidg.gov.pl/CEIDG.CMS.ENGINE/?D;${encodeURIComponent(addressForLookup)}`;
  const krsUrl = `https://wyszukiwarka-krs.ms.gov.pl/?p=${encodeURIComponent(addressForLookup)}`;

  // Auto-approved claims have verification_method_used = DOMAIN_MATCH AND
  // a non-null reviewed_at AND no reviewer (reviewed_by_user_id is null
  // for the automated path). Surface that distinction so admins know
  // the claim wasn't human-verified.
  const wasAutoApproved =
    claim.status === 'APPROVED' &&
    claim.verification_method_used === 'DOMAIN_MATCH' &&
    claim.reviewed_by_user_id === null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/station-claims" className="text-blue-600 hover:underline text-sm">
          {t.stationClaims.backToList}
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">{claim.station.name}</h1>
        <span
          className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium ${STATUS_BADGE[claim.status]}`}
        >
          {claim.status}
        </span>
      </div>

      {wasAutoApproved && (
        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-700">
          {t.stationClaims.autoApproveNote}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Applicant ────────────────────────────────────────────── */}
        <section className="bg-white border border-gray-200 rounded-md p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t.stationClaims.sectionApplicant}</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Name</dt>
              <dd className="text-gray-900">{claim.user.display_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Email</dt>
              <dd className="text-gray-900">
                {claim.user.email ? (
                  <a href={`mailto:${claim.user.email}`} className="text-blue-600 hover:underline">
                    {claim.user.email}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Role</dt>
              <dd className="text-gray-900">{claim.user.role}</dd>
            </div>
          </dl>
        </section>

        {/* ── Station ──────────────────────────────────────────────── */}
        <section className="bg-white border border-gray-200 rounded-md p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t.stationClaims.sectionStation}</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Name</dt>
              <dd className="text-gray-900">{claim.station.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Address</dt>
              <dd className="text-gray-900">{claim.station.address ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Brand</dt>
              <dd className="text-gray-900">{claim.station.brand ?? '—'}</dd>
            </div>
            {claim.station.voivodeship && (
              <div>
                <dt className="text-xs text-gray-500">Voivodeship</dt>
                <dd className="text-gray-900">{claim.station.voivodeship}</dd>
              </div>
            )}
          </dl>
          {addressForLookup && (
            <div className="mt-4 flex flex-col gap-2 text-xs">
              <a
                href={ceidgUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {t.stationClaims.lookupCeidg} →
              </a>
              <a
                href={krsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {t.stationClaims.lookupKrs} →
              </a>
            </div>
          )}
        </section>
      </div>

      {/* ── Applicant notes ──────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-md p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          {t.stationClaims.sectionApplicantNotes}
        </h2>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">
          {claim.applicant_notes?.trim() || (
            <span className="text-gray-400 italic">{t.stationClaims.noteNoApplicantNotes}</span>
          )}
        </p>
      </section>

      {/* ── Reviewer notes / rejection (when present) ────────────── */}
      {claim.reviewer_notes && (
        <section className="bg-white border border-gray-200 rounded-md p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t.stationClaims.sectionReviewerNotes}</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{claim.reviewer_notes}</p>
        </section>
      )}

      {claim.rejection_reason && (
        <section className="bg-red-50 border border-red-200 rounded-md p-4">
          <h2 className="text-sm font-semibold text-red-800 mb-3">{t.stationClaims.sectionRejection}</h2>
          <p className="text-sm text-red-700 whitespace-pre-wrap">{claim.rejection_reason}</p>
        </section>
      )}

      {/* ── Verification evidence (when present) ─────────────────── */}
      {claim.verification_evidence !== null && claim.verification_evidence !== undefined && (
        <section className="bg-white border border-gray-200 rounded-md p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t.stationClaims.sectionEvidence}</h2>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded">
            {JSON.stringify(claim.verification_evidence, null, 2)}
          </pre>
        </section>
      )}

      {/* ── Timeline ─────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-md p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">{t.stationClaims.sectionTimeline}</h2>
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-gray-500 w-32">{t.stationClaims.timelineCreated}</dt>
            <dd className="text-gray-900">{new Date(claim.created_at).toLocaleString()}</dd>
          </div>
          {claim.reviewed_at && (
            <div className="flex gap-2">
              <dt className="text-gray-500 w-32">{t.stationClaims.timelineReviewed}</dt>
              <dd className="text-gray-900">{new Date(claim.reviewed_at).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* ── Actions ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">{t.stationClaims.sectionActions}</h2>
        <ActionPanel claimId={claim.id} status={claim.status} t={t.stationClaims} />
      </section>
    </div>
  );
}
