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
        <ModuleTile title="Orders" description="Order search and fulfilment status." icon={ShoppingCartIcon} />
      </div>
    </AppShell>
  );
}
