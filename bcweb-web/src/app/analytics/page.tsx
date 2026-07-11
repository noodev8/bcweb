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
import { ChartBarIcon, PresentationChartLineIcon, CubeIcon } from '@heroicons/react/24/outline';

export default function AnalyticsPage() {
  return (
    <AppShell title="Analytics" backHref="/dashboard" backLabel="Dashboard">
      <div className="mb-6">
        <p className="text-sm text-slate-500">Sales, stock and margin reporting. More views will appear here over time.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

        {/* Placeholder — growth path. */}
        <ModuleTile title="Sales & margin" description="Revenue and gross profit reporting." icon={ChartBarIcon} />
      </div>
    </AppShell>
  );
}
