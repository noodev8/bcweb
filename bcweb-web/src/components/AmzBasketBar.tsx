'use client';
/*
=======================================================================================================================================
Component: AmzBasketBar + AmzUploadButton  (the Amazon upload basket, on every /amz page)
=======================================================================================================================================
Purpose: Surfaces the Amazon upload basket (AmzBasketContext). Amazon prices don't push live — they're recorded as you apply them,
         downloaded as ONE Seller Central file, then confirmed as uploaded.

         Three states:
           1. READY — pending changes, no download in flight: AmzUploadButton, a compact "Upload file · N" button that pages put in the
              AppShell title row (headerRight), so it costs no height above the list.
           2. CONFIRM — a file was just downloaded and awaits confirmation: AmzBasketBar's banner — a warning (the legacy "you MUST upload
              or the changes are lost" message) + "I've uploaded — clear these N" (stamps them done, team-wide) + re-download + not-yet.
              The confirm is the explicit "Done" — one extra click, but it's what lets a colleague / tomorrow-you see the work is finished.
              This one stays a full-width banner: it's transient and it guards against lost work.
           3. IDLE — nothing pending: nothing at all.
         OWNER, 2026-09-24: READY used to be a full-width strip (count, download, how-to text, the team's last upload) and IDLE a green
         "All uploaded — last uploaded 22:23 yesterday · Andreas · 4 SKUs" line. Both sat above every list and read as in the way; the
         last-upload stamp went with them (the context still loads it, nothing shows it).

         The basket is DURABLE + TEAM-WIDE: a view of the whole team's pending changes (rebuilt from the audit log on load), so it survives a
         browser close / machine restart and whoever is at the desk can upload — and confirm — a colleague's pending change.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ArrowDownTrayIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

// STATE 1 — the compact download button for the page's title row. Nothing when the basket is empty, or while a downloaded file awaits
// confirmation (the banner below owns that moment, with its own re-download).
export function AmzUploadButton() {
  const { count, pending, download } = useAmzBasket();
  if (count === 0 || pending) return null;
  return (
    <button
      type="button"
      onClick={download}
      // A quiet white control like Repricing's "Update now", not a purple call to action (owner, 2026-09-25: "blend the design in").
      // The count carries the weight: a dark chip, so waiting changes are still easy to spot.
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
    >
      <ArrowDownTrayIcon className="h-4 w-4 text-slate-400" aria-hidden="true" /> Upload file
      <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">{count}</span>
    </button>
  );
}

// STATE 2 only — the confirm banner. Renders nothing otherwise.
export default function AmzBasketBar() {
  const { pending, redownload, confirmUploaded, cancelPending } = useAmzBasket();
  const [busy, setBusy] = useState(false);

  const doConfirm = async () => {
    setBusy(true);
    try { await confirmUploaded(); } finally { setBusy(false); }
  };

  // STATE 2 — a downloaded file awaits confirmation. The warning carries the real stakes (unuploaded = not live); the confirm is the Done.
  if (pending) {
    const n = pending.ids.length;
    return (
      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm">
        <div className="flex items-start gap-2 text-amber-900">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div>
            <div className="font-semibold">File downloaded — {n} price change{n === 1 ? '' : 's'}.</div>
            <div className="text-amber-800">
              These are <span className="font-medium">not live on Amazon</span> until you upload the file in Seller Central. Do that now,
              then confirm below.
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-7">
          <button
            type="button"
            onClick={doConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            <CheckCircleIcon className="h-4 w-4" /> {busy ? 'Clearing…' : `I've uploaded — clear these ${n}`}
          </button>
          <button
            type="button"
            onClick={redownload}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            <ArrowDownTrayIcon className="h-4 w-4" /> Re-download
          </button>
          <button
            type="button"
            onClick={cancelPending}
            className="px-2 py-1.5 text-xs font-medium text-amber-700/80 hover:text-amber-900"
          >
            Not yet
          </button>
        </div>
      </div>
    );
  }

  return null;
}
