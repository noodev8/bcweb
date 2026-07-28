'use client';
/*
=======================================================================================================================================
Page: /inventory  (Inventory Management — BROWSE redesign, 2026-07-23)
=======================================================================================================================================
Purpose: "Have we got this, in my size, and where is it?" The operator filters the catalogue down, then scrolls a stack of rich cards
         — like a shop's category page — each showing the product picture, its in-stock sizes, and (on a tap) which racks a size is on.

         Why a browse and not a list-plus-detail-panel: the normal result is a dozen near-identical black Arizonas, and a browse shows
         every picture at once, which is how a human tells them apart. See InvStyleCard for the per-card behaviour.

THE FILTER IS UNCHANGED — it is the proven part of this screen and the redesign leaves it exactly as it was:
  - Two boxes: Contains / Does not contain. Either or both may be filled. Enter or Find applies them, then clears them; each Find
    narrows what is ALREADY on screen ("Arizona" -> not "EVA" -> "black"). Steps are display-only; to undo, Reset.
    EXCEPT when the narrowing would empty the list: then the Find is treated as a brand-new search instead (see onFind) — the
    operator was starting a new hunt, not narrowing ("ARIZONA" then "IVES" = just IVES).
  - Size box: narrow to styles holding that size in LOCAL stock, and each card then LEADS with that size's count (InvStyleCard). A
    single value kept apart from the text steps, since it is the criterion swapped mid-call.
  - Cut: a per-row manual hide for stragglers a text step can't drop without over-matching. View-only; Restore or Reset brings them back.
  - Reset clears everything AND re-reads from the DB (the refresh), mirroring PowerBuilder.

THE LIST IS ALWAYS THERE (owner, 2026-07-28). The screen used to open blank and stay blank until the first Find. It now opens on the
WHOLE catalogue, NEWEST ADDED FIRST, and Reset returns to exactly that rather than to nothing. The filter narrows a list that already
exists instead of conjuring one. Two reasons: a blank screen reads as switched off, and "what came in recently" is a question the
operator has constantly but would never think to type. The default sort key is `created` (skusummary.created_at — see sortValue for
why it is compared as text). The sort SURVIVES filtering: narrowing changes which styles are listed, never their order, so the newest
match is always the top card.

EVERY MATCH GETS A CARD (owner, 2026-07-28). There used to be a GATE: over 50 matches the pictures were swapped for a compact title
list, on the theory that the operator should narrow further before loading images. That has been dropped — the pictures ARE the screen,
and being sent back to a text list at the moment the list gets interesting was the wrong trade. The title list is gone with it.
What keeps the browse fast instead:
  1. A RENDERED WINDOW (CARD_CHUNK). Every match is available, but only the first chunk is in the DOM; a sentinel below the last card
     extends the window as it scrolls into view, so the DOM grows only as far as the operator has actually walked. "Show all" paints
     the rest in one go for a Ctrl+F over the lot. The window resets to one chunk whenever the criteria or the sort change.
  2. Images are lazy (next/image), so the pictures fetched are the ones on screen, not the ones matched — the window mostly matters
     for paint cost, and it also keeps the load burst small (see the retry note in InvStyleCard: a big simultaneous burst is what makes
     images transiently fail).
  3. Detail is lazy. The heavy per-style /inv-stock (racks, buckets) is fetched by InvStyleCard only when a size is tapped, never on
     render. So even a full page of cards costs zero detail round-trips until someone asks a question of one.

The command bar scrolls away with the page. It was sticky until the keyboard cursor landed (below) — a pinned bar plus cards moving
under it was too much motion to read while arrowing (owner, 2026-07-27, on trial). See the bar's own comment to pin it again.

KEYBOARD CURSOR over the cards (owner, 2026-07-27): up/down move a highlight that STAYS where it was left, Enter opens the current
card's Detail. This is the legacy PowerBuilder gesture, and it is here for one reason — the operator walks off to the racks mid-task
and comes back having forgotten which of a dozen near-identical black Arizonas they were on. It walks the RENDERED window, and
arrowing onto the last rendered card extends it — so the keyboard can reach the whole list without touching the mouse, and never
points at a card that isn't painted. The mechanics live in the shared `useListCursor` hook; this page supplies the keys, when it is
enabled, what Enter does, and the look of the highlight. Detail's open/closed state had to move UP here for Enter to drive it, so
InvStyleCard now takes it as a prop.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, ArrowPathIcon, XMarkIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getInvStyles, InvStyleRow } from '@/lib/api';
import InvStyleCard from '@/components/InvStyleCard';
import { useApiQuery } from '@/lib/useApiQuery';
import { useListCursor } from '@/lib/useListCursor';

// One applied narrowing step. `has` keeps matching rows; `not` drops them.
interface FilterStep {
  op: 'has' | 'not';
  term: string;
}

// A worded quantity command, typed in the Contains box (owner — plain-English keywords, not "<10" symbols, so they never clash with a
// future "<"/">" meaning and read the same as the SOLD pair): "STOCK LESS 10" / "SOLD MORE 5". `metric` picks which per-row number it
// compares against (see `metricValue`); `less`/`more` are strict (< / >). One per metric is active at a time; a new command for the
// same metric replaces it. Kept apart from the text steps (like the size filter) because it is a numeric compare, not a find.
type QtyMetric = 'stock' | 'sold';
interface QtyFilter {
  metric: QtyMetric;
  op: 'less' | 'more';
  n: number;
}

// The per-row number each metric compares against:
//  - stock = local + Amazon-held: the "what have we got in hand right now" figure. Deliberately NOT row.total (that folds in the Birk
//    pre-order book — future stock, which shouldn't sway a drop decision).
//  - sold = sold30: units sold in the last 30 days (all channels), the "is it moving" figure weighed against stock to decide a drop.
function metricValue(r: InvStyleRow, metric: QtyMetric): number {
  return metric === 'stock' ? r.local + r.amazon : r.sold30;
}

// SORTING (owner). A visible, click-to-reverse control rather than a worded command: sorting is a MODE you sit in and flip, not a
// one-shot action like the STOCK/SOLD filters, so it needs a standing affordance that shows the current key + direction. Client-side —
// the whole list is already in memory, same as the filters. Each key clicks in at a sensible default direction (see DEFAULT_DIR);
// clicking the active key again reverses it. Keys deliberately limited to Title / Stock / Sold (owner) — the raw numbers, no derived metric.
type SortKey = 'created' | 'title' | 'stock' | 'sold';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'created', label: 'Added' },
  { key: 'title', label: 'Title' },
  { key: 'stock', label: 'Stock' },
  { key: 'sold', label: 'Sold' },
];
// The direction a key adopts when first picked: Title A→Z, but Added/Stock/Sold high→low (newest first; and the drop review wants the
// big piles and the dead sellers at the top). Re-clicking the active key toggles from here.
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = { created: 'desc', title: 'asc', stock: 'desc', sold: 'desc' };

// The value a row sorts on for a given key. Title falls back to groupid so an untitled style still lands somewhere sensible.
function sortValue(r: InvStyleRow, key: SortKey): number | string {
  // `created` is skusummary.created_at, already rendered server-side as 'YYYYMMDD HH24:MI:SS' — that shape sorts correctly as plain
  // text, so no Date parsing here and no BST day-shift. An unstamped style reads as '' and lands at the bottom of newest-first, which
  // is where an unknown date belongs.
  if (key === 'created') return r.created || '';
  if (key === 'title') return (r.title || r.groupid).toLowerCase();
  if (key === 'stock') return r.local + r.amazon;
  return r.sold30;
}

// How many cards are painted at a time (see the window note in the header). Every match is shown eventually; this is only how far the
// DOM has been built so far. One chunk comfortably overfills a screen, so the next is painted well before the operator reaches it.
const CARD_CHUNK = 40;
// How early the sentinel extends the window — about a screen of slack, so the next chunk is already there when it is scrolled to and
// the list never visibly stops.
const CHUNK_ROOT_MARGIN = '800px';

// The text a filter step is matched against. Built once per row and cached. Lowercased here so each step is a plain indexOf.
// Includes the style's Amazon Seller SKUs (skumap.sku) so a pasted Amazon SKU like 17659-23-42-2607 — which doesn't share the internal
// code — still finds its style (owner, 2026-07-25).
function haystack(r: InvStyleRow): string {
  return `${r.title || ''} ${r.groupid} ${r.segment || ''} ${r.amazonSkus || ''}`.toLowerCase();
}

// Escape a user term so it can go inside a RegExp literally (a stray "." or "(" would otherwise be a metachar).
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalise a size token for matching, so a typed "5" finds a stored "05" and "41" finds "41".
function normSize(s: string): string {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? String(n) : s.trim().toLowerCase();
}

// Stable "no rows yet" identity — the list feeds the `indexed` useMemo, so a fresh [] each render would rebuild the whole
// search index on every render.
const NO_ROWS: InvStyleRow[] = [];

// An indexed row: the row plus its pre-built lowercase haystack (see `haystack`).
interface IndexedRow { row: InvStyleRow; hay: string }

// The full set of narrowings in force. Bundled into one shape because onFind has to be able to TRY a set of criteria (see the
// start-fresh rule there) before committing it to state — so the filter pass has to be callable on criteria that aren't the
// current state yet.
interface Criteria {
  steps: FilterStep[];
  sizeTarget: string | null;
  sizeStrict: boolean;
  qty: QtyFilter[];
}

// Local stock a style holds in the filtered size (0 if none / no size filter).
function sizeQtyIn(r: InvStyleRow, sizeTarget: string | null): number {
  if (sizeTarget === null) return 0;
  let q = 0;
  for (const [k, v] of Object.entries(r.localSizes)) {
    if (normSize(k) === sizeTarget) q += v;
  }
  return q;
}

// Apply every text step in order (ANDed), then the size filter, then the numeric commands. The one place the narrowing is defined,
// so the on-screen list and onFind's "would this find anything?" probe can never drift apart.
function applyCriteria(indexed: IndexedRow[], c: Criteria): IndexedRow[] {
  let out = indexed;
  for (const s of c.steps) {
    const t = s.term.toLowerCase();
    if (s.op === 'has') {
      // CONTAINS stays a plain substring — the operator types partials ("ARIZ" must find "Arizona"), so narrowing has to be loose.
      out = out.filter((x) => x.hay.includes(t));
    } else {
      // DOES NOT CONTAIN matches WHOLE WORDS. A plain substring here is a footgun: excluding the colour "SAND" also matched the SAND
      // inside "SANDALS" and wiped every result (owner, 2026-07-23). \b…\b so an exclusion only drops the word you named, not a longer
      // word that happens to start with it. Built once per step, not per row.
      const re = new RegExp(`\\b${escapeRegExp(t)}\\b`);
      out = out.filter((x) => !re.test(x.hay));
    }
  }
  if (c.sizeTarget !== null && c.sizeStrict) out = out.filter((x) => sizeQtyIn(x.row, c.sizeTarget) > 0);
  // STOCK / SOLD commands, last: numeric compares (ANDed). Strict (< / >), so "STOCK LESS 10" excludes exactly-10.
  for (const f of c.qty) {
    out = out.filter((x) => {
      const v = metricValue(x.row, f.metric);
      return f.op === 'less' ? v < f.n : v > f.n;
    });
  }
  return out;
}

export default function InventoryPage() {



  // The two input boxes, and the ordered list of steps applied so far.
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const [steps, setSteps] = useState<FilterStep[]>([]);

  // SIZE filter — a SINGLE value kept apart from the text steps so it can be swapped or cleared on its own (41 -> 40 as the customer
  // asks) without re-typing the text hunt. Filters to styles holding that size locally; each card then leads with that size's count.
  const [sizeInput, setSizeInput] = useState('');
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const sizeTarget = useMemo(() => (sizeFilter ? normSize(sizeFilter) : null), [sizeFilter]);
  // Does the size filter EXCLUDE styles that are sold out in that size? True for the standalone Size box (a "who's got a 41?" browse —
  // a style with none is noise). FALSE when the size was inferred from a pasted SKU like 0151183-ARIZONA-38: that is a targeted lookup
  // of ONE style, so we must still show its card (leading with 38, greyed at 0) rather than "No styles match" (owner, 2026-07-23).
  const [sizeStrict, setSizeStrict] = useState(true);

  // STOCK / SOLD worded filters — one active per metric, keyed by metric so a STOCK command and a SOLD command can both be on at once
  // (e.g. "loads of stock, barely selling" = STOCK MORE 20 + SOLD LESS 3). Each ✕ clears just its own.
  const [qtyFilters, setQtyFilters] = useState<Partial<Record<QtyMetric, QtyFilter>>>({});
  const setQtyFilter = useCallback((f: QtyFilter) => setQtyFilters((prev) => ({ ...prev, [f.metric]: f })), []);
  const clearQtyFilter = useCallback((metric: QtyMetric) => setQtyFilters((prev) => {
    const next = { ...prev };
    delete next[metric];
    return next;
  }), []);

  // The command cheatsheet, behind an "i" — the search commands are a niche power feature, so they live in a toggle rather than a
  // permanent hint that shouts at every operator (owner). Grows as more commands land (SOLD MORE, …).
  const [showHelp, setShowHelp] = useState(false);

  // Sort mode — default NEWEST ADDED FIRST (owner, 2026-07-28). Now that the screen opens on the whole catalogue rather than a blank
  // box, the opening order is a real editorial choice: what has just come in is what the operator most often has a question about,
  // and it puts the styles nobody has looked at yet in front of them without anyone searching for something they don't know is there.
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Pick a key: re-clicking the active one reverses; a new key adopts its default direction. Written as two plain setState calls off the
  // CURRENT sortKey (not nested inside a setSortKey updater) — nesting made the reverse toggle twice under React StrictMode's double-invoke
  // and appear to do nothing.
  const onSort = useCallback((key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(DEFAULT_DIR[key]); }
  }, [sortKey]);

  // CUT: groupids the operator has hidden by hand — the manual trim for a straggler a text step can't drop without over-matching.
  // Purely view state: nothing is written, Restore or Reset brings them back.
  const [cut, setCut] = useState<Set<string>>(new Set());

  // Reset hands focus straight back to Contains so the next hunt starts by typing.
  const containsRef = useRef<HTMLInputElement>(null);

  // Fetch the whole list. On mount, and again on Reset — Reset is the "start a fresh hunt" moment, so it doubles as refresh-from-DB
  // (mirrors PowerBuilder). Between refreshes the list is a snapshot filtered in the browser with no round-trip. `busy` (not
  // isLoading) drives the spinner so a Reset re-fetch shows it too, matching the old setLoading(true) at the top of the loader.
  const { data, error: loadError, busy: loading, refresh: loadStyles } = useApiQuery(
    ['inv-styles'],
    () => getInvStyles(),
  );
  const rows: InvStyleRow[] = data?.rows ?? NO_ROWS;
  const error = loadError?.message ?? null;

  // Pre-compute each row's haystack once per fetch, not once per filter pass.
  const indexed = useMemo(() => rows.map((r) => ({ row: r, hay: haystack(r) })), [rows]);

  // THE LIST IS THE OPENING VIEW (owner, 2026-07-28). It used to stay blank until the first Find, on the reasoning that a wall of
  // pictures nobody asked for was noise. That is reversed: the catalogue newest-first IS a useful thing to land on, and the blank box
  // made the screen feel switched off. So filters now narrow a list that is always there, and Reset returns to the whole catalogue
  // rather than to nothing. (Which is affordable because of the rendered window below — only a chunk is ever painted.)
  const activeQty = useMemo(() => Object.values(qtyFilters).filter(Boolean) as QtyFilter[], [qtyFilters]);
  // Is anything narrowing the list? No longer gates the display — it only decides whether to show the "of N" total and the ✕ chips.
  const filtering = steps.length > 0 || sizeFilter !== null || activeQty.length > 0;

  const filtered = useMemo(
    () => applyCriteria(indexed, { steps, sizeTarget, sizeStrict, qty: activeQty }).map((x) => x.row),
    [indexed, steps, sizeTarget, sizeStrict, activeQty],
  );

  // What actually shows = the text-filtered rows minus the hand-cut ones.
  const visible = useMemo(() => filtered.filter((r) => !cut.has(r.groupid)), [filtered, cut]);
  const cutInView = filtered.length - visible.length;

  // Apply the sort mode to what's on screen. groupid is the stable tie-break (always ascending) so equal stock/sold rows keep a fixed
  // order rather than jittering between renders.
  const sortedVisible = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...visible].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const d = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
      if (d === 0) return a.groupid.localeCompare(b.groupid);
      return d * dir;
    });
  }, [visible, sortKey, sortDir]);

  // ---- The rendered window (owner, 2026-07-28) ---------------------------------------------------------------------------------
  // How many of the matches are actually in the DOM. Every match is reachable — this is paint budget, not a filter, so nothing here
  // may ever change WHICH styles count (the breadcrumb still reports the full match count).
  //
  // The window is STAMPED WITH THE CRITERIA it was grown under, and a stamp that no longer matches simply reads as one chunk. That
  // makes "start again at the top when the search changes" a derived value rather than a reset effect — no second render, and no
  // window of one render where a new result set is still showing the old scroll depth. Deliberately keyed on the CRITERIA and not on
  // `visible`/`sortedVisible`: cutting one straggler must not throw away everything already scrolled, which is the opposite of what a
  // cut is for.
  const criteriaKey = useMemo(
    () => JSON.stringify([steps, sizeFilter, sizeStrict, activeQty, sortKey, sortDir]),
    [steps, sizeFilter, sizeStrict, activeQty, sortKey, sortDir],
  );
  const [win, setWin] = useState<{ key: string; n: number }>({ key: '', n: CARD_CHUNK });
  const shown = win.key === criteriaKey ? win.n : CARD_CHUNK;
  const rendered = useMemo(() => sortedVisible.slice(0, shown), [sortedVisible, shown]);
  const moreCount = sortedVisible.length - rendered.length;
  const extend = useCallback(
    () => setWin((w) => ({ key: criteriaKey, n: (w.key === criteriaKey ? w.n : CARD_CHUNK) + CARD_CHUNK })),
    [criteriaKey],
  );
  const showAll = useCallback(() => setWin({ key: criteriaKey, n: sortedVisible.length }), [criteriaKey, sortedVisible.length]);

  // ---- Keyboard cursor over the cards (owner, 2026-07-27) --------------------------------------------------------------------
  // The operators work this screen from the keyboard and walk away from it mid-task ("find the 39, go to the rack, come back") —
  // and were losing their place in the stack. So the browse gets the legacy list gesture back: up/down moves a highlight that STAYS
  // until moved, Enter opens the current card's Detail. Keys are the RENDERED rows only — the cursor must never point at a card that
  // isn't painted (it would scroll to nothing) — and landing on the last one extends the window, so ↓ alone walks the whole list.
  const cursorKeys = useMemo(() => rendered.map((r) => r.groupid), [rendered]);

  // Detail open/closed now lives HERE rather than inside each card, so Enter can drive it (InvStyleCard takes it as a prop). A set,
  // not a single id, because cards open independently — one card's Detail must never collapse another's.
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set());
  const toggleDetail = useCallback((groupid: string) => {
    setDetailOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(groupid)) next.add(groupid);
      return next;
    });
  }, []);

  // Arrowing onto the LAST rendered card pulls the next chunk in, so the keyboard can walk the whole list without ever touching the
  // mouse. It hangs off the cursor's own move event (which reports the row being moved TO) rather than watching cursorKey in an
  // effect — the growth is caused by the keypress, and doing it in the handler avoids a cascading render. Extending only ADDS keys,
  // so the cursor keeps its place.
  const lastRenderedKey = rendered.length > 0 ? rendered[rendered.length - 1].groupid : null;
  const onCursorMove = useCallback(
    (key: string) => { if (moreCount > 0 && key === lastRenderedKey) extend(); },
    [moreCount, lastRenderedKey, extend],
  );

  const cursor = useListCursor({
    keys: cursorKeys,
    enabled: !loading && !error,
    onEnter: toggleDetail,
    onMove: onCursorMove,
    // 'center': the list moves under a highlight that sits mid-screen, the way the legacy grid felt — you always have the next few
    // cards in view rather than arrowing into the bottom edge. Trying this against the default 'nearest' (owner, 2026-07-27); the
    // cards are tall, which is what makes the difference noticeable here.
    scrollBlock: 'center',
  });

  // Auto-extend on scroll: a sentinel below the last card, watched with an IntersectionObserver. Re-armed on each `shown` change
  // because the sentinel moves down the page as the window grows. (No data fetching here — everything is already in memory; this only
  // decides how much of it is painted.)
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || moreCount === 0) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) extend(); },
      { rootMargin: CHUNK_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [moreCount, shown, extend]);

  // FIND: turn whatever is in the boxes into steps, then clear the boxes. Blank boxes are ignored.
  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const next: FilterStep[] = [];
    // A trailing "-38" / "-42.5" on a groupid-shaped term is a SIZE, not part of the code (operators paste a full SKU like
    // 0151183-ARIZONA-38 when they mean "that style, in 38"). The groupid never carries the size, so the raw term matches nothing.
    // Split it off into the Size box: the search then narrows to the style AND each card leads with that size's count / rack (owner,
    // 2026-07-23). Only fires when the term STARTS with a code (a digit then a dash, i.e. a real groupid), so a hyphen in ordinary
    // title text isn't mistaken for a size. An explicitly typed Size box always wins over one inferred from the term.
    let containsTerm = contains.trim();
    let sizeFromTerm = '';
    let nextQty: QtyFilter | null = null;
    // FIRST CHECK (owner): a worded "STOCK/SOLD LESS <n>" / "…MORE <n>" in the Contains box is a quantity filter, not a text find, so it
    // is matched BEFORE the text/SKU logic — otherwise "STOCK" would leak through as a title substring and match nothing. The keyword is
    // caps because the box force-uppercases input. Matched, it branches here: set the filter and consume the term (no text step). Any
    // integer or one decimal place is accepted; STOCK compares combined local+Amazon, SOLD the 30-day sold count.
    const qtyMatch = containsTerm.match(/^(STOCK|SOLD)\s+(LESS|MORE)\s+(\d+(?:\.\d+)?)$/);
    if (qtyMatch) {
      nextQty = { metric: qtyMatch[1] === 'STOCK' ? 'stock' : 'sold', op: qtyMatch[2] === 'LESS' ? 'less' : 'more', n: Number(qtyMatch[3]) };
      containsTerm = '';
    } else {
      const sizeMatch = containsTerm.match(/^(\d[\dA-Z]*-.+?)-(\d{1,2}(?:\.\d)?)$/);
      if (sizeMatch) { containsTerm = sizeMatch[1]; sizeFromTerm = sizeMatch[2]; }
    }
    if (containsTerm) next.push({ op: 'has', term: containsTerm });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    const size = sizeInput.trim() || sizeFromTerm;
    if (next.length === 0 && !size && !nextQty) return;

    // Strict (exclude sold-out) only when the size was typed in its own box; a size split off a pasted SKU is a targeted lookup, so
    // it must not hide the one style it points at just because that size is out.
    const nextStrict = !!sizeInput.trim();

    // START FRESH WHEN THE NARROWING WOULD EMPTY THE LIST (owner, 2026-07-27). Each Find normally narrows what is already on screen,
    // but the operator often uses the box to start a NEW hunt ("ARIZONA" … then "IVES"), and stacked on the old steps that can only
    // ever find nothing. So: probe the merged criteria first; if they match no styles AND something was already applied, treat this
    // Find as a brand-new entry — drop every existing step/size/qty/cut and run the new terms alone. Only if THAT is also empty does
    // "No styles match" appear. Probing (rather than reacting to an empty render) means the dead intermediate state never paints.
    const hadFilters = steps.length > 0 || sizeFilter !== null || activeQty.length > 0;
    const mergedQty = nextQty ? { ...qtyFilters, [nextQty.metric]: nextQty } : qtyFilters;
    const merged: Criteria = {
      steps: [...steps, ...next],
      sizeTarget: size ? normSize(size) : sizeTarget,
      sizeStrict: size ? nextStrict : sizeStrict,
      qty: Object.values(mergedQty).filter(Boolean) as QtyFilter[],
    };
    const startFresh = hadFilters && applyCriteria(indexed, merged).length === 0;

    if (startFresh) {
      setSteps(next);
      setQtyFilters(nextQty ? { [nextQty.metric]: nextQty } : {});
      setSizeFilter(size || null);
      setSizeStrict(size ? nextStrict : true);
      setCut(new Set());
      // No announcement (owner, 2026-07-27): the breadcrumb already shows exactly the one step now in force, and the operator has the
      // rows they wanted — a banner explaining what didn't happen is just something to read.
    } else {
      if (nextQty) setQtyFilter(nextQty);
      if (next.length > 0) setSteps((prev) => [...prev, ...next]);
      if (size) {
        setSizeFilter(size);
        setSizeStrict(nextStrict);
      }
    }
    setContains('');
    setNotContains('');
    setSizeInput('');
    containsRef.current?.focus();
  }

  // Cut one row from the view. (No row click to stop propagating from anymore — the card owns its own clicks — so this is a plain hide.)
  function onCut(groupid: string) {
    setCut((prev) => {
      const next = new Set(prev);
      next.add(groupid);
      return next;
    });
  }

  // Restore all cuts without touching the filter or re-reading the DB — the light undo for a mis-cut.
  function restoreCuts() {
    setCut(new Set());
  }

  // Reset = back to the opening view: the WHOLE catalogue, newest first. Not a blank screen — the list is the resting state of this
  // screen now, so Reset is "show me everything again", the same thing the operator sees on arrival.
  function onReset() {
    setSteps([]);
    setContains('');
    setNotContains('');
    setSizeInput('');
    setSizeFilter(null);
    setSizeStrict(true);
    setQtyFilters({});
    setSortKey('created');
    setSortDir('desc');
    setCut(new Set());
    // Drop the keyboard cursor and any open Detail (owner, 2026-07-28). Clearing the steps does NOT empty the underlying list — with no
    // filters `sortedVisible` is every style — so the cursor's row survives Reset and the highlight would reappear on the previous
    // hunt's row. Reset means "start again", so the place-keeping the cursor exists to provide is exactly what should go.
    cursor.setCursor(null);
    setDetailOpen(new Set());
    // Stamp the window with a key no criteria can produce, so it reads as one chunk again from a standing start.
    setWin({ key: '', n: CARD_CHUNK });
    // Reset also RE-READS the list from the DB, so stock figures are fresh at the start of a new hunt (owner — as in PowerBuilder).
    loadStyles();
    containsRef.current?.focus();
  }

  return (
    <AppShell title="Inventory" subtitle="Find stock by title, groupid or segment">
      {/* ---- Command bar ---------------------------------------------------------------------------------------------------
          NOT sticky (owner, 2026-07-27, on trial). It used to stay pinned so the filter was always to hand mid-browse, but once the
          keyboard cursor arrived the bar sat still while cards streamed under it — too much happening at once to read comfortably
          while arrowing. Scrolling it away leaves the moving cards as the only thing moving. To pin it again: `sticky top-0 z-20`
          plus the solid backdrop (`bg-slate-50/95 backdrop-blur`) that stops cards showing through. */}
      <div className="-mx-4 mb-4 border-b border-slate-200 px-4 pb-3 pt-1">
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
                  className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
              <input
                value={notContains}
                onChange={(e) => setNotContains(e.target.value.toUpperCase())}
                placeholder="e.g. EVA"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            {/* Size — its own box. Filters to styles with that size in LOCAL stock; each card then leads with that size's count. */}
            <div className="w-24">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Size</label>
              <input
                value={sizeInput}
                onChange={(e) => setSizeInput(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 41"
                title="Show only styles with this size in local stock"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <button type="submit" className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
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
            {/* Command cheatsheet toggle — quiet "i" rather than a permanent tip line (owner: the commands are a power feature, don't
                shout them at everyone). Opens the brief list below. */}
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              title="Search commands"
              aria-expanded={showHelp}
              className={`flex items-center rounded-md border px-2 py-2 ${showHelp ? 'border-slate-400 bg-slate-100 text-slate-600' : 'border-slate-300 text-slate-400 hover:bg-slate-50'}`}
            >
              <QuestionMarkCircleIcon className="h-5 w-5" />
            </button>
          </div>

          {/* The cheatsheet — hidden until the "i" is pressed. Kept VERY brief (owner); one line per command. Grows with more commands. */}
          {showHelp && (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="mb-1 font-medium uppercase tracking-wide text-slate-400">Commands — type in Contains, then Find</div>
              <ul className="space-y-1">
                <li>
                  <span className="font-mono text-slate-700">STOCK LESS 10</span> · <span className="font-mono text-slate-700">STOCK MORE 5</span>
                  <span className="text-slate-400"> — filter by total stock (local + Amazon)</span>
                </li>
                <li>
                  <span className="font-mono text-slate-700">SOLD LESS 3</span> · <span className="font-mono text-slate-700">SOLD MORE 10</span>
                  <span className="text-slate-400"> — filter by units sold in the last 30 days</span>
                </li>
              </ul>
            </div>
          )}

          {/* Breadcrumb of applied steps + the row count, at the top where the operator uses it to decide whether to narrow again. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
            <span className="mr-1 whitespace-nowrap text-slate-500">
              {filtering ? (
                <>Rows: <span className="font-semibold text-slate-800">{visible.length}</span><span className="text-slate-400"> of {rows.length}</span></>
              ) : (
                <><span className="font-semibold text-slate-800">{rows.length}</span><span className="text-slate-400"> styles</span></>
              )}
            </span>
            {/* Keyboard hint — only where the cursor actually works (cards painted). Nothing announces the gesture otherwise, and an
                operator who never presses ↓ never discovers the thing that stops them losing their place. */}
            {visible.length > 0 && (
              <>
                <span className="text-slate-300">|</span>
                <span className="whitespace-nowrap text-xs text-slate-400">↑↓ move · Enter opens detail</span>
              </>
            )}
            {cutInView > 0 && (
              <>
                <span className="text-slate-300">|</span>
                <span className="whitespace-nowrap text-slate-400">
                  {cutInView} cut
                  <button type="button" onClick={restoreCuts} className="ml-1.5 font-medium text-brand-600 hover:underline">
                    restore
                  </button>
                </span>
              </>
            )}
            {/* Only the STRICT size filter (typed in its own box) earns a removable chip here — it actually narrows the list, so its ✕
                changes the result. A size split off a pasted SKU narrows nothing (it only leads the one card with that size), so a
                removable "filter" chip would be a no-op affordance — ✕ leaves the same rows on screen (owner, 2026-07-23). That size is
                shown ON the card instead ("Size 38 — 0 on the shelf"); to drop it, Reset. */}
            {sizeFilter && sizeStrict && (
              <>
                <span className="text-slate-300">|</span>
                <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
                  Size {sizeFilter} · local
                  <button
                    type="button"
                    // Clearing hands focus straight back to Contains, so the next hunt starts by typing — same as the stock chip (owner).
                    onClick={() => { setSizeFilter(null); containsRef.current?.focus(); }}
                    title="Clear size filter"
                    className="ml-0.5 rounded text-indigo-400 hover:text-indigo-700"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </span>
              </>
            )}
            {/* STOCK / SOLD chips — real narrowing filters, so each earns a removable ✕ like the size chip: clearing changes the result.
                One chip per active metric; the ✕ clears just that metric and hands focus back to Contains for the next command (owner). */}
            {activeQty.map((f) => (
              <span key={f.metric} className="flex items-center gap-1.5">
                <span className="text-slate-300">|</span>
                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                  {f.metric === 'stock' ? 'Stock' : 'Sold 30d'} {f.op === 'less' ? '<' : '>'} {f.n}
                  <button
                    type="button"
                    onClick={() => { clearQtyFilter(f.metric); containsRef.current?.focus(); }}
                    title={`Clear ${f.metric} filter`}
                    className="ml-0.5 rounded text-emerald-400 hover:text-emerald-700"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </span>
              </span>
            ))}
            {steps.length > 0 && (
              <>
                <span className="text-slate-300">|</span>
                {steps.map((s, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-slate-300">›</span>}
                    <span
                      className={
                        s.op === 'has'
                          ? 'rounded bg-brand-50 px-2 py-0.5 font-medium text-brand-700'
                          : 'rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-500 line-through decoration-slate-400'
                      }
                    >
                      {s.op === 'not' && <span className="mr-0.5 no-underline">¬</span>}
                      {s.term}
                    </span>
                  </span>
                ))}
              </>
            )}

            {/* SORT — inside the command box, pushed to the RIGHT of the breadcrumb (ml-auto) so the filter badges keep the left (owner).
                Only shown once there is something to sort. Active key is filled and carries its ↑/↓; clicking it again reverses (onSort). */}
            {filtered.length > 0 && (
              <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
                <span className="mr-0.5 text-xs text-slate-400">Sort</span>
                {SORTS.map((s) => {
                  const active = sortKey === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => onSort(s.key)}
                      className={
                        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition ' +
                        (active
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')
                      }
                    >
                      {s.label}
                      {active && <span className="text-brand-500">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  );
                })}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* ---- Results ----------------------------------------------------------------------------------------------------- */}
      {loading && <p className="text-sm text-slate-400">Loading stock…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}


      {/* The browse. Shown from the first paint, whether or not anything is filtering — EVERY match gets a card, and `rendered` is
          just how far the window has been painted (see the header). */}
      {!loading && !error && (
        <div className="space-y-3">
          {rendered.map((r) => (
            <div
              key={r.groupid}
              ref={cursor.itemRef(r.groupid)}
              // Clicking anywhere on a card takes the cursor with it, so the keyboard picks up from wherever the mouse left off.
              onClick={() => cursor.setCursor(r.groupid)}
              // scroll-mt is the clearance for a STICKY command bar (a card scrolled to the viewport top would otherwise sit under
              // it). The bar is unstuck at the moment and 'center' scrolling barely uses this — kept so pinning the bar again is a
              // one-line change that doesn't quietly start hiding the current card.
              className={
                'group relative scroll-mt-36 rounded-lg ' +
                (cursor.isCursor(r.groupid) ? 'ring-2 ring-brand-500' : '')
              }
            >
              {/* The "you are here" bar. The ring alone reads as focus; this reads across a room, which is the actual job — the
                  operator comes back from the racks and has to re-find their place at a glance. */}
              {cursor.isCursor(r.groupid) && (
                <div className="absolute left-0 top-0 z-10 h-full w-1 rounded-l-lg bg-brand-500" />
              )}
              <InvStyleCard
                row={r}
                sizeFilter={sizeFilter}
                detailOpen={detailOpen.has(r.groupid)}
                onToggleDetail={() => toggleDetail(r.groupid)}
              />
              {/* Cut — muted until the card is hovered, then reddens. Sits top-right, out of the way of the picture and sizes. */}
              <button
                type="button"
                onClick={() => onCut(r.groupid)}
                title="Cut from list (Restore or Reset brings it back)"
                // Always faintly visible (owner, 2026-07-23) — a muted grey cross so the cut is discoverable without hovering, then
                // reddens on hover to confirm it's the remove control. The old opacity-0/group-hover made it invisible until the cursor
                // was over the card, so it read as missing.
                className="absolute right-2 top-2 rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ))}

          {/* The window's foot. The sentinel sits here and pulls the next chunk in as it nears the viewport, so scrolling just works;
              the line is what the operator sees while that happens, and "Show all" paints the remainder in one go for a Ctrl+F over
              the whole result. Rendered only while there IS more — at the end of the list there is nothing to say. */}
          {moreCount > 0 && (
            <div ref={sentinelRef} className="flex items-center justify-center gap-3 py-4 text-sm text-slate-400">
              <span>
                Showing {rendered.length} of {sortedVisible.length} — loading more…
              </span>
              <button
                type="button"
                onClick={showAll}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Show all {sortedVisible.length}
              </button>
            </div>
          )}

          {visible.length === 0 && cutInView > 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 shadow-sm">
              All {cutInView} matching {cutInView === 1 ? 'style is' : 'styles are'} cut.{' '}
              <button type="button" onClick={restoreCuts} className="text-brand-600 underline">Restore</button> to bring {cutInView === 1 ? 'it' : 'them'} back.
            </div>
          )}
          {filtered.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 shadow-sm">
              No styles match. <button type="button" onClick={onReset} className="text-brand-600 underline">Reset</button> to start again.
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
