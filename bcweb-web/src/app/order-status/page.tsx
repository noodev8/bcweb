'use client';
/*
=======================================================================================================================================
Page: /order-status  (Order Status module home)
=======================================================================================================================================
Purpose: The module home. Three stages, two of which are a supplier picker and one of which is a list in its own right.

PROCUREMENT — what we're buying, split across the two halves of the order lifecycle (Chosen -> Placed -> Arrived):

  TO PLACE — chosen in the legacy order screen but not yet bought from the supplier. A work queue with a clock on it: nothing is coming
             until someone exports the CSV and places the order. Tiles lead with the ORDER VALUE, because "what will this cost" is the
             question that decides whether it goes today.
  ON ORDER — genuinely with the supplier. The original screen's job: what am I still waiting on, and what's stuck.

Both come from one call (GET /order-status-suppliers returns both aggregates per supplier), so the switch is instant and the headline
counts are always consistent with the tiles beneath them.

FULFILMENT — the other direction entirely:

  CUSTOMERS — what customers have bought and whether we can send it, ported from the legacy PowerBuilder Status screen. It has NO
              supplier dimension, so it renders its grid inline here instead of routing on to a picker. That asymmetry is deliberate:
              inventing a per-supplier split for customer orders would add a click that answers no question anybody asks.

CUSTOMERS is the DEFAULT stage and sits leftmost — it's worked daily, so the module opens on it rather than making the everyday job
the one you have to click for. The stage still lives in the URL (?stage=place) so it survives a refresh and, more importantly, carries
into the supplier page: clicking a TO PLACE tile must land on the order-build sheet, not the chase list. An explicit ?stage= always
wins over the default, so existing links and bookmarks into the procurement stages keep working.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import CustomerOrderList from '@/components/CustomerOrderList';
import OrderStageSwitch, { OrderStage } from '@/components/OrderStageSwitch';
import { getCustomerOrders, getOrderStatusSuppliers, OrderStatusSupplierRow } from '@/lib/api';
import {
  ageClass, chosenAgeClass, customerAttentionCount, CUSTOMER_ORDERS_KEY, money,
} from '@/lib/orderStatusUi';
import { useApiQuery } from '@/lib/useApiQuery';

// useSearchParams must sit inside a Suspense boundary for Next's build (App Router). Thin wrapper does that.
// Stable "nothing loaded yet" identity, so derived memos aren't invalidated on every render.
const NO_ROWS: OrderStatusSupplierRow[] = [];

export default function OrderStatusHome() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <OrderStatusHomeContent />
    </Suspense>
  );
}

function OrderStatusHomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // CUSTOMERS is the default landing stage (owner): it's the daily job, so opening the module should already be showing it. The two
  // procurement stages are reached by an explicit click, or by a ?stage= link — which is why the param is still honoured first, so
  // an existing /order-status?stage=place bookmark keeps working.
  const stageParam = searchParams.get('stage');
  const [stage, setStage] = useState<OrderStage>(
    stageParam === 'order' ? 'order' : stageParam === 'place' ? 'place' : 'customer'
  );

  // The SAME SWR key CustomerOrderList uses, so the stage switch can headline the fulfilment numbers. SWR dedupes by key: this is one
  // request shared between the two components, not a second fetch, and an action taken in the list updates these counts for free.
  // (Deliberately not a callback prop from the child — that meant setting this component's state during the child's render, which
  // React rejects.) Loads on all three stages, which is the point: the "N to sort" badge has to be visible from the other two.
  const { data: customerData } = useApiQuery(CUSTOMER_ORDERS_KEY, () => getCustomerOrders());
  const customerCounts = useMemo(() => (customerData
    ? { units: customerData.lines.length, attention: customerAttentionCount(customerData.lines) }
    : null), [customerData]);

  // Single on-mount fetch. UNAUTHORIZED -> logout is handled inside useApiQuery, so it isn't repeated here (API-RULES:
  // the caller decides, and for this whole module the decision is the same one).
  const { data, error: loadError, isLoading: loading } = useApiQuery(
    ['order-suppliers'],
    () => getOrderStatusSuppliers(),
  );
  const suppliers: OrderStatusSupplierRow[] = data ?? NO_ROWS;
  const error = loadError?.message ?? null;

  const totals = useMemo(() => ({
    toPlaceUnits: suppliers.reduce((n, s) => n + s.to_place_units, 0),
    toPlaceCost: suppliers.reduce((n, s) => n + (s.to_place_cost || 0), 0),
    onOrderUnits: suppliers.reduce((n, s) => n + s.on_order_units, 0),
  }), [suppliers]);

  // Each stage wants a different order: the queue is worked oldest-first (what should have gone out already), and so is the chase
  // list (what's most overdue). Suppliers with nothing at this stage drop out entirely.
  const shown = useMemo(() => {
    const rows = suppliers.filter((s) => (stage === 'place' ? s.to_place_units > 0 : s.on_order_units > 0));
    return rows.sort((a, b) => (stage === 'place'
      ? b.to_place_oldest_days - a.to_place_oldest_days || b.to_place_units - a.to_place_units
      : b.on_order_oldest_days - a.on_order_oldest_days || a.supplier.localeCompare(b.supplier)));
  }, [suppliers, stage]);

  function pick(stageNext: OrderStage) {
    setStage(stageNext);
    router.replace(`/order-status?stage=${stageNext}`, { scroll: false });
  }

  return (
    <AppShell title="Order Status" backHref="/dashboard" backLabel="Dashboard">
      <OrderStageSwitch
        stage={stage}
        onChange={pick}
        toPlaceUnits={loading ? null : totals.toPlaceUnits}
        toPlaceCost={loading ? null : totals.toPlaceCost}
        onOrderUnits={loading ? null : totals.onOrderUnits}
        customerUnits={customerCounts?.units ?? null}
        customerAttention={customerCounts?.attention ?? null}
      />

      {/* The fulfilment stage owns its own data and its own loading/error states — the supplier query below is procurement-only and
          says nothing about it, so it is rendered instead of, not alongside, the picker. */}
      {stage === 'customer' && <CustomerOrderList />}

      {stage !== 'customer' && loading && <p className="text-sm text-slate-400">Loading…</p>}
      {stage !== 'customer' && error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {stage !== 'customer' && !loading && !error && shown.length === 0 && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {stage === 'place'
            ? 'Nothing waiting to be ordered. Styles land here once they’re chosen in the legacy order screen.'
            : 'No supplier has an order open right now.'}
        </div>
      )}

      {stage !== 'customer' && !loading && !error && shown.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => (
            <button
              key={s.supplier}
              onClick={() => router.push(`/order-status/${encodeURIComponent(s.supplier)}?stage=${stage}`)}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-brand-500"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800">{s.supplier}</span>
                <span className="block text-xs text-slate-400">
                  {stage === 'place' ? (
                    <>
                      {s.to_place_units} unit{s.to_place_units === 1 ? '' : 's'} · {s.to_place_styles} style{s.to_place_styles === 1 ? '' : 's'}
                      {s.to_place_nocost > 0 && <span className="text-amber-600"> · {s.to_place_nocost} unpriced</span>}
                    </>
                  ) : (
                    <>
                      {s.on_order_batches} batch{s.on_order_batches === 1 ? '' : 'es'} · {s.on_order_units} unit{s.on_order_units === 1 ? '' : 's'} waiting
                    </>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {/* In the queue, the money leads — it's the decision. In the chase list, the age leads. */}
                {stage === 'place' && (
                  <span className="text-sm font-semibold text-slate-800">{money(s.to_place_cost)}</span>
                )}
                <span className={'rounded px-2 py-0.5 text-xs font-medium ' +
                  (stage === 'place' ? chosenAgeClass(s.to_place_oldest_days) : ageClass(s.on_order_oldest_days))}>
                  {stage === 'place' ? s.to_place_oldest_days : s.on_order_oldest_days}d
                </span>
                <ChevronRightIcon className="h-4 w-4 text-slate-300" />
              </span>
            </button>
          ))}
        </div>
      )}
    </AppShell>
  );
}
