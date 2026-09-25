'use client';
/*
=======================================================================================================================================
Component: StatusTiles  (the Repricing screen's Status tab — its first and default tab since 2026-09-24)
=======================================================================================================================================
Purpose: One tile per portfolio status (WINNERS | STEADY | NEW | HARVEST | LOSERS — the stored skusummary.portfolio_status tag, set
         by "Update now" here), for EACH CHANNEL: a Shopify row (styles) and an Amazon row (SKUs — Amazon prices per
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

         THE WINNERS SCREEN LIVES HERE NOW (retired as its own page 2026-09-25 — owner: "the same screen for two different points of
         view", simple repricing and analysing winners). Its dashboard card opens this tab. From it came "Update now" (re-tag every
         style + record today's status point; no success banner — the tiles and stamp change when the refresh lands), the tier
         toggle, winners by brand and the status trend, all re-cut per channel.

Consumes GET /pricing-status-overview, GET /portfolio-status and POST /portfolio-snapshot-update.
=======================================================================================================================================
*/

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChannelLogo } from '@/components/ChannelBadge';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStatusOverview, getPortfolioStatus, updatePortfolioSnapshot, type PortfolioChannel, type PortfolioChannelKey, type PortfolioStatusPoint, type TaggedWinner, type PortfolioStatusName, type StatusChannelCounts } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import StatusTrendChart from '@/components/StatusTrendChart';
import { ArrowPathIcon, CheckIcon } from '@heroicons/react/20/solid';
import { STATUS_COLOR, STATUS_RULE, statusListHref, barLabel } from '@/lib/portfolioStatusUi';

// 'YYYY-MM-DD HH:MM' -> '24 Sep, 22:44', from the string parts (never new Date — CLAUDE.md dates).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtStamp(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(s);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}, ${m[4]}` : s;
}

// `toolbar` = the page's Status | Segment | Campaign switch, drawn on the same row as the update control.
export default function StatusTiles({ toolbar }: { toolbar?: ReactNode }) {
  const { data, error, isLoading, refresh } = useApiQuery(['repricing-status-overview'], () => getStatusOverview());
  // The brand breakdown and the status trend (from the retired Winners screen). GET /portfolio-status — stored tags only. The key is
  // shared with Reports → New's WinnersStrip, so one fetch serves both.
  const portfolio = useApiQuery('portfolio-status', () => getPortfolioStatus());
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
      await Promise.all([refresh(), portfolio.refresh()]);
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

      {portfolio.data && (
        <BrandSplit winners={portfolio.data.winners} bar={raised ? bar : null} />
      )}
      {portfolio.data && <TrendByChannel history={portfolio.data.history} dimmed={raised} />}
    </div>
  );
}

// Is a style with this lead channel on that channel's lists? Its own channel, or BOTH — the server's channelFilterSql, so a brand's
// counts add up to the WINNERS tiles.
const onChannel = (c: PortfolioChannel, key: PortfolioChannelKey) => c === key || c === 'BOTH';

// WINNERS BY BRAND, SPLIT BY CHANNEL (owner, 2026-09-25 — chose this over the Winners screen's all-channel list, which summed across
// channels). Each brand shows its Shopify and Amazon winner counts; a column adds up to its WINNERS tile, a BOTH style counting on
// both. It follows the tier (on the STAMPED revenue, as the tiles do). No "units shifted": units are stored only all-channel, so a
// per-channel column can't carry them honestly. Each column's bar is scaled to that channel's biggest brand.
function BrandSplit({ winners, bar }: { winners: TaggedWinner[]; bar: number | null }) {
  const rows = useMemo(() => {
    const m = new Map<string, { brand: string; SHP: number; AMZ: number }>();
    for (const w of winners) {
      if (bar !== null && !(w.revenue12m > bar)) continue;
      const key = (w.brand || '').trim() || 'Unbranded';
      const b = m.get(key) || { brand: key, SHP: 0, AMZ: 0 };
      if (onChannel(w.channel, 'SHP')) b.SHP += 1;
      if (onChannel(w.channel, 'AMZ')) b.AMZ += 1;
      m.set(key, b);
    }
    return [...m.values()].sort((a, b) => Math.max(b.SHP, b.AMZ) - Math.max(a.SHP, a.AMZ) || a.brand.localeCompare(b.brand));
  }, [winners, bar]);
  if (rows.length === 0) return null;
  const top = { SHP: Math.max(1, ...rows.map((r) => r.SHP)), AMZ: Math.max(1, ...rows.map((r) => r.AMZ)) };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 grid grid-cols-[8rem_1fr_1fr] items-center gap-x-6 text-xs text-slate-400">
        <span>winners by brand{bar !== null ? `, ${barLabel(bar)}` : ''}</span>
        <span className="flex items-center gap-2"><ChannelLogo channel="shopify" /> Shopify</span>
        <span className="flex items-center gap-2"><ChannelLogo channel="amazon" /> Amazon</span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.brand} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-x-6 text-sm">
            <span className="truncate text-slate-600" title={r.brand}>{r.brand}</span>
            {(['SHP', 'AMZ'] as const).map((ch) => (
              <span key={ch} className="flex items-center gap-3">
                <span className={'w-6 flex-none text-right tabular-nums ' + (r[ch] > 0 ? 'font-medium text-slate-900' : 'text-slate-300')}>{r[ch]}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  {r[ch] > 0 && <span className="block h-full rounded-full bg-slate-400" style={{ width: `${Math.max(2, (r[ch] / top[ch]) * 100)}%` }} />}
                </span>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

// THE STATUS TREND, PER CHANNEL (owner, 2026-09-25): a Shopify | Amazon switch, so each line is one channel's count and matches its
// row of tiles — never an all-channel total. Channel counts were first recorded on 2026-09-25, so readings before that are skipped
// and the graph waits for a second channel reading. Greyed at a raised tier: it records the £1,500 tag, not the tier.
function TrendByChannel({ history, dimmed }: { history: PortfolioStatusPoint[]; dimmed: boolean }) {
  const [ch, setCh] = useState<PortfolioChannelKey>('SHP');
  const rows = useMemo<PortfolioStatusPoint[]>(
    () => history.filter((h) => h.channels).map((h) => ({ ...h, ...h.channels![ch] })),
    [history, ch]
  );
  const switcher = (
    <span className="inline-flex rounded-md border border-slate-200 bg-white p-0.5" role="group" aria-label="Channel">
      {(['SHP', 'AMZ'] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => setCh(k)}
          aria-pressed={ch === k}
          title={k === 'SHP' ? 'Shopify' : 'Amazon'}
          className={'flex h-7 items-center rounded px-1.5 transition ' + (ch === k ? 'bg-slate-100 ring-1 ring-slate-300' : 'opacity-50 hover:opacity-100')}
        >
          <ChannelLogo channel={k === 'SHP' ? 'shopify' : 'amazon'} />
        </button>
      ))}
    </span>
  );

  if (rows.length < 2) {
    return (
      <p className="text-xs text-slate-400">
        Status over time: one channel reading so far — the graph appears after the next Update on another day.
      </p>
    );
  }
  return (
    <div
      className={dimmed ? 'pointer-events-none opacity-40 grayscale transition' : 'transition'}
      aria-disabled={dimmed}
      title={dimmed ? 'Tagged at £1,500 — not affected by the tier' : undefined}
    >
      <StatusTrendChart rows={rows} showTotal={false} headerExtra={switcher} />
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
      {/* The status dot is the same key the status trend chart below uses — identity, not decoration. */}
      <span className={'flex items-center gap-2 font-semibold tracking-wide ' + (hero ? 'text-sm text-slate-700' : 'text-xs text-slate-500')}>
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[status] }} />
        {status}
      </span>
      <span className={'mt-2 block font-bold leading-none tabular-nums ' + (hero ? 'text-6xl ' : 'text-3xl ') + (counts.styles > 0 ? 'text-slate-900' : 'text-slate-300')}>
        {counts.styles}
      </span>
      {/* The work due, as TEXT (owner, 2026-09-25 — red pills were tried and "felt bolted on": nearly every tile is due, so red
          everywhere signalled nothing and a box inside a card was one layer too many). Only the count is darker. Colour is kept for
          the exception worth noticing — nothing left to price — as a green tick, no box. No styles at all = no line. */}
      {counts.styles > 0 && (
        counts.dueStyles > 0 ? (
          <span className={'mt-3 block tabular-nums text-slate-500 ' + (hero ? 'text-sm' : 'text-xs')}>
            <span className="font-semibold text-slate-800">{counts.dueStyles}</span> due for review
          </span>
        ) : (
          <span className={'mt-3 flex items-center gap-1 font-medium text-green-700 ' + (hero ? 'text-sm' : 'text-xs')}>
            <CheckIcon className="h-4 w-4" aria-hidden="true" />all priced
          </span>
        )
      )}
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
