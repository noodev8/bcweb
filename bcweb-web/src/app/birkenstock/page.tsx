'use client';
/*
=======================================================================================================================================
Page: /birkenstock
=======================================================================================================================================
Purpose: The Birkenstock re-order screen. Ported from the legacy PowerBuilder Birkenstock grid, which is the screen the seasonal order
         has always been placed off. Birkenstock is bought ~6 months ahead and cannot be re-ordered on demand (CLAUDE.md), so this one
         sheet — 365-day sales held against stock, size by size — is where the year's biggest buying decision is actually made.

THE TWO THINGS THE SCREEN SAYS, and they are the whole design:
  1. RED = SOLD MORE THAN WE HOLD. A style whose displayed stock is below its Sold 365 is a re-order candidate. Flat comparison, no
     threshold, no cover maths (owner: keep it simple at first) — and NOT applied to a zero-stock row, which stays blank. That looks
     inconsistent until you remember what the colour is for: it is a nudge to re-order based on sales volume, and a style sitting at
     zero is a decision that has already been made elsewhere (discontinued, or waiting on a delivery), not a nudge.
  2. LIVE vs FULL. LIVE = what is on the shelf, ready to sell. FULL = that plus everything still to come from Birkenstock on the
     pre-order book. The switch exists to stop an OVER-ORDER: a style that reads red on LIVE and black on FULL is already handled —
     the stock is bought, it just has not landed. So the red rule deliberately reads off WHICHEVER NUMBER IS DISPLAYED. Rows change
     colour when you flip the switch; that change IS the answer.

IT IS A DISPLAY SWITCH, NOT A FILTER (owner, 2026-09-04). Both quantities ship in one payload (see getBirkStock) and LIVE/FULL only
picks which is drawn, so the flip is instant and never re-reads the DB. Nothing enters or leaves the list when it is thrown — the same
176 styles are on screen either way. Same reason the whole catalogue ships at once: every narrowing and sort below is client-side.

THE FILTER IS THE INVENTORY FILTER, deliberately identical (owner): two boxes, Contains / Does not contain, both plain substring over
title + groupid + segment, each Find stacking another step onto what is already on screen, Reset returning the whole list and
re-reading from the DB. It is the gesture the operator has worked to for years, and a second dialect of it on a second screen would be
worse than no filter at all. The one thing NOT carried over is Inventory's worded STOCK/SOLD commands — this grid is read by eye down
a short list, and a "STOCK LESS 10" here would just be the red colouring said twice.

THE PLANNER (owner, 2026-09-04 — the legacy screen's Planner button). Clicking any line opens its delivery months underneath it: one
row per month still to come, sizes under their own columns. It answers the question FULL raises but cannot settle — three units in May
and thirty-two in August is a different season from thirty-five in May. The months are rows of THIS table, not a nested one, so each
figure sits directly beneath the size it belongs to and beneath the stock we already hold in that size. See SEASON for why they run
September -> August, and routes/birk-planner.js for why a delivery that has fully landed shows nothing at all.

PROFIT, AND THE BANDS. A gross-profit figure per style over the same 365 days — sold price ex VAT minus cost, times units — with four
fixed thresholds (£1000/750/500/250) above the grid. It is an INDICATION, not accounting: selling expenses are not deducted, at the
owner's call, so it reads above the net figure on the Pricing screens. Its job is to order the sheet, because the buy is made top down
against a budget: work the styles over 1000, then drop a band and work the next tier. Pressing a band sorts by profit descending, so
the list only ever grows downwards and the tier already dealt with stays above the new arrivals. See routes/birk-stock.js for the
arithmetic and for the four gates of the owner's original query that are deliberately NOT here.

CUT (owner, 2026-09-04). Mark rows — click, ctrl-click to add one, shift-click for a range, Windows rules — and Cut pushes them out of
the view. A PURE DISPLAY FILTER: nothing is written, nothing outlives the visit, and there is deliberately NO restore, because Reset is
the undo the owner wants and a Restore button beside a Cut button would invite the cut to be read as a decision under review. It is
housekeeping: working a profit band means sweeping away the lines already dealt with so what is left is what is still to decide, and it
covers the cases a text step cannot express without over-matching. Cutting clears the marks with it — the rows they pointed at are off
the screen, so marks that survived would be highlights on nothing.

PARK — THE LEGACY "1 2 3" (owner, 2026-09-04; review-date.txt). Mark the styles you have just ordered from Birkenstock, press 1, 2 or
3, and skusummary.check_stock is stamped with the 1st of the month that many months ahead. THE ONLY WRITE ON THIS SCREEN.

IT IS FILTERED ONLY WHEN A PROFIT BAND IS ON, and that pairing is the feature rather than an implementation detail. With a band you are
WORKING the sheet — deciding what to order — and a style already ordered is settled noise on the list; parked rows drop out. On ALL you
are LOOKING at the sheet, the whole brand, and nothing is hidden: parked styles are there, wearing the month they come back. So the
same row is present or absent according to which of those two jobs is in hand, and nothing can be lost behind the park — press All and
it is back. The count strip says how many the band is holding back, so a short list is never a mystery.

NOT VIRTUALISED, on purpose: 176 rows x ~18 cells is nothing, and a windowed grid would cost the browser's own Ctrl+F, which is a
thing operators actually use on a sheet like this.
=======================================================================================================================================
*/

import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getBirkPlanner, getBirkStock, setBirkReview, type BirkStockRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// One applied narrowing step — same shape and meaning as Inventory's. `has` keeps matching rows; `not` drops them.
interface FilterStep {
  op: 'has' | 'not';
  term: string;
}

// Which quantity the grid is drawing. Not a filter — see the header block.
type Mode = 'live' | 'full';

// The sort keys the owner asked for, and only those: the raw identity and the two numbers the decision is made on. Every key works in
// both directions; clicking the active key reverses it.
type SortKey = 'groupid' | 'sold365' | 'gross' | 'stock';
// The direction a key adopts when first picked. Groupid reads naturally A->Z; the two numbers open high->low, because the reason to
// sort on either of them is to bring the big sellers (or the big piles) to the top.
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = { groupid: 'asc', sold365: 'desc', gross: 'desc', stock: 'desc' };

// ---- Gross ------------------------------------------------------------------------------------------------------------------------
// The threshold bands. 1000 is the owner's own working number (the figure hard-coded in the query this came from); the rest are the
// steps below it, because the way the screen is used is ONE BAND AT A TIME — order the styles over 1000 against the budget, then drop
// to 750 and work the next tier. They are steps down, not a scale. On the current book they cut the catalogue 16 / 28 / 46 / 85 of
// 176, which is why these four and not a finer ladder: each press is a session's worth of work, not a nudge.
const GROSS_PRESETS = [1000, 750, 500, 250];

// ---- Review / park --------------------------------------------------------------------------------------------------------------
// The legacy screen's "1 2 3" (review-date.txt). Once a style has been ORDERED there is nothing left to decide about it this season,
// but it goes on reading as a re-order candidate until the delivery lands — noise on the exact list being worked down.
const PARK_MONTHS = [1, 2, 3] as const;

// Today as 'YYYY-MM-DD' in the BROWSER's own day. Built out of the local date parts rather than toISOString(), which converts to UTC
// first and would hand back yesterday's date all evening under BST. Compared as a string against review, which is ISO, so the ordering
// is exact and nothing is ever parsed into a Date.
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Is this style parked out of the working list right now? A review date in the past is spent — the style is due again and belongs back
// on the sheet — which is exactly the test the owner's own performance query makes (check_stock IS NULL OR check_stock <= today).
function isParked(r: BirkStockRow, today: string): boolean {
  return r.review !== null && r.review > today;
}

// 'Oct' from '2026-10-01', for the marker on a parked row. Built off the string's own month digits: `new Date('2026-10-01')` is parsed
// as UTC midnight and prints as September in any timezone west of London.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parkedLabel(review: string): string {
  const m = Number(review.slice(5, 7));
  return MONTH_ABBR[m - 1] ?? review;
}

// Whole pounds with thousands separators. The figure is an indication, not accounting (see the route header), so pence would be
// false precision on a number whose whole job is to rank and to be compared against a round band.
function money(v: number): string {
  return v.toLocaleString('en-GB');
}

// Stable empty list — feeds a useMemo, so a fresh [] each render would rebuild the search index every time.
const NO_ROWS: BirkStockRow[] = [];

// The text a filter step matches against. Built once per fetch and cached, lowercased so each step is a plain indexOf.
// No Amazon SKUs here (unlike Inventory): Birkenstock is not sold on Amazon, so there is nothing to paste.
function haystack(r: BirkStockRow): string {
  return `${r.title || ''} ${r.groupid} ${r.segment || ''}`.toLowerCase();
}

interface IndexedRow { row: BirkStockRow; hay: string }

// The displayed stock for a row in the current mode: shelf only, or shelf + still to come.
function stockOf(r: BirkStockRow, mode: Mode): number {
  return mode === 'live' ? r.live : r.live + r.incoming;
}

// The displayed stock for ONE size in the current mode. The two maps share a key set (the server builds them off the same size list),
// so an absent key means the style does not carry that size at all — which is a blank cell, not a zero.
function sizeStockOf(r: BirkStockRow, size: string, mode: Mode): number | null {
  if (!(size in r.liveSizes)) return null;
  const live = r.liveSizes[size] || 0;
  return mode === 'live' ? live : live + (r.incomingSizes[size] || 0);
}

// THE SIZE BANDING — the thing that makes the legacy screen readable and the first cut of this one not (owner, 2026-09-04). Fourteen
// columns of loose digits with nothing between them force the eye to count across to work out which size a 3 belongs to. Shading every
// other column turns them into pairs you can land on. It is a HALF-TRANSPARENT slate rather than a solid one so the row's hover
// highlight still shows through the banded cells — a solid fill would leave the shaded columns unlit and break the row apart.
//
// This banding REPLACES the per-cell shading the first cut used to mark "the style never carried this size". That distinction lost to
// this one: it produced ragged grey blocks in the middle of the grid that read as data, and the row's own alignment already says a
// missing size is missing. A style's real size range is a question for the drill, not for a cell tint.
function sizeBand(i: number): string {
  return i % 2 === 1 ? 'bg-slate-400/10' : '';
}

// Horizontal padding for a size cell. The LAST column gets extra on its right so 48 is not jammed against the table's edge (owner,
// 2026-09-04) — a column touching the border reads as though it has been cut off mid-grid.
function cellPad(i: number, count: number): string {
  return i === count - 1 ? 'pl-1 pr-3' : 'px-1';
}

// EVERY TITLE STARTS "Birkenstock " — on a screen that is entirely Birkenstock, that prefix is 12 characters of nothing, repeated 176
// times, and it was pushing the part that actually distinguishes one row from another (the model, the colour, the fit) out past the
// truncation (owner, 2026-09-04). Stripped for display only; the underlying title is untouched and still what the filter matches, so
// typing BIRKENSTOCK in Contains behaves exactly as it did.
function styleName(title: string | null): string {
  return (title || '').replace(/^birkenstock\s+/i, '');
}

// ---- The Planner ----------------------------------------------------------------------------------------------------------------
// THE MONTHS RUN SEPTEMBER -> AUGUST, not January -> December (the legacy Planner's order, and the owner's). That is the Birkenstock
// SEASON year: the book is placed against a season, and reading it in calendar order splits one season across the top and bottom of
// the panel. birktracker.due carries no year at all — a bare 'MAY' — so this order is the only thing that puts a delivery in context.
const SEASON: { due: string; label: string }[] = [
  { due: 'SEP', label: 'September' }, { due: 'OCT', label: 'October' },  { due: 'NOV', label: 'November' },
  { due: 'DEC', label: 'December' },  { due: 'JAN', label: 'January' },  { due: 'FEB', label: 'February' },
  { due: 'MAR', label: 'March' },     { due: 'APR', label: 'April' },    { due: 'MAY', label: 'May' },
  { due: 'JUN', label: 'June' },      { due: 'JUL', label: 'July' },     { due: 'AUG', label: 'August' },
];
const SEASON_POS = new Map(SEASON.map((m, i) => [m.due, i]));
// A due code we do not recognise — including the blank a legacy free-text column can always hold — sorts to the END and keeps its raw
// value as its label. It must never be dropped: those units are real and are inside the FULL total the operator is reading.
function monthLabel(due: string): string {
  return SEASON.find((m) => m.due === due)?.label ?? (due || 'Unscheduled');
}
function monthPos(due: string): number {
  return SEASON_POS.get(due) ?? SEASON.length;
}

// Apply every text step in order (ANDed). Kept as a standalone function, like Inventory's, so the on-screen list and the "would this
// find anything?" probe in onFind can never drift apart.
function applySteps(indexed: IndexedRow[], steps: FilterStep[]): IndexedRow[] {
  let out = indexed;
  for (const s of steps) {
    const t = s.term.toLowerCase();
    // Both operators are a plain substring over the whole haystack — the legacy PowerBuilder rule, and the same pair of lines
    // Inventory runs. CONTAINS has to be loose because operators type partials ("ARIZ"), and DOES NOT CONTAIN has to be its exact
    // mirror or the two boxes stop being opposites (see the 2026-08-25 note in the Inventory page).
    out = s.op === 'has' ? out.filter((x) => x.hay.includes(t)) : out.filter((x) => !x.hay.includes(t));
  }
  return out;
}

// A sortable column heading. The arrow only appears on the active key — an indicator on every column is three arrows pointing at
// nothing. Declared at MODULE level, not inside the page: a component created during render is a new component type every render, so
// React throws its state away each time (and the lint rule that says so is right — it was written inside the page at first).
//
// `align` has to match the cells below it: a heading that centres itself over right-aligned figures reads as a different column from
// the one it labels, which is exactly what went wrong with Sold 365 / Stock in the first cut (owner, 2026-09-04). The button is
// `flex w-full` so the alignment applies to the button's own contents, not just to the th's inline box.
function SortTh({ label, colKey, align = 'left', sortKey, sortDir, onSort }: {
  label: string;
  colKey: SortKey;
  align?: 'left' | 'right';
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === colKey;
  const arrow = active ? 'text-slate-500' : 'text-transparent';
  return (
    <th className="sticky top-0 z-10 bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide">
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={`flex w-full items-center gap-1 hover:text-slate-900 ${align === 'right' ? 'justify-end' : ''} ${
          active ? 'text-slate-900' : 'text-slate-500'
        }`}
      >
        {/* THE ARROW SITS ON THE OUTSIDE OF THE LABEL — left of it on a right-aligned column (owner, 2026-09-04). It is rendered even
            when this is not the active key (transparent, to stop the heading jumping as the sort moves), so it always occupies its
            width. On a right-aligned heading that reserved width sat BETWEEN the label and the column edge and pushed the text a few
            pixels left of the figures below it, which is exactly the misalignment justify-end was supposed to fix. */}
        {align === 'right' && <span className={arrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
        <span className={align === 'right' ? 'pr-1.5' : ''}>{label}</span>
        {align !== 'right' && <span className={arrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

export default function BirkenstockPage() {
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const [steps, setSteps] = useState<FilterStep[]>([]);
  const [mode, setMode] = useState<Mode>('live');
  const [sortKey, setSortKey] = useState<SortKey>('groupid');
  // The gross threshold: one of the bands, or null for no threshold at all.
  const [minGross, setMinGross] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // THE PLANNER — which style's month breakdown is open, or null. ONE AT A TIME (owner's gesture is "I choose a line"): opening a
  // second closes the first, so the sheet never fills with panels and the row you are reading always has the grid around it.
  const [planned, setPlanned] = useState<string | null>(null);

  // SELECTION, kept apart from the planner (owner, 2026-09-04): clicking marks lines, a double click opens one's months. They are two
  // different jobs. It began as a single place-marker — reading a 14-column row of small digits means holding your place across the
  // width of the screen — and became a MULTI-selection when Cut arrived, because you cut a handful of lines, not one.
  //
  // WINDOWS RULES, because that is what the owner asked for and what his hands already do (2026-09-04):
  //   plain click  — this row alone; clicking the only marked row clears it (his earlier request, kept)
  //   ctrl-click   — add or remove one row, leaving the rest marked
  //   shift-click  — everything between the anchor and this row, in the order currently ON SCREEN
  // Nothing here is written to the database. Selection marks; Cut hides. Neither touches a product.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Where a shift-range measures FROM. Set by every plain and ctrl click, deliberately NOT moved by a shift-click: keeping it still is
  // what lets a range be stretched and shrunk from the same starting line, which is the behaviour a Windows list has.
  const [anchor, setAnchor] = useState<string | null>(null);

  // CUT — rows pushed out of the view by hand. A PURE DISPLAY FILTER (owner, 2026-09-04): nothing is written, nothing is remembered
  // past this visit. It exists because the text boxes cannot always express "not that one" without over-matching, and because working
  // a profit band means clearing away the lines already dealt with so the ones left are the ones still to decide.
  // NO RESTORE (owner's call): Reset brings everything back and that is the only undo he wants. A Restore button beside a Cut button
  // invites the cut to be treated as a decision to be reviewed, and it is not — it is housekeeping on a view.
  const [cut, setCut] = useState<Set<string>>(() => new Set());

  // Which park is in flight, so the three buttons can disable themselves for the round-trip. This is the only write on the screen and
  // it is not idempotent in a useful way — pressing 1 twice while the first is in the air would stamp the same date twice for nothing.
  const [parking, setParking] = useState<number | null>(null);
  const [parkError, setParkError] = useState<string | null>(null);

  // Today, fixed for the life of the page. A screen open across midnight would start disagreeing with the server about which styles are
  // due — a once-a-year edge whose only symptom is a row appearing after a refresh, which is what the operator would do anyway.
  const today = useMemo(() => todayIso(), []);

  const containsRef = useRef<HTMLInputElement>(null);

  // The whole catalogue, once. Re-read on Reset (which is the "start a fresh hunt" moment, so it doubles as refresh-from-DB — the
  // legacy screen's Reset did exactly this). `busy` rather than isLoading so a Reset re-fetch spins too.
  const { data, error: loadError, busy: loading, refresh: reload } = useApiQuery(['birk-stock'], () => getBirkStock());
  const rows: BirkStockRow[] = data?.rows ?? NO_ROWS;
  const error = loadError?.message ?? null;

  const indexed = useMemo(() => rows.map((r) => ({ row: r, hay: haystack(r) })), [rows]);

  // The open style's delivery months. Lazy and per style: `key === null` holds the fetch off entirely until a line is chosen, and SWR
  // caches per groupid, so re-opening a style the operator has already looked at is instant and costs the production DB nothing.
  const { data: planner, busy: plannerBusy } = useApiQuery(
    planned ? ['birk-planner', planned] : null,
    () => getBirkPlanner(planned as string),
  );
  // Season order is applied HERE, not in the route: the route returns what the DB grouped, and the order is a display decision that
  // belongs beside the SEASON table that defines it.
  const plannerMonths = useMemo(
    () => (planner?.groupid === planned ? [...(planner?.months || [])].sort((a, b) => monthPos(a.due) - monthPos(b.due)) : []),
    [planner, planned],
  );

  // Every size any style carries, in numeric order — the grid's columns. Derived from the data rather than hard-coded 35..48: the
  // brand's range is stable today, but a column list that comes from skumap cannot silently drop a size the buyer has just added.
  const sizeCols = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.liveSizes)) set.add(k);
    return [...set].sort((a, b) => Number(a) - Number(b));
  }, [rows]);

  // Text steps first, then the profit band. The band is NOT a step chip you stack: it is one setting with one current value, and
  // pressing another replaces it. A style with profit = null (no sales in the window, or a cost we cannot read) fails every band —
  // deliberately: this filter's question is "which styles have made at least this much", and an unknown has not answered it.
  const filtered = useMemo(() => {
    let out = applySteps(indexed, steps).map((x) => x.row);
    // THE PARK FILTER RIDES ON THE PROFIT BAND (owner, 2026-09-04), and this pairing is the whole feature:
    //   a band is on  -> you are WORKING the sheet, deciding what to order. A style already ordered is settled, and leaving it in
    //                    means re-reading the same red row every pass. Parked styles drop out.
    //   ALL           -> you are LOOKING at the sheet — the full picture of the brand, what is parked included. Nothing is hidden.
    // So the same row is present or absent depending on which of those two things you are doing, which is right: the park is a
    // statement about the working list, not about the style. It also means nothing can be lost behind it — press All and it is there.
    if (minGross !== null) {
      out = out.filter((r) => r.gross !== null && r.gross >= minGross && !isParked(r, today));
    }
    // Cut LAST, so the "N cut" count below counts rows the operator actually pushed out of THIS view rather than rows a text step, a
    // profit band or a park had already removed for him.
    if (cut.size > 0) out = out.filter((r) => !cut.has(r.groupid));
    return out;
  }, [indexed, steps, minGross, cut, today]);

  // How many styles the band is currently holding back BECAUSE THEY ARE PARKED — reported next to the count so a short list is never
  // a mystery. Without it the only evidence of the park would be styles silently missing from a list the operator is trusting.
  const parkedHidden = useMemo(() => {
    if (minGross === null) return 0;
    return applySteps(indexed, steps)
      .map((x) => x.row)
      .filter((r) => r.gross !== null && r.gross >= minGross && isParked(r, today) && !cut.has(r.groupid)).length;
  }, [indexed, steps, minGross, cut, today]);

  // How many of the rows this filter WOULD show have been cut by hand — the only feedback the cut gives, and enough of it: it says the
  // list is short because you shortened it, without offering to undo a thing the owner undoes with Reset.
  const cutInView = useMemo(() => {
    if (cut.size === 0) return 0;
    let out = applySteps(indexed, steps).map((x) => x.row);
    if (minGross !== null) out = out.filter((r) => r.gross !== null && r.gross >= minGross && !isParked(r, today));
    return out.filter((r) => cut.has(r.groupid)).length;
  }, [indexed, steps, minGross, cut, today]);

  // Sort what is on screen. groupid is the stable tie-break (always ascending) so equal rows keep a fixed order instead of jittering.
  // Sorting on `stock` follows the MODE — sort by what you are looking at, or the order stops matching the numbers under it.
  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let d: number;
      if (sortKey === 'groupid') d = a.groupid.localeCompare(b.groupid);
      else if (sortKey === 'sold365') d = a.sold365 - b.sold365;
      // An unknown profit sorts as the lowest there is, so the styles with no answer sit at the bottom of the descending sort the
      // operator actually uses, rather than floating to the top of it as a 0 would if the two were conflated. It also has to sit below
      // the styles that genuinely made a loss, which are real rows and are not unknowns.
      else if (sortKey === 'gross') d = (a.gross ?? Number.NEGATIVE_INFINITY) - (b.gross ?? Number.NEGATIVE_INFINITY);
      else d = stockOf(a, mode) - stockOf(b, mode);
      if (d === 0) return a.groupid.localeCompare(b.groupid);
      return d * dir;
    });
  }, [filtered, sortKey, sortDir, mode]);

  const onSort = useCallback((key: SortKey) => {
    // Two plain setState calls off the CURRENT key, never nested in an updater — nesting made the reverse toggle fire twice under
    // StrictMode's double-invoke on the Inventory screen and appear to do nothing.
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(DEFAULT_DIR[key]); }
  }, [sortKey]);

  // Set (or clear) the threshold. Applied on the press, not on Find — there is nothing to commit, it is one setting with one current
  // value. Picking a band also swings the sort to gross, highest first: a budget is spent from the top down, so the list has to arrive
  // in that order. Clearing it leaves the sort alone — by then the operator is working the list and re-sorting under them is rude.
  const applyGross = useCallback((v: number | null) => {
    setMinGross(v);
    if (v === null) return;
    setSortKey('gross');
    setSortDir('desc');
  }, []);

  // The groupids in the order they are ON SCREEN. A shift-range has to measure down the visible order, not down the underlying data:
  // sort by profit, shift-click two rows, and the range you get must be the block of rows your eye traced between them.
  const order = useMemo(() => sorted.map((r) => r.groupid), [sorted]);

  // One click handler for all three gestures — they differ only in which rows come out marked, so splitting them across handlers would
  // put the same decision in three places.
  const onRowClick = useCallback((e: React.MouseEvent, groupid: string) => {
    if (e.shiftKey && anchor) {
      const from = order.indexOf(anchor);
      const to = order.indexOf(groupid);
      // The anchor can have left the view since it was set (cut away, or filtered out). Fall through to a plain click rather than
      // guessing at a range with one end missing — a silently wrong range is worse than a range that did not happen.
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setSelected(new Set(order.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(groupid)) next.delete(groupid); else next.add(groupid);
        return next;
      });
      setAnchor(groupid);
      return;
    }
    // Plain click: this row alone. Clicking the ONLY marked row clears it (owner, 2026-09-04) — the same click puts the mark down and
    // picks it back up, so a mark never has to be moved somewhere else just to be rid of it. With several rows marked, a plain click
    // collapses to the one clicked, which is the Windows behaviour and the one the hand expects.
    setSelected((prev) => (prev.size === 1 && prev.has(groupid) ? new Set() : new Set([groupid])));
    setAnchor(groupid);
  }, [anchor, order]);

  // CUT: push the marked rows out of the view and drop the marks with them. Clearing the selection is the owner's instruction and it is
  // also the only sane end state — the rows those marks pointed at are gone from the screen, so a selection that survived would be a
  // set of highlights on nothing, and the next Cut would do nothing while looking like it should.
  const onCut = useCallback(() => {
    if (selected.size === 0) return;
    setCut((prev) => new Set([...prev, ...selected]));
    // The open planner panel hangs off a row. Cut that row and the panel would be left floating under whatever slid up into its place.
    setPlanned((cur) => (cur !== null && selected.has(cur) ? null : cur));
    setSelected(new Set());
    setAnchor(null);
  }, [selected]);

  // PARK the marked styles for N months — the screen's ONE write. Reloads the whole list afterwards rather than patching the rows in
  // place: it is a single cheap call, the filters and cuts are client state and survive it untouched, and it means what is on screen
  // came from the database rather than from an optimistic guess about what the database now says.
  const onPark = useCallback(async (months: 1 | 2 | 3) => {
    if (selected.size === 0 || parking !== null) return;
    setParking(months);
    setParkError(null);
    const res = await setBirkReview([...selected], months);
    setParking(null);
    if (!res.success) {
      // The marks are LEFT ALONE on a failure. Nothing was parked, so the operator can read the message and press again without having
      // to re-select the batch they had just built up with shift-clicks.
      setParkError(res.error || 'Could not set the review date');
      return;
    }
    setParkError(null);
    setSelected(new Set());
    setAnchor(null);
    reload();
  }, [selected, parking, reload]);

  // FIND: turn whatever is in the boxes into steps, then clear the boxes. Blank boxes are ignored.
  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const next: FilterStep[] = [];
    if (contains.trim()) next.push({ op: 'has', term: contains.trim() });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    if (next.length === 0) return;

    // START FRESH WHEN THE NARROWING WOULD EMPTY THE LIST — Inventory's rule, and it belongs here for the same reason: the operator
    // uses the box to start a NEW hunt as often as to narrow ("ARIZONA" ... then "GIZEH"), and stacked on the old steps that can only
    // find nothing. Probe the merged steps first; if they match nothing AND something was already applied, run the new terms alone.
    // Probing rather than reacting to an empty render means the dead intermediate state never paints.
    const startFresh = steps.length > 0 && applySteps(indexed, [...steps, ...next]).length === 0;
    setSteps(startFresh ? next : [...steps, ...next]);
    setContains('');
    setNotContains('');
    containsRef.current?.focus();
  }

  // Reset = the whole catalogue again, sorted as it opens, AND a fresh read from the DB (as in PowerBuilder). The mode is view state
  // the operator has chosen deliberately, so it deliberately survives.
  function onReset() {
    setSteps([]);
    setContains('');
    setNotContains('');
    setMinGross(null);
    setSortKey('groupid');
    setSortDir('asc');
    setPlanned(null);
    setSelected(new Set());
    setAnchor(null);
    setCut(new Set());
    setParkError(null);
    reload();
    containsRef.current?.focus();
  }

  return (
    <AppShell title="Birkenstock">
      {/* ---- Command bar ------------------------------------------------------------------------------------------------------
          The two filter boxes and the LIVE/FULL switch share one bar, because they are the two halves of one gesture: narrow to the
          model you are thinking about, then flip the switch to see whether it is already ordered. */}
      <div className="mb-4">
        <form onSubmit={onFind} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Contains</label>
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                <input
                  ref={containsRef}
                  value={contains}
                  onChange={(e) => setContains(e.target.value.toUpperCase())}
                  autoFocus
                  placeholder="e.g. ARIZONA"
                  className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                />
              </div>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
              <input
                value={notContains}
                onChange={(e) => setNotContains(e.target.value.toUpperCase())}
                placeholder="e.g. EVA"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
            </div>
            {/* ---- The gross threshold ------------------------------------------------------------------------------------------
                THE BEST SELLERS FIRST, THEN DOWNWARDS (owner, 2026-09-04). Four fixed bands and no free entry — the number is a
                BUDGET TIER, not a search term: press 1000 and the sheet becomes the styles worth ordering first, spend against it,
                press 750 and the tier just done stays above the new arrivals (the sort is gross-descending, so the list only ever
                grows downwards). The free-entry box that was here first came out at the owner's call (2026-09-04): an exact figure
                implies this number is precise enough to cut on, and it is not — it is an indication, and stepping down in bands is
                the whole of how it is used. Sitting in the same bar as the text boxes, because narrowing to a model and narrowing to
                a tier are the same gesture and get combined constantly. */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Profit at least</label>
              <div className="inline-flex rounded-md border border-slate-300 p-0.5">
                {GROSS_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => applyGross(v)}
                    title={`Only the styles that have made at least £${money(v)} gross profit in the last 365 days`}
                    className={`rounded px-3 py-1.5 text-sm font-medium tabular-nums ${
                      minGross === v ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {money(v)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => applyGross(null)}
                  title="Drop the threshold — every style again"
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    minGross === null ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  All
                </button>
              </div>
            </div>

            {/* Find is a plain white button, matching Reset (owner, 2026-09-04). The filled brand-blue submit that every other screen
                uses was the loudest thing on a page whose whole job is a grid of small numbers, and it pulled the eye to a button that
                is pressed once. The pair reads as what it is: two neutral controls sitting beside the boxes they act on. */}
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Find
            </button>
            <button
              type="button"
              onClick={onReset}
              title="Clear the search and re-read stock from the database"
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Reset
            </button>
            {/* CUT sits next to Reset because Reset is its undo — the two belong to the same idea and there is no third button
                between them. It is disabled with nothing marked rather than hidden: a control that appears only once you have
                already done the thing that enables it teaches nobody it is there. The count is on the face so a mis-shift-click
                (a range of 40 when you meant 4) is caught BEFORE it is pressed, which is the only place it can be caught — there
                is no restore. */}
            <button
              type="button"
              onClick={onCut}
              disabled={selected.size === 0}
              title={
                selected.size === 0
                  ? 'Mark rows first — click, ctrl-click to add, shift-click for a range'
                  : `Hide ${selected.size} marked ${selected.size === 1 ? 'row' : 'rows'} from the view (Reset brings everything back)`
              }
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-white"
            >
              Cut{selected.size > 0 ? ` ${selected.size}` : ''}
            </button>

            {/* ---- PARK: the legacy "1 2 3" -------------------------------------------------------------------------------------
                Pressed after an order has actually been placed with Birkenstock: those styles are settled for the season and should
                stop reading as re-order candidates. Three buttons and no free entry for the same reason the profit bands have none —
                it is a coarse "ask me again next season-ish", and the legacy screen has run on exactly these three for years.
                They sit beside Cut because the two are the same motion (mark rows, then do something to them), and apart from it
                because only ONE of them writes to the database. Hence the label above them, which Cut does not have. */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Ordered — park (months)</label>
              <div className="inline-flex rounded-md border border-slate-300 p-0.5">
                {PARK_MONTHS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onPark(m)}
                    disabled={selected.size === 0 || parking !== null}
                    title={
                      selected.size === 0
                        ? 'Mark the styles you have ordered first'
                        : `Stamp ${selected.size} style${selected.size === 1 ? '' : 's'} as reviewed — back on the working list on the 1st, ${m} month${m === 1 ? '' : 's'} from now`
                    }
                    className="rounded px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  >
                    {parking === m ? '…' : m}
                  </button>
                ))}
              </div>
            </div>

            {/* The switch. A two-segment control rather than two buttons: it is one setting with two states, and it has to be obvious
                at a glance WHICH numbers are on screen — every figure in the grid changes meaning with it. */}
            <div className="ml-auto flex items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Showing</label>
                <div className="inline-flex rounded-md border border-slate-300 p-0.5">
                  {(['live', 'full'] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      title={m === 'live' ? 'On the shelf now, ready to sell' : 'On the shelf plus everything still to come from Birkenstock'}
                      className={`rounded px-4 py-1.5 text-sm font-medium ${
                        mode === m ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {m === 'live' ? 'Live' : 'Full'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Applied steps + how many styles are in front of you. NO COLUMN TOTALS (owner, 2026-09-04 — they were here and came out):
              summed Sold 365 / Live / On order across a filtered list is a number nobody acts on, and this strip is the space the
              screen's real controls will want. Keep it to what the filter itself has to report.
              The step chips are display-only (as in the legacy screen and in Inventory): to undo one, Reset and search again. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
            <span className="whitespace-nowrap text-slate-500">
              <span className="font-semibold text-slate-800">{sorted.length}</span>
              <span className="text-slate-400">{steps.length > 0 ? ` of ${rows.length} styles` : ' styles'}</span>
            </span>
            {selected.size > 0 && (
              <span className="whitespace-nowrap text-slate-500">
                <span className="font-semibold text-slate-800">{selected.size}</span> marked
              </span>
            )}
            {parkedHidden > 0 && (
              <span className="whitespace-nowrap text-slate-400">
                {parkedHidden} parked <span className="text-slate-300">· press All to see them</span>
              </span>
            )}
            {cutInView > 0 && (
              <span className="whitespace-nowrap text-slate-400">
                {cutInView} cut <span className="text-slate-300">· Reset restores</span>
              </span>
            )}
            {minGross !== null && (
              <span className="whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                profit <span className="font-medium text-slate-800">£{money(minGross)}+</span>
              </span>
            )}
            {steps.map((s, i) => (
              <span key={i} className="whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                {s.op === 'has' ? 'contains' : 'not'} <span className="font-medium text-slate-800">{s.term}</span>
              </span>
            ))}
          </div>
        </form>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {/* A failed park keeps its own line. It is the only thing on this screen that can fail while the data on it is still perfectly
          good, so folding it into the load error above would blank a grid that is fine. The marks are still up; pressing again is the
          whole recovery. */}
      {parkError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{parkError}</div>
      )}

      {loading && rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">No styles match.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          {/* FIXED LAYOUT, EXPLICIT WIDTHS (owner, 2026-09-04 — the first cut got both of these wrong). Auto layout sized every column
              to its own widest cell, so a column holding a "10" came out wider than one holding a "1" and the size figures stopped
              lining up down the grid — which is fatal here, because the whole point of the row is reading the size curve ACROSS it.
              table-fixed plus a colgroup makes every size column exactly the same width whatever lands in it, and hands the leftover
              width to Title (the only column that can absorb it).
              The min-width is a floor for narrow screens: below it the grid scrolls sideways as a unit rather than squeezing the last
              sizes off the right-hand edge.

              WHOLE PIXELS, NOT REMS (owner, 2026-09-04 — a permanent hairline scrollbar under the grid). Rem widths landed on
              fractions (2.1rem = 33.6px), and eighteen of those rounded up to a table a pixel or two wider than the box holding it,
              which is enough for a scrollbar to appear on a grid that visibly fits. Integer px across every fixed column removes the
              rounding entirely; the Style column is the one left auto, so it absorbs whatever is left over. */}
          <table className="w-full min-w-[984px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[140px]" />
              <col />
              <col className="w-[72px]" />
              <col className="w-[84px]" />
              <col className="w-[72px]" />
              {sizeCols.map((sz) => (
                <col key={sz} className="w-[32px]" />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <SortTh label="Groupid" colKey="groupid" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th className="sticky top-0 z-10 bg-slate-100 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Style
                </th>
                <SortTh label="Sold 365" colKey="sold365" align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Profit" colKey="gross" align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Stock" colKey="stock" align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                {sizeCols.map((sz, i) => (
                  <th
                    key={sz}
                    className={`sticky top-0 z-10 bg-slate-100 py-2 text-center text-xs font-semibold text-slate-500 ${cellPad(i, sizeCols.length)} ${sizeBand(i)}`}
                  >
                    {sz}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const stock = stockOf(r, mode);
                // The red rule, in one line: sold more than we hold, and we hold something. See the header block for why a zero row
                // stays blank rather than going the reddest of all.
                const short = stock > 0 && stock < r.sold365;
                const open = planned === r.groupid;
                return (
                  <Fragment key={r.groupid}>
                  {/* THE WHOLE ROW IS THE PLANNER BUTTON. The legacy screen needed a line selected and then a Planner button pressed;
                      here the row is the only thing on it to click, so making the click itself open the month breakdown removes the
                      button entirely. The caret is what says so — a row with no affordance at all is a row nobody clicks. */}
                  <tr
                    onClick={(e) => onRowClick(e, r.groupid)}
                    onDoubleClick={() => setPlanned(open ? null : r.groupid)}
                    title="Click to mark · ctrl-click to add · shift-click for a range · double-click for when its ordered stock is due"
                    // select-none matters more than it looks: without it a shift-click drags a text selection across the grid and the
                    // sheet ends up half-highlighted blue underneath the marks it is supposed to be showing.
                    className={`cursor-pointer select-none border-b border-slate-100 last:border-0 ${
                      open || selected.has(r.groupid) ? 'bg-slate-200/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs text-slate-600">
                      {open ? (
                        <ChevronDownIcon className="mr-1 inline h-3 w-3 text-slate-500" />
                      ) : (
                        <ChevronRightIcon className="mr-1 inline h-3 w-3 text-slate-300" />
                      )}
                      {r.groupid}
                    </td>
                    <td className="truncate px-2 py-1.5 text-slate-800" title={r.title || ''}>
                      {styleName(r.title) || <span className="text-slate-400">—</span>}
                      {/* A parked row is only ever seen on ALL (a band filters it out), and there it has to say WHY it looks settled
                          — otherwise the sheet shows a red under-stocked style with no hint that it has already been ordered and
                          dealt with. The month it comes back is the useful half of the date; the full date is on the hover. */}
                      {isParked(r, today) && (
                        <span
                          className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 align-middle text-[10px] font-medium text-slate-500"
                          title={`Ordered — parked off the working list until ${r.review}`}
                        >
                          {parkedLabel(r.review as string)}
                        </span>
                      )}
                    </td>
                    {/* EVERY figure in these two columns carries the SAME px-1.5 inset — the plain ones as well as the one inside a
                        red block — so a short row's digits sit on exactly the same right edge as an unshort row's. Without it the
                        block's own padding moved its number a few pixels left of the column. The headings above carry the same inset
                        (see SortTh's `align`). */}
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                      <span className="inline-block px-1.5">{r.sold365 || ''}</span>
                    </td>
                    {/* GROSS PROFIT, AND IT IS DRAWN AS AN INDICATION — lighter than Sold 365 and Stock, which are counted units.
                        (average sold price EX VAT − cost) × units over the same year. The VAT comes out because our cost is net of it
                        and the shop price is not, so leaving it in was comparing two different things (owner, 2026-09-04). Selling
                        expenses stay IN, also his call: they are near-flat per unit, so taking them out would move every row by about
                        the same amount and barely change the order — which is what this column is for. It ranks; it is not a P&L.
                        A dash is a style with no sales in the window or a cost we could not read; it is not a zero, and a NEGATIVE is
                        real (a handful of styles have sold below cost) and is shown as it stands. */}
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                      <span className="inline-block px-1.5" title={r.gross === null ? 'No sales in the last 365 days, or no usable cost' : 'Gross profit over 365 days: (sold price ex VAT − cost) × units. Selling expenses are not deducted.'}>
                        {r.gross === null ? <span className="text-slate-300">—</span> : money(r.gross)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800">
                      {/* THE RED IS A BLOCK AROUND THE NUMBER, NOT A FILLED COLUMN (owner, 2026-09-04). Filling the whole cell made
                          Stock read as a highlighted COLUMN running down the sheet — the eye followed the band instead of picking out
                          the handful of rows that are actually short. A tight block on the figure is what the legacy screen does, and
                          it is legible against the size banding beside it. */}
                      <span
                        className={`inline-block rounded px-1.5 ${short ? 'bg-red-600 text-white' : ''}`}
                        title={short ? `Sold ${r.sold365} in 365 days, holding ${stock}` : undefined}
                      >
                        {stock || ''}
                      </span>
                    </td>
                    {sizeCols.map((sz, i) => {
                      const q = sizeStockOf(r, sz, mode);
                      return (
                        <td
                          key={sz}
                          className={`py-1.5 text-center tabular-nums text-slate-700 ${cellPad(i, sizeCols.length)} ${sizeBand(i)}`}
                        >
                          {q ? q : ''}
                        </td>
                      );
                    })}
                  </tr>

                  {/* ---- THE PLANNER PANEL: one extra row per delivery month, drawn INSIDE the grid ---------------------------------
                      Not a modal and not a nested table (owner chose "expand under the row"). Because the month rows are rows of the
                      SAME table, every figure lands under the size column it belongs to for free — a June 2 sits directly beneath the
                      38 it is a 38 of, and directly beneath the stock we hold in that size, which is the comparison the whole panel
                      exists to make. A nested table would have had to re-derive the parent's column widths and would drift the first
                      time one changed.
                      Every figure here is STILL TO COME (requested − arrived), so a month totals up into exactly what the FULL switch
                      adds to the Stock cell above. A delivery that has fully landed is therefore absent: those units are on the shelf,
                      and the grid row above is already counting them. */}
                  {open && plannerBusy && plannerMonths.length === 0 && (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={5 + sizeCols.length} className="px-8 py-2 text-xs text-slate-400">Loading…</td>
                    </tr>
                  )}
                  {open && !plannerBusy && plannerMonths.length === 0 && (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={5 + sizeCols.length} className="px-8 py-2 text-xs text-slate-500">
                        Nothing still to come — no outstanding Birkenstock order for this style.
                      </td>
                    </tr>
                  )}
                  {open && plannerMonths.map((m) => (
                    <tr key={m.due} className="border-b border-slate-100 bg-slate-50 text-slate-600">
                      <td className="px-2 py-1 text-right text-[11px] uppercase tracking-wide text-slate-400">Due</td>
                      <td className="truncate px-2 py-1 text-xs font-medium text-slate-700">{monthLabel(m.due)}</td>
                      <td className="px-2 py-1" />
                      <td className="px-2 py-1" />
                      {/* The month's total sits under STOCK, the column it ADDS TO — and so it is drawn in LIVE only (owner,
                          2026-09-04). In LIVE the Stock cell above holds shelf stock alone, so "+7" is news: it is the arithmetic
                          between what you have and what you will have. In FULL that seven is already inside the number above it, and
                          printing it again beneath invites it to be added twice. The per-size figures stay in both modes — they are
                          the month's SHAPE, which no single total can carry. */}
                      <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums text-slate-700">
                        {mode === 'live' && <span className="inline-block px-1.5">+{m.units}</span>}
                      </td>
                      {sizeCols.map((sz, i) => (
                        <td
                          key={sz}
                          className={`py-1 text-center text-xs tabular-nums text-slate-600 ${cellPad(i, sizeCols.length)} ${sizeBand(i)}`}
                        >
                          {m.sizes[sz] ? m.sizes[sz] : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
