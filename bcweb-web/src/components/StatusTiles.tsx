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
import { useRouter, useSearchParams } from 'next/navigation';
import { ChannelLogo } from '@/components/ChannelBadge';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStatusOverview, updatePortfolioSnapshot, type PortfolioStatusName, type StatusChannelCounts } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowPathIcon } from '@heroicons/react/20/solid';
import { STATUS_RULE, statusListHref, barLabel } from '@/lib/portfolioStatusUi';

// 'YYYY-MM-DD HH:MM' -> '24 Sep, 22:44', from the string parts (never new Date — CLAUDE.md dates).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtStamp(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(s);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}, ${m[4]}` : s;
}

// `toolbar` = the page's Status | Segment | Campaign switch, drawn on the same row as the update control.
export default function StatusTiles({ toolbar }: { toolbar?: ReactNode }) {
  const { data, error, isLoading, refresh } = useApiQuery(['repricing-status-overview'], () => getStatusOverview());
  const { logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // THE TIER lives in the URL (?bar=2500) so "← Repricing" from a list lands back on the same tier. Only a mark the server offers
  // counts; anything else (absent, junk, an old bookmark) reads as the first mark — the tag's own bar, i.e. the normal screen.
  const bars = data?.winnerBars.map((w) => w.bar) ?? [];
  const rawBar = Number(searchParams.get('bar'));
  const bar = bars.includes(rawBar) ? rawBar : (bars[0] ?? null);
  const raised = bar !== null && bar !== bars[0];              // a higher tier than the tag: only WINNERS can answer it
  const barRow = data?.winnerBars.find((w) => w.bar === bar);
  const viewPath = raised ? `/segments?bar=${bar}` : '/segments';
  function setBar(next: number) {
    router.replace(next === bars[0] ? '/segments' : `/segments?bar=${next}`);
  }
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
        {bars.length > 1 && bar !== null && <BarDial bars={bars} selected={bar} onChange={setBar} />}
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
              tile with a bigger number, the other four in line after it. One row per channel, so both channels stay on one screen.
              At a raised tier WINNERS reads the tier's counts and the other four dim: they are the £1,500 tag and cannot answer it. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {data.statuses.map((s) => {
              const isWin = s.status === 'WINNERS';
              const counts = isWin && raised && barRow ? { ...s[ch], ...barRow[ch] } : s[ch];
              return (
                <Tile
                  key={s.status}
                  status={s.status}
                  counts={counts}
                  hero={isWin}
                  // Only WINNERS carries its rule on the tile — it is the one that changes with the tier. The other four are
                  // printed once, in the key under the last row (owner, 2026-09-25: the same text twice per status was noise).
                  rule={isWin ? (raised && bar !== null ? `${barLabel(bar)} in 12 months` : STATUS_RULE.WINNERS) : null}
                  href={statusListHref(s.status, viewPath, 'Repricing', ch, { bar: isWin && raised ? bar : null })}
                  dimmed={raised && !isWin}
                />
              );
            })}
          </div>
        </section>
      ))}
      {data && (
        <p className="text-xs text-slate-400">
          {data.statuses.filter((s) => s.status !== 'WINNERS').map((s, i) => (
            <span key={s.status}>
              {i > 0 && ' · '}
              <span className="font-medium text-slate-500">{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</span> — {STATUS_RULE[s.status]}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// The WINNERS tier — £1,500 / £2,500 / £5,000 / £10,000 of all-channel 12m turnover. A LOOKUP WITHIN THE TAG, not a re-tag (owner,
// 2026-09-25, having weighed it): a raised tier hides the winners under it and nothing else. A winner it hides does NOT move to
// another status — the tag records only the first rule a style matched, so what it would otherwise be is unknown — which is why the
// other four tiles dim at a raised tier instead of pretending to update. Rejected alternatives: storing a "status if not a winner"
// to re-sort properly (not worth it), and printing every tier inside the tile (too much on screen). No counts on the toggles.
function BarDial({ bars, selected, onChange }: { bars: number[]; selected: number; onChange: (b: number) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/70 p-1">
      {bars.map((b) => {
        const active = b === selected;
        return (
          <button
            key={b}
            type="button"
            onClick={() => onChange(b)}
            aria-pressed={active}
            className={
              'rounded-lg px-3 py-2 text-sm font-medium tabular-nums transition ' +
              (active ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')
            }
          >
            £{b.toLocaleString('en-GB')}
          </button>
        );
      })}
    </div>
  );
}

function Tile({ status, counts, hero, rule, href, dimmed }: {
  status: PortfolioStatusName; counts: StatusChannelCounts; hero: boolean; rule: string | null; href: string; dimmed: boolean;
}) {
  const live = counts.total > 0 && !dimmed;
  // The hero and the due line are both STYLES, on both channels. On Amazon a style is due if ANY of its sizes is (owner, 2026-09-25),
  // so the list the tile opens — per size, Amazon prices per size — can show more due rows than the tile's number.
  const inner = (
    <>
      <span className={'block font-semibold tracking-wide ' + (hero ? 'text-sm text-slate-700' : 'text-xs text-slate-500')}>{status}</span>
      <span className={'mt-2 block font-bold leading-none tabular-nums ' + (hero ? 'text-6xl ' : 'text-3xl ') + (counts.styles > 0 ? 'text-slate-900' : 'text-slate-300')}>
        {counts.styles}
      </span>
      {/* The work due — the length of the list the tile opens. Parked / out-of-stock counts dropped (owner, 2026-09-25). */}
      <span className={'mt-3 block tabular-nums text-slate-500 ' + (hero ? 'text-sm' : 'text-xs')}>
        {counts.dueStyles} due for review
      </span>
      {rule && <span className={'mt-2 block text-slate-400 ' + (hero ? 'text-xs' : 'text-[11px]')}>{rule}</span>}
    </>
  );
  const cls = 'block rounded-xl border bg-white shadow-sm ' + (hero ? 'col-span-2 p-5' : 'p-4');
  if (dimmed) return <div className={cls + ' border-slate-100 opacity-40'}>{inner}</div>;
  if (!live) return <div className={cls + ' border-slate-100 opacity-70'}>{inner}</div>;
  return (
    <Link href={href} className={cls + ' border-slate-200 transition hover:border-slate-300 hover:bg-slate-50'}>
      {inner}
    </Link>
  );
}
