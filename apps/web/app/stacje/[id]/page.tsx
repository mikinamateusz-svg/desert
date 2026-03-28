import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { detectLocale, translations } from '../../../lib/i18n';
import { fetchStationWithPrice } from '../../../lib/api';
import AdSlot from '../../../components/AdSlot';
import Footer from '../../../components/Footer';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const station = await fetchStationWithPrice(id);
  if (!station) return { title: 'Stacja — Litro' };
  const pb95 = station.price?.prices['PB_95'];
  return {
    title: `${station.name} — ceny paliw | Litro`,
    description: `Aktualne ceny paliw na stacji ${station.name}${station.address ? `, ${station.address}` : ''}.${pb95 ? ` PB 95: ${pb95.toFixed(2)} zł/l.` : ''}`,
  };
}

const FUEL_ORDER = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

export default async function StationDetailPage({ params }: Props) {
  const { id } = await params;
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  const t = translations[locale];
  const station = await fetchStationWithPrice(id);

  if (!station) notFound();

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const staticMapUrl = mapboxToken
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+2563eb(${station.lng},${station.lat})/${station.lng},${station.lat},15,0/600x300@2x?access_token=${mapboxToken}`
    : null;

  return (
    <>
      <div className="flex-1 max-w-5xl mx-auto w-full px-4 lg:px-6 py-6 lg:py-10">
        {/* Breadcrumb */}
        <nav className="text-sm text-gray-500 mb-4">
          <Link href="/" className="hover:text-gray-900 transition-colors">{t.nav.map}</Link>
          <span className="mx-2">›</span>
          <span className="text-gray-900">{station.name}</span>
        </nav>

        {/* Station header */}
        <div className="mb-8">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{station.name}</h1>
          {station.address && (
            <p className="mt-1 text-gray-500">{station.address}</p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Left: prices + CTAs */}
          <div className="lg:col-span-2 space-y-6">
            {/* Prices table */}
            <section>
              <h2 className="text-base font-semibold text-gray-900 mb-3">{t.station.prices}</h2>
              {station.price ? (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">
                          {t.station.fuelHeader}
                        </th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-600">
                          zł/l
                        </th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-600 hidden sm:table-cell">
                          {t.station.source}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {FUEL_ORDER.map(fuel => {
                        const price = station.price?.prices[fuel];
                        if (price === undefined) return null;
                        const range = station.price?.priceRanges?.[fuel];
                        const isEstimated = !!station.price?.estimateLabel?.[fuel];
                        const source = station.price?.sources?.[fuel];
                        return (
                          <tr key={fuel} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {t.fuelTypes[fuel] ?? fuel}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900">
                              {isEstimated && range
                                ? `~${range.low.toFixed(2)}–${range.high.toFixed(2)}`
                                : price.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-right hidden sm:table-cell">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                source === 'community'
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}>
                                {source === 'community' ? t.station.community : t.station.estimated}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {station.price.updatedAt && (
                    <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
                      {t.station.lastUpdated}: {new Date(station.price.updatedAt).toLocaleDateString(locale === 'pl' ? 'pl-PL' : locale === 'uk' ? 'uk-UA' : 'en-GB')}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400">{t.station.noPrice}</p>
              )}
            </section>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-3 rounded-xl hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {t.station.navigate}
              </a>
              <button className="flex-1 flex items-center justify-center gap-2 border border-gray-300 text-gray-700 text-sm font-semibold px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors">
                {t.station.reportPrice}
              </button>
            </div>

            {/* Mobile ad slot */}
            <AdSlot slotId="station-detail-inline" className="h-[100px] w-full lg:hidden" />
          </div>

          {/* Right: map + ad */}
          <div className="space-y-4">
            {/* Static map */}
            {staticMapUrl ? (
              <div className="rounded-xl overflow-hidden border border-gray-200 aspect-[4/3]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={staticMapUrl}
                  alt={`Mapa: ${station.name}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 aspect-[4/3] flex items-center justify-center bg-gray-50 text-sm text-gray-400">
                {station.lat.toFixed(5)}, {station.lng.toFixed(5)}
              </div>
            )}

            {/* Desktop ad slot */}
            <AdSlot slotId="station-detail-sidebar" className="h-[250px] w-full hidden lg:flex" />
          </div>
        </div>
      </div>

      <Footer locale={locale} t={t} />
    </>
  );
}
