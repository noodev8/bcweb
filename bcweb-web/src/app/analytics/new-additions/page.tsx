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
    has sold and still has stock, white = not sold yet (legend in the control row; numbers in each tile's tooltip).
  - Under the summary, THE INTAKES: Sold % of pairs for styles added 60–90 / 30–60 / 0–30 days ago (2026-10-29, see BANDS; click one to list it). Then Profit (£ on
    its sales, every channel) and Review — that's all. NO SOLD OR STOCK COLUMNS (owner, 2026-10-27: the green sizes say what sold,
    "you can get rid of the sold colums now"; the Not on Amazon pill says where it is, "dont think we need Stock here / At Amazon");
    sold per channel and stock per size are in the open style. Sortable headers (Style, Profit) order the styles.
  - CLICK A STYLE TO ACT ON IT (one open at a time, in the URL as ?sel= so a link's "← Back" returns with it open). The SIZE RUN
    ITSELF OPENS: numbers under the tiles already there (sold on Amazon / sold on Shopify / in stock here / at Amazon / not listed),
    a short label at the end of each line. Under it, two light lines: the review, then the Amazon upload file when sizes aren't listed
    (components/AmazonExport, as on AMZ loaded) and the product links as plain text (components/ProductNavCards compact). A second
    row of tiles with a label column, bordered cards, a card-in-a-row and side-by-side halves were all tried and dropped as clunky.
  - The row says the AGE ("added 15 days ago", date in the tooltip) — age is how a new line is judged — and "Bought 10 · Sold 8" for the
    style (2026-10-27: how deep it was bought, at a glance; Held was tried and taken off — owner: "dont need held"; a size tile's
    tooltip gives sold and held for that size). "Bought", not "Added", so it can't be read with "added n days ago". Bought = pairs
    booked in on Goods In since the style was added (a test listing on placeholder stock shows Bought 0).
  - REVIEW IS ONE CLICK here: "Look again in 5 · 7 · 14 · 30 · 90 days" saves at once (the pricing screens' pick-then-Set was the busiest
    thing in the drop-down). The confirmation names the style and shows in the control row, because with Due on the reviewed style
    leaves the list.

REVIEW AND DUE, LIKE PRICES (owner, 2026-10-27). Per STYLE, skusummary.next_new_review (POST /new-additions-review). A never-reviewed
         style falls due 20 days after it was added (the old "20+ days live" filter); otherwise its review date decides — `due` is
         computed server-side (utils/processMap.js) and Daily reads the same flag. The Due switch (on by default) shows only styles due.
         Review column: Due, a reviewed style's date (amber), or a too-new style's first due date (grey).

VIEW STATE LIVES IN THE URL (owner, 2026-09-26): ?sort= ?dir= ?due= ?show= ?sel= ?band=, read once into state and written back with
         router.replace from the handlers (never an effect). The back arrow reads ?from= / ?back=.
=======================================================================================================================================
*/

import { Fragment, Suspense, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import AppShell from '@/components/AppShell';
import AmazonExport from '@/components/AmazonExport';
import ProductNavCards from '@/components/ProductNavCards';
import { DueSwitch, fmtReviewDate } from '@/components/ListViewControls';
import { useApiQuery } from '@/lib/useApiQuery';
import { getProcessOverview, markNewAdditionsReview, type ProcessSizeRow } from '@/lib/api';
import { CHANNELS, pairsSummary, unitsSold } from '@/lib/process';

// Fixed 90-day window (owner, 2026-09-26: "that's when I want each to sell at least once") — server-side, NEW_DAYS.
const DAYS = 90;

type SortKey = 'added' | 'code' | 'profit';
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

// Profit is right-aligned so the pence line up.
const TD_GBP = 'py-3 pl-3 pr-4 text-right align-top tabular-nums';

// A style and its sizes, with the style's totals (what its row shows and what sorting orders by).
interface StyleGroup {
  groupid: string; title: string | null; brand: string | null; created: string; sizes: ProcessSizeRow[];
  profit: number; sold: number;
  bought: number;                                         // pairs booked in on Goods In since it was added (the strip's Pairs bought)
  reviewOn: string | null; dueOn: string; due: boolean;   // the style's review (the same on each of its sizes)
  ageDays: number;                                        // days since it was added
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
// (2026-10-29: blank tiles outlined by a next step — list / send to Amazon / price look / give it time — were tried and taken off;
// owner: there are reasons a size can't go to Amazon, "no point confusing things".)
type SizeState = 'soldout' | 'selling' | 'unsold';
const sizeState = (r: ProcessSizeRow): SizeState =>
  unitsSold(r) === 0 ? 'unsold' : r.localStock + r.fbaStock === 0 ? 'soldout' : 'selling';
const SIZE_TILE: Record<SizeState, string> = {
  soldout: 'bg-emerald-600 text-white',
  selling: 'bg-emerald-100 text-emerald-900',
  unsold: 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300',
};

// THE INTAKES — the 90 days in three 30-day bands by when the style was added, newest first (owner, 2026-10-29: read left to right), each with its own Sold % of pairs
// (owner, 2026-10-29: one figure mixes stock that landed yesterday with stock that's had 80 days). Bands, not calendar months: the
// window starts mid-month, so a month view opens on a one-day sliver. The whole window, whatever the filters, like the summary.
// CLICK A CARD to list just that intake (?band=; Due goes off — a whole intake is the question, not what's due); click it again to
// clear. (A same-age line — "x% sold by day 30", red/green against the intake before — was tried 2026-10-29 and taken off, owner:
// "too much to look at and its confusing"; git history.)
type BandId = 'new' | 'mid' | 'old';
const BANDS: { id: BandId; label: string; from: number; to: number }[] = [
  { id: 'new', label: 'Last 30 days', from: 0, to: 30 },
  { id: 'mid', label: '30–60 days ago', from: 30, to: 60 },
  { id: 'old', label: '60–90 days ago', from: 60, to: Infinity },
];
const inBand = (b: { from: number; to: number }, ageDays: number) => ageDays >= b.from && ageDays < b.to;

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
    return v === 'code' || v === 'profit' ? v : 'added';
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (searchParams.get('dir') === 'asc' ? 'asc' : 'desc'));
  // Due on by default (as on the pricing lists) — ?due=0 is the switch off.
  const [dueOnly, setDueOnly] = useState(() => searchParams.get('due') !== '0');
  const [show, setShow] = useState<Show>(() => {
    const v = searchParams.get('show');
    return v === 'unsold' || v === 'selling' || v === 'noamz' ? v : 'all';
  });
  const [selected, setSelected] = useState<string | null>(() => searchParams.get('sel'));   // the open style
  const [band, setBand] = useState<BandId | null>(() => BANDS.find((b) => b.id === searchParams.get('band'))?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // The URL for a given view. from/back are carried through untouched so this screen's own back arrow survives the round trip.
  const viewUrl = (v: { sort: SortKey; dir: 'asc' | 'desc'; due: boolean; show: Show; sel: string | null; band: BandId | null }) => {
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
    if (v.band) q.set('band', v.band);
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const current = { sort: sortBy, dir: sortDir, due: dueOnly, show, sel: selected, band };
  const selfUrl = viewUrl(current);
  const setView = (patch: Partial<typeof current>) => {
    const next = { ...current, ...patch };
    setSortBy(next.sort); setSortDir(next.dir); setDueOnly(next.due); setShow(next.show); setSelected(next.sel); setBand(next.band);
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
          groupid: r.groupid, title: r.title, brand: r.brand, created: r.created, sizes: [], profit: 0, sold: 0, bought: 0,
          reviewOn: r.reviewOn, dueOn: r.dueOn, due: r.due, ageDays: r.ageDays, listed: 0,
        };
        byId.set(r.groupid, g);
        groups.push(g);
      }
      g.sizes.push(r);
      g.profit += profitOf(r);
      g.sold += unitsSold(r);
      g.bought += r.bought;
      if (r.onAmz) g.listed += 1;
    }
    return groups;
  }, [rows]);

  // The summary line — the whole window, whatever the filters (owner 2026-07-27: a number that moves when you flip a switch isn't a stat).
  const totals = useMemo(() => {
    return pairsSummary(rows);
  }, [rows]);
  const intakes = useMemo(() => BANDS.map((b) => {
    const mine = rows.filter((r) => inBand(b, r.ageDays));
    return { ...b, ...pairsSummary(mine), styles: new Set(mine.map((r) => r.groupid)).size };
  }), [rows]);

  // The intake picked on a card, then Due, then the quick filter. The filter counts are of that view, so each says what its click will show.
  const dueGroups = useMemo(() => {
    const b = BANDS.find((x) => x.id === band);
    return allGroups.filter((g) => (!b || inBand(b, g.ageDays)) && (!dueOnly || g.due));
  }, [allGroups, dueOnly, band]);
  const showCounts = useMemo(() => {
    const c: Record<Show, number> = { all: 0, unsold: 0, selling: 0, noamz: 0 };
    for (const g of dueGroups) for (const s of SHOWS) if (SHOW_TEST[s.id](g)) c[s.id] += 1;
    return c;
  }, [dueGroups]);

  // Sort the STYLES by the active column's total; ties fall back to newest-added.
  const sortedGroups = useMemo(() => {
    const groups = dueGroups.filter(SHOW_TEST[show]);
    const val: Record<SortKey, (g: StyleGroup) => number | string> = {
      added: (g) => g.created || '', code: (g) => g.groupid, profit: (g) => g.profit,
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
      // Named, and shown in the control row — with Due on, the reviewed style leaves the list, so a message inside it would vanish too.
      setMsg({
        ok: true,
        text: days === 0
          ? `${groupid}: review cleared — due 20 days after it was added.`
          : `${groupid}: next look ${res.data.nextReview ? fmtReviewDate(res.data.nextReview) : `in ${days} days`}.`,
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
          {/* THE SUMMARY — labelled figures, the whole 90 days, like a spreadsheet row (owner, 2026-10-27: numbers, not a sentence).
              No profit (owner, same day: "this is about shifting rather than margins"). In PAIRS (owner, same day): bought = booked
              in on Goods In, sold = net of returns; Unsold % is the dashboard's New stuff figure (lib/process.ts → pairsSummary).
              No page title — owner, 2026-10-26: the back link names the module. */}
          <dl className="mb-4 flex flex-wrap divide-x divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
            {[
              ['Styles', String(data?.styles ?? 0)],
              ['Pairs bought', String(totals.bought)],
              ['Pairs sold', String(totals.sold)],
              // Sold %, not Unsold % (owner, 2026-10-29) — the same way round as the intakes below; Daily keeps its unsold figure.
              ['Sold %', totals.bought > 0 ? `${100 - totals.unsoldPct}%` : '–'],
            ].map(([label, value]) => (
              // Centred, one width each, so every number sits under its label (owner, 2026-10-29).
              <div key={label} className="min-w-[7rem] px-4 py-2 text-center">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
              </div>
            ))}
            <div className="flex items-end px-4 py-2 text-xs text-slate-400">added in the last {DAYS} days</div>
          </dl>

          {/* THE INTAKES — Sold % per 30-day band, newest first: the older bands are the real test and each one climbs as
              its sizes go green (see BANDS). */}
          {rows.length > 0 && (
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              {intakes.map((b) => {
                const soldPct = b.bought > 0 ? 100 - b.unsoldPct : null;
                const picked = band === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setView({ band: picked ? null : b.id, due: false, sel: null })}
                    aria-pressed={picked}
                    title={picked ? 'Show every intake again' : `List the styles added ${b.label.toLowerCase()}`}
                    className={'rounded-lg border bg-white px-4 py-3 text-left transition hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ' +
                      (picked ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200')}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-slate-500">Added {b.label.toLowerCase()}</span>
                      <span className="text-lg font-semibold tabular-nums text-emerald-700">{soldPct === null ? '–' : `${soldPct}%`}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${soldPct ?? 0}%` }} />
                    </div>
                    <div className="mt-1.5 text-xs tabular-nums text-slate-500">
                      {b.sold} of {b.bought} pairs sold · {b.styles} style{b.styles === 1 ? '' : 's'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

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
                {/* The last review saved — stays put while the reviewed style leaves the Due list. */}
                <p role="status" aria-live="polite" className={'text-sm font-medium ' + (msg?.ok ? 'text-emerald-700' : 'text-red-600')}>
                  {msg?.text}
                </p>
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
                                      <span title={`Added ${shortDate(g.created)}`}>added {ago(g.ageDays)}</span>
                                      {/* How deep it was bought, at a glance (owner, 2026-10-27: "I've bought too deep"). */}
                                      <span className="tabular-nums">Bought {g.bought} · Sold {g.sold}</span>
                                      {g.listed === 0 && !isBirk(g.brand) && (
                                        <span className="rounded bg-amber-100 px-1.5 py-px font-medium text-amber-800">Not on Amazon</span>
                                      )}
                                    </div>
                                    <SizeRun g={g} open={isOpen} />
                                  </div>
                                </div>
                              </td>
                              <td className={TD_GBP + ' border-l border-slate-100 ' + (g.sold === 0 ? 'text-slate-300' : g.profit < 0 ? 'font-medium text-rose-600' : 'font-medium text-slate-900')}>
                                {g.sold === 0 ? '·' : gbp(g.profit)}
                              </td>
                              <td className="whitespace-nowrap border-l border-slate-100 py-3 pl-3 pr-4 align-top">
                                <ReviewChip g={g} />
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-brand-50/60">
                                <td colSpan={3} className="pb-4 pl-10 pr-4 pt-0">
                                  <StyleActions g={g} from={selfUrl} busy={busy} onSetReview={(d) => setReview(g.groupid, d)} />
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

// THE SIZE RUN — one tile per size, coloured by how it's doing. OPENING A STYLE OPENS THE RUN ITSELF (owner, 2026-10-27: the drop-down
// "feels clunky"): the numbers appear under the tiles already on screen, a short label at the end of each line — no second row of
// tiles, no wide label column pushing it right. A table either way, so the tiles don't move when it opens.
function SizeRun({ g, open }: { g: StyleGroup; open: boolean }) {
  const showListed = open && !isBirk(g.brand) && g.listed < g.sizes.length;
  const line = (label: string, cell: (r: ProcessSizeRow) => ReactNode, title?: string) => (
    <tr>
      {g.sizes.map((r) => <td key={r.code} className="h-5 text-center text-xs tabular-nums">{cell(r)}</td>)}
      <th scope="row" title={title} className="whitespace-nowrap pl-2 text-left text-[11px] font-normal text-slate-500">{label}</th>
    </tr>
  );
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="-mx-1 border-separate border-spacing-x-1 border-spacing-y-0">
        <thead>
          <tr>
            {g.sizes.map((r) => (
              <th key={r.code} scope="col" className="p-0 font-medium"
                  title={`Sold ${unitsSold(r)} · Held ${r.localStock + r.fbaStock}`}>
                <span className={'flex h-6 w-9 items-center justify-center rounded text-[11px] tabular-nums ' + SIZE_TILE[sizeState(r)]}>{r.size}</span>
              </th>
            ))}
            <th />
          </tr>
        </thead>
        {open && (
          <tbody>
            <tr><td className="h-1.5" /></tr>
            {line('sold on Amazon', (r) => <Num n={Math.max(r.channels.AMZ.net, 0)} />, 'Net of returns')}
            {line('sold on Shopify', (r) => <Num n={Math.max(r.channels.SHP.net, 0)} />, 'Net of returns')}
            {line('in stock here', (r) => <Num n={r.localStock} />)}
            {line('at Amazon', (r) => <Num n={r.fbaStock} />, 'At FBA, plus local units on their way')}
            {showListed && line('not listed', (r) => (r.onAmz ? null : <span className="font-semibold text-amber-700">✕</span>),
              'Sizes with no Amazon listing')}
          </tbody>
        )}
      </table>
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

// THE OPEN STYLE'S ACTIONS — under the opened size run, two light lines: the review (one click), then the Amazon file when sizes
// aren't listed (the one thing this screen can do itself — the same file as AMZ loaded and Add / Modify; it skips sizes already
// listed) and the product links as plain text. No label column, no bordered cards.
function StyleActions({ g, from, busy, onSetReview }: {
  g: StyleGroup; from: string; busy: boolean; onSetReview: (days: number) => Promise<boolean>;
}) {
  const unlisted = isBirk(g.brand) ? 0 : g.sizes.length - g.listed;
  return (
    <div className="space-y-3 border-t border-brand-100 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium text-slate-800">
          {g.due ? 'Due a look.' : g.reviewOn ? <>Next look {fmtReviewDate(g.reviewOn)}.</> : <>First look {fmtReviewDate(g.dueOn)}.</>}
        </span>
        <QuickReview busy={busy} canClear={!!g.reviewOn} onSet={onSetReview} />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {unlisted > 0 && (
          <div className="flex items-center gap-2">
            <AmazonExport key={g.groupid} groupid={g.groupid} sizesCount={g.sizes.length} quiet />
            <span className="text-xs text-amber-800">{g.listed === 0 ? 'not on Amazon yet' : `${unlisted} size${unlisted === 1 ? '' : 's'} not listed`}</span>
          </div>
        )}
        <ProductNavCards groupid={g.groupid} from={from} showProduct compact />
      </div>
    </div>
  );
}

// "Look again in 5 · 7 · 14 · 30 · 90 days" — each button saves at once (the periods that make sense for a new line; the pricing screens'
// pick-then-Set control was two clicks and nine chips, the busiest thing in the drop-down).
const QUICK_REVIEW = [5, 7, 14, 30, 90];   // 5 added 2026-10-27 (owner: "7 feels to long for some")
function QuickReview({ busy, canClear, onSet }: { busy: boolean; canClear: boolean; onSet: (days: number) => Promise<boolean> }) {
  const btn = 'rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-[13px] text-slate-700 transition hover:border-brand-500 hover:bg-brand-50 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[13px] text-slate-500">Look again in</span>
      {QUICK_REVIEW.map((d) => (
        <button key={d} type="button" disabled={busy} onClick={() => onSet(d)} className={btn}>{d} days</button>
      ))}
      {canClear && (
        <button type="button" disabled={busy} onClick={() => onSet(0)} title="Clear the review date — due 20 days after it was added"
                className="px-2 py-1 text-[13px] text-slate-500 hover:text-slate-800 disabled:opacity-50">
          Clear
        </button>
      )}
    </div>
  );
}

// 0 -> 'today', 1 -> 'yesterday', n -> 'n days ago'. Age is how a new line is judged, so the row says it rather than a date to work out.
function ago(days: number) {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
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
