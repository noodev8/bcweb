'use client';
/*
=======================================================================================================================================
Page: /process/unsold — Unsold (opened from the Unsold card on Process, 2026-10-25)
=======================================================================================================================================
Purpose: the new sizes that have not sold anywhere, SPLIT BY WHERE THE STOCK SITS — the location already says which screen a size
belongs on, and it sets apart the one real decision (owner: "If it is an Amazon potential I will decide to send them to Amazon"):

  - AT FBA      already on Amazon and not selling. The card goes STRAIGHT to the Amazon repricer list of these sizes
                (/amz/unsold-fba?by=process — owner, 2026-10-25: "No need for the local list. Send them there"), where the Due
                switch shows whether their prices are up to date. Sizes with stock in BOTH places sit here (already on Amazon).
  - LOCAL ONLY  the decision: keep on Shopify (Shopify repricer) or send to Amazon (the Amazon screen). By STYLE — Shopify-vs-Amazon
                is a per-style call; a row opens its sizes by code.
  - NO STOCK    nothing to sell yet (probably still arriving).

Laid out like Process: one CARD per group with its count, the list opening below the cards when one is tapped (owner, 2026-10-25:
the three lists stacked hid the other options). None open on arrival.

Same data and SWR key as Process (process-overview), so it opens from the cache. Oldest added first everywhere — the longest
without a sale at the top. No links out yet: what each group links to is the next decision, taken one at a time with the owner.
=======================================================================================================================================
*/

import { Fragment, useState } from 'react';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { getProcessOverview, type ProcessSizeRow } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useApiQuery } from '@/lib/useApiQuery';
import { boxCls, isSold, shortDate } from '../shared';

const BACK = '/process';

type Area = 'local' | 'none';

// At FBA's Amazon repricer list; back returns here.
const FBA_HREF = `/amz/unsold-fba?by=process&from=${encodeURIComponent('/process/unsold')}&back=Unsold`;

type StyleRow = { groupid: string; title: string | null; brand: string | null; created: string; sizes: ProcessSizeRow[] };

// Oldest added first, then the server's order (groupid, sizes in size order) as the tie-break — Array.sort is stable.
const oldestFirst = (a: { created: string }, b: { created: string }) => a.created.localeCompare(b.created);

function byStyle(rows: ProcessSizeRow[]): StyleRow[] {
  const out: StyleRow[] = [];
  const byId = new Map<string, StyleRow>();
  for (const r of rows) {
    let st = byId.get(r.groupid);
    if (!st) {
      st = { groupid: r.groupid, title: r.title, brand: r.brand, created: r.created, sizes: [] };
      byId.set(r.groupid, st);
      out.push(st);
    }
    st.sizes.push(r);
  }
  return out.sort(oldestFirst);
}

export default function ProcessUnsoldPage() {
  const q = useApiQuery('process-overview', () => getProcessOverview());
  const d = q.data;

  const unsold = d ? d.rows.filter((r) => !isSold(r)) : [];
  const atFba = unsold.filter((r) => r.fbaStock > 0);
  const localOnly = byStyle(unsold.filter((r) => r.fbaStock <= 0 && r.localStock > 0));
  const localSizes = localOnly.reduce((n, st) => n + st.sizes.length, 0);
  const noStock = unsold.filter((r) => r.fbaStock <= 0 && r.localStock <= 0).sort(oldestFirst);

  const [open, setOpen] = useState<Area | null>(null);
  const card = (a: Area, label: string, n: number, caption: string) => {
    const isOpen = open === a;
    return (
      <button
        type="button" onClick={() => setOpen(isOpen ? null : a)}
        className={boxCls + ' ' + (isOpen ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200 hover:border-brand-500 hover:shadow-md')}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="text-4xl font-semibold tabular-nums text-slate-900">{n}</span>
        <span className="text-xs text-slate-400">{caption}</span>
      </button>
    );
  };

  return (
    <AppShell title="Unsold" backHref={BACK} backLabel={prettyPathLabel(BACK)}>
      {q.isLoading && <div className="py-10 text-center text-sm text-slate-400">Loading…</div>}
      {q.error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{q.error.message}</div>}

      {d && (
        <>
          <section className="flex flex-wrap gap-4">
            <Link href={FBA_HREF} className={boxCls + ' border-slate-200 hover:border-brand-500 hover:shadow-md'}>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">At FBA</span>
              <span className="text-4xl font-semibold tabular-nums text-slate-900">{atFba.length}</span>
              <span className="text-xs text-slate-400">Amazon repricer →</span>
            </Link>
            {card('local', 'Local only', localSizes, `${localOnly.length} styles · Shopify or Amazon?`)}
            {card('none', 'No stock', noStock.length, 'nothing to sell yet')}
          </section>

          {open && (
            <div className="mt-3 w-fit max-w-full rounded-lg border border-slate-200 bg-white shadow-sm">
              {open === 'local' && <StyleTable styles={localOnly} />}
              {open === 'none' && <SizeTable rows={noStock} showStock={false} />}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

const thCls = 'px-3 py-2.5 font-medium';

function SizeTable({ rows, showStock = true }: { rows: ProcessSizeRow[]; showStock?: boolean }) {
  return (
    <table className="text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          <th className={thCls + ' w-64 pl-4'}>Code</th>
          <th className={thCls}>Brand</th>
          <th className={thCls}>Added</th>
          {showStock && <th className={thCls + ' text-right'}>FBA</th>}
          {showStock && <th className={thCls + ' pr-4 text-right'}>Local</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.code} className="border-b border-slate-100 hover:bg-slate-50/60">
            <td className="whitespace-nowrap px-3 py-2 pl-4 font-mono tracking-tight text-slate-900" title={r.title || 'Untitled'}>{r.code}</td>
            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.brand || '—'}</td>
            <td className="whitespace-nowrap px-3 py-2 text-slate-500">{shortDate(r.created)}</td>
            {showStock && <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.fbaStock}</td>}
            {showStock && <td className="px-3 py-2 pr-4 text-right tabular-nums text-slate-700">{r.localStock}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StyleTable({ styles }: { styles: StyleRow[] }) {
  const [openStyle, setOpenStyle] = useState<string | null>(null);
  return (
    <table className="text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          <th className={thCls + ' w-64 pl-4'}>Group ID</th>
          <th className={thCls}>Brand</th>
          <th className={thCls}>Added</th>
          <th className={thCls + ' text-right'}>Sizes</th>
          <th className={thCls + ' pr-4 text-right'}>Local</th>
        </tr>
      </thead>
      <tbody>
        {styles.map((st) => {
          const isOpen = openStyle === st.groupid;
          return (
            <Fragment key={st.groupid}>
              <tr
                onClick={() => setOpenStyle(isOpen ? null : st.groupid)}
                className={'cursor-pointer border-b border-slate-100 ' + (isOpen ? 'bg-brand-50' : 'hover:bg-slate-50/60')}
              >
                <td className="whitespace-nowrap px-3 py-2 pl-4 font-mono tracking-tight text-slate-900" title={st.title || 'Untitled'}>
                  <ChevronRightIcon className={'mr-1 inline h-3 w-3 text-slate-400 transition-transform ' + (isOpen ? 'rotate-90' : '')} />
                  {st.groupid}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{st.brand || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{shortDate(st.created)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{st.sizes.length}</td>
                <td className="px-3 py-2 pr-4 text-right tabular-nums text-slate-700">{st.sizes.reduce((n, r) => n + r.localStock, 0)}</td>
              </tr>
              {isOpen && st.sizes.map((r) => (
                <tr key={r.code} className="border-b border-slate-100 bg-slate-50/50 text-xs">
                  <td className="py-1.5 pl-10 pr-3 font-mono text-slate-700" colSpan={4}>{r.code}</td>
                  <td className="px-3 py-1.5 pr-4 text-right tabular-nums text-slate-700">{r.localStock}</td>
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
