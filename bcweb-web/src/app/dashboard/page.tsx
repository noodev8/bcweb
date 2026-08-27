'use client';
/*
=======================================================================================================================================
Page: /dashboard
=======================================================================================================================================
Purpose: The platform module menu (CLAUDE.md). A tile grid. Shopify Pricing is the one LIVE tile (-> /pricing). The rest are visible
         "coming soon" placeholders so the modular growth path is obvious (Amazon Pricing, Inventory, Orders, Analytics) — none are
         built in v1 (CLAUDE.md). Guarded by AppShell.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import ModuleTile from '@/components/ModuleTile';
import {
  CurrencyPoundIcon, ShoppingCartIcon, ArchiveBoxIcon, ChartBarIcon, BuildingStorefrontIcon, TagIcon, Squares2X2Icon,
  ArrowUpTrayIcon, UserGroupIcon, MegaphoneIcon, ClipboardDocumentListIcon, PresentationChartLineIcon,
} from '@heroicons/react/24/outline';

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Modules</h1>
        <p className="mt-1 text-sm text-slate-500">Choose a tool. More modules will appear here over time.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Segments leads — the review/attention heatmap is the "where do I start?" screen over the pricing tools. The tiles that
            follow mirror the header module bar's order (Shopify Pricing -> Amazon Pricing -> Add / Modify) so the two menus agree. */}
        <ModuleTile
          title="Segments"
          description="See which segment needs attention next, and track who worked what."
          href="/segments"
          icon={Squares2X2Icon}
          live
        />

        {/* The one live module in v1. */}
        <ModuleTile
          title="Shopify Pricing"
          description="Review demand and set Shopify prices, segment by segment."
          href="/pricing"
          icon={CurrencyPoundIcon}
          live
        />

        {/* Amazon Pricing — SKU-grain, mirrors the Shopify Pricing flow (segment -> WINNERS|LOSERS -> per-SKU drill). Applies queue
            into a one-file Seller Central upload (no live push, no review/park). See docs/amz-pricing-spec.md. */}
        <ModuleTile
          title="Amazon Pricing"
          description="Review demand and set Amazon/FBA prices, segment by segment."
          href="/amz"
          icon={BuildingStorefrontIcon}
          live
        />

        {/* Add / Modify Product — Stage 1 (search). */}
        <ModuleTile
          title="Add / Modify Product"
          description="Find an existing product to edit, or create a new one."
          href="/products"
          icon={TagIcon}
          live
        />

        {/* Amazon Order — flat "every product" report of REALISED Amazon profit (sales.profit, 30d) and profit per unit sold. Its own
            tile rather than a corner of Amazon Pricing: it's a profit report, not a pricing-decision screen. */}
        <ModuleTile
          title="Amazon Order"
          description="Every product's realised Amazon profit and profit per unit, last 30 days."
          href="/amazon-order"
          icon={ClipboardDocumentListIcon}
          live
        />

        {/* Placeholders — modular growth path, not built in v1. */}
        {/* Analytics — v1 ships the Birk Tracker view (Birkenstock core-size availability gauge). */}
        <ModuleTile
          title="Analytics"
          description="Stock and sales reporting — starting with the Birk Tracker availability gauge."
          href="/analytics"
          icon={ChartBarIcon}
          live
        />

        {/* Inventory — slice 1 live: find a style by successive Contains / Does-not-contain terms, with headline stock numbers. */}
        <ModuleTile
          title="Inventory"
          description="Find stock fast — search by title, groupid or segment."
          href="/inventory"
          icon={ArchiveBoxIcon}
          live
        />
        {/* Order Status — PROCUREMENT only: place what's been chosen, then chase what's on its way. Two stages, split on `orderdate`. */}
        <ModuleTile
          title="Order Status"
          description="Place supplier orders and chase what's on its way."
          href="/order-status"
          icon={ShoppingCartIcon}
          live
        />

        {/* Customer Orders — FULFILMENT, ported from the legacy PowerBuilder Status screen. Its own tile rather than a stage inside
            Order Status: it's the opposite direction of trade (what we owe the customer, not what we owe a supplier), it's worked
            daily against a long grid, and sharing a screen cost it the viewport space that grid needs. */}
        <ModuleTile
          title="Customer Orders"
          description="Fulfil what customers have bought — what's picked, what's short, what's waiting."
          href="/customer-orders"
          icon={UserGroupIcon}
          live
        />

        {/* Update Amazon — the data-ingest job that replaces the legacy PowerBuilder UPDATE AMAZON button. Drop the Seller Central
            reports in, see exactly what they'll do, then apply. Deliberately its own tile rather than a corner of Amazon Pricing:
            it's an ingest job, not a pricing job. See _amz-port/design/update-amazon-port.md. */}
        <ModuleTile
          title="Update Amazon"
          description="Load the Seller Central reports — sales, returns, FBA stock and fees."
          href="/update-amazon"
          icon={ArrowUpTrayIcon}
          live
        />

        {/* Brands — revenue/profit per brand over 12 or 6 months, against the window before it. Its own tile rather than a page
            inside Analytics: Analytics is a set of operational gauges read daily, this is the once-a-season "what is the shape of
            the business?" read, and it's the screen a buying decision starts from. */}
        <ModuleTile
          title="Brands"
          description="What each brand earned — revenue, profit and margin over the last year or six months."
          href="/brands"
          icon={PresentationChartLineIcon}
          live
        />

        {/* Marketing -> Social. The job is a post a day without it costing thirty minutes: queue a graphic + caption, a sweep
            publishes it to the Facebook Page at the due minute. Instagram is phase 3. The scoreboard stays GA4/UTM clicks — Meta's
            reach numbers are diagnostic only. See docs/social-module-spec.md. */}
        <ModuleTile
          title="Marketing"
          description="Queue and publish the daily Facebook post — graphic, caption, link, scheduled."
          href="/social"
          icon={MegaphoneIcon}
          live
        />
      </div>
    </AppShell>
  );
}
