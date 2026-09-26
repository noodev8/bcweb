'use client';
/*
=======================================================================================================================================
Page: /seasons  (Back Office → Seasons)
=======================================================================================================================================
Purpose: Which styles really sell all year? Every style's season (Summer | Winter | Any) beside its year of sales month by month, so
         the owner can glance, filter, and re-season in bulk.

         What season is for now: NOT the portfolio status. Until 2026-09-26 a WINNER had to be in season (an out-of-season earner
         was HARVEST); season left the status that day and HARVEST was retired (bcweb-server/utils/portfolioStatus.js). Season still
         drives Inventory's WINTER / SUMMER commands and the Google Ads season filter, and this screen is where it is set in bulk.

         ITS OWN BACK OFFICE JOB, NOT PART OF REPRICING (owner, 2026-09-25): done every quarter or so, in a review mindset, maybe
         before a full winners/prices/stock review. So it links nowhere into the pricing flow.

         NO "SUGGESTED" FILTER (removed 2026-09-26 — owner: "I'm not using it"). It narrowed the list to the styles the server flags as
         candidates for a re-season (routes/product-seasons.js still computes `suggested`). The owner reads the month strip instead.
         Bring it back from git history if that changes.

         NO "UPDATE STATUSES" STEP any more: with season out of the status rules, a re-season changes no status, so there is nothing
         to re-tag after one.

         New products aren't this screen's concern — whoever enters them sets their season, and they are in it at the time.

         CAN'T GET IT lives here too (owner, 2026-09-26 — "where we set seasons and switch can't get it on and off"). A SEPARATE fact,
         shown beside the season and never merged into it: season is "when does it sell"; can't get is "can I buy more" — for
         ordering it is THE test (owner, 2026-09-26: "for ordering, I should use Can't get / Release as the de facto"), and it only takes
         a style off the order screens for three months (bcweb-server/utils/noSupply.js). It is about the STYLE, whichever channel it
         sells on — no wording here names one. So: a Can't get view drawn apart from the season switch, listing every marked style
         whatever its season; a marker beside the code on every view; and a Can't get / Release pair in the bulk bar, after a divider.
         The words are Can't get and Release, not park/unpark: "parked" already means a pricing review date on Repricing. It is set
         mostly from an order screen, where you find out; this is where you see them all.

Guarded by AppShell. Consumes GET /product-seasons; writes POST /product-season-bulk, POST /no-supply-set, /no-supply-clear and (on
request) POST /portfolio-snapshot-update.
=======================================================================================================================================
*/

import { useMemo, useState, type ReactNode } from 'react';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getProductSeasons, setProductSeasons, setNoSupply, clearNoSupply, type SeasonName, type SeasonRow,
} from '@/lib/api';

const SEASONS: SeasonName[] = ['Summer', 'Winter', 'Any'];
// The view: one of the three seasons, or CANT_GET — every style marked "Can't get it", whatever its season (see the header). Its own
// value rather than a fourth season because it IS a different fact; it's drawn apart from the season switch for the same reason.
const CANT_GET = 'CantGet' as const;
type View = SeasonName | typeof CANT_GET;
// 'YYYY-MM-DD' -> '26 Dec' straight off the string — never through a Date (BST day-shift).
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayMonth(iso: string | null): string {
  const m = iso ? /^\d{4}-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${Number(m[2])} ${MONTH_SHORT[Number(m[1]) - 1]}` : '—';
}
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Summer = April–August, the same months as utils/portfolioStatus.js. Index = month - 1.
const isSummerIdx = (i: number) => i >= 3 && i <= 7;

type SortKey = 'style' | 'brand' | 'off' | 'revenue' | 'status';
type SortDir = 'asc' | 'desc';
// First click on a column sorts it the useful way round: names A–Z, everything else biggest / best first. A second click flips it.
const FIRST_DIR: Record<SortKey, SortDir> = { style: 'asc', brand: 'asc', off: 'desc', revenue: 'desc', status: 'asc' };
// Status sorts in rule order (Winners first), not alphabetically; untagged last.
const STATUS_ORDER = ['WINNERS', 'STEADY', 'NEW', 'LOSERS'];

function money(v: number): string {
  return '£' + Math.round(v).toLocaleString('en-GB');
}

// 'YYYY-MM' -> 'Sep 2025'
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
}

// 'YYYY-MM-DD HH:MI' -> '25 Sep 2026'
function dayLabel(at: string): string {
  const [d] = at.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTH_NAMES[(m || 1) - 1]} ${y}`;
}

/*
The year at a glance: one cell per calendar month, January first. A filled cell = sold that month, darker = more of the style's own
best month (relative, so a slow seller's shape reads as clearly as a fast one's). The style's OWN season is the tinted band, so "does
it keep selling after its season?" is the unshaded part of the strip. On an Any style there is no own season, so no band.
*/
function MonthStrip({ row }: { row: SeasonRow }) {
  const max = Math.max(...row.months, 1);
  return (
    <div className="flex gap-0.5">
      {row.months.map((u, i) => {
        const own = row.season === 'Summer' ? isSummerIdx(i) : row.season === 'Winter' ? !isSummerIdx(i) : false;
        return (
          <div
            key={i}
            title={`${MONTH_NAMES[i]}: ${u} unit${u === 1 ? '' : 's'}`}
            className={'flex h-5 w-4 items-center justify-center rounded-sm ' + (own ? 'bg-slate-100' : '')}
          >
            {u > 0 ? (
              <span className="block h-3.5 w-3 rounded-sm bg-slate-700" style={{ opacity: 0.25 + 0.75 * (u / max) }} />
            ) : (
              <span className="block h-3.5 w-3 rounded-sm border border-slate-200" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/*
THE RANGE BY SEASON (owner, 2026-09-25). Switching tabs showed how few Winter styles there are — part of why winter is quiet. This puts
it in one read, as the same table the owner was first shown: what each season's styles sold in the summer months and in the winter
months, how many styles, how many in stock, how many added in the last year, and a total. Plain figures, no bars or highlighting
(owner found a share column and a highlighted row confusing). Whole catalogue — the filters below don't touch it.
COLLAPSED BY DEFAULT (owner: "out of the way of my real work on that screen"); open/closed is remembered in this browser only.
Its header strip also carries the screen's context line (`info`) on the right — moved up from the filter row when the search box
pushed it onto a line of its own (owner, 2026-09-25).
*/

function RangePanel({ rows, open, onToggle, info }: { rows: SeasonRow[]; open: boolean; onToggle: () => void; info?: ReactNode }) {
  // `Number(...) || 0`: a server older than this panel doesn't send these fields — show £0, never NaN.
  const sum = (r: SeasonRow[]) => ({
    summer: r.reduce((n, x) => n + (Number(x.rev_summer) || 0), 0),
    winter: r.reduce((n, x) => n + (Number(x.rev_winter) || 0), 0),
    styles: r.length,
    stocked: r.filter((x) => x.in_stock).length,
    added: r.filter((x) => x.added_12m).length,
  });
  const lines = [
    ...SEASONS.map((s) => ({ label: s, total: false, ...sum(rows.filter((x) => x.season === s)) })),
    { label: 'Total', total: true, ...sum(rows) },
  ];
  const th = 'whitespace-nowrap px-3 py-1.5 text-right font-medium';
  const td = 'px-3 py-1.5 text-right tabular-nums';
  return (
    <div className="mb-6 overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-500 hover:text-slate-700"
        >
          <span className={'transition ' + (open ? 'rotate-90' : '')}>▸</span>
          Range by season
        </button>
        {info && <div className="px-3 py-1.5 text-right text-xs text-slate-400">{info}</div>}
      </div>
      {open && (
        <table className="w-full table-fixed border-t border-slate-200 text-sm">
          {/* Headings never wrap: the months sit on a small second line under the two money columns instead of in brackets
              (the bracketed form broke over two lines mid-word). Every heading bottom-aligned so the one-line ones line up. */}
          <thead className="border-b border-slate-200 text-xs text-slate-500">
            <tr className="align-bottom">
              <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium">Style&apos;s season</th>
              <th className={th}>Sold in summer<div className="font-normal text-slate-400">Apr–Aug</div></th>
              <th className={th}>Sold in winter<div className="font-normal text-slate-400">Sep–Mar</div></th>
              <th className={th}>Styles</th>
              <th className={th}>In stock</th>
              <th className={th}>Added<div className="font-normal text-slate-400">last 12 months</div></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {lines.map((x) => (
              <tr key={x.label} className={x.total ? 'border-t border-slate-200 font-medium text-slate-900' : ''}>
                <td className="px-3 py-1.5">{x.label}</td>
                <td className={td}>{money(x.summer)}</td>
                <td className={td}>{money(x.winter)}</td>
                <td className={td}>{x.styles}</td>
                <td className={td}>{x.stocked}</td>
                <td className={td}>{x.added}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// A clickable column header: the active column is darker and carries its arrow; the others show a faint arrow on hover.
function SortHeader({ k, label, right, sort, dir, onSort }: {
  k: SortKey; label: string; right?: boolean; sort: SortKey; dir: SortDir; onSort: (k: SortKey) => void;
}) {
  const active = sort === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={'group inline-flex items-center gap-1 ' + (right ? 'flex-row-reverse ' : '') + (active ? 'text-slate-800' : 'hover:text-slate-700')}
    >
      {label}
      <span className={active ? '' : 'invisible text-slate-300 group-hover:visible'}>{active && dir === 'asc' ? '▲' : '▼'}</span>
    </button>
  );
}

export default function SeasonsPage() {
  // `season` is the VIEW — a season tab, or the Can't get list (CANT_GET).
  const [season, setSeason] = useState<View>('Summer');
  // The season tab to return to when Can't get is pressed off (see toggleCantGet).
  const [lastSeason, setLastSeason] = useState<SeasonName>('Summer');
  // Range panel open/closed — a per-browser convenience, so localStorage (guarded: it can be missing or throw). Closed by default.
  const [rangeOpen, setRangeOpen] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem('seasons.rangeOpen') === '1'; } catch { return false; }
  });
  function toggleRange() {
    const next = !rangeOpen;
    setRangeOpen(next);
    try { window.localStorage.setItem('seasons.rangeOpen', next ? '1' : '0'); } catch { /* storage unavailable — just don't remember */ }
  }
  // Statuses switched OFF (owner, 2026-09-25: "not really interested in NEW at the moment"). All on by default; an untagged style
  // (none today) always shows.
  const [hiddenStatus, setHiddenStatus] = useState<Set<string>>(new Set());
  // CUT (owner, 2026-09-25: "I am working through them and dont want noise"): the ✕ on a row takes it off the list for this pass.
  // No un-cut — the Reset button starts the whole screen again. Any FILTER change resets the cuts (a new list, a new pass); a SORT
  // keeps them.
  const [cut, setCut] = useState<Set<string>>(new Set());
  // SEARCH — back 2026-09-25 (removed earlier the same day, then wanted). Plain case-insensitive "contains" on the code, brand and
  // title. It only narrows the view: ticks and cuts survive it, and a bulk change only ever hits ticked rows that are ON SCREEN.
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('off');
  const [dir, setDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, error: loadError, isLoading, refresh } = useApiQuery(['product-seasons'], () => getProductSeasons());
  const allRows = useMemo(() => data?.rows ?? [], [data]);

  // The Can't get view lists every style carrying the mark — parked now, and lapsed ones still showing "Couldn't get it" on the
  // order screens — whatever its season. The season views are unchanged.
  const inSeason = useMemo(
    () => (season === CANT_GET
      ? allRows.filter((r) => r.no_supply || !!r.no_supply_since)
      : allRows.filter((r) => r.season === season)),
    [allRows, season],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = inSeason.filter((r) => {
      if (cut.has(r.groupid)) return false;
      if (q && ![r.groupid, r.brand, r.title].some((f) => !!f && f.toLowerCase().includes(q))) return false;
      return !(r.status && hiddenStatus.has(r.status));
    });
    // Each column compares ascending; the direction flips it. Ties fall back to revenue (biggest first) so equal rows keep a
    // sensible order — e.g. every 4 / 7 style, earners first.
    const spread = (r: SeasonRow) => (r.off_sold ?? r.months_sold);   // Any has no off-season: months sold instead
    const rank = (r: SeasonRow) => (r.status ? STATUS_ORDER.indexOf(r.status) : STATUS_ORDER.length);
    const cmp = (a: SeasonRow, b: SeasonRow): number => {
      switch (sort) {
        case 'style': return a.groupid.localeCompare(b.groupid);
        case 'brand': return (a.brand || '~').localeCompare(b.brand || '~');   // unbranded last
        case 'off': return spread(a) - spread(b);
        case 'revenue': return a.revenue_12m - b.revenue_12m;
        case 'status': return rank(a) - rank(b);
      }
    };
    const sign = dir === 'asc' ? 1 : -1;
    out.sort((a, b) => sign * cmp(a, b) || b.revenue_12m - a.revenue_12m);
    return out;
  }, [inSeason, hiddenStatus, cut, query, sort, dir]);

  // Ticked rows that a filter hides are unticked, so a bulk change can never hit a style that is off screen.
  function toggleStatus(st: string) {
    setHiddenStatus((prev) => {
      const next = new Set(prev);
      if (next.has(st)) next.delete(st); else next.add(st);
      return next;
    });
    setSelected(new Set());
    setCut(new Set());
  }

  // Take styles off the list (and out of the selection).
  function cutRows(ids: string[]) {
    setCut((prev) => new Set([...prev, ...ids]));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function sortBy(key: SortKey) {
    if (key === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else { setSort(key); setDir(FIRST_DIR[key]); }
  }


  // The season the business is in today, for the range panel's "Winter now" line — display only (season is no longer in any status).
  // Month read on London time; month-only, so the DB/box date disagreement doesn't matter here.
  const londonMonth = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', month: 'numeric' }));
  const seasonNow: SeasonName = isSummerIdx(londonMonth - 1) ? 'Summer' : 'Winter';
  const emptyMessage =
    season === CANT_GET
      ? (query.trim() ? `Nothing matches "${query.trim()}" here.` : 'Nothing marked. Styles marked “Can’t get it” show here.')
      : query.trim()
        ? `Nothing matches "${query.trim()}" here.`
        : 'No styles match these filters.';

  const allVisibleTicked = rows.length > 0 && rows.every((r) => selected.has(r.groupid));
  // Ticked AND on screen — what a bulk change will actually hit (a search can hide ticked rows without unticking them).
  const tickedOnScreen = rows.filter((r) => selected.has(r.groupid)).length;

  // RESET — the whole screen back to how it opens (owner, 2026-09-25): Summer tab, every status on, no cuts, nothing
  // ticked, default sort. Always on screen; it is the only way to bring cut rows back.
  function resetScreen() {
    setSeason('Summer');
    setLastSeason('Summer');
    setHiddenStatus(new Set());
    setCut(new Set());
    setQuery('');
    setSelected(new Set());
    setSort('off');
    setDir('desc');
    setMessage(null);
    setError(null);
  }

  // CAN'T GET TOGGLES (owner, 2026-09-26 — "pressing it again should remove the filter"): a second press returns to the season tab
  // you came from, not always Summer — so remember the last season view whenever one is chosen.
  function toggleCantGet() {
    switchSeason(season === CANT_GET ? lastSeason : CANT_GET);
  }

  function switchSeason(s: View) {
    if (s !== CANT_GET) setLastSeason(s);
    setSeason(s);
    setSelected(new Set());
    setCut(new Set());
    setMessage(null);
    setError(null);
  }

  function toggle(groupid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupid)) next.delete(groupid); else next.add(groupid);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allVisibleTicked ? new Set() : new Set(rows.map((r) => r.groupid)));
  }

  async function applySeason(target: SeasonName) {
    // Only ticked rows that are ON SCREEN — a filter may have hidden some since they were ticked.
    const ids = rows.filter((r) => selected.has(r.groupid)).map((r) => r.groupid);
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await setProductSeasons(ids, target);
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.error || 'Could not change the season');
      return;
    }
    const n = res.data.changed.length;
    setMessage(`Moved ${n} style${n === 1 ? '' : 's'} to ${target}.`);
    setSelected(new Set());
    await refresh();
  }

  // CAN'T GET IT, in bulk — mark the ticked styles for three months, or release them (bcweb-server/utils/noSupply.js). Separate from the
  // season setter on purpose: it changes nothing about the season or the status.
  async function applyNoSupply(action: 'park' | 'clear') {
    const ids = rows.filter((r) => selected.has(r.groupid)).map((r) => r.groupid);
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    if (action === 'park') {
      const res = await setNoSupply(ids);
      setBusy(false);
      if (!res.success || !res.data) { setError(res.error || 'Could not mark them'); return; }
      const n = res.data.updated.length;
      setMessage(`Can't get: ${n} style${n === 1 ? '' : 's'} hidden from ordering until ${dayMonth(res.data.until)}.`);
    } else {
      const res = await clearNoSupply(ids);
      setBusy(false);
      if (!res.success || !res.data) { setError(res.error || 'Could not clear them'); return; }
      const n = res.data.cleared.length;
      setMessage(n > 0 ? `Released ${n} style${n === 1 ? '' : 's'}.` : 'None of those was marked.');
    }
    setSelected(new Set());
    await refresh();
  }

  return (
    <AppShell>
      {data && (
        <RangePanel
          rows={allRows}
          open={rangeOpen}
          onToggle={toggleRange}
          info={
            // Which season the business is in today — the one the status rules test against (owner, 2026-09-25) — then the sales
            // window and the last change, all on one line.
            <>
              <span className="font-medium text-slate-600">{seasonNow} now</span>
              {seasonNow === 'Summer' ? ' · Apr–Aug' : ' · Sep–Mar'}
              {data.window && <> · Sales {monthLabel(data.window.from)} – {monthLabel(data.window.to)}</>}
              {data.last_change && <> · Last season change {dayLabel(data.last_change.at)} · {data.last_change.who}</>}
            </>
          }
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* SEASON — what the style is set to now. No counts on the switch (owner's rule for toggles); the line below says it. */}
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
          {SEASONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => switchSeason(s)}
              className={'px-3 py-1.5 text-sm font-medium ' + (season === s ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
            >
              {s}
            </button>
          ))}
        </div>

        {/* CAN'T GET — a view of its own, drawn APART from the season switch (not a fourth segment): it's a different fact, and one
            control that mixed "when it sells" with "can I buy it" is exactly what this screen must not become. */}
        <button
          type="button"
          onClick={toggleCantGet}
          aria-pressed={season === CANT_GET}
          title={season === CANT_GET
            ? `Back to ${lastSeason}`
            : 'Every style marked “Can’t get it” — hidden from ordering for three months, or back with its note — whatever its season'}
          className={
            'rounded-md border px-3 py-1.5 text-sm font-medium '
            + (season === CANT_GET ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
          }
        >
          Can&rsquo;t get
        </button>

        {/* STATUS — each one switches on/off. No counts on the chips (owner's rule for toggles). */}
        <div className="inline-flex gap-1" role="group" aria-label="Status">
          {STATUS_ORDER.map((st) => {
            const on = !hiddenStatus.has(st);
            return (
              <button
                key={st}
                type="button"
                onClick={() => toggleStatus(st)}
                aria-pressed={on}
                className={
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition ' +
                  (on ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-slate-200 bg-white text-slate-400 line-through hover:text-slate-500')
                }
              >
                {st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder="Search"
            aria-label="Search styles"
            className="w-48 rounded-md border border-slate-300 bg-white py-1 pl-2.5 pr-7 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-1 text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={resetScreen}
          title="Start the screen again — Summer, all statuses, no search, nothing cut"
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Reset
        </button>

      </div>


      {loadError && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}

      {/* BULK BAR — ALWAYS ON SCREEN (owner, 2026-09-25): a bar that appeared on the first tick pushed the table down under the
          click. Fixed height; only its contents change. All three seasons are shown, the tab's own one marked as where these styles
          are now (and not clickable — it would be a no-op). Messages and errors live in the bar for the same no-jump reason. */}
      <div className="sticky top-0 z-10 mb-3 flex min-h-[46px] flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
        {/* The list's count lives here, not on the Summer | Winter | Any switch (owner's no-counts-on-toggles rule). It follows every
            filter, so it is always the length of the table below. Fixed width so the bar doesn't shift as the numbers change. */}
        <span className="w-36 text-sm text-slate-400 tabular-nums">
          <span className={tickedOnScreen > 0 ? 'font-medium text-slate-700' : ''}>{tickedOnScreen}</span> of{' '}
          <span className="font-medium text-slate-700">{rows.length}</span> selected
        </span>
        <span className="text-sm text-slate-500">Set season:</span>
        <div className="inline-flex gap-2">
          {SEASONS.map((s) => {
            const current = s === season;
            return (
              <button
                key={s}
                type="button"
                disabled={current || busy || tickedOnScreen === 0}
                onClick={() => applySeason(s)}
                title={current ? `These styles are ${s} now` : undefined}
                className={
                  'rounded-md border px-3 py-1 text-sm font-medium ' +
                  (current
                    ? 'cursor-default border-slate-300 bg-slate-100 text-slate-500'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40')
                }
              >
                {s}{current && <span className="ml-1 text-xs font-normal">· now</span>}
              </button>
            );
          })}
        </div>
        {/* CAN'T GET — its own group, after a divider: marks or releases the ticked styles, changes nothing about their season. It
            reads "Can't get: 3 months | Release". */}
        <span className="h-5 w-px bg-slate-200" aria-hidden />
        <span className="text-sm text-slate-500">Can&rsquo;t get:</span>
        <div className="inline-flex gap-2">
          <button
            type="button"
            disabled={busy || tickedOnScreen === 0}
            onClick={() => applyNoSupply('park')}
            title="Mark the ticked styles “Can’t get it” — hidden from ordering for three months, season and status unchanged"
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
          >
            3 months
          </button>
          <button
            type="button"
            disabled={busy || tickedOnScreen === 0}
            onClick={() => applyNoSupply('clear')}
            title="Take “Can’t get it” off the ticked styles — they're back for ordering straight away"
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
          >
            {/* RELEASE (owner, 2026-09-26): not "Clear" — the bar already has a Clear, which empties the ticks — and not "Unpark" —
                "parked" means a pricing review date on Repricing. */}
            Release
          </button>
        </div>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          className={'text-sm text-slate-400 hover:text-slate-600 ' + (selected.size > 0 ? '' : 'invisible')}
        >
          Clear
        </button>
        {error ? <span className="text-sm text-red-600">{error}</span> : message && <span className="text-sm text-slate-600">{message}</span>}
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          {emptyMessage}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          {/* FIXED COLUMN WIDTHS (owner, 2026-09-25): with auto layout a longer code scrolling into view widened Style and shifted
              every column. Style fits the longest code today (21 chars, e.g. FLE030-IVES-NAVY-BLUE) with room to spare; anything
              longer truncates, full title still on hover. Status takes whatever is left.
              The two number columns are sized to what they hold (owner, 2026-09-26 — "12 months is using unnecessary space to its
              left"): Off-season fits its header with the sort arrow, 12 months fits "£10,000" — the freed width goes to Status. */}
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-10" />
              <col className="w-60" />
              <col className="w-32" />
              <col className="w-[252px]" />
              <col className="w-28" />
              <col className="w-24" />
              <col />
              <col className="w-10" />
            </colgroup>
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" checked={allVisibleTicked} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300" />
                </th>
                <th className="px-3 py-2 font-medium"><SortHeader k="style" label="Style" sort={sort} dir={dir} onSort={sortBy} /></th>
                <th className="px-3 py-2 font-medium"><SortHeader k="brand" label="Brand" sort={sort} dir={dir} onSort={sortBy} /></th>
                <th className="px-3 py-2 font-medium">
                  <div className="flex gap-0.5">
                    {MONTH_LETTERS.map((l, i) => <span key={i} className="w-4 text-center">{l}</span>)}
                  </div>
                </th>
                <th className="px-3 py-2 text-center font-medium">
                  {/* Mixed seasons on the Can't get view: each row still shows its own measure (off-season x / 5 or 7, or months x / 12). */}
                  <SortHeader k="off" label={season === 'Any' ? 'Months sold' : season === CANT_GET ? 'Months' : 'Off-season'} sort={sort} dir={dir} onSort={sortBy} />
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  <SortHeader k="revenue" label="12 months" right sort={sort} dir={dir} onSort={sortBy} />
                </th>
                <th className="px-3 py-2 font-medium"><SortHeader k="status" label="Status" sort={sort} dir={dir} onSort={sortBy} /></th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr
                  key={r.groupid}
                  onClick={() => toggle(r.groupid)}
                  className={'cursor-pointer ' + (selected.has(r.groupid) ? 'bg-slate-50' : 'hover:bg-slate-50/60')}
                >
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(r.groupid)}
                      onChange={() => toggle(r.groupid)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    {/* The code, full title on hover (owner, 2026-09-25) — the long Shopify titles made rows wide for little gain. */}
                    {/* The no-supply mark sits HERE, beside the code — not in Status. Status is the table's leftover column (a few dozen
                        pixels); a mark squeezed in there truncated the status itself to "Ste…" and hid the mark (owner, 2026-09-26). The
                        pill never shrinks; a long code truncates instead, full title still on hover. Side by side with the season, never
                        merged into it: amber while marked, slate once lapsed (back for ordering, with its note). On the Can't get view
                        every row is marked, so the pill shows the date itself rather than repeating "Can't get". */}
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-slate-800" title={r.title || r.groupid}>{r.groupid}</span>
                      {r.no_supply ? (
                        <span
                          className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1 text-[11px] leading-4 text-amber-800"
                          title={`Can’t get it until ${dayMonth(r.no_supply_until)} — marked ${dayMonth(r.no_supply_since)}${r.no_supply_by ? ` by ${r.no_supply_by}` : ''} · ${r.season}`}
                        >
                          {season === CANT_GET ? `until ${dayMonth(r.no_supply_until)}` : 'Can’t get'}
                        </span>
                      ) : r.no_supply_since ? (
                        <span
                          className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1 text-[11px] leading-4 text-slate-600"
                          title={`Couldn’t get it — ${dayMonth(r.no_supply_since)}. Its three months are up, so it's back for ordering with its note · ${r.season}`}
                        >
                          Couldn&rsquo;t get
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="truncate px-3 py-1.5 text-slate-600">{r.brand || '—'}</td>
                  <td className="px-3 py-1.5"><MonthStrip row={r} /></td>
                  {/* Centred in a narrow column so it sits with its neighbours (owner, 2026-09-25: a wide left-aligned column left a
                      gap). On Any, "Summer only" / "Winter only" is a hover, not text — it needed the width that caused the gap. */}
                  <td
                    className="px-3 py-1.5 text-center tabular-nums text-slate-600"
                    title={r.suggested_season && r.off_total === null ? `${r.suggested_season} only` : undefined}
                  >
                    {r.off_total !== null ? <>{r.off_sold} / {r.off_total}</> : <>{r.months_sold} / 12</>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{money(r.revenue_12m)}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">
                    {r.status ? r.status.charAt(0) + r.status.slice(1).toLowerCase() : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); cutRows([r.groupid]); }}
                      title="Cut — take off this list"
                      aria-label={`Cut ${r.groupid}`}
                      className="rounded px-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
