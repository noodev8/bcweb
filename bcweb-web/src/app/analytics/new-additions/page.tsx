'use client';
/*
=======================================================================================================================================
Page: /analytics/new-additions  (Analytics module — New Additions)
=======================================================================================================================================
Purpose: The catalogue-GROWTH pulse. How many Shopify styles were ADDED in the recent window (default: last 30 days), and how each new
         addition is doing — units sold, revenue and profit so far (lifetime ≈ since-add, as these are brand-new products). Loading it
         now and again tells the owner whether the month brought a lot of new product or a little, and whether the new lines sell.

         HERO number = count of new styles in the window (the thing being monitored). A small window toggle (30 / 60 / 90 days) lets the
         lens widen. Below, a table of the additions themselves, newest-created first.

THE BACK LINK NAMES WHERE YOU CAME FROM. This screen is reachable from the Reports index AND from the "added this year" card on
         Reports -> Winners, so the arrow reads `?from=` / `?back=` and falls back to Reports when they are absent (the same
         convention the Winners screen itself uses). A hard-coded "Reports" arrow would strand anyone who arrived from Winners —
         they would have to navigate back down two levels to return to the screen they were reading.

Guarded by AppShell. Consumes GET /analytics-new-additions (the list) and, via AdditionsTrend, GET /analytics-new-additions-trend
         (the production pace — a different question off a different table, see that component).
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AdditionsTrend from '@/components/AdditionsTrend';
import ProductNavCards from '@/components/ProductNavCards';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getNewAdditions,
  getNewAdditionsTrend,
  NewAdditionRow,
} from '@/lib/api';

// Fixed 30-day window, no lens toggle (owner decision, re-confirmed 2026-07-27 after a brief try at 60). The month is the unit the
// owner thinks in, so the screen shows a month — full stop. Yes, ticking the 21+ filter then leaves only a ~9-day slice; that is
// accepted (a heavy intake month fills it anyway, and unticking always shows the whole 30 days).
const DAYS = 30;
// "Settled in" threshold for the table filter: a line live this long has had a fair chance to sell. 14, not 21 (owner 2026-07-27) —
// inside a 30-day window, 21 left too thin a slice to be a useful list; a fortnight is enough of a chance to judge one.
const MATURE_DAYS = 14;

// Stable identities for "nothing loaded yet". A fresh [] each render would change the identity of everything derived from it
// (the sortedRows useMemo below), defeating the memo.
type SortKey = 'added' | 'sold' | 'profit' | 'stock';

const NO_ROWS: NewAdditionRow[] = [];

export default function NewAdditionsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <NewAdditionsPageInner />
    </Suspense>
  );
}

function NewAdditionsPageInner() {
  // Where the back arrow goes. Defaults to the Reports index, which is how this screen is reached from the module grid.
  const searchParams = useSearchParams();
  const backHref = searchParams.get('from') || '/analytics';
  const backLabel = searchParams.get('back') || 'Reports';

  const router = useRouter();
  const pathname = usePathname();

  // VIEW STATE LIVES IN THE URL (owner, 2026-09-26): sort, the maturity filter and the selected row are seeded from ?sort= ?dir=
  // ?mature= ?sel= and written back with router.replace from the event handlers (never an effect). That is what makes the hand-off
  // cards' "← Back" land on the list exactly as it was left, highlight included. Read ONCE into initial state.
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    const v = searchParams.get('sort');
    return v === 'sold' || v === 'profit' || v === 'stock' ? v : 'added';
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (searchParams.get('dir') === 'asc' ? 'asc' : 'desc'));
  const [matureOnly, setMatureOnly] = useState(() => searchParams.get('mature') === '1');
  const [selected, setSelected] = useState<string | null>(() => searchParams.get('sel'));

  // The URL for a given view. from/back are carried through untouched so this screen's own back arrow survives the round trip.
  const viewUrl = (v: { sort: SortKey; dir: 'asc' | 'desc'; mature: boolean; sel: string | null }) => {
    const q = new URLSearchParams();
    const from = searchParams.get('from');
    const back = searchParams.get('back');
    if (from) q.set('from', from);
    if (back) q.set('back', back);
    if (v.sort !== 'added') q.set('sort', v.sort);
    if (v.dir !== 'desc') q.set('dir', v.dir);
    if (v.mature) q.set('mature', '1');
    if (v.sel) q.set('sel', v.sel);
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const current = { sort: sortBy, dir: sortDir, mature: matureOnly, sel: selected };
  const selfUrl = viewUrl(current);
  const setView = (patch: Partial<typeof current>) => {
    const next = { ...current, ...patch };
    setSortBy(next.sort); setSortDir(next.dir); setMatureOnly(next.mature); setSelected(next.sel);
    router.replace(viewUrl(next), { scroll: false });
  };
  const [showAbout, setShowAbout] = useState(false);                         // the "what is this screen" blurb — off by default

  // "Now" is captured HERE, inside the fetcher, not during render. Date.now() is impure, so reading it while rendering makes the
  // output depend on when React happens to re-render (react-hooks/purity). Capturing it alongside the rows also reads better: the
  // ages shown are "as at the time we loaded the list", which is what the numbers next to each row actually mean.
  const { data, error: loadError, busy: loading } = useApiQuery(
    ['new-additions', DAYS],
    async () => {
      const res = await getNewAdditions(DAYS);
      if (res.success && res.data) {
        return { success: true, data: { rows: res.data.rows, loadedAt: Date.now() }, return_code: 'SUCCESS' };
      }
      return { success: false, error: res.error || 'Failed to load New Additions', return_code: res.return_code };
    },
  );
  // THE PACE FIGURES beside the hero. Same SWR key as <AdditionsTrend> below, so this is the SAME request — SWR dedupes and the
  // chart and these tiles can never show different numbers. Read from the trend route, NOT from `rows`: rows are survivors out of
  // skusummary, while pace comes from product_event_log and therefore matches the Winners screen's "added" tile exactly.
  const { data: trend } = useApiQuery(['new-additions-trend'], () => getNewAdditionsTrend());
  const pace = trend?.pace ?? null;

  const rows: NewAdditionRow[] = data?.rows ?? NO_ROWS;
  const loadedAt = data?.loadedAt ?? null;
  const error = loadError?.message ?? null;

  // Whole days between the creation date and when the list was loaded — how long the line has been live. Uses the `loadedAt`
  // snapshot rather than Date.now() so this stays a pure function of state (see the note on loadedAt above).
  const daysLive = (d: string | null) => {
    if (!d || loadedAt === null) return null;
    const ms = loadedAt - new Date(d).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  };

  // The maturity lens (owner): a style added three days ago selling nothing tells you nothing — it hasn't had a chance yet. With the
  // toggle on, only lines live MATURE_DAYS+ survive.
  //
  // It filters the TABLE ONLY — the hero strip above stays the whole 30-day month, always (owner 2026-07-27). The hero is the month's
  // fixed picture: "we added N styles and they've done £X". A number that moves when you tick a checkbox isn't a monthly stat any
  // more, and you can't compare it with the last time you looked. The filter is a lens on the working list, not a redefinition of
  // the month. Client-side on the already-loaded window — no re-fetch, and flipping it back is instant.
  const visibleRows = useMemo(() => {
    if (!matureOnly) return rows;
    if (loadedAt === null) return rows;
    const cutoff = loadedAt - MATURE_DAYS * 86400000;
    return rows.filter((r) => r.created !== null && new Date(r.created).getTime() <= cutoff);
  }, [rows, matureOnly, loadedAt]);
  const hiddenCount = rows.length - visibleRows.length;

  // All sorting is client-side on the already-loaded rows (no re-fetch). Compare on the active column, then flip for direction; ties
  // fall back to newest-added so the order is stable.
  const sortedRows = useMemo(() => {
    const cmp = (a: NewAdditionRow, b: NewAdditionRow) => {
      let c: number;
      if (sortBy === 'sold') c = a.units - b.units;
      // Never-sold rows have no latest profit; they sort to the bottom in the default (desc) view rather than pretending to be £0.
      else if (sortBy === 'profit') c = (a.lastProfit ?? -Infinity) - (b.lastProfit ?? -Infinity);
      else if (sortBy === 'stock') c = a.stock - b.stock;
      else c = (a.created || '').localeCompare(b.created || '');
      if (c === 0 && sortBy !== 'added') c = (a.created || '').localeCompare(b.created || '');
      return sortDir === 'asc' ? c : -c;
    };
    return [...visibleRows].sort(cmp);
  }, [visibleRows, sortBy, sortDir]);

  // ROW SELECTION (owner, 2026-09-26): click a row to highlight it, click it again to clear it. Mouse only, no keyboard cursor,
  // and no reprice/copy chooser — it just marks your place while you read down the list. Keyed by groupid, so a re-sort keeps the
  // highlight on the same style. It also enables the hand-off cards above the table (state: `selected`, above).

  // Click a sortable header: same column flips direction; a new column switches to it, defaulting to descending (most / newest first).
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setView({ dir: sortDir === 'asc' ? 'desc' : 'asc' });
    else setView({ sort: key, dir: 'desc' });
  };
  const caret = (key: SortKey) =>
    sortBy === key ? <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

  const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);
  // Discounted = current live price sits below RRP (both must be readable numbers). Drives the amber highlight on the Price cell.
  const isDiscounted = (r: NewAdditionRow) => r.price !== null && r.rrp !== null && r.price < r.rrp;
  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}`;
  };
  return (
    <AppShell
      /* No page title — the card is called "New" and the back link already names the module; the screen keeps the vertical space. */
      backHref={backHref}
      backLabel={backLabel}
    >
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && (
        <>
          {/* HERO — how many new styles this window. Supporting sales totals demoted beside it. */}
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
              <div>
                {/* The window is spelled out under the number, not just in the (now hidden) blurb — the money beside it is easy to read
                    as "this month" out of habit, so the 60 has to be impossible to miss. */}
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">New styles</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-6xl font-bold leading-none tabular-nums text-brand-600">{rows.length}</span>
                </div>
                <div className="mt-1.5 text-sm text-slate-500">
                  added in the last <strong className="font-semibold text-slate-700">{DAYS} days</strong>
                </div>
              </div>
              {/* PACE, NOT EARNINGS (owner, 2026-09-22): "My intention for new styles is to push/prompt to find new ones and check
                  progress. Shouldnt be a reflection of revenue contribution."

                  WHAT WAS HERE AND WHY IT HAD TO GO: units sold, revenue and profit for the 30-day cohort — which read 0 / £0.00 /
                  £0.00 on the day this changed, and that was CORRECT, not a bug. Median time from creating a style to its first sale
                  is 20 days (mean 32), so a 30-day window is mostly styles that have not had time to sell yet. Those tiles were
                  guaranteed to read about zero however well the adding was going: a progress panel rigged to look like failure. The
                  earnings question is real but it belongs to the Winners screen, which measures it over twelve months.

                  SINCE LAST ONE is the push. It is the only figure here that gets WORSE on its own, every quiet day, which is what
                  makes it a prompt rather than a report. */}
              <div className="flex gap-8 border-l border-slate-200 pl-8 text-sm">
                <Stat
                  label="This month"
                  value={pace ? String(pace.thisMonth) : '—'}
                  sub={pace ? `vs ${pace.monthlyAvg12} in an average month` : undefined}
                />
                <Stat
                  label="Last 12 months"
                  value={pace ? pace.rolling12.toLocaleString('en-GB') : '—'}
                  sub={pace ? `${signed(pace.rolling12 - pace.rollingPrior12)} vs the 12 months before` : undefined}
                />
                <Stat
                  label="Since last one"
                  value={pace?.daysSinceLast === null || pace === null ? '—' : dayGap(pace.daysSinceLast)}
                  sub={pace?.lastAdded ? `added ${shortDate(pace.lastAdded)}` : 'nothing added yet'}
                />
              </div>
              {/* The blurb explains the screen once; after that it is just text in the way (owner 2026-07-27), so it lives behind this
                  toggle. The toggle sits in the hero's own corner rather than the page header: with no page title, a header-row button
                  was left holding an otherwise empty band of its own. Icon-only at rest — it costs no row here. */}
              <button
                type="button"
                onClick={() => setShowAbout((v) => !v)}
                aria-expanded={showAbout}
                aria-label="What does this screen show?"
                title={showAbout ? 'Hide what this screen shows' : 'What does this screen show?'}
                className={
                  'ml-auto self-start rounded-md p-1 transition ' +
                  (showAbout ? 'bg-slate-100 text-slate-600' : 'text-slate-300 hover:bg-slate-50 hover:text-slate-500')
                }
              >
                <InformationCircleIcon className="h-5 w-5" />
              </button>
            </div>
            {showAbout && (
              <p className="mt-4 max-w-3xl border-t border-slate-100 pt-3 text-sm text-slate-500">
                Styles <strong>added in the last {DAYS} days</strong>, newest first — and how each new line has sold so far (all channels). A
                quick read on whether the month brought a lot of new product or a little. Tick <strong>{MATURE_DAYS}+ days live only</strong>
                to drop the lines from the list that are still too new to judge — the totals above always cover the full {DAYS} days.
              </p>
            )}
          </div>

          {/* PRODUCTION — the pace of making new product, this year against last. Sits between the hero (what the last 30 days
              brought) and the list (what those additions are), because it is the same subject at a longer focal length. Loads its
              own data, so it can't hold the list up. */}
          <AdditionsTrend />

          {/* Hand-off row — the same cards as the product hub, greyed until a row is selected, plus Product (the style's own page)
              first. Above the table so it is in view when you pick a row. Every card carries this exact view as ?from=. */}
          {rows.length > 0 && (
            <div className="mb-3">
              <ProductNavCards groupid={selected} from={selfUrl} showProduct />
            </div>
          )}

          {/* Table controls. The filter sits HERE, not in the hero — it changes the list below it and nothing above it, and being next
              to the row count makes that obvious at a glance. */}
          {rows.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
              <span className="text-slate-500">
                {matureOnly
                  ? <>Showing <strong className="font-semibold text-slate-700">{visibleRows.length}</strong> of {rows.length}</>
                  : <>All <strong className="font-semibold text-slate-700">{rows.length}</strong>, newest first</>}
              </span>
              <label className="flex cursor-pointer select-none items-center gap-2 text-slate-600"
                     title={`Hide styles added less than ${MATURE_DAYS} days ago — too new to judge. The totals above stay the full ${DAYS} days.`}>
                <input
                  type="checkbox"
                  checked={matureOnly}
                  // Changing the lens CLEARS the cursor, both ways round (owner, 2026-07-28). The list you get back is a different
                  // list, so a highlight carried over from the old one is meaningless — worse than meaningless when the row it was on
                  // has just been filtered away, because the hook would otherwise re-seat it on whatever now sits at that position and
                  // that looks like a selection you made. Start clean and let the operator place it again.
                  onChange={(e) => setView({ sel: null, mature: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                />
                <span>
                  {MATURE_DAYS}+ days live only
                  {matureOnly && hiddenCount > 0 && (
                    <span className="ml-1.5 text-xs text-slate-400">({hiddenCount} too new)</span>
                  )}
                </span>
              </label>
            </div>
          )}

          {visibleRows.length === 0 ? (
            <p className="text-sm text-slate-400">
              {matureOnly && rows.length > 0
                ? `Every style added in the last ${DAYS} days is under ${MATURE_DAYS} days live — untick the filter to see them.`
                : `No styles were added in the last ${DAYS} days.`}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">
                      <button
                        onClick={() => toggleSort('added')}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${sortBy === 'added' ? 'text-slate-800' : ''}`}
                        title="Sort by date added"
                      >
                        Added {caret('added')}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Days since the style was created">Days</th>
                    <th className="px-4 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 font-medium">Brand</th>
                    <th className="px-3 py-2.5 text-right font-medium">RRP</th>
                    <th className="px-3 py-2.5 text-right font-medium">Price</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        onClick={() => toggleSort('sold')}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${sortBy === 'sold' ? 'text-slate-800' : ''}`}
                        title="Sort by units sold — units since the style was added, not a 30-day window"
                      >
                        {caret('sold')} Sold
                      </button>
                    </th>
                    {/* Latest sale's profit — deliberately NOT the lifetime total (which blends the launch price with later
                        discounting). This is what the style made last time it sold, i.e. at the price it is on now. */}
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        onClick={() => toggleSort('profit')}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${sortBy === 'profit' ? 'text-slate-800' : ''}`}
                        title="Sort by profit on the most recent sale"
                      >
                        {caret('profit')} Profit
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        onClick={() => toggleSort('stock')}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${sortBy === 'stock' ? 'text-slate-800' : ''}`}
                        title="Sort by stock"
                      >
                        {caret('stock')} Stock
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr
                      key={r.groupid}
                      onClick={() => setView({ sel: selected === r.groupid ? null : r.groupid })}
                      className={
                        'cursor-pointer border-b border-slate-100 last:border-0 ' +
                        (selected === r.groupid
                          // Tint only, no left bar (owner, 2026-09-26).
                          ? 'bg-brand-50'
                          : 'hover:bg-slate-50/60')
                      }
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                        {fmtDate(r.created)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {daysLive(r.created) !== null ? daysLive(r.created) : '—'}
                      </td>
                      {/* Title lives in the tooltip (owner, 2026-09-26) — one line per row, the groupid is what gets read. */}
                      <td className="px-4 py-2 font-mono text-sm tracking-tight text-slate-900" title={r.title || 'Untitled'}>
                        {r.groupid}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.brand || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(r.rrp)}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          isDiscounted(r) ? 'font-medium text-amber-600' : 'text-slate-700'
                        }`}
                        title={isDiscounted(r) ? 'Below RRP — discounted' : undefined}
                      >
                        {money(r.price)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.units}</td>
                      <td
                        className={
                          'px-3 py-2 text-right tabular-nums ' +
                          (r.lastProfit === null ? 'text-slate-300' : r.lastProfit < 0 ? 'font-medium text-rose-600' : 'font-medium text-slate-800')
                        }
                        title={r.lastSold ? `Profit on the latest sale — ${fmtDate(r.lastSold)}` : 'Not sold yet'}
                      >
                        {money(r.lastProfit)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

    </AppShell>
  );
}

// +87 / -3 / 0 — the sign is carried explicitly because a bare number next to "vs the 12 months before" reads as the comparison
// figure itself rather than the movement.
function signed(n: number) {
  return `${n > 0 ? '+' : ''}${n.toLocaleString('en-GB')}`;
}

// The gap since the last product was made, in the words someone would actually say. "0 days" is the wrong answer for something
// added this morning, and it is the one the prompt most needs to get right — that is the day it should feel best, not broken.
function dayGap(days: number) {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days`;
}

// '2026-09-19' -> '19 Sep'. Split on the hyphens rather than via Date: a 'YYYY-MM-DD' string handed to Date is parsed as UTC
// midnight and renders as the previous day once BST shifts it back (CLAUDE.md's date landmine, the front-end half of it).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string) {
  const [, m, d] = iso.split('-');
  const mi = Number(m) - 1;
  if (!d || mi < 0 || mi > 11) return iso;
  return `${Number(d)} ${MONTHS[mi]}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-700">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
