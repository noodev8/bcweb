'use client';
/*
=======================================================================================================================================
Page: /seasons  (Back Office → Seasons)
=======================================================================================================================================
Purpose: Which styles really sell all year? Every style's season (Summer | Winter | Any) beside its year of sales month by month, so
         the owner can glance, filter, and re-season in bulk.

         Why it matters: a style is only a WINNER while it is in season — an out-of-season earner is HARVEST (bcweb-server/utils/
         portfolioStatus.js). A summer style that keeps selling through the winter ("a slow period, not a switch off" — owner,
         2026-09-25) needs season Any, or it leaves WINNERS for half the year.

         ITS OWN BACK OFFICE JOB, NOT PART OF REPRICING (owner, 2026-09-25): done every quarter or so, in a review mindset, maybe
         before a full winners/prices/stock review. So it links nowhere into the pricing flow.

         LOGIC SUGGESTS, THE OWNER DECIDES. "Suggested" (off by default — owner, 2026-09-25) narrows the list to: a Summer/Winter style that sold in at
         least half its OFF-SEASON months, or an Any style whose sales all fall in one season. Counted against the months the off-season
         has (7 winter / 5 summer), not a flat N-of-12 — see routes/product-seasons.js. Turn it off to see every style.

         Setting a season does NOT re-tag the portfolio statuses. After a change the bar offers "Update statuses", so several changes
         cost one re-tag and the WINNERS/HARVEST tiles move when the owner is ready.

         New products aren't this screen's concern — whoever enters them sets their season, and they are in it at the time.

Guarded by AppShell. Consumes GET /product-seasons; writes POST /product-season-bulk and (on request) POST /portfolio-snapshot-update.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getProductSeasons, setProductSeasons, updatePortfolioSnapshot, type SeasonName, type SeasonRow,
} from '@/lib/api';

const SEASONS: SeasonName[] = ['Summer', 'Winter', 'Any'];
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Summer = April–August, the same months as utils/portfolioStatus.js. Index = month - 1.
const isSummerIdx = (i: number) => i >= 3 && i <= 7;

type SortKey = 'style' | 'brand' | 'off' | 'revenue' | 'status';
type SortDir = 'asc' | 'desc';
// First click on a column sorts it the useful way round: names A–Z, everything else biggest / best first. A second click flips it.
const FIRST_DIR: Record<SortKey, SortDir> = { style: 'asc', brand: 'asc', off: 'desc', revenue: 'desc', status: 'asc' };
// Status sorts in rule order (Winners first), not alphabetically; untagged last.
const STATUS_ORDER = ['WINNERS', 'STEADY', 'NEW', 'HARVEST', 'LOSERS'];

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
  const [season, setSeason] = useState<SeasonName>('Summer');
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  // Statuses switched OFF (owner, 2026-09-25: "not really interested in NEW at the moment"). All on by default; an untagged style
  // (none today) always shows.
  const [hiddenStatus, setHiddenStatus] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>('off');
  const [dir, setDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set after a season change and cleared by a re-tag: the statuses on Repricing are now behind the seasons.
  const [retagDue, setRetagDue] = useState(false);

  const { data, error: loadError, isLoading, refresh } = useApiQuery(['product-seasons'], () => getProductSeasons());
  const allRows = useMemo(() => data?.rows ?? [], [data]);

  const inSeason = useMemo(() => allRows.filter((r) => r.season === season), [allRows, season]);

  const rows = useMemo(() => {
    // No search box — removed 2026-09-25 (owner: "not sure I will use it"). Git history has it if wanted.
    const out = inSeason.filter((r) => {
      if (suggestedOnly && !r.suggested) return false;
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
  }, [inSeason, suggestedOnly, hiddenStatus, sort, dir]);

  // Ticked rows that a filter hides are unticked, so a bulk change can never hit a style that is off screen.
  function toggleStatus(st: string) {
    setHiddenStatus((prev) => {
      const next = new Set(prev);
      if (next.has(st)) next.delete(st); else next.add(st);
      return next;
    });
    setSelected(new Set());
  }

  function sortBy(key: SortKey) {
    if (key === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else { setSort(key); setDir(FIRST_DIR[key]); }
  }


  // Why the list is empty, when there's a reason worth saying. The common one: a Summer style can't be a WINNER in winter (and vice
  // versa) — its earners are HARVEST — so Summer + Winners-only is always empty out of season. Month read on London time; month-only,
  // so the DB/box date disagreement doesn't matter here.
  const londonMonth = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', month: 'numeric' }));
  const seasonNow: SeasonName = isSummerIdx(londonMonth - 1) ? 'Summer' : 'Winter';
  const emptyMessage =
    season !== 'Any' && season !== seasonNow && !hiddenStatus.has('WINNERS') && hiddenStatus.has('HARVEST')
      ? `${season} styles can't be Winners in ${seasonNow.toLowerCase()} — their earners are in Harvest.`
      : suggestedOnly
        ? 'Nothing suggested here. Untick "Suggested" to see every style.'
        : 'No styles match these filters.';

  const allVisibleTicked = rows.length > 0 && rows.every((r) => selected.has(r.groupid));

  function switchSeason(s: SeasonName) {
    setSeason(s);
    setSelected(new Set());
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
    if (n > 0) setRetagDue(true);
    setSelected(new Set());
    await refresh();
  }

  async function retag() {
    setBusy(true);
    setError(null);
    const res = await updatePortfolioSnapshot();
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'Could not update the statuses');
      return;
    }
    setRetagDue(false);
    setMessage('Statuses updated — Repricing now reflects the new seasons.');
    await refresh();
  }

  return (
    <AppShell>
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

        {/* The rule is a hover, not a line — a line that appears on tick would shift the table (owner, 2026-09-25). */}
        <label
          className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600"
          title={season === 'Any' ? 'Suggested: all sales in one season' : 'Suggested: sold in at least half their off-season months'}
        >
          <input
            type="checkbox"
            checked={suggestedOnly}
            onChange={(e) => { setSuggestedOnly(e.target.checked); setSelected(new Set()); }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Suggested
        </label>

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

        <div className="ml-auto text-right text-xs text-slate-400">
          {/* Which season the business is in today — the one the status rules test against (owner, 2026-09-25). */}
          <div>
            <span className="font-medium text-slate-600">{seasonNow} now</span>
            {seasonNow === 'Summer' ? ' · Apr–Aug' : ' · Sep–Mar'}
          </div>
          {data?.window && <div>Sales {monthLabel(data.window.from)} – {monthLabel(data.window.to)}</div>}
          {data?.last_change && <div>Last season change {dayLabel(data.last_change.at)} · {data.last_change.who}</div>}
        </div>
      </div>


      {loadError && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}

      {/* BULK BAR — ALWAYS ON SCREEN (owner, 2026-09-25): a bar that appeared on the first tick pushed the table down under the
          click. Fixed height; only its contents change. All three seasons are shown, the tab's own one marked as where these styles
          are now (and not clickable — it would be a no-op). Messages and errors live in the bar for the same no-jump reason. */}
      <div className="sticky top-0 z-10 mb-3 flex min-h-[46px] flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
        {/* The list's count lives here, not on the Summer | Winter | Any switch (owner's no-counts-on-toggles rule). It follows every
            filter, so it is always the length of the table below. Fixed width so the bar doesn't shift as the numbers change. */}
        <span className="w-36 text-sm text-slate-400 tabular-nums">
          <span className={selected.size > 0 ? 'font-medium text-slate-700' : ''}>{selected.size}</span> of{' '}
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
                disabled={current || busy || selected.size === 0}
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
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          className={'text-sm text-slate-400 hover:text-slate-600 ' + (selected.size > 0 ? '' : 'invisible')}
        >
          Clear
        </button>
        {error ? <span className="text-sm text-red-600">{error}</span> : message && <span className="text-sm text-slate-600">{message}</span>}
        {retagDue && (
          <button
            type="button"
            disabled={busy}
            onClick={retag}
            className="ml-auto rounded-md bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Update statuses
          </button>
        )}
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
              longer truncates, full title still on hover. Status takes whatever is left. */}
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-10" />
              <col className="w-60" />
              <col className="w-32" />
              <col className="w-[252px]" />
              <col className="w-32" />
              <col className="w-28" />
              <col />
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
                  <SortHeader k="off" label={season === 'Any' ? 'Months sold' : 'Off-season'} sort={sort} dir={dir} onSort={sortBy} />
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  <SortHeader k="revenue" label="12 months" right sort={sort} dir={dir} onSort={sortBy} />
                </th>
                <th className="px-3 py-2 font-medium"><SortHeader k="status" label="Status" sort={sort} dir={dir} onSort={sortBy} /></th>
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
                    <div className="truncate text-slate-800" title={r.title || r.groupid}>{r.groupid}</div>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
