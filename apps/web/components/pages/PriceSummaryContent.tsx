import type { Translations } from '../../lib/i18n';

interface SummaryItem {
  signalType: string;
  value: number;
  pctChange: number | null;
  recordedAt: string;
}

interface SummaryResponse {
  signals: SummaryItem[];
}

const SIGNAL_LABELS: Record<string, string> = {
  orlen_rack_pb95: 'PB 95',
  orlen_rack_on:   'ON (Diesel)',
  orlen_rack_lpg:  'LPG',
};

function formatPctChange(pctChange: number | null): string {
  if (pctChange === null) return '—';
  const sign = pctChange >= 0 ? '+' : '';
  return `${sign}${(pctChange * 100).toFixed(1)}%`;
}

async function fetchSummary(): Promise<SummaryResponse> {
  const apiUrl = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${apiUrl}/v1/market-signal/summary`, { next: { revalidate: 3600 } });
    if (!res.ok) return { signals: [] };
    return res.json() as Promise<SummaryResponse>;
  } catch {
    return { signals: [] };
  }
}

export default async function PriceSummaryContent({ t }: { t: Translations }) {
  const { signals } = await fetchSummary();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{t.news.priceSummaryTitle}</h1>
      <p className="text-sm text-gray-500 mb-6">{t.news.priceSummarySubtitle}</p>

      {signals.length === 0 ? (
        <p className="text-gray-500">{t.news.noData}</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 font-medium">Paliwo</th>
              <th className="text-right py-2 pr-4 font-medium">PLN/litr</th>
              <th className="text-right py-2 font-medium">{t.news.weekChange}</th>
            </tr>
          </thead>
          <tbody>
            {signals.map(s => (
              <tr key={s.signalType} className="border-b last:border-0">
                <td className="py-2 pr-4">{SIGNAL_LABELS[s.signalType] ?? s.signalType}</td>
                <td className="py-2 pr-4 text-right font-mono">{s.value.toFixed(4)}</td>
                <td className={`py-2 text-right font-mono ${
                  s.pctChange === null ? 'text-gray-400' :
                  s.pctChange >= 0    ? 'text-red-600'  : 'text-green-600'
                }`}>
                  {formatPctChange(s.pctChange)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
