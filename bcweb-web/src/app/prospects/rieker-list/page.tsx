'use client';
/*
=======================================================================================================================================
Page: /prospects/rieker-list  (RIEKER LIST — reached from the "Rieker list" link on Prospects)
=======================================================================================================================================
Purpose: PDF FIRST (owner, 2026-11-27: "Start with what we can get and then see if it is worth it … thats what I will be doing"). Every
         Rieker / Remonte style on Rieker's stock list WITH stock that we don't stock, with how it sells on Amazon — best Fashion rank
         first (the overall rank, never the sub-category). Server: bcweb-server/routes/supplier-prospects.js.
         INSTANT: the Amazon look-up (scripts/supplier-amazon-scan.js, ~5–10 minutes) runs after "load the Rieker list", never from here
         (owner: "Will it take 5 mins from the screen too? We might need to indicate that") — the header says when Amazon was checked.
         A row: the style (code, season), its best-ranked size on Amazon (title, size, Open), Fashion rank, Buy Box (else lowest),
         sellers, our cost and the keep a pair / return on cost at that price, and the can-get size dots (black = can get).
         ADD puts it straight on Prospects with its first check (rank, price, sellers, size) and cost — no form, the row then says ON THE
         LIST. The name carries the Rieker code, so the saved line shows the same dots. Styles not found on Amazon sit at the bottom,
         plainly marked — rank can't judge them.
         SORT: best Fashion rank first, then found on Amazon with no rank, then not on Amazon (server). The header's Rank / On cost
         switch it (owner, 2026-11-27: "Im interested in high profit and low rank and will balance the two") — rank lowest first, on
         cost highest first; a row with nothing to sort on stays at the bottom. No blended score: the owner does the balancing. Every row CAN be got — a style
         is only here with at least one size in stock on Rieker's list.
         CUT (owner, 2026-11-27): × takes a row off the screen for now — nothing saved, no count, no undo. REFRESH re-reads the list
         and brings every cut row back (it does not re-run the Amazon look-up — that rides on "load the Rieker list").
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, ChevronDownIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { SupplierLine } from '@/components/ProspectAmazonSearch';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSupplierProspects, saveProspect, SupplierProspect } from '@/lib/api';

const smallBtn = 'rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const money = (n: number | null) => (n === null ? '' : `£${n.toFixed(2)}`);
const fmtRank = (n: number) => n.toLocaleString('en-GB');
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

export default function RiekerListPage() {
  const q = useApiQuery('supplier-prospects-rieker', () => getSupplierProspects('rieker'));
  const rows = q.data?.rows;
  const [cut, setCut] = useState<Set<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<'rank' | 'profit'>('rank');
  const found = useMemo(() => {
    const list = (rows || []).filter((r) => r.asin && !cut.has(r.style));
    if (sort === 'profit') {
      const key = (r: SupplierProspect) => r.return_on_cost?.on_cost_pct ?? -Infinity;
      list.sort((a, b) => key(b) - key(a));
    }
    return list;   // 'rank' = the server's order
  }, [rows, cut, sort]);
  const notFound = useMemo(() => (rows || []).filter((r) => !r.asin && !cut.has(r.style)), [rows, cut]);
  async function onRefresh() {
    setRefreshing(true);
    await q.refresh();
    setCut(new Set());
    setRefreshing(false);
  }

  return (
    <AppShell title="Rieker list" backHref="/prospects" backLabel="Prospects">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-600">
            Styles Rieker can sell us that we don&rsquo;t stock, best Amazon rank first.
            {q.data?.list_date && <> Rieker list {fmtDate(q.data.list_date)}</>}
            {q.data?.scanned_at && <> · Amazon checked {fmtWhen(q.data.scanned_at)}</>}
          </p>
          <button type="button" onClick={onRefresh} disabled={refreshing} title="Re-read the list and bring back every row cut with ×"
            className={`${smallBtn} ml-auto inline-flex items-center gap-1.5 py-1.5 text-sm`}>
            <ArrowPathIcon className={'h-4 w-4 ' + (refreshing ? 'animate-spin' : '')} /> Refresh
          </button>
        </div>
        {q.error ? (
          <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-red-700">{q.error.message}</p>
        ) : q.isLoading ? (
          <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500">
              <span className="w-4 shrink-0" />
              <span className="w-20 shrink-0">Style</span>
              <span className="min-w-0 flex-1">On Amazon</span>
              <button type="button" onClick={() => setSort('rank')} title="Best Fashion rank first"
                className={'w-20 shrink-0 text-right hover:text-slate-900 ' + (sort === 'rank' ? 'text-slate-900 underline' : '')}>Rank</button>
              <span className="w-16 shrink-0 text-right">Price</span>
              <span className="w-16 shrink-0 text-right" title="Estimated from Rieker's cost (× 2.34) until we buy it">RRP</span>
              <button type="button" onClick={() => setSort('profit')} title="Best return on cost first"
                className={'w-16 shrink-0 text-right hover:text-slate-900 ' + (sort === 'profit' ? 'text-slate-900 underline' : '')}>On cost</button>
              <span className="w-36 shrink-0" />
            </div>
            {[...found, ...notFound].map((r) => (
              <Row key={r.style} r={r} onAdded={() => q.refresh()} onCut={() => setCut((prev) => new Set(prev).add(r.style))} />
            ))}
            {!found.length && !notFound.length && <p className="px-5 py-4 text-sm text-slate-500">Nothing on the list.</p>}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Row({ r, onAdded, onCut }: { r: SupplierProspect; onAdded: () => void; onCut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = r.buybox ?? r.lowest;

  async function add() {
    setBusy(true);
    setError(null);
    // The name carries the code, so the saved line finds its Rieker dots (utils/supplierStock.js reads the code from the name).
    const title = r.title || '';
    const name = (title.toUpperCase().includes(r.style.toUpperCase()) ? title : `Rieker ${r.style} ${title}`).trim().slice(0, 200);
    const res = await saveProspect({
      name, amazon: r.asin ?? '', rating: null, cost: r.cost !== null ? r.cost.toFixed(2) : '',
      check: {
        rank: r.rank !== null ? fmtRank(r.rank) : '', price: price !== null ? price.toFixed(2) : '',
        sellers: r.fba !== null ? `${r.fba} FBA · ${r.fbm} FBM` : '', size: (r.size || '').slice(0, 10),
      },
    });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Failed to add'); return; }
    onAdded();
  }

  // LEAN ROW (owner, 2026-11-27: "too busy … leave the important info on the main list. Size availability can be an expand"): the
  // style, its Amazon title, Fashion rank, price and return on cost. Click for the rest — sizes Rieker has, cost and keep a pair,
  // sellers, best size, season.
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? 'bg-sky-50/50' : ''}>
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {open ? <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />}
          <span className="w-20 shrink-0 font-mono font-medium text-slate-900">{r.style}</span>
          <span className="min-w-0 flex-1 truncate text-slate-700" title={r.title || undefined}>{r.title || ''}</span>
          {r.listed && (
            <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
              {r.listed.archived ? 'TESTED BEFORE' : 'ON THE LIST'}
            </span>
          )}
          <span className="w-20 shrink-0 text-right tabular-nums text-slate-800">
            {!r.asin ? <span className="text-xs text-slate-400">Not on Amazon</span> : r.rank !== null ? `#${fmtRank(r.rank)}` : <span className="text-xs text-slate-400">No rank</span>}
          </span>
          <span className="w-16 shrink-0 text-right tabular-nums text-slate-700">{money(price)}</span>
          {/* RRP ESTIMATE (owner, 2026-11-27) — from the cost, so a price far over it (Pia: £131.65 on ~£65) reads as unreal at a glance. */}
          <span className="w-16 shrink-0 text-right tabular-nums text-slate-700" title="Estimated from Rieker's cost (× 2.34)">
            {r.rrp_est !== null ? money(r.rrp_est) : ''}
          </span>
          <span className="w-16 shrink-0 text-right tabular-nums font-medium text-slate-800">
            {r.return_on_cost ? `${r.return_on_cost.on_cost_pct.toFixed(0)}%` : ''}
          </span>
        </button>
        <div className="flex w-36 shrink-0 items-center justify-end gap-2">
          {r.asin && (
            <a href={`https://www.amazon.co.uk/dp/${r.asin}`} target="_blank" rel="noopener noreferrer" title="Open on Amazon — reviews are there"
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Open <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
          )}
          <button type="button" onClick={add} disabled={busy || !!r.listed} className={smallBtn}
            title={r.listed ? 'Already on Prospects' : 'Put it on Prospects with this check and cost'}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" onClick={onCut} title="Cut from the list — Refresh brings it back" aria-label={`Cut ${r.style}`}
            className="rounded p-0.5 text-slate-300 hover:bg-slate-200 hover:text-slate-700">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {open && (
        <div className="pb-2 pl-11 pr-4 text-xs text-slate-500">
          <div className="flex flex-wrap gap-x-3">
            {r.season && <span>{r.season}</span>}
            {r.fba !== null && <span>{r.fba} FBA · {r.fbm} FBM</span>}
            {r.size && <span>best size {r.size}</span>}
          </div>
          <SupplierLine
            sup={{ colour_sure: true, styles: [{ supplier: 'rieker', style: r.style, season: r.season, cost: r.cost, sizes: r.sizes, list_date: '' }] }}
            roc={r.return_on_cost} />
        </div>
      )}
      {error && <p className="px-4 pb-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
