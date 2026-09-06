'use client';
/*
=======================================================================================================================================
Page: /analytics  (Reports module — index)
=======================================================================================================================================
Purpose: The reporting front door — a tile grid matching the dashboard pattern. Presented as REPORTS (owner, 2026-08-27); the route
         stays /analytics so every existing link, bookmark and deep link keeps working.

         ABSORBED BRANDS (owner, 2026-08-27). It was a top-level dashboard tile, which made two separate doors onto the same act —
         going somewhere to read a number — and put it on the dashboard as a peer of screens worked every day. It keeps its own
         route (/brands) and is unchanged; only the way in moved. Guarded by AppShell.

         AMAZON ORDER CAME BACK OUT (owner, 2026-09-03). It was absorbed here in 2026-08 as the profit report it was then, and it
         has since grown into a working screen: a rate fill, an Order and a Pick basket, and two DB writes on the button. That is
         no longer "go and read a number", so it is a dashboard tile again under STOCK & PRODUCTS, beside the other procurement
         screens. Route unchanged — only the way in moved back.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import ModuleTile from '@/components/ModuleTile';
import {
  PresentationChartLineIcon, CubeIcon, SparklesIcon, ArrowsRightLeftIcon, BanknotesIcon, ChartPieIcon,
  ScaleIcon, SunIcon,
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

        {/* Ad Efficiency — the monthly counterweight to the Sales report. Sales says profit is up, which through 2026 was true every
            month while the share of it surviving Google ad spend fell from 57% to 8%. Nothing else on the platform is shaped to show
            that: the Google Ads screen works a 30-day window, far too short for a slide this slow. Sits next to Price Changes as the
            other "is the thing we are doing actually working?" read. */}
        <ModuleTile
          title="Ad Efficiency"
          description="How much of each month's Shopify profit survived Google ad spend — 13 months of units, profit, spend, kept per unit and the share kept."
          href="/analytics/ad-efficiency"
          icon={ScaleIcon}
          live
        />

        {/* Ad Payback — the DAILY half of the same question Ad Efficiency asks yearly, which is why the two sit together: "is
            Google paying for itself?" over 13 months and whole-book, then on one day and per style. Kept standalone rather than
            folded in either direction (owner, 2026-09-06). Not into Ad Efficiency, because that is a rarely-opened strategic read
            and this is a morning check — the same cadence argument that pulled Amazon Order back out of Reports in Sep 2026. Not
            into Sales, because Sales is line-grain and all-channel, so a Kept column would repeat on a multi-line style and be
            blank on every Amazon row. And not a Today button on the Google Ads screen, which is anchored to the last COMPLETE day
            of ad data — a to-today panel beside it would undo the anchor it depends on. */}
        <ModuleTile
          title="Ad Payback"
          description="What sold on one day and whether each of those styles is paying for its Google ads — the day's profit against its trailing 30-day position. Any day, back a year."
          href="/analytics/ad-payback"
          icon={SunIcon}
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

      </div>
    </AppShell>
  );
}
