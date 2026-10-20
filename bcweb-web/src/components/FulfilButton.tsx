'use client';
/*
=======================================================================================================================================
Component: FulfilButton  ("Fulfil", Customer Orders header bar)
=======================================================================================================================================
Purpose: Marks every PACKED order fulfilled on Shopify — Royal Mail ones with their Click & Drop tracking number, FBA ones with the
         Amazon courier — and Shopify emails each customer (docs/fulfil-plan.md). List-wide, like Manifest beside it.

SPLIT FROM MANIFEST FOR NOW (owner, 2026-10-20): its own button while it's being tested, and each order box has its own Fulfil too
(CustomerOrderList → OrderBox) so a test can be one order at a time. The plan's one press — manifest, then fulfil — comes later.

Behind an inline confirm: it emails real customers. After anything is fulfilled it runs Update orders, which sees those orders
fulfilled on Shopify and archives them off the list.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ArrowPathIcon, CheckBadgeIcon } from '@heroicons/react/24/outline';
import { fulfilCustomerOrders, type CustomerFulfilResult } from '@/lib/api';
import { useUpdateOrders } from '@/components/UpdateOrdersButton';
import type { ManifestResult } from '@/components/ManifestButton';

// One line for the outcome — shared with the per-order Fulfil button.
export function fulfilSummary(results: CustomerFulfilResult[]): ManifestResult {
  if (!results.length) return { ok: true, text: 'Nothing packed to fulfil' };
  const by = (o: CustomerFulfilResult['outcome']) => results.filter((r) => r.outcome === o);
  const done = by('fulfilled');
  const already = by('already');
  const notDone = [...by('skipped'), ...by('failed')];
  const parts: string[] = [];
  if (done.length) parts.push(`Fulfilled ${done.length === 1 ? done[0].ordernum : `${done.length} orders`} on Shopify — customer${done.length === 1 ? '' : 's'} emailed`);
  if (already.length) parts.push(`${already.length === 1 ? already[0].ordernum : `${already.length} orders`} already fulfilled`);
  for (const r of notDone) parts.push(`${r.ordernum} not fulfilled: ${r.reason || r.outcome}`);
  // Red if any order didn't go, skipped or failed — "not fulfilled" must never read as green.
  return { ok: !notDone.length, text: parts.join('; ') };
}

export default function FulfilButton({ onResult, onUpdated, onUpdateError }: {
  onResult: (r: ManifestResult | null) => void;
  onUpdated: () => void | Promise<void>;
  onUpdateError: (message: string | null) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const { run: updateOrders } = useUpdateOrders({ onDone: onUpdated, onError: onUpdateError });

  async function run() {
    setRunning(true);
    onResult(null);
    const res = await fulfilCustomerOrders();
    setRunning(false);
    if (!res.success || !res.data) {
      onResult({ ok: false, text: res.error || 'Fulfil didn’t go through' });
      return;
    }
    onResult(fulfilSummary(res.data));
    if (res.data.some((r) => r.outcome === 'fulfilled' || r.outcome === 'already')) await updateOrders();
  }

  if (confirm) {
    return (
      <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
        <span className="text-slate-700">Fulfil every packed order on Shopify? Customers are emailed.</span>
        <button type="button" onClick={() => { setConfirm(false); run(); }}
          className="rounded bg-slate-800 px-2 py-0.5 font-medium text-white">Fulfil</button>
        <button type="button" onClick={() => setConfirm(false)}
          className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">Cancel</button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={running}
      onClick={() => setConfirm(true)}
      title="Mark every packed order fulfilled on Shopify, with tracking, and email the customers"
      className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {running ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <CheckBadgeIcon className="h-3.5 w-3.5" />}
      {running ? 'Fulfilling…' : 'Fulfil'}
    </button>
  );
}
