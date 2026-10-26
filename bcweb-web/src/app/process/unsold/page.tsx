'use client';
/*
=======================================================================================================================================
Page: /process/unsold — Unsold (opened from the Unsold card on Today, 2026-10-25)
=======================================================================================================================================
Purpose: the new sizes that have not sold anywhere — since 2026-10-26 ONE LIST of all of them, FBA and local together (owner: "I don't
care about fba vs local, just give me the list of all of them", on its own screen rather than a drop-down on Today). By size: Code
(title in the tooltip) · Brand · Added, oldest first — longest without a sale at the top. Every column sorts; tap again to reverse.

THE SPLIT BY STOCK (2026-10-25) IS HIDDEN, NOT DELETED — flip SHOW_SPLIT to bring the cards back above the list:
  - AT FBA      already on Amazon and not selling. The card goes STRAIGHT to the Amazon repricer list of these SIZES
                (/amz/unsold-fba?by=process). Sizes with stock in BOTH places sit here (already on Amazon).
  - LOCAL ONLY  the decision: keep on Shopify or send to Amazon. Tapping the card offers the two screens:
                SHOPIFY REPRICER — these STYLES (/pricing/unsold-local?by=process; Shopify prices per style), or
                AMAZON ORDER — these SIZES (/amazon-order?process=unsold-local), on BOTH: listed ones to Pick, unlisted to No AMZ.
The repricer lists' server routes (amz-process-list / pricing-process-list) use the same rules (utils/processMap.js), so the counts match.
Same data and SWR key as Today (process-overview), so it opens from the cache.
=======================================================================================================================================
*/

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { getProcessOverview, type ProcessSizeRow } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useApiQuery } from '@/lib/useApiQuery';
import { boxCls, isSold, isUnsoldLocalOnly, shortDate } from '@/lib/process';

const BACK = '/process';

// The FBA / Local only cards above the list — hidden 2026-10-26 (owner: one list, don't split). true brings them back.
const SHOW_SPLIT = false;

// The repricer lists the linked cards open; their back link returns here.
const BACK_HERE = `from=${encodeURIComponent('/process/unsold')}&back=Unsold`;
const FBA_HREF = `/amz/unsold-fba?by=process&${BACK_HERE}`;
const LOCAL_HREF = `/pricing/unsold-local?by=process&${BACK_HERE}`;
const LOCAL_AMZ_HREF = `/amazon-order?process=unsold-local&from=${encodeURIComponent('/process/unsold')}&back=Unsold`;

const cardIdle = 'border-slate-200 hover:border-brand-500 hover:shadow-md';
const choiceCls = 'rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-brand-500 hover:shadow-md';

type SortKey = 'code' | 'brand' | 'added';

function CardBody({ label, n, unit }: { label: string; n: number; unit: string }) {
  return (
    <>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-4xl font-semibold tabular-nums text-slate-900">{n}</span>
      <span className="text-xs text-slate-400">{unit}</span>
    </>
  );
}

export default function ProcessUnsoldPage() {
  const q = useApiQuery('process-overview', () => getProcessOverview());
  const d = q.data;

  const unsold = d ? d.rows.filter((r) => !isSold(r)) : [];
  const atFba = unsold.filter((r) => r.fbaStock > 0).length;
  const localRows = d ? d.rows.filter(isUnsoldLocalOnly) : [];
  const localStyles = new Set(localRows.map((r) => r.groupid)).size;
  const [choosing, setChoosing] = useState(false);

  // Oldest added first by default. Text columns start A→Z, the date oldest first; tap again to reverse.
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'added', desc: false });
  const toggleSort = (key: SortKey) => setSort((cur) => (cur.key === key ? { key, desc: !cur.desc } : { key, desc: false }));
  const sortVal: Record<SortKey, (r: ProcessSizeRow) => string> = {
    code: (r) => r.code,
    brand: (r) => (r.brand || '').toLowerCase(),
    added: (r) => r.created,
  };
  // Server order (newest created, groupid, sizes in size order) is the tie-break — Array.sort is stable.
  const list = [...unsold].sort((a, b) => {
    const c = sortVal[sort.key](a).localeCompare(sortVal[sort.key](b));
    return sort.desc ? -c : c;
  });

  const th = (key: SortKey, label: string, cls: string) => (
    <th className={'sticky top-0 z-10 bg-white shadow-[inset_0_-1px_0_rgb(226_232_240)] ' + cls}>
      <button
        type="button" onClick={() => toggleSort(key)}
        className={'inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ' + (sort.key === key ? 'text-slate-800' : '')}
      >
        {label}{sort.key === key && <span className="text-[10px]">{sort.desc ? '▼' : '▲'}</span>}
      </button>
    </th>
  );

  return (
    <AppShell title="Unsold" backHref={BACK} backLabel={prettyPathLabel(BACK)}>
      {q.isLoading && <div className="py-10 text-center text-sm text-slate-400">Loading…</div>}
      {q.error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{q.error.message}</div>}

      {d && SHOW_SPLIT && (
        <section className="mb-4 flex flex-wrap items-stretch gap-4">
          <Link href={FBA_HREF} className={boxCls + ' ' + cardIdle}>
            <CardBody label="At FBA" n={atFba} unit="sizes" />
          </Link>
          <button
            type="button" onClick={() => setChoosing(!choosing)}
            className={boxCls + ' ' + (choosing ? 'border-brand-500 ring-1 ring-brand-500' : cardIdle)}
          >
            <CardBody label="Local only" n={localStyles} unit="styles" />
          </button>
          {/* The two ways on, beside the card that offered them. */}
          {choosing && (
            <div className="flex flex-col justify-center gap-2">
              <Link href={LOCAL_HREF} className={choiceCls}>
                Shopify repricer <span className="text-slate-400">· {localStyles} styles</span>
              </Link>
              <Link href={LOCAL_AMZ_HREF} className={choiceCls}>
                Amazon Order <span className="text-slate-400">· {localRows.length} sizes</span>
              </Link>
            </div>
          )}
        </section>
      )}

      {d && (
        <div className="w-fit max-w-full rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
            Unsold <span className="font-normal text-slate-500">· {unsold.length} sizes</span>
          </div>
          {unsold.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400">Every new size has sold somewhere.</p>
          ) : (
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  {th('code', 'Code', 'w-64 px-4 py-2.5 font-medium')}
                  {th('brand', 'Brand', 'px-3 py-2.5 font-medium')}
                  {th('added', 'Added', 'py-2.5 pl-3 pr-4 font-medium')}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.code} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    {/* Title in the tooltip — the code is what gets read, as on the other Today lists. */}
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-sm tracking-tight text-slate-900" title={r.title || 'Untitled'}>
                      {r.code}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.brand || '—'}</td>
                    <td className="whitespace-nowrap py-2 pl-3 pr-4 text-slate-500">{shortDate(r.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </AppShell>
  );
}
