'use client';
/*
=======================================================================================================================================
Component: StatusTiles  (the Repricing screen's Status tab — its first and default tab since 2026-09-24)
=======================================================================================================================================
Purpose: One tile per portfolio status (WINNERS | STEADY | NEW | LOSERS — the stored skusummary.portfolio_status tag, set
         by "Update now" here), for EACH CHANNEL: a Shopify row (styles) and an Amazon row (SKUs — Amazon prices per
         size; a SKU takes its style's status). It REPLACED the Top earners cards (owner, 2026-09-24: "This pricing group should
         replace the old top earners"), and Amazon joined the same day ("Apply amazon pricing in reprice").

         Each tile's hero is how many STYLES carry the status on that channel (owner, 2026-09-25: "show as standard the count of
         winners/steady etc. The outstanding items that need to be priced is secondary") — on Amazon too, styles not sizes, so both
         rows count the same thing. There is deliberately NO cross-channel total: a BOTH style sits on both rows, so the rows overlap
         and a sum would mislead (owner: "I'm literally interested in the split cleanly"). Beneath the hero, the pricing work: what is
         due (the length of the list it opens, Due on by default — sizes on Amazon). No parked / out-of-stock counts on the tile. OUT-OF-STOCK IS LISTED AND COUNTED IN
         DUE (owner, 2026-09-24: "I do want to reprice out of stock when adjusting prices in preparation for stock arrival... Don't want
         to leave them at old clearance price"). A tile opens ONE unsplit list (no Selling / Stuck); its "← Back" returns here.
         A status with nothing at all behind it is quiet and not a link.

         THE WINNERS SCREEN LIVES HERE NOW (retired as its own page 2026-09-25 — owner: "the same screen for two different points of
         view", simple repricing and analysing winners). Its dashboard card opens this tab. From it came "Update now" (re-tag every
         style; no success banner — the tiles and stamp change when the refresh lands), the tier toggle and winners by brand, all
         re-cut per channel. The status trend came too and was removed 2026-09-25 (see routes/portfolio-snapshot-update.js).

         SLOW (2026-10-12, owner: "WINNERS needs a card for CLEARANCE screen navigation and back" — then named "Slow"). Its column in the
         Stock now card opens Slow (/analytics/stock-sales), the sitting list across ALL channels (no sale anywhere in 60 days).
         ← Back there returns here. STOCK NOW (2026-10-13) leads the page and puts Winners and Slow on one base. See StockNowCard.

Consumes GET /pricing-status-overview, GET /portfolio-status, POST /portfolio-snapshot-update and GET /analytics-stock-sitting
(the Slow card — the same call and SWR key Slow reads, so the card and the page agree).
=======================================================================================================================================
*/

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChannelLogo } from '@/components/ChannelBadge';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStatusOverview, getPortfolioStatus, updatePortfolioSnapshot, getStockSitting, type PortfolioChannel, type PortfolioChannelKey, type TaggedWinner, type PortfolioStatusName, type StatusChannelCounts, type StockSittingData } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowPathIcon, CheckIcon, Squares2X2Icon } from '@heroicons/react/20/solid';
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
  // The brand breakdown (from the retired Winners screen). GET /portfolio-status — stored tags only.
  const portfolio = useApiQuery('portfolio-status', () => getPortfolioStatus());
  // The Slow card's numbers (see the header). Same SWR key as Slow, so opening it after is instant.
  const sitting = useApiQuery('analytics-stock-sitting', () => getStockSitting());
  const { logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // THE TIER lives in the URL (?bar=2500) so "← Back" from a list lands back on the same tier. Only a mark the server offers
  // counts; anything else (absent, junk, an old bookmark) reads as the first mark — the tag's own bar, i.e. the normal screen.
  const bars = data?.winnerBars.map((w) => w.bar) ?? [];
  const rawBar = Number(searchParams.get('bar'));
  const bar = bars.includes(rawBar) ? rawBar : (bars[0] ?? null);
  const raised = bar !== null && bar !== bars[0];              // a higher tier than the tag: only WINNERS can answer it
  const barRow = data?.winnerBars.find((w) => w.bar === bar);
  const viewPath = raised ? `/segments?bar=${bar}` : '/segments';
  // WINNERS' SHARE at the tier, for the Stock now card (see StockNowCard): styles and pairs WITH STOCK, on the same base as Slow.
  const winnersShare: WinnersShare | undefined = barRow && data
    ? { styles: barRow.share.heldStyles, units: barRow.share.units,
        revenuePct: data.shareTotals.revenue > 0 ? Math.round((barRow.share.revenue / data.shareTotals.revenue) * 100) : null }
    : undefined;
  const stockTotals: StockTotals | undefined = data ? { styles: data.shareTotals.heldStyles, units: data.shareTotals.units } : undefined;
  // Each channel's winners by brand, at the tier — drawn INSIDE that channel's WINNERS tile (owner, 2026-09-25: "I am changing the
  // tier and scrolling"), so the number and its brands change together right under the toggle.
  const winnerBrands = useMemo(
    () => brandsByChannel(portfolio.data?.winners ?? [], raised ? bar : null),
    [portfolio.data, raised, bar]
  );
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
      {/* Stock now LEADS the page: Winners and Slow on one base (see StockNowCard). Winners at the top was the owner's 2026-10-12 call. */}
      {data && <StockNowCard winners={winnersShare} winnersRule={raised && bar !== null ? `${barLabel(bar)} in 12 months` : STATUS_RULE.WINNERS}
        slow={sitting.data} totals={stockTotals} />}
      {data && (['shopify', 'amazon'] as const).map((ch) => (
        <section key={ch}>
          <h2 className="mb-3 flex items-center gap-2.5 text-lg font-semibold text-slate-900">
            <ChannelLogo channel={ch} size="md" />
            {ch === 'amazon' ? 'Amazon' : 'Shopify'}
          </h2>
          {/* WINNERS LEADS (owner, 2026-09-25: "make the Winners tab more powerful/bigger — with the others following"): a double-width
              tile with a bigger number, the other three in line after it. One row per channel, so both channels stay on one screen.
              At a raised tier WINNERS reads the tier's counts and the other three dim: they are the £1,500 tag and cannot answer it.
              Five columns: WINNERS spans two, then STEADY / NEW / LOSERS (HARVEST retired 2026-09-26). */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {data.statuses.map((s) => {
              const isWin = s.status === 'WINNERS';
              const counts = isWin && raised && barRow ? { ...s[ch], ...barRow[ch] } : s[ch];
              return (
                <Tile
                  key={s.status}
                  status={s.status}
                  counts={counts}
                  hero={isWin}
                  // Only WINNERS carries its rule on the tile — it is the one that changes with the tier. The other three were
                  // printed once in a key under the last row, removed 2026-10-12 (owner asked; the rules are in lib/portfolioStatusUi).
                  rule={isWin ? (raised && bar !== null ? `${barLabel(bar)} in 12 months` : STATUS_RULE.WINNERS) : null}
                  href={statusListHref(s.status, viewPath, 'Back', ch, { bar: isWin && raised ? bar : null })}
                  dimmed={raised && !isWin}
                  brands={isWin && portfolio.data ? winnerBrands[ch === 'amazon' ? 'AMZ' : 'SHP'] : undefined}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// STOCK NOW (owner, 2026-10-13: "I want them to line up. I want the numbers to make sense ... glance at the screen and see it").
// It REPLACED two cards, an all-channel Winners card at the top and a Slow card at the bottom. Their % sat on different bases: Winners'
// "21% of all" was STYLES over every TAGGED style (out of stock included) and Slow's "8%" was PAIRS over stock, so the two read as
// comparable and weren't. Now ONE base, what we hold right now: every style with stock and every pair (local #FREE + Amazon FBA,
// utils/stockSitting.js's definition). The two totals head the card, and under them
// two columns, Winners | Slow, each: styles box (% of styles, styles) then stock box (% of stock, pairs). Winners also keeps "% of 12m revenue" (owner, 2026-10-12:
// "I struggle to understand it, but I want it"), with all winners in stock or not, over every tagged style's revenue.
//   - THE TOTAL is the overview's (share_totals). Slow's own read has its own live total, which can differ by today's movement, so
//     Slow's % here can be a point off the Slow page in a rare case. One total was chosen so both columns agree.
//   - WINNERS AND SLOW CAN OVERLAP: a winner (12 months) with no sale in 60 days is both (1 style, 7 pairs on 13 Oct). Each column
//     counts it, so the two never add up to an exact split of the stock.
//   - The Winners column follows the tier dial. Slow doesn't: it has no tier.
//   - The Slow column is the link to Slow (as the old card was), anchored #slow for its "← Back". The Winners column isn't a link:
//     the per-channel WINNERS tiles are the way into those lists.
const SLOW_HREF = `/analytics/stock-sales?from=${encodeURIComponent('/segments#slow')}&back=${encodeURIComponent('Winners')}`;
const SLOW_COLOR = '#b91c1c';   // not a status colour: Slow is a fact about sales, not a portfolio status (LOSERS is pink)
type WinnersShare = { styles: number; units: number; revenuePct: number | null };
type StockTotals = { styles: number; units: number };
function StockNowCard({ winners, winnersRule, slow, totals }: {
  winners?: WinnersShare; winnersRule: string; slow?: StockSittingData; totals?: StockTotals;
}) {
  const pct = (v: number | undefined, d: number | undefined) => (v != null && d ? Math.round((v / d) * 100) : null);
  const n = (v: number | undefined) => (v != null ? v.toLocaleString('en-GB') : '–');
  const pctText = (v: number | undefined, d: number | undefined) => { const x = pct(v, d); return x !== null ? `${x}%` : '–'; };
  const slowUnits = slow?.sitting_units;
  const rows = [
    { key: 'winners', name: 'Winners', rule: winnersRule, color: STATUS_COLOR.WINNERS, styles: winners?.styles, units: winners?.units,
      revenuePct: winners?.revenuePct ?? null },
    { key: 'slow', name: 'Slow', rule: `no sale on any channel in ${slow?.days ?? 60} days`, color: SLOW_COLOR,
      styles: slow?.styles.length, units: slowUnits, revenuePct: null },
  ];
  return (
    <section id="slow" className="scroll-mt-6">
      <h2 className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-lg font-semibold text-slate-900">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white shadow-sm ring-1 ring-slate-200">
          <Squares2X2Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
        </span>
        All channels
        <span className="text-slate-300" aria-hidden="true">·</span>
        <span>Stock now</span>
      </h2>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* THE TOTALS, the baseline every % below divides by, styles first as in the boxes. Two big share bars sat here (styles,
            pairs) until the boxes got bars of their own; then they repeated them and were removed (owner, 2026-10-13: "remove the top
            bars. But find somewhere to show the totals clear"). */}
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
          <span className="text-sm font-medium text-slate-500">In stock</span>
          <span className="tabular-nums text-slate-500"><span className="text-2xl font-bold text-slate-900">{n(totals?.styles)}</span> styles</span>
          <span className="tabular-nums text-slate-500"><span className="text-2xl font-bold text-slate-900">{n(totals?.units)}</span> pairs</span>
        </div>

        {/* TWO COLUMNS, WINNERS | SLOW (owner, 2026-10-13: "WINNERS and under it the Styles winners and the stock winners. The next
            column will have SLOW and under it, styles and stock"). Was two ROWS (name | styles | stock across), which read the wrong way.
            Now the styles boxes sit side by side and the stock boxes sit side by side, so across compares Winners with Slow on one base,
            and down reads one group, in the bars' order (styles, then stock). Each box is % then the number it comes from, as before.
            Revenue sits last under Winners (Winners only, and a different base, so boxed alone). The totals are beside the bars. */}
        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
          {rows.map((r) => {
            const body = (
              <>
                <span className="block">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                    {r.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">{r.rule}</span>
                </span>
                {/* Each box carries a small bar of its own % in the column's colour (owner, 2026-10-13: too much clear space to the
                    right of the numbers). The revenue box has an empty slot where the count would be, so all three bars start in line. */}
                <FigureGroup pct={pct(r.styles, totals?.styles)} color={r.color}>
                  <Figure value={pctText(r.styles, totals?.styles)} strong />
                  <Figure value={n(r.styles)} label="styles" />
                </FigureGroup>
                <FigureGroup pct={pct(r.units, totals?.units)} color={r.color}>
                  <Figure value={pctText(r.units, totals?.units)} strong />
                  <Figure value={n(r.units)} label="pairs" />
                </FigureGroup>
                {r.revenuePct !== null && (
                  <FigureGroup pct={r.revenuePct} color={r.color}>
                    <Figure value={`${r.revenuePct}%`} label="of 12m revenue" />
                    <span className="block w-24" aria-hidden="true" />
                  </FigureGroup>
                )}
              </>
            );
            const cls = 'flex flex-col gap-3';
            // Slow's column is the link to Slow (see the header); its hover sits just outside the boxes.
            return r.key === 'slow'
              ? <Link key={r.key} href={SLOW_HREF} className={cls + ' -m-2 rounded-xl p-2 transition hover:bg-slate-50'}>{body}</Link>
              : <div key={r.key} className={cls}>{body}</div>;
          })}
        </div>
      </div>
    </section>
  );
}

// A light box of figures, with the box's own % drawn as a small bar filling the space to the right (white track on the grey box).
function FigureGroup({ children, pct, color }: { children: ReactNode; pct?: number | null; color?: string }) {
  return (
    <span className="flex items-center gap-x-2 rounded-lg bg-slate-100/70 px-3 py-2 ring-1 ring-slate-200/80">
      {children}
      {pct != null && color && (
        <span className="ml-2 h-2.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-white ring-1 ring-slate-200/80" aria-hidden="true">
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }} />
        </span>
      )}
    </span>
  );
}

function Figure({ value, label, strong }: { value: string; label?: string; strong?: boolean }) {
  return (
    <span className="block w-24">
      <span className={'block font-bold leading-none tabular-nums text-slate-900 ' + (strong ? 'text-3xl' : 'text-xl')}>{value}</span>
      {label && <span className="mt-1 block text-xs text-slate-500">{label}</span>}
    </span>
  );
}

// Is a style with this lead channel on that channel's lists? Its own channel, or BOTH — the server's channelFilterSql, so a brand's
// counts add up to the WINNERS tiles.
const onChannel = (c: PortfolioChannel, key: PortfolioChannelKey) => c === key || c === 'BOTH';

// WINNERS BY BRAND, PER CHANNEL (owner, 2026-09-25). First a panel under the tiles with Shopify / Amazon columns; then moved INTO each
// channel's WINNERS tile so the tier toggle, the number and its brands sit together without scrolling. A channel's counts add up to its
// WINNERS tile (a BOTH style counts on both). Follows the tier on the STAMPED revenue, as the tiles do. No "units shifted": units are
// stored only all-channel, so a per-channel figure can't carry them honestly.
type BrandCount = { brand: string; n: number };
function brandsByChannel(winners: TaggedWinner[], bar: number | null): Record<PortfolioChannelKey, BrandCount[]> {
  const out: Record<PortfolioChannelKey, BrandCount[]> = { SHP: [], AMZ: [] };
  for (const key of ['SHP', 'AMZ'] as const) {
    const m = new Map<string, number>();
    for (const w of winners) {
      if (bar !== null && !(w.revenue12m > bar)) continue;
      if (!onChannel(w.channel, key)) continue;
      const b = (w.brand || '').trim() || 'Unbranded';
      m.set(b, (m.get(b) ?? 0) + 1);
    }
    out[key] = [...m.entries()].map(([brand, n]) => ({ brand, n })).sort((a, b) => b.n - a.n || a.brand.localeCompare(b.brand));
  }
  return out;
}

// Top BRAND_CAP brands, then "+N more" — the cap is the knob if the tile ever feels busy (owner was wary of too much in a tile).
const BRAND_CAP = 4;
function BrandList({ brands }: { brands: BrandCount[] }) {
  if (brands.length === 0) return null;
  const top = Math.max(1, brands[0].n);
  const shown = brands.slice(0, BRAND_CAP);
  const more = brands.length - shown.length;
  return (
    <ul className="min-w-0 flex-1 space-y-1.5 self-center text-xs">
      {shown.map((b) => (
        <li key={b.brand} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-slate-600" title={b.brand}>{b.brand}</span>
          <span className="w-6 flex-none text-right font-medium tabular-nums text-slate-900">{b.n}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full bg-slate-400" style={{ width: `${Math.max(4, (b.n / top) * 100)}%` }} />
          </span>
        </li>
      ))}
      {more > 0 && <li className="text-slate-400">+{more} more</li>}
    </ul>
  );
}

// The WINNERS tier — £1,500 / £2,500 / £5,000 / £10,000 of all-channel 12m turnover. A LOOKUP WITHIN THE TAG, not a re-tag (owner,
// 2026-09-25, having weighed it): a raised tier hides the winners under it and nothing else. A winner it hides does NOT move to
// another status — the tag records only the first rule a style matched, so what it would otherwise be is unknown — which is why the
// other three tiles dim at a raised tier instead of pretending to update. Rejected alternatives: storing a "status if not a winner"
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

function Tile({ status, counts, hero, rule, href, dimmed, brands }: {
  status: PortfolioStatusName; counts: StatusChannelCounts; hero: boolean; rule: string | null; href: string; dimmed: boolean;
  brands?: BrandCount[];          // WINNERS only: its winners by brand, drawn to the right of the number
}) {
  const live = counts.total > 0 && !dimmed;
  // The hero and the due line are both STYLES, on both channels. On Amazon a style is due if ANY of its sizes is (owner, 2026-09-25),
  // so the list the tile opens — per size, Amazon prices per size — can show more due rows than the tile's number.
  const main = (
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
    </>
  );
  const ruleLine = rule && <span className={'mt-2 block text-slate-400 ' + (hero ? 'text-xs' : 'text-[11px]')}>{rule}</span>;
  // With brands, the rule runs under BOTH columns, not in the number's column: that column is flex-none, so the long rule line
  // set its width and squeezed the brand list until names truncated and the bars vanished (owner, 2026-09-25).
  const inner = brands && brands.length > 0 ? (
    <>
      <div className="flex gap-5">
        <div className="flex-none">{main}</div>
        <BrandList brands={brands} />
      </div>
      {ruleLine}
    </>
  ) : <>{main}{ruleLine}</>;
  const cls = 'block rounded-xl border bg-white shadow-sm ' + (hero ? 'col-span-2 p-5' : 'p-4');
  if (dimmed) return <div className={cls + ' border-slate-100 opacity-40'}>{inner}</div>;
  if (!live) return <div className={cls + ' border-slate-100 opacity-70'}>{inner}</div>;
  return (
    <Link href={href} className={cls + ' border-slate-200 transition hover:border-slate-300 hover:bg-slate-50'}>
      {inner}
    </Link>
  );
}
