'use client';
/*
=======================================================================================================================================
Component: AmzBasketBar  (the Amazon upload basket, shown on every /amz page)
=======================================================================================================================================
Purpose: The persistent strip that surfaces the Amazon upload basket (AmzBasketContext). Amazon prices don't push live — they're recorded
         as you apply them, downloaded as ONE Seller Central file, then confirmed as uploaded.

         Three states, because "did anyone actually upload this?" was the real pain:
           1. READY — pending changes exist, no download in flight: "N ready" + Download. A reassurance line shows the team's last upload.
           2. CONFIRM — a file was just downloaded and awaits confirmation: a warning (the legacy "you MUST upload or the changes are lost"
              message) + "I've uploaded — clear these N" (stamps them done, team-wide) + re-download + not-yet. The confirm is the explicit
              "Done" — one extra click, but it's what lets a colleague / tomorrow-you see the work is finished.
           3. IDLE — nothing pending: normally renders nothing, but if the team uploaded recently it shows a muted "✓ last uploaded …" so an
              empty basket reads as "done", not "did anyone check?".

         The basket is DURABLE + TEAM-WIDE: a view of the whole team's pending changes (rebuilt from the audit log on load), so it survives a
         browser close / machine restart and whoever is at the desk can upload — and confirm — a colleague's pending change.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ArrowDownTrayIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

// Format the last-upload stamp as "20:14 today · Andreas · 27 SKUs" (or "yesterday" / a date for older). Local time; the server sends UTC.
function describeLastUpload(at: string, by: string | null, count: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const when = sameDay ? `${time} today` : isYesterday ? `${time} yesterday` : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const who = by ? ` · ${by}` : '';
  return `last uploaded ${when}${who} · ${count} SKU${count === 1 ? '' : 's'}`;
}

export default function AmzBasketBar() {
  const { count, lastUpload, pending, download, redownload, confirmUploaded, cancelPending } = useAmzBasket();
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

  // STATE 1 — pending changes, ready to download.
  if (count > 0) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
        <span className="font-medium text-brand-900">
          {count} price change{count === 1 ? '' : 's'} ready to upload
        </span>
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
        >
          <ArrowDownTrayIcon className="h-4 w-4" /> Download upload file
        </button>
        <span className="text-xs text-brand-700/80">one file for Seller Central · confirm once it&apos;s uploaded</span>
        {lastUpload && (
          <span className="ml-auto text-xs text-brand-700/70">{describeLastUpload(lastUpload.at, lastUpload.by, lastUpload.count)}</span>
        )}
      </div>
    );
  }

  // STATE 3 — nothing pending. Show the "done" reassurance if there's been a recent upload; otherwise render nothing.
  if (lastUpload) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-1.5 text-xs text-emerald-800">
        <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
        <span>All uploaded — {describeLastUpload(lastUpload.at, lastUpload.by, lastUpload.count)}</span>
      </div>
    );
  }

  return null;
}
