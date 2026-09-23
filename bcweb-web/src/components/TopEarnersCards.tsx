'use client';
/*
=======================================================================================================================================
Component: TopEarnersCards  (the Repricing screen's Top earners tab)
=======================================================================================================================================
Purpose: Top earners is ONE group with two channel cells, so it gets two cards instead of a one-row table (owner, 2026-09-23 — a table
         whose columns exist to compare rows had nothing to compare, and the two numbers you act on were small pills at the far right).
         Each card is three EQUAL tiles — Selling | Stuck | Both — each the count still due on that list and a straight link to it,
         mirroring the list page's own tabs. (A first cut led with a big "N due for review" hero that opened Both, with Selling /
         Stuck as smaller arrow links beneath; the owner wanted the three the same, 2026-09-23.) That channel's own revenue / GP sits
         in the footer.

LINKS: ?mode=winners / losers / all (the URL values keep the old names). Every link carries from=/segments&back=Repricing so
"← Repricing" returns here (bare /segments IS this tab — the default).

Consumes GET /pricing-top-earners (the segment-view row: Shopify + Amazon cells, each with selling/stuck/revenue30/gpPct).
=======================================================================================================================================
*/

import Link from 'next/link';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import ChannelBadge from '@/components/ChannelBadge';
import { useApiQuery } from '@/lib/useApiQuery';
import { getTopEarnersOverview, TopEarnerCell, TOP_EARNERS } from '@/lib/api';
import { fmtMoney } from '@/lib/segmentUi';

const BACK = `from=${encodeURIComponent('/segments')}&back=Repricing`;

function listHref(area: string, mode: 'winners' | 'losers' | 'all'): string {
  const base = area.toLowerCase() === 'amazon' ? '/amz' : '/pricing';
  return `${base}/${encodeURIComponent(TOP_EARNERS)}?by=topearners&mode=${mode}&${BACK}`;
}

// 'YYYY-MM-DD' -> "28 Sep". Built from the parts, never new Date(string) — that parses as UTC and can shift the day (CLAUDE.md dates).
function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function TopEarnersCards() {
  const { data, error, isLoading } = useApiQuery(['segments-top-earners-cards'], () => getTopEarnersOverview('segment'));
  const cells = data?.row.areas ?? [];

  return (
    <div>
      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>}
      {!isLoading && !error && (
        <div className="grid gap-4 sm:grid-cols-2">
          {cells.map((c) => <ChannelCard key={c.area} cell={c} />)}
        </div>
      )}
    </div>
  );
}

function ChannelCard({ cell }: { cell: TopEarnerCell }) {
  const isAmazon = cell.area.toLowerCase() === 'amazon';
  const due = cell.dueState === 'due';
  const pool = `${cell.instock ?? 0} top-earner ${isAmazon ? 'SKUs' : 'styles'}`;

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <ChannelBadge channel={isAmazon ? 'amazon' : 'shopify'} />
          <span className="text-sm text-slate-500">{pool}</span>
        </div>
        {due ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Tile href={listHref(cell.area, 'winners')} label="Selling" count={cell.selling} icon={ArrowTrendingUpIcon} tone="text-emerald-700" />
            <Tile href={listHref(cell.area, 'losers')} label="Stuck" count={cell.stuck} icon={ArrowTrendingDownIcon} tone="text-amber-700" />
            <Tile href={listHref(cell.area, 'all')} label="Both" count={cell.outstanding ?? 0} icon={Squares2X2Icon} tone="text-slate-700" />
          </div>
        ) : (
          <div className="mt-4 text-sm">
            <span className="font-semibold text-green-700">All done</span>
            <span className="text-slate-500"> · {cell.nextReview ? `next back ${fmtDay(cell.nextReview)}` : 'nothing to review'}</span>
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-slate-100 px-5 py-3 text-sm tabular-nums text-slate-500">
        {fmtMoney(cell.revenue30)} sales · {cell.gpPct !== null ? `${cell.gpPct}% GP` : '— GP'}
      </div>
    </div>
  );
}

// One tile = one list: the same icon + colour as that tab on the list page (components/ListViewControls), and the count still due on
// it. A zero tile stays visible but quiet and isn't a link — the split is still information, there's just nothing behind it.
function Tile({ href, label, count, icon: Icon, tone }: {
  href: string; label: string; count: number; icon: typeof ArrowTrendingUpIcon; tone: string;
}) {
  const live = count > 0;
  const inner = (
    <>
      <span className="flex items-center gap-1.5 text-sm">
        <Icon className={'h-4 w-4 ' + (live ? tone : 'text-slate-300')} />
        <span className={live ? 'text-slate-600' : 'text-slate-400'}>{label}</span>
      </span>
      <span className={'mt-1 block text-2xl font-bold leading-none tabular-nums ' + (live ? 'text-slate-900' : 'text-slate-300')}>{count}</span>
    </>
  );
  const cls = 'block rounded-lg border px-3 py-2.5';
  if (!live) return <div className={cls + ' border-slate-100 bg-slate-50/60'}>{inner}</div>;
  return <Link href={href} className={cls + ' border-slate-200 transition hover:border-slate-300 hover:bg-slate-50'}>{inner}</Link>;
}
