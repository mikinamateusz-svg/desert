import Link from 'next/link';
import { detectLocale, getTranslations } from '../../../../lib/i18n';
import { adminFetch, AdminApiError } from '../../../../lib/admin-api';
import type { StationDetail, StationPriceRow } from '../../../../lib/types';
import { StationActions } from './StationActions';

function getSourceBadgeClass(source: string): string {
  switch (source) {
    case 'community':
      return 'bg-green-100 text-green-800';
    case 'admin_override':
      return 'bg-amber-100 text-amber-800';
    case 'seeded':
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export default async function StationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const { id } = await params;

  let station: StationDetail | null = null;
  let error: string | null = null;

  try {
    station = await adminFetch<StationDetail>(`/v1/admin/stations/${id}`);
  } catch (e) {
    error = e instanceof AdminApiError ? e.message : t.stations.errorGeneric;
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/stations" className="text-sm text-blue-600 hover:underline">
          ← Back to stations
        </Link>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {station && (
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h1 className="text-2xl font-semibold text-gray-900">{station.name}</h1>
            {station.address && (
              <p className="text-sm text-gray-500 mt-1">{station.address}</p>
            )}
            {station.brand && (
              <p className="text-xs text-gray-400 mt-1">{station.brand}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">ID: {station.id}</p>
          </div>

          {/* Current prices */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.stations.pricesTitle}</h2>
            {station.prices.length === 0 ? (
              <p className="text-sm text-gray-400">{t.stations.noResults}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">{t.stations.fuelTypeColumn}</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">{t.stations.priceColumn}</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">{t.stations.sourceColumn}</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">{t.stations.lastUpdatedColumn}</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {station.prices.map((row: StationPriceRow) => (
                      <tr key={row.fuel_type} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium text-gray-900">{row.fuel_type}</td>
                        <td className="px-4 py-2 text-gray-700">{row.price.toFixed(3)}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getSourceBadgeClass(row.source)}`}
                          >
                            {t.stations.sources[row.source as keyof typeof t.stations.sources] ?? row.source}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">
                          {new Date(row.recorded_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Override and refresh actions */}
          <StationActions stationId={station.id} t={t.stations} />
        </div>
      )}
    </div>
  );
}
