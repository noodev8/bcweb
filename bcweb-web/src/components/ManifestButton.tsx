'use client';
/*
=======================================================================================================================================
Component: ManifestButton  ("Fulfill" on screen, Customer Orders header bar)
=======================================================================================================================================
Purpose: The end-of-day step, ONE press (owner, 2026-10-22 — "put manifest and fulfill as one button now"; docs/fulfil-plan.md):
         1. manifest everything Click & Drop has waiting and save the manifest PDF to Downloads;
         2. mark every PACKED order fulfilled on Shopify — Royal Mail with its Click & Drop tracking, FBA with the Amazon courier — and
            Shopify emails each customer;
         3. run Update orders, which sees those orders fulfilled on Shopify and archives them off the list.
         Acts on the LIST, not on one order (owner, 2026-10-14). Each order box keeps its own Fulfil (CustomerOrderList → OrderBox).

TWO REQUESTS, ONE PRESS. Manifest and fulfil are separate routes so a slow manifest can't push the whole job past the browser's 120s
wait. The fulfil is only sent if the manifest went through or there was nothing to manifest (NOTHING_TO_MANIFEST is not an error — a
re-press still fulfils whatever is packed). A manifest that errors stops the press: fulfil nothing. A manifest Click & Drop is still
making doesn't hold the fulfil up — the fulfil list is our packed rows, not the manifest's (owner, 2026-10-19) — the button then reads
Collect manifest, and that press only collects the PDF.

Behind an inline confirm: a manifest can't be undone and the fulfil emails real customers.

The outcome is handed to the page (onResult), which shows it under the title row — it can run to a sentence or two.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ArrowPathIcon, CheckBadgeIcon } from '@heroicons/react/24/outline';
import { fulfilCustomerOrders, manifestCustomerOrders, type CustomerFulfilResult } from '@/lib/api';
import { useUpdateOrders } from '@/components/UpdateOrdersButton';

export interface ManifestResult { ok: boolean; text: string }

// One line for the fulfil outcome — shared with the per-order Fulfil button.
export function fulfilSummary(results: CustomerFulfilResult[]): ManifestResult {
  if (!results.length) return { ok: true, text: 'Nothing packed to fulfill' };
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

export default function ManifestButton({ onResult, onUpdated, onUpdateError }: {
  onResult: (r: ManifestResult | null) => void;
  onUpdated: () => void | Promise<void>;
  onUpdateError: (message: string | null) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState<'manifest' | 'fulfil' | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const { run: updateOrders } = useUpdateOrders({ onDone: onUpdated, onError: onUpdateError });

  // Step 1. Returns the manifest's line for the summary, or null when the press must stop (the manifest errored).
  async function manifest(): Promise<ManifestResult | null> {
    const res = await manifestCustomerOrders(pending);
    if (!res.success || !res.data) {
      if (res.return_code === 'NOTHING_TO_MANIFEST') {
        setPending([]);
        return { ok: true, text: 'Nothing waiting to manifest' };
      }
      onResult({ ok: false, text: `${res.error || 'The manifest didn’t go through'} — nothing fulfilled` });
      return null;
    }
    const all = res.data;
    const done = all.filter((m) => !m.pending && !m.failed);
    const stillPending = all.filter((m) => m.pending);
    const failed = all.filter((m) => m.failed);
    setPending(stillPending.map((m) => m.id));

    // Saved to Downloads, not printed (owner, 2026-10-14). Named by date + the manifest id's first block, so two in a day don't clash.
    const day = new Date().toISOString().slice(0, 10);
    for (const m of done) {
      if (!m.pdf) continue;
      const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(m.pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `manifest-${day}-${(m.number || m.id).slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    const n = done.reduce((t, m) => t + m.orders.length, 0);
    const parts: string[] = [];
    // Click & Drop's inline reply names the manifest but may not list its orders — then say the number, not "0 orders".
    if (done.length) {
      parts.push(n > 0
        ? `Manifested ${n} order${n === 1 ? '' : 's'} — manifest saved to Downloads`
        : `Manifest${done.some((m) => m.number) ? ' ' + done.map((m) => m.number).filter(Boolean).join(', ') : ''} done — saved to Downloads`);
    }
    if (done.some((m) => !m.pdf)) parts.push('a manifest came back with no PDF — download it from Click & Drop');
    const unread = stillPending.filter((m) => m.readError);
    if (unread.length) parts.push(`manifested, but the PDF couldn’t be fetched (${unread[0].readError}) — press Collect manifest to try again`);
    if (stillPending.length > unread.length) parts.push('Click & Drop is still making the manifest — press Collect manifest in a minute to collect it');
    if (failed.length) parts.push(`manifest failed at Click & Drop (ref ${failed.map((m) => m.errorReference || m.id).join(', ')})`);
    return { ok: !failed.length && !unread.length && done.every((m) => m.pdf), text: parts.join('; ') };
  }

  async function run() {
    const collecting = pending.length > 0;
    onResult(null);
    setRunning('manifest');
    const m = await manifest();
    if (!m) { setRunning(null); return; }
    // Collect manifest only fetches the PDF — the fulfil already ran on the press that started that manifest.
    if (collecting) { setRunning(null); onResult(m); return; }

    setRunning('fulfil');
    const res = await fulfilCustomerOrders();
    setRunning(null);
    if (!res.success || !res.data) {
      onResult({ ok: false, text: `${m.text}; ${res.error || 'Fulfill didn’t go through'}` });
      return;
    }
    const f = fulfilSummary(res.data);
    onResult({ ok: m.ok && f.ok, text: `${m.text}; ${f.text}` });
    if (res.data.some((r) => r.outcome === 'fulfilled' || r.outcome === 'already')) await updateOrders();
  }

  if (confirm) {
    return (
      <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
        <span className="text-slate-700">Manifest everything on Click &amp; Drop, then fulfill every packed order on Shopify? Customers are emailed. This can’t be undone.</span>
        <button type="button" onClick={() => { setConfirm(false); run(); }}
          className="rounded bg-slate-800 px-2 py-0.5 font-medium text-white">Fulfill</button>
        <button type="button" onClick={() => setConfirm(false)}
          className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">Cancel</button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={running !== null}
      onClick={() => (pending.length ? run() : setConfirm(true))}
      title={pending.length
        ? 'Collect the manifest Click & Drop is still making'
        : 'Manifest everything waiting on Click & Drop, then mark every packed order fulfilled on Shopify and email the customers'}
      className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {running ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <CheckBadgeIcon className="h-3.5 w-3.5" />}
      {running === 'manifest' ? 'Manifesting…' : running === 'fulfil' ? 'Fulfilling…' : pending.length ? 'Collect manifest' : 'Fulfill'}
    </button>
  );
}
