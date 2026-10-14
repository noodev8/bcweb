'use client';
/*
=======================================================================================================================================
Page: /collections — Collections
=======================================================================================================================================
Purpose: Put styles into Shopify collections and take them out, by TAG, picking them with filters. Owner, 2026-10-14: "A simple screen
         where I can tag/untag based on a set of criteria or filters. Allow up to 3 tags per style so I can put them in multiple
         collections. Store in database and I will manage tags from here only." The mindset behind it: "create a group, focus on it and
         get it selling". Separate from Slow on purpose — Slow says what is stuck (a fact), this is where the choice is made. Slow keeps
         its own clearance buttons for now; both write through the same rules (server: utils/collectionTags.js).

WHAT A COLLECTION IS HERE: a tag. The DATABASE holds who has which tag (collection / collection_member) and Shopify carries a copy — every
         add / remove changes both, one style at a time. The OWNER builds each smart collection in Shopify admin ("Product tag is equal
         to <tag>"); this screen never creates one there. No dates, no Google campaign link, no pricing (owner: "Too complex to start").

THE LIST: every style live on Shopify, PLUS every style carrying a tag whatever its flag (owner: "if I switched shopify OFF I would still
         have the tag and not be able to remove it") — switching Shopify off doesn't unpublish, so an OFF style stays in the collection
         on the store and must stay visible here, marked "Shopify OFF". Newest added first, like Inventory.

THE SEARCH IS THE STANDARD ONE (owner: "use our standard contains / doesnt contain search logic") — Inventory's rules:
  - Contains / Does not contain, Enter or Find commits them as steps; steps stack and all must match. PLAIN SUBSTRING both ways over
    title, groupid, segment, codes, supplier (+ brand) — never a whole-word test (see Inventory's applyCriteria for why ¬WOMEN needs it).
  - A Find that would empty the list starts a NEW hunt (the steps are replaced) instead of showing nothing.
  - Typed commands: STOCK / SOLD LESS|MORE n, WINTER / SUMMER. STOCK compares the PAIRS column (local + Amazon) — unlike Inventory,
    whose STOCK is the shelf only, because here the question is "how much is there to clear", and filtering on a number you can't see
    on the row would read as broken. SOLD = sold in 30 days, all channels (Inventory's).
  - Cut hides rows from view only; Reset clears everything and re-reads.
  On top: SLOW and NEW toggles (the Slow screen's own 90-day rule, from the server — never restated here), and a COLLECTION base
  (pick a collection in the panel: "In clearance", flip to "Not in clearance"). No In-stock filter (owner: "too big").

THE COLLECTION PANEL has its own filter box (owner: "have somewhere to filter existing collection list") and "New collection". Each chip
         shows its count and how many are Shopify OFF.

TAGGING: a row's + adds a tag, a tag's × removes it; tick rows (or the header box for every row shown) and Add / Remove in bulk. The
         server refuses a row that is Shopify OFF or already has 3 tags, and says why; Remove always works.

LEAVING AND COMING BACK (owner: "Allow navigation out of that screen with our standard routes (Shopify price, inventory etc apart from
         Amazon)"): click a row to select it and the standard product cards light up — Product, Sales, Inventory, Edit Product, Shopify
         Order, Shopify Price (ProductNavCards shopifyOnly). GROUPID opens the Shopify price drill. "Google Ads →" hands over EXACTLY the
         rows on screen (lib/collectionHandoff.ts — the list, not the search) as a chip there. Every way out saves this screen's view to
         sessionStorage first and leaves with ?restore=1 as the return address, the Google Ads pattern, so ← Back lands where you were.
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MagnifyingGlassIcon, ArrowPathIcon, XMarkIcon, QuestionMarkCircleIcon, ArrowsRightLeftIcon, PlusIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import ProductNavCards from '@/components/ProductNavCards';
import { SortableTh, useTableSort } from '@/components/SortableTh';
import { prettyPathLabel } from '@/lib/nav';
import { useApiQuery } from '@/lib/useApiQuery';
import { writeCollectionHandoff } from '@/lib/collectionHandoff';
import {
  getCollections, getCollectionStyles, createCollection, setCollectionTag, CollectionStyleRow, CollectionSetResult,
} from '@/lib/api';

// ---- Filtering ----------------------------------------------------------------------------------------------------------------------

interface FilterStep { op: 'has' | 'not'; term: string }
type QtyMetric = 'stock' | 'sold';
interface QtyFilter { metric: QtyMetric; op: 'less' | 'more'; n: number }
type Season = 'Winter' | 'Summer';
// The collection the list starts from: in it, or not in it.
interface Base { tag: string; side: 'in' | 'out' }

interface Criteria {
  steps: FilterStep[];
  qty: QtyFilter[];
  season: Season | null;
  slow: boolean;
  isNew: boolean;
  base: Base | null;
}

// The Inventory haystack (title, groupid, segment, codes, supplier) plus brand — the brand is usually in the title already, but a
// collection is often a brand ("Caprice"), so it is searched directly too.
function haystack(r: CollectionStyleRow): string {
  return `${r.title || ''} ${r.groupid} ${r.segment || ''} ${r.codes || ''} ${r.supplier || ''} ${r.brand || ''}`.toLowerCase();
}
interface IndexedRow { row: CollectionStyleRow; hay: string }

// 'Any' is year-round and answers to BOTH seasons (Inventory's rule).
function inSeason(r: CollectionStyleRow, season: Season | null): boolean {
  if (season === null) return true;
  const tag = (r.season || '').trim().toLowerCase();
  return tag === season.toLowerCase() || tag === 'any';
}

const metricValue = (r: CollectionStyleRow, m: QtyMetric) => (m === 'stock' ? r.pairs : r.sold30);

// The one place the narrowing is defined, so the list and onFind's "would this find anything?" probe can never disagree.
function applyCriteria(indexed: IndexedRow[], c: Criteria): IndexedRow[] {
  let out = indexed;
  if (c.base) {
    const { tag, side } = c.base;
    out = out.filter((x) => x.row.tags.includes(tag) === (side === 'in'));
  }
  if (c.slow) out = out.filter((x) => x.row.slow);
  if (c.isNew) out = out.filter((x) => x.row.new);
  for (const s of c.steps) {
    const t = s.term.toLowerCase();
    // PLAIN SUBSTRING, both ways — Inventory's rule (owner: "If something takes it out (women) then it is out").
    out = s.op === 'has' ? out.filter((x) => x.hay.includes(t)) : out.filter((x) => !x.hay.includes(t));
  }
  if (c.season !== null) out = out.filter((x) => inSeason(x.row, c.season));
  for (const f of c.qty) {
    out = out.filter((x) => {
      const v = metricValue(x.row, f.metric);
      return f.op === 'less' ? v < f.n : v > f.n;
    });
  }
  return out;
}

// A typed command is consumed as a command, not searched for as text (Inventory's parseContains, without the size split — a pasted
// size code already matches through `codes`).
function parseContains(raw: string): { term: string; qty: QtyFilter | null; season: Season | null } {
  const term = raw.trim();
  const season = term.match(/^(WINTER|SUMMER)$/);
  if (season) return { term: '', qty: null, season: season[1] === 'WINTER' ? 'Winter' : 'Summer' };
  const q = term.match(/^(STOCK|SOLD)\s+(LESS|MORE)\s+(\d+(?:\.\d+)?)$/);
  if (q) return { term: '', qty: { metric: q[1] === 'STOCK' ? 'stock' : 'sold', op: q[2] === 'LESS' ? 'less' : 'more', n: Number(q[3]) }, season: null };
  return { term, qty: null, season: null };
}

// ---- Return to your place ------------------------------------------------------------------------------------------------------------
// Saved just before any way out (product cards, GROUPID, Google Ads), read back when the page opens on ?restore=1. Left in place on
// read (StrictMode reads twice, and the same trip can be made twice); Reset removes it. Storage can throw — then it simply opens fresh.
const VIEW_KEY = 'bc_collections_view';
interface ViewSnapshot {
  steps: FilterStep[];
  qty: QtyFilter[];
  season: Season | null;
  slow: boolean;
  isNew: boolean;
  base: Base | null;
  cut: string[];
  selected: string | null;
  scrollY: number;
}
function readSnapshot(isReturn: boolean): ViewSnapshot | null {
  if (!isReturn || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as ViewSnapshot;
    if (!v || !Array.isArray(v.steps) || !Array.isArray(v.qty) || !Array.isArray(v.cut)) return null;
    return v;
  } catch {
    return null;
  }
}

const NO_ROWS: CollectionStyleRow[] = [];

// One line saying what a tag write did — "+3 added to clearance · 2 refused: Shopify is off (A, B)".
function describe(r: CollectionSetResult, tag: string, add: boolean): { text: string; bad: boolean } {
  const parts = [`${add ? '+' : '−'}${r.done.length} ${add ? 'added to' : 'removed from'} ${tag}`];
  if (r.failed.length) {
    const byErr = new Map<string, string[]>();
    for (const f of r.failed) byErr.set(f.error, [...(byErr.get(f.error) ?? []), f.groupid]);
    parts.push(`${r.failed.length} not done: ` + [...byErr].map(([e, ids]) => `${e} (${ids.join(', ')})`).join('; '));
  }
  if (r.notes.length) parts.push(`${r.notes.map((n) => n.groupid).join(', ')}: not on Shopify, removed here only`);
  return { text: parts.join(' · '), bad: r.failed.length > 0 };
}

export default function CollectionsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <CollectionsScreen />
    </Suspense>
  );
}

function CollectionsScreen() {
  const searchParams = useSearchParams();
  const [restored] = useState(() => readSnapshot(searchParams.get('restore') === '1'));

  // ← Back, the ?from=/&back= convention.
  const from = searchParams.get('from');
  const backParam = searchParams.get('back');
  const backLabel = backParam || (from ? prettyPathLabel(from) : undefined);

  // THIS SCREEN'S RETURN ADDRESS — its own from/back and sort kept, plus ?restore=1 so the trip back rebuilds the view.
  const returnUrl = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('restore', '1');
    return `/collections?${p.toString()}`;
  }, [searchParams]);

  // ---- data ---------------------------------------------------------------------------------------------------------------------
  const stylesQ = useApiQuery('collection-styles', getCollectionStyles);
  const colsQ = useApiQuery('collection-list', getCollections);
  const rows = stylesQ.data ?? NO_ROWS;
  const collections = useMemo(() => colsQ.data?.collections ?? [], [colsQ.data]);
  const maxTags = colsQ.data?.max_tags ?? 3;

  // ---- filter state -------------------------------------------------------------------------------------------------------------
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const [steps, setSteps] = useState<FilterStep[]>(restored?.steps ?? []);
  const [qty, setQty] = useState<QtyFilter[]>(restored?.qty ?? []);
  const [season, setSeason] = useState<Season | null>(restored?.season ?? null);
  const [slow, setSlow] = useState(restored?.slow ?? false);
  const [isNew, setIsNew] = useState(restored?.isNew ?? false);
  const [base, setBase] = useState<Base | null>(restored?.base ?? null);
  const [cut, setCut] = useState<Set<string>>(() => new Set(restored?.cut ?? []));
  const [showHelp, setShowHelp] = useState(false);
  const containsRef = useRef<HTMLInputElement>(null);

  // ---- selection (the product cards) and ticks (the bulk bar) ------------------------------------------------------------------------
  const [selected, setSelected] = useState<string | null>(restored?.selected ?? null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const indexed = useMemo(() => rows.map((row) => ({ row, hay: haystack(row) })), [rows]);
  const criteria: Criteria = useMemo(() => ({ steps, qty, season, slow, isNew, base }), [steps, qty, season, slow, isNew, base]);
  const filtering = steps.length > 0 || qty.length > 0 || season !== null || slow || isNew || base !== null;

  const matched = useMemo(() => applyCriteria(indexed, criteria).map((x) => x.row), [indexed, criteria]);
  const visible = useMemo(() => matched.filter((r) => !cut.has(r.groupid)), [matched, cut]);

  const { sorted, sort, onSort } = useTableSort(visible, {
    groupid: (r) => r.groupid,
    brand: (r) => r.brand,
    pairs: (r) => r.pairs,
    sold30: (r) => r.sold30,
    price: (r) => r.price,
    tags: (r) => r.tags.join(' '),
  });
  const th = { sort, onSort };

  // Ticks only count while their row is on screen — a filter change never leaves an invisible row ticked for a bulk write.
  const visibleIds = useMemo(() => new Set(sorted.map((r) => r.groupid)), [sorted]);
  const pickedIds = useMemo(() => sorted.filter((r) => picked.has(r.groupid)).map((r) => r.groupid), [sorted, picked]);
  const allPicked = sorted.length > 0 && pickedIds.length === sorted.length;
  const selectedOnScreen = selected && visibleIds.has(selected) ? selected : null;

  // ---- leaving --------------------------------------------------------------------------------------------------------------------
  const saveView = useCallback(() => {
    const snap: ViewSnapshot = {
      steps, qty, season, slow, isNew, base, cut: [...cut], selected,
      scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
    };
    try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify(snap)); } catch { /* storage blocked: come back fresh */ }
  }, [steps, qty, season, slow, isNew, base, cut, selected]);

  // On a return trip, put the selected row back in view once the list has painted (the filters were restored during render, but the
  // height they make only exists after paint). One shot. Not data fetching — it only moves the scroll position.
  const scrollDone = useRef(false);
  useEffect(() => {
    if (scrollDone.current || !restored || rows.length === 0) return;
    scrollDone.current = true;
    const row = restored.selected ? document.querySelector(`[data-groupid="${CSS.escape(restored.selected)}"]`) : null;
    if (row) row.scrollIntoView({ block: 'center' });
    else window.scrollTo(0, restored.scrollY);
  }, [restored, rows.length]);

  // ---- find / reset ----------------------------------------------------------------------------------------------------------------
  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseContains(contains);
    const next: FilterStep[] = [];
    if (parsed.term) next.push({ op: 'has', term: parsed.term });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    const nextQty = parsed.qty ? [...qty.filter((f) => f.metric !== parsed.qty!.metric), parsed.qty] : qty;
    const nextSeason = parsed.season ?? season;
    if (next.length > 0) {
      // A Find that would empty the list is a NEW hunt ("ARIZONA" then "IVES" = just IVES) — the steps are replaced, the toggles and
      // the collection base stay (they are the view you are working in, like Google Ads' sitting chip).
      const narrowed = applyCriteria(indexed, { ...criteria, steps: [...steps, ...next], qty: nextQty, season: nextSeason });
      setSteps(narrowed.length === 0 && steps.length > 0 ? next : [...steps, ...next]);
    }
    setQty(nextQty);
    setSeason(nextSeason);
    setContains('');
    setNotContains('');
    setPicked(new Set());
    containsRef.current?.focus();
  }

  function onReset() {
    try { window.sessionStorage.removeItem(VIEW_KEY); } catch { /* nothing to clear */ }
    const url = new URL(window.location.href);
    if (url.searchParams.has('restore')) {
      url.searchParams.delete('restore');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setSteps([]); setQty([]); setSeason(null); setSlow(false); setIsNew(false); setBase(null);
    setCut(new Set()); setPicked(new Set()); setSelected(null); setContains(''); setNotContains(''); setMsg(null);
    stylesQ.refresh();
    colsQ.refresh();
    containsRef.current?.focus();
  }

  // ---- tag writes -----------------------------------------------------------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [bulkTag, setBulkTag] = useState('');
  const bulkTarget = bulkTag || base?.tag || collections[0]?.tag || '';

  async function writeTag(ids: string[], tag: string, add: boolean) {
    if (ids.length === 0 || !tag) return;
    setBusy(true); setMsg(null);
    const r = await setCollectionTag(ids, tag, add);
    setBusy(false);
    if (!(r.success && r.data)) { setMsg({ text: r.error || 'Update failed', bad: true }); return; }
    setMsg(describe(r.data, tag, add));
    setPicked(new Set());
    stylesQ.refresh();
    colsQ.refresh();
  }

  // ---- new collection -------------------------------------------------------------------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [newTag, setNewTag] = useState('');
  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTag.trim()) return;
    setBusy(true); setMsg(null);
    const r = await createCollection(newTag);
    setBusy(false);
    if (!(r.success && r.data)) { setMsg({ text: r.error || 'Could not create the collection', bad: true }); return; }
    const tag = r.data.tag;
    setMsg({ text: `Created ${tag}. Build the smart collection in Shopify admin: Product tag is equal to ${tag}.`, bad: false });
    setCreating(false); setNewTag('');
    setBulkTag(tag);
    colsQ.refresh();
  }

  // ---- collection panel filter ----------------------------------------------------------------------------------------------------
  const [colFilter, setColFilter] = useState('');
  const shownCollections = collections.filter((c) => c.tag.includes(colFilter.trim().toLowerCase()));

  function pickBase(tag: string) {
    setBase((b) => (b && b.tag === tag ? null : { tag, side: 'in' }));
    setBulkTag(tag);
    setPicked(new Set());
  }

  function onRowClick(e: React.MouseEvent, groupid: string) {
    const target = e.target as Element;
    if (target.closest('button, a, input, select, label')) return;
    setSelected((s) => (s === groupid ? null : groupid));
  }

  function toGoogleAds() {
    writeCollectionHandoff(sorted.map((r) => r.groupid));
    saveView();
  }

  const loading = stylesQ.busy;
  const error = stylesQ.error?.message ?? colsQ.error?.message ?? null;
  const chip = 'inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium';
  const clearBtn = 'ml-0.5 rounded opacity-60 hover:opacity-100';
  const pickLink = 'text-sm font-medium text-slate-900 hover:underline disabled:opacity-50';
  const toggle = (on: boolean) =>
    'rounded-md border px-3 py-2 text-sm font-medium transition ' +
    (on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50');

  return (
    <AppShell title="Collections" backHref={from || undefined} backLabel={backLabel}>
      {/* ---- Collections panel ------------------------------------------------------------------------------------------------- */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={colFilter}
            onChange={(e) => setColFilter(e.target.value)}
            placeholder="Filter collections"
            aria-label="Filter collections"
            className="w-48 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          {shownCollections.map((c) => {
            const active = base?.tag === c.tag;
            return (
              <button
                key={c.tag}
                type="button"
                onClick={() => pickBase(c.tag)}
                title={active ? 'Show every style again' : `Show the styles in ${c.tag}`}
                className={
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ' +
                  (active ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50')
                }
              >
                <span className="font-medium">{c.tag}</span>
                <span className={active ? 'text-slate-300' : 'text-slate-400'}>{c.styles}</span>
                {c.off > 0 && (
                  <span className={active ? 'text-amber-300' : 'text-amber-600'} title="Tagged but switched off on Shopify — still in the collection on the store">
                    ({c.off} off)
                  </span>
                )}
              </button>
            );
          })}
          {collections.length > 0 && shownCollections.length === 0 && <span className="text-sm text-slate-400">No collection matches</span>}
          {creating ? (
            <form onSubmit={onCreate} className="flex items-center gap-2">
              <input
                autoFocus
                value={newTag}
                onChange={(e) => setNewTag(e.target.value.toLowerCase())}
                placeholder="tag, e.g. caprice-push"
                aria-label="New collection tag"
                className="w-48 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button type="submit" disabled={busy || !newTag.trim()} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                Create
              </button>
              <button type="button" onClick={() => { setCreating(false); setNewTag(''); }} className="text-sm text-slate-500 hover:text-slate-800">
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-500 hover:bg-slate-50">
              <PlusIcon className="h-4 w-4" /> New collection
            </button>
          )}
        </div>
      </div>

      {/* ---- Command bar: the standard Contains / Does not contain ------------------------------------------------------------- */}
      <form onSubmit={onFind} className="mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Contains</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input
                ref={containsRef}
                value={contains}
                onChange={(e) => setContains(e.target.value.toUpperCase())}
                autoFocus={!restored}
                placeholder="e.g. CAPRICE"
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
            <input
              value={notContains}
              onChange={(e) => setNotContains(e.target.value.toUpperCase())}
              placeholder="e.g. WOMEN"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button type="submit" className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">Find</button>
          <button
            type="button"
            onClick={() => { setSlow((v) => !v); setPicked(new Set()); }}
            title="Held stock with no sale on any channel in 90 days — the Slow screen's list"
            className={toggle(slow)}
          >
            Slow
          </button>
          <button
            type="button"
            onClick={() => { setIsNew((v) => !v); setPicked(new Set()); }}
            title="Held stock, created under 90 days ago and not sold yet"
            className={toggle(isNew)}
          >
            New
          </button>
          <button
            type="button"
            onClick={onReset}
            title="Clear the search and re-read from the database"
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Reset
          </button>
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

        {showHelp && (
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div className="mb-1 font-medium uppercase tracking-wide text-slate-400">Commands — type in Contains, then Find</div>
            <ul className="space-y-1">
              <li>
                <span className="font-mono text-slate-700">STOCK LESS 10</span> · <span className="font-mono text-slate-700">STOCK MORE 5</span>
                <span className="text-slate-400"> — by pairs (local + Amazon, the Pairs column)</span>
              </li>
              <li>
                <span className="font-mono text-slate-700">SOLD LESS 3</span> · <span className="font-mono text-slate-700">SOLD MORE 10</span>
                <span className="text-slate-400"> — by units sold in the last 30 days</span>
              </li>
              <li>
                <span className="font-mono text-slate-700">WINTER</span> · <span className="font-mono text-slate-700">SUMMER</span>
                <span className="text-slate-400"> — by season (year-round styles show in both)</span>
              </li>
            </ul>
          </div>
        )}

        {/* The count and everything narrowing the list — each removable on its own. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <span className="mr-1 whitespace-nowrap text-slate-500">
            <span className="font-semibold text-slate-800">{sorted.length}</span>
            <span className="text-slate-400"> {sorted.length === 1 ? 'style' : 'styles'}</span>
            {cut.size > 0 && <span className="text-slate-400"> · {cut.size} cut</span>}
          </span>
          {base && (
            <span className={`${chip} ${base.side === 'in' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {base.side === 'in' ? 'In' : 'Not in'} {base.tag}
              <button
                type="button"
                onClick={() => { setBase({ ...base, side: base.side === 'in' ? 'out' : 'in' }); setPicked(new Set()); }}
                title={base.side === 'in' ? `Show the styles NOT in ${base.tag}` : `Show the styles in ${base.tag}`}
                className={clearBtn}
              >
                <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => { setBase(null); setPicked(new Set()); }} title="Clear" className={clearBtn}>
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {slow && (
            <span className={`${chip} bg-amber-50 text-amber-700`}>
              Slow · 90 days
              <button type="button" onClick={() => setSlow(false)} title="Clear" className={clearBtn}><XMarkIcon className="h-3.5 w-3.5" /></button>
            </span>
          )}
          {isNew && (
            <span className={`${chip} bg-sky-50 text-sky-700`}>
              New · under 90 days
              <button type="button" onClick={() => setIsNew(false)} title="Clear" className={clearBtn}><XMarkIcon className="h-3.5 w-3.5" /></button>
            </span>
          )}
          {season && (
            <span className={`${chip} bg-amber-50 text-amber-700`}>
              {season} + year-round
              <button type="button" onClick={() => setSeason(null)} title="Clear season filter" className={clearBtn}><XMarkIcon className="h-3.5 w-3.5" /></button>
            </span>
          )}
          {qty.map((f) => (
            <span key={f.metric} className={`${chip} bg-emerald-50 text-emerald-700`}>
              {f.metric === 'stock' ? 'Pairs' : 'Sold 30d'} {f.op === 'less' ? '<' : '>'} {f.n}
              <button type="button" onClick={() => setQty((q) => q.filter((x) => x.metric !== f.metric))} title="Clear" className={clearBtn}>
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {steps.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {(i > 0 || filtering) && <span className="text-slate-300">›</span>}
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
        </div>
      </form>

      {/* ---- The selected style's screens (Shopify only) ------------------------------------------------------------------------
          STICKY (owner, 2026-10-14: "allow the menu options to continue showing after I scroll down") — Inventory's product menu
          treatment: pinned to the top, solid white so rows scrolling underneath don't show through. */}
      <div className="sticky top-0 z-20 mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mb-2 text-sm text-slate-500">
          {selectedOnScreen
            ? <>Selected: <span className="font-medium text-slate-800">{selectedOnScreen}</span></>
            : 'Click a row to open it on another screen'}
        </div>
        <ProductNavCards groupid={selectedOnScreen} from={returnUrl} showProduct shopifyOnly onLeave={saveView} />
      </div>

      {/* ---- The list -------------------------------------------------------------------------------------------------------------- */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Bulk — ticked rows only, so what a press touches is always what you can see ticked. */}
            <span className="text-sm text-slate-500">{pickedIds.length > 0 ? `${pickedIds.length} ticked` : 'Tick rows to tag them'}</span>
            {pickedIds.length > 0 && collections.length > 0 && (
              <>
                <select
                  value={bulkTarget}
                  onChange={(e) => setBulkTag(e.target.value)}
                  aria-label="Collection"
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                >
                  {collections.map((c) => <option key={c.tag} value={c.tag}>{c.tag}</option>)}
                </select>
                <button type="button" onClick={() => writeTag(pickedIds, bulkTarget, true)} disabled={busy} className={pickLink}>
                  Add {pickedIds.length}
                </button>
                <button type="button" onClick={() => writeTag(pickedIds, bulkTarget, false)} disabled={busy} className={pickLink}>
                  Remove {pickedIds.length}
                </button>
                <button
                  type="button"
                  onClick={() => { setCut((c) => new Set([...c, ...pickedIds])); setPicked(new Set()); }}
                  disabled={busy}
                  className={pickLink}
                >
                  Cut {pickedIds.length}
                </button>
              </>
            )}
            {busy && <span className="text-sm text-slate-400">Updating…</span>}
            {msg && <span className={`text-sm ${msg.bad ? 'text-red-700' : 'text-slate-500'}`}>{msg.text}</span>}
          </div>
          {sorted.length > 0 && (
            <Link
              href={`/google-ads?list=1&from=${encodeURIComponent(returnUrl)}&back=${encodeURIComponent('Collections')}`}
              onClick={toGoogleAds}
              title="Open Google Ads narrowed to exactly the styles listed here"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline"
            >
              Google Ads &rarr;
            </Link>
          )}
        </div>

        {error ? (
          <p className="px-5 py-4 text-sm text-red-700">{error}</p>
        ) : stylesQ.isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-400">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">No styles match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="w-8 py-2 pl-4 pr-0">
                    <input
                      type="checkbox"
                      aria-label="Tick every row shown"
                      checked={allPicked}
                      disabled={busy}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(sorted.map((r) => r.groupid)))}
                      className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                    />
                  </th>
                  <SortableTh {...th} sortKey="groupid" label="Style" firstDir="asc" />
                  <SortableTh {...th} sortKey="brand" label="Brand" firstDir="asc" />
                  <SortableTh {...th} sortKey="pairs" label="Pairs" align="right" />
                  <SortableTh {...th} sortKey="sold30" label="Sold 30d" align="right" />
                  <SortableTh {...th} sortKey="price" label="Price" align="right" />
                  <SortableTh {...th} sortKey="tags" label="Collections" firstDir="asc" />
                  <th className="w-8 py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const isSel = r.groupid === selectedOnScreen;
                  const canAdd = r.shopify && r.tags.length < maxTags;
                  const addable = collections.filter((c) => !r.tags.includes(c.tag));
                  return (
                    <tr
                      key={r.groupid}
                      data-groupid={r.groupid}
                      onClick={(e) => onRowClick(e, r.groupid)}
                      className={`cursor-pointer border-b border-slate-100 text-slate-700 last:border-0 ${isSel ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="w-8 py-2 pl-4 pr-0">
                        <input
                          type="checkbox"
                          aria-label={`Tick ${r.groupid}`}
                          checked={picked.has(r.groupid)}
                          disabled={busy}
                          onChange={() => setPicked((p) => { const nx = new Set(p); if (nx.has(r.groupid)) nx.delete(r.groupid); else nx.add(r.groupid); return nx; })}
                          className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                        />
                      </td>
                      {/* Title as a second line under the code (the Google Ads grid's layout) — a column of its own pushed Collections
                          off the right edge on a laptop. */}
                      <td className="max-w-[26rem] px-4 py-2">
                        <div className="whitespace-nowrap">
                        {r.in_bcweb ? (
                          <Link
                            href={`/pricing/style/${encodeURIComponent(r.groupid)}?from=${encodeURIComponent(returnUrl)}`}
                            onClick={saveView}
                            title="Shopify price"
                            className="font-medium text-slate-800 hover:text-brand-700 hover:underline"
                          >
                            {r.groupid}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-800">{r.groupid}</span>
                        )}
                        {r.slow && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Slow</span>}
                        {r.new && <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">New</span>}
                        {!r.in_bcweb ? (
                          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700" title="Tagged, but no longer a style in BCWEB — remove the tag">Not in BCWEB</span>
                        ) : !r.shopify && (
                          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700" title="Switched off in BCWEB but still tagged on the store — it still shows in the collection">Shopify OFF</span>
                        )}
                        </div>
                        {r.title && <div className="truncate text-xs text-slate-500" title={r.title}>{r.title}</div>}
                      </td>
                      <td className="px-4 py-2 text-slate-500">{r.brand || '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{r.pairs}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.sold30}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.price === null ? '—' : `£${r.price.toFixed(2)}`}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.tags.map((t) => (
                            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white">
                              {t}
                              <button
                                type="button"
                                onClick={() => writeTag([r.groupid], t, false)}
                                disabled={busy}
                                title={`Remove from ${t}`}
                                className="rounded text-slate-300 hover:text-white disabled:opacity-50"
                              >
                                <XMarkIcon className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                          {addable.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => { if (e.target.value) writeTag([r.groupid], e.target.value, true); }}
                              disabled={busy || !canAdd}
                              aria-label={`Add ${r.groupid} to a collection`}
                              title={!r.shopify ? 'Shopify is off — it can be removed from a collection, not added' : r.tags.length >= maxTags ? `Already in ${maxTags} collections` : 'Add to a collection'}
                              className="rounded border border-dashed border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-500 disabled:opacity-40"
                            >
                              <option value="">+ add</option>
                              {addable.map((c) => <option key={c.tag} value={c.tag}>{c.tag}</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                      <td className="w-8 py-2 pr-4 text-right">
                        <button
                          type="button"
                          onClick={() => { setCut((c) => new Set([...c, r.groupid])); if (selected === r.groupid) setSelected(null); }}
                          title="Cut — hide this row until Reset"
                          className="rounded text-slate-300 hover:text-slate-600"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
