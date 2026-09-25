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

         LOGIC SUGGESTS, THE OWNER DECIDES. "Suggested" (on by default) keeps the list short: a Summer/Winter style that sold in at
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

type SortKey = 'off' | 'revenue';

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

export default function SeasonsPage() {
  const [season, setSeason] = useState<SeasonName>('Summer');
  const [suggestedOnly, setSuggestedOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('off');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set after a season change and cleared by a re-tag: the statuses on Repricing are now behind the seasons.
  const [retagDue, setRetagDue] = useState(false);

  const { data, error: loadError, isLoading, refresh } = useApiQuery(['product-seasons'], () => getProductSeasons());
  const allRows = useMemo(() => data?.rows ?? [], [data]);

  const inSeason = useMemo(() => allRows.filter((r) => r.season === season), [allRows, season]);
  const suggestedCount = inSeason.filter((r) => r.suggested).length;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = inSeason.filter((r) => {
      if (suggestedOnly && !r.suggested) return false;
      if (!term) return true;
      return r.groupid.toLowerCase().includes(term) || (r.title || '').toLowerCase().includes(term) || (r.brand || '').toLowerCase().includes(term);
    });
    // Off-season spread first (on Any, months sold), then revenue — so the strongest all-year case sits at the top.
    const spread = (r: SeasonRow) => (r.off_sold ?? r.months_sold);
    out.sort((a, b) => (sort === 'off' ? spread(b) - spread(a) || b.revenue_12m - a.revenue_12m : b.revenue_12m - a.revenue_12m));
    return out;
  }, [inSeason, suggestedOnly, search, sort]);

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
    const ids = [...selected];
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

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={suggestedOnly}
            onChange={(e) => { setSuggestedOnly(e.target.checked); setSelected(new Set()); }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Suggested only
        </label>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name, code or brand"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />

        <div className="ml-auto text-right text-xs text-slate-400">
          {data?.window && <div>Sales {monthLabel(data.window.from)} – {monthLabel(data.window.to)}</div>}
          {data?.last_change && <div>Last season change {dayLabel(data.last_change.at)} · {data.last_change.who}</div>}
        </div>
      </div>

      <p className="mb-3 text-sm text-slate-500">
        {season === 'Any'
          ? <>{inSeason.length} styles set to Any · {suggestedCount} only sell in one season</>
          : <>{inSeason.length} {season} styles · {suggestedCount} sold in at least half their off-season months</>}
      </p>

      {loadError && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* BULK BAR — only once something is ticked, or while a change is waiting on a re-tag. */}
      {(selected.size > 0 || message || retagDue) && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
          {selected.size > 0 ? (
            <>
              <span className="text-sm font-medium text-slate-700">{selected.size} selected</span>
              <span className="text-sm text-slate-500">Set season:</span>
              {SEASONS.filter((s) => s !== season).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => applySeason(s)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
              <button type="button" onClick={() => setSelected(new Set())} className="text-sm text-slate-400 hover:text-slate-600">
                Clear
              </button>
            </>
          ) : (
            message && <span className="text-sm text-slate-600">{message}</span>
          )}
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
      )}

      {isLoading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          {suggestedOnly ? 'Nothing suggested here. Untick "Suggested only" to see every style.' : 'No styles.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" checked={allVisibleTicked} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300" />
                </th>
                <th className="px-3 py-2 font-medium">Style</th>
                <th className="px-3 py-2 font-medium">
                  <div className="flex gap-0.5">
                    {MONTH_LETTERS.map((l, i) => <span key={i} className="w-4 text-center">{l}</span>)}
                  </div>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => setSort('off')} className={sort === 'off' ? 'text-slate-800' : 'hover:text-slate-700'}>
                    {season === 'Any' ? 'Months sold' : 'Off-season'}
                  </button>
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  <button type="button" onClick={() => setSort('revenue')} className={sort === 'revenue' ? 'text-slate-800' : 'hover:text-slate-700'}>
                    12 months
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">Status</th>
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
                    <div className="text-slate-800">{r.title || r.groupid}</div>
                    <div className="text-xs text-slate-400">{r.groupid}</div>
                  </td>
                  <td className="px-3 py-1.5"><MonthStrip row={r} /></td>
                  <td className="px-3 py-1.5 tabular-nums text-slate-600">
                    {r.off_total !== null
                      ? <>{r.off_sold} / {r.off_total}</>
                      : <>{r.months_sold} / 12{r.suggested_season && <span className="ml-2 text-xs text-slate-400">{r.suggested_season} only</span>}</>}
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
