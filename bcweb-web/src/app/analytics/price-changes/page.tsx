'use client';
/*
=======================================================================================================================================
Page: /analytics/price-changes  (Analytics module — Price Changes)
=======================================================================================================================================
Purpose: The "did our repricing take effect?" report, over a TIME WINDOW (default 30 days) and in two layers:

           1. SUMMARY — how much repricing happened in the window, split up/down, by channel, and BY OPERATOR. This is the staff-progress
              read: 30 days holds ~1,500 changes (a bulk move logs one row per style), so a raw list of them is a dump, not a monitor. The
              headline number is the window's total; the per-operator cards are the breakdown AND the filter control — click one to drill.
           2. IMPACT — the staff read: "did this person's repricing time pay for itself?". One TABLE ROW per operator, on its OWN fixed
              basis (always the last 90 days, both channels, everyone) regardless of every switch above: those switches are activity
              controls, this needs a maturity basis, and coupling them scored 8 changes out of 299 on a 30-day view. The panel states its
              own period so the mismatch reads as intent, not a bug. The measure is a HIT RATE — raises that sold, cuts that moved, each
              with its denominator — never an average of money; see the panel comment for why that was tried and removed. Raise rates are
              split Shopify/Amazon because the two differ structurally (51% vs 76%) and a blend would just measure channel mix.
           3. DETAIL — the newest 50 changes matching the current filters, each showing BEFORE -> AFTER, who changed it, when, and its
              SOLD: how many units sold while that exact price was live (the cash effect was dropped — one number per row reads at a glance,
              two did not). Labelled "newest 50 of N" so the table is never
              mistaken for the whole window. Its own filter (All / 21+ days / Sold) answers "which of my changes actually did something?" —
              applied server-side, so it cuts the whole window before the 50-row slice rather than just re-filtering this page.

         Why a window rather than "latest 50": a price move needs time to show sales. Bounding by DAYS keeps the older moves in view — the
         ones that have actually had a chance to sell — instead of letting today's activity push them off the list.

         Filters: WINDOW (7/30/90d), CHANNEL (All / Shopify / Amazon — the per-row logo chip carries the same identity) and USER. Channel
         and window re-cut the summary; the user filter narrows only the table, so the operator breakdown stays whole while you drill.

         Row click reuses the cross-module ProductActions chooser (Shopify price / Amazon price / Copy). Amazon rows carry
         their exact SKU `code`, so the Amazon action deep-links straight to that size's drill.

Guarded by AppShell. Consumes GET /analytics-change-impact.
=======================================================================================================================================
*/

import { useState } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import ChannelBadge from '@/components/ChannelBadge';
import { useProductActions } from '@/components/ProductActions';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getPriceChanges,
  PriceChangeImpactFilter,
  PriceChangeRow,
  PriceChangeScorecard,
  PriceChangeSummary,
  PriceChangeUserStat,
} from '@/lib/api';

const LIMIT = 50;          // detail rows — the readable slice of the window, not the window itself
const DEFAULT_DAYS = 30;   // the monitoring period the owner works to

type ChannelFilter = 'all' | 'shp' | 'amz';

const CHANNEL_TABS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'shp', label: 'Shopify' },
  { key: 'amz', label: 'Amazon' },
];

const WINDOW_TABS: { days: number; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const EMPTY_SUMMARY: PriceChangeSummary = { total: 0, up: 0, down: 0, flat: 0, shp: 0, amz: 0, byUser: [] };

// Stable "nothing yet" identities, so the memos derived from these aren't invalidated on every render.
const NO_ROWS: PriceChangeRow[] = [];
const NO_SCORECARDS: PriceChangeScorecard[] = [];
const NO_USERS: string[] = [];

export default function PriceChangesPage() {
  const actions = useProductActions(); // row click -> cross-module "reprice this" chooser (Shopify / Amazon / copy)

  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [user, setUser] = useState<string>(''); // '' = all users
  const [impact, setImpact] = useState<PriceChangeImpactFilter>('all'); // detail list: all / old enough to judge / actually sold
  const [showAbout, setShowAbout] = useState(false);                    // the "what is this screen" blurb — off by default
  // Splitting "a fetch is in flight" from "we have never had data" is what stops the screen flicking on every filter change: after the
  // first successful load the previous results stay mounted and just dim while the new ones arrive, so nothing unmounts and the page
  // never collapses to a one-line "Loading…" and jumps back. Only the very first paint shows a placeholder.

  // Only CHANNEL and WINDOW can change the summary and the scorecards — both of those layers deliberately ignore the user filter, and the
  // impact filter only ever cuts the detail list. So when the user switches "21+ days" or picks an operator, the top of the page is already
  // correct and must not dim: dimming it would make the whole screen pulse for a change that only affects the table below.
  const scopeKey = `${channel}|${days}`;

  // keepPreviousData is what stops the screen flicking on a filter change: the previous results stay mounted and just dim while the
  // new ones arrive, so nothing unmounts and the page never collapses to a one-line "Loading..." and jump back. It also keeps the
  // operator dropdown populated across channel/window switches.
  // The payload carries the scopeKey it was fetched under, which is how `scopeBusy` below can tell "the summary/scorecards are stale"
  // from "only the table below is reloading" -- previously a useRef mutated inside the loader.
  const { data, error: loadError, busy: loading } = useApiQuery(
    ['price-changes', channel, user, days, impact],
    async () => {
      const res = await getPriceChanges(channel, user || null, days, LIMIT, impact);
      if (!(res.success && res.data)) {
        return { success: false, error: res.error || 'Failed to load Price Changes', return_code: res.return_code };
      }
      return { success: true, return_code: 'SUCCESS', data: { ...res.data, scopeKey } };
    },
    { keepPreviousData: true },
  );
  const rows: PriceChangeRow[] = data?.rows ?? NO_ROWS;
  const summary: PriceChangeSummary = data?.summary ?? EMPTY_SUMMARY;
  const total = data?.total ?? 0;               // matches for the CURRENT filters (incl. user), pre-limit
  const scorecards: PriceChangeScorecard[] = data?.scorecards ?? NO_SCORECARDS;
  const settleDays = data?.settleDays ?? 21;
  const scoreWindowDays = data?.scoreWindowDays ?? 90;
  const users: string[] = data?.users ?? NO_USERS;  // dropdown options (stable across channel/window switches)
  const hasLoaded = data !== undefined;
  const error = loadError?.message ?? null;
  // Dim the top of the page ONLY when the channel/window it depends on has actually changed. Switching operator or the impact filter
  // leaves the summary and scorecards already correct, so dimming them would make the whole screen pulse for a change that only
  // affects the table below.
  const scopeBusy = loading && data?.scopeKey !== scopeKey;

  const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);
  const n = (v: number) => v.toLocaleString('en-GB');

  // "13 Jul, 00:55" (Europe/London wall clock via the browser). null -> "—".
  const fmtWhen = (iso: string | null) => {
    if (!iso) return '—';
    const dt = new Date(iso);
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}, ${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  };
  // "today" for a same-day change, else "Nd ago".
  const fmtAge = (d: number | null) => (d === null ? '' : d <= 0 ? 'today' : `${d}d ago`);

  // Clicking an operator card toggles the user filter (click the active one to clear it).
  const toggleUser = (u: string | null) => setUser((cur) => (u && cur !== u ? u : ''));

  const windowLabel = WINDOW_TABS.find((w) => w.days === days)?.label ?? `${days} days`;

  return (
    <AppShell
      title="Price Changes"
      backHref="/analytics"
      backLabel="Reports"
      /* The blurb is orientation — read once, then it is just text in the way. Behind this header-row toggle it costs no vertical
         space at all (same pattern as New Additions). */
      headerRight={
        <button
          type="button"
          onClick={() => setShowAbout((v) => !v)}
          aria-expanded={showAbout}
          title={showAbout ? 'Hide what this screen shows' : 'What does this screen show?'}
          className={
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition ' +
            (showAbout
              ? 'border-slate-300 bg-slate-100 text-slate-700'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700')
          }
        >
          <InformationCircleIcon className="h-4 w-4" /> About
        </button>
      }
    >
      {showAbout && (
        <p className="mb-5 max-w-3xl rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Repricing activity over the last <strong>{windowLabel}</strong> — how much was moved, in which direction, and by whom.{' '}
          <strong>Impact</strong> then scores the changes old enough to judge, on its own fixed period. Below that, the changes themselves:{' '}
          <strong>before → after</strong> and what sold while each price was live.
        </p>
      )}

      {/* Filters: window + channel segmented controls, then the user dropdown. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          options={WINDOW_TABS.map((w) => ({ key: String(w.days), label: w.label }))}
          value={String(days)}
          onChange={(k) => setDays(Number(k))}
        />
        <Segmented
          options={CHANNEL_TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={channel}
          onChange={(k) => setChannel(k as ChannelFilter)}
        />

        <select
          value={user}
          onChange={(e) => setUser(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          title="Filter the detail list by who made the change"
        >
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!hasLoaded && loading && <p className="text-sm text-slate-400">Loading…</p>}

      {hasLoaded && !error && (
        // Dimmed, never unmounted or disabled: nothing shifts, and the controls inside stay clickable mid-fetch.
        <div aria-busy={loading}>
          {/* Summary + scorecards dim only when the CHANNEL or WINDOW moved — a user/impact switch leaves them untouched and correct. */}
          <div className={'transition-opacity duration-200 ' + (scopeBusy ? 'opacity-60' : 'opacity-100')}>
          {/* ---- SUMMARY: the report. Covers the whole window (the user filter deliberately doesn't cut it). ---- */}
          <SummaryPanel
            summary={summary}
            windowLabel={windowLabel}
            channel={channel}
            activeUser={user}
            onPickUser={toggleUser}
            n={n}
          />

          {/* ---- SCORECARDS: the staff read. Separate basis from the summary above (settled changes only), so it gets its own block. ---- */}
          <ScorecardPanel
            cards={scorecards}
            settleDays={settleDays}
            scoreWindowDays={scoreWindowDays}
            activeUser={user}
            onPickUser={toggleUser}
            n={n}
          />
          </div>

          {/* ---- DETAIL: the newest slice, explicitly labelled as a slice. Dims on ANY refetch — every filter can change these rows. ---- */}
          <div className={'transition-opacity duration-200 ' + (loading ? 'opacity-60' : 'opacity-100')}>
          <div className="mb-2 mt-7 flex flex-wrap items-center justify-between gap-3">
            {/* No heading and no "all N" — the table plainly is the list of changes, and the All / 21+ days / Sold control opposite
                already says which cut it is. The count survives ONLY when the list is a slice, because "newest 50 of 1,482" is the
                one thing the table itself cannot tell you. */}
            <div className="flex flex-wrap items-baseline gap-2">
              {total > rows.length && (
                <span className="text-xs text-slate-400">
                  {`newest ${rows.length} of ${n(total)}${user ? ` by ${user}` : ''}`}
                </span>
              )}
            </div>
            {/* The "which of my changes actually did something?" control. Server-side, so it cuts the whole window before the 50-row slice
                — otherwise it would only filter whatever happened to be on this page. */}
            <Segmented
              options={[
                { key: 'all', label: 'All' },
                { key: 'settled', label: `${settleDays}+ days` },
                { key: 'moved', label: 'Sold' },
              ]}
              value={impact}
              onChange={(k) => setImpact(k as PriceChangeImpactFilter)}
            />
          </div>

          {rows.length === 0 ? (
            // A window shorter than the settle period can NEVER satisfy the 21+/Sold filters — spell that out rather than leaving the
            // operator staring at an empty table wondering which of the two controls is wrong.
            <p className="text-sm text-slate-400">
              {impact !== 'all' && days <= settleDays
                ? <>Nothing here — this list is showing the last {windowLabel}, but these filters only include changes {settleDays}+ days
                  old. Widen the window to see them.</>
                : <>No price changes match this filter.</>}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">Channel</th>
                    <th className="px-4 py-2.5 font-medium">Product</th>
                    <th className="px-4 py-2.5 font-medium">Before → After</th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Units sold while this price was live">
                      Sold
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Profit on the latest sale made at the new price — blank if nothing has sold since the change">
                      Profit
                    </th>
                    <th className="px-4 py-2.5 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <ChangeRow key={`${r.channel}-${r.amzCode || r.groupid}-${r.changedAt}-${i}`} r={r} actions={actions}
                               money={money} fmtWhen={fmtWhen} fmtAge={fmtAge} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>
      )}

      {actions.node}
    </AppShell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// A compact segmented control — shared shape for the window and channel switches so the filter bar reads as one row of controls.
// -------------------------------------------------------------------------------------------------------------------------------------
function Segmented({
  options, value, onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={
            'rounded-md px-3.5 py-1.5 text-sm font-medium transition ' +
            (value === o.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// SUMMARY PANEL — the report layer. HERO = total changes in the window (the tracked metric); everything else is supporting detail below a
// divider: the up/down split, the channel split, then one card per operator. Operator cards are the drill-down control — clicking one sets
// the user filter on the detail table (clicking the active one clears it). The panel itself never narrows to a user, so the breakdown
// stays whole while you read one operator's rows.
// -------------------------------------------------------------------------------------------------------------------------------------
function SummaryPanel({
  summary, windowLabel, channel, activeUser, onPickUser, n,
}: {
  summary: PriceChangeSummary;
  windowLabel: string;
  channel: ChannelFilter;
  activeUser: string;
  onPickUser: (u: string | null) => void;
  n: (v: number) => string;
}) {
  const channelWord = channel === 'shp' ? 'Shopify ' : channel === 'amz' ? 'Amazon ' : '';
  const pct = (v: number) => (summary.total > 0 ? Math.round((v / summary.total) * 100) : 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {channelWord}price changes · last {windowLabel}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <span className="text-6xl font-bold leading-none tabular-nums text-brand-600">{n(summary.total)}</span>
        {summary.total > 0 && (
          <>
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium tabular-nums text-green-700">
              ▲ {n(summary.up)} up
            </span>
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium tabular-nums text-red-600">
              ▼ {n(summary.down)} down
            </span>
            {summary.flat > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500">
                {n(summary.flat)} held
              </span>
            )}
          </>
        )}
      </div>

      {summary.total === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No price changes in this window.</p>
      ) : (
        <div className="mt-5 border-t border-slate-200 pt-4">
          {/* Direction bar — the up/down balance of the window at a glance. */}
          <div className="mb-3 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="bg-green-500" style={{ width: `${pct(summary.up)}%` }} title={`${summary.up} raised`} />
            <div className="bg-red-400" style={{ width: `${pct(summary.down)}%` }} title={`${summary.down} cut`} />
          </div>

          {/* Channel split — only meaningful when both channels are in scope. */}
          {channel === 'all' && (
            <div className="mb-4 flex gap-4 text-xs text-slate-500">
              <span>Shopify <strong className="tabular-nums text-slate-700">{n(summary.shp)}</strong></span>
              <span>Amazon <strong className="tabular-nums text-slate-700">{n(summary.amz)}</strong></span>
            </div>
          )}

          {/* By operator — the staff-progress read, and the filter control for the table below. */}
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">By user</div>
          <div className="flex flex-wrap gap-2">
            {summary.byUser.map((u) => (
              <UserCard key={u.user ?? '__none'} u={u} active={!!u.user && u.user === activeUser} onPick={onPickUser} n={n} />
            ))}
          </div>
          {/* No "clear filter" link here — the filter row at the top clears it, and clicking the active card toggles it off. */}
        </div>
      )}
    </div>
  );
}

// One operator's window at a glance — total, then the up/down split beneath. Clickable when attributed; the unattributed bucket (legacy
// rows with no changed_by) is shown for completeness but can't be filtered to, since there's no name to match on.
function UserCard({
  u, active, onPick, n,
}: {
  u: PriceChangeUserStat;
  active: boolean;
  onPick: (u: string | null) => void;
  n: (v: number) => string;
}) {
  const label = u.user ?? 'Unattributed';
  const base = 'rounded-lg border px-3 py-2 text-left transition ';
  const look = active
    ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-400'
    : u.user
      ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      : 'border-slate-200 bg-slate-50/60';

  const body = (
    <>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-slate-800">{n(u.total)}</span>
        <span className="text-xs tabular-nums text-slate-400">
          <span className="text-green-600">▲{n(u.up)}</span> <span className="text-red-500">▼{n(u.down)}</span>
        </span>
      </div>
    </>
  );

  if (!u.user) return <div className={base + look}>{body}</div>;

  return (
    <button
      type="button"
      onClick={() => onPick(u.user)}
      aria-pressed={active}
      className={base + look}
      title={active ? 'Click to clear the user filter' : `Show only ${label}'s changes below`}
    >
      {body}
    </button>
  );
}

// Below this many changes behind a percentage, the percentage is indicative only — Summer's 91% is ten of eleven, and one different
// outcome makes it 82%. Muted and badged rather than hidden, and the denominator is always on screen next to it.
const MIN_SAMPLE = 30;

// -------------------------------------------------------------------------------------------------------------------------------------
// IMPACT PANEL — the staff read: "is the repricing time paying for itself?". One row per operator, on its own fixed basis (last 90 days,
// both channels, everyone) regardless of every filter above.
//
// Three rules the layout enforces, each learned the hard way:
//   1. NO AVERAGE OF MONEY. A hero "£7.46 extra per raise" was arithmetically right and practically a lie: median £1.40, 94 of 277 raises
//      sold nothing, and ten raises made 47% of the quarter's cash. An average implies a typical case that does not exist here. Hit rates
//      (a count over a stated denominator) and totals both survive that skew.
//   2. RAISE RATES SPLIT BY CHANNEL. Shopify 51% vs Amazon 76% in the same period, so a blended rate largely measures channel mix — and
//      comparing a 60%-Amazon operator's blend against a 100%-Shopify operator's blend says nothing. Cut rates matched (81/82), so those
//      two blocks are summed for display.
//   3. RAISES AND CUTS NEVER NET OFF. Different jobs, different targets: cash in versus stock shifted. Netting the discount on a cut
//      against the cash from a raise would penalise doing the LOSERS job correctly.
//
// A table rather than cards: it scales to any headcount by adding rows, and it puts each operator's denominators directly under each
// other, which is the comparison the panel exists to support.
// -------------------------------------------------------------------------------------------------------------------------------------
function ScorecardPanel({
  cards, settleDays, scoreWindowDays, activeUser, onPickUser, n,
}: {
  cards: PriceChangeScorecard[];
  settleDays: number;
  scoreWindowDays: number;
  activeUser: string;
  onPickUser: (u: string | null) => void;
  n: (v: number) => string;
}) {
  const totalSettled = cards.reduce((a, c) => a + c.settled, 0);
  const totalPending = cards.reduce((a, c) => a + c.pending, 0);

  return (
    <div className="mt-7 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Impact</h2>
        {/* Glance-level only. This panel has its own fixed period and does NOT follow the switches above; showing a period that disagrees
            with the window switch is itself the signal, and the reasoning sits in the toggle below for anyone who wants it.
            The old label read "Last 90 days · 551 changes", which was wrong in the way that matters: 551 is the SCORED subset, not the
            window's activity, so a month of hard repricing appeared to have produced nothing and the panel read as stale. Stating the
            fraction ("551 of 899") makes the missing work visible in the number itself rather than only in the explainer below. */}
        <span className="text-xs text-slate-400">
          Scoring {n(totalSettled)} of {n(totalSettled + totalPending)} changes · last {scoreWindowDays} days
        </span>
      </div>

      {/* The reasoning lives behind a toggle — it matters once, not on every visit. Same pattern as the Birk Tracker intro. */}
      <details className="group mt-1">
        <summary className="cursor-pointer list-none text-xs text-slate-400 transition hover:text-slate-600">
          <span className="inline-flex items-center gap-1">
            How this is counted <span className="transition group-open:rotate-180">▾</span>
          </span>
        </summary>
        <div className="mt-2 max-w-2xl space-y-2 text-xs leading-relaxed text-slate-500">
          <p>
            Always the <strong>last {scoreWindowDays} days</strong> and both channels, whatever the switches above say. A change is scored
            once it&rsquo;s <strong>{settleDays} days</strong> old — before that it hasn&rsquo;t had a chance to sell, so it sits as
            <em> pending</em> and joins the figures as it ages.
          </p>
          <p>
            <strong>Sold</strong> means the item shifted at least one unit while that price was live. Raises are split Shopify from Amazon
            because the two behave differently and a combined figure would just reflect which channel someone worked.
          </p>
          <p>
            <strong>Holds</strong> are styles looked at and deliberately left where they were, usually with the reasoning in the note.
            They&rsquo;re counted, not scored — a hold isn&rsquo;t trying to move anything, so &ldquo;did it sell?&rdquo; says nothing about
            it. Unlike the rest of the row they include recent ones, since a hold isn&rsquo;t waiting on a sale to prove itself.
          </p>
          <p>
            Cash figures are <strong>gross</strong> and assume those units would have sold anyway. First-time prices on new products
            aren&rsquo;t raises or cuts and sit outside every column here.
          </p>
        </div>
      </details>

      {cards.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No price changes in the last {scoreWindowDays} days.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2 pr-3 text-left font-medium">Who</th>
                <th className="pb-2 px-3 text-left font-medium" colSpan={2}>Raises that sold</th>
                <th className="pb-2 px-3 text-left font-medium">Cuts that moved</th>
                <th className="pb-2 px-3 text-right font-medium">Holds</th>
                <th className="pb-2 px-3 text-right font-medium">Cash in</th>
                <th className="pb-2 pl-3 text-right font-medium">Cleared</th>
              </tr>
              <tr className="text-[11px] text-slate-400">
                <th className="pb-2 pr-3" />
                <th className="pb-2 px-3 text-left font-normal">Shopify</th>
                <th className="pb-2 px-3 text-left font-normal">Amazon</th>
                <th className="pb-2 px-3 text-left font-normal">both channels</th>
                <th className="pb-2 px-3 text-right font-normal">left alone</th>
                <th className="pb-2 px-3 text-right font-normal">from raises</th>
                <th className="pb-2 pl-3 text-right font-normal">by cuts</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <OperatorRow
                  key={c.user ?? '__none'}
                  c={c}
                  active={!!c.user && c.user === activeUser}
                  onPick={onPickUser}
                  n={n}
                  settleDays={settleDays}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// One operator's row. Clicking the name filters the detail table below to them (same toggle the summary's user cards use).
function OperatorRow({
  c, active, onPick, n, settleDays,
}: {
  c: PriceChangeScorecard;
  active: boolean;
  onPick: (u: string | null) => void;
  n: (v: number) => string;
  settleDays: number;
}) {
  const label = c.user ?? 'Unattributed';
  const money = (v: number) => (v ? `£${Math.round(v).toLocaleString('en-GB')}` : '—');

  // Cuts are summed across channels — safe only because the two rates currently match; the server keeps them split so a divergence stays
  // visible rather than being blended away here forever.
  const cuts = c.shp.cuts + c.amz.cuts;
  const cutsMoved = c.shp.cutsMoved + c.amz.cutsMoved;
  const cashIn = c.shp.raiseCash + c.amz.raiseCash;
  const cleared = c.shp.cutUnits + c.amz.cutUnits;

  return (
    <tr className={'border-t border-slate-100 ' + (active ? 'bg-brand-50/40' : '')}>
      <td className="py-2.5 pr-3 align-top">
        {c.user ? (
          <button
            type="button"
            onClick={() => onPick(c.user)}
            aria-pressed={active}
            className="text-sm font-semibold text-slate-800 underline-offset-2 hover:underline"
            title={active ? 'Click to clear the user filter' : `Show only ${label}'s changes below`}
          >
            {label}
          </button>
        ) : (
          <span className="text-sm font-semibold text-slate-500">{label}</span>
        )}
        {/* Per-operator, because the panel header can't answer "is it MY work that's missing?" — the question a busy operator asks when
            their row looks thin.
            Phrased as a FRACTION, the same shape the hit rates below it and the panel header already use ("53 of 112", "Scoring 551 of
            899"). A separate "pending" figure made the same fact a third vocabulary on one panel and needed a tone of its own to sit
            beside the scored count — which then had to be tuned so the aside didn't outshout the sample size. "of" removes the problem
            rather than balancing it: one number, one denominator, no second colour, and the shortfall is legible without being named. */}
        <div className="text-[11px] tabular-nums text-slate-400" title={c.pending > 0 ? `${c.pending} changed in the last ${settleDays} days — not yet old enough to score` : undefined}>
          {n(c.settled)} scored{c.pending > 0 && <> of {n(c.settled + c.pending)}</>}
        </div>
      </td>
      <td className="px-3 align-top"><HitRate made={c.shp.raises} hit={c.shp.raisesSold} n={n} tone="emerald" /></td>
      <td className="px-3 align-top"><HitRate made={c.amz.raises} hit={c.amz.raisesSold} n={n} tone="emerald" /></td>
      <td className="px-3 align-top"><HitRate made={cuts} hit={cutsMoved} n={n} tone="sky" /></td>
      {/* Holds: a count, never a rate — there's no outcome to hit, the style was deliberately left where it was. Kept visually quiet and
          grouped right with the other plain counts: it's context on how much was reviewed, not a result to be weighed against the rates. */}
      <td className="px-3 pt-2.5 text-right align-top tabular-nums text-slate-400">
        {c.excluded.level ? n(c.excluded.level) : '—'}
      </td>
      <td className="px-3 pt-2.5 text-right align-top tabular-nums text-slate-700">{money(cashIn)}</td>
      <td className="pl-3 pt-2.5 text-right align-top tabular-nums text-slate-700">{cleared ? n(cleared) : '—'}</td>
    </tr>
  );
}

// A hit rate: the percentage large enough to compare at a glance, with its denominator ALWAYS underneath. The counts are the honest part —
// a percentage over eleven tries looks every bit as authoritative as one over 277, so under MIN_SAMPLE it's muted to say otherwise.
function HitRate({
  made, hit, n, tone,
}: {
  made: number;
  hit: number;
  n: (v: number) => string;
  tone: 'emerald' | 'sky';
}) {
  if (!made) return <div className="pt-2.5 text-sm text-slate-300">—</div>;

  const pct = Math.round((hit / made) * 100);
  const thin = made < MIN_SAMPLE;
  const colour = thin ? 'text-slate-400' : tone === 'emerald' ? 'text-emerald-700' : 'text-sky-700';

  return (
    <div className="py-1">
      {/* A thin sample no longer carries a "few" label — the "x of y" line directly under the percentage already states the denominator,
          which is the same warning said in numbers. The greyed-out colour still marks it, so the signal survives without the clutter. */}
      <div className={'text-xl font-bold leading-none tabular-nums ' + colour}>{pct}%</div>
      <div className="text-[11px] tabular-nums text-slate-500">
        {n(hit)} of {n(made)}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// One change row. Clickable -> the cross-module reprice/copy chooser. Amazon rows pass their exact SKU code so the Amazon action
// deep-links straight to that size's drill; the copy/Shopify actions use the resolved groupid.
// -------------------------------------------------------------------------------------------------------------------------------------
function ChangeRow({
  r, actions, money, fmtWhen, fmtAge,
}: {
  r: PriceChangeRow;
  actions: ReturnType<typeof useProductActions>;
  money: (v: number | null) => string;
  fmtWhen: (iso: string | null) => string;
  fmtAge: (d: number | null) => string;
}) {
  // Direction of the move (drives the arrow + colour). Neutral to channel — the logo chip carries channel identity.
  const dir =
    r.oldPrice === null || r.newPrice === null ? 'flat'
    : r.newPrice > r.oldPrice ? 'up'
    : r.newPrice < r.oldPrice ? 'down'
    : 'flat';
  // "24 Jul" — only ever used inside the latest-profit tooltip, so it stays local to the row.
  const fmtDay = (d: string) => {
    const dt = new Date(d);
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}`;
  };

  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→';
  const arrowClass = dir === 'up' ? 'text-emerald-600' : dir === 'down' ? 'text-rose-600' : 'text-slate-400';

  // The chooser needs a style key; every Amazon code currently resolves to a groupid, but fall back to the code so copy still works.
  const actionKey = r.groupid || r.amzCode || '';

  return (
    <tr
      onClick={(e) => actions.open(e, actionKey, { title: r.title, amzCode: r.amzCode })}
      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
      title="Click to reprice or copy"
    >
      {/* Date over age rather than side by side: the age is secondary, and on one line it forced the column wide enough for the longest
          "13 Jul, 00:55 · 21d ago" on the page, stealing width from the product name that actually needs it. */}
      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
        <div>{fmtWhen(r.changedAt)}</div>
        <div className="text-xs text-slate-400">{fmtAge(r.daysSince)}</div>
      </td>
      <td className="px-4 py-2.5">
        <ChannelBadge channel={r.channel === 'AMZ' ? 'amazon' : 'shopify'} />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm tracking-tight text-slate-900">{r.groupid || r.amzCode || '—'}</span>
          {r.size && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{r.size}</span>
          )}
        </div>
        <div className="text-xs text-slate-400">{r.title || 'Untitled'}</div>
        {r.note && <div className="mt-0.5 text-xs italic text-slate-400">“{r.note}”</div>}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
        <span className="text-slate-500">{money(r.oldPrice)}</span>
        <span className={'mx-1.5 ' + arrowClass}>{arrow}</span>
        <span className="font-medium text-slate-800">{money(r.newPrice)}</span>
      </td>
      {/* Units sold while this exact price was live — the bounded figure, and nothing else. The cash effect used to sit under it but it
          was a second number per row for a column read at a glance. A change too young to judge is greyed (with the reason on hover),
          so it still reads as "not yet" rather than "failed". */}
      <td
        className={'px-3 py-2.5 text-right tabular-nums ' + (r.settled ? 'text-slate-800' : 'text-slate-400')}
        title={r.settled ? 'Units sold while this price was live' : 'Too soon to judge — this price has not been live long enough'}
      >
        {r.unitsLive}
      </td>
      {/* Profit on the latest sale made AT THE NEW PRICE — bounded to the same run as the Sold count beside it, so the two always agree
          (0 sold -> dash here). Deliberately NOT the New Additions unbounded latest sale: on a row repriced last week that would show a
          sale from March at the old price. A loss is called out in rose — a change that left the line selling below cost is the one
          thing in this table worth interrupting for. */}
      <td
        className={
          'px-3 py-2.5 text-right tabular-nums ' +
          (r.lastProfit === null ? 'text-slate-300' : r.lastProfit < 0 ? 'font-medium text-rose-600' : 'text-slate-700')
        }
        title={r.lastSold ? `Profit on the latest sale at this price — ${fmtDay(r.lastSold)}` : 'Nothing sold since the change'}
      >
        {money(r.lastProfit)}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{r.changedBy || '—'}</td>
    </tr>
  );
}
