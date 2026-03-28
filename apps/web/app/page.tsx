import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../lib/i18n';
import { fetchStationsWithPrices } from '../lib/api';
import MapView from '../components/MapView';
import MapSidebar from '../components/MapSidebar';

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
    <div className="flex flex-row flex-1" style={{ height: 'calc(100dvh - 64px)' }}>
      {/* Map — fills all space on mobile, flex-1 on desktop */}
      <div className="flex-1 relative min-w-0">
        <ul className="sr-only">
          {stations.map(s => {
            const pb95 = s.price?.prices['PB_95'];
            return (
              <li key={s.id}>
                {s.name}
                {s.address ? `, ${s.address}` : ''}
                {pb95 !== undefined ? ` — PB 95: ${pb95.toFixed(2)} zł/l` : ''}
              </li>
            );
          })}
        </ul>
        <MapView stations={stations} defaultLat={DEFAULT_LAT} defaultLng={DEFAULT_LNG} t={t} />
      </div>

      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden lg:flex flex-col w-80 xl:w-96 border-l border-gray-200 bg-white overflow-y-auto flex-shrink-0">
        <MapSidebar stations={stations} t={t} locale={locale} />
      </aside>
    </div>
  );
}
