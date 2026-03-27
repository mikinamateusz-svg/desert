import { headers } from 'next/headers';
import { detectLocale, translations } from '../lib/i18n';
import { fetchStationsWithPrices } from '../lib/api';
import MapView from '../components/MapView';

// Poland geographic center
const DEFAULT_LAT = 52.0;
const DEFAULT_LNG = 19.5;
// 50km radius covers major metro areas from center; clients see stations near them on zoom
const DEFAULT_RADIUS = 50000;

export default async function PublicMapPage() {
  const headerList = await headers();
  const locale = detectLocale(headerList.get('accept-language'));
  const t = translations[locale];

  const stations = await fetchStationsWithPrices(DEFAULT_LAT, DEFAULT_LNG, DEFAULT_RADIUS);

  return (
    <>
      {/* SEO-indexable list — visible to crawlers, hidden visually (AC2) */}
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

      {/* Interactive map — Client Component receives pre-fetched data (AC1, AC3) */}
      <MapView
        stations={stations}
        defaultLat={DEFAULT_LAT}
        defaultLng={DEFAULT_LNG}
        t={t}
      />
    </>
  );
}
