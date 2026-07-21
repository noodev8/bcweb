'use client';
/*
=======================================================================================================================================
Page: /order-status  (Order Status module home)
=======================================================================================================================================
Purpose: Stage 0 — "which suppliers currently have an order open" (CLAUDE.md Order Status module). One tile per supplier with an
         outstanding orderstatus row (local=2 or amazon=3, arrived=0). The oldest-waiting-days figure is surfaced right here, colour
         flagged, so a stuck supplier is visible before drilling in — mirrors the Pricing segment picker's role as the entry screen.
=======================================================================================================================================
*/

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getOrderStatusSuppliers, OrderStatusSupplierRow } from '@/lib/api';
import { ageClass } from '@/lib/orderStatusUi';
import { useAuth } from '@/contexts/AuthContext';

export default function OrderStatusHome() {
  const router = useRouter();
  const { logout } = useAuth();
  const [suppliers, setSuppliers] = useState<OrderStatusSupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <AppShell title="Order Status" backHref="/dashboard" backLabel="Dashboard">
      <p className="mb-6 text-sm text-slate-500">
        Suppliers with an order still open (not fully arrived). Pick one to see the batches and manage them.
      </p>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && suppliers.length === 0 && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">No suppliers have an order open right now.</div>
      )}

      {!loading && !error && suppliers.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => (
            <button
              key={s.supplier}
              onClick={() => router.push(`/order-status/${encodeURIComponent(s.supplier)}`)}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-brand-500"
            >
              <span>
                <span className="block text-sm font-medium text-slate-800">{s.supplier}</span>
                <span className="block text-xs text-slate-400">
                  {s.open_batches} batch{s.open_batches === 1 ? '' : 'es'} · {s.open_units} unit{s.open_units === 1 ? '' : 's'} waiting
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className={'rounded px-2 py-0.5 text-xs font-medium ' + ageClass(s.oldest_days)}>
                  {s.oldest_days}d
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
