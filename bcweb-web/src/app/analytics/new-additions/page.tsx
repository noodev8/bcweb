'use client';
/*
=======================================================================================================================================
Page: /analytics/new-additions  (New Additions — Daily's "New stuff")
=======================================================================================================================================
Purpose: PROSPECT PERFORMANCE — the list behind Daily's New stuff %. Every SKU FIRST booked in on Goods In in the last 90 days, and
         whether it has sold since (any channel, eBay included). Owner, 2026-11-05: "our intention here is to get the 25% as high as
         possible" — so the screen is about getting the unsold new sizes sold: which they are, how long each has left, and pricing them.
         Data: GET /process-overview (bcweb-server/utils/processMap.js → NEW_SKUS_SQL) — the SAME rows Daily counts, so the tile and
         this screen always agree. Rules (who's in, what sold means, price due) live in that file's header.

REBUILT 2026-11-05 on the SKU rule (owner: change the existing screen rather than add a second one). Until then it listed every size
of every style CREATED in 90 days with a pairs Sold %, a Profit column and its own "Look again in" review (skusummary.next_new_review,
retired — option A: "one review date, one habit"). Git history has that version.

THE LAYOUT (kept from the 2026-10-27/29 rounds — owner: "way to much going on", then "layout is a bit off"):
  - One summary line (the whole 90 days, whatever the filters): New SKUs · Sold · Sold % (Styles taken off 2026-11-05 — its 43 sat beside Sold 43 and read as related). Under it THE INTAKES: Sold % for SKUs
    first in 0–30 / 30–60 / 60–90 days ago (click one to list it).
  - ONE ROW PER STYLE with ALL its sizes as tiles (2026-11-05, flipped — see SizeState): white, outlined = a new size NOT SOLD YET,
    the only thing to work on; faded grey = sold (ticked off) or not new (first in before the window — not in the figure). The quick
    filters are hidden for now (SHOW_FILTERS); the Due switch stays.
  - Each row is LED BY THE GROUP ID (large, monospace; the title small under it — owner, 2026-11-05, a trial), under a Style
    heading; then Brand in its own column. The table is only as wide as its columns (no big gap before Brand).
  - Columns: Days in (days since the style's first new size was booked in — owner, 2026-11-05, was Days left; an unsold size that
    reaches 90 drops out of the % without selling; plain, no colours — owner, 2026-11-06). Newest added at the top by default; every column sorts (a
    third click goes back to newest first) — ?sort= ?dir=), Shopify (the style's price) and Amazon (the price range of the unsold
    listed sizes) — one standard, no review dates (owner, 2026-11-05).
  - THE STANDARD PRODUCT MENU (owner, 2026-11-06: "apply the standard navigation we have in other screens ... Sticks to the top and
    is acted on with a selected row"): ProductNavCards in a sticky bar, as on Inventory — CLICK A ROW TO SELECT IT (tinted, ?sel=),
    the menu then goes to Product, Sales, Inventory, Shopify / Amazon Order and Price for it; greyed until ONE row is picked (and
    while several are — it acts on one style); Amazon greyed for Birkenstock.
  - MULTI-SELECT LIKE WINDOWS (owner, 2026-11-06: "Allow multi select like windows (Shift and ctrl etc.) Have a cut button that does
    a soft cut"): click = just that row (again = let it go), Ctrl/⌘-click = add / take off one, Shift-click = the range from the
    last plain/Ctrl click, Ctrl+Shift-click = add the range, Ctrl+A = every row on screen, Esc = none (those two once you've clicked in the list). ?sel=a,b. The bulk bar's
    CUT soft-cuts the selected rows (the same ?cut= as a row's ×); a PERMANENT REFRESH brings every cut row back, clears the selection
    and reloads the data (owner, same day: no cut count, no "Reset · n hidden" — "just cut and have a permanent REFRESH").
    Because the bar is sticky, the table header no longer is (two sticky bars fought for the top).
  - A SMALL PICTURE OF THE SHOE beside the group id (owner, same day: "directly in the list if it doesnt drag it" — 56px, no taller
    than the group id + title + tiles, so the rows don't grow). No picture = an empty box, so the codes still line up.
  - NO DROP-DOWN (owner, 2026-11-05: "the dropdown on each style isnt do much for me" — option A). The shortcuts straight to pricing
    stay: the Shopify PRICE opens the Shopify drill; a WHITE TILE opens that size's Amazon drill (both with Prev / Next through this
    list). (The row itself opened the Shopify drill until 2026-11-06; it selects now.)
    An unsold size with no Amazon listing is a plain white tile, not a link (its amber dot was taken off — owner, 2026-11-05). Stock, sold and the Amazon price per size are in the
    tile's tooltip. The drop-down's sold/stock grid, Amazon upload file and product links went (the drills link on; AMZ loaded has
    the upload file) — git history.

PRICE DUE, THE PRICING SCREENS' OWN (owner, 2026-11-05, option A): a style is due when it still has an unsold new size and Shopify is
         due (per style) or an unsold size is due on Amazon — lib/process.ts → styleDue, from flags the server works out with the pricing
         lists' predicates. Pricing it on the drill parks it here too. The Due switch is OFF by default (on 2026-11-05 nothing was due —
         the team had priced every new line — and the screen opened empty); ?due=1 turns it on.

PREV / NEXT ON THE DRILLS (owner, same day: "price navigation back and forth"): opening a Shopify or Amazon drill from here saves the
         list as it stands (components/DrillListNav) — Shopify: the styles in screen order (Due on: only Shopify-due ones); Amazon: the
         unsold, listed sizes in screen order (Due on: only Amazon-due ones) — and the drill steps through it with ‹ Prev · Next ›.

SOFT CUT + BULK PRICE (owner, 2026-11-06: "a soft cut button which hides away and we action whats left. A reset brings them all back"
         … "change prices here in bulk. Increase or decrease by a percentage"). Each row has an × that hides it from the screen (?cut=,
         nothing stored; Refresh brings every row back). What's LEFT — after Due and the cuts — is what the bulk bar acts on, no ticks:
           Shopify ± x%: every style left that is on Shopify and still has an unsold new size (a complete style is skipped) — W1, live.
           Amazon ± x%: every UNSOLD, listed new size of the styles left (owner: "unsold sizes only") — W-A1, into the upload basket.
         % off the CURRENT price (Amazon: a pending / uploaded change since the last import beats the feed), to the penny, the normal
         price log with the person and the note "Bulk New Additions ±x%". EACH CHANGED ITEM IS REVIEWED IN 3 DAYS, no choice (owner,
         2026-11-06 — so it drops off Due and isn't priced again before the move has had a chance; "Can we just set it to 3 days"),
         and a review date already LATER is kept ("keep the later date" — a deliberate long park isn't undone by a bulk move). Preview then Apply; under cost /
         break-even and over RRP are flagged, never blocked. components/BulkPercentPrice owns the control.

VIEW STATE LIVES IN THE URL (owner, 2026-09-26): ?due= ?show= ?band= ?sort= ?dir= ?sel= ?cut=, read once into state and written back with
         router.replace from the handlers (never an effect). The back arrow reads ?from= / ?back=.
=======================================================================================================================================
*/

import { Suspense, useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CheckIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ProductNavCards from '@/components/ProductNavCards';
import BulkPercentPrice, { movePrice, type BulkPlan, type BulkPlanItem } from '@/components/BulkPercentPrice';
import { useAuth } from '@/contexts/AuthContext';
import { DueSwitch } from '@/components/ListViewControls';
import { saveDrillList, drillListHref } from '@/components/DrillListNav';
import { useApiQuery } from '@/lib/useApiQuery';
import { applyAmzPrice, applyPrice, getProcessOverview, type ProcessOtherSize, type ProcessSizeRow } from '@/lib/api';
import { isSold, styleDue } from '@/lib/process';

// Fixed 90-day window (server-side, NEW_DAYS) — a SKU leaves the list 90 days after its first Goods In arrival, sold or not.
const DAYS = 90;
const LIST_LABEL = 'New Additions';
const SHP_LIST = 'new-shp';   // DrillListNav ids
const AMZ_LIST = 'new-amz';

// THE QUICK FILTERS ARE HIDDEN (owner, 2026-11-05: "Remove (Hide) the filter for now. Let me see how it feels") — their style counts
// (All 43 …) sat under the SKU figures (Sold 43 …) and read as the same numbers. Flip back to true to bring them back; while hidden the
// list is always All (a ?show= in an old link is ignored).
const SHOW_FILTERS = false;
// THE INTAKE CARDS ARE HIDDEN too (owner, 2026-11-05: "Lets get rid of some noise. The 3 boxes and bars above the list can go"). Kept,
// not deleted — flip to true to bring them back; while hidden a ?band= in an old link is ignored.
const SHOW_INTAKES = false;
// THE BULK PRICE CHANGE'S REVIEW — fixed, no choice (owner, 2026-11-06); a review already later is kept. See the header.
const BULK_REVIEW_DAYS = 3;
// Today in London as YYYY-MM-DD (en-CA formats as ISO), and n days on — date strings only, never a Date at local midnight (CLAUDE.md).
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
function addDaysIso(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// The quick filters: how far through its sizes a style is.
type Show = 'all' | 'none' | 'part' | 'done' | 'noamz';
const SHOWS: { id: Show; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every style with a new SKU' },
  { id: 'none', label: 'Nothing sold', hint: 'Not one new size has sold yet (net of returns)' },
  { id: 'part', label: 'Part sold', hint: 'Some new sizes sold, some not yet' },
  { id: 'done', label: 'All sold', hint: 'Every new size has sold — ticked off' },
  { id: 'noamz', label: 'Not on Amazon', hint: 'An unsold new size with no Amazon listing (Birkenstock left out — it cannot go on Amazon)' },
];
const isBirk = (brand: string | null) => !!brand && brand.trim().toLowerCase().startsWith('birk');

// Stable identity for "nothing loaded yet" — a fresh [] each render would defeat the memos below.
const NO_ROWS: ProcessSizeRow[] = [];
const NO_OTHERS: ProcessOtherSize[] = [];

// One tile of a style's size run: a NEW size (row set — counted) or one of its other sizes (row null — shown, never counted).
interface RunSize { code: string; size: string; firstIn: string | null; row: ProcessSizeRow | null }
// Sizes in size order: numeric where they are numbers (37.5 between 37 and 38), else as text.
const sizeNum = (s: string) => (/^[0-9]+([.][0-9]+)?$/.test(s) ? Number(s) : null);
const bySize = (a: RunSize, b: RunSize) => {
  const x = sizeNum(a.size), y = sizeNum(b.size);
  if (x !== null && y !== null) return x - y;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return a.size.localeCompare(b.size);
};

// A style and its NEW sizes, with what its row shows and sorts by.
interface StyleGroup {
  groupid: string; title: string | null; brand: string | null; sizes: ProcessSizeRow[];
  run: RunSize[];                               // every size to draw: the new ones and the style's other sizes, in size order
  sold: number; unsold: number;                 // new sizes sold / not yet
  daysLeft: number | null;                      // fewest days left of an UNSOLD size (null = all sold)
  firstIn: string; ageDays: number;             // the earliest first arrival among its new sizes
  unlisted: number;                             // unsold sizes with no Amazon listing
  due: boolean; shpDue: boolean; amzDue: number;
  amzLow: number | null; amzHigh: number | null; // Amazon price range over the unsold listed sizes (the Amazon column / sort)
}
// THE COLUMN SORTS. null = nothing to sort on (goes last). Shopify by its price, Amazon by the low end of its range.
type SortKey = 'style' | 'brand' | 'age' | 'rrp' | 'shp' | 'amz';
const SORT_KEYS: SortKey[] = ['style', 'brand', 'age', 'rrp', 'shp', 'amz'];
const SORT_VALUE: Record<SortKey, (g: StyleGroup) => number | string | null> = {
  style: (g) => g.groupid,
  brand: (g) => g.brand,
  age: (g) => g.ageDays,
  rrp: (g) => g.sizes[0].rrp,
  shp: (g) => (g.sizes[0].shpLive ? g.sizes[0].shpPrice : null),
  amz: (g) => g.amzLow,
};

// The Amazon price range over the UNSOLD listed sizes — what is still to sell there; when none is unsold and listed, over every
// listed new size (owner, 2026-11-06: no "All sold" — "Show price or Not on amazon"). Both null when nothing is listed or priced.
function amzRange(unsold: ProcessSizeRow[]) {
  const prices = unsold.filter((x) => x.onAmz && x.amzPrice !== null).map((x) => x.amzPrice as number);
  return prices.length ? { amzLow: Math.min(...prices), amzHigh: Math.max(...prices) } : { amzLow: null, amzHigh: null };
}

const SHOW_TEST: Record<Show, (g: StyleGroup) => boolean> = {
  all: () => true,
  none: (g) => g.sold === 0,
  part: (g) => g.sold > 0 && g.unsold > 0,
  done: (g) => g.unsold === 0,
  noamz: (g) => g.unlisted > 0 && !isBirk(g.brand),
};

// THE SIZE RUN — FLIPPED (owner, 2026-11-05: "Light faded grey means it is sorted … Show all sizes and enable the sizes that still
// havnt sold"). The one thing a tile has to say is "still to sell": a NEW size not sold yet is the only white, outlined tile; everything
// else is faded grey — a new size that has sold (done, ticked off) and the style's other sizes (first in before the 90 days, or never
// booked in but holding stock — not counted here). The tooltip says which. (Was green for sold — solid sold out / light still in stock
// — and only the new sizes drawn, so Capri 4 Black showed one lone tile.)
// Old sizes are NOT told apart (owner, 2026-11-06): a dashed outline for old sizes that never sold was tried and dropped — "too much
// to absorb here … Just that it doesnt belong here"; the size is shown for completeness only.
type SizeState = 'todo' | 'done' | 'old';
const sizeState = (t: RunSize): SizeState => (!t.row ? 'old' : isSold(t.row) ? 'done' : 'todo');
const SIZE_TILE: Record<SizeState, string> = {
  todo: 'bg-white text-slate-900 font-semibold ring-1 ring-inset ring-slate-400',
  done: 'bg-slate-100 text-slate-400',
  old: 'bg-slate-100 text-slate-400',
};
// NO TOOLTIP ON A TILE (owner, 2026-11-06: "not feeling the size hover. Lets try without any hover text at all"). Tried and dropped
// the same day, in order: a full line (sold / days left / stock / Amazon price / review), "n sold", "Over 90 days", "Not counted
// here". The colour is the whole message: white = still to sell (a link to its Amazon drill when listed), grey = nothing to do here.

// THE INTAKES — the 90 days in three 30-day bands by the SKU's FIRST arrival, newest first, each with its own Sold % (one figure
// mixes stock that landed yesterday with stock that's had 80 days). Click a card to list the styles with a SKU in it.
type BandId = 'new' | 'mid' | 'old';
const BANDS: { id: BandId; label: string; from: number; to: number }[] = [
  { id: 'new', label: 'Last 30 days', from: 0, to: 30 },
  { id: 'mid', label: '30–60 days ago', from: 30, to: 60 },
  { id: 'old', label: '60–90 days ago', from: 60, to: Infinity },
];
const inBand = (b: { from: number; to: number }, ageDays: number) => ageDays >= b.from && ageDays < b.to;
const pct = (sold: number, total: number) => (total > 0 ? Math.round((sold / total) * 100) : null);

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

  // Due OFF by default here (see the header) — ?due=1 is the switch on.
  const [dueOnly, setDueOnly] = useState(() => searchParams.get('due') === '1');
  const [show, setShow] = useState<Show>(() => (SHOW_FILTERS && SHOWS.find((s) => s.id === searchParams.get('show'))?.id) || 'all');
  const [band, setBand] = useState<BandId | null>(() => (SHOW_INTAKES && BANDS.find((b) => b.id === searchParams.get('band'))?.id) || null);
  // THE SELECTION (?sel=a,b) — Windows-style multi-select (see the header). The product menu acts on it only when it is ONE row.
  const [selected, setSelected] = useState<string[]>(() => (searchParams.get('sel') || '').split(',').filter(Boolean));
  // The Shift-click anchor: the row of the last plain / Ctrl click. Not in the URL (a fresh visit anchors on the last selected row).
  const [anchor, setAnchor] = useState<string | null>(() => (searchParams.get('sel') || '').split(',').filter(Boolean).pop() ?? null);
  // No sort = newest added first. A header click sorts by it, a second click flips it, a third goes back to newest first.
  const [sortBy, setSortBy] = useState<SortKey | null>(() => SORT_KEYS.find((k) => k === searchParams.get('sort')) ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (searchParams.get('dir') === 'desc' ? 'desc' : 'asc'));
  // THE SOFT CUT — group ids hidden from the screen (?cut=a,b). Nothing stored; Refresh (or a fresh visit) brings them all back.
  const [cut, setCut] = useState<string[]>(() => (searchParams.get('cut') || '').split(',').filter(Boolean));
  const { logout } = useAuth();

  // The URL for a given view. from/back are carried through untouched so this screen's own back arrow survives the round trip.
  const viewUrl = (v: { due: boolean; show: Show; band: BandId | null; sort: SortKey | null; dir: 'asc' | 'desc'; sel: string[]; cut: string[] }) => {
    const q = new URLSearchParams();
    const from = searchParams.get('from');
    const back = searchParams.get('back');
    if (from) q.set('from', from);
    if (back) q.set('back', back);
    if (v.due) q.set('due', '1');
    if (v.show !== 'all') q.set('show', v.show);
    if (v.band) q.set('band', v.band);
    if (v.sort) { q.set('sort', v.sort); if (v.dir === 'desc') q.set('dir', 'desc'); }
    if (v.sel.length) q.set('sel', v.sel.join(','));
    if (v.cut.length) q.set('cut', v.cut.join(','));
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const current = { due: dueOnly, show, band, sort: sortBy, dir: sortDir, sel: selected, cut };
  const selfUrl = viewUrl(current);
  const setView = (patch: Partial<typeof current>) => {
    const next = { ...current, ...patch };
    setDueOnly(next.due); setShow(next.show); setBand(next.band); setSortBy(next.sort); setSortDir(next.dir); setSelected(next.sel); setCut(next.cut);
    router.replace(viewUrl(next), { scroll: false });
  };

  // GET /process-overview under Daily's own key, so the tile and this screen share one fetch.
  const { data, error: loadError, isLoading: loading, refresh } = useApiQuery('process-overview', () => getProcessOverview());
  const rows: ProcessSizeRow[] = data?.rows ?? NO_ROWS;
  const others: ProcessOtherSize[] = data?.others ?? NO_OTHERS;
  const error = loadError?.message ?? null;

  // GROUP every new size under its style (the server sends them grouped, sizes in size order), and draw the style's other sizes with them.
  const allGroups = useMemo(() => {
    const groups: StyleGroup[] = [];
    const byId = new Map<string, ProcessSizeRow[]>();
    for (const r of rows) {
      const list = byId.get(r.groupid);
      if (list) list.push(r); else byId.set(r.groupid, [r]);
    }
    const otherById = new Map<string, RunSize[]>();
    for (const o of others) {
      const t: RunSize = { code: o.code, size: o.size, firstIn: o.firstIn, row: null };
      const list = otherById.get(o.groupid);
      if (list) list.push(t); else otherById.set(o.groupid, [t]);
    }
    for (const [groupid, sizes] of byId) {
      const run = [
        ...sizes.map((r): RunSize => ({ code: r.code, size: r.size, firstIn: r.firstIn, row: r })),
        ...(otherById.get(groupid) ?? []),
      ].sort(bySize);
      const unsoldSizes = sizes.filter((r) => !isSold(r));
      const first = sizes.reduce((a, r) => (r.firstIn < a.firstIn ? r : a), sizes[0]);
      const d = styleDue(sizes);
      groups.push({
        groupid, title: sizes[0].title, brand: sizes[0].brand, sizes, run,
        sold: sizes.length - unsoldSizes.length, unsold: unsoldSizes.length,
        daysLeft: unsoldSizes.length ? Math.min(...unsoldSizes.map((r) => r.daysLeft)) : null,
        firstIn: first.firstIn, ageDays: first.ageDays,
        unlisted: unsoldSizes.filter((r) => !r.onAmz).length,
        due: d.due, shpDue: d.shp, amzDue: d.amz,
        ...amzRange(unsoldSizes.some((r) => r.onAmz) ? unsoldSizes : sizes),
      });
    }
    return groups;
  }, [rows, others]);

  // The ONE selected row the product menu acts on — null when none or several are picked. Its style is for the Birkenstock check.
  const menuGroupid = selected.length === 1 ? selected[0] : null;
  const selectedGroup = useMemo(() => allGroups.find((g) => g.groupid === menuGroupid) ?? null, [allGroups, menuGroupid]);

  // The summary line and the intakes — the whole window, whatever the filters (a number that moves when you flip a switch isn't a stat).
  const totals = useMemo(() => ({ skus: rows.length, sold: rows.filter(isSold).length }), [rows]);
  const intakes = useMemo(() => BANDS.map((b) => {
    const mine = rows.filter((r) => inBand(b, r.ageDays));
    return { ...b, skus: mine.length, sold: mine.filter(isSold).length };
  }), [rows]);

  // The intake picked on a card, then Due, then the quick filter. The filter counts are of that view, so each says what its click will show.
  const dueGroups = useMemo(() => {
    const b = BANDS.find((x) => x.id === band);
    return allGroups.filter((g) => (!b || g.sizes.some((r) => inBand(b, r.ageDays))) && (!dueOnly || g.due));
  }, [allGroups, dueOnly, band]);
  const showCounts = useMemo(() => {
    const c: Record<Show, number> = { all: 0, none: 0, part: 0, done: 0, noamz: 0 };
    for (const g of dueGroups) for (const s of SHOWS) if (SHOW_TEST[s.id](g)) c[s.id] += 1;
    return c;
  }, [dueGroups]);

  // THE ORDER: NEWEST ADDED AT THE TOP by default (owner, 2026-11-05: "Sort by newest added at the top" — added = the style's earliest
  // first Goods In arrival among its new sizes), and EVERY COLUMN SORTS (owner, same day: "Apply a sort on columns"). A row with
  // nothing to sort on (not on Shopify: no price; no Amazon price) goes last either way. Ties: newest first.
  const sortedGroups = useMemo(() => {
    const newest = (a: StyleGroup, b: StyleGroup) => b.firstIn.localeCompare(a.firstIn) || a.groupid.localeCompare(b.groupid);
    const groups = dueGroups.filter(SHOW_TEST[show]);
    if (!sortBy) return groups.sort(newest);
    const val = SORT_VALUE[sortBy];
    return groups.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || y === null) return x === y ? newest(a, b) : x === null ? 1 : -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return (sortDir === 'desc' ? -c : c) || newest(a, b);
    });
  }, [dueGroups, show, sortBy, sortDir]);

  // Header click: a new column sorts ascending, the same one flips to descending, a third click goes back to newest first.
  const toggleSort = (key: SortKey) => {
    if (sortBy !== key) setView({ sort: key, dir: 'asc' });
    else if (sortDir === 'asc') setView({ dir: 'desc' });
    else setView({ sort: null, dir: 'asc' });
  };
  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={'inline-flex items-center gap-1 rounded transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ' +
        (sortBy === key ? 'text-slate-900' : '')}
    >
      {label}
      {sortBy === key && <span className="text-[9px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  // WHAT'S ON SCREEN — the sorted list less the soft cuts. The drill lists and the bulk bar act on exactly this.
  const visibleGroups = useMemo(() => {
    const hidden = new Set(cut);
    return sortedGroups.filter((g) => !hidden.has(g.groupid));
  }, [sortedGroups, cut]);
  const cutHere = sortedGroups.length - visibleGroups.length;
  // The selected rows that are ON SCREEN — what Cut acts on (a row hidden by Due or a cut can still sit in ?sel=).
  const selectedHere = useMemo(() => {
    const s = new Set(selected);
    return visibleGroups.filter((g) => s.has(g.groupid)).map((g) => g.groupid);
  }, [visibleGroups, selected]);

  // A ROW CLICK — Windows rules (see the header). The range is in screen order, from the anchor (or this row, if the anchor has gone).
  const clickRow = (e: ReactMouseEvent, groupid: string) => {
    const add = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      const ids = visibleGroups.map((g) => g.groupid);
      const from = anchor ? ids.indexOf(anchor) : -1;
      const to = ids.indexOf(groupid);
      const range = from < 0 ? [groupid] : ids.slice(Math.min(from, to), Math.max(from, to) + 1);
      setView({ sel: add ? [...new Set([...selected, ...range])] : range });   // the anchor stays put
      return;
    }
    setAnchor(groupid);
    if (add) setView({ sel: selected.includes(groupid) ? selected.filter((x) => x !== groupid) : [...selected, groupid] });
    else setView({ sel: selected.length === 1 && selected[0] === groupid ? [] : [groupid] });
  };
  // Shift / Ctrl-click would otherwise select the page's text across the rows.
  const noTextSelect = (e: ReactMouseEvent) => { if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault(); };
  // CUT — soft-cut the selected rows on screen (the same ?cut= as a row's ×). Refresh brings them back.
  const cutSelected = () => {
    const gone = new Set(selectedHere);
    setView({ cut: [...cut, ...selectedHere], sel: selected.filter((x) => !gone.has(x)) });
  };
  // REFRESH — the whole screen: cuts gone, selection gone, data reloaded. Sort and Due are the view's settings and stay.
  const refreshScreen = () => {
    setAnchor(null);
    setView({ cut: [], sel: [] });
    void refresh();
  };

  // CTRL+A selects every row on screen, ESC clears. On the list itself (focusable, so a row click focuses it) — not the whole page,
  // so Ctrl+A in the bulk % box still selects its text. No effect needed.
  const onListKey = (e: ReactKeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setView({ sel: visibleGroups.map((g) => g.groupid) }); }
    else if (e.key === 'Escape') setView({ sel: [] });
  };

  // THE DRILL LISTS — saved on the click that opens a drill, so its ‹ Prev / Next › walks this screen's list as it stands.
  const openShopify = () => saveDrillList(SHP_LIST, {
    base: '/pricing/style/', from: selfUrl, label: LIST_LABEL,
    keys: visibleGroups.filter((g) => g.sizes[0].shpLive && (!dueOnly || g.shpDue)).map((g) => g.groupid),
  });
  const openAmazon = () => saveDrillList(AMZ_LIST, {
    base: '/amz/sku/', from: selfUrl, label: LIST_LABEL,
    keys: visibleGroups.flatMap((g) => g.sizes.filter((r) => r.onAmz && !isSold(r) && (!dueOnly || r.amzDue)).map((r) => r.code)),
  });
  const shpHref = (groupid: string) => drillListHref(SHP_LIST, { base: '/pricing/style/', from: selfUrl }, groupid);
  const amzHref = (code: string) => drillListHref(AMZ_LIST, { base: '/amz/sku/', from: selfUrl }, code);

  // THE MENU'S HEIGHT, for the sticky table header to sit under it. Measured by a callback ref + ResizeObserver (the menu wraps on a
  // narrow screen) — no effect needed; React runs the returned cleanup when the element goes.
  const [menuH, setMenuH] = useState(0);
  const menuRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setMenuH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // THE BULK PLANS — which rows a ± x% move touches, off what's on screen (see the header).
  const sign = (p: number) => (p > 0 ? `+${p}` : String(p));
  const bulkNote = (p: number) => `Bulk New Additions ${sign(p)}%`;
  // THE REVIEW: 3 days, or null (leave it) when the item is already parked later than that — see the header.
  const reviewOn = addDaysIso(londonToday(), BULK_REVIEW_DAYS);
  const reviewFor = (current: string | null) => (current && current > reviewOn ? null : BULK_REVIEW_DAYS);
  const reviewNote = `Each one reviewed in ${BULK_REVIEW_DAYS} days — one already reviewed later keeps its date.`;
  const flagFor = (next: number, floor: number | null, rrp: number | null) =>
    floor !== null && next < floor ? 'BELOW_COST' as const : rrp !== null && next > rrp ? 'ABOVE_RRP' as const : null;

  const planShopify = (p: number): BulkPlan => {
    const items: BulkPlanItem[] = [];
    let offShopify = 0, complete = 0, noPrice = 0;
    for (const g of visibleGroups) {
      const r = g.sizes[0];
      if (g.unsold === 0) { complete++; continue; }
      if (!r.shpLive) { offShopify++; continue; }
      if (r.shpPrice === null) { noPrice++; continue; }
      const next = movePrice(r.shpPrice, p);
      items.push({ key: g.groupid, label: g.groupid, now: r.shpPrice, next, flag: flagFor(next, r.cost, r.rrp), reviewDays: reviewFor(r.shpReview) });
    }
    const why = [complete && `${complete} complete`, offShopify && `${offShopify} not on Shopify`, noPrice && `${noPrice} no price`].filter(Boolean);
    return { items, skipped: why.length ? why.join(', ') : null, reviewNote };
  };
  const planAmazon = (p: number): BulkPlan => {
    const items: BulkPlanItem[] = [];
    let noPrice = 0;
    for (const g of visibleGroups) {
      for (const r of g.sizes) {
        if (isSold(r) || !r.onAmz) continue;            // unsold, listed sizes only (owner)
        if (r.amzPrice === null) { noPrice++; continue; }
        const next = movePrice(r.amzPrice, p);
        const floor = r.cost !== null && r.amzFbaFee !== null ? r.cost + r.amzFbaFee : null;   // the W-A1 break-even
        items.push({ key: r.code, label: r.code, now: r.amzPrice, next, flag: flagFor(next, floor, r.rrp), reviewDays: reviewFor(r.amzReview) });
      }
    }
    return { items, skipped: noPrice ? `${noPrice} with no Amazon price` : null, reviewNote };
  };

  // THE WRITES — the shared W1 / W-A1 routes, one item at a time (every Shopify push and per-item bound runs), each with its review.
  const applyShopify = async (items: BulkPlanItem[], p: number, onProgress: (done: number) => void) => {
    let ok = 0, failed = 0, notPushed = 0;
    for (let i = 0; i < items.length; i++) {
      const res = await applyPrice(items[i].key, items[i].next, items[i].reviewDays, bulkNote(p));
      if (res.return_code === 'UNAUTHORIZED') { logout(); throw new Error('Signed out — sign in and check the prices'); }
      if (res.success && res.data) { ok++; if (res.data.shopify && res.data.shopify.pushed === false) notPushed++; } else failed++;
      onProgress(i + 1);
    }
    await refresh();
    return `Changed ${ok} on Shopify${notPushed ? ` · ${notPushed} saved but didn't reach Shopify — open and re-Apply` : ''}${failed ? ` · ${failed} failed` : ''}`;
  };
  const applyAmazon = async (items: BulkPlanItem[], p: number, onProgress: (done: number) => void) => {
    let ok = 0, failed = 0;
    for (let i = 0; i < items.length; i++) {
      const res = await applyAmzPrice(items[i].key, items[i].next, bulkNote(p), items[i].reviewDays);
      if (res.return_code === 'UNAUTHORIZED') { logout(); throw new Error('Signed out — sign in and check the prices'); }
      if (res.success) ok++; else failed++;
      onProgress(i + 1);
    }
    await refresh();
    return `Changed ${ok} on Amazon → upload basket${failed ? ` · ${failed} failed` : ''}`;
  };

  const soldPct = pct(totals.sold, totals.skus);

  return (
    <AppShell backHref={backHref} backLabel={backLabel}>
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && (
        <>
          {/* THE SUMMARY — the whole 90 days. Sold % is Daily's New stuff figure, from the same rows. No page title — owner,
              2026-10-26: the back link names the module. */}
          <dl className="mb-4 flex flex-wrap divide-x divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
            {[
              ['New SKUs', String(totals.skus)],
              ['Sold', String(totals.sold)],
              ['Sold %', soldPct === null ? '–' : `${soldPct}%`],
            ].map(([label, value]) => (
              <div key={label} className="min-w-[7rem] px-4 py-2 text-center">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
              </div>
            ))}
            <div className="flex items-end px-4 py-2 text-xs text-slate-400">
              first booked in on Goods In in the last {DAYS} days · sold on any channel since
            </div>
            {/* THE DUE SWITCH lives in the summary strip (owner, 2026-11-06: "Due is taking too much space by itself" — it had a row of
                its own once the filters and the tile legend went). */}
            <div className="ml-auto flex items-center px-4 py-2">
              <DueSwitch on={dueOnly} onChange={(v) => setView({ due: v })} />
            </div>
          </dl>

          {/* THE INTAKES — Sold % per 30-day band of first arrival, newest first. Hidden (SHOW_INTAKES). */}
          {SHOW_INTAKES && rows.length > 0 && (
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              {intakes.map((b) => {
                const p = pct(b.sold, b.skus);
                const picked = band === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setView({ band: picked ? null : b.id })}
                    aria-pressed={picked}
                    title={picked ? 'Show every intake again' : `List the styles with a SKU first in ${b.label.toLowerCase()}`}
                    className={'rounded-lg border bg-white px-4 py-3 text-left transition hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ' +
                      (picked ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200')}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-slate-500">First in {b.label.toLowerCase()}</span>
                      <span className="text-lg font-semibold tabular-nums text-emerald-700">{p === null ? '–' : `${p}%`}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${p ?? 0}%` }} />
                    </div>
                    <div className="mt-1.5 text-xs tabular-nums text-slate-500">{b.sold} of {b.skus} SKUs sold</div>
                  </button>
                );
              })}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing new was booked in on Goods In in the last {DAYS} days.</p>
          ) : (
            <>
              {/* THE PRODUCT MENU — sticky, acts on the selected row (see the header). Same bar as Inventory's; the page background so rows
                  scrolling under it don't show through. */}
              <div ref={menuRef} className="sticky top-0 z-20 -mx-4 mb-3 border-b border-slate-200 bg-slate-100 px-4 pb-3 pt-1">
                <ProductNavCards
                  groupid={menuGroupid}
                  from={selfUrl}
                  showProduct
                  amazonOff={selectedGroup && isBirk(selectedGroup.brand) ? 'Birkenstock — not sold on Amazon' : undefined}
                />
              </div>

              {/* THE BULK BAR — what's on screen (less cuts), Cut and Refresh, then Shopify / Amazon ± x% on exactly those rows. */}
              <div className="mb-3 flex flex-wrap items-start gap-x-8 gap-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-3 pt-1 text-sm text-slate-600">
                  <span className="tabular-nums">{visibleGroups.length} style{visibleGroups.length === 1 ? '' : 's'}</span>
                  {/* CUT — the selected rows (Ctrl / Shift-click to pick several). Greyed with nothing picked. */}
                  <button type="button" onClick={cutSelected} disabled={selectedHere.length === 0}
                          title="Hide the selected rows — Ctrl / Shift-click to pick several, Ctrl+A for all, Esc for none"
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-0.5 text-sm font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white">
                    Cut
                  </button>
                  {/* REFRESH — always there (owner, 2026-11-06: "a permanent REFRESH button that refreshes the whole screen. Unselect any
                      items with the refresh"): every cut row back, nothing selected, the data fetched again. No counts on either button. */}
                  <button type="button" onClick={refreshScreen}
                          title="Bring every cut row back, clear the selection and reload the list"
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-0.5 text-sm font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50">
                    Refresh
                  </button>
                </div>
                <BulkPercentPrice channel="shopify" plan={planShopify} apply={applyShopify} disabled={visibleGroups.length === 0} />
                <BulkPercentPrice channel="amazon" plan={planAmazon} apply={applyAmazon} disabled={visibleGroups.length === 0} />
              </div>

              {/* THE QUICK FILTERS — hidden (SHOW_FILTERS); their row only exists when they're shown. */}
              {SHOW_FILTERS && <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-100/70 p-0.5">
                  {SHOWS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setView({ show: s.id })}
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
                {/* No tile legend (owner, 2026-11-06: "I was trying to click them") — the tiles' tooltips say what each one is. */}
              </div>}

              {/* overflow-clip keeps the rounded corners without a scroll box, which would trap the sticky header. w-fit: the table is only
                  as wide as its columns — at full width the Style column stretched and left a big gap before Brand (owner, 2026-11-05). */}
              <div tabIndex={-1} onKeyDown={onListKey}
                   className="w-fit max-w-full overflow-clip rounded-xl border border-slate-200 bg-white focus:outline-none">
                {visibleGroups.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">
                    {cutHere > 0 ? 'Every row is cut — press Refresh to bring them back.' : dueOnly ? 'Nothing here is due a price look. Switch off Due to see the rest.' : 'No styles match this filter.'}
                  </p>
                ) : (
                  <table className="text-sm">
                    {/* THE HEADER STICKS TOO (owner, 2026-11-06), just under the sticky product menu — its top is the menu's measured height. */}
                    <thead className="sticky z-10 bg-slate-50 text-xs text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]" style={{ top: menuH }}>
                      <tr>
                        <th className="w-[30rem] py-2.5 pl-4 pr-3 text-left font-medium">{sortBtn('style', 'Style')}</th>
                        <th className="w-32 border-l border-slate-200 py-2.5 pl-3 pr-4 text-left font-medium">{sortBtn('brand', 'Brand')}</th>
                        <th className="w-24 border-l border-slate-200 py-2.5 pl-3 pr-4 text-right font-medium"
                            title={`Days since it was first booked in on Goods In — an unsold size leaves the list at ${DAYS}`}>
                          {sortBtn('age', 'Days in')}
                        </th>
                        <th className="w-24 border-l border-slate-200 py-2.5 pl-3 pr-4 text-left font-medium"
                            title="The style's RRP — read the Shopify and Amazon prices against it">{sortBtn('rrp', 'RRP')}</th>
                        <th className="w-32 border-l border-slate-200 py-2.5 pl-3 pr-4 text-left font-medium"
                            title="The style's Shopify price — click it to price it">{sortBtn('shp', 'Shopify')}</th>
                        <th className="w-32 border-l border-slate-200 py-2.5 pl-3 pr-4 text-left font-medium"
                            title="Amazon price range of the unsold sizes — click a white size tile to price it">{sortBtn('amz', 'Amazon')}</th>
                        <th className="w-10 border-l border-slate-200 py-2.5"><span className="sr-only">Hide</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleGroups.map((g) => {
                        // Clicking a row SELECTS it for the product menu; clicking it again lets it go. No hover tint (owner, 2026-11-06) — only the
                        // selected row is tinted, so a hover can't be mistaken for a second selection.
                        const isSel = selected.includes(g.groupid);
                        // COMPLETE = every new size has sold (owner, 2026-11-06, option C): the row FADES — like a grey tile, faded means
                        // sorted — with a green tick by the group id, so the eye goes to the rows still to work. It still selects as normal.
                        const done = g.unsold === 0;
                        const fade = done ? 'opacity-50' : '';
                        return (
                          <tr
                            key={g.groupid}
                            onMouseDown={noTextSelect}
                            onClick={(e) => clickRow(e, g.groupid)}
                            aria-selected={isSel}
                            className={'cursor-pointer border-t border-slate-100 first:border-t-0 ' + (isSel ? 'bg-brand-50' : '')}
                          >
                            <td className="w-[30rem] max-w-[30rem] py-3 pl-4 pr-3 align-top">
                              <div className="flex items-start gap-3">
                              <div className={'shrink-0 ' + fade}><Thumb imagename={g.sizes[0].imagename} alt={g.title || g.groupid} /></div>
                              <div className="min-w-0 flex-1">
                              {/* LED BY THE GROUP ID (owner, 2026-11-05: "Lead by GROUPID to see what it looks like") — the code large, the
                                  title small under it; brand in its own column. The "first in n days ago · x of y new sizes sold" words
                                  were taken off (owner, same day: cut them down) — the order and Days in say the age, the white tiles
                                  say what's unsold. NO TOOLTIP on the group id (owner, same day: it showed across the whole row). */}
                              <div className="flex items-center gap-1.5">
                                <span className={'truncate font-mono text-base font-semibold text-slate-900 ' + fade}>{g.groupid}</span>
                                {done && <CheckIcon className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Every new size sold" />}
                              </div>
                              <div className={'mt-0.5 truncate text-xs text-slate-500 ' + fade}><span title={g.title || undefined}>{g.title || 'Untitled'}</span></div>
                              <div className={fade}><SizeRun g={g} amzHref={amzHref} onAmz={openAmazon} /></div>
                              </div>
                              </div>
                            </td>
                            <td className={'border-l border-slate-100 py-3 pl-3 pr-4 align-top text-slate-700 ' + fade}>
                              {g.brand || <span className="text-slate-300">–</span>}
                            </td>
                            <td className={'border-l border-slate-100 py-3 pl-3 pr-4 text-right align-top tabular-nums ' + fade}>
                              <DaysIn g={g} />
                            </td>
                            <td className={'whitespace-nowrap border-l border-slate-100 py-3 pl-3 pr-4 align-top ' + fade}>
                              {g.sizes[0].rrp === null ? <span className={NONE}>–</span> : <span className="tabular-nums text-slate-500">{gbp(g.sizes[0].rrp)}</span>}
                            </td>
                            <td className={'whitespace-nowrap border-l border-slate-100 py-3 pl-3 pr-4 align-top ' + fade}>
                              <ShopifyCell g={g} href={shpHref(g.groupid)} onOpen={openShopify} />
                            </td>
                            <td className={'whitespace-nowrap border-l border-slate-100 py-3 pl-3 pr-4 align-top ' + fade}>
                              <AmazonCell g={g} />
                            </td>
                            {/* SOFT CUT — hide this row from the screen (and from the bulk bar). Refresh brings it back. */}
                            <td className="border-l border-slate-100 px-2 py-3 text-center align-top">
                              <button type="button" aria-label={`Hide ${g.groupid}`}
                                      onClick={(e) => { e.stopPropagation(); setView({ cut: [...cut, g.groupid], sel: selected.filter((x) => x !== g.groupid) }); }}
                                      className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
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

// THE SIZE RUN — every size of the style as a tile (see SizeState). A WHITE tile listed on Amazon is a link to that size's Amazon drill
// (Prev / Next walks the unsold listed sizes of this list; a blue ring = due a price look); a white tile with no listing is plain and
// not a link (the amber "not on Amazon" dot was removed — owner, 2026-11-05). No tooltip (owner, 2026-11-06).
function SizeRun({ g, amzHref, onAmz }: { g: StyleGroup; amzHref: (code: string) => string; onAmz: () => void }) {
  const tile = 'relative flex h-6 w-9 items-center justify-center rounded text-[11px] tabular-nums ';
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {g.run.map((t) => {
        const state = sizeState(t);
        const r = t.row;
        if (state === 'todo' && r && r.onAmz) {
          return (
            <Link key={t.code} href={amzHref(t.code)} aria-label={`Size ${t.size} — price it on Amazon`}
                  onClick={(e) => { e.stopPropagation(); onAmz(); }}
                  className={tile + SIZE_TILE.todo + (r.amzDue ? ' ring-2 ring-brand-500' : '') +
                    ' transition hover:bg-brand-50 hover:ring-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'}>
              {t.size}
            </Link>
          );
        }
        return (
          <span key={t.code} onClick={(e) => e.stopPropagation()} className={tile + SIZE_TILE[state]}>
            {t.size}
          </span>
        );
      })}
    </div>
  );
}

// THE ROW'S PICTURE — 56px, no taller than the group id + title + tiles, so it doesn't make the rows taller. Same image host as the
// other screens. No image (or a broken one) = an empty box of the same size, so the group ids still line up down the list.
const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
function Thumb({ imagename, alt }: { imagename: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
      {imagename && !failed && (
        <Image src={IMAGE_BASE + imagename} alt={alt} fill sizes="56px" onError={() => setFailed(true)} className="object-contain" />
      )}
    </div>
  );
}

// DAYS IN (owner, 2026-11-05: "switch days left to days added" — was Days left, 90 − this): days since the style's first new size was
// booked in. PLAIN, NO COLOURS (owner, 2026-11-06: "dont have the colours. Keep them all normal") — amber/red for unsold sizes near 90
// days, and grey once all sold, were tried and taken off.
function DaysIn({ g }: { g: StyleGroup }) {
  return <span className="text-slate-700">{g.ageDays}</span>;
}

// THE RRP COLUMN (owner, 2026-11-05: "just an extra RRP column that covers both. Leave the prices there") — the style's RRP, grey,
// so the two prices beside it show at a glance whether a price has been moved off RRP (action taken) or not (action maybe needed).
// THE PRICE COLUMNS, ONE STANDARD (owner, 2026-11-05: "Standardise the Shopify and Amazon columns. Both show the respective prices
// (Amazon has a range). Dont show the due date"). The same plain price in both; a grey note when there's no price to show. Review dates
// and Due notes were taken off — the Due switch still filters on them, and a tile's tooltip still says its Amazon review.
const PRICE = 'tabular-nums font-medium text-slate-900';
const NONE = 'text-xs text-slate-400';
const gbp = (n: number) => `£${n.toFixed(2)}`;

// Shopify: the style's one price — a link to its drill (Prev / Next walks this screen's styles).
function ShopifyCell({ g, href, onOpen }: { g: StyleGroup; href: string; onOpen: () => void }) {
  const r = g.sizes[0];
  if (!r.shpLive) return <span className={NONE}>Not on Shopify</span>;
  return (
    <Link href={href} onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className={PRICE + ' underline-offset-2 hover:text-brand-700 hover:underline'}>
      {r.shpPrice === null ? '–' : gbp(r.shpPrice)}
    </Link>
  );
}

// Amazon: the price range of the unsold listed sizes (one price when they match; every listed size once all have sold), else
// "Not on Amazon". Per size it's on the tiles, which open each drill.
function AmazonCell({ g }: { g: StyleGroup }) {
  if (g.amzLow !== null && g.amzHigh !== null) {
    return <span className={PRICE}>{g.amzLow === g.amzHigh ? gbp(g.amzLow) : `${gbp(g.amzLow)}–${gbp(g.amzHigh)}`}</span>;
  }
  if (!g.sizes.some((r) => r.onAmz)) return <span className={NONE}>Not on Amazon</span>;
  return <span className={NONE}>–</span>;   // listed, but no price in the feed
}

