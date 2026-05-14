'use client';

import { useEffect, useState, useTransition } from 'react';
import { fetchNotificationsMetrics } from './actions';
import type { NotifPeriod, NotificationAnalyticsDto } from './types';
import type { MetricsTranslations } from '../../../lib/i18n';

interface Props {
  t: MetricsTranslations;
}

/**
 * Story 6.8 — admin Notifications & Alert Engagement tab.
 *
 * Renders four blocks:
 *   1. Permissions & opt-in (snapshot — see snapshotNote footer)
 *   2. Alert configuration breakdown (radius + drop mode)
 *   3. Reprompt conversion per trigger (photo / monthly)
 *   4. Per-alert-type engagement (sent / opened / rate)
 *   5. Daily/weekly push-grant trend table
 *
 * The period selector controls the time-filtered sections (3–5); the
 * permissions/opt-in/config block is always current state.
 */
export function NotificationsTab({ t }: Props) {
  const tn = t.notifications;
  const [period, setPeriod] = useState<NotifPeriod>('30d');
  const [data, setData] = useState<NotificationAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function load(p: NotifPeriod) {
    startTransition(async () => {
      const result = await fetchNotificationsMetrics(p);
      if (result.error) setError(result.error);
      else {
        setData(result.data ?? null);
        setError(null);
      }
    });
  }

  useEffect(() => {
    load(period);
  }, [period]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{t.tabs.notifications}</h2>
        <div className="flex gap-1">
          {(['7d', '30d', '90d', 'all'] as NotifPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              disabled={isPending}
              className={`px-3 py-1 text-xs rounded ${
                period === p
                  ? 'bg-gray-900 text-white'
                  : 'border border-gray-300 text-gray-700'
              }`}
            >
              {t.period[p]}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{t.errorGeneric}</p>}
      {!data && !error && <p className="text-sm text-gray-400">…</p>}

      {data && (
        <>
          {/* ── 1. Permissions & opt-in ───────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              {tn.sectionPermissions}
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Card label={tn.pushGrantRate} value={pctStr(data.pushGrantRate)} />
              <Card
                label={tn.pushGranted}
                value={`${data.pushGrantedUsers.toLocaleString()} / ${data.totalUsers.toLocaleString()}`}
              />
              <Card label={tn.optInPriceDrop} value={pctStr(data.optInRates.priceDrop)} />
              <Card
                label={tn.optInCommunityRise}
                value={pctStr(data.optInRates.communityRise)}
              />
              <Card
                label={tn.optInPredictiveRise}
                value={pctStr(data.optInRates.predictiveRise)}
              />
              <Card
                label={tn.optInMonthlySummary}
                value={pctStr(data.optInRates.monthlySummary)}
              />
            </div>
          </section>

          {/* ── 2. Alert configuration breakdown ─────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">{tn.sectionConfig}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-2">{tn.radiusBreakdown}</p>
                <div className="flex gap-4 text-sm">
                  <span><strong>5 km:</strong> {data.configBreakdown.radius.km5}</span>
                  <span><strong>10 km:</strong> {data.configBreakdown.radius.km10}</span>
                  <span><strong>25 km:</strong> {data.configBreakdown.radius.km25}</span>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-2">{tn.dropModeBreakdown}</p>
                <div className="flex gap-4 text-sm">
                  <span>
                    <strong>{tn.cheaperThanNow}:</strong>{' '}
                    {data.configBreakdown.dropMode.cheaperThanNow}
                  </span>
                  <span>
                    <strong>{tn.targetPrice}:</strong>{' '}
                    {data.configBreakdown.dropMode.targetPrice}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ── 3. Reprompt conversion ─────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">{tn.sectionReprompt}</h3>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="px-4 py-2">{tn.alertType}</th>
                    <th className="px-4 py-2 text-right">{tn.repromptShown}</th>
                    <th className="px-4 py-2 text-right">{tn.repromptDismissed}</th>
                    <th className="px-4 py-2 text-right">{tn.repromptGranted}</th>
                    <th className="px-4 py-2 text-right">{tn.conversionRate}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.repromptStats.map((row) => (
                    <tr key={row.trigger}>
                      <td className="px-4 py-2 text-gray-700">
                        {row.trigger === 'photo' ? tn.triggerPhoto : tn.triggerMonthly}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-gray-900">
                        {row.shown.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-gray-900">
                        {row.dismissed.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-gray-900">
                        {row.granted.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {pctStr(row.conversionRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 4. Per-alert engagement ────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">{tn.sectionEngagement}</h3>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="px-4 py-2">{tn.alertType}</th>
                    <th className="px-4 py-2 text-right">{tn.sent}</th>
                    <th className="px-4 py-2 text-right">{tn.opened}</th>
                    <th className="px-4 py-2 text-right">{tn.engagementRate}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.alertEngagement.map((row) => {
                    const label =
                      (tn.alertTypeNames as Record<string, string>)[row.alertType] ??
                      row.alertType;
                    return (
                      <tr key={row.alertType}>
                        <td className="px-4 py-2 text-gray-700">{label}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">
                          {row.sent.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">
                          {row.opened.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">
                          {pctStr(row.engagementRate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 5. Push grant trend ────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">{tn.sectionTrend}</h3>
            {data.pushGrantTrend.length === 0 ? (
              <p className="text-sm text-gray-400">{tn.noTrendData}</p>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-xs text-gray-500">
                      <th className="px-4 py-2">{tn.date}</th>
                      <th className="px-4 py-2 text-right">{tn.grants}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.pushGrantTrend.map((p) => (
                      <tr key={p.date}>
                        <td className="px-4 py-2 text-gray-700">{p.date}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">
                          {p.value.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
            {tn.snapshotNote}
          </p>
        </>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function pctStr(ratio: number): string {
  // Backend returns 0-1 with 3 decimal precision; render as percent
  // rounded to 1 decimal for legibility.
  return `${(ratio * 100).toFixed(1)}%`;
}
