'use client';
/*
=======================================================================================================================================
Page: /analytics  (Reports module — index)
=======================================================================================================================================
Purpose: The reporting front door — a tile grid matching the dashboard pattern. Presented as REPORTS (owner, 2026-08-27); the route
         stays /analytics so every existing link, bookmark and deep link keeps working.

         ABSORBED BRANDS AND AMAZON ORDER (owner, 2026-08-27). Both were top-level dashboard tiles, which made three separate doors
         onto the same act — going somewhere to read a number — and put them on the dashboard as peers of screens worked every day.
         They keep their own routes (/brands, /amazon-order) and are unchanged; only the way in moved. Guarded by AppShell.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import ModuleTile from '@/components/ModuleTile';
import {
  PresentationChartLineIcon, CubeIcon, SparklesIcon, ArrowsRightLeftIcon, BanknotesIcon, ChartPieIcon, ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline';

export default function AnalyticsPage() {
  return (
    <AppShell title="Reports" backHref="/dashboard" backLabel="Dashboard">
      <div className="mb-6">
        <p className="text-sm text-slate-500">Sales, stock, margin and brand reporting. More views will appear here over time.</p>
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

        {/* Brands — moved in from the dashboard (owner, 2026-08-27). The once-a-season "what is the shape of the business?" read, and
            the screen a buying decision starts from. It sits last of the recurring reports rather than first: it's the least often
            opened of them, and it answers a different question (which brands to back) than the daily operational gauges above. */}
        <ModuleTile
          title="Brands"
          description="What each brand earned — revenue, profit and margin over the last year or six months, against the window before it."
          href="/brands"
          icon={ChartPieIcon}
          live
        />

        {/* Amazon Order — moved in from the dashboard (owner, 2026-08-27). A flat every-product report of REALISED Amazon profit
            (sales.profit, 30d) and profit per unit. It was always a profit report rather than a pricing screen, which is why it never
            belonged inside Amazon Pricing — but that made it a top-level tile by default, and it belongs here. */}
        <ModuleTile
          title="Amazon Order"
          description="Every product's realised Amazon profit and profit per unit, last 30 days."
          href="/amazon-order"
          icon={ClipboardDocumentListIcon}
          live
        />
      </div>
    </AppShell>
  );
}
