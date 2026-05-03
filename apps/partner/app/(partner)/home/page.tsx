import Link from 'next/link';
import { detectLocale, getTranslations, type Translations } from '../../../lib/i18n';
import { partnerFetch, PartnerApiError } from '../../../lib/partner-api';
import type { ClaimStatusValue, MyClaim } from '../../../lib/types';

const STATUS_BADGE: Record<ClaimStatusValue, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  AWAITING_DOCS: 'bg-blue-50 text-blue-700',
  APPROVED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
};

function statusLabel(status: ClaimStatusValue, t: Translations['home']): string {
  switch (status) {
    case 'PENDING': return t.statusPending;
    case 'AWAITING_DOCS': return t.statusAwaitingDocs;
    case 'APPROVED': return t.statusApproved;
    case 'REJECTED': return t.statusRejected;
  }
}

export default async function HomePage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);

  let claims: MyClaim[] = [];
  let error: string | null = null;
  try {
    claims = await partnerFetch<MyClaim[]>('/v1/me/station-claims');
  } catch (e) {
    error = e instanceof PartnerApiError ? e.message : 'Failed to load.';
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t.home.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{t.home.subtitle}</p>
        </div>
        <Link
          href="/claim"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
        >
          {t.home.newClaimCta}
        </Link>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          {t.home.yourClaimsTitle}
        </h2>

        {claims.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-white p-6 text-center">
            <p className="text-sm text-gray-500">{t.home.noClaimsYet}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {claims.map((claim) => (
              <div
                key={claim.id}
                className="rounded-md border border-gray-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">
                      {claim.station.name}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {claim.station.address ?? '—'}
                      {claim.station.brand ? ` · ${claim.station.brand}` : ''}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[claim.status]} whitespace-nowrap`}
                  >
                    {statusLabel(claim.status, t.home)}
                  </span>
                </div>

                <div className="mt-3 text-xs text-gray-500">
                  {t.home.submittedLabel}: {new Date(claim.created_at).toLocaleString()}
                </div>

                {claim.rejection_reason && (
                  <div className="mt-3 rounded-md bg-red-50 p-3">
                    <div className="text-xs font-medium text-red-800">
                      {t.home.rejectionLabel}
                    </div>
                    <div className="text-sm text-red-700 whitespace-pre-wrap mt-1">
                      {claim.rejection_reason}
                    </div>
                  </div>
                )}

                {claim.reviewer_notes && claim.status !== 'REJECTED' && (
                  <div className="mt-3 rounded-md bg-blue-50 p-3">
                    <div className="text-xs font-medium text-blue-800">
                      {t.home.reviewerNotesLabel}
                    </div>
                    <div className="text-sm text-blue-700 whitespace-pre-wrap mt-1">
                      {claim.reviewer_notes}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex gap-3 text-sm">
                  {claim.status === 'APPROVED' && (
                    <Link
                      href={`/station/${claim.station.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {t.home.manageStation}
                    </Link>
                  )}
                  {claim.status === 'REJECTED' && (
                    <Link
                      href={`/claim/${claim.station.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {t.home.retrySubmit}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
