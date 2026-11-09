'use client';
/*
=======================================================================================================================================
Page: /update-amazon  — AMAZON STATUS (was the Update Amazon upload screen)
=======================================================================================================================================
Purpose: Show that the Amazon data is coming in by itself, and what to look at when it isn't. Since 2026-11-09 NOTHING is uploaded
(owner agreed every point: keep the screen as a small status page, drop the upload area, a red dashboard warning when a read fails):
  every Update orders   FBA stock changed since the last run      utils/amzStockSync.js        job 'stock'
                        Amazon sales (sales rows only)            utils/amzOrderSync.js        job 'orders'
  nightly (01:15)       FBA Inventory report — prices, Seller Central price changes, new SKUs, full stock check   'inventory_report'
                        FBA returns, last 30 days                                                                 'returns_report'
  every 28 days         Fee Preview -> skumap.fbafee                                                              'fees_report'
  (the nightly three are scripts/amz-inventory-nightly.js; each keeps its status in amz_api_sync)

Shown: one row per read — when it runs, when it last worked, what it did, and its error in red until the next success clears it.
Then the size history line, and LAST NIGHT'S LISTINGS CHECK (unknown SKUs + the Delete file .xlsm that de-lists dead ones — the
reconciliation the inventory upload used to show; rare but still done, owner).

The route is kept as /update-amazon (links, bookmarks); the name on screen is "Amazon status". The old preview / commit routes remain
on the server unused (git history has this screen's upload flow).
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import { AmzReconciliation } from '@/components/AmzImportSummary';
import { getAmzImportLast, AmzSizeHistoryStatus, AmzApiJobStatus } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

const READS: { key: 'stock' | 'orders' | 'report' | 'returns' | 'fees'; name: string; what: string; when: string }[] = [
  { key: 'stock', name: 'FBA stock', what: 'live and on its way in, for every size that changed', when: 'every Update orders' },
  { key: 'orders', name: 'Amazon sales', what: 'new orders booked as sales (shown in the Update orders count)', when: 'every Update orders' },
  { key: 'report', name: 'FBA Inventory report', what: 'prices, prices changed in Seller Central, new SKUs, full stock check', when: 'nightly, 01:15' },
  { key: 'returns', name: 'FBA returns', what: 'the last 30 days — each return booked once', when: 'nightly, 01:15' },
  { key: 'fees', name: 'FBA fees', what: 'Fee Preview — fees updated where they changed', when: 'every 28 days' },
];

export default function AmazonStatusPage() {
  const { data } = useApiQuery('amz-import-last', getAmzImportLast);
  const api = data?.amazonApi ?? null;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Amazon status</h1>
        <p className="mt-1 text-sm text-slate-500">
          Everything is read from Amazon automatically — there is nothing to download or upload.
        </p>
        <SizeHistoryLine h={data?.history ?? null} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Read</th>
              <th className="px-4 py-2 font-medium">Runs</th>
              <th className="px-4 py-2 font-medium">Last worked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {READS.map((r) => (
              <ReadRow key={r.key} read={r} status={api ? api[r.key] : null} />
            ))}
          </tbody>
        </table>
      </div>

      {api?.reconciliation && (
        <div className="mt-8">
          <AmzReconciliation
            rec={api.reconciliation}
            title={`Amazon listings check — last night's report${api.report?.lastOk ? ` (${api.report.lastOk})` : ''}`}
          />
        </div>
      )}
    </AppShell>
  );
}

function ReadRow({ read, status }: { read: (typeof READS)[number]; status: AmzApiJobStatus | null }) {
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 font-medium text-slate-900">
          <span className={`h-2 w-2 shrink-0 rounded-full ${status?.error ? 'bg-red-500' : status?.lastOk ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          {read.name}
        </div>
        <div className="mt-0.5 pl-4 text-xs text-slate-500">{read.what}</div>
        {status?.error && (
          <div className="mt-1 pl-4 text-xs font-medium text-red-700">Failed {status.errorAt}: {status.error}</div>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{read.when}</td>
      <td className="px-4 py-3 text-xs text-slate-600">
        <div className="whitespace-nowrap font-medium tabular-nums">{status?.lastOk || 'not yet'}</div>
        {status?.note && <div className="mt-0.5 text-slate-400">{status.note}</div>}
      </td>
    </tr>
  );
}

/** Size history status (owner, 2026-11-03: "ensure it doesn't get too big and forgotten"): when it last saved, how much is kept, and
 *  its size on disk — amber once more than `staleAfterDays` days have gone with no Amazon stock reading. Nothing while the table
 *  isn't there yet (history null). */
function SizeHistoryLine({ h }: { h: AmzSizeHistoryStatus | null }) {
  if (!h) return null;
  // historyFrom can be earlier than the first reading: days rebuilt from the Inventory Ledger (scripts/amz-ledger-backfill.js).
  const from = h.historyFrom ? ` · stock history from ${h.historyFrom}` : '';
  if (!h.lastDay) {
    return <p className="mt-0.5 text-xs text-slate-400">Size history: recording starts with the next Amazon stock read{from}.</p>;
  }
  const mb = (h.bytes / (1024 * 1024)).toFixed(1);
  const kept = `${h.days.toLocaleString('en-GB')} day${h.days === 1 ? '' : 's'} recorded since ${h.firstDay}${from} · ${mb} MB`;
  if (h.stale) {
    return (
      <p className="mt-1 inline-block rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
        Size history: no Amazon stock reading for {h.daysSince} days (last {h.lastDay}) — those days have no stock or price on record. {kept}
      </p>
    );
  }
  return <p className="mt-0.5 text-xs text-slate-400">Size history: last saved {h.lastDay} · {kept}</p>;
}
