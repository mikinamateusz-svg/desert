import Link from 'next/link';
import { detectLocale, getTranslations } from '../../../lib/i18n';
import { partnerFetchPublic, PartnerApiError } from '../../../lib/partner-api';
import type { PartnerStation } from '../../../lib/types';

interface SearchParams {
  q?: string;
}

export default async function ClaimSearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const params = await searchParams;
  const q = params.q?.trim() ?? '';

  let results: PartnerStation[] = [];
  let error: string | null = null;
  if (q.length >= 2) {
    try {
      results = await partnerFetchPublic<PartnerStation[]>(
        `/v1/stations/search?q=${encodeURIComponent(q)}`,
      );
    } catch (e) {
      error = e instanceof PartnerApiError ? e.message : 'Failed to search.';
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t.claim.searchTitle}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.claim.searchSubtitle}</p>
      </div>

      <form method="GET" className="flex gap-2">
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder={t.claim.searchPlaceholder}
          minLength={2}
          required
          className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
        >
          {t.claim.searchButton}
        </button>
      </form>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {q.length >= 2 && results.length === 0 && !error && (
        <div className="rounded-md border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">{t.claim.searchEmpty}</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((s) => (
            <Link
              key={s.id}
              href={`/claim/${s.id}`}
              className="block rounded-md border border-gray-200 bg-white p-4 hover:bg-gray-50"
            >
              <div className="font-medium text-gray-900">{s.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                {s.address ?? '—'}
                {s.brand ? ` · ${s.brand}` : ''}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
