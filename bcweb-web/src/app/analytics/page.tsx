'use client';
/*
=======================================================================================================================================
Page: /analytics  (Analytics module — index)
=======================================================================================================================================
Purpose: The Analytics module front door — a tile grid, matching the dashboard pattern, so the module has room to grow. v1 ships ONE
         live tile: Birk Tracker (Birkenstock core-size availability snapshot). Guarded by AppShell.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import ModuleTile from '@/components/ModuleTile';
import { ChartBarIcon, PresentationChartLineIcon, CubeIcon, SparklesIcon, ArrowsRightLeftIcon, BanknotesIcon } from '@heroicons/react/24/outline';

export default function AnalyticsPage() {
  return (
    <AppShell title="Analytics" backHref="/dashboard" backLabel="Dashboard">
      <div className="mb-6">
        <p className="text-sm text-slate-500">Sales, stock and margin reporting. More views will appear here over time.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Sales ledger — the first thing to check: recent sales + net profit, windowed & searchable, CSV export. */}
        <ModuleTile
          title="Sales"
          description="Recent sales with profit on every line (returns netted in) — net profit for Today / 7 / 30 / 90 days, filter by channel, search a product, export to Excel."
          href="/analytics/sales"
          icon={BanknotesIcon}
          live
        />

        {/* The one live analytics view in v1. */}
        <ModuleTile
          title="Birk Tracker"
          description="How many Birkenstock styles are core-size complete (38/39/40) in stock right now — the ad-push gauge."
          href="/analytics/birk-tracker"
          icon={PresentationChartLineIcon}
          live
        />

        {/* Living-catalogue gauge — how many products are commercially alive right now, per channel, tracked over time. */}
        <ModuleTile
          title="Stock Position"
          description="How many products are commercially alive right now (in stock or sold in 6 months) — Shopify styles and Amazon SKUs, tracked over time."
          href="/analytics/stock-position"
          icon={CubeIcon}
          live
        />

        {/* Catalogue-growth pulse — what's been added lately and how the new lines are selling. */}
        <ModuleTile
          title="New Additions"
          description="Shopify styles added in the last 30 days — how many, and how each new line has sold (units, revenue, profit)."
          href="/analytics/new-additions"
          icon={SparklesIcon}
          live
        />

        {/* Repricing-impact ledger — recent price moves (both channels) and whether they're shifting stock. */}
        <ModuleTile
          title="Price Changes"
          description="The latest price moves across Shopify & Amazon — before → after, who & when, and units sold since. Filter by channel or user."
          href="/analytics/price-changes"
          icon={ArrowsRightLeftIcon}
          live
        />

        {/* Placeholder — growth path. */}
        <ModuleTile title="Sales & margin" description="Revenue and gross profit reporting." icon={ChartBarIcon} />
      </div>
    </AppShell>
  );
}
