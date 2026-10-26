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

BY SIZE, GROUPED BY STYLE, NO CHART (owner, 2026-10-26: "simplify the table and do it by size not just style. get rid of the chart
         at the top", then "sort out the ui"). The rows are SIZES from the SAME data as the Today screen's New card (GET
         /process-overview — utils/processMap.js → NEW_SIZES_SQL: every size of every style created in the last 90 days, never-stocked
         sizes left out), so the two screens count alike. They are shown UNDER THEIR STYLE: a style heading row (group id, brand, added
         date, title, and the style's totals) and one compact line per size (just the size — the code is in its tooltip). Printing the
         code and title on every size repeated one style six times over, which is what made it unreadable.
         Columns (owner, 2026-10-26): Sold AMZ · Sold SHP (net of returns — no Shop column, "rare so dont care", and no Total) ·
         Stock local · Stock AMZ (Amazon-bound local units count as AMZ, as on Today) · Profit (£ on its sales, every channel). Zeros
         are a faint dot. The table is FULL WIDTH (owner, 2026-10-26, after trying it narrow) — the style column takes the spare room, the number columns
         are fixed — with a sticky header; a strip of totals sits above it.
         Sorting orders the STYLES (by their totals); sizes stay in size order under each. Opens newest added first; the 20+ days
         filter stays. The production-pace chart (AdditionsTrend) is HIDDEN, not deleted — flip SHOW_TREND. GET
         /analytics-new-additions (the old by-style list) is no longer read by this screen.

Guarded by AppShell. Consumes GET /process-overview (the list, as on Today) and GET /analytics-new-additions-trend (the pace
         figures in the hero; the chart, when shown, reads the same request).
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AdditionsTrend from '@/components/AdditionsTrend';
import ProductNavCards from '@/components/ProductNavCards';
import { useApiQuery } from '@/lib/useApiQuery';
import { getProcessOverview, getNewAdditionsTrend, type ProcessSizeRow } from '@/lib/api';
import { CHANNELS, unitsSold } from '@/lib/process';

// The production-pace chart below the hero — hidden 2026-10-26 (owner: "get rid of the chart at the top"). true brings it back.
const SHOW_TREND = false;

// Fixed 90-day window, no lens toggle (owner, 2026-09-26 — was 30 since 2026-07-27). 90 days is the owner's rule for a new line:
// "that's when I want each to sell at least once", so the list has to hold a line for its whole trial, not drop it at day 30 while
// it is still being judged. The hero count follows the window (owner chose that over keeping a 30-day hero). ~3x the rows of the
// old window — a few hundred at most, loaded in one request; the owner is happy to wait for it.
const DAYS = 90;
// "Settled in" threshold for the table filter: 20 days (owner, 2026-09-26 — was 14) — "that's when I'd expect something to happen
// and act on it if not". Ticked, the list is the lines past that point, i.e. the ones to judge.
const MATURE_DAYS = 20;

// Stable identities for "nothing loaded yet". A fresh [] each render would change the identity of everything derived from it
// (the sortedRows useMemo below), defeating the memo.
type SortKey = 'added' | 'code' | 'AMZ' | 'SHP' | 'local' | 'fba' | 'profit';

const NO_ROWS: ProcessSizeRow[] = [];
// The Sold columns, one per channel (net of returns), each sortable. No Shop (CM3) column — rare, owner 2026-10-26: "dont care" —
// and no Total (owner: "just have shp or amz").
const SOLD_COLS = [
  { id: 'AMZ', label: 'AMZ' },
  { id: 'SHP', label: 'SHP' },
] as const;
// £ earned on the size's sales, every channel added together (the positive rows — returns are not netted off, as on Today).
const profitOf = (r: ProcessSizeRow) => CHANNELS.reduce((n, c) => n + (r.channels[c.id].profit || 0), 0);

// Table cell classes: number columns are a fixed width so the columns line up down the grouped rows. The COUNTS (sold, stock) are
// CENTRED under their heading — right-aligned, a one-digit count sat at the far edge with a gap in front of it (owner, 2026-10-26);
// Profit, a £ amount, stays right-aligned so the pence line up.
const TH = 'w-24 whitespace-nowrap px-3 py-2.5 text-center font-medium';
const TD = 'px-3 py-2 text-center tabular-nums';
const TD_SIZE = 'px-3 py-1 text-center tabular-nums';
const TH_GBP = 'w-28 whitespace-nowrap py-2.5 pl-3 pr-4 text-right font-medium';
const TD_GBP = 'py-2 pl-3 pr-4 text-right tabular-nums';
const TD_GBP_SIZE = 'py-1 pl-3 pr-4 text-right tabular-nums';

// A style and its sizes, with the style's totals (what its heading row shows and what sorting orders by).
interface StyleGroup {
  groupid: string; title: string | null; brand: string | null; created: string; sizes: ProcessSizeRow[];
  amz: number; shp: number; local: number; fba: number; profit: number; sold: number;
}
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
    return v === 'AMZ' || v === 'SHP' || v === 'code' || v === 'local' || v === 'fba' || v === 'profit' ? v : 'added';
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

  // "Now" is captured HERE, inside the fetcher, not during render. Date.now() is impure, so reading it while rendering makes the
  // output depend on when React happens to re-render (react-hooks/purity). Capturing it alongside the rows also reads better: the
  // ages shown are "as at the time we loaded the list", which is what the numbers next to each row actually mean.
  // The Today screen's data (GET /process-overview), under this screen's own key because loadedAt rides with it.
  const { data, error: loadError, busy: loading } = useApiQuery(
    ['new-additions-sizes'],
    async () => {
      const res = await getProcessOverview();
      if (res.success && res.data) {
        return { success: true, data: { rows: res.data.rows, styles: res.data.styles, loadedAt: Date.now() }, return_code: 'SUCCESS' };
      }
      return { success: false, error: res.error || 'Failed to load New Additions', return_code: res.return_code };
    },
  );
  // THE PACE FIGURES beside the hero. Same SWR key as <AdditionsTrend> below, so this is the SAME request — SWR dedupes and the
  // chart and these tiles can never show different numbers. Read from the trend route, NOT from `rows`: rows are survivors out of
  // skusummary, while pace comes from product_event_log and therefore matches the Winners screen's "added" tile exactly.
  const { data: trend } = useApiQuery(['new-additions-trend'], () => getNewAdditionsTrend());
  const pace = trend?.pace ?? null;

  const rows: ProcessSizeRow[] = data?.rows ?? NO_ROWS;
  const loadedAt = data?.loadedAt ?? null;
  const error = loadError?.message ?? null;

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

  // GROUP the (filtered) sizes under their style, keeping the server's order — newest created first, sizes in size order — then sort
  // the STYLES by the active column's style total. Client-side on the already-loaded rows; ties fall back to newest-added.
  const sortedGroups = useMemo(() => {
    const groups: StyleGroup[] = [];
    const byId = new Map<string, StyleGroup>();
    for (const r of visibleRows) {
      let g = byId.get(r.groupid);
      if (!g) {
        g = { groupid: r.groupid, title: r.title, brand: r.brand, created: r.created, sizes: [], amz: 0, shp: 0, local: 0, fba: 0, profit: 0, sold: 0 };
        byId.set(r.groupid, g);
        groups.push(g);
      }
      g.sizes.push(r);
      g.amz += Math.max(r.channels.AMZ.net, 0);
      g.shp += Math.max(r.channels.SHP.net, 0);
      g.local += r.localStock;
      g.fba += r.fbaStock;
      g.profit += profitOf(r);
      g.sold += unitsSold(r);
    }
    const val: Record<SortKey, (g: StyleGroup) => number | string> = {
      added: (g) => g.created || '', code: (g) => g.groupid, AMZ: (g) => g.amz, SHP: (g) => g.shp,
      local: (g) => g.local, fba: (g) => g.fba, profit: (g) => g.profit,
    };
    const cmp = (a: StyleGroup, b: StyleGroup) => {
      const x = val[sortBy](a), y = val[sortBy](b);
      let c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (c === 0 && sortBy !== 'added') c = (a.created || '').localeCompare(b.created || '');
      return sortDir === 'asc' ? c : -c;
    };
    return groups.sort(cmp);
  }, [visibleRows, sortBy, sortDir]);

  // ROW SELECTION (owner, 2026-09-26): click a style (its heading or any of its sizes) to highlight it, click again to clear it. It
  // just marks your place while you read down the list, keyed by groupid so a re-sort keeps it, and it enables the hand-off cards
  // above the table for that style (state: `selected`, above).
  const selectedGroupid = selected;

  // Click a sortable header: same column flips direction; a new column switches to it, defaulting to descending (most / newest first)
  // — Code starts A→Z.
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setView({ dir: sortDir === 'asc' ? 'desc' : 'asc' });
    else setView({ sort: key, dir: key === 'code' ? 'asc' : 'desc' });
  };
  const caret = (key: SortKey) =>
    sortBy === key ? <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;
  const sortBtn = (key: SortKey, label: string, title: string, align: 'left' | 'right' = 'right') => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      title={title}
      className={'inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-800 ' +
        (align === 'right' ? 'flex-row-reverse ' : '') + (sortBy === key ? 'text-slate-900' : '')}
    >
      {label} {caret(key)}
    </button>
  );

  // The totals strip — the whole window (not the filtered view), so it stays a fixed picture.
  const totals = useMemo(() => {
    const t = { sizes: rows.length, soldSizes: 0, units: 0, profit: 0, local: 0, fba: 0, byChannel: { AMZ: 0, SHP: 0 } };
    for (const r of rows) {
      const u = unitsSold(r);
      if (u > 0) t.soldSizes += 1;
      t.units += u;
      t.profit += profitOf(r);
      t.local += r.localStock;
      t.fba += r.fbaStock;
      for (const c of SOLD_COLS) t.byChannel[c.id] += Math.max(r.channels[c.id].net, 0);
    }
    return t;
  }, [rows]);

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
          {/* TOTALS STRIP — what the table below adds up to (always the full window, whatever the filter), then the adding pace. */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Tile label="New styles" value={String(data?.styles ?? 0)} sub={`last ${DAYS} days`} accent />
            <Tile label="Sizes" value={String(totals.sizes)} sub={`${totals.soldSizes} sold`} />
            <Tile label="Units sold" value={String(totals.units)} sub={`AMZ ${totals.byChannel.AMZ} · SHP ${totals.byChannel.SHP}`} />
            <Tile label="Profit" value={gbp(totals.profit)} sub="on those sales" />
            <Tile label="Stock" value={String(totals.local + totals.fba)} sub={`Local ${totals.local} · AMZ ${totals.fba}`} />
            <Tile
              label="This month"
              value={pace ? String(pace.thisMonth) : '—'}
              sub={pace ? `styles added · avg ${pace.monthlyAvg12}` : undefined}
            />
            {/* SINCE LAST ONE is the push — the only figure here that gets worse on its own, every quiet day (owner, 2026-09-22). */}
            <Tile
              label="Since last one"
              value={pace?.daysSinceLast === null || pace === null ? '—' : dayGap(pace.daysSinceLast)}
              sub={pace?.lastAdded ? `added ${shortDate(pace.lastAdded)}` : 'nothing added yet'}
            />
          </div>

          {SHOW_TREND && <AdditionsTrend />}

          {/* Hand-off row — the same product menu as Inventory, greyed until a row is selected, plus Product (the style's own page).
              Every card carries this exact view as ?from=. */}
          {rows.length > 0 && (
            <div className="mb-3">
              <ProductNavCards groupid={selectedGroupid} from={selfUrl} showProduct />
            </div>
          )}

          {visibleRows.length === 0 ? (
            <p className="text-sm text-slate-400">
              {matureOnly && rows.length > 0
                ? `Every size added in the last ${DAYS} days is under ${MATURE_DAYS} days live — untick the filter to see them.`
                : `No styles were added in the last ${DAYS} days.`}
            </p>
          ) : (
            // overflow-clip, not overflow-auto/hidden: it keeps the rounded corners without making a scroll box, which would trap the
            // sticky header inside it (owner, 2026-10-26: "make the header sticky"). Full width (owner, 2026-10-26).
            <div className="overflow-clip rounded-xl border border-slate-200 bg-white shadow-sm">
              {/* Table bar: the count on the left, the filter on the right — it changes the list and nothing above it. */}
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-2.5 text-sm">
                <span className="text-slate-500">
                  {matureOnly
                    ? <><strong className="font-semibold text-slate-800">{sortedGroups.length}</strong> styles · {visibleRows.length} of {rows.length} sizes</>
                    : <><strong className="font-semibold text-slate-800">{sortedGroups.length}</strong> styles · {rows.length} sizes</>}
                </span>
                <label className="flex cursor-pointer select-none items-center gap-2 text-slate-600"
                       title={`Hide sizes of styles added less than ${MATURE_DAYS} days ago — too new to judge.`}>
                  <input
                    type="checkbox"
                    checked={matureOnly}
                    // Changing the lens CLEARS the cursor (owner, 2026-07-28): the list you get back is a different list.
                    onChange={(e) => setView({ sel: null, mature: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                  />
                  {MATURE_DAYS}+ days live only
                  {matureOnly && hiddenCount > 0 && <span className="text-xs text-slate-400">({hiddenCount} too new)</span>}
                </label>
              </div>
              <table className="w-full text-sm">
                {/* STICKY HEADER — stays at the top of the window while the list scrolls. The shadow is the bottom rule (a
                    collapsed-table border doesn't travel with a sticky row). */}
                <thead className="sticky top-0 z-10 bg-white text-[11px] uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">{sortBtn('code', 'Style · size', 'Sort styles by group id', 'left')}</th>
                    <th className={TH + ' border-l border-slate-200'}>{sortBtn('AMZ', 'Sold AMZ', 'Sort by units sold on Amazon since the style was added, net of returns', 'left')}</th>
                    <th className={TH}>{sortBtn('SHP', 'Sold SHP', 'Sort by units sold on Shopify since the style was added, net of returns', 'left')}</th>
                    <th className={TH + ' border-l border-slate-200'}>{sortBtn('local', 'Stock local', 'Sort by local stock — on our shelves, not bound for Amazon', 'left')}</th>
                    <th className={TH}>{sortBtn('fba', 'Stock AMZ', 'Sort by Amazon stock — live at FBA, plus local units already on their way (due for Pick / on C3-Amazon)', 'left')}</th>
                    <th className={TH_GBP + ' border-l border-slate-200'}>{sortBtn('profit', 'Profit', "Sort by profit — £ earned on the sales, every channel")}</th>
                  </tr>
                </thead>
                {sortedGroups.map((g, gi) => {
                  const isSel = selected === g.groupid;
                  const pick = () => setView({ sel: isSel ? null : g.groupid });
                  return (
                    // One <tbody> per style, so the style and its sizes highlight together.
                    <tbody key={g.groupid} className={(gi ? 'border-t-8 border-slate-100 ' : '') + (isSel ? 'bg-brand-50' : '')}>
                      {/* The STYLE heading — group id, brand, added date, title, and the style's totals. */}
                      <tr onClick={pick} className={'cursor-pointer ' + (isSel ? '' : 'bg-slate-50/80 hover:bg-slate-100/70')}>
                        <td className="max-w-0 py-2 pl-4 pr-3">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-[13px] font-semibold tracking-tight text-slate-900">{g.groupid}</span>
                            <span className="whitespace-nowrap text-xs text-slate-400">{g.brand ? `${g.brand} · ` : ''}added {shortDate(g.created)}</span>
                          </div>
                          <div className="truncate text-xs text-slate-500" title={g.title || undefined}>{g.title || 'Untitled'}</div>
                        </td>
                        <td className={TD + ' border-l border-slate-200'}><Num n={g.amz} strong /></td>
                        <td className={TD}><Num n={g.shp} strong /></td>
                        <td className={TD + ' border-l border-slate-200'}><Num n={g.local} strong /></td>
                        <td className={TD}><Num n={g.fba} strong /></td>
                        <td className={TD_GBP + ' border-l border-slate-200 ' + (g.sold === 0 ? 'text-slate-300' : g.profit < 0 ? 'font-semibold text-rose-600' : 'font-semibold text-slate-900')}>
                          {g.sold === 0 ? '·' : gbp(g.profit)}
                        </td>
                      </tr>
                      {/* One compact line per SIZE — the size only; the full code is in its tooltip. */}
                      {g.sizes.map((r) => {
                        const sold = unitsSold(r);
                        const profit = profitOf(r);
                        return (
                          <tr key={r.code} onClick={pick} className={'cursor-pointer border-t border-slate-100 ' + (isSel ? '' : 'hover:bg-slate-50')}>
                            <td className="py-1 pl-4 pr-3" title={r.code}>
                              <span className="inline-block min-w-[2.75rem] rounded bg-slate-100 px-2 py-0.5 text-center font-mono text-xs font-medium text-slate-700">{r.size}</span>
                            </td>
                            <td className={TD_SIZE + ' border-l border-slate-200'}><Num n={Math.max(r.channels.AMZ.net, 0)} /></td>
                            <td className={TD_SIZE}><Num n={Math.max(r.channels.SHP.net, 0)} /></td>
                            <td className={TD_SIZE + ' border-l border-slate-200'}><Num n={r.localStock} /></td>
                            <td className={TD_SIZE}><Num n={r.fbaStock} /></td>
                            <td className={TD_GBP_SIZE + ' border-l border-slate-200 text-xs ' + (sold === 0 ? 'text-slate-300' : profit < 0 ? 'text-rose-600' : 'text-slate-700')}>
                              {sold === 0 ? '·' : gbp(profit)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  );
                })}
              </table>
            </div>
          )}
        </>
      )}

    </AppShell>
  );
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

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={'mt-0.5 text-2xl font-semibold tabular-nums ' + (accent ? 'text-brand-600' : 'text-slate-900')}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-slate-400" title={sub}>{sub}</div>}
    </div>
  );
}

// A count cell: zero is a faint dot, so the numbers that matter stand out down a long column.
function Num({ n, strong }: { n: number; strong?: boolean }) {
  if (!n) return <span className="text-slate-300">·</span>;
  return <span className={'tabular-nums ' + (strong ? 'font-semibold text-slate-900' : 'text-slate-700')}>{n}</span>;
}

function gbp(v: number) {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
