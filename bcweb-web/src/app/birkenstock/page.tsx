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
title + groupid + segment, each term stacking another step onto what is already on screen, Reset returning the whole list and
re-reading from the DB. It is the gesture the operator has worked to for years, and a second dialect of it on a second screen would be
worse than no filter at all. The ONE divergence is that this screen has no Find button (owner, 2026-09-05): a term commits on Enter
and on leaving its box, so the button had nothing left to do. See commitSteps. The other thing NOT carried over is Inventory's worded
STOCK/SOLD commands — this grid is read by eye down a short list, and a "STOCK LESS 10" here would just be the red colouring twice.

THE PLANNER (owner, 2026-09-04 — the legacy screen's Planner button). Clicking any line opens its delivery months underneath it: one
row per month still to come, sizes under their own columns. It answers the question FULL raises but cannot settle — three units in May
and thirty-two in August is a different season from thirty-five in May. The months are rows of THIS table, not a nested one, so each
figure sits directly beneath the size it belongs to and beneath the stock we already hold in that size. See SEASON for why they run
September -> August, and routes/birk-planner.js for why a delivery that has fully landed shows nothing at all.

PROFIT, AND THE PERFORMANCE LEVELS. A gross-profit figure per style over the same 365 days — sold price ex VAT minus cost, times units — with four
fixed steps above the grid: Top / High / Mid / Low (£1000/750/500/250, cumulative) and All. It is an INDICATION, not accounting:
selling expenses are not deducted, at the owner's call, so it reads above the net figure on the Pricing screens. Its job is to order
the sheet, because the buy is made top down against a budget: work the top earners, then drop a level and work the next tier. Pressing
a level sorts by profit descending, so the list only ever grows downwards and the tier already dealt with stays above the new arrivals.
The steps wear NAMES rather than the pound figures they stand for (owner, 2026-09-05 — see GROSS_LEVELS); the figure is on the hover
and on the chip in the strip. See routes/birk-stock.js for the arithmetic and for the four gates of the owner's original query that
are deliberately NOT here.

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
// THE BANDS WEAR NAMES, NOT FIGURES (owner, 2026-09-05). The buttons used to read 1,000 / 750 / 500 / 250, which put four exact
// pounds-and-pence numbers in the loudest position on the screen and invited them to be read as a line the money actually falls on.
// They are not that: the column under them is an INDICATION (VAT out, selling expenses in), and its job is to rank. What the operator
// is doing when he presses one is choosing HOW FAR DOWN THE EARNERS to work today, so the buttons now say that and the threshold that
// implements it moves to the tooltip and to the chip in the strip below, where it is information rather than a claim to precision.
//
// They are cumulative, and the "at least" in the label is what says so: Mid is everything from £500 up, Top included. Named steps down
// a single ladder read that way naturally; four bare numbers side by side read as four separate buckets.
const GROSS_LEVELS: { label: string; min: number }[] = [
  { label: 'Top', min: 1000 },
  { label: 'High', min: 750 },
  { label: 'Mid', min: 500 },
  { label: 'Low', min: 250 },
];
// The name for a threshold, for the chip in the count strip — which shows both, because once a level is ON, the number behind it is
// the useful half ("what am I working to?") and no longer a button label competing for the eye.
function grossLabel(min: number): string {
  return GROSS_LEVELS.find((l) => l.min === min)?.label ?? `£${min}+`;
}

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
  return i === count - 1 ? 'pl-1 pr-2' : 'px-1';
}

// THE SEAM between the four columns that identify and total a style and the fourteen that hold its size curve. They are two different
// kinds of reading — one figure you look up, fourteen you scan across — and with nothing between them the eye ran off Stock straight
// into the 35s. One hairline on the first size column says where one ends and the other begins; the banding beside it does the rest.
function sizeEdge(i: number): string {
  return i === 0 ? 'border-l border-slate-200' : '';
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

// The heading row's bottom rule, drawn as an inset shadow rather than a border. The table is `border-separate` (see the table tag for
// why), and under border-separate a border declared on a <tr> is not painted at all — so the heading rule has to live on the cells.
// A shadow does that without adding a pixel to the cell's box, which would push the size columns out of alignment.
const HEAD_RULE = 'shadow-[inset_0_-1px_0_0_theme(colors.slate.300)]';

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
    <th className={`sticky top-0 z-10 whitespace-nowrap bg-slate-100 px-2 py-2 text-xs font-semibold uppercase tracking-wide ${HEAD_RULE}`}>
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

  // NO FIND BUTTON (owner, 2026-09-05). A box you type a search into and then press Enter on does not need a button beside it saying
  // so, and this one was taking a slot in the busiest row of the card to be pressed once per hunt. What replaces it is not "press
  // Enter and hope": the terms commit on ENTER **and on leaving the box**, so tabbing from Contains to Does not contain applies the
  // first one on the way past, and clicking straight into the grid applies what you just typed rather than quietly dropping it. That
  // is the behaviour the button was standing in for, and it is the one gesture that cannot leave a term stranded in a box.
  //
  // A blur-commit does mean tabbing between the two boxes lands them as TWO steps where the button made one. The list is identical —
  // steps are ANDed — and two chips saying `contains ARIZONA` `not EVA` is if anything the truer account of what was asked for.
  function commitSteps(next: FilterStep[]) {
    if (next.length === 0) return;

    // START FRESH WHEN THE NARROWING WOULD EMPTY THE LIST — Inventory's rule, and it belongs here for the same reason: the operator
    // uses the box to start a NEW hunt as often as to narrow ("ARIZONA" ... then "GIZEH"), and stacked on the old steps that can only
    // find nothing. Probe the merged steps first; if they match nothing AND something was already applied, run the new terms alone.
    // Probing rather than reacting to an empty render means the dead intermediate state never paints.
    const startFresh = steps.length > 0 && applySteps(indexed, [...steps, ...next]).length === 0;
    setSteps(startFresh ? next : [...steps, ...next]);
    // Clear ONLY the boxes this commit actually took a term from, and DO NOT move the focus. Both matter now that a blur can commit:
    // pulling the caret back to Contains as you tab away from it would fight the very keystroke that fired the commit, and clearing
    // the other box would swallow a term the operator had already typed into it.
    if (next.some((s) => s.op === 'has')) setContains('');
    if (next.some((s) => s.op === 'not')) setNotContains('');
  }

  // ENTER commits whatever is in both boxes at once.
  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const next: FilterStep[] = [];
    if (contains.trim()) next.push({ op: 'has', term: contains.trim() });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    commitSteps(next);
  }

  // Leaving a box commits that box alone — tab, click into the grid, click Reset, alt-tab away. A term typed and left behind is a
  // filter the operator believes is on, so there is no state in which one sits in a box doing nothing.
  function commitBox(op: 'has' | 'not', value: string) {
    if (value.trim()) commitSteps([{ op, term: value.trim() }]);
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
          Everything the screen can do sits in one card, in TWO ROWS THAT MEAN DIFFERENT THINGS (2026-09-05):

            ROW 1 — WHAT IS ON THE SHEET. Contains / Does not contain / Profit at least, and Reset; the LIVE/FULL switch closes the
                    row on the right. Every control here changes which styles you are looking at, or which stock the figures are, and
                    they get combined constantly (a model, then a level), so they stay on one line.
            ROW 2 — WHAT IS IN FRONT OF YOU, AND WHAT YOU DO WITH IT. The counts and the applied steps read from the left; Cut and the
                    park buttons sit on the right. Both act on marked rows, and neither changes the membership of the list.

          Row 2 is the OLD COUNT STRIP with the mark-actions moved onto its right-hand end, which is what closed the hole in the middle
          of the card (owner, 2026-09-05). Cut and park had a line of their own, and a line holding two small controls and a switch
          pinned to the far right is mostly empty space — the eye reads the gap as a missing control. Sharing a line with the counts
          gives them a right-hand end to sit against, and takes a row off the card's height into the bargain. */}
      <div className="mb-4">
        <form onSubmit={onFind} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          {/* ---- Row 1: what is on the sheet ------------------------------------------------------------------------------- */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Contains</label>
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                <input
                  ref={containsRef}
                  value={contains}
                  onChange={(e) => setContains(e.target.value.toUpperCase())}
                  onBlur={(e) => commitBox('has', e.target.value)}
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
                onBlur={(e) => commitBox('not', e.target.value)}
                placeholder="e.g. EVA"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
            </div>
            {/* ---- The profit level ---------------------------------------------------------------------------------------------
                THE BEST SELLERS FIRST, THEN DOWNWARDS (owner, 2026-09-04). Four fixed steps and no free entry — what is being chosen
                is a BUDGET TIER, not a search term: press Top and the sheet becomes the styles worth ordering first, spend against it,
                press High and the tier just done stays above the new arrivals (the sort is gross-descending, so the list only ever
                grows downwards). The free-entry box that was here first came out at the owner's call (2026-09-04), and the pound
                figures on the buttons followed it out a day later for the same reason — see GROSS_LEVELS.
                It sits in the same row as the text boxes because narrowing to a model and narrowing to a level are the same gesture
                and get combined constantly.
                A QUIET SEGMENTED CONTROL — a raised white segment on a recessed track, not a black fill (2026-09-05). The black
                belongs to LIVE/FULL and to nothing else: this control opens on ALL, so a filled dark chip made the screen's DEFAULT,
                do-nothing state the heaviest mark on the page, and two black blocks in one bar left neither of them meaning anything. */}
            <div>
              {/* PERFORMANCE, not "Profit at least" (owner, 2026-09-05). The label was the last place the control still argued it was
                  a numeric threshold — four named steps under a heading that says "at least" reads as a sum you are about to filter
                  on. What the operator is choosing is how well a style has to have DONE to be worth his time today, and Performance is
                  that in one word. The cumulative sense the old label carried moves into the tooltips, which now say each level
                  includes the ones above it. */}
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Performance</label>
              <div className="inline-flex rounded-md bg-slate-100 p-1">
                {GROSS_LEVELS.map((l) => (
                  <button
                    key={l.min}
                    type="button"
                    onClick={() => applyGross(l.min)}
                    title={
                      l.min === GROSS_LEVELS[0].min
                        ? `${l.label}: styles that have made at least £${money(l.min)} gross profit in the last 365 days`
                        : `${l.label} and above: styles that have made at least £${money(l.min)} gross profit in the last 365 days`
                    }
                    className={`rounded px-3 py-1.5 text-sm font-medium ${
                      minGross === l.min ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => applyGross(null)}
                  title="Every style, whatever it has made — and parked styles come back into the list"
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    minGross === null ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  All
                </button>
              </div>
            </div>

            {/* NO FIND BUTTON — the boxes commit on Enter and on the way out of them (see commitSteps). Reset stays: it is the undo
                for everything on this screen, it re-reads the database, and there is no keystroke that says it. */}
            <button
              type="button"
              onClick={onReset}
              title="Clear the search and re-read stock from the database"
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Reset
            </button>

            {/* The switch. A two-segment control rather than two buttons: it is one setting with two states, and it has to be obvious
                at a glance WHICH numbers are on screen — every figure in the grid changes meaning with it. It is THE ONE BOLD THING
                in this card, and it is bold on purpose: it is the only control here that changes what a number means rather than
                which numbers are shown, so it is the only one worth a filled chip. Everything else went quiet around it. */}
            <div className="ml-auto">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Showing</label>
              <div className="inline-flex rounded-md bg-slate-100 p-1">
                {(['live', 'full'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    title={m === 'live' ? 'On the shelf now, ready to sell' : 'On the shelf plus everything still to come from Birkenstock'}
                    className={`rounded px-4 py-1.5 text-sm font-medium ${
                      mode === m ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {m === 'live' ? 'Live' : 'Full'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ---- Row 2: what is in front of you, and what you do with it -------------------------------------------------------
              NO COLUMN TOTALS (owner, 2026-09-04 — they were here and came out): summed Sold 365 / Live / On order across a filtered
              list is a number nobody acts on. Keep it to what the filter itself has to report.
              The step chips are display-only (as in the legacy screen and in Inventory): to undo one, Reset and search again. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-sm">
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
            {/* The level's chip carries the POUNDS the buttons no longer say. Once a level is on, the threshold behind it stops being
                a label competing for the eye and becomes the thing you are working to, which is worth stating exactly. */}
            {minGross !== null && (
              <span className="whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                {grossLabel(minGross)} <span className="font-medium text-slate-800">£{money(minGross)}+</span>
              </span>
            )}
            {steps.map((s, i) => (
              <span key={i} className="whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                {s.op === 'has' ? 'contains' : 'not'} <span className="font-medium text-slate-800">{s.term}</span>
              </span>
            ))}
            {/* THE GESTURES, SAID ONCE, HERE (2026-09-05). They used to be a `title` on every row, which meant the browser's own
                tooltip surfaced over the grid a second after the mouse stopped anywhere on it — a black box across the size curve the
                operator had stopped to read. A grid is the one place a hover hint costs more than it gives. */}
            <span className="hidden whitespace-nowrap text-xs text-slate-400 xl:inline">
              Click to mark · shift-click for a range · double-click for deliveries
            </span>

            {/* The two things you do to marked rows, at the right-hand end of the strip that says how many are marked. */}
            <div className="ml-auto flex items-center gap-2">
              {/* CUT is disabled with nothing marked rather than hidden: a control that appears only once you have already done the
                  thing that enables it teaches nobody it is there. NO COUNT ON THE FACE (owner, 2026-09-05) — the strip it now sits
                  in already says "N marked" a few inches to its left, and a number on the button was the same fact twice, changing
                  the button's width every time a row was clicked. */}
              <button
                type="button"
                onClick={onCut}
                disabled={selected.size === 0}
                title={
                  selected.size === 0
                    ? 'Mark rows first — click, ctrl-click to add, shift-click for a range'
                    : `Hide ${selected.size} marked ${selected.size === 1 ? 'row' : 'rows'} from the view (Reset brings everything back)`
                }
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-white"
              >
                Cut
              </button>

              {/* ---- PARK: the legacy "1 2 3" -----------------------------------------------------------------------------------
                  Pressed after an order has actually been placed with Birkenstock: those styles are settled for the season and should
                  stop reading as re-order candidates. Three buttons and no free entry for the same reason the profit levels have none
                  — it is a coarse "ask me again next season-ish", and the legacy screen has run on exactly these three for years.
                  They sit beside Cut because the two are the same motion (mark rows, then do something to them), and keep their own
                  label because only ONE of them writes to the database and a bare 1 2 3 says nothing about what it will do.
                  The group's border greys out with the buttons, so with nothing marked the whole control is plainly asleep instead of
                  looking like an empty box someone forgot to fill in. */}
              <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-slate-500">Ordered — park</span>
              <div className={`inline-flex rounded-md border p-0.5 ${selected.size === 0 ? 'border-slate-200' : 'border-slate-300'}`}>
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
                    className="rounded px-2.5 py-0.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                  >
                    {parking === m ? '…' : m}
                  </button>
                ))}
              </div>
            </div>
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
        <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-sm text-slate-400 shadow-sm">Loading the sheet…</div>
      ) : sorted.length === 0 ? (
        /* An empty screen is a place to say what to do next, not just that there is nothing here — and what to do next depends on
           what emptied it. A hand-cut list is emptied by the operator and Reset is the way back; an over-narrow search is emptied by
           the terms, and the next Find starts fresh anyway. */
        <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-sm text-slate-400 shadow-sm">
          No styles match{cut.size > 0 || steps.length > 0 || minGross !== null ? ' — press Reset for the whole list again' : ''}.
        </div>
      ) : (
        // UNDERSCORES IN THE calc(), and they are not optional: Tailwind turns `_` into a space, and `calc(100vh-23rem)` without them
        // is invalid CSS that the browser drops on the floor. The first cut of this had no underscores, so the box had no height, so
        // it never scrolled, so the sticky headings still did not stick — the fix looked applied and did nothing.
        //
        // THE GRID SCROLLS INSIDE ITS OWN BOX, so the heading row can actually stick (2026-09-05). The `sticky top-0` on every th was
        // inert before: a box with `overflow-x-auto` is a scroll container in BOTH axes, and one with no height never scrolls
        // vertically, so the headings sat still while the PAGE scrolled and slid off the top with the first thirty rows. On a sheet of
        // 176 rows and fourteen size columns that is the difference between reading a size curve and counting columns to work out
        // which size a 3 is. Bounding the box height moves the vertical scroll inside it and the sticky headings start working.
        // Ctrl+F still finds rows below the fold — the browser scrolls this box to reach them, exactly as it scrolls the page.
        <div className="max-h-[calc(100vh_-_21rem)] min-h-[20rem] overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          {/* FIXED LAYOUT, EXPLICIT WIDTHS (owner, 2026-09-04 — the first cut got both of these wrong). Auto layout sized every column
              to its own widest cell, so a column holding a "10" came out wider than one holding a "1" and the size figures stopped
              lining up down the grid — which is fatal here, because the whole point of the row is reading the size curve ACROSS it.
              table-fixed plus a colgroup makes every size column exactly the same width whatever lands in it, and hands the leftover
              width to Title (the only column that can absorb it).
              The min-width is a floor for narrow screens: below it the grid scrolls sideways as a unit rather than squeezing the last
              sizes off the right-hand edge.

              THE WIDTH BUDGET, AND IT IS TIGHT — this is what a horizontal scrollbar under the grid always turns out to be
              (2026-09-04, and again 2026-09-05). AppShell's container is `max-w-5xl px-4`, so the widest this table can EVER be is
              1024 − 32 = 992px, whatever the monitor: past that the shell centres and stops. Take off the vertical scrollbar the box
              now carries (~15px, Windows Chrome) and the real ceiling is about 977. So every fixed width below has to sum, plus a
              usable Style column, to less than that — and `min-w` has to sit under it too, or the table is wider than its own box on
              EVERY screen and the scrollbar is permanent. That is exactly what a min-w of 1000px did.
                140 groupid + 88 sold + 84 profit + 72 stock + 14x30 sizes = 804, leaving Style ~173. min-w 900.
              Anything added to this grid comes out of Style, and when Style is gone it comes out of the shell.

              WHOLE PIXELS, NOT REMS (owner, 2026-09-04 — the first permanent hairline scrollbar). Rem widths landed on fractions
              (2.1rem = 33.6px), and eighteen of those rounded up to a table a pixel or two wider than the box holding it, which is
              enough on its own. Integer px across every fixed column removes the rounding; Style is the one left auto, so it absorbs
              whatever is left over. */}
          {/* BORDER-SEPARATE, NOT BORDER-COLLAPSE (2026-09-05). `position: sticky` on a table cell has a long history of being
              ignored under `border-collapse: collapse` — the collapsed border model paints borders for the table as a whole rather
              than per cell, and browsers have been inconsistent about whether a cell inside it can be stuck at all. With the heading
              row's whole job being to stay put over 176 rows, that is not a bet worth taking. `border-spacing-0` keeps the grid
              looking exactly as collapsed one did, and the row rules move onto the cells (`[&>td]:border-b`), because a border set on
              a <tr> is not painted in the separate model. */}
          <table className="w-full min-w-[900px] table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              <col className="w-[140px]" />
              <col />
              {/* 88px, not 72: "Sold 365" was wrapping onto two lines and standing the whole heading row a line taller than it needs
                  to be, on the one row of the grid that is repeated at the top of every screenful. */}
              <col className="w-[88px]" />
              <col className="w-[84px]" />
              <col className="w-[72px]" />
              {/* 30px, not 32: two digits at text-sm are ~17px, so 30 holds any quantity this grid can show with room either side,
                  and the 28px it gives back across fourteen columns goes to Style, which is the column that was truncating. */}
              {sizeCols.map((sz) => (
                <col key={sz} className="w-[30px]" />
              ))}
            </colgroup>
            <thead>
              {/* No border-b here — HEAD_RULE on the cells draws it. A border on the row scrolls away with the table under a sticky
                  head and leaves a stray line across the middle of the grid. */}
              <tr className="text-left">
                <SortTh label="Groupid" colKey="groupid" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th className={`sticky top-0 z-10 bg-slate-100 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${HEAD_RULE}`}>
                  Style
                </th>
                <SortTh label="Sold 365" colKey="sold365" align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Profit" colKey="gross" align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Stock" colKey="stock" align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                {sizeCols.map((sz, i) => (
                  <th
                    key={sz}
                    className={`sticky top-0 z-10 bg-slate-100 py-2 text-center text-xs font-semibold text-slate-500 ${HEAD_RULE} ${cellPad(i, sizeCols.length)} ${sizeBand(i)} ${sizeEdge(i)}`}
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
                    // No `title` on the row: see the hint at the end of the count strip for where the gestures are said instead.
                    // select-none matters more than it looks: without it a shift-click drags a text selection across the grid and the
                    // sheet ends up half-highlighted blue underneath the marks it is supposed to be showing.
                    className={`cursor-pointer select-none [&>td]:border-b [&>td]:border-slate-100 ${
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
                          className={`py-1.5 text-center tabular-nums text-slate-700 ${cellPad(i, sizeCols.length)} ${sizeBand(i)} ${sizeEdge(i)}`}
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
                    <tr className="[&>td]:border-b [&>td]:border-slate-100 bg-slate-50">
                      <td colSpan={5 + sizeCols.length} className="px-8 py-2 text-xs text-slate-400">Loading…</td>
                    </tr>
                  )}
                  {open && !plannerBusy && plannerMonths.length === 0 && (
                    <tr className="[&>td]:border-b [&>td]:border-slate-100 bg-slate-50">
                      <td colSpan={5 + sizeCols.length} className="px-8 py-2 text-xs text-slate-500">
                        Nothing still to come — no outstanding Birkenstock order for this style.
                      </td>
                    </tr>
                  )}
                  {open && plannerMonths.map((m) => (
                    <tr key={m.due} className="[&>td]:border-b [&>td]:border-slate-100 bg-slate-50 text-slate-600">
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
                          className={`py-1 text-center text-xs tabular-nums text-slate-600 ${cellPad(i, sizeCols.length)} ${sizeBand(i)} ${sizeEdge(i)}`}
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
