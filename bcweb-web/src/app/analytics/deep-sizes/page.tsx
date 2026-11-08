'use client';
/*
=======================================================================================================================================
Page: /analytics/deep-sizes  (DEEP SELLERS — owner, 2026-11-06)
=======================================================================================================================================
Purpose: SKUs that SELL but hold far more than they sell. Range's green card ("Sold in the last 90 days") counts a size as done once
         one pair sells, so a size holding 13 that sold 1 hides there. This screen branches off it (the green card stays as it is,
         owner) and lists those sizes so they can be SEEN first: "I need to see them, know what they are". Good sellers should be kept
         in stock but not overbought, and a buying mistake should go quickly.

THE RULE IS THE SERVER'S (bcweb-server/utils/deepSizes.js, THE copy; read its header): a size on Range's green card, past its first
         90 days, holding 3+ pairs beyond 90 days' worth at its 12-month pace. All brands, the owner's call.

THE LIST = Range's list layout (../slow-sizes/list/page.tsx):
  - ONE ROW PER STYLE, its picture, the group id leading, Brand its own column.
  - EVERY SIZE AS A TILE: WHITE = a deep size, size · its OVER qty (the qty beyond 90 days' worth, what can be sold off — owner,
    2026-11-06: "probably over stock as they are what I can action"; an amber dot if more is ON ORDER from a supplier). GREY = the
    style's other sizes, "ok for this report" (owner — held but not deep, idle ones included, or not held). No tile tooltips (owner:
    "complicating my mind"). Click a white tile for the style's size screen.
  - ACTION (was "Way out", owner 2026-11-06; the server's way_out tag, worded here): Shopify price (the deep sizes are half or more of the style's stock, so a style price
    drop hits the problem), Amazon price (a non-Birkenstock deep size on Amazon, priced per size), Off-channel (no price lever:
    job lot, personal / CM3 shop sales, another shop on sale-or-return).
  - Columns: Over (pairs beyond 90 days' worth, the work, most first by default), In stock, Sold 90d and Sold 12m, all for the
    WHITE sizes only. Every column sorts (third click = back to the default). ?sort= ?dir=
  - The standard product menu (sticky, acts on the ONE selected row), Windows multi-select, Cut / × and Refresh, as Range's lists.

FILTERS: Brand, Way out, a search box (code, title, brand; every word must match). ?brand= ?way= ?q=

DECISIONS (owner, 2026-11-06; shared with Clearance, components/ListDecision + lib/listDecisions): the Action column shows the server's
         way_out as a pale SUGGESTION until an action is chosen by hand (Shopify price, Amazon price, Off-channel or HARVEST, by hand
         only), which shows solid with when it comes back. To decide (default) | All (?view=all). A decided style is To decide again
         when its look-again date arrives or its qty over grows. Choosing an action records it; no price moves from here yet.

WORDING: "in stock" / "qty", never "pairs" on screen (the owner reads "pairs" as a count of sizes).

VIEW STATE LIVES IN THE URL, written back by the handlers (never an effect). Consumes GET /analytics-deep-sizes.
=======================================================================================================================================
*/

import { Suspense, useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ProductNavCards from '@/components/ProductNavCards';
import StyleThumb from '@/components/StyleThumb';
import ListTitle from '@/components/ListTitle';
import { useApiQuery } from '@/lib/useApiQuery';
import { getDeepSizes, getListDecisions, type DeepSize, type DeepWayOut, type ListDecision } from '@/lib/api';
import { DecisionBar, DecisionCell, DecisionViewSwitch } from '@/components/ListDecision';
import { LIST_ACTIONS, isDue } from '@/lib/listDecisions';
import { prettyPathLabel } from '@/lib/nav';

const n = (v: number) => v.toLocaleString('en-GB');
const isBirk = (brand: string | null) => !!brand && brand.trim().toLowerCase().startsWith('birk');

const WAY_OUT: Record<DeepWayOut, { label: string; tip: string; cls: string }> = {
  shopify: { label: 'Shopify price', cls: 'bg-sky-50 text-sky-800 ring-sky-200',
    tip: 'The deep sizes are half or more of the style’s stock, so a style price drop is aimed at the problem' },
  amazon: { label: 'Amazon price', cls: 'bg-amber-50 text-amber-800 ring-amber-200',
    tip: 'A deep size on Amazon. Amazon prices each size on its own' },
  off: { label: 'Off-channel', cls: 'bg-slate-100 text-slate-700 ring-slate-300',
    tip: 'No price lever (the style sells in its other sizes): job lot, personal / CM3 shop sales, another shop on sale-or-return' },
};
const ACTIONS = LIST_ACTIONS.deep;                                        // the hand-picked actions (Harvest included)
const actionIndex = (key: string) => { const i = ACTIONS.findIndex((a) => a.key === key); return i < 0 ? ACTIONS.length : i; };

interface Tile { code: string; size: string; s: DeepSize | null; white: boolean }
interface StyleRow {
  groupid: string; title: string | null; brand: string | null; imagename: string | null; way: DeepWayOut;
  decision: ListDecision | undefined; due: boolean; measure: number;
  act: string;                        // the effective action: the decision if there is one, else the suggestion
  white: DeepSize[]; run: Tile[];
  over: number; stock: number; sold90: number; sold12: number;
}
type SortKey = 'style' | 'brand' | 'way' | 'over' | 'stock' | 'sold90' | 'sold12';
const SORT_KEYS: SortKey[] = ['style', 'brand', 'way', 'over', 'stock', 'sold90', 'sold12'];
const SORT_VALUE: Record<SortKey, (g: StyleRow) => number | string> = {
  style: (g) => g.groupid,
  brand: (g) => (g.brand || '').toLowerCase(),
  way: (g) => actionIndex(g.act),
  over: (g) => g.over,
  stock: (g) => g.stock,
  sold90: (g) => g.sold90,
  sold12: (g) => g.sold12,
};
const ASC_FIRST: SortKey[] = ['style', 'brand', 'way'];   // text (and the tag) sort A–Z first; numbers biggest first

// Sizes in size order: numeric where they are numbers (37.5 between 37 and 38), else as text.
const sizeNum = (s: string) => (/^[0-9]+([.][0-9]+)?$/.test(s) ? Number(s) : null);
const bySize = (a: Tile, b: Tile) => {
  const x = sizeNum(a.size), y = sizeNum(b.size);
  if (x !== null && y !== null) return x - y;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return a.size.localeCompare(b.size);
};

// useSearchParams needs a Suspense boundary for Next's build.
export default function DeepSizesPage() {
  return (
    <Suspense fallback={null}>
      <DeepSizesBody />
    </Suspense>
  );
}

function DeepSizesBody() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = sp.get('from');
  const from = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;

  const list = (k: string) => (sp.get(k) || '').split(',').filter(Boolean);
  const [brand, setBrand] = useState(() => sp.get('brand') ?? '');
  const [way, setWay] = useState<string>(() => ACTIONS.find((a) => a.key === sp.get('way'))?.key ?? '');
  const [view, setViewMode] = useState<'todo' | 'all'>(() => (sp.get('view') === 'all' ? 'all' : 'todo'));
  const [search, setSearch] = useState(() => sp.get('q') ?? '');
  const [sortBy, setSortBy] = useState<SortKey | null>(() => SORT_KEYS.find((k) => k === sp.get('sort')) ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (sp.get('dir') === 'asc' ? 'asc' : 'desc'));
  const [selected, setSelected] = useState<string[]>(() => list('sel'));
  const [anchor, setAnchor] = useState<string | null>(() => list('sel').pop() ?? null);
  const [cut, setCut] = useState<string[]>(() => list('cut'));

  type View = { brand: string; way: string; view: 'todo' | 'all'; q: string; sort: SortKey | null; dir: 'asc' | 'desc'; sel: string[]; cut: string[] };
  const current: View = { brand, way, view, q: search, sort: sortBy, dir: sortDir, sel: selected, cut };
  const viewUrl = (v: View) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (v.brand) q.set('brand', v.brand);
    if (v.way) q.set('way', v.way);
    if (v.view === 'all') q.set('view', 'all');
    if (v.q.trim()) q.set('q', v.q.trim());
    if (v.sort) { q.set('sort', v.sort); q.set('dir', v.dir); }
    if (v.sel.length) q.set('sel', v.sel.join(','));
    if (v.cut.length) q.set('cut', v.cut.join(','));
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const selfUrl = viewUrl(current);
  const setView = (patch: Partial<View>) => {
    const v = { ...current, ...patch };
    setBrand(v.brand); setWay(v.way); setViewMode(v.view); setSearch(v.q); setSortBy(v.sort); setSortDir(v.dir);
    setSelected(v.sel); setCut(v.cut);
    router.replace(viewUrl(v), { scroll: false });
  };

  const q = useApiQuery('analytics-deep-sizes', () => getDeepSizes());
  const dq = useApiQuery('list-decisions-deep', () => getListDecisions('deep'));
  const decisions = useMemo(() => new Map((dq.data?.decisions ?? []).map((d) => [d.groupid, d])), [dq.data]);
  const today = dq.data?.today ?? null;
  // THE MEASURE per style = its qty over across ALL its deep sizes (never the filtered ones), the number the server saved.
  const measureOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of q.data?.sizes ?? []) m.set(s.groupid, (m.get(s.groupid) || 0) + s.over);
    return m;
  }, [q.data]);

  // FILTERS (see header) — brand and way out per style, the search at size grain over the deep sizes.
  const passes = useCallback((s: DeepSize) => {
    if (brand && s.brand !== brand) return false;
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = `${s.code} ${s.title ?? ''} ${s.brand ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }, [brand, search]);
  const filtering = !!brand || !!way || !!search.trim();

  const brands = useMemo(() => [...new Set((q.data?.sizes ?? []).map((s) => s.brand).filter((b): b is string => !!b))]
    .sort((a, b) => a.localeCompare(b)), [q.data]);

  // THE STYLE ROWS: deep sizes white; every other size of the style (held, or ever arrived / sold) grey.
  const rows = useMemo(() => {
    if (!q.data) return [];
    const styleOf = new Map(q.data.styles.map((x) => [x.groupid, x]));
    const heldBy = new Map<string, DeepSize[]>();
    for (const s of q.data.held) { const l = heldBy.get(s.groupid); if (l) l.push(s); else heldBy.set(s.groupid, [s]); }
    const othersBy = new Map<string, Tile[]>();
    for (const o of q.data.others) {
      const t: Tile = { code: o.code, size: o.size, s: null, white: false };
      const l = othersBy.get(o.groupid); if (l) l.push(t); else othersBy.set(o.groupid, [t]);
    }
    const whiteBy = new Map<string, DeepSize[]>();
    for (const s of q.data.sizes) {
      if (!passes(s)) continue;
      const l = whiteBy.get(s.groupid); if (l) l.push(s); else whiteBy.set(s.groupid, [s]);
    }
    const out: StyleRow[] = [];
    for (const [groupid, white] of whiteBy) {
      const st = styleOf.get(groupid);
      const w: DeepWayOut = st?.way_out ?? 'off';
      const decision = decisions.get(groupid);
      const act = decision?.action ?? w;
      if (way && act !== way) continue;
      const measure = measureOf.get(groupid) || 0;
      const due = today ? isDue(decision, measure, today) : !decision;
      const isWhite = new Set(white.map((s) => s.code));
      const run = [
        ...(heldBy.get(groupid) ?? []).map((s): Tile => ({ code: s.code, size: s.size, s, white: isWhite.has(s.code) })),
        ...(othersBy.get(groupid) ?? []),
      ].sort(bySize);
      const sum = (f: (s: DeepSize) => number) => white.reduce((t, s) => t + f(s), 0);
      out.push({
        groupid, title: white[0].title, brand: white[0].brand, imagename: st?.imagename ?? null, way: w, white, run,
        decision, due, measure, act,
        over: sum((s) => s.over), stock: sum((s) => s.units), sold90: sum((s) => s.sold_90d), sold12: sum((s) => s.sold_12m),
      });
    }
    return out;
  }, [q.data, passes, way, decisions, measureOf, today]);

  // THE ORDER: most over first by default; a header click sorts by it, again flips, a third goes back to the default.
  const sorted = useMemo(() => {
    const dflt = (a: StyleRow, b: StyleRow) => b.over - a.over || b.stock - a.stock || a.groupid.localeCompare(b.groupid);
    if (!sortBy) return [...rows].sort(dflt);
    const val = SORT_VALUE[sortBy];
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return (sortDir === 'desc' ? -c : c) || dflt(a, b);
    });
  }, [rows, sortBy, sortDir]);
  const toggleSort = (key: SortKey) => {
    const first = ASC_FIRST.includes(key) ? 'asc' : 'desc';
    if (sortBy !== key) setView({ sort: key, dir: first });
    else if (sortDir === first) setView({ dir: first === 'asc' ? 'desc' : 'asc' });
    else setView({ sort: null, dir: 'desc' });
  };
  const sortBtn = (key: SortKey, label: string) => (
    <button type="button" onClick={() => toggleSort(key)}
      className={'inline-flex items-center gap-1 rounded transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ' +
        (sortBy === key ? 'text-slate-900' : '')}>
      {label}
      {sortBy === key && <span className="text-[9px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  // WHAT'S ON SCREEN — the sorted rows less the soft cuts.
  const inView = useMemo(() => (view === 'all' ? sorted : sorted.filter((g) => g.due)), [sorted, view]);
  const todoCount = useMemo(() => sorted.filter((g) => g.due).length, [sorted]);
  const visible = useMemo(() => { const h = new Set(cut); return inView.filter((g) => !h.has(g.groupid)); }, [inView, cut]);
  const cutHere = inView.length - visible.length;
  const selectedHere = useMemo(() => { const s = new Set(selected); return visible.filter((g) => s.has(g.groupid)).map((g) => g.groupid); }, [visible, selected]);
  const menuGroupid = selected.length === 1 ? selected[0] : null;
  const menuRow = visible.find((g) => g.groupid === menuGroupid) ?? null;

  // A ROW CLICK — Windows rules, as Range's lists: plain = just this row (again = none), Ctrl/⌘ = toggle one, Shift = the range from
  // the anchor, Ctrl+Shift = add the range.
  const clickRow = (e: ReactMouseEvent, groupid: string) => {
    const add = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      const ids = visible.map((g) => g.groupid);
      const a = anchor ? ids.indexOf(anchor) : -1;
      const b = ids.indexOf(groupid);
      const range = a < 0 ? [groupid] : ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      setView({ sel: add ? [...new Set([...selected, ...range])] : range });
      return;
    }
    setAnchor(groupid);
    if (add) setView({ sel: selected.includes(groupid) ? selected.filter((x) => x !== groupid) : [...selected, groupid] });
    else setView({ sel: selected.length === 1 && selected[0] === groupid ? [] : [groupid] });
  };
  const noTextSelect = (e: ReactMouseEvent) => { if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault(); };
  const onListKey = (e: ReactKeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setView({ sel: visible.map((g) => g.groupid) }); }
    else if (e.key === 'Escape') setView({ sel: [] });
  };
  const cutSelected = () => { const gone = new Set(selectedHere); setView({ cut: [...cut, ...selectedHere], sel: selected.filter((x) => !gone.has(x)) }); };
  const refreshScreen = () => { setAnchor(null); setView({ cut: [], sel: [] }); void q.refresh(); void dq.refresh(); };
  const decidedSelected = selectedHere.filter((g) => decisions.has(g)).length;

  // The product menu's height, for the sticky table header to sit under it (callback ref + ResizeObserver — no effect).
  const [menuH, setMenuH] = useState(0);
  const menuRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setMenuH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sizesHref = (groupid: string) =>
    `/analytics/slow-sizes/${encodeURIComponent(groupid)}?from=${encodeURIComponent(`${selfUrl}#style-${groupid}`)}`;

  const th = 'border-l border-slate-200 py-2.5 pl-3 pr-4 font-medium';
  const td = 'border-l border-slate-100 py-3 pl-3 pr-4 align-top';

  return (
    <AppShell backHref={from ?? undefined} backLabel={from ? prettyPathLabel(from) : undefined}>
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {q.data && (
        <>
          {/* THE TITLE — name, colour and the rule in one line (components/ListTitle, shared by the four list screens). */}
          <ListTitle tone="deep" title="Deep sellers"
            rule={`Sold in the last ${q.data.rule.range_days} days, but holding ${q.data.rule.min_over}+ more than ${q.data.rule.range_days} days’ worth at the 12-month pace.`} />

          {/* FILTERS — narrow the list. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={brand} onChange={(e) => setView({ brand: e.target.value, sel: [] })} aria-label="Brand"
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700">
              <option value="">All brands</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={way} onChange={(e) => setView({ way: e.target.value, sel: [] })} aria-label="Action"
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700">
              <option value="">Every action</option>
              {ACTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <input type="search" value={search} placeholder="Search code, title or brand"
              onChange={(e) => setView({ q: e.target.value, sel: [] })}
              className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400" />
            {filtering && (
              <button type="button" onClick={() => setView({ brand: '', way: '', q: '', sel: [] })}
                className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline">
                Clear
              </button>
            )}
          </div>

          {/* THE PRODUCT MENU — sticky, acts on the ONE selected row. */}
          <div ref={menuRef} className="sticky top-0 z-20 -mx-4 mb-3 border-b border-slate-200 bg-slate-100 px-4 pb-3 pt-1">
            <ProductNavCards groupid={menuGroupid} from={selfUrl} showProduct
              amazonOff={menuRow && isBirk(menuRow.brand) ? 'Birkenstock — not sold on Amazon' : undefined} />
          </div>

          {/* THE BAR — what's on screen, Cut and Refresh. */}
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">
            <DecisionViewSwitch view={view} todo={todoCount} all={sorted.length} onChange={(v) => setView({ view: v, sel: [] })} />
            <span className="tabular-nums">
              {n(visible.length)} style{visible.length === 1 ? '' : 's'} · {n(visible.reduce((t, g) => t + g.white.length, 0))} SKUs ·{' '}
              {n(visible.reduce((t, g) => t + g.stock, 0))} in stock ·{' '}
              <span className="font-semibold text-slate-900">{n(visible.reduce((t, g) => t + g.over, 0))} over</span>
            </span>
            <button type="button" onClick={cutSelected} disabled={selectedHere.length === 0}
              title="Hide the selected rows — Ctrl / Shift-click to pick several, Ctrl+A for all, Esc for none"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-0.5 text-sm font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white">
              Cut
            </button>
            <button type="button" onClick={refreshScreen} title="Bring every cut row back, clear the selection and reload the list"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-0.5 text-sm font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50">
              Refresh
            </button>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <DecisionBar list="deep" selected={selectedHere} decidedSelected={decidedSelected}
              spring={dq.data?.spring ?? null} today={today} onDone={() => { void dq.refresh(); }} />
          </div>

          <div tabIndex={-1} onKeyDown={onListKey}
            className="w-fit max-w-full overflow-clip rounded-xl border border-slate-200 bg-white focus:outline-none">
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                {cutHere > 0 ? 'Every row is cut — press Refresh to bring them back.'
                  : view === 'todo' && sorted.length ? 'Nothing left to decide. All shows every style and its decision.' : 'Nothing here with these filters.'}
              </p>
            ) : (
              <table className="text-sm">
                <thead className="sticky z-10 bg-slate-50 text-xs text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]" style={{ top: menuH }}>
                  <tr>
                    <th className="w-[30rem] py-2.5 pl-4 pr-3 text-left font-medium">{sortBtn('style', 'Style')}</th>
                    <th className={`w-32 text-left ${th}`}>{sortBtn('brand', 'Brand')}</th>
                    <th className={`text-left ${th}`} title="What can be done with the deep sizes">{sortBtn('way', 'Action')}</th>
                    <th className={`text-right ${th}`}
                      title="Qty in the white sizes beyond 90 days’ worth at their 12-month pace — the qty to push out">{sortBtn('over', 'Over')}</th>
                    <th className={`text-right ${th}`} title="Qty in stock of the white sizes (local + Amazon)">{sortBtn('stock', 'In stock')}</th>
                    <th className={`text-right ${th}`} title="Qty of the white sizes sold in the last 90 days, net of returns">{sortBtn('sold90', 'Sold 90d')}</th>
                    <th className={`text-right ${th}`} title="Qty of the white sizes sold in the last 12 months, net of returns">{sortBtn('sold12', 'Sold 12m')}</th>
                    <th className="w-10 border-l border-slate-200 py-2.5"><span className="sr-only">Hide</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((g) => {
                    const isSel = selected.includes(g.groupid);
                    const wo = WAY_OUT[g.way];
                    return (
                      <tr key={g.groupid} id={`style-${g.groupid}`} style={{ scrollMarginTop: menuH + 48 }}
                        onMouseDown={noTextSelect} onClick={(e) => clickRow(e, g.groupid)} aria-selected={isSel}
                        className={'cursor-pointer border-t border-slate-100 first:border-t-0 ' + (isSel ? 'bg-brand-50' : '')}>
                        <td className="w-[30rem] max-w-[30rem] py-3 pl-4 pr-3 align-top">
                          <div className="flex items-start gap-3">
                            <StyleThumb imagename={g.imagename} alt={g.title || g.groupid} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-base font-semibold text-slate-900">{g.groupid}</div>
                              <div className="mt-0.5 truncate text-xs text-slate-500"><span title={g.title || undefined}>{g.title || 'Untitled'}</span></div>
                              <SizeRun g={g} href={sizesHref(g.groupid)} />
                            </div>
                          </div>
                        </td>
                        <td className={`${td} text-slate-700`}>{g.brand || <span className="text-slate-300">–</span>}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          <DecisionCell list="deep" d={g.decision} due={g.due} measureNow={g.measure} today={today} suggestion={wo} />
                        </td>
                        <td className={`${td} text-right font-semibold tabular-nums text-slate-900`}>{n(g.over)}</td>
                        <td className={`${td} text-right tabular-nums text-slate-700`}>{n(g.stock)}</td>
                        <td className={`${td} text-right tabular-nums text-slate-700`}>{g.sold90 ? n(g.sold90) : <span className="text-slate-300">–</span>}</td>
                        <td className={`${td} text-right tabular-nums text-slate-700`}>{g.sold12 ? n(g.sold12) : <span className="text-slate-300">–</span>}</td>
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
    </AppShell>
  );
}

// THE SIZE RUN — white = a deep size (size · its OVER qty, an amber dot if more is on order; a link to the style's size screen), grey =
// the rest. No tooltips (owner).
// A SIZE'S OWN SHOPIFY PRICE on its tile (2026-11-08, server utils/sizePrice.js) — a small solid tag, so a size already being dealt with
// on the Shopify pricing drill reads as such. Display only. (The same tag is on Range's list tiles.)
function OwnPrice({ price }: { price: number }) {
  return <span className="ml-0.5 rounded bg-slate-800 px-1 text-[10px] font-medium text-white">£{price % 1 === 0 ? price.toFixed(0) : price.toFixed(2)}</span>;
}

function SizeRun({ g, href }: { g: StyleRow; href: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {g.run.map((t) => {
        const s = t.s;
        if (t.white && s) {
          return (
            <Link key={t.code} href={href} onClick={(e) => e.stopPropagation()}
              className="relative flex h-6 min-w-[2.25rem] items-center justify-center gap-1 rounded bg-white px-1.5 text-[11px] font-semibold tabular-nums text-slate-900 ring-1 ring-inset ring-slate-400 transition hover:bg-brand-50 hover:ring-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
              {t.size}<span className="font-normal text-slate-500">·{s.over}</span>
              {s.size_price != null && <OwnPrice price={s.size_price} />}
              {s.on_order > 0 && <span aria-hidden className="absolute right-0.5 top-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </Link>
          );
        }
        return (
          <span key={t.code} onClick={(e) => e.stopPropagation()}
            className="flex h-6 w-9 items-center justify-center rounded bg-slate-100 text-[11px] tabular-nums text-slate-400">
            {t.size}
          </span>
        );
      })}
    </div>
  );
}
