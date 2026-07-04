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
  CurrencyPoundIcon, ShoppingCartIcon, ArchiveBoxIcon, ChartBarIcon, BuildingStorefrontIcon,
} from '@heroicons/react/24/outline';

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Modules</h1>
        <p className="mt-1 text-sm text-slate-500">Choose a tool. More modules will appear here over time.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* The one live module in v1. */}
        <ModuleTile
          title="Shopify Pricing"
          description="Review demand and set Shopify prices, segment by segment."
          href="/pricing"
          icon={CurrencyPoundIcon}
          live
        />

        {/* Placeholders — modular growth path, not built in v1. */}
        <ModuleTile title="Amazon Pricing" description="Pricing for the Amazon / FBA channel." icon={BuildingStorefrontIcon} />
        <ModuleTile title="Inventory" description="Stock levels, allocation and incoming." icon={ArchiveBoxIcon} />
        <ModuleTile title="Orders" description="Order search and fulfilment status." icon={ShoppingCartIcon} />
        <ModuleTile title="Analytics" description="Sales and margin reporting." icon={ChartBarIcon} />
      </div>
    </AppShell>
  );
}
