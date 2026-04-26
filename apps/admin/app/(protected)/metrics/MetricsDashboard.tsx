'use client';

import { useState } from 'react';
import { PipelineHealthTab } from './PipelineHealthTab';
import { FunnelTab } from './FunnelTab';
import { ProductMetricsTab } from './ProductMetricsTab';
import { ApiCostTab } from './ApiCostTab';
import { FreshnessTab } from './FreshnessTab';
import type { MetricsTranslations } from '../../../lib/i18n';

type TabId = 'pipeline' | 'funnel' | 'product' | 'cost' | 'freshness';

interface Props {
  t: MetricsTranslations;
}

export function MetricsDashboard({ t }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('pipeline');

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {(['pipeline', 'funnel', 'product', 'cost', 'freshness'] as TabId[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.tabs[tab]}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'pipeline'  && <PipelineHealthTab t={t} />}
      {activeTab === 'funnel'    && <FunnelTab t={t} />}
      {activeTab === 'product'   && <ProductMetricsTab t={t} />}
      {activeTab === 'cost'      && <ApiCostTab t={t} />}
      {activeTab === 'freshness' && <FreshnessTab t={t} />}
    </div>
  );
}
