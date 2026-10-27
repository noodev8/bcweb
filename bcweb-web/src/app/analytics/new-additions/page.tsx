'use client';
/*
=======================================================================================================================================
Page: /analytics/new-additions  (New Additions — Daily's "New stuff")
=======================================================================================================================================
Purpose: every style created in the last 90 days — "see our new stock and how its doing and what we can action on it without getting
         overwhelmed" (owner, 2026-10-27). Data: GET /process-overview (utils/processMap.js → NEW_SIZES_SQL — every size of every new
         style, never-stocked sizes left out), the same list as Daily's New stuff count, so the two count alike.

THE LAYOUT (owner, 2026-10-27: "way to much going on", then "layout is a bit off especially when dropping down"):
  - One summary line (the whole 90 days, whatever the filters), then ONE control row: All · Not sold · Selling · Not on AMZ (with
    counts) and the Due switch. The tiles, pace figures and production chart (components/AdditionsTrend) were taken off — git history.
  - ONE ROW PER STYLE that tells its story without opening: title, then group id · brand · added date · "Not on Amazon" (no size
    listed — Birkenstock never, it can't go on Amazon), and the SIZE RUN — one tile per size: solid green = sold out, light green =
    has sold and still has stock, white = not sold yet (legend in the control row; numbers in each tile's tooltip). Then Stock here ·
    At Amazon (Amazon-bound local units count as Amazon) · Profit (£ on its sales, every channel) · Review. NO SOLD COLUMNS (owner,
    2026-10-27: the green sizes say it — "you can get rid of the sold colums now"); sold per channel is in the open style. Zeros are a
    faint dot. Sortable headers order the styles.
  - CLICK A STYLE TO ACT ON IT (one open at a time, in the URL as ?sel= so a link's "← Back" returns with it open): one block under
    the product name with ONE label column down the left — the sizes sideways (Sold on Amazon / Sold on Shopify / Stock here / At
    Amazon / Listed, sizes across under their tiles), then Review, then Go to (components/ProductNavCards compact). Full cards, a
    card-in-a-row and side-by-side halves were tried and dropped.

REVIEW AND DUE, LIKE PRICES (owner, 2026-10-27). Per STYLE, skusummary.next_new_review (POST /new-additions-review). A never-reviewed
         style falls due 20 days after it was added (the old "20+ days live" filter); otherwise its review date decides — `due` is
         computed server-side (utils/processMap.js) and Daily reads the same flag. The Due switch (on by default) shows only styles due.
         Review column: Due, a reviewed style's date (amber), or a too-new style's first due date (grey).

VIEW STATE LIVES IN THE URL (owner, 2026-09-26): ?sort= ?dir= ?due= ?show= ?sel=, read once into state and written back with
         router.replace from the handlers (never an effect). The back arrow reads ?from= / ?back=.
=======================================================================================================================================
*/

import { Fragment, Suspense, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import AppShell from '@/components/AppShell';
import ProductNavCards from '@/components/ProductNavCards';
import ReviewPicker from '@/components/ReviewPicker';
import { DueSwitch, fmtReviewDate } from '@/components/ListViewControls';
import { useApiQuery } from '@/lib/useApiQuery';
import { getProcessOverview, markNewAdditionsReview, type ProcessSizeRow } from '@/lib/api';
import { CHANNELS, unitsSold } from '@/lib/process';

// Fixed 90-day window (owner, 2026-09-26: "that's when I want each to sell at least once") — server-side, NEW_DAYS.
const DAYS = 90;

type SortKey = 'added' | 'code' | 'local' | 'fba' | 'profit';
// The quick filters: what kind of new line to look at.
type Show = 'all' | 'unsold' | 'selling' | 'noamz';
const SHOWS: { id: Show; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every new style' },
  { id: 'unsold', label: 'Not sold', hint: 'Not one unit sold on any channel since it was added (net of returns)' },
  { id: 'selling', label: 'Selling', hint: 'Sold at least one unit since it was added' },
  { id: 'noamz', label: 'Not on Amazon', hint: 'No size listed on Amazon (Birkenstock left out — it cannot go on Amazon)' },
];
const isBirk = (brand: string | null) => !!brand && brand.trim().toLowerCase().startsWith('birk');

// Stable identity for "nothing loaded yet" — a fresh [] each render would defeat the memos below.
const NO_ROWS: ProcessSizeRow[] = [];
// £ earned on the size's sales, every channel added together (the positive rows — returns are not netted off).
const profitOf = (r: ProcessSizeRow) => CHANNELS.reduce((n, c) => n + (r.channels[c.id].profit || 0), 0);

// Number columns: fixed width, counts centred (owner, 2026-10-26), £ right-aligned so the pence line up.
const TD = 'px-2 py-3 text-center align-top tabular-nums';
const TD_GBP = 'py-3 pl-3 pr-4 text-right align-top tabular-nums';

// A style and its sizes, with the style's totals (what its row shows and what sorting orders by).
interface StyleGroup {
  groupid: string; title: string | null; brand: string | null; created: string; sizes: ProcessSizeRow[];
  local: number; fba: number; profit: number; sold: number;
  reviewOn: string | null; dueOn: string; due: boolean;   // the style's review (the same on each of its sizes)
  listed: number;                                         // sizes with an Amazon listing
}
// Which styles each quick filter keeps.
const SHOW_TEST: Record<Show, (g: StyleGroup) => boolean> = {
  all: () => true,
  unsold: (g) => g.sold === 0,
  selling: (g) => g.sold > 0,
  noamz: (g) => g.listed === 0 && !isBirk(g.brand),
};

// The size run's three states — the one visual device on the screen, so it carries the most-asked question: which sizes move.
type SizeState = 'soldout' | 'selling' | 'unsold';
const sizeState = (r: ProcessSizeRow): SizeState =>
  unitsSold(r) === 0 ? 'unsold' : r.localStock + r.fbaStock === 0 ? 'soldout' : 'selling';
const SIZE_TILE: Record<SizeState, string> = {
  soldout: 'bg-emerald-600 text-white',
  selling: 'bg-emerald-100 text-emerald-900',
  unsold: 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300',
};

export default function NewAdditionsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <NewAdditionsPageInner />
    </Suspense>
  );
}

function NewAdditionsPageInner() {
  const searchParams = useSearchParams();
  const backHref = searchParams.get('from') || undefined;
  const backLabel = searchParams.get('back') || 'Back';
  const router = useRouter();
  const pathname = usePathname();

  const [sortBy, setSortBy] = useState<SortKey>(() => {
    const v = searchParams.get('sort');
    return v === 'code' || v === 'local' || v === 'fba' || v === 'profit' ? v : 'added';
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (searchParams.get('dir') === 'asc' ? 'asc' : 'desc'));
  // Due on by default (as on the pricing lists) — ?due=0 is the switch off.
  const [dueOnly, setDueOnly] = useState(() => searchParams.get('due') !== '0');
  const [show, setShow] = useState<Show>(() => {
    const v = searchParams.get('show');
    return v === 'unsold' || v === 'selling' || v === 'noamz' ? v : 'all';
  });
  const [selected, setSelected] = useState<string | null>(() => searchParams.get('sel'));   // the open style
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // The URL for a given view. from/back are carried through untouched so this screen's own back arrow survives the round trip.
  const viewUrl = (v: { sort: SortKey; dir: 'asc' | 'desc'; due: boolean; show: Show; sel: string | null }) => {
    const q = new URLSearchParams();
    const from = searchParams.get('from');
    const back = searchParams.get('back');
    if (from) q.set('from', from);
    if (back) q.set('back', back);
    if (v.sort !== 'added') q.set('sort', v.sort);
    if (v.dir !== 'desc') q.set('dir', v.dir);
    if (!v.due) q.set('due', '0');
    if (v.show !== 'all') q.set('show', v.show);
    if (v.sel) q.set('sel', v.sel);
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const current = { sort: sortBy, dir: sortDir, due: dueOnly, show, sel: selected };
  const selfUrl = viewUrl(current);
  const setView = (patch: Partial<typeof current>) => {
    const next = { ...current, ...patch };
    setSortBy(next.sort); setSortDir(next.dir); setDueOnly(next.due); setShow(next.show); setSelected(next.sel);
    if (patch.sel !== undefined) setMsg(null);
    router.replace(viewUrl(next), { scroll: false });
  };

  // GET /process-overview under Daily's own key, so a review set here refreshes Daily's New stuff count too. isLoading, not busy: the
  // list stays on screen while it refreshes after a review.
  const { data, error: loadError, isLoading: loading, refresh } = useApiQuery('process-overview', () => getProcessOverview());
  const rows: ProcessSizeRow[] = data?.rows ?? NO_ROWS;
  const error = loadError?.message ?? null;

  // GROUP every size under its style, keeping the server's order — newest created first, sizes in size order.
  const allGroups = useMemo(() => {
    const groups: StyleGroup[] = [];
    const byId = new Map<string, StyleGroup>();
    for (const r of rows) {
      let g = byId.get(r.groupid);
      if (!g) {
        g = {
          groupid: r.groupid, title: r.title, brand: r.brand, created: r.created, sizes: [], local: 0, fba: 0, profit: 0, sold: 0,
          reviewOn: r.reviewOn, dueOn: r.dueOn, due: r.due, listed: 0,
        };
        byId.set(r.groupid, g);
        groups.push(g);
      }
      g.sizes.push(r);
      g.local += r.localStock;
      g.fba += r.fbaStock;
      g.profit += profitOf(r);
      g.sold += unitsSold(r);
      if (r.onAmz) g.listed += 1;
    }
    return groups;
  }, [rows]);

  // The summary line — the whole window, whatever the filters (owner 2026-07-27: a number that moves when you flip a switch isn't a stat).
  const totals = useMemo(() => {
    const t = { units: 0, profit: 0 };
    for (const r of rows) { t.units += unitsSold(r); t.profit += profitOf(r); }
    return t;
  }, [rows]);

  // Due first, then the quick filter. The filter counts are of the Due view, so each says what its click will show.
  const dueGroups = useMemo(() => (dueOnly ? allGroups.filter((g) => g.due) : allGroups), [allGroups, dueOnly]);
  const showCounts = useMemo(() => {
    const c: Record<Show, number> = { all: 0, unsold: 0, selling: 0, noamz: 0 };
    for (const g of dueGroups) for (const s of SHOWS) if (SHOW_TEST[s.id](g)) c[s.id] += 1;
    return c;
  }, [dueGroups]);

  // Sort the STYLES by the active column's total; ties fall back to newest-added.
  const sortedGroups = useMemo(() => {
    const groups = dueGroups.filter(SHOW_TEST[show]);
    const val: Record<SortKey, (g: StyleGroup) => number | string> = {
      added: (g) => g.created || '', code: (g) => g.groupid,
      local: (g) => g.local, fba: (g) => g.fba, profit: (g) => g.profit,
    };
    const cmp = (a: StyleGroup, b: StyleGroup) => {
      const x = val[sortBy](a), y = val[sortBy](b);
      let c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (c === 0 && sortBy !== 'added') c = (a.created || '').localeCompare(b.created || '');
      return sortDir === 'asc' ? c : -c;
    };
    return groups.sort(cmp);
  }, [dueGroups, show, sortBy, sortDir]);

  // Set the review (days > 0) or clear it (0) on one style — POST /new-additions-review. Returns true when saved (the picker resets).
  async function setReview(groupid: string, days: number): Promise<boolean> {
    setBusy(true); setMsg(null);
    const res = await markNewAdditionsReview([groupid], days);
    setBusy(false);
    if (res.success && res.data) {
      setMsg({
        ok: true,
        text: days === 0
          ? 'Review cleared — due 20 days after it was added.'
          : `Review set for ${res.data.nextReview ? fmtReviewDate(res.data.nextReview) : `${days} days`}.`,
      });
      refresh();
      return true;
    }
    setMsg({ ok: false, text: res.error || 'Could not save the review.' });
    return false;
  }

  // Click a sortable header: same column flips direction; a new one starts descending (Style starts A→Z).
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setView({ dir: sortDir === 'asc' ? 'desc' : 'asc' });
    else setView({ sort: key, dir: key === 'code' ? 'asc' : 'desc' });
  };
  const sortBtn = (key: SortKey, label: string, title: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      title={title}
      className={'inline-flex items-center gap-1 rounded transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ' +
        (sortBy === key ? 'text-slate-900' : '')}
    >
      {label}
      {sortBy === key && <span className="text-[9px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  return (
    <AppShell backHref={backHref} backLabel={backLabel}>
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && (
        <>
          {/* THE SUMMARY — one sentence, the whole 90 days (no page title — owner, 2026-10-26: the back link names the module). */}
          <p className="mb-4 text-sm text-slate-500">
            <strong className="font-semibold text-slate-900">{data?.styles ?? 0} styles</strong> added in the last {DAYS} days have sold{' '}
            <strong className="font-semibold text-slate-900">{totals.units} units</strong> for{' '}
            <strong className="font-semibold text-slate-900">{gbp(totals.profit)}</strong> profit.
          </p>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">No styles were added in the last {DAYS} days.</p>
          ) : (
            <>
              {/* THE CONTROLS — the quick filters and the Due switch (changing either closes the open style — a different list); the
                  size-run legend sits with them, since it explains what the rows below will show. */}
              <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/70 p-0.5">
                  {SHOWS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setView({ sel: null, show: s.id })}
                      title={s.hint}
                      aria-pressed={show === s.id}
                      className={'inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ' +
                        (show === s.id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')}
                    >
                      {s.label}
                      <span className={'tabular-nums text-xs ' + (show === s.id ? 'text-slate-500' : 'text-slate-400')}>{showCounts[s.id]}</span>
                    </button>
                  ))}
                </div>
                <DueSwitch on={dueOnly} onChange={(v) => setView({ sel: null, due: v })} />
                <div className="ml-auto flex items-center gap-4 text-xs text-slate-500" aria-label="Size tiles">
                  <Legend state="soldout" label="Sold out" />
                  <Legend state="selling" label="Selling" />
                  <Legend state="unsold" label="Not sold yet" />
                </div>
              </div>

              {/* overflow-clip keeps the rounded corners without a scroll box, which would trap the sticky header. */}
              <div className="overflow-clip rounded-xl border border-slate-200 bg-white">
                {sortedGroups.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">
                    {dueOnly ? 'Nothing here is due for review. Switch off Due to see the rest.' : 'No styles match this filter.'}
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    {/* Two-level header: Sold and Stock each span their two channels, so the column labels stay one short word. */}
                    <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]">
                      <tr>
                        <th className="py-2.5 pl-4 pr-3 text-left font-medium">{sortBtn('code', 'Style', 'Sort by group id')}</th>
                        <th className="w-24 whitespace-nowrap border-l border-slate-200 px-2 py-2.5 text-center font-medium">{sortBtn('local', 'Stock here', 'Sort by local stock — on our shelves, not bound for Amazon')}</th>
                        <th className="w-28 whitespace-nowrap px-2 py-2.5 text-center font-medium">{sortBtn('fba', 'At Amazon', 'Sort by Amazon stock — at FBA, plus local units on their way')}</th>
                        <th className="w-28 border-l border-slate-200 py-2.5 pl-3 pr-4 text-right font-medium">{sortBtn('profit', 'Profit', '£ earned on the sales, every channel')}</th>
                        <th className="w-24 border-l border-slate-200 py-2.5 pl-3 pr-4 text-left font-medium"
                            title="Due · a reviewed style's next review (amber) · a style not reviewed yet falls due 20 days after it was added (grey)">Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGroups.map((g) => {
                        const isOpen = selected === g.groupid;
                        const toggle = () => setView({ sel: isOpen ? null : g.groupid });
                        return (
                          <Fragment key={g.groupid}>
                            <tr
                              onClick={toggle}
                              className={'cursor-pointer border-t border-slate-100 first:border-t-0 ' + (isOpen ? 'bg-brand-50/60' : 'hover:bg-slate-50')}
                            >
                              <td className="max-w-0 py-3 pl-4 pr-3">
                                <div className="flex items-start gap-2">
                                  {/* The chevron is the keyboard handle for the row. */}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); toggle(); }}
                                    aria-expanded={isOpen}
                                    aria-label={`${isOpen ? 'Close' : 'Open'} ${g.groupid}`}
                                    className="mt-0.5 rounded text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                                  >
                                    <ChevronRightIcon className={'h-4 w-4 transition-transform motion-reduce:transition-none ' + (isOpen ? 'rotate-90' : '')} />
                                  </button>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium text-slate-900" title={g.title || undefined}>{g.title || 'Untitled'}</div>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                                      <span className="font-mono text-slate-600">{g.groupid}</span>
                                      {g.brand && <span>{g.brand}</span>}
                                      <span>added {shortDate(g.created)}</span>
                                      {g.listed === 0 && !isBirk(g.brand) && (
                                        <span className="rounded bg-amber-100 px-1.5 py-px font-medium text-amber-800">Not on Amazon</span>
                                      )}
                                    </div>
                                    <SizeRun sizes={g.sizes} />
                                  </div>
                                </div>
                              </td>
                              <td className={TD + ' border-l border-slate-100'}><Num n={g.local} /></td>
                              <td className={TD}><Num n={g.fba} /></td>
                              <td className={TD_GBP + ' border-l border-slate-100 ' + (g.sold === 0 ? 'text-slate-300' : g.profit < 0 ? 'font-medium text-rose-600' : 'font-medium text-slate-900')}>
                                {g.sold === 0 ? '·' : gbp(g.profit)}
                              </td>
                              <td className="whitespace-nowrap border-l border-slate-100 py-3 pl-3 pr-4 align-top">
                                <ReviewChip g={g} />
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-brand-50/60">
                                <td colSpan={5} className="pb-5 pl-10 pr-4 pt-1">
                                  <StylePanel g={g} from={selfUrl} busy={busy} msg={msg} onSetReview={(d) => setReview(g.groupid, d)} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

// THE SIZE RUN — one tile per size, coloured by how it's doing; the numbers are in the tooltip (and in the open style's table).
function SizeRun({ sizes }: { sizes: ProcessSizeRow[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {sizes.map((r) => {
        const sold = unitsSold(r);
        const tip = `${r.size}: sold ${sold} · ${r.localStock} here · ${r.fbaStock} at Amazon`;
        return (
          <span key={r.code} title={tip}
                className={'inline-flex h-6 min-w-[2rem] items-center justify-center rounded px-1.5 text-[11px] font-medium tabular-nums ' + SIZE_TILE[sizeState(r)]}>
            {r.size}
          </span>
        );
      })}
    </div>
  );
}

function Legend({ state, label }: { state: SizeState; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={'inline-block h-3 w-4 rounded-sm ' + SIZE_TILE[state]} />
      {label}
    </span>
  );
}

// Review column: Due; a reviewed style's next date (amber, as on the pricing lists); a too-new style's first due date (grey).
function ReviewChip({ g }: { g: StyleGroup }) {
  if (g.due) return <span className="text-xs font-semibold text-slate-700">Due</span>;
  if (g.reviewOn) return <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">{fmtReviewDate(g.reviewOn)}</span>;
  return <span className="text-xs text-slate-400" title="Not reviewed yet — due 20 days after it was added">{fmtReviewDate(g.dueOn)}</span>;
}

// THE OPEN STYLE — one block under the product name (indented to its text), ONE label column down the left so everything lines up:
// the sizes sideways (sizes across under their tiles — the per-channel sold figures live here since the Sold columns went), then the
// review, then where to act. No card-in-a-row and no side-by-side halves (owner, 2026-10-27: "the dropdown still needs work").
const LABEL = 'w-32 shrink-0 whitespace-nowrap pr-4 text-left text-xs font-normal text-slate-500';
function StylePanel({ g, from, busy, msg, onSetReview }: {
  g: StyleGroup; from: string; busy: boolean; msg: { ok: boolean; text: string } | null; onSetReview: (days: number) => Promise<boolean>;
}) {
  const birk = isBirk(g.brand);
  const line = (label: string, cell: (r: ProcessSizeRow) => ReactNode, title?: string) => (
    <tr>
      <th scope="row" className={LABEL + ' py-1'} title={title}>{label}</th>
      {g.sizes.map((r) => <td key={r.code} className="w-10 px-0.5 py-1 text-center tabular-nums">{cell(r)}</td>)}
    </tr>
  );
  return (
    <div className="space-y-4 border-t border-brand-100 pt-4">
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>
              <th className={LABEL + ' pb-1.5'}>Size</th>
              {g.sizes.map((r) => (
                <th key={r.code} scope="col" title={r.code} className="px-0.5 pb-1.5">
                  <span className={'inline-flex h-6 w-9 items-center justify-center rounded text-[11px] font-medium tabular-nums ' + SIZE_TILE[sizeState(r)]}>{r.size}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {line('Sold on Amazon', (r) => <Num n={Math.max(r.channels.AMZ.net, 0)} />, 'Net of returns')}
            {line('Sold on Shopify', (r) => <Num n={Math.max(r.channels.SHP.net, 0)} />, 'Net of returns')}
            {line('Stock here', (r) => <Num n={r.localStock} />)}
            {line('At Amazon', (r) => <Num n={r.fbaStock} />, 'At FBA, plus local units on their way')}
            {!birk && line('Listed on Amazon', (r) => (r.onAmz
              ? <span className="text-xs text-slate-400">Yes</span>
              : <span className="text-xs font-semibold text-amber-700">No</span>))}
          </tbody>
        </table>
      </div>

      <div className="flex items-start">
        <span className={LABEL + ' pt-1.5'}>Review</span>
        <div className="min-w-0 space-y-2">
          <p className="text-sm text-slate-700">
            {g.due
              ? 'Due now.'
              : g.reviewOn
                ? <>Next review {fmtReviewDate(g.reviewOn)}.</>
                : <>First review {fmtReviewDate(g.dueOn)}, 20 days after it was added.</>}
            {msg && <span className={'ml-2 font-medium ' + (msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</span>}
          </p>
          <ReviewPicker key={g.groupid} busy={busy} disabled={false} canClear={!!g.reviewOn} onSet={onSetReview} />
        </div>
      </div>

      <div className="flex items-start">
        <span className={LABEL + ' pt-1.5'}>Go to</span>
        <div className="min-w-0"><ProductNavCards groupid={g.groupid} from={from} showProduct compact /></div>
      </div>
    </div>
  );
}

// '2026-09-19' -> '19 Sep'. Split on the hyphens rather than via Date (a 'YYYY-MM-DD' handed to Date shifts a day under BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string) {
  const [, m, d] = iso.split('-');
  const mi = Number(m) - 1;
  if (!d || mi < 0 || mi > 11) return iso;
  return `${Number(d)} ${MONTHS[mi]}`;
}

// A count cell: zero is a faint dot, so the numbers that matter stand out down a long column.
function Num({ n }: { n: number }) {
  if (!n) return <span className="text-slate-300">·</span>;
  return <span className="tabular-nums text-slate-800">{n}</span>;
}

function gbp(v: number) {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
