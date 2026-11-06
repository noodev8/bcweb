'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes/list?band=mid|cl  (SLOW MOVERS — one box's screen, opened from the front screen /analytics/slow-sizes)
=======================================================================================================================================
Purpose: THE HANDOVER FROM NEW STUFF (owner, 2026-11-06). New stuff (New Additions) is the prospect mindset — one sale per SKU in its
         first 90 days, a short focused list. What it hands on lands here: every size we hold that has gone 90+ days without a net
         sale, new or old, and from here the question is whether the QUANTITY held is moving. The two stay apart on purpose (owner:
         90 days – 9 months "can easily blend into the New Stuff mentality ... but it will grow the list and the user will not focus").

THREE SCREENS, ONE FRONT (owner, same day: "Either all navigate somewhere or all stay here. Navigate is the obvious"). The front screen
         (/analytics/slow-sizes, ../page.tsx) only shows what is happening — New stuff | 3–9 months | Clearance, three boxes in the same
         format — and each box opens its own screen: New stuff -> New Additions, the other two -> THIS page, one box each (lib/slowBands):
           ?band=mid  3–9 months — 91 days to 9 months without a sale (ONE box; its jobs will be PARK or BULK MOVE)
           ?band=cl   Clearance — 9 months+ (its own tools come later)
         Anything else (old links' m3 / m6) opens 3–9 months. ← Back = the front screen. Until 2026-11-06 this was one page with the
         boxes over a size-per-row list — git history.

THE LIST = NEW ADDITIONS' LAYOUT (owner, same day: "the same style layout but different columns, rules and actions"):
  - ONE ROW PER STYLE, its picture (components/StyleThumb), led by the group id with the title under it, Brand its own column.
  - EVERY SIZE AS A TILE: WHITE = a size in this box (the work) — size · qty in stock, a small rose dot if it has NEVER SOLD (owner:
    "every size, with a never sold mark"), hover for its days and last sale; click opens the style's size screen
    (/analytics/slow-sizes/[groupid]). GREY = the style's other sizes — held in another box (incl. selling ones) or not held at all
    (ever arrived / ever sold) — so a dud size of a selling style shows as one white tile in a grey run.
  - Columns: Days (the longest wait among the white sizes — days first, the month second: "only reason date helps is to see if it is
    season based"; a never-sold size reads "no sale", a restocked one "restock"), In stock and Sold 12m (THE WHITE SIZES' totals —
    owner, option A: qty is SHOWN, it never decides who is on the list; Sold 12m's tooltip has the whole style's 12 months).
    Longest wait first by default; every column sorts (third click = back to the default). ?sort= ?dir=
  - THE STANDARD PRODUCT MENU, sticky, acting on the ONE selected row; WINDOWS MULTI-SELECT (click / Ctrl / Shift / Ctrl+A / Esc,
    ?sel=); CUT soft-cuts the selected rows (and a row's ×, ?cut=, nothing stored); a permanent REFRESH brings every cut row back,
    clears the selection and reloads — all exactly as New Additions (read that page's header).

THE LIST RULE IS UNCHANGED — no net sale for 91+ days (the idle clock, utils/onShelf.js: since the later of the last NET sale and the
         oldest held pair's arrival; never sold = since it arrived; before the log = 31 Dec 2024). A list, not a rule beyond that.

READ ONLY FOR NOW. The actions come in the second pass (owner decisions, 2026-11-06): Park (its OWN per-size date — never the pricing
         review dates — always with a date) and a bulk Amazon ±% / last sold price and Shopify ±% move, each taking the size off the
         list until its date; parked sizes then leave the list behind an "n parked" link. Clearance keeps this read-only list until
         its own tools are designed.

FILTERS (owner, 2026-10-29): Brand, a search box (code, title, brand — every word must match) and Never sold only. They narrow the
         list and its totals line. ?brand= ?q= ?ns=1.

WORDING: "in stock" / "qty", never "pairs" (the owner reads "pairs" as a count of sizes).

VIEW STATE LIVES IN THE URL, written back by the handlers (never an effect). ← Back from the size screen returns to the same view and
         row (#style-<groupid>). Consumes GET /analytics-slow-sizes.
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
import { useApiQuery } from '@/lib/useApiQuery';
import { getSlowSizes, type SlowSize } from '@/lib/api';
import { SLOW_BANDS, slowBandFromUrl } from '@/lib/slowBands';

const n = (v: number) => v.toLocaleString('en-GB');
const isBirk = (brand: string | null) => !!brand && brand.trim().toLowerCase().startsWith('birk');

// Month names for 'YYYY-MM-DD' read by split, never the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const thisYear = new Date().getFullYear();
const monthOf = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return y === thisYear ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${String(y).slice(2)}`;   // "Oct 26" read as the 26th — this year = month only
};

// A style row: its white sizes (in this box), the whole run to draw, and what the columns show and sort by.
interface Tile { code: string; size: string; slow: SlowSize | null; white: boolean }
interface StyleRow {
  groupid: string; title: string | null; brand: string | null; imagename: string | null;
  white: SlowSize[]; run: Tile[];
  longest: SlowSize;                  // the white size waiting longest — the Days cell
  stock: number; sold: number; styleSold: number;
}
type SortKey = 'style' | 'brand' | 'days' | 'stock' | 'sold';
const SORT_KEYS: SortKey[] = ['style', 'brand', 'days', 'stock', 'sold'];
const SORT_VALUE: Record<SortKey, (g: StyleRow) => number | string> = {
  style: (g) => g.groupid,
  brand: (g) => (g.brand || '').toLowerCase(),
  days: (g) => g.longest.idle_days,
  stock: (g) => g.stock,
  sold: (g) => g.sold,
};
const TEXT_KEYS: SortKey[] = ['style', 'brand'];   // a text column sorts A–Z first; a number column biggest first

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
export default function SlowBoxPage() {
  return (
    <Suspense fallback={null}>
      <SlowBoxBody />
    </Suspense>
  );
}

function SlowBoxBody() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // ← Back: the front screen as it was left (?from=, same-site paths only), else the front screen.
  const raw = sp.get('from');
  const from = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  const band = slowBandFromUrl(sp.get('band')) ?? 'mid';
  const box = SLOW_BANDS.find((b) => b.key === band) ?? SLOW_BANDS[0];

  const list = (k: string) => (sp.get(k) || '').split(',').filter(Boolean);
  const [brand, setBrand] = useState(() => sp.get('brand') ?? '');
  const [search, setSearch] = useState(() => sp.get('q') ?? '');
  const [neverOnly, setNeverOnly] = useState(() => sp.get('ns') === '1');
  const [sortBy, setSortBy] = useState<SortKey | null>(() => SORT_KEYS.find((k) => k === sp.get('sort')) ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (sp.get('dir') === 'asc' ? 'asc' : 'desc'));
  const [selected, setSelected] = useState<string[]>(() => list('sel'));
  const [anchor, setAnchor] = useState<string | null>(() => list('sel').pop() ?? null);
  const [cut, setCut] = useState<string[]>(() => list('cut'));

  type View = { brand: string; q: string; ns: boolean; sort: SortKey | null; dir: 'asc' | 'desc'; sel: string[]; cut: string[] };
  const current: View = { brand, q: search, ns: neverOnly, sort: sortBy, dir: sortDir, sel: selected, cut };
  const viewUrl = (v: View) => {
    const q = new URLSearchParams();
    q.set('band', band);
    if (from) q.set('from', from);
    if (v.brand) q.set('brand', v.brand);
    if (v.q.trim()) q.set('q', v.q.trim());
    if (v.ns) q.set('ns', '1');
    if (v.sort) { q.set('sort', v.sort); q.set('dir', v.dir); }
    if (v.sel.length) q.set('sel', v.sel.join(','));
    if (v.cut.length) q.set('cut', v.cut.join(','));
    return `${pathname}?${q}`;
  };
  const selfUrl = viewUrl(current);
  const setView = (patch: Partial<View>) => {
    const v = { ...current, ...patch };
    setBrand(v.brand); setSearch(v.q); setNeverOnly(v.ns); setSortBy(v.sort); setSortDir(v.dir);
    setSelected(v.sel); setCut(v.cut);
    router.replace(viewUrl(v), { scroll: false });
  };

  const q = useApiQuery('analytics-slow-sizes', () => getSlowSizes());
  const all = q.data?.sizes;

  // FILTERS (see header) — at size grain.
  const passes = useCallback((s: SlowSize) => {
    if (brand && s.brand !== brand) return false;
    if (neverOnly && s.last_sale) return false;
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = `${s.code} ${s.title ?? ''} ${s.brand ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }, [brand, neverOnly, search]);
  const filtering = !!brand || !!search.trim() || neverOnly;

  const brands = useMemo(() => [...new Set((all ?? []).filter((s) => box.test(s))
    .map((s) => s.brand).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b)), [all, box]);

  // THE STYLE ROWS: this box's sizes (filtered) are white; every other size of the style — held in another box or not held — is grey.
  const rows = useMemo(() => {
    if (!q.data) return [];
    const heldBy = new Map<string, SlowSize[]>();
    for (const s of q.data.sizes) { const l = heldBy.get(s.groupid); if (l) l.push(s); else heldBy.set(s.groupid, [s]); }
    const othersBy = new Map<string, Tile[]>();
    for (const o of q.data.others) {
      const t: Tile = { code: o.code, size: o.size, slow: null, white: false };
      const l = othersBy.get(o.groupid); if (l) l.push(t); else othersBy.set(o.groupid, [t]);
    }
    const img = new Map(q.data.styles.map((x) => [x.groupid, x.imagename]));
    const whiteBy = new Map<string, SlowSize[]>();
    for (const s of q.data.sizes) {
      if (!box.test(s) || !passes(s)) continue;
      const l = whiteBy.get(s.groupid); if (l) l.push(s); else whiteBy.set(s.groupid, [s]);
    }
    const out: StyleRow[] = [];
    for (const [groupid, white] of whiteBy) {
      const isWhite = new Set(white.map((s) => s.code));
      const run = [
        ...(heldBy.get(groupid) ?? []).map((s): Tile => ({ code: s.code, size: s.size, slow: s, white: isWhite.has(s.code) })),
        ...(othersBy.get(groupid) ?? []),
      ].sort(bySize);
      const longest = white.reduce((a, s) => (s.idle_days > a.idle_days ? s : a), white[0]);
      out.push({
        groupid, title: white[0].title, brand: white[0].brand, imagename: img.get(groupid) ?? null, white, run, longest,
        stock: white.reduce((t, s) => t + s.units, 0), sold: white.reduce((t, s) => t + s.sold_12m, 0),
        styleSold: white[0].style_sold_12m,
      });
    }
    return out;
  }, [q.data, box, passes]);

  // THE ORDER: longest wait first by default; a header click sorts by it (text A–Z / numbers biggest first), again flips, a third
  // goes back to the default. Ties: longest wait, then group id.
  const sorted = useMemo(() => {
    const dflt = (a: StyleRow, b: StyleRow) => b.longest.idle_days - a.longest.idle_days || a.groupid.localeCompare(b.groupid);
    if (!sortBy) return [...rows].sort(dflt);
    const val = SORT_VALUE[sortBy];
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return (sortDir === 'desc' ? -c : c) || dflt(a, b);
    });
  }, [rows, sortBy, sortDir]);
  const toggleSort = (key: SortKey) => {
    const first = TEXT_KEYS.includes(key) ? 'asc' : 'desc';
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
  const visible = useMemo(() => { const h = new Set(cut); return sorted.filter((g) => !h.has(g.groupid)); }, [sorted, cut]);
  const cutHere = sorted.length - visible.length;
  const selectedHere = useMemo(() => { const s = new Set(selected); return visible.filter((g) => s.has(g.groupid)).map((g) => g.groupid); }, [visible, selected]);
  const menuGroupid = selected.length === 1 ? selected[0] : null;
  const menuRow = visible.find((g) => g.groupid === menuGroupid) ?? null;

  // A ROW CLICK — Windows rules, as New Additions: plain = just this row (again = none), Ctrl/⌘ = toggle one, Shift = the range from the
  // anchor, Ctrl+Shift = add the range.
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
  const refreshScreen = () => { setAnchor(null); setView({ cut: [], sel: [] }); void q.refresh(); };

  // The product menu's height, for the sticky table header to sit under it (callback ref + ResizeObserver — no effect).
  const [menuH, setMenuH] = useState(0);
  const menuRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setMenuH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The size screen's ← Back: this view, landing on the row that was clicked.
  const sizesHref = (groupid: string) =>
    `/analytics/slow-sizes/${encodeURIComponent(groupid)}?from=${encodeURIComponent(`${selfUrl}#style-${groupid}`)}`;

  return (
    <AppShell backHref={from ?? '/analytics/slow-sizes'} backLabel="Slow movers">
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {q.data && (
        <>
          {/* FILTERS — narrow the list. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={brand} onChange={(e) => setView({ brand: e.target.value, sel: [] })} aria-label="Brand"
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700">
              <option value="">All brands</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <input type="search" value={search} placeholder="Search code, title or brand"
              onChange={(e) => setView({ q: e.target.value, sel: [] })}
              className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400" />
            <label className="inline-flex cursor-pointer items-center gap-1.5 px-1 text-sm text-slate-700">
              <input type="checkbox" checked={neverOnly} onChange={(e) => setView({ ns: e.target.checked, sel: [] })}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              Never sold only
            </label>
            {filtering && (
              <button type="button" onClick={() => setView({ brand: '', q: '', ns: false, sel: [] })}
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

          {/* THE BAR — which box, what's on screen, Cut and Refresh. (Park and the bulk price moves join it in the next pass.) */}
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">
            <span className="font-medium text-slate-700">{box.label}</span>
            <span className="text-xs text-slate-400">{box.sub}</span>
            <span className="tabular-nums">
              {n(visible.length)} style{visible.length === 1 ? '' : 's'} · {n(visible.reduce((t, g) => t + g.stock, 0))} in stock
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
          </div>

          <div tabIndex={-1} onKeyDown={onListKey}
            className="w-fit max-w-full overflow-clip rounded-xl border border-slate-200 bg-white focus:outline-none">
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                {cutHere > 0 ? 'Every row is cut — press Refresh to bring them back.' : 'Nothing here with these filters.'}
              </p>
            ) : (
              <table className="text-sm">
                <thead className="sticky z-10 bg-slate-50 text-xs text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]" style={{ top: menuH }}>
                  <tr>
                    <th className="w-[30rem] py-2.5 pl-4 pr-3 text-left font-medium">{sortBtn('style', 'Style')}</th>
                    <th className="w-32 border-l border-slate-200 py-2.5 pl-3 pr-4 text-left font-medium">{sortBtn('brand', 'Brand')}</th>
                    <th className="border-l border-slate-200 py-2.5 pl-3 pr-4 text-right font-medium"
                      title="Days without a sale — the longest-waiting white size, and the month it last sold">{sortBtn('days', 'Days')}</th>
                    <th className="border-l border-slate-200 py-2.5 pl-3 pr-4 text-right font-medium"
                      title="Qty in stock of the white sizes (local + Amazon)">{sortBtn('stock', 'In stock')}</th>
                    <th className="border-l border-slate-200 py-2.5 pl-3 pr-4 text-right font-medium"
                      title="Qty of the white sizes sold in the last 12 months, net of returns (hover a figure for the whole style)">{sortBtn('sold', 'Sold 12m')}</th>
                    <th className="w-10 border-l border-slate-200 py-2.5"><span className="sr-only">Hide</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((g) => {
                    const isSel = selected.includes(g.groupid);
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
                        <td className="border-l border-slate-100 py-3 pl-3 pr-4 align-top text-slate-700">
                          {g.brand || <span className="text-slate-300">–</span>}
                        </td>
                        <td className="whitespace-nowrap border-l border-slate-100 py-3 pl-3 pr-4 text-right align-top tabular-nums">
                          <LastSold s={g.longest} />
                        </td>
                        <td className="border-l border-slate-100 py-3 pl-3 pr-4 text-right align-top font-semibold tabular-nums text-slate-900">
                          {n(g.stock)}
                        </td>
                        <td className="border-l border-slate-100 py-3 pl-3 pr-4 text-right align-top tabular-nums text-slate-700"
                          title={`The whole style sold ${n(g.styleSold)} in the last 12 months`}>
                          {g.sold ? n(g.sold) : <span className="text-slate-300">–</span>}
                        </td>
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

// THE NEVER-SOLD MARK — a small rose dot on a white tile's corner (the front screen's boxes use the same dot in their "never sold" line).
function Dot() {
  return <span aria-hidden className="absolute right-0.5 top-0.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />;
}

// THE SIZE RUN — white = in this box (size · qty, the dot if never sold; a link to the style's size screen), grey = the rest.
function SizeRun({ g, href }: { g: StyleRow; href: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {g.run.map((t) => {
        const s = t.slow;
        if (t.white && s) {
          const tip = !s.last_sale
            ? `Size ${t.size} · ${n(s.units)} in stock · never sold — ${n(s.idle_days)} days since it arrived`
            : s.idle_from === 'arrival'
              ? `Size ${t.size} · ${n(s.units)} in stock · ${n(s.idle_days)} days since it was restocked (last sold ${monthOf(s.last_sale)})`
              : `Size ${t.size} · ${n(s.units)} in stock · ${n(s.idle_days)} days since it last sold (${monthOf(s.last_sale)})`;
          return (
            <Link key={t.code} href={href} title={tip} onClick={(e) => e.stopPropagation()}
              className="relative flex h-6 min-w-[2.25rem] items-center justify-center gap-1 rounded bg-white px-1.5 text-[11px] font-semibold tabular-nums text-slate-900 ring-1 ring-inset ring-slate-400 transition hover:bg-brand-50 hover:ring-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
              {t.size}<span className="font-normal text-slate-500">·{s.units}</span>
              {!s.last_sale && <Dot />}
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

// DAYS — days first, the month second and muted (owner, 2026-10-15). Never sold = "no sale" (the days run from its arrival); restocked
// since the last sale = "restock" (the clock runs from that delivery; the last sale on hover).
function LastSold({ s }: { s: SlowSize }) {
  const second = !s.last_sale ? 'no sale' : s.idle_from === 'arrival' ? 'restock' : monthOf(s.last_sale);
  return (
    <>
      <span className="font-semibold text-slate-900">{n(s.idle_days)}</span>
      <span className="ml-2 inline-block w-12 text-left text-xs text-slate-400"
        title={s.last_sale && s.idle_from === 'arrival' ? `Last sold ${monthOf(s.last_sale)}` : undefined}>{second}</span>
    </>
  );
}
