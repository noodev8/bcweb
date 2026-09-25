'use client';
/*
=======================================================================================================================================
Component: StatusTiles  (the Repricing screen's Status tab — its first and default tab since 2026-09-24)
=======================================================================================================================================
Purpose: One tile per portfolio status (WINNERS | STEADY | NEW | HARVEST | LOSERS — the stored skusummary.portfolio_status tag, set
         by the Winners screen's "Update now"), for EACH CHANNEL: a Shopify row (styles) and an Amazon row (SKUs — Amazon prices per
         size; a SKU takes its style's status). It REPLACED the Top earners cards (owner, 2026-09-24: "This pricing group should
         replace the old top earners"), and Amazon joined the same day ("Apply amazon pricing in reprice").

         Each tile's hero is how many STYLES carry the status on that channel (owner, 2026-09-25: "show as standard the count of
         winners/steady etc. The outstanding items that need to be priced is secondary") — on Amazon too, styles not sizes, so both
         rows count the same thing. There is deliberately NO cross-channel total: a BOTH style sits on both rows, so the rows overlap
         and a sum would mislead (owner: "I'm literally interested in the split cleanly"). Beneath the hero, the pricing work: what is
         due (the length of the list it opens, Due on by default — sizes on Amazon). No parked / out-of-stock counts on the tile. OUT-OF-STOCK IS LISTED AND COUNTED IN
         DUE (owner, 2026-09-24: "I do want to reprice out of stock when adjusting prices in preparation for stock arrival... Don't want
         to leave them at old clearance price"). A tile opens ONE unsplit list (no Selling / Stuck); its "← Repricing" returns here.
         A status with nothing at all behind it is quiet and not a link.

         "Update now" (re-tag every style + record today's status point) lives here as well as on Winners — the first step of folding
         the Winners screen into this one. No success banner: the tiles and the stamp change when the refresh lands.

Consumes GET /pricing-status-overview and POST /portfolio-snapshot-update.
=======================================================================================================================================
*/

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChannelLogo } from '@/components/ChannelBadge';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStatusOverview, updatePortfolioSnapshot, type PortfolioStatusName, type StatusChannelCounts } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowPathIcon } from '@heroicons/react/20/solid';
import { STATUS_RULE, statusListHref } from '@/lib/portfolioStatusUi';

// 'YYYY-MM-DD HH:MM' -> '24 Sep, 22:44', from the string parts (never new Date — CLAUDE.md dates).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtStamp(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(s);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}, ${m[4]}` : s;
}

type Channel = 'shopify' | 'amazon';
// `toolbar` = the page's Status | Segment | Campaign switch, drawn on the same row as the update control.
export default function StatusTiles({ toolbar }: { toolbar?: ReactNode }) {
  const { data, error, isLoading, refresh } = useApiQuery(['repricing-status-overview'], () => getStatusOverview());
  const { logout } = useAuth();
  const [updating, setUpdating] = useState(false);
  // Kept apart from the query's own error so a failed Update doesn't tear down tiles that loaded fine.
  const [actionError, setActionError] = useState<string | null>(null);

  async function onUpdate() {
    setUpdating(true);
    setActionError(null);
    const res = await updatePortfolioSnapshot();
    if (res.success) {
      await refresh();
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setActionError(res.error || 'Failed to update');
    }
    setUpdating(false);
  }

  return (
    <div className="space-y-6">
      {/* The stamp and its refresh sit together as one quiet control: the date says how old the tags are, the button beside it is
          how to make them current. Neutral, not a brand-colour call to action — it is housekeeping, not the job of the screen. */}
      <div className="flex flex-wrap items-center gap-3">
        {toolbar}
        <div className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-3 pr-1 text-sm shadow-sm">
          <span className="text-slate-500">
            {data?.updatedAt ? <>Statuses set <span className="tabular-nums text-slate-700">{fmtStamp(data.updatedAt)}</span></> : data ? 'No statuses set yet' : 'Statuses'}
          </span>
          <button
            onClick={onUpdate}
            disabled={updating || isLoading}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ArrowPathIcon className={'h-4 w-4 text-slate-400' + (updating ? ' animate-spin' : '')} aria-hidden="true" />
            {updating ? 'Updating…' : 'Update now'}
          </button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {actionError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>}
      {data && (['shopify', 'amazon'] as const).map((ch) => (
        <section key={ch}>
          <h2 className="mb-3 flex items-center gap-2.5 text-lg font-semibold text-slate-900">
            <ChannelLogo channel={ch} size="md" />
            {ch === 'amazon' ? 'Amazon' : 'Shopify'}
          </h2>
          {/* WINNERS LEADS (owner, 2026-09-25: "make the Winners tab more powerful/bigger — with the others following"): a double-width
              tile with a bigger number, the other four in line after it. One row per channel, so both channels stay on one screen. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {data.statuses.map((s) => (
              <Tile key={s.status} status={s.status} channel={ch} counts={s[ch]} hero={s.status === 'WINNERS'} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Tile({ status, channel, counts, hero }: {
  status: PortfolioStatusName; channel: Channel; counts: StatusChannelCounts; hero: boolean;
}) {
  const live = counts.total > 0;
  // The hero is STYLES on both channels. Amazon's list rows are SIZES (Amazon prices per size), so its work line says sizes: those
  // match the rows of the list the tile opens (owner, 2026-09-25: "23 styles ... showing 78").
  const isAmz = channel === 'amazon';
  const inner = (
    <>
      <span className={'block font-semibold tracking-wide ' + (hero ? 'text-sm text-slate-700' : 'text-xs text-slate-500')}>{status}</span>
      <span className={'mt-2 block font-bold leading-none tabular-nums ' + (hero ? 'text-6xl ' : 'text-3xl ') + (counts.styles > 0 ? 'text-slate-900' : 'text-slate-300')}>
        {counts.styles}
      </span>
      {/* The work due — the length of the list the tile opens. Parked / out-of-stock counts dropped (owner, 2026-09-25). */}
      <span className={'mt-3 block tabular-nums text-slate-500 ' + (hero ? 'text-sm' : 'text-xs')}>
        {isAmz ? `${counts.due} of ${counts.total} sizes due` : `${counts.due} due for review`}
      </span>
      <span className={'mt-2 block text-slate-400 ' + (hero ? 'text-xs' : 'text-[11px]')}>{STATUS_RULE[status]}</span>
    </>
  );
  const cls = 'block rounded-xl border bg-white shadow-sm ' + (hero ? 'col-span-2 p-5' : 'p-4');
  if (!live) return <div className={cls + ' border-slate-100 opacity-70'}>{inner}</div>;
  return (
    <Link href={statusListHref(status, '/segments', 'Repricing', channel)} className={cls + ' border-slate-200 transition hover:border-slate-300 hover:bg-slate-50'}>
      {inner}
    </Link>
  );
}
