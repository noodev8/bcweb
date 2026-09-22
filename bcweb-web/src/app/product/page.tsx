'use client';
/*
=======================================================================================================================================
Page: /product  (the product hub — list)
=======================================================================================================================================
Purpose: The front door, built around the way the owner now works (2026-09-22): "We always start with PRODUCT. That's becoming my
         mindset. From the product, I need to find what I need or adjust anything about it, without hunting around for the correct
         screen." So: search, get a row per style with the four numbers that say what KIND of job this is, pick one, and leave for the
         right screen with the groupid already filled in.

         The four numbers are the whole design. Stock, Amazon price, Shopify price, 30-day sold — between them they answer "is this a
         pricing job, an ordering job or a catalogue job" without opening any of those screens to find out. Everything else a style
         has is one card away and stays there.

THE DASHBOARD SEARCH BOX LANDS HERE, not on /inventory (changed 2026-09-22). That box used to BE the Inventory tile — the dashboard
has no Inventory card precisely because the box was it — so this change takes Inventory's front door away, and the replacement is
deliberate rather than incidental: Inventory is the first card on the hand-off row (ProductNavCards), one click further than before,
and the header tab is untouched. What made it worth doing is that the search box's job was never "open Inventory", it was "start from
a product", and Inventory only ever answered one of the several questions that follow.
  THE THUMBNAIL COLUMN IS NOT DECORATION, and it is the part of this screen most likely to be "tidied" by someone counting columns.
  Inventory's whole premise is that the normal result is a dozen near-identical black Arizonas and the PICTURE is how a human tells
  them apart. A hub that listed groupids alone would be worse than the screen it sits in front of, and the operator would bounce
  straight through to Inventory to identify the row — which is the trip this page exists to remove.

SELECT AND DRILL ARE DIFFERENT GESTURES, which is what the owner's two options collapse into once both are on screen ("grey out the
buttons until a groupid is selected, or wait for a double click" — both, as it turns out, because they do different jobs):
  - ONE CLICK selects, and clicking the SAME row again unselects it (owner). The cursor stays where it was left - it is the keyboard's
    position, not the selection - so arrowing on from a cleared row carries on from the right place.
  - ONE CLICK selects. That lights the hand-off cards, which is the common case: most visits end by leaving for another module, not
    by opening the sizes.
  - DOUBLE-CLICK, Enter, or the row's own › button drills to the sizes. Three ways in on purpose — double-click is what the owner
    asked for and what the legacy grid did, Enter is what every other list on this platform does (useListCursor), and the › is the
    only one of the three that is VISIBLE, so the gesture is discoverable by someone who was told neither.
  The first click of a double-click selects, which is harmless — the row it selects is the row about to open.

THE FILTER IS /inventory's, DELIBERATELY (owner, 2026-09-22 — "exactly same functionality as inventory search"). Contains / Does not
contain, either or both, Enter or Find commits them as steps and clears the boxes, each Find narrows what is ALREADY on screen, and
Reset clears the lot. The matching rule is the shared plain-substring one (see `matches`), so a term behaves identically here and on
the four other screens that use it.
  WHICH MEANT MOVING THE WHOLE CATALOGUE INTO THE BROWSER. The hub used to ask the server for one term at a time. Stacked steps and an
  instant Reset are impossible on that footing — every step would be a round-trip and Reset would be another — so product-overview
  dropped its `term` parameter and now ships all ~305 styles once, exactly like inv-styles. See that route's header.
  TYPED COMMANDS came across too (owner, 2026-09-22): WINTER / SUMMER, and STOCK|SOLD LESS|MORE <n>. They are consumed out of the
  Contains box rather than searched for as text - see parseContains - and they narrow like any other step, chip and all. One
  deliberate difference from Inventory in what STOCK compares against, documented on metricValue; read it before making them agree.
  NOT PORTED: Inventory's Size box. It needs the per-size maps this payload does not carry, and a size has nothing to filter on a
  style-grain table anyway - the drill is where sizes live.

THE WHOLE FILTER LIVES IN THE URL, as repeatable ?has= / ?not= params - the convention /amz/find already uses, for the identical
reason. Every hand-off card sends `from` = this exact URL, so the back link on the far screen rebuilds the list you left; a filter
held only in state comes back as an empty hub and gets retyped, which is the specific annoyance this whole feature is against.
  It carried only the FIRST term for half a day and that was not enough (owner: "I filtered attributes and then went back to only find
  the original filter") - the step you are standing on when you leave is usually the LAST one, so dropping all but the first threw away
  exactly the work worth keeping. ?q= survives as the single-term form the dashboard box sends.
  Every mutation goes through applySteps, which replaces the URL as well as the state, so a reload and a copied link land on the list
  that was on screen. The one thing repeatable params cannot do is interleave, so the chips read has-steps first; since every step is
  ANDed that changes their order, never the set.
=======================================================================================================================================
*/

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { MagnifyingGlassIcon, ChevronRightIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import ProductNavCards from '@/components/ProductNavCards';
import { getProductOverview, ProductOverviewRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useListCursor } from '@/lib/useListCursor';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
// Stable empty identity so the render's reads don't allocate a new array each pass.
const NO_ROWS: ProductOverviewRow[] = [];

// Both filter boxes share one look, so the pair reads as one control rather than two inputs that happen to sit together.
const BOX_CLASS =
  'w-full rounded-lg border-2 border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm ' +
  'placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';

function money(v: number | null): string {
  return v === null ? '—' : `£${v.toFixed(2)}`;
}

/**
 * The Amazon cell: a SPREAD, printed as one value only when the sizes genuinely agree.
 * Amazon prices per size — IVES BLACKSOLE runs £36.69–£40.89 across six — and CLAUDE.md records that the retired match_amazon_price
 * autopilot was killed for exactly that: there is no single Amazon price, and treating one as if there were let a thin size set the
 * whole style's. So this cell never averages. `live=false` means the style has no FBA stock and the spread is over its dead feed
 * rows, which is worth seeing but is not a price anyone can buy at — drawn dimmed, with the reason in the tooltip.
 */
// One applied narrowing step. `has` keeps matching rows; `not` drops them. Same shape and same vocabulary as /inventory's, so an
// operator moving between the two screens is working one mental model, not two.
interface FilterStep {
  op: 'has' | 'not';
  term: string;
}

// The text a step is matched against. Includes `codes` - every size code and full Amazon Seller SKU under the style - which is the
// whole reason a pasted '0151183-ARIZONA-38' or '17659-23-42-2607' finds its product: neither the groupid nor the title carries the
// size or the supplier suffix. Also includes the segment, so a segment name still pulls its set up even though the column was
// dropped from the table. Lowercased here so each step is a plain indexOf.
function haystack(r: ProductOverviewRow): string {
  return `${r.title || ''} ${r.groupid} ${r.segment || ''} ${r.codes || ''}`.toLowerCase();
}

// TYPED COMMANDS, consumed out of the Contains box instead of being searched for as text - /inventory's, ported verbatim (owner,
// 2026-09-22: "lets put the winter/summer filter and stock sold less more").
//
// SEASON is TYPED rather than read off the segment name, and that is the whole reason it exists as a command: only RIEKER-WIN /
// RIEKER-SUM / REMONTE-WIN encode a season in their name - 32 styles of ~300 - so the old habit of hunting "-WIN" in Contains
// silently missed the rest. skusummary.season is the real tag and is fully populated. A year-round style ('Any') answers to BOTH
// seasons (owner), which is why the fold happens here and not in SQL.
type Season = 'Winter' | 'Summer';

// "STOCK LESS 10" / "SOLD MORE 5" - plain-English keywords, not "<10" symbols, so they never clash with a future meaning for < and >
// and the two read alike. Strict (< / >), so LESS 10 excludes exactly 10. One command per metric is active at a time; a new one for
// the same metric replaces it. Kept apart from the text steps because it is a numeric compare, not a find.
type QtyMetric = 'stock' | 'sold';
interface QtyFilter {
  metric: QtyMetric;
  op: 'less' | 'more';
  n: number;
}

// WHICH NUMBER EACH METRIC COMPARES AGAINST - and this is the ONE place the hub deliberately differs from Inventory, so read it
// before "fixing" it to match:
//   stock = r.stock, i.e. LOCAL + AMAZON, the figure this screen's Stock column actually prints. Inventory compares r.local alone,
//     because its question is "what can I hand to the customer in front of me" and Amazon-held stock cannot be picked today. The hub
//     is not standing at a shelf; its Stock column is the merged "what have we got at all" number (owner), and a filter that
//     disagreed with the column beside it would be a bug on this screen - type STOCK LESS 5 and a row reading 12 is exactly the
//     confusion Inventory's own header warns about. Sorting, filtering and the printed cell all have to agree, so here they do.
//     CONSEQUENCE: the same words mean slightly different sets on the two screens. That is the honest cost of each screen's column
//     meaning what it says.
//   sold = sold30, identical to Inventory.
function metricValue(r: ProductOverviewRow, metric: QtyMetric): number {
  return metric === 'stock' ? r.stock : r.sold30;
}

// Everything narrowing the list, in one object. One object rather than three useStates because all of it has to be written to the URL
// together (see `toQuery`) - the return trip from a hand-off card must rebuild the WHOLE filter, not the text half of it.
interface Criteria {
  steps: FilterStep[];
  season: Season | null;
  qty: Partial<Record<QtyMetric, QtyFilter>>;
}

const EMPTY_CRITERIA: Criteria = { steps: [], season: null, qty: {} };

function isEmpty(c: Criteria): boolean {
  return c.steps.length === 0 && c.season === null && Object.keys(c.qty).length === 0;
}

// PARSING ONE CONTAINS TERM. Pulled out of onFind so a term arriving as ?q= from the dashboard box runs the SAME rules as one typed
// here, or the two searches drift apart. Returns what the term MEANS: a season, a quantity command, or plain text to match.
// Commands are matched BEFORE the text logic for the same reason Inventory does it: "STOCK" as a title substring would find nothing
// and read as a broken search. Keywords are caps because both boxes force-uppercase their input.
function parseContains(raw: string): { term: string; qty: QtyFilter | null; season: Season | null } {
  const t = raw.trim();
  const seasonMatch = t.match(/^(WINTER|SUMMER)$/);
  if (seasonMatch) return { term: '', qty: null, season: seasonMatch[1] === 'WINTER' ? 'Winter' : 'Summer' };
  const qtyMatch = t.match(/^(STOCK|SOLD)\s+(LESS|MORE)\s+(\d+(?:\.\d+)?)$/);
  if (qtyMatch) {
    return {
      term: '',
      qty: { metric: qtyMatch[1] === 'STOCK' ? 'stock' : 'sold', op: qtyMatch[2] === 'LESS' ? 'less' : 'more', n: Number(qtyMatch[3]) },
      season: null,
    };
  }
  // No size to split off a pasted SKU, unlike Inventory's parser: `codes` carries the full size code, so '0151183-ARIZONA-38' is
  // matched directly as text and there is nothing to strip.
  return { term: t, qty: null, season: null };
}

// Does one row survive the whole criteria? Text steps, then season, then the numeric commands - all ANDed.
function survives(r: ProductOverviewRow, c: Criteria): boolean {
  if (!matches(haystack(r), c.steps)) return false;
  // 'Any' is year-round and answers to BOTH seasons (owner). An untagged style has no season and falls out of either - correct: the
  // command asks for winter stock, and "we never said" is not an answer to that.
  if (c.season !== null && r.season !== c.season && r.season !== 'Any') return false;
  for (const f of Object.values(c.qty)) {
    if (!f) continue;
    const v = metricValue(r, f.metric);
    if (f.op === 'less' ? !(v < f.n) : !(v > f.n)) return false;
  }
  return true;
}

// The criteria AS A QUERY STRING - repeatable has/not (the /amz/find convention), plus one param each for season and the two
// quantity commands. Everything narrowing the list has to be in here, or the back link from a hand-off card rebuilds a partial
// filter, which is worse than rebuilding none: it looks right and is not.
function toQuery(c: Criteria): string {
  const qs = c.steps.map((st) => `${st.op}=${encodeURIComponent(st.term)}`);
  if (c.season) qs.push(`season=${c.season}`);
  for (const f of Object.values(c.qty)) if (f) qs.push(`${f.metric}=${f.op}:${f.n}`);
  return qs.join('&');
}

// …and back again. Anything malformed is simply dropped rather than throwing: these params get hand-edited and pasted around, and a
// junk one should cost you that one narrowing, not the whole screen.
function fromQuery(sp: URLSearchParams, q: string): Criteria {
  const has = sp.getAll('has');
  const not = sp.getAll('not');
  const steps: FilterStep[] = [
    ...has.map((t): FilterStep => ({ op: 'has', term: t.toUpperCase() })),
    ...not.map((t): FilterStep => ({ op: 'not', term: t.toUpperCase() })),
  ];
  const rawSeason = sp.get('season');
  const season: Season | null = rawSeason === 'Winter' || rawSeason === 'Summer' ? rawSeason : null;
  const qty: Partial<Record<QtyMetric, QtyFilter>> = {};
  for (const metric of ['stock', 'sold'] as QtyMetric[]) {
    const raw = sp.get(metric);
    const m = raw && raw.match(/^(less|more):(\d+(?:\.\d+)?)$/);
    if (m) qty[metric] = { metric, op: m[1] as 'less' | 'more', n: Number(m[2]) };
  }
  // ?q= is the single-term form the dashboard search box sends. It runs through the same parser as a typed term, so typing
  // "WINTER" there lands here as a season, not as a text hunt that would find nothing.
  if (steps.length === 0 && !season && Object.keys(qty).length === 0 && q) {
    const parsed = parseContains(q.toUpperCase());
    if (parsed.season) return { steps: [], season: parsed.season, qty: {} };
    if (parsed.qty) return { steps: [], season: null, qty: { [parsed.qty.metric]: parsed.qty } };
    if (parsed.term) return { steps: [{ op: 'has', term: parsed.term }], season: null, qty: {} };
  }
  return { steps, season, qty };
}

// BOTH sides are a plain substring test over the whole haystack - the legacy PowerBuilder rule the operator works to: match anywhere,
// and if anything takes a row out, it is out. This is the SHARED rule across Inventory, Amazon Order, amz-find.js and
// analytics-sales.js. The known cost is the over-match (excluding SAND also bins SANDALS) and it is knowingly accepted: a word-
// boundary regex cannot drop "Womens" for a NOT of "WOMEN", which is the commoner and worse failure. Keep the five sites in step,
// and do not "fix" this with boundaries.
function matches(hay: string, steps: FilterStep[]): boolean {
  for (const st of steps) {
    const hit = hay.includes(st.term.toLowerCase());
    if (st.op === 'has' ? !hit : hit) return false;
  }
  return true;
}

function AmazonCell({ r }: { r: ProductOverviewRow }) {
  if (r.amz_low === null) return <span className="text-slate-300">—</span>;
  const one = r.amz_low === r.amz_high;
  const text = one ? `£${r.amz_low.toFixed(2)}` : `£${r.amz_low.toFixed(2)}–${r.amz_high!.toFixed(2)}`;
  const title = [
    one ? `One price across ${r.amz_sizes} size${r.amz_sizes === 1 ? '' : 's'}.` : `Amazon prices per size — ${r.amz_sizes} sizes span this range.`,
    r.amz_live ? 'In stock at FBA.' : 'No FBA stock: this is what the listing WOULD sell at, not a price on sale today.',
  ].join(' ');
  return (
    <span className={r.amz_live ? 'text-slate-700' : 'text-slate-400 italic'} title={title}>
      {text}
    </span>
  );
}

export default function ProductHubPage() {
  // useSearchParams must sit inside a Suspense boundary for Next's build (App Router) — same thin wrapper every other page here uses.
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <ProductHubContent />
    </Suspense>
  );
}

function ProductHubContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') || '').trim();

  // The two boxes, and the ordered list of steps applied so far. Force-uppercased to match the dashboard box, Inventory's Contains
  // box and both Find pages, so a term reads identically wherever it is re-typed.
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  // THE WHOLE FILTER restores from the URL - text steps, season and both quantity commands - so coming back from a hand-off card
  // returns to the NARROWED list you left (owner, 2026-09-22: "I filtered attributes and then went back to only find the original
  // filter"). Read ONCE into the initial state rather than in an effect: the list must never paint the whole catalogue and then
  // visibly snap to the match. See fromQuery/toQuery for the param shapes.
  const [criteria, setCriteria] = useState<Criteria>(() => fromQuery(new URLSearchParams(searchParams.toString()), q));
  const [selected, setSelected] = useState<string | null>(null);

  // THE WHOLE CATALOGUE, ONCE. Not keyed on the search: every narrowing below is client-side, so a Find and a Reset are both instant
  // and cost no round-trip. Same shape as /inventory.
  const { data, error, isLoading } = useApiQuery(['product-overview'], () => getProductOverview());
  const all = data?.rows ?? NO_ROWS;

  const rows = useMemo(
    () => (isEmpty(criteria) ? all : all.filter((r) => survives(r, criteria))),
    [all, criteria],
  );

  // This list AS IT CURRENTLY STANDS - every step, not just the opening term - handed to every destination as ?from= so its back link
  // rebuilds exactly what you left rather than the search you happened to start with.
  const selfUrl = useMemo(() => {
    const qs = toQuery(criteria);
    return qs ? `/product?${qs}` : '/product';
  }, [criteria]);

  const keys = useMemo(() => rows.map((r) => r.groupid), [rows]);

  // THE URL MIRRORS THE FILTER. Every place that changes `steps` goes through here, so the address bar always describes what is on
  // screen: a reload, a copied link and a hand-off card's back link all rebuild the same list. replace, not push, so narrowing does
  // not pile a history entry per step - browser Back leaves the hub rather than un-picking the hunt one term at a time, and the
  // chips' own x is what undoes a step.
  const apply = useCallback((next: Criteria) => {
    setCriteria(next);
    setSelected(null);
    const qs = toQuery(next);
    router.replace(qs ? `/product?${qs}` : '/product', { scroll: false });
  }, [router]);

  function drill(groupid: string) {
    router.push(`/product/${encodeURIComponent(groupid)}?from=${encodeURIComponent(selfUrl)}`);
  }

  // Keyboard cursor over the rows — same hook, same gesture as /inventory and the other lists. Selection follows the cursor so the
  // hand-off cards always point at the row the eye is on; Enter opens it.
  const cursor = useListCursor({
    keys,
    onEnter: (key) => drill(key),
    onMove: (key) => setSelected(key),
  });

  // Each Find NARROWS what is already on screen ("ARIZONA" -> not "EVA" -> "BLACK"), then clears the boxes ready for the next step.
  // A typed command (WINTER / SUMMER / STOCK|SOLD LESS|MORE n) is CONSUMED by the parser and becomes its own narrowing rather than a
  // text step - so "STOCK" never leaks through as a title substring and matches nothing.
  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseContains(contains);
    const next: FilterStep[] = [];
    if (parsed.term) next.push({ op: 'has', term: parsed.term });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    if (next.length === 0 && !parsed.qty && !parsed.season) return;

    const merged: Criteria = {
      steps: [...criteria.steps, ...next],
      // A newly typed season replaces the standing one - two seasons at once is not a narrowing, it is a contradiction.
      season: parsed.season ?? criteria.season,
      // Likewise per metric: one STOCK command and one SOLD command can stand together, but a second STOCK replaces the first.
      qty: parsed.qty ? { ...criteria.qty, [parsed.qty.metric]: parsed.qty } : criteria.qty,
    };

    // START FRESH WHEN THE NARROWING WOULD EMPTY THE LIST - lifted from /inventory, same reasoning. The box is often used to begin a
    // NEW hunt ("ARIZONA" ... then "IVES"), and stacked on the old criteria that can only ever find nothing. So probe the merged
    // criteria first: if they match no styles AND something was already applied, treat this as a brand-new search and drop the old
    // lot. Probing rather than reacting to an empty render means the dead intermediate state never paints.
    const fresh: Criteria = {
      steps: next,
      season: parsed.season,
      qty: parsed.qty ? { [parsed.qty.metric]: parsed.qty } : {},
    };
    const hadFilters = !isEmpty(criteria);
    apply(hadFilters && !all.some((r) => survives(r, merged)) ? fresh : merged);

    setContains('');
    setNotContains('');
    cursor.setCursor(null);
  }

  // Reset means "start again": every step goes, and so does the place-keeping. Clearing the steps does NOT empty the list - with none
  // applied, `rows` is the whole catalogue - so without dropping the cursor and the selection the highlight would reappear on the
  // previous hunt's row, which is the opposite of starting again.
  function onReset() {
    apply(EMPTY_CRITERIA);
    setContains('');
    setNotContains('');
    cursor.setCursor(null);
  }

  // Drop ONE step without losing the rest - for the common "that last NOT was too broad" correction, which Reset would otherwise
  // charge the whole stack for.
  function dropStep(i: number) {
    apply({ ...criteria, steps: criteria.steps.filter((_, n) => n !== i) });
  }
  function dropSeason() {
    apply({ ...criteria, season: null });
  }
  function dropQty(metric: QtyMetric) {
    const qty = { ...criteria.qty };
    delete qty[metric];
    apply({ ...criteria, qty });
  }

  return (
    <AppShell title="Product" backHref="/dashboard" backLabel="Dashboard">
      {/* TWO BOXES, THEN STEPS - /inventory's filter, not a second search with its own rules (owner, 2026-09-22: "exactly same
          functionality as inventory search"). Either box or both may be filled; Enter or Find commits them as steps and clears them,
          and each Find narrows what is ALREADY on screen. Steps are display-only; to undo one use its x, to undo the lot use Reset. */}
      <form onSubmit={onFind} className="mb-3 flex items-stretch gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-600" />
          <input
            value={contains}
            onChange={(e) => setContains(e.target.value.toUpperCase())}
            autoFocus
            placeholder="Contains - or WINTER / SUMMER / STOCK LESS 5 / SOLD MORE 10"
            aria-label="Contains"
            className={BOX_CLASS}
          />
        </div>
        <div className="relative flex-1">
          <XMarkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={notContains}
            onChange={(e) => setNotContains(e.target.value.toUpperCase())}
            placeholder="Does not contain"
            aria-label="Does not contain"
            className={BOX_CLASS}
          />
        </div>
        <button
          type="submit"
          className={
            'inline-flex shrink-0 items-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-5 text-sm font-medium ' +
            'text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500/30'
          }
        >
          Find
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={isEmpty(criteria)}
          title="Clear every narrowing and start again"
          className={
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg border-2 px-4 text-sm font-medium transition focus:outline-none ' +
            (isEmpty(criteria)
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              : 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50')
          }
        >
          <ArrowPathIcon className="h-4 w-4" />
          Reset
        </button>
      </form>

      {/* Everything narrowing the list, as chips - text steps first, then the typed commands. Each carries its own x so one bad
          narrowing can go without resetting the rest, which is the common "that NOT was too broad" correction. The commands are
          drawn in their own colours because they are a different KIND of thing from a text find: a numeric or categorical test, not
          a substring, and reading them as if they were terms is how you end up believing SUMMER matched a title. */}
      {!isEmpty(criteria) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {criteria.steps.map((st, i) => (
            <span
              key={`${st.op}-${st.term}-${i}`}
              className={
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ' +
                (st.op === 'has'
                  ? 'border-brand-200 bg-brand-50 text-brand-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700')
              }
            >
              {st.op === 'not' && <span aria-hidden>not</span>}
              {st.term}
              <button
                type="button"
                onClick={() => dropStep(i)}
                aria-label={`Remove step ${st.term}`}
                className="ml-0.5 rounded-full p-0.5 hover:bg-white/70"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </span>
          ))}

          {criteria.season && (
            <span
              title="Year-round styles count as both seasons, so they stay in either list"
              className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700"
            >
              {criteria.season.toUpperCase()}
              <button
                type="button"
                onClick={dropSeason}
                aria-label="Remove season filter"
                className="ml-0.5 rounded-full p-0.5 hover:bg-white/70"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </span>
          )}

          {(['stock', 'sold'] as QtyMetric[]).map((m) => {
            const f = criteria.qty[m];
            if (!f) return null;
            return (
              <span
                key={m}
                title={m === 'stock' ? 'Compares the Stock column: on our shelf plus held at Amazon' : 'Compares units sold in the last 30 days'}
                className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700"
              >
                {m.toUpperCase()} {f.op.toUpperCase()} {f.n}
                <button
                  type="button"
                  onClick={() => dropQty(m)}
                  aria-label={`Remove ${m} filter`}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-white/70"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* The hand-off row sits ABOVE the list, not under it: it is the destination of most visits, and putting it below a list of
          unknown length would mean scrolling to reach the thing you came for. Greyed until a row is picked. */}
      <div className="mb-4">
        <ProductNavCards groupid={selected} from={selfUrl} />
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>}
      {!isLoading && !error && rows.length === 0 && <p className="text-sm text-slate-400">No products match.</p>}

      {rows.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-14 px-2 py-2" />
                  <th className="px-3 py-2 font-medium">Group ID</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  {/* ONE TOTAL HERE, SPLIT ON THE DRILL (owner, 2026-09-22 — "don't split stock on both hubs, leave the total in
                      summary hub"). The two screens are asking different questions: this one is "which of these products am I
                      working on", where local-vs-Amazon is detail you have not needed yet and a second numeric column is one more
                      thing to read past on every row. Once you are IN a product the split matters — 5 at FBA and 5 on the shelf are
                      opposite situations — so the sizes table carries Local and Amz separately. The split is in the tooltip here.
                      Excludes the Birkenstock pre-order book, so it can read lower than the Inventory card; see the route header. */}
                  <th className="px-3 py-2 text-right font-medium" title="On our shelf plus held at Amazon">Stock</th>
                  <th className="px-3 py-2 text-right font-medium" title="Amazon prices per size, so this is the range, never an average">Amazon</th>
                  <th className="px-3 py-2 text-right font-medium">Shopify</th>
                  <th className="px-3 py-2 text-right font-medium" title="Units sold in the last 30 days, all channels">Sold 30d</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const isSel = selected === r.groupid;
                  return (
                    <tr
                      key={r.groupid}
                      ref={cursor.itemRef(r.groupid)}
                      onClick={() => { setSelected((cur) => (cur === r.groupid ? null : r.groupid)); cursor.setCursor(r.groupid); }}
                      onDoubleClick={() => drill(r.groupid)}
                      title="Click to select · double-click to open the sizes"
                      className={'cursor-pointer ' + (isSel ? 'bg-brand-50' : 'hover:bg-slate-50')}
                    >
                      {/* Intrinsic size is unknown (legacy image library), so next/image gets a fixed box and object-contain
                          letterboxes it — the same treatment every other product thumbnail on the platform gets. Deliberately NOT
                          `unoptimized`: next.config.js sets a year-long minimumCacheTTL because image filenames are immutable, and
                          opting out of the optimiser would opt out of that cache too. */}
                      <td className="px-2 py-1.5">
                        <div className="relative h-10 w-10 overflow-hidden rounded border border-slate-200 bg-white">
                          {r.imagename && (
                            <Image src={IMAGE_BASE + r.imagename} alt="" fill sizes="40px" className="object-contain" />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{r.groupid}</td>
                      <td className="px-3 py-1.5 text-slate-700">
                        {r.title || <span className="text-slate-400">—</span>}
                      </td>
                      <td
                        className="px-3 py-1.5 text-right tabular-nums text-slate-700"
                        title={`${r.local} on our shelf + ${r.amazon} at Amazon. Excludes the Birkenstock pre-order book, so this can read lower than the Inventory card.`}
                      >
                        {r.stock}
                      </td>
                      {/* nowrap: a spread is one value, and letting "36.69-40.89" break after the dash stacks it into what reads
                          as two separate prices. The column is narrow enough that it wrapped at ordinary window widths. */}
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums"><AmazonCell r={r} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{money(r.price)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{r.sold30}</td>
                      <td className="px-2 py-1.5 text-right">
                        {/* The VISIBLE way in to the sizes. Double-click and Enter both do the same thing, but neither announces
                            itself — this does. stopPropagation so it opens rather than just selecting. */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); drill(r.groupid); }}
                          title="Open this product's sizes"
                          aria-label={`Open sizes for ${r.groupid}`}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Every match is listed - there is no cap and no top-N, so this count IS the size of the set, and it is worth saying how
              much of the catalogue that is once anything has been narrowed. */}
          <p className="mt-2 text-xs text-slate-400">
            {isEmpty(criteria)
              ? `${rows.length} ${rows.length === 1 ? 'product' : 'products'}.`
              : `${rows.length} of ${all.length} products.`}
          </p>
        </>
      )}
    </AppShell>
  );
}
