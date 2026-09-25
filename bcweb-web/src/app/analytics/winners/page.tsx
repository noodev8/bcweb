'use client';
/*
=======================================================================================================================================
Page: /analytics/winners  (Reports — Winners)
=======================================================================================================================================
Purpose: THE RANGE BY PORTFOLIO STATUS, AND WHETHER IT IS MOVING. Every style carries a STORED tag — WINNERS | STEADY | NEW |
         HARVEST | LOSERS (skusummary.portfolio_status) — and this screen counts them, splits the winners by brand, and draws how
         the five have moved across recorded Updates.

REBUILT 2026-09-24 AROUND THE STORED TAGS (owner): "Instead of determining the WINNERS all the time, lets tag it in the database",
then "remove the current headline stats and code. Replace them with our new stats. Shape it as winners having the bigger box.
Have the graph include all our status to track progress." The old screen — a live hero count (which also counted deleted styles),
RANGE and ADDED headlines, revenue / units / more-on-the-way boxes, and a winners-vs-range trend — is gone; it is in git history,
as are GET /portfolio-winners and its portfolio_snapshot trend (removed 2026-09-25). NOTHING ON THIS SCREEN IS COMPUTED LIVE: it reads GET /portfolio-status
only, so no figure here can disagree with the tag the repricer will filter on.

THE RULES, first match wins (bcweb-server/utils/portfolioStatus.js): WINNERS > £1,500 gross revenue in 12 months → STEADY sold in
the last 3 months → NEW created under 90 days ago → HARVEST out of season (Summer Apr–Aug, Winter Sep–Mar; 'Any' never) → LOSERS.

THE DIAL STAYS, "JUST FOR SCREEN REPORTING" (owner, 2026-09-24). It filters the TAGGED winners on the revenue stamped beside the tag
at the last Update: at £1,500 it is exactly the tag count, at £2,500+ a subset. It moves the WINNERS box, its chips and the brand
list and nothing else — the other four statuses have no bar, and the graph records the tag. It lives in the URL (?bar=2500) so a list opened
at £2,500 returns here still at £2,500; it never re-tags and nothing is written.

ALL | SHOPIFY | AMAZON (owner, 2026-09-25). The status is ONE all-channel tag, but pricing is per channel, and 23 of the 73 winners
were Amazon winners earning ~2.5% on Shopify ("I'm working on Shopify when I have nothing to gain from it"). Each style carries a
stamped LEAD CHANNEL (SHP | AMZ | BOTH — utils/portfolioStatus.js), and a switch beside the dial reads the screen per channel:
  All      the totals, and under each number two logo chips — the count on the Shopify list and on the Amazon list. The chips are
           the links. They can add up to more than the total: a BOTH style (mixed seller, or unsold but listed on Amazon) needs
           pricing on both, so it is on both lists. No explanation on screen — the logos ARE the legend (owner: "not just a limp of
           text explanations... something brief and maybe visual").
  Shopify / Amazon   every figure (boxes, percentages of that channel's styles, brands, graph, "since" deltas) is that channel's; its
           logo sits beside each number; the whole card opens that channel's list.
The owner considered splitting the screen into two and kept one: the count of winners is one business number, and a second tag per
channel would give a style two answers. The channel graph starts from the first Update after 2026-09-25 (no earlier channel data).

THE BRANDS STAY TOO ("now or later I want to see the brands"). Winners and units side by side because they disagree — a brand with
many modest winners and a brand with few huge ones are different businesses.

EVERY CARD OPENS ITS LIST ON REPRICING (2026-09-24): /pricing/<STATUS>?by=status — ONE unsplit list of every style with the status,
out of stock included (no Selling / Stuck), with "← Winners" back here. It opens with Due OFF (?pending=1) so the list is the card's
whole number, parked styles included (owner, 2026-09-25: "tapping on 2500 winners I would want to see which ones they are"), and the
WINNERS card carries the dial (?bar=2500) so it opens exactly the winners behind its count. Repricing's own first tab (Status, which
replaced Top earners) opens the same lists with Due on.

ONE BUTTON: "Update now" re-tags every style AND records today's point on the status graph, in one transaction. Pressing twice in a day overwrites today's point, never appends.

COLOUR. The page is slate; the five status hues exist only because the graph needs to tell five lines apart, and each box wears its
line's colour as a small dot so the hue is a key, not decoration. Categorical slots 1–5 of the dataviz reference palette, validated
(adjacent CVD ΔE ≥ 9.1). Three sit under 3:1 on white, so every line also carries a direct text label at its end — identity is
never colour alone.

Guarded by AppShell. Consumes GET /portfolio-status and POST /portfolio-snapshot-update.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState, type MouseEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPortfolioStatus,
  updatePortfolioSnapshot,
  PORTFOLIO_STATUSES,
  type PortfolioStatusName,
  type PortfolioStatusPoint,
  type PortfolioStatusCount,
  type PortfolioChannel,
  type PortfolioChannelKey,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import Link from 'next/link';
import { ChannelLogo } from '@/components/ChannelBadge';
import { STATUS_COLOR, STATUS_RULE, statusListHref } from '@/lib/portfolioStatusUi';

// Whole pounds — the dial marks are round amounts and pence would be noise.
function money(v: number): string {
  return `£${Math.round(v).toLocaleString('en-GB')}`;
}

// 'YYYY-MM-DD' -> '24 Sep'. Built from the string parts, never `new Date(...)` — pg DATEs are cast to text precisely so no timezone
// can shift the day (CLAUDE.md: the DB session runs UTC, the box BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso || '—';
}

// Is a style with this lead channel on that channel's lists? Its own channel, or BOTH (mirrors the server's channelFilterSql).
const onChannel = (c: PortfolioChannel, key: PortfolioChannelKey) => c === key || c === 'BOTH';

const pct1 = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null);

export default function WinnersPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <WinnersPageInner />
    </Suspense>
  );
}

function WinnersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const backHref = searchParams.get('from') || '/analytics';
  const backLabel = searchParams.get('back') || 'Reports';

  const { logout } = useAuth();
  const [updating, setUpdating] = useState(false);
  // Kept apart from the query's own error so a failed Update doesn't tear down a screen that loaded fine.
  const [actionError, setActionError] = useState<string | null>(null);

  const q = useApiQuery('portfolio-status', () => getPortfolioStatus());
  const status = q.data?.status;
  const winners = useMemo(() => q.data?.winners ?? [], [q.data]);
  const history = useMemo(() => q.data?.history ?? [], [q.data]);
  const bars = q.data?.bars ?? [];
  const trackedBar = bars[0] ?? null;

  // THE VIEW LIVES IN THE URL — ?bar=2500 and ?ch=shopify|amazon — so "← Winners" from a list lands back on exactly the view it was
  // opened from (owner, 2026-09-25). Absent / unknown = the tag's own bar and All. Nothing is sent anywhere; both are readings.
  // replace, not push: flipping a control is not a navigation Back should step through.
  const urlBar = Number(searchParams.get('bar'));
  const selBar = bars.includes(urlBar) ? urlBar : trackedBar;
  const offTracked = selBar !== null && trackedBar !== null && selBar !== trackedBar;
  const rawCh = searchParams.get('ch');
  const view: ChannelView = rawCh === 'shopify' || rawCh === 'amazon' ? rawCh : 'all';
  const viewKey: PortfolioChannelKey | null = view === 'shopify' ? 'SHP' : view === 'amazon' ? 'AMZ' : null;

  function setParam(key: 'bar' | 'ch', value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null) next.delete(key); else next.set(key, value);
    const qs = next.toString();
    router.replace(`/analytics/winners${qs ? `?${qs}` : ''}`, { scroll: false });
  }
  const setBar = (b: number) => setParam('bar', b === trackedBar ? null : String(b));
  const setView = (v: ChannelView) => setParam('ch', v === 'all' ? null : v);

  // This exact view (dial + channel + our own back context), as the lists' "← Winners" target.
  const selfHref = `/analytics/winners${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  // A status's list on one channel — with Due OFF, so the list is the number it was opened from, not just what is due (owner,
  // 2026-09-25: "I would want to see which ones they are"). WINNERS carries the dial's bar, so at £2,500 it opens exactly the
  // winners behind that figure. The four greyed boxes don't depend on the bar and open their whole status.
  const listHref = (s: PortfolioStatusName, ch: PortfolioChannelKey) =>
    statusListHref(s, selfHref, 'Winners', ch === 'AMZ' ? 'amazon' : 'shopify', {
      showAll: true, bar: s === 'WINNERS' && offTracked ? selBar : null,
    });

  // The tagged winners behind the WINNERS box: at the dial's bar (on the STAMPED revenue), on the channel in view (own + BOTH).
  const winnersAtBar = useMemo(
    () => (offTracked && selBar !== null ? winners.filter((w) => w.revenue12m > selBar) : winners),
    [winners, offTracked, selBar]
  );
  const winnersInView = useMemo(
    () => (viewKey ? winnersAtBar.filter((w) => onChannel(w.channel, viewKey)) : winnersAtBar),
    [winnersAtBar, viewKey]
  );

  const brands = useMemo(() => {
    const m = new Map<string, { brand: string; winners: number; units: number }>();
    for (const w of winnersInView) {
      const key = (w.brand || '').trim() || 'Unbranded';
      const b = m.get(key) || { brand: key, winners: 0, units: 0 };
      b.winners += 1;
      b.units += w.units12m;
      m.set(key, b);
    }
    return [...m.values()].sort((a, b) => b.winners - a.winners || b.units - a.units);
  }, [winnersInView]);
  const topBrandWinners = Math.max(1, ...brands.map((b) => b.winners));

  const neverRun = !q.isLoading && status !== undefined && status.updatedAt === null;
  const byStatus = new Map((status?.statuses ?? []).map((s) => [s.status, s]));
  // Everything below reads through these two, so All and a channel view can never be computed differently.
  const countIn = (s: PortfolioStatusName, key: PortfolioChannelKey | null) => {
    if (s === 'WINNERS') return key ? winnersAtBar.filter((w) => onChannel(w.channel, key)).length : winnersAtBar.length;
    const row = byStatus.get(s);
    return row ? (key ? row.channels[key] : row.count) : 0;
  };
  // The denominator for the percentages: the whole catalogue in All, the styles on that channel's lists in a channel view.
  const totalInView = viewKey ? status?.channelTotals[viewKey] ?? 0 : status?.total ?? 0;

  // The graph and the "since" deltas, per view. A channel view reads each reading's channel counts and skips readings taken before
  // they were recorded (2026-09-25), so a channel's line starts where its data does.
  const historyInView = useMemo<PortfolioStatusPoint[]>(
    () => (viewKey
      ? history.filter((h) => h.channels).map((h) => ({ ...h, ...h.channels![viewKey], total: h.total }))
      : history),
    [history, viewKey]
  );
  const prevPoint = historyInView.length > 1 ? historyInView[historyInView.length - 2] : null;
  const since = (s: PortfolioStatusName): number | null => (prevPoint ? countIn(s, viewKey) - prevPoint[s] : null);

  const when = status?.updatedAt ? `${shortDate(status.updatedAt)}, ${status.updatedAt.slice(11, 16)}` : null;

  // NO SUCCESS BANNER — the boxes, the "tagged" time and the graph all change when the refresh lands; that is the confirmation.
  async function onUpdate() {
    setUpdating(true);
    setActionError(null);
    const res = await updatePortfolioSnapshot();
    if (res.success) {
      await q.refresh();
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setActionError(res.error || 'Failed to update');
    }
    setUpdating(false);
  }

  const winnerCount = countIn('WINNERS', viewKey);
  const winnerPct = pct1(winnerCount, totalInView);

  // No `title` on AppShell — the screen names itself through the WINNERS box, the one word that matters most.
  return (
    <AppShell backHref={backHref} backLabel={backLabel}>
      {actionError && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}

      {/* THE TWO READINGS — which channel, and which bar. The channel switch is logos, not words: the same two marks recur on every
          chip below, so after one look the screen reads without a legend. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <ChannelSwitch view={view} onChange={setView} />
        {bars.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm text-slate-500">A winner turns over more than</span>
            <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1 shadow-sm">
              {bars.map((b) => (
                <button
                  key={b}
                  onClick={() => setBar(b)}
                  aria-pressed={selBar === b}
                  className={
                    selBar === b
                      ? 'rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-white tabular-nums'
                      : 'rounded px-3 py-1.5 text-sm text-slate-600 tabular-nums transition hover:bg-slate-50'
                  }
                >
                  {money(b)}
                </button>
              ))}
            </div>
            <span className="text-sm text-slate-500">in 12 months</span>
          </div>
        )}
      </div>

      {/* THE TOTAL AND THE BUTTON, above the boxes they describe. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex items-center gap-2 text-sm text-slate-600">
          {q.isLoading || !status ? (
            ' '
          ) : (
            <>
              {viewKey && <ChannelLogo channel={viewKey === 'AMZ' ? 'amazon' : 'shopify'} />}
              <span className="text-lg font-semibold tabular-nums text-slate-900">{totalInView.toLocaleString('en-GB')}</span> styles
              <span className="text-xs text-slate-400">
                {when && ` · tagged ${when}`}
                {status.addedSince > 0 && ` · ${status.addedSince} added since`}
                {status.untagged > 0 && ` · ${status.untagged} not tagged yet`}
              </span>
            </>
          )}
        </p>
        <button
          onClick={onUpdate}
          disabled={updating || q.isLoading}
          className="ml-auto rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {updating ? 'Updating…' : 'Update now'}
        </button>
      </div>

      {neverRun ? (
        <p className="mb-6 rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No styles tagged yet — press <span className="font-medium">Update now</span> to set them.
        </p>
      ) : (
        /* WINNERS IS THE HERO — half the width, two rows tall, twice the type. The other four are its siblings in a 2×2.
           In ALL, a card is not a link — its two channel chips are (a card can't open "both lists"). In a channel view the card
           itself opens that channel's list. */
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:grid-rows-2">
          <StatusCard
            hero
            status="WINNERS"
            loading={q.isLoading}
            count={winnerCount}
            pct={winnerPct}
            viewKey={viewKey}
            chips={{ SHP: countIn('WINNERS', 'SHP'), AMZ: countIn('WINNERS', 'AMZ') }}
            listHref={listHref}
            rule={offTracked && selBar !== null
              ? `over ${money(selBar)} in 12 months — ${viewKey ? countTagged(byStatus, viewKey) : byStatus.get('WINNERS')?.count ?? 0} tagged at ${money(trackedBar ?? 0)}`
              : STATUS_RULE.WINNERS}
            since={offTracked ? null : since('WINNERS')}
            sinceDate={prevPoint?.date}
          />

          {/* GREYED WHEN THE DIAL IS OFF £1,500 (owner, 2026-09-24): these four are the tag, always the £1,500 test, so beside a
              £2,500 winner count they would read as if they belonged to it. Greyed rather than hidden so the layout does not jump. */}
          {(['STEADY', 'NEW', 'HARVEST', 'LOSERS'] as const).map((s) => (
            <StatusCard
              key={s}
              status={s}
              loading={q.isLoading}
              count={countIn(s, viewKey)}
              pct={pct1(countIn(s, viewKey), totalInView)}
              viewKey={viewKey}
              chips={{ SHP: countIn(s, 'SHP'), AMZ: countIn(s, 'AMZ') }}
              listHref={listHref}
              rule={STATUS_RULE[s]}
              since={since(s)}
              sinceDate={prevPoint?.date}
              dimmed={offTracked}
            />
          ))}
        </div>
      )}

      {/* WINNERS BY BRAND, at the dial's bar and in the channel view. Winners and units together BECAUSE they disagree. */}
      {brands.length > 0 && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-baseline justify-between text-xs text-slate-400">
            <span>winners by brand{offTracked && selBar !== null ? `, over ${money(selBar)}` : ''}</span>
            <span>units shifted</span>
          </div>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-1.5 md:grid-cols-2">
            {brands.map((b) => (
              <li key={b.brand} className="flex items-center gap-3 text-sm">
                <span className="w-28 flex-none truncate text-slate-600" title={b.brand}>{b.brand}</span>
                <span className="w-6 flex-none text-right font-medium tabular-nums text-slate-900">{b.winners}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-slate-400"
                    style={{ width: `${Math.max(2, (b.winners / topBrandWinners) * 100)}%` }}
                  />
                </span>
                <span className="w-14 flex-none text-right tabular-nums text-slate-400">{b.units.toLocaleString('en-GB')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* PROGRESS — all five statuses across recorded Updates, for the view. Greyed off £1,500: it records the tag, not the dial. */}
      {historyInView.length > 1 ? (
        <div
          className={offTracked ? 'pointer-events-none opacity-40 grayscale transition' : 'transition'}
          aria-disabled={offTracked}
          title={offTracked ? 'Tagged at £1,500 — not affected by the dial' : undefined}
        >
          <StatusTrendChart rows={historyInView} />
        </div>
      ) : historyInView.length === 1 ? (
        <p className="text-xs text-slate-400">
          One reading so far ({shortDate(historyInView[0].date)}). The graph appears once there are two — press Update now on another day.
        </p>
      ) : viewKey && history.length > 0 ? (
        <p className="text-xs text-slate-400">The channel graph starts from the next Update.</p>
      ) : null}
    </AppShell>
  );
}

// How many tagged winners are on a channel's lists at the tracked bar — the "N tagged at £1,500" figure in a channel view.
function countTagged(byStatus: Map<PortfolioStatusName, PortfolioStatusCount>, key: PortfolioChannelKey): number {
  return byStatus.get('WINNERS')?.channels[key] ?? 0;
}

type ChannelView = 'all' | 'shopify' | 'amazon';

// All | Shopify | Amazon. Logos carry the channels (no words beside them); "All" is the one word, because it has no logo.
function ChannelSwitch({ view, onChange }: { view: ChannelView; onChange: (v: ChannelView) => void }) {
  const opts: { key: ChannelView; label: string }[] = [
    { key: 'all', label: 'All channels' },
    { key: 'shopify', label: 'Shopify' },
    { key: 'amazon', label: 'Amazon' },
  ];
  return (
    <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1 shadow-sm" role="group" aria-label="Channel">
      {opts.map((o) => {
        const on = view === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            aria-pressed={on}
            title={o.label}
            className={'flex h-8 items-center rounded px-2.5 text-sm transition ' + (on ? 'bg-slate-700 font-medium text-white' : 'text-slate-600 hover:bg-slate-50')}
          >
            {o.key === 'all' ? 'All' : <ChannelLogo channel={o.key} />}
          </button>
        );
      })}
    </div>
  );
}

function Dot({ status }: { status: PortfolioStatusName }) {
  return <span className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: STATUS_COLOR[status] }} />;
}

// Movement since the previous recorded Update, in neutral ink. Hidden until there are two readings.
function Since({ value, date }: { value: number | null; date: string | undefined }) {
  if (value === null || !date) return null;
  return (
    <p className="mt-1 text-xs tabular-nums text-slate-400">
      {value === 0 ? 'no change' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`} since {shortDate(date)}
    </p>
  );
}

// One status box — the WINNERS hero or one of the four. The only difference between views is WHERE the link is:
//   All       the card is plain; its two logo chips are the links (Shopify list / Amazon list), each with that channel's count.
//             The chips can add up to more than the total — a style selling on both needs pricing on both, so it is on both lists.
//   channel   the card IS the link (that channel's list), and the channel's logo sits beside the number instead of the chips.
function StatusCard({
  status, loading, count, pct, viewKey, chips, listHref, rule, since, sinceDate, dimmed = false, hero = false,
}: {
  status: PortfolioStatusName;
  loading: boolean;
  count: number;
  pct: number | null;
  viewKey: PortfolioChannelKey | null;
  chips: Record<PortfolioChannelKey, number>;
  listHref: (s: PortfolioStatusName, ch: PortfolioChannelKey) => string;
  rule: string;
  since: number | null;
  sinceDate: string | undefined;
  dimmed?: boolean;               // the dial is off £1,500 — this count is the tag, not the dial's reading
  hero?: boolean;
}) {
  const shell = hero
    ? 'col-span-2 flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:row-span-2'
    : 'flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
  const dim = dimmed ? ' opacity-40 grayscale' : '';
  const title = dimmed ? 'Tagged at £1,500 — not affected by the dial' : undefined;

  const body = loading ? (
    <div className={hero ? 'h-36 animate-pulse rounded bg-slate-100' : 'mt-2 h-9 animate-pulse rounded bg-slate-100'} />
  ) : (
    <>
      {!hero && (
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500">
          <Dot status={status} /> {status}
        </p>
      )}
      <div className={hero ? 'flex items-baseline gap-4' : 'mt-1 flex items-baseline gap-2'}>
        {viewKey && <span className="self-center"><ChannelLogo channel={viewKey === 'AMZ' ? 'amazon' : 'shopify'} size={hero ? 'md' : 'sm'} /></span>}
        <span className={hero
          ? 'text-7xl font-semibold tabular-nums leading-none text-slate-900 sm:text-8xl'
          : 'text-4xl font-semibold tabular-nums text-slate-900'}>
          {count.toLocaleString('en-GB')}
        </span>
        <span className={hero ? 'text-2xl tabular-nums text-slate-500' : 'text-sm tabular-nums text-slate-500'}>
          {pct === null ? '—' : `${pct}%`}
        </span>
      </div>
      {hero && (
        <p className="mt-3 flex items-center gap-2 text-xl text-slate-600">
          <Dot status="WINNERS" /> winners
        </p>
      )}
      <p className={hero ? 'mt-2 text-sm text-slate-500' : 'mt-1 text-xs text-slate-400'}>{rule}</p>
      <Since value={since} date={sinceDate} />
      {viewKey ? (
        <span className="mt-auto pt-2 text-right text-xs text-slate-300 transition group-hover:text-slate-600">Reprice →</span>
      ) : (
        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {(['SHP', 'AMZ'] as const).map((ch) => chips[ch] === 0 ? (
            // Nothing on that channel's list — a quiet chip, not a link to an empty page.
            <span
              key={ch}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-100 py-0.5 pl-0.5 pr-2 text-sm tabular-nums text-slate-300 opacity-60"
            >
              <ChannelLogo channel={ch === 'AMZ' ? 'amazon' : 'shopify'} />
              0
            </span>
          ) : (
            <Link
              key={ch}
              href={listHref(status, ch)}
              title={`Reprice on ${ch === 'AMZ' ? 'Amazon' : 'Shopify'}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white py-0.5 pl-0.5 pr-2 text-sm font-medium tabular-nums text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              <ChannelLogo channel={ch === 'AMZ' ? 'amazon' : 'shopify'} />
              {chips[ch].toLocaleString('en-GB')}
            </Link>
          ))}
        </div>
      )}
    </>
  );

  // A channel view makes the whole card the link; All keeps it plain (its chips are the links — links can't nest).
  if (viewKey) {
    return (
      <Link href={listHref(status, viewKey)} className={'group ' + shell + ' transition hover:border-slate-300' + dim} title={title}>
        {body}
      </Link>
    );
  }
  return <div className={shell + dim} title={title}>{body}</div>;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// THE STATUS TREND — five lines on ONE axis (all are counts of styles), one per recorded Update day. Hover anywhere for a crosshair
// and all five values on that day. Each line ends in a text label (status + count) in slate ink: three of the five hues sit under
// 3:1 on white, so the label, not the colour, carries identity. Labels are nudged apart when two lines end close together.
// ---------------------------------------------------------------------------------------------------------------------------------
function StatusTrendChart({ rows }: { rows: PortfolioStatusPoint[] }) {
  const W = 760, H = 260, padL = 36, padR = 104, padT = 12, padB = 24;
  const n = rows.length;
  const [hover, setHover] = useState<number | null>(null);

  const maxY = Math.max(1, ...rows.flatMap((r) => PORTFOLIO_STATUSES.map((s) => r[s]))) * 1.1;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);

  // End labels, de-collided: sort by y, then push each at least 13px below the one above.
  const last = rows[n - 1];
  const labels = PORTFOLIO_STATUSES.map((s) => ({ s, y: y(last[s]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }

  const h = hover === null ? null : rows[hover];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Status over time</span>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          {PORTFOLIO_STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ backgroundColor: STATUS_COLOR[s] }} /> {s.toLowerCase()}
            </span>
          ))}
        </span>
      </div>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minWidth: 480 }}
          role="img"
          aria-label="Styles in each portfolio status over time"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {[0, Math.round(maxY / 2), Math.round(maxY)].map((v) => (
            <g key={`g${v}`}>
              <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#f1f5f9" />
              <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
            </g>
          ))}

          {rows.map((r, i) => {
            const step = Math.max(1, Math.ceil(n / 6));
            if (i % step !== 0 && i !== n - 1) return null;
            return (
              <text key={`x${r.date}`} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">
                {shortDate(r.date)}
              </text>
            );
          })}

          {hover !== null && <line x1={x(hover)} y1={padT} x2={x(hover)} y2={H - padB} stroke="#cbd5e1" />}

          {PORTFOLIO_STATUSES.map((s) => (
            <g key={s}>
              <polyline
                points={rows.map((r, i) => `${x(i)},${y(r[s])}`).join(' ')}
                fill="none"
                stroke={STATUS_COLOR[s]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* The end marker, with a surface ring so overlapping ends stay separable. */}
              <circle cx={x(n - 1)} cy={y(last[s])} r={4} fill={STATUS_COLOR[s]} stroke="#fff" strokeWidth={2} />
              {hover !== null && (
                <circle cx={x(hover)} cy={y(rows[hover][s])} r={4} fill={STATUS_COLOR[s]} stroke="#fff" strokeWidth={2} />
              )}
            </g>
          ))}

          {labels.map(({ s, y: ly }) => (
            <text key={`l${s}`} x={x(n - 1) + 10} y={ly + 3} fontSize="10" fill="#475569">
              {s.toLowerCase()} {last[s]}
            </text>
          ))}
        </svg>

        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              // Right half opens leftwards, so the box never runs off the card. `>=` with (n - 1): with two readings the last
              // point is index 1 and `hover > n / 2` let it open rightwards, clipped, with a scrollbar.
              transform: hover >= (n - 1) / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}
          >
            <p className="mb-1 font-medium text-slate-700">{shortDate(h.date)}</p>
            {PORTFOLIO_STATUSES.map((s) => (
              <p key={s} className="flex items-center gap-2 tabular-nums text-slate-600">
                <Dot status={s} />
                <span className="w-16">{s.toLowerCase()}</span>
                <span className="ml-auto font-medium text-slate-900">{h[s]}</span>
              </p>
            ))}
            <p className="mt-1 border-t border-slate-100 pt-1 tabular-nums text-slate-400">{h.total} in total</p>
          </div>
        )}
      </div>
    </div>
  );
}
