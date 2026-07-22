'use client';
/*
=======================================================================================================================================
Page: /order-status  (Order Status module home)
=======================================================================================================================================
Purpose: Stage 0 — the supplier picker, split across the two halves of the order lifecycle (Chosen -> Placed -> Arrived):

  TO PLACE — chosen in the legacy order screen but not yet bought from the supplier. A work queue with a clock on it: nothing is coming
             until someone exports the CSV and places the order. Tiles lead with the ORDER VALUE, because "what will this cost" is the
             question that decides whether it goes today.
  ON ORDER — genuinely with the supplier. The original screen's job: what am I still waiting on, and what's stuck.

Both stages come from one call (GET /order-status-suppliers returns both aggregates per supplier), so the switch is instant and the
headline counts are always consistent with the tiles beneath them.

The stage lives in the URL (?stage=place) so it survives a refresh and, more importantly, carries into the supplier page — clicking a
TO PLACE tile must land on the order-build sheet, not the chase list.
=======================================================================================================================================
*/

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import OrderStageSwitch, { OrderStage } from '@/components/OrderStageSwitch';
import { getOrderStatusSuppliers, OrderStatusSupplierRow } from '@/lib/api';
import { ageClass, chosenAgeClass, money } from '@/lib/orderStatusUi';
import { useAuth } from '@/contexts/AuthContext';

// useSearchParams must sit inside a Suspense boundary for Next's build (App Router). Thin wrapper does that.
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
  const { logout } = useAuth();
  const [suppliers, setSuppliers] = useState<OrderStatusSupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<OrderStage>(searchParams.get('stage') === 'order' ? 'order' : 'place');

  useEffect(() => {
    (async () => {
      const res = await getOrderStatusSuppliers();
      if (res.success && res.data) {
        setSuppliers(res.data);
      } else {
        if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
        setError(res.error || 'Failed to load suppliers');
      }
      setLoading(false);
    })();
  }, [logout]);

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
      />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && shown.length === 0 && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {stage === 'place'
            ? 'Nothing waiting to be ordered. Styles land here once they’re chosen in the legacy order screen.'
            : 'No supplier has an order open right now.'}
        </div>
      )}

      {!loading && !error && shown.length > 0 && (
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
