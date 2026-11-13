'use client';
/*
=======================================================================================================================================
Component: AmzBasketBar + AmzUploadButton  (Send to Amazon + the backup upload file, on every /amz page)
=======================================================================================================================================
2026-11-11: AmzUploadButton is now SEND TO AMAZON (prices go live through the SP-API — utils/amzPricePush.js); the upload file it used to
be sits behind its ⋯ as the backup. The notes below describe the file flow, which still works the same from there.
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
import { ArrowDownTrayIcon, ExclamationTriangleIcon, CheckCircleIcon, EllipsisHorizontalIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

// STATE 1 — SEND TO AMAZON (2026-11-11, in the old "Upload file · N" place — owner: "have the new button in the old ones place"). An
// Apply already sends its price; this is for whatever hasn't reached Amazon (a refusal, a failed send). Its result shows beside it —
// "3 sent · 1 not sent", hover for Amazon's reasons — and is not stored (owner). The old upload FILE is behind the ⋯ (owner: "hide the
// old button behind a 3 dot menu ... like we did for other hidden ones"), leading into the same confirm banner as before.
// Nothing at all when nothing is waiting and no result to show, or while a downloaded file awaits confirmation (the banner owns that).
export function AmzUploadButton() {
  const { count, pending, download, send, sending, lastSend } = useAmzBasket();
  const [menu, setMenu] = useState(false);
  if (pending || (count === 0 && !lastSend && !sending)) return null;

  const resultParts = lastSend
    ? [lastSend.sent ? `${lastSend.sent} sent` : '', lastSend.failed.length ? `${lastSend.failed.length} not sent` : ''].filter(Boolean)
    : [];

  return (
    <div className="relative flex items-center gap-2">
      {lastSend && (
        lastSend.error
          ? <span className="text-xs font-medium text-red-600">{lastSend.error}</span>
          : <span
              className={`text-xs font-medium ${lastSend.failed.length ? 'cursor-help text-red-600' : 'text-green-700'}`}
            >
              {resultParts.join(' · ') || 'Nothing to send'}
            </span>
      )}
      {(count > 0 || sending) && (
        <button
          type="button"
          onClick={send}
          disabled={sending}
          // A quiet white control like Repricing's "Update now" (owner, 2026-09-25: "blend the design in"); the count chip carries the weight.
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
        >
          <PaperAirplaneIcon className="h-4 w-4 text-slate-400" aria-hidden="true" /> {sending ? 'Sending…' : 'Send to Amazon'}
          <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">{count}</span>
        </button>
      )}
      {count > 0 && (
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-label="More Amazon options"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <EllipsisHorizontalIcon className="h-5 w-5" />
        </button>
      )}
      {menu && count > 0 && (
        <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          <p className="mb-1.5 text-[11px] text-slate-400">Backup — the old Seller Central upload file:</p>
          <button
            type="button"
            onClick={() => { setMenu(false); download(); }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:border-brand-500 hover:text-brand-700"
          >
            <ArrowDownTrayIcon className="h-4 w-4" /> Upload file · {count}
          </button>
        </div>
      )}
    </div>
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
