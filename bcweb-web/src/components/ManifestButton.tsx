'use client';
/*
=======================================================================================================================================
Component: ManifestButton  ("Manifest and fulfil", Customer Orders title row)
=======================================================================================================================================
Purpose: The end-of-day step. Acts on the LIST, not on one order (owner, 2026-10-14): manifests everything Click & Drop has waiting,
         then saves the manifest PDF to Downloads. The Shopify fulfil step comes later (docs/fulfil-plan.md).

WHY THE TITLE ROW (owner, 2026-10-15). It used to sit among the list's controls, at the same weight as Refresh, where it read as one
more filter-ish button and sat under the packer's hand. It's a once-a-day, can't-be-undone action on the whole list — the same kind
of thing as Update orders — so it sits beside it, and is the one solid button there because it's the day's last job.

Behind an inline confirm: a manifest can't be undone. While one is still processing at Click & Drop the button reads Collect manifest
and fetches that one rather than starting another.

The outcome is handed to the page (onResult), which shows it under the title row — the message can run to a sentence or two (a
pending manifest, a missing PDF), too long for a chip beside the button.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ArrowPathIcon, TruckIcon } from '@heroicons/react/24/outline';
import { manifestCustomerOrders } from '@/lib/api';

export interface ManifestResult { ok: boolean; text: string }

export default function ManifestButton({ onResult }: { onResult: (r: ManifestResult | null) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<string[]>([]);

  async function run() {
    setRunning(true);
    onResult(null);
    const res = await manifestCustomerOrders(pending);
    setRunning(false);
    if (!res.success || !res.data) {
      const nothing = res.return_code === 'NOTHING_TO_MANIFEST';
      onResult({ ok: nothing, text: res.error || 'The manifest didn’t go through' });
      if (nothing) setPending([]);
      return;
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
    onResult({ ok: !failed.length && !unread.length && done.every((m) => m.pdf), text: parts.join('; ') });
  }

  if (confirm) {
    return (
      <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
        <span className="text-slate-700">Manifest everything on Click &amp; Drop? This can’t be undone.</span>
        <button type="button" onClick={() => { setConfirm(false); run(); }}
          className="rounded bg-slate-800 px-2 py-0.5 font-medium text-white">Manifest</button>
        <button type="button" onClick={() => setConfirm(false)}
          className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">Cancel</button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={running}
      onClick={() => (pending.length ? run() : setConfirm(true))}
      title={pending.length ? 'Collect the manifest Click & Drop is still making' : 'Manifest everything waiting on Click & Drop and download the manifest'}
      className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {running ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : <TruckIcon className="h-3.5 w-3.5" />}
      {running ? 'Manifesting…' : pending.length ? 'Collect manifest' : 'Manifest and fulfil'}
    </button>
  );
}
