'use client';
/*
=======================================================================================================================================
Page: /process/unsold — Unsold (opened from the Unsold card on Process, 2026-10-25)
=======================================================================================================================================
Purpose: the new sizes that have not sold anywhere, SPLIT BY WHERE THE STOCK SITS — the location already says which screen a size
belongs on, and it sets apart the one real decision (owner: "If it is an Amazon potential I will decide to send them to Amazon").
One CARD per group with its count, laid out like Process (owner: three stacked lists hid the other options):

  - AT FBA      already on Amazon and not selling. The card goes STRAIGHT to the Amazon repricer list of these SIZES
                (/amz/unsold-fba?by=process — owner: "No need for the local list. Send them there"), where the Due switch shows
                whether their prices are up to date. Sizes with stock in BOTH places sit here (already on Amazon).
  - LOCAL ONLY  the decision: keep on Shopify or send to Amazon. Tapping the card offers the two screens (owner, 2026-10-25):
                SHOPIFY REPRICER — these STYLES (/pricing/unsold-local?by=process; Shopify prices per style), or
                AMAZON ORDER — these SIZES (/amazon-order?process=unsold-local), on BOTH: listed ones to Pick, unlisted to No AMZ.
  (A third card, NO STOCK, went 2026-10-25: those were sizes listed but never bought, now left out of New altogether —
  utils/processMap.js → NEW_SIZES_SQL. Every unsold size now has stock in one place or the other.)

The linked cards carry just the number and its unit — no "go to" wording (owner: "The card is enough with the number in it"). The
repricer lists' server routes (amz-process-list / pricing-process-list) use the same rules (utils/processMap.js), so the counts match.
Same data and SWR key as Process (process-overview), so it opens from the cache.
=======================================================================================================================================
*/

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { getProcessOverview } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useApiQuery } from '@/lib/useApiQuery';
import { boxCls, isSold, isUnsoldLocalOnly } from '@/lib/process';

const BACK = '/process';

// The repricer lists the linked cards open; their back link returns here.
const BACK_HERE = `from=${encodeURIComponent('/process/unsold')}&back=Unsold`;
const FBA_HREF = `/amz/unsold-fba?by=process&${BACK_HERE}`;
const LOCAL_HREF = `/pricing/unsold-local?by=process&${BACK_HERE}`;
const LOCAL_AMZ_HREF = `/amazon-order?process=unsold-local&from=${encodeURIComponent('/process/unsold')}&back=Unsold`;

const cardIdle = 'border-slate-200 hover:border-brand-500 hover:shadow-md';
const choiceCls = 'rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:border-brand-500 hover:shadow-md';

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

  return (
    <AppShell title="Unsold" backHref={BACK} backLabel={prettyPathLabel(BACK)}>
      {q.isLoading && <div className="py-10 text-center text-sm text-slate-400">Loading…</div>}
      {q.error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{q.error.message}</div>}

      {d && (
        <section className="flex flex-wrap items-stretch gap-4">
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
    </AppShell>
  );
}
