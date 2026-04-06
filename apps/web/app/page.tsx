import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../lib/i18n';
import { fetchStationsWithPrices } from '../lib/api';
import MapContainer from '../components/MapContainer';
import AdSlot from '../components/AdSlot';

const DEFAULT_LAT = 52.0;
const DEFAULT_LNG = 19.5;
const DEFAULT_RADIUS = 50000;

export default async function PublicMapPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  const t = translations[locale];
  const stations = await fetchStationsWithPrices(DEFAULT_LAT, DEFAULT_LNG, DEFAULT_RADIUS);

  return (
    <div className="flex flex-col flex-1" style={{ height: 'calc(100dvh - 64px)' }}>

      {/* ── Mobile ad banner (<lg) ── */}
      <div className="flex lg:hidden items-center justify-center py-1.5 px-3 bg-white border-b border-gray-100 flex-shrink-0">
        <AdSlot slotId="mobile-top" className="h-[60px] w-full" />
      </div>

      {/* ── Medium leaderboard banner (lg → 2xl) ── */}
      <div className="hidden lg:flex 2xl:hidden items-center justify-center py-2 bg-white border-b border-gray-100 flex-shrink-0">
        <AdSlot slotId="leaderboard-top" className="h-[90px] w-[728px] max-w-full" />
      </div>

      {/* ── Main content row ── */}
      <div className="flex flex-row flex-1 min-h-0">

        {/* Left skyscraper ad column — 2xl+ only */}
        <aside className="hidden 2xl:flex flex-col items-center pt-6 w-44 border-r border-gray-200 bg-white flex-shrink-0">
          <AdSlot slotId="left-skyscraper" className="w-[160px] h-[600px]" />
        </aside>

        {/* Map + sidebar (client component owns shared selection state) */}
        <MapContainer
          stations={stations}
          defaultLat={DEFAULT_LAT}
          defaultLng={DEFAULT_LNG}
          t={t}
          locale={locale}
        />

      </div>
    </div>
  );
}
