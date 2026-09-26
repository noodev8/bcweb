'use client';
/*
=======================================================================================================================================
Page: /shopify-order  (Shopify Order module home)
=======================================================================================================================================
Purpose: The local-shelf counterpart of /amazon-order (owner, 2026-09-26): every Shopify style with its size curve — what's on the
         shelf, what's already coming, what Shopify has sold — and an Order box under each size. What's typed builds a basket, and
         Confirm Basket turns it into un-placed LOCAL supplier lines on Order Status (POST /order-status-add, ordertype 2), exactly the
         way Amazon Order's basket writes its Amazon lines. From there it's an ordinary supplier order: placed, chased and booked in on
         Order Status / Goods In like anything else.

         Single GET via useApiQuery; the whole ~300-style list ships once and is searched CLIENT-SIDE (routes/shopify-order-list.js).

A SIMPLER SCREEN THAN AMAZON ORDER, ON PURPOSE (owner, 2026-09-26 — "a simpler version of the Amazon screen"). Kept: the Include /
      Exclude search steps, the per-SKU basket with its browser draft, Load basket, Clear basket, Confirm Basket, and the "already in
      Order Status" signals. Left out: Pick mode and Pick keep (there's nowhere to pick TO — this IS the shelf), the Winners /
      Potential / Recycle presets, row cutting, and the rate fill. The rate fill in particular was a deliberate "manual first": outside
      Birkenstock, Shopify sells ~10 units a MONTH across ~120 styles, so a months-of-cover fill would come out 0 on nearly every size.
      Add one once there's a rule worth trusting, not before.

STYLE BLOCKS, NOT A TABLE (owner picked the "size strip per style" layout, 2026-09-26). The decision on this screen is "which sizes of
      this style are running thin", which needs the curve side by side and visible without a click. The sizes can't share columns
      across styles (UK 03-14 and EU 36-46 families, halves in both), so each style draws its own small grid: Size / Stock (+ on order)
      / Sold 12m / Order. The per-size 90-day figure is on the Stock cell's tooltip; the style's 90d total is in its header.

BIRKENSTOCK IS AN ORDINARY ROW HERE (owner, 2026-09-26 — "some may be ordered from stock but show them all as standard, no special case
      yet"). Unlike Amazon Order, which disables it (Birkenstock never goes to Amazon). The seasonal ~6-months-ahead buy still lives on
      the Birkenstock sheet; this is just the ordinary "add a line" path, open to every supplier.

SEARCH: identical rules to /amazon-order and /inventory — Enter commits a STEP, steps stack (all Includes must match, no Exclude may),
      plain substring on both sides, and a new Include that would stack to nothing restarts the search on that term alone. No chips;
      Reset clears the steps. The haystack is title + groupid + supplier + brand.

SEND: Confirm Basket loops POST /order-status-add once per SKU with ordertype 2 (local), so one failing SKU keeps its own box filled
      while the rest go through. It writes EVERY size with a value, not just what's on screen — a quantity typed before a search step
      must not silently drop out of the order. Inline confirm (a real DB write). Each landed SKU clears its box, and the list is
      re-fetched at the end so the "+n on order" figures pick up what was just queued.

DRAFT: the basket is saved to THIS browser (localStorage, debounced, 48h) under its own key, so a reload doesn't lose it — same rules
      and same trade-offs as Amazon Order's draft (per-browser, last tab to write wins).

ARRIVING FROM REPRICING (owner, 2026-09-26 — the flow is Winners -> reprice -> "then think about stock and re-ordering"). A Repricing
      status list links here with ?status=<WINNERS|STEADY|NEW|HARVEST|LOSERS>[&bar=<tier>]&from=<that list>&back=<label>, and the
      screen opens as a DEDICATED WINDOW onto that list's styles: everything else is out of view, and search, sort and Load basket work
      inside it. What arrives is the list's DEFINITION, not a list of groupids — membership comes from GET /pricing-status-list, the
      very route the Repricing list itself reads, so the two can't disagree. It is the whole status, parked styles included (the Due
      switch is a repricing cooldown, and the styles just repriced are the ones it hides — see the pricing page's shopifyOrderHref).
      The scope chip's X shows every style; Reset puts the screen back how you arrived, scope included. The basket is the one basket
      either way — scoping changes what you see, not what Confirm sends. ?from= is a path, so this page hands it to AppShell as the
      back link (AppShell only resolves dashboard-group ?from= itself).

IN SEASON ONLY, AUTOMATICALLY (owner, 2026-09-26 — "I only want to see what is currently in-season"). On by default; the season is
      the month's, never picked: Summer = April-August, Winter = the rest, London time. The server computes each style's in_season with
      the WINNERS rule's own predicate (utils/portfolioStatus.js -> outOfSeasonSql) and says which season it judged against, so this
      screen and "a WINNER must be in season" share one definition. 'Any' is in season in both halves. A chip names the season and
      how many styles it hides; its X shows everything, Reset brings the cut back. Applied inside the Repricing window too. Load basket
      ignores it, as it ignores every other narrowing. KNOWN EDGE, accepted for now: at the turn (late March, late August) this shows
      the ending season while the next one is what you'd be buying for — the X is the way round it until that bites.

NO SUPPLY — "CAN'T GET IT" (owner, 2026-09-26). The supplier has none, so the style comes off the order screens until a re-check
      day, then
      returns on its own — "I don't want too much to remember". Style level. Always THREE MONTHS, no choice and no "forever" — why
      three and not a month or the next season changeover is in bcweb-server/utils/noSupply.js. It changes NOTHING else: not the season (which decides
      WINNERS vs HARVEST and feeds the Seasons screen — the reason this isn't done by re-seasoning), not the status, not the Repricing
      lists ("I can't buy any more, but I can price what I do have"). A chip counts the hidden ones and its X shows them, dimmed, each
      with an Unpark. When the day passes the style is back carrying "Couldn't get it — <date>": X dismisses it (you can get it now),
      "Still can't" parks it again. Ordering a flagged style through Confirm Basket clears the mark too, and parking a style empties its boxes, so
      a line the operator has just said can't be bought can't ride along in the next send. Stored on skusummary.no_supply_*
      (migrations/20260926_no_supply.sql), written by /no-supply-set and /no-supply-clear. A STYLE fact, not a Shopify one — "if we
      can't get a style, we can't get it, regardless of where we're trying to sell it" (owner) — so Amazon Order will honour the
      same mark, and none of this screen's wording for it names a channel. Every parked
      style, and the lapsed ones still carrying their note, is listed and managed in bulk on Back Office → Seasons (Can't get tab).
=======================================================================================================================================
*/

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MagnifyingGlassIcon, XMarkIcon, ArrowPathIcon, ChevronUpIcon, ChevronDownIcon, ShoppingCartIcon, FunnelIcon, TrashIcon, ClockIcon,
} from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import CopyButton from '@/components/CopyButton';
import {
  getShopifyOrderList, getStatusList, addOrderLine, setNoSupply, clearNoSupply,
  ShopifyOrderStyle, ShopifyOrderSize, ShopifyOrderToPlace, ShopifyOrderOnOrder,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useAuth } from '@/contexts/AuthContext';
import { barLabel } from '@/lib/portfolioStatusUi';

const NO_STYLES: ShopifyOrderStyle[] = [];

function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}

// Title + groupid + supplier + brand. Supplier is here for the same reason as Amazon Order's (typing "UKD" finds every brand bought
// through it); brand because a Birkenstock-supplied title doesn't always lead with the maker.
function haystack(s: ShopifyOrderStyle): string {
  return `${s.title || ''} ${s.groupid} ${s.supplier || ''} ${s.brand || ''}`.toLowerCase();
}

// The legacy PowerBuilder rule the operator works to, shared with /amazon-order and /inventory: plain substring on both sides, all
// Includes must match, no Exclude may. Substring over-matches (¬SAND also drops SANDALS) — knowingly accepted, owner 2026-08-25.
function matchesSearch(hay: string, incTerms: string[], excTerms: string[]): boolean {
  if (incTerms.some((t) => !hay.includes(t))) return false;
  if (excTerms.some((t) => hay.includes(t))) return false;
  return true;
}
function hasSearchMatch(styles: ShopifyOrderStyle[], includes: string[], excludes: string[]): boolean {
  const incTerms = includes.map((t) => t.toLowerCase());
  const excTerms = excludes.map((t) => t.toLowerCase());
  return styles.some((s) => matchesSearch(haystack(s), incTerms, excTerms));
}

// SORT — a style block has no column headers to click, so the sort is a small segmented control. Clicking the lit one flips its
// direction. Numbers start high-to-low (the interesting end), A-Z starts at A.
type SortKey = 'sold_365' | 'sold_90' | 'stock' | 'title';
const SORTS: { key: SortKey; label: string; title: string }[] = [
  { key: 'sold_365', label: 'Sold 12m', title: 'Shopify units sold in the last 12 months' },
  { key: 'sold_90', label: 'Sold 90d', title: 'Shopify units sold in the last 90 days' },
  { key: 'stock', label: 'Stock', title: 'Sellable units on the shelf' },
  { key: 'title', label: 'A–Z', title: 'Product name' },
];
const DEFAULT_SORT: SortKey = 'sold_365';
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = { sold_365: 'desc', sold_90: 'desc', stock: 'desc', title: 'asc' };

// DRAFT — see the header. Its own key: this basket and Amazon Order's are different orders and must never load into each other.
const DRAFT_KEY = 'bcweb:shopify-order-draft';
const DRAFT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
interface ShopifyOrderDraft { qty?: Record<string, string>; savedAt?: number; }

// 'YYYY-MM-DD' -> '1 Apr' (with the year only when it isn't this one). Read straight off the string — never through a Date, which
// would parse it as UTC midnight and can land on the day before in the browser's zone (CLAUDE.md's BST day-shift, client side).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const THIS_YEAR = String(new Date().getFullYear());
function shortDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${m[1] === THIS_YEAR ? '' : ` ${m[1]}`}`;
}

// Portfolio status as a word, not a shout — the stored tag is upper-case (WINNERS | STEADY | NEW | HARVEST | LOSERS).
function statusLabel(s: string | null): string | null {
  if (!s) return null;
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// One sendable line — a quantity against a SKU, with the supplier /order-status-add validates it against.
interface BasketTarget { code: string; qty: number; supplier: string; cost: number | null }

// A header figure: the label quiet, the number the thing you read. A zero is dimmed rather than hidden so every header has the same
// four slots in the same places — scanning down the list, the eye finds "Stock" in one spot on every block.
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      {label} <span className={'font-semibold ' + (value === 0 ? 'text-slate-400' : 'text-slate-800')}>{value}</span>
    </span>
  );
}

/*
 * STYLE BLOCK — one style: header line, then its own size grid. Memoised with a comparator that only looks at THIS style's boxes, so
 * typing a number re-renders the one block being typed into rather than all ~300 (and their ~2,100 inputs). onQty is a stable
 * callback (see the page), so it never defeats the comparison.
 */
interface StyleBlockProps {
  style: ShopifyOrderStyle;
  qty: Record<string, string>;
  onQty: (code: string, value: string) => void;
  // "Can't get it" — see NO SUPPLY in the header. Both resolve to an error message, or null when it worked (the list then reloads).
  parkUntil: string | null;   // the day a park set now would lapse — for the confirm's wording
  onPark: (style: ShopifyOrderStyle) => Promise<string | null>;
  onClearSupply: (groupid: string) => Promise<string | null>;
}
const StyleBlock = memo(function StyleBlock({ style, qty, onQty, parkUntil, onPark, onClearSupply }: StyleBlockProps) {
  const basketUnits = style.sizes.reduce((n, z) => n + (Number(qty[z.code]) || 0), 0);
  const status = statusLabel(style.status);
  const sizeTip = (z: ShopifyOrderSize) =>
    `Size ${z.size} — ${z.stock} on the shelf` + (z.on_order > 0 ? `, ${z.on_order} on order` : '')
    + ` · Shopify sold ${z.sold_90} in 90 days, ${z.sold_365} in 12 months`;
  // The confirm is this block's own business: open, busy, or showing why the last write failed. A confirm and not a straight click
  // because parking takes the style off the screen — a stray click on a quiet link would otherwise make it vanish unexplained.
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supplyError, setSupplyError] = useState<string | null>(null);
  async function run(write: () => Promise<string | null>) {
    setBusy(true); setSupplyError(null);
    const err = await write();
    setBusy(false);
    if (err) setSupplyError(err); else setChoosing(false);
  }
  // A park that has run out: the style is back, and says why it was away until the operator clears it or orders it.
  const lapsed = !style.no_supply && !!style.no_supply_since;
  return (
    <div className="border-b border-slate-100 px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <div className="font-medium text-slate-800">{style.title || style.groupid}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
            <span className="inline-flex items-center font-mono">
              {style.groupid}
              <CopyButton value={style.groupid} label="Group ID" />
            </span>
            {style.supplier && <><span className="text-slate-300">·</span><span>{style.supplier}</span></>}
            {style.price !== null && <><span className="text-slate-300">·</span><span>{money(style.price)}</span></>}
            {status && <><span className="text-slate-300">·</span><span>{status}</span></>}
          </div>
        </div>
        <div className="flex items-baseline gap-4 whitespace-nowrap text-xs text-slate-500">
          <Stat label="Stock" value={style.stock} />
          <Stat label="On order" value={style.on_order} />
          <Stat label="Sold 90d" value={style.sold_90} />
          <Stat label="12m" value={style.sold_365} />
          {/* Only once there's something in it — an empty "Basket 0" on 300 blocks is noise. Brand, not emerald: emerald is the write. */}
          {basketUnits > 0 && <span className="font-semibold text-brand-700">Basket {basketUnits}</span>}
        </div>
      </div>

      {/* NO SUPPLY — one line under the header, in one of four states. Quiet slate text until it means something: a parked style (only
          seen when the chip shows them) and a returning one both wear amber, because each is a fact the operator should notice. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {style.no_supply ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">
            Can&rsquo;t get it until {shortDate(style.no_supply_until)}
            {style.no_supply_by && <span className="text-amber-600">· {style.no_supply_by}</span>}
            {/* Unpark, not "Clear" — Park's own opposite, and the word Seasons uses for the same act (owner, 2026-09-26). */}
            <button type="button" disabled={busy} onClick={() => run(() => onClearSupply(style.groupid))} className="font-medium underline-offset-2 hover:underline disabled:opacity-50">
              Unpark
            </button>
          </span>
        ) : lapsed && !choosing ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">
            Couldn&rsquo;t get it — {shortDate(style.no_supply_since)}
            {/* "Still can't" is its own confirmation — the operator has just read the note and answered it — so it parks straight away. */}
            <button type="button" disabled={busy} onClick={() => run(() => onPark(style))} className="font-medium underline-offset-2 hover:underline disabled:opacity-50">
              Still can&rsquo;t
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => onClearSupply(style.groupid))}
              aria-label="I can get it — dismiss the note"
              className="rounded p-0.5 text-amber-600 hover:bg-amber-100 disabled:opacity-50"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : choosing ? (
          <span className="inline-flex items-center gap-1.5 text-slate-600">
            Can&rsquo;t get it — park until {parkUntil ? shortDate(parkUntil) : 'three months from today'}?
            <button type="button" disabled={busy} onClick={() => run(() => onPark(style))} className="rounded border border-slate-300 px-1.5 py-0.5 font-medium hover:bg-slate-50 disabled:opacity-50">
              Park
            </button>
            <button type="button" disabled={busy} onClick={() => { setChoosing(false); setSupplyError(null); }} className="px-1 text-slate-400 hover:text-slate-600">
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setChoosing(true)} className="text-slate-400 hover:text-slate-600 hover:underline">
            Can&rsquo;t get it
          </button>
        )}
        {supplyError && <span className="text-red-600">{supplyError}</span>}
      </div>

      {/* The size grid scrolls sideways inside its own block if it ever has to (a very wide range on a narrow screen), rather than
          pushing the whole page into a horizontal scroll. Fixed-width size columns so a style's curve reads as a shape. A parked style
          (only on screen when the chip shows them) is dimmed — it's listed to look at, not to order. */}
      <div className={'mt-2 overflow-x-auto' + (style.no_supply ? ' opacity-50' : '')}>
        <table className="border-separate border-spacing-0 text-xs">
          <tbody>
            <tr>
              <th scope="row" className="w-16 pr-2 text-left font-normal text-slate-400">Size</th>
              {style.sizes.map((z) => (
                <td key={z.code} className="w-12 border-b border-slate-100 pb-0.5 text-center font-medium text-slate-600">{z.size}</td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="pr-2 pt-1 text-left font-normal text-slate-400">Stock</th>
              {style.sizes.map((z) => (
                <td key={z.code} title={sizeTip(z)} className="pt-1 text-center tabular-nums">
                  <span className={z.stock === 0 ? 'text-slate-300' : 'text-slate-800'}>{z.stock}</span>
                  {z.on_order > 0 && <span className="text-slate-500">+{z.on_order}</span>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="pr-2 text-left font-normal text-slate-400">Sold 12m</th>
              {style.sizes.map((z) => (
                <td key={z.code} title={sizeTip(z)} className={'text-center tabular-nums ' + (z.sold_365 === 0 ? 'text-slate-300' : 'text-slate-600')}>
                  {z.sold_365}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="pr-2 pt-1 text-left font-normal text-slate-400">Order</th>
              {style.sizes.map((z) => (
                <td key={z.code} className="px-0.5 pt-1 text-center">
                  <input
                    value={qty[z.code] || ''}
                    onChange={(e) => onQty(z.code, e.target.value)}
                    inputMode="numeric"
                    placeholder="—"
                    // A size with no supplier can't be written (/order-status-add validates against it) — say so rather than
                    // accept a number the send would quietly skip. None today (verified 2026-09-26); this is the guard, not a case.
                    disabled={!z.supplier}
                    title={z.supplier ? `Units of ${z.code} to order from ${z.supplier}` : 'No supplier on this SKU — it can’t be ordered'}
                    aria-label={`Order quantity, size ${z.size}`}
                    className={
                      'w-11 rounded border px-1 py-0.5 text-center text-xs tabular-nums focus:outline-none focus:ring-1 '
                      + (!z.supplier
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100'
                        : (Number(qty[z.code]) || 0) > 0
                          ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700 focus:border-brand-500 focus:ring-brand-500'
                          : 'border-slate-200 focus:border-brand-500 focus:ring-brand-500')
                    }
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}, (a, b) => a.style === b.style && a.onQty === b.onQty && a.parkUntil === b.parkUntil
  && a.onPark === b.onPark && a.onClearSupply === b.onClearSupply
  && a.style.sizes.every((z) => a.qty[z.code] === b.qty[z.code]));

// useSearchParams needs a Suspense boundary for Next's build — same thin-wrapper split /amazon-order and the pricing lists use.
export default function ShopifyOrderHome() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <ShopifyOrderContent />
    </Suspense>
  );
}

function ShopifyOrderContent() {
  const { logout } = useAuth();
  const searchParams = useSearchParams();
  // ARRIVAL CONTEXT — see "ARRIVING FROM REPRICING" in the header. Read once from the URL; the server validates status and bar (a
  // bad one comes back as an error line, and the full list still shows).
  const scopeStatus = (searchParams.get('status') || '').trim().toUpperCase() || null;
  const barRaw = Number(searchParams.get('bar'));
  const scopeBar = scopeStatus && barRaw > 0 ? barRaw : null;
  // A PATH ?from= is this page's to hand to AppShell (a dashboard-group one AppShell resolves itself). '//' is refused so the back
  // link can only ever stay inside the app.
  const fromParam = searchParams.get('from');
  const backHref = fromParam && fromParam.startsWith('/') && !fromParam.startsWith('//') ? fromParam : undefined;
  const backLabel = searchParams.get('back') || 'Back';

  const { data, error: loadError, isLoading: listLoading, refresh, mutate } = useApiQuery(
    ['shopify-order-list'],
    () => getShopifyOrderList(),
  );
  const styles: ShopifyOrderStyle[] = data?.styles ?? NO_STYLES;

  // The status list's members — the same call the Repricing list makes (parked included), so both screens hold the same styles.
  // null key = no scope requested, nothing fetched.
  const { data: scopeData, error: scopeError, isLoading: scopeLoading } = useApiQuery(
    scopeStatus ? ['shopify-order-scope', scopeStatus, scopeBar] : null,
    () => getStatusList(scopeStatus!, scopeBar),
  );
  const scopeIds = useMemo(
    () => (scopeData ? new Set(scopeData.rows.map((r) => r.groupid)) : null),
    [scopeData],
  );
  // The chip's X turns the window off to show every style; Reset turns it back on (the screen as you arrived).
  const [scopeOn, setScopeOn] = useState(true);
  const scoped = scopeOn && scopeIds !== null;
  // The Repricing window alone — before the season cut, so the chip can count what the season hides from it.
  const scopeBase = useMemo(
    () => (scoped && scopeIds ? styles.filter((s) => scopeIds.has(s.groupid)) : styles),
    [styles, scoped, scopeIds],
  );
  // Status styles that aren't on this screen's list (skusummary.shopify = 0) — said on the chip rather than silently missing.
  const scopeMissing = scoped && scopeIds ? scopeIds.size - scopeBase.length : 0;

  // IN SEASON ONLY — on by default, and automatic: the season is the month's (the server says which, from the same rule that keeps a
  // WINNER in season), never a choice the operator makes (owner, 2026-09-26 — "I only want to see what is currently in-season"). The
  // chip's X shows out-of-season styles too, for the odd off-season order; Reset turns it back on. Applied on top of the Repricing
  // window, so it narrows Steady / New / Losers / Harvest there and is a no-op on Winners (a WINNER is in season by definition).
  const seasonNow = data?.season_now ?? null;
  const [seasonOn, setSeasonOn] = useState(true);
  const outOfSeason = useMemo(() => scopeBase.filter((s) => !s.in_season).length, [scopeBase]);
  const seasonBase = useMemo(
    () => (seasonOn ? scopeBase.filter((s) => s.in_season) : scopeBase),
    [scopeBase, seasonOn],
  );

  // NO SUPPLY — styles marked "Can't get it" are off the screen until their re-check day (see the header). Counted after the season
  // cut, so the chip's number is what it's hiding from the list you'd otherwise see.
  const [supplyOn, setSupplyOn] = useState(true);
  const parkedCount = useMemo(() => seasonBase.filter((s) => s.no_supply).length, [seasonBase]);
  // The styles the screen is working within: the window, cut to the season, less anything you can't get.
  const base = useMemo(
    () => (supplyOn ? seasonBase.filter((s) => !s.no_supply) : seasonBase),
    [seasonBase, supplyOn],
  );
  // Hold the whole screen until the scope has landed too, so arriving from Repricing never flashes all ~300 styles first.
  const loading = listLoading || (!!scopeStatus && scopeLoading);
  const error = loadError?.message ?? null;

  // Local lines already sitting in Order Status — see "already in Order Status" in the render. Same pair of figures, same 3-day
  // staleness line and same dismiss-by-signature banner as Amazon Order, for ordertype 2 instead of 3.
  const toPlace: ShopifyOrderToPlace | null = data?.to_place ?? null;
  const onOrder: ShopifyOrderOnOrder | null = data?.on_order ?? null;
  const stale = !!toPlace && toPlace.oldest_days !== null && toPlace.oldest_days >= 3;
  const openUnits = (toPlace?.units ?? 0) + (onOrder?.units ?? 0);
  const openSig = `${toPlace?.units ?? 0}|${onOrder?.units ?? 0}`;
  const [dismissedOpenSig, setDismissedOpenSig] = useState<string | null>(null);
  const showOpenBanner = openUnits > 0 && dismissedOpenSig !== openSig;

  // SEARCH STEPS — see the header.
  const [includes, setIncludes] = useState<string[]>([]);
  const [excludes, setExcludes] = useState<string[]>([]);
  const [includeInput, setIncludeInput] = useState('');
  const [excludeInput, setExcludeInput] = useState('');
  const includeInputRef = useRef<HTMLInputElement>(null);
  function addInclude() {
    const t = includeInput.trim();
    setIncludeInput('');
    if (!t || includes.includes(t)) return;
    const stacked = [...includes, t];
    // Stacks to nothing -> start again on this term alone, rather than an empty list that can't say "not found" apart from
    // "found, but ruled out by an earlier step" (owner, 2026-08-24 — the Amazon Order rule).
    // Tested against `base`, the styles actually in view — inside a Repricing window, a term that only exists outside it is "not found".
    if (hasSearchMatch(base, stacked, excludes)) setIncludes(stacked);
    else { setIncludes([t]); setExcludes([]); }
  }
  function addExclude() {
    const t = excludeInput.trim();
    if (t && !excludes.includes(t)) setExcludes((prev) => [...prev, t]);
    setExcludeInput('');
  }

  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(DEFAULT_DIR[DEFAULT_SORT]);
  function onSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(DEFAULT_DIR[key]); }
  }

  // THE BASKET — quantities keyed by SKU code, as typed. Only digits are kept (a box is a unit count, nothing else means anything),
  // and an emptied box is removed from the record rather than left as '', so an all-empty basket really is empty and clears the draft.
  const [qty, setQty] = useState<Record<string, string>>({});
  const onQty = useCallback((code: string, value: string) => {
    const digits = value.replace(/[^0-9]/g, '');
    setQty((prev) => {
      const next = { ...prev };
      if (digits === '') delete next[code]; else next[code] = digits;
      return next;
    });
  }, []);

  // CAN'T GET IT — the two writes a style block can make. Each reloads the list (SWR mutate, stable across renders so the memoised
  // blocks aren't all re-rendered for nothing) and hands back an error message, or null. Parking also EMPTIES that style's boxes: a
  // quantity against a style you've just said you can't get is an order Confirm Basket would otherwise still send, from off screen.
  const onPark = useCallback(async (style: ShopifyOrderStyle) => {
    const res = await setNoSupply([style.groupid]);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return 'Session expired'; }
    if (!res.success) return res.error || 'Couldn’t mark it';
    const codes = new Set(style.sizes.map((z) => z.code));
    setQty((prev) => {
      if (!Object.keys(prev).some((c) => codes.has(c))) return prev;
      const next = { ...prev };
      codes.forEach((c) => { delete next[c]; });
      return next;
    });
    await mutate();
    return null;
  }, [mutate, logout]);
  const onClearSupply = useCallback(async (groupid: string) => {
    const res = await clearNoSupply([groupid]);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return 'Session expired'; }
    if (!res.success) return res.error || 'Couldn’t clear it';
    await mutate();
    return null;
  }, [mutate, logout]);

  // LOAD BASKET — show only styles with something in the basket, across the whole list, ignoring the search steps. Membership is a
  // SNAPSHOT taken when it's switched on (the Amazon Order rule, owner 2026-08-27): zeroing a box while it's on must not make the
  // style vanish from under the cursor. null = off.
  const [basketSnapshot, setBasketSnapshot] = useState<Set<string> | null>(null);
  const loadBasketOn = basketSnapshot !== null;

  // code -> the style and size it belongs to, for the send and the cost line.
  const byCode = useMemo(() => {
    const m = new Map<string, { style: ShopifyOrderStyle; size: ShopifyOrderSize }>();
    for (const s of styles) for (const z of s.sizes) m.set(z.code, { style: s, size: z });
    return m;
  }, [styles]);

  function basketStyleIds(): Set<string> {
    const out = new Set<string>();
    for (const [code, raw] of Object.entries(qty)) {
      if ((Number(raw) || 0) > 0) { const hit = byCode.get(code); if (hit) out.add(hit.style.groupid); }
    }
    return out;
  }
  function toggleLoadBasket() {
    setBasketSnapshot(loadBasketOn ? null : basketStyleIds());
  }

  const filtered = useMemo(() => {
    // Load basket reaches past the Repricing window as well as the search: it is "show me what I'm about to send", and Confirm sends
    // the whole basket, so a line added outside this window must still be seen here.
    if (basketSnapshot) return styles.filter((s) => basketSnapshot.has(s.groupid));
    if (includes.length === 0 && excludes.length === 0) return base;
    const incTerms = includes.map((t) => t.toLowerCase());
    const excTerms = excludes.map((t) => t.toLowerCase());
    return base.filter((s) => matchesSearch(haystack(s), incTerms, excTerms));
  }, [styles, base, includes, excludes, basketSnapshot]);

  const visible = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const d = sortKey === 'title'
        ? (a.title || a.groupid).localeCompare(b.title || b.groupid)
        : a[sortKey] - b[sortKey];
      return (d * dir) || a.groupid.localeCompare(b.groupid);
    });
  }, [filtered, sortKey, sortDir]);

  const filtering = includes.length > 0 || excludes.length > 0 || loadBasketOn;

  // WHAT THE BUTTON WILL SEND — every positive box, on screen or not (see SEND in the header).
  const targets = useMemo(() => {
    const out: BasketTarget[] = [];
    for (const [code, raw] of Object.entries(qty)) {
      const n = Math.floor(Number(raw));
      const hit = byCode.get(code);
      if (!hit || !hit.size.supplier || !Number.isFinite(n) || n <= 0) continue;
      out.push({ code, qty: n, supplier: hit.size.supplier, cost: hit.style.cost });
    }
    return out;
  }, [qty, byCode]);
  const basketUnits = useMemo(() => targets.reduce((n, t) => n + t.qty, 0), [targets]);
  // Spend at skusummary.cost (CLAUDE.md: never skumap.cost). A SKU with no numeric cost is counted as unpriced, never as free.
  const basketCost = useMemo(() => {
    let total = 0;
    let unpriced = 0;
    for (const t of targets) {
      if (t.cost === null) unpriced += t.qty; else total += t.qty * t.cost;
    }
    return { total, unpriced };
  }, [targets]);

  // DRAFT LOAD — once, on mount, before autosave may write (loadedDraftRef gates it). The set-state-in-effect disable is the same
  // deliberate carve-out Amazon Order documents: a mount-only read of localStorage, which doesn't exist during the server render, so
  // it can't move into a lazy useState initialiser.
  const loadedDraftRef = useRef(false);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as ShopifyOrderDraft;
        if (draft.savedAt && Date.now() - draft.savedAt <= DRAFT_MAX_AGE_MS && draft.qty) setQty(draft.qty);
        else localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable — the basket simply isn't saved */ }
    }
    loadedDraftRef.current = true;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // AUTOSAVE — debounced; an empty basket removes the draft rather than saving an empty one.
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loadedDraftRef.current) return;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      try {
        if (Object.keys(qty).length === 0) localStorage.removeItem(DRAFT_KEY);
        else localStorage.setItem(DRAFT_KEY, JSON.stringify({ qty, savedAt: Date.now() } satisfies ShopifyOrderDraft));
      } catch { /* storage unavailable — the basket still works for this sitting */ }
    }, 500);
    return () => { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current); };
  }, [qty]);

  const [confirmingSend, setConfirmingSend] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  // SEND — one /order-status-add per SKU, ordertype 2 (local). See the header.
  async function submitBasket() {
    setConfirmingSend(false);
    if (targets.length === 0) return;
    setSending(true); setSendError(null); setSentNote(null);
    setProgress({ done: 0, total: targets.length });
    const failed: string[] = [];
    let units = 0;
    // Styles that carry a "Can't get it" mark (live or lapsed) and just had an order land — cleared after the loop: a style you've
    // just ordered is plainly one you can get, so its note would only be noise.
    const orderedFlagged = new Set<string>();
    for (let i = 0; i < targets.length; i++) {
      const { code, qty: n, supplier } = targets[i];
      const res = await addOrderLine(supplier, code, n, 2);
      if (res.success) {
        units += n;
        const st = byCode.get(code)?.style;
        if (st && st.no_supply_since) orderedFlagged.add(st.groupid);
        setQty((prev) => { const next = { ...prev }; delete next[code]; return next; });
      } else if (res.return_code === 'UNAUTHORIZED') {
        setSending(false); setProgress(null); logout(); return;
      } else {
        failed.push(code);
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null); setSending(false);
    if (failed.length > 0) setSendError(`${failed.length} failed: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`);
    // Best effort — the orders are what matters; a note that fails to clear just stays until the next time.
    if (orderedFlagged.size > 0) await clearNoSupply([...orderedFlagged]);
    if (units > 0) {
      setSentNote(`Sent ${units} unit${units === 1 ? '' : 's'} to Order Status`);
      // Picks up the new lines in every "+n on order" and in the backlog figures.
      await refresh();
    }
  }

  // CLEAR BASKET — the deliberate, confirmed "start again": every box, on screen or not, and the saved draft with it (autosave removes
  // the key once the record is empty). Load basket goes off too — it would otherwise be showing a basket that no longer exists.
  function clearBasket() {
    setConfirmingClear(false);
    setQty({});
    setBasketSnapshot(null);
  }

  // RESET — a VIEW reset: search steps, Load basket, sort — and back into the Repricing window if you'd left it, i.e. the screen as
  // you arrived. Leaves the basket alone on purpose (the Amazon Order rule, owner 2026-08-11 — the basket can be a draft built up
  // over several sittings; emptying it is Clear basket's job).
  function onReset() {
    setIncludes([]); setExcludes([]); setIncludeInput(''); setExcludeInput('');
    setBasketSnapshot(null);
    setScopeOn(true);
    setSeasonOn(true);
    setSupplyOn(true);
    setSortKey(DEFAULT_SORT); setSortDir(DEFAULT_DIR[DEFAULT_SORT]);
    setConfirmingSend(false); setConfirmingClear(false); setSendError(null); setSentNote(null);
    includeInputRef.current?.focus();
  }
  const sorted = sortKey !== DEFAULT_SORT || sortDir !== DEFAULT_DIR[DEFAULT_SORT];
  // Reset has something to do if the Repricing window or the season cut was switched off, too — it's how you get back to either.
  const leftScope = (scopeIds !== null && !scopeOn) || !seasonOn || !supplyOn;
  // "Winners over £2,500" — the list's name as the Repricing crumb gives it.
  const scopeName = scopeStatus
    ? scopeStatus.charAt(0) + scopeStatus.slice(1).toLowerCase() + (scopeBar ? ` ${barLabel(scopeBar)}` : '')
    : null;
  // What the count reads "of": the window's styles, or the whole list (Load basket reaches past the window, so it counts against all).
  const countOf = loadBasketOn ? styles.length : base.length;

  return (
    <AppShell backHref={backHref} backLabel={backLabel}>
      {/* ALREADY IN ORDER STATUS — local lines queued or on their way, so the operator knows before ordering the same sizes again.
          Dismissible for this visit; comes back if the numbers change. */}
      {showOpenBanner && (
        <div role="status" className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div>
            <p className="font-semibold">There are local orders already in Order Status</p>
            <p className="mt-0.5">
              {toPlace && toPlace.units > 0 && <>{toPlace.units} unit{toPlace.units === 1 ? '' : 's'} waiting to be placed</>}
              {toPlace && toPlace.units > 0 && onOrder && onOrder.units > 0 && ' · '}
              {onOrder && onOrder.units > 0 && <>{onOrder.units} unit{onOrder.units === 1 ? '' : 's'} on order with suppliers</>}
              {' — they show as +n beside the stock. '}
              <a
                href={toPlace && toPlace.units > 0 ? '/order-status?stage=place' : '/order-status'}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2 hover:text-amber-700"
              >
                Open Order Status &#8599;
              </a>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissedOpenSig(openSig)}
            aria-label="Dismiss"
            title="Hide this message"
            className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* CONTROL PANEL — sticky, two bands like Amazon Order's: row 1 narrows and orders the list, row 2 is the basket. */}
      <div className="sticky top-0 z-30 mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={includeInputRef}
              value={includeInput}
              onChange={(e) => setIncludeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInclude(); } }}
              autoFocus
              placeholder="Include, then Enter"
              title="Narrow to styles containing this text — Enter commits it as a step, and steps stack (all must match)"
              className="w-48 rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">¬</span>
            <input
              value={excludeInput}
              onChange={(e) => setExcludeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExclude(); } }}
              placeholder="Exclude, then Enter"
              title="Drop styles containing this text — Enter commits it as a step"
              className="w-48 rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-white p-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onSort(s.key)}
                title={sortKey === s.key ? `${s.title} — click again to reverse` : `Sort by ${s.title.toLowerCase()}`}
                aria-pressed={sortKey === s.key}
                className={
                  'flex items-center gap-0.5 rounded px-2.5 py-1 text-sm font-medium '
                  + (sortKey === s.key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                {s.label}
                {sortKey === s.key && (sortDir === 'asc'
                  ? <ChevronUpIcon className="h-3.5 w-3.5" />
                  : <ChevronDownIcon className="h-3.5 w-3.5" />)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onReset}
            disabled={!filtering && !sorted && !leftScope}
            title="Clear the search steps and Load basket, put the sort back, and return to the list you arrived with, in season only — the basket itself is kept"
            className="ml-auto flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Reset
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-2">
          {/* REPRICING WINDOW — which list this screen is scoped to, first in the row because it governs every count and style below it.
              Slate, not brand: it's context you arrived with, not a control you're driving. X = show every style; once out, the same
              slot offers the way back in. */}
          {scopeName && scopeIds !== null && (scopeOn ? (
            <span
              title={
                `Showing only the ${scopeData?.total ?? scopeIds.size} styles in Repricing's ${scopeName} list — parked ones included.`
                + (scopeMissing > 0 ? ` ${scopeMissing} of them ${scopeMissing === 1 ? "isn't" : "aren't"} on Shopify, so ${scopeMissing === 1 ? "isn't" : "aren't"} listed here.` : '')
                + (scopeData?.truncated ? ' The list was capped by the server, so some are missing.' : '')
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 py-1 pl-2.5 pr-1 text-sm text-slate-600"
            >
              Repricing: <span className="font-semibold text-slate-800">{scopeName}</span>
              <button
                type="button"
                onClick={() => { setScopeOn(false); setBasketSnapshot(null); }}
                aria-label="Show every style"
                title="Show every style, not just this list (Reset brings the list back)"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setScopeOn(true)}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              Back to {scopeName} only
            </button>
          ))}
          {/* IN SEASON — same shell as the Repricing chip (both are "what this screen is limited to"), and the same X / way-back-in
              pair. Says how many it hides, so a thin list is never mistaken for a thin range. */}
          {seasonNow && (seasonOn ? (
            <span
              title={`Only styles that sell in ${seasonNow.toLowerCase()} — tagged ${seasonNow} or Any (Back Office → Seasons). The season follows the month: summer is April to August.`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 py-1 pl-2.5 pr-1 text-sm text-slate-600"
            >
              In season: <span className="font-semibold text-slate-800">{seasonNow}</span>
              {outOfSeason > 0 && <span className="text-slate-400">· {outOfSeason} hidden</span>}
              <button
                type="button"
                onClick={() => { setSeasonOn(false); setBasketSnapshot(null); }}
                aria-label="Show out-of-season styles too"
                title="Show out-of-season styles too (Reset hides them again)"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setSeasonOn(true)}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              In season only
            </button>
          ))}
          {/* CAN'T GET — only when something is actually parked; the same chip shell and X / way-back-in pair as the two before it. */}
          {parkedCount > 0 && (supplyOn ? (
            <span
              title="Styles marked “Can’t get it” — off this screen until their re-check date, then back on their own. Still on every Repricing list."
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 py-1 pl-2.5 pr-1 text-sm text-slate-600"
            >
              Can&rsquo;t get: <span className="font-semibold text-slate-800">{parkedCount}</span>
              <span className="text-slate-400">hidden</span>
              <button
                type="button"
                onClick={() => { setSupplyOn(false); setBasketSnapshot(null); }}
                aria-label="Show styles you can't get"
                title="Show them, dimmed (Reset hides them again)"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setSupplyOn(true)}
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              Hide can&rsquo;t-get
            </button>
          ))}
          <span className="whitespace-nowrap text-sm text-slate-500">
            {filtering ? (
              <>Styles: <span className="font-semibold text-slate-800">{visible.length}</span><span className="text-slate-400"> of {countOf}</span></>
            ) : (
              <><span className="font-semibold text-slate-800">{countOf}</span><span className="text-slate-400"> styles</span></>
            )}
          </span>

          <div className="ml-auto flex items-stretch gap-2">
            <button
              type="button"
              onClick={toggleLoadBasket}
              title="Show every style with a number in the basket — ignores the search steps"
              className={
                'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium '
                + (loadBasketOn ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')
              }
            >
              <FunnelIcon className="h-4 w-4" />
              Load basket
            </button>

            {!confirmingSend ? (
              <button
                type="button"
                onClick={() => { setConfirmingClear(false); setConfirmingSend(true); }}
                disabled={sending || targets.length === 0}
                title={
                  'Adds every size with a value — on screen or not — to Order Status as un-placed LOCAL supplier lines (TO PLACE, still editable there).'
                  + (basketCost.unpriced > 0 ? ` ${basketCost.unpriced} unit${basketCost.unpriced === 1 ? ' has' : 's have'} no known cost and ${basketCost.unpriced === 1 ? 'is' : 'are'} not in the total.` : '')
                }
                className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
              >
                <ShoppingCartIcon className="h-5 w-5" />
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-sm font-medium">
                    {sending && progress ? `Sending ${progress.done}/${progress.total}…` : 'Confirm Basket'}
                  </span>
                  {!sending && basketUnits > 0 && (
                    <span className="text-xs font-normal text-emerald-100">
                      {basketUnits} unit{basketUnits === 1 ? '' : 's'}
                      {basketCost.total > 0 && ` · ${money(basketCost.total)}`}
                      {basketCost.unpriced > 0 && ` +${basketCost.unpriced} unpriced`}
                    </span>
                  )}
                </span>
              </button>
            ) : (
              <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <span className="text-slate-700">
                  Confirm {basketUnits} unit{basketUnits === 1 ? '' : 's'} across {targets.length} SKU{targets.length === 1 ? '' : 's'} to Order Status?
                </span>
                <button type="button" onClick={submitBasket} className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">Send</button>
                <button type="button" onClick={() => setConfirmingSend(false)} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Cancel</button>
              </span>
            )}

            {!confirmingClear ? (
              <button
                type="button"
                onClick={() => { setConfirmingSend(false); setConfirmingClear(true); }}
                disabled={sending || targets.length === 0}
                aria-label="Clear basket"
                title="Empty the basket — every size with a value, not just the ones on screen — and discard the saved draft"
                className="flex items-center rounded-md border border-red-200 px-3 py-1.5 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:opacity-40 disabled:hover:bg-white"
              >
                <TrashIcon className="h-5 w-5" />
              </button>
            ) : (
              <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <span className="text-slate-700">Clear the whole basket?</span>
                <button type="button" onClick={clearBasket} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Clear</button>
                <button type="button" onClick={() => setConfirmingClear(false)} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Cancel</button>
              </span>
            )}
          </div>
        </div>

        {(sendError || sentNote || (toPlace && toPlace.units > 0)) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs">
            {sendError && <span className="text-red-600">{sendError}</span>}
            {sentNote && <span className="text-slate-600">{sentNote}</span>}
            {/* UNPLACED BACKLOG — local lines confirmed but never placed with the supplier. Opens in a NEW TAB so a half-built basket
                survives going to look (the Amazon Order rule). Amber once the oldest is 3+ days. */}
            {toPlace && toPlace.units > 0 && (
              <a
                href="/order-status?stage=place"
                target="_blank"
                rel="noopener noreferrer"
                title={
                  `${toPlace.units} local unit${toPlace.units === 1 ? '' : 's'} across ${toPlace.skus} SKU${toPlace.skus === 1 ? '' : 's'}`
                  + ` and ${toPlace.suppliers} supplier${toPlace.suppliers === 1 ? '' : 's'} are queued but not yet ordered from the supplier.`
                  + ' Opens Order Status (TO PLACE) in a new tab.'
                }
                className={
                  'ml-auto flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium hover:underline '
                  + (stale ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-500')
                }
              >
                <ClockIcon className="h-3.5 w-3.5" />
                {toPlace.units} unit{toPlace.units === 1 ? '' : 's'} waiting to be placed
                {stale && ` · oldest ${toPlace.oldest_days}d`}
                <span aria-hidden>&#8599;</span>
              </a>
            )}
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {/* The window failed but the list didn't: say so, and carry on with every style rather than show nothing. */}
      {!loading && !error && scopeStatus && scopeError && (
        <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Couldn&rsquo;t load the {scopeName} list from Repricing ({scopeError.message}) — showing every style.
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          {visible.map((s) => (
            <StyleBlock
              key={s.groupid}
              style={s}
              qty={qty}
              onQty={onQty}
              parkUntil={data?.no_supply_default_until ?? null}
              onPark={onPark}
              onClearSupply={onClearSupply}
            />
          ))}
          {visible.length === 0 && styles.length > 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              {loadBasketOn
                ? 'The basket is empty.'
                // Everything in view is out of season (a Harvest list in the wrong half of the year, say) — say that, not "nothing".
                : seasonOn && outOfSeason > 0 && scopeBase.length === outOfSeason
                  ? `Nothing here sells in ${seasonNow?.toLowerCase() ?? 'this season'} — ${outOfSeason} out-of-season style${outOfSeason === 1 ? '' : 's'} hidden.`
                  : 'Nothing found.'}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
