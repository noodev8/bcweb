'use client';
/*
=======================================================================================================================================
Component: StatusTiles  (the Repricing screen's Status tab — its first and default tab since 2026-09-24)
=======================================================================================================================================
Purpose: One tile per portfolio status (WINNERS | STEADY | NEW | HARVEST | LOSERS — the stored skusummary.portfolio_status tag, set
         by the Winners screen's "Update now"), for EACH CHANNEL: a Shopify row (styles) and an Amazon row (SKUs — Amazon prices per
         size; a SKU takes its style's status). It REPLACED the Top earners cards (owner, 2026-09-24: "This pricing group should
         replace the old top earners"), and Amazon joined the same day ("Apply amazon pricing in reprice").

         Each tile's hero is what is DUE FOR REVIEW — the length of the list it opens, since that list has the Due switch on by default.
         Beneath it: how many are parked (switch Due off to see them) and how many have no stock. OUT-OF-STOCK IS LISTED AND COUNTED IN
         DUE (owner, 2026-09-24: "I do want to reprice out of stock when adjusting prices in preparation for stock arrival... Don't want
         to leave them at old clearance price"). A tile opens ONE unsplit list (no Selling / Stuck); its "← Repricing" returns here.
         A status with nothing at all behind it is quiet and not a link.

Consumes GET /pricing-status-overview.
=======================================================================================================================================
*/

import Link from 'next/link';
import ChannelBadge from '@/components/ChannelBadge';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStatusOverview, type PortfolioStatusName, type StatusChannelCounts } from '@/lib/api';
import { STATUS_COLOR, STATUS_RULE, statusListHref } from '@/lib/portfolioStatusUi';

// 'YYYY-MM-DD HH:MM' -> '24 Sep, 22:44', from the string parts (never new Date — CLAUDE.md dates).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtStamp(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(s);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}, ${m[4]}` : s;
}

type Channel = 'shopify' | 'amazon';
const WINNERS_LINK = '/analytics/winners?from=/segments&back=Repricing';

export default function StatusTiles() {
  const { data, error, isLoading } = useApiQuery(['repricing-status-overview'], () => getStatusOverview());

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        {data?.updatedAt ? (
          <>Statuses set {fmtStamp(data.updatedAt)} — refresh them with <Link href={WINNERS_LINK} className="text-slate-700 underline decoration-slate-300 hover:decoration-slate-500">Update now on Winners</Link></>
        ) : data ? (
          <>No statuses set yet — press <Link href={WINNERS_LINK} className="text-slate-700 underline">Update now on Winners</Link></>
        ) : ' '}
      </p>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>}
      {data && (['shopify', 'amazon'] as const).map((ch) => (
        <section key={ch}>
          <div className="mb-2 flex items-center gap-3">
            <ChannelBadge channel={ch} />
            <span className="text-xs text-slate-400">{ch === 'amazon' ? 'per size (SKU)' : 'per style'}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {data.statuses.map((s) => <Tile key={s.status} status={s.status} channel={ch} counts={s[ch]} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function Tile({ status, channel, counts }: { status: PortfolioStatusName; channel: Channel; counts: StatusChannelCounts }) {
  const live = counts.total > 0;
  const unit = channel === 'amazon' ? 'SKUs' : 'styles';
  const inner = (
    <>
      <span className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[status] }} />
        {status}
      </span>
      <span className={'mt-2 block text-3xl font-bold leading-none tabular-nums ' + (counts.due > 0 ? 'text-slate-900' : 'text-slate-300')}>
        {counts.due}
      </span>
      <span className="mt-1 block text-xs text-slate-500">due for review</span>
      <span className="mt-3 block text-xs tabular-nums text-slate-400">
        {counts.total} {unit}{counts.parked > 0 && ` · ${counts.parked} parked`}
      </span>
      {counts.outOfStock > 0 && <span className="block text-xs tabular-nums text-slate-400">{counts.outOfStock} out of stock</span>}
      <span className="mt-2 block text-[11px] text-slate-400">{STATUS_RULE[status]}</span>
    </>
  );
  const cls = 'block rounded-xl border bg-white p-4 shadow-sm';
  if (!live) return <div className={cls + ' border-slate-100 opacity-70'}>{inner}</div>;
  return (
    <Link href={statusListHref(status, '/segments', 'Repricing', channel)} className={cls + ' border-slate-200 transition hover:border-slate-300 hover:bg-slate-50'}>
      {inner}
    </Link>
  );
}
