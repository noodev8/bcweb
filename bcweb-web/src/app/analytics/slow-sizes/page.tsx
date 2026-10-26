'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes  (SLOW SIZES — its own Back Office tile, and the "Sizes →" link on Slow, /analytics/stock-sales)
=======================================================================================================================================
Purpose: Every SIZE we hold, by how long since it last sold. Owner, 2026-10-15: "My interest is in individual SKUs that just haven't
         shifted the longest. I get the top 50 of those and work on them ... I will then decide how to deal with them." Slow lists
         STYLES with no sale in 90 days, so a style that sells in its middle sizes never shows there even when one big size has sat
         for a year (the owner's example: Milano). This is that question one level down.

SUMMARY FIRST, THEN THE SIZES (owner, same day: "maybe a summary of your breakdown ... Then I click into it to see the details").
         WORDING (owner, same day): "pairs" reads as a count of SIZES to the owner ("5/8 pairs made a sale"), so stock and sales are
         QTY / "in stock" on screen, never "pairs".
         Bands, each a box with its QTY IN STOCK (the headline — owner, 2026-10-15: "Change the headline figure of the card to Pairs.
         Dont need sizes") and styles. The bands DON'T
         overlap, so they add up to the line above them:
           Clearance (9 months+) | 6–9 months | 3–6 months
         (Until 2026-10-26: over a year | 6–12 months | 3–6 months. Owner, 2026-10-26: "Something that hasnt been sold for 9 months is
         a proper loser" — the top box is now CLEARANCE, the server's per-size flag (9 calendar months; utils/slowSizes.js), the very
         rows Process's Clearance card counts, so the two show the same numbers. Days are since the last NET sale — a sale that came
         back doesn't count.)
         ("Up to 3 months" went the same day — owner: "Thats the winners mindset". Sizes that sold in 91 days aren't shown at all;
         the server still returns them, the page just has no box for them.)
         (A fifth, "never sold, here since before 2025", went the same day when pre-log pairs were dated 31 Dec 2024 — owner:
         "everything rolls as standard instead of putting text in". Never-sold sizes now sit in the band their shelf days put them in.)
         (91 / 183 days — Sell-through's age steps, utils/unitAge.js — then the 9-month Clearance flag). Clicking a box opens its sizes below,
         longest first; clicking it again closes them. The open band sits in the URL (?band=), so ← Back from the drill reopens it.
         Nothing opens by default — the summary is the first read.

         A LIST, NOT A RULE: no cut-off, no flag, no actions. The owner decides what to do with each; ← Back from the style screen
         returns here with the band and sort kept.

CUT × (owner, same day: "add the cut × like on Slow"). DISPLAY ONLY, exactly as Slow: a row's × takes it off the screen until Reset
         or a reload — nothing is stored, no cut count is shown (owner: "Just cut them away"), the boxes keep their full counts. Cuts are kept while
         you switch boxes.

CLICK THE STYLE (owner, same day: "I would prefer to have the breakdown on a separate screen by clicking the style. Not have it in
         the main list. Too much info."). Style opens /analytics/slow-sizes/[groupid] — the style's full size run, the clicked size
         highlighted — and that screen links on to the price drill. (It opened inline under the row for a few hours; the Style link
         went straight to pricing.)

         Days = how long the stock held NOW has sat without a sale: since the later of the last sale (any channel; a return is not
         a sale) and the oldest held pair's arrival (owner, 2026-10-15: "this screen is about clearing losers" — a restocked size
         isn't charged for the months it was sold out; until then deliveries were ignored, as on Slow). A restocked size shows
         "restock" in the month's slot (hover for its last sale). DAYS SINCE LAST SOLD
         ONLY on screen (owner, 2026-10-15: "show days since last sold only, drop on shelf" — the two numbers side by side confused).
         LAST SOLD is one column (owner, same day: days first, the month second — "only reason date helps is to see if it is season
         based"), e.g. "754  Sep 24". A never-sold size shows its days since it ARRIVED and "no sale" (e.g. "653  no sale") —
         a bare "never" read as new (owner, same day) — and is still banded and ranked by its days on the shelf (the server's idle_days,
         utils/onShelf.js — oldest pair's arrival, before the log = 31 Dec 2024), so it lands where its wait puts it. Qty sold (12m) = the whole style's net sales in the last 12 months — high there with a big
         Days here is the dead-size-in-a-selling-style case. Rules: routes/analytics-slow-sizes.js.

LOOK (owner, 2026-10-15: "the design of your size screen has improved so much ... take a look at this front screen as well").
         No intro line above the boxes (owner, same day: removed "1,017 in stock in sizes that haven't sold ... Click a box").
         The boxes carry their band's colour — the same rose / orange / yellow as the style screen's tiles (one TONES set each side, keep
         them in step) — and are short: label, then the qty in stock and styles on one line. The open box is tinted in its own colour,
         not ringed in black (a dark ring on the style screen distracted). The list is tighter: style, size and brand share one cell
         (XM620A · 12 · Grafters — since 2026-10-26 the plain code with room to itself and Brand its own sortable column, no size pill; owner), so it reads as six columns, not eight, with less space between small numbers; size and brand lost
         their own sort (within a band the order that matters is Last sold, and Style still sorts).

BACK LANDS ON THE ROW (owner, same day: "when returning to it from sizes, can we scroll to the style we clicked?"). Each row has an id
         (size-<code>) and its Style link hands the style screen a ?from= that ends in #size-<code>; that screen's ← Slow Sizes is a Link to
         it, and Next scrolls to the hash. The data is in SWR's cache by then, so the row is there to scroll to.

Guarded by AppShell. Consumes GET /analytics-slow-sizes.
=======================================================================================================================================
*/

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SortableTh, STICKY_TH, useTableSort } from '@/components/SortableTh';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSlowSizes, SlowSize } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');

// Month names for 'YYYY-MM-DD' read by split, never the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The bands, longest wait first, by days since the last net sale (never sold = days on the shelf). CLEARANCE is the server's flag
// (9 calendar months — Process's Clearance card counts the same rows); the shorter bands are day steps. Colours = the style screen's
// TONES ([groupid]/page.tsx): bar = the box's top edge, on = the open box's tint and border.
const BANDS = [
  { key: 'cl', label: 'Clearance', sub: 'not sold for 9 months+', test: (s: SlowSize) => s.clearance,
    bar: 'border-t-rose-300', on: 'border-rose-300 bg-rose-50' },
  { key: 'm6', label: '6–9 months', sub: '184 days – 9 months', test: (s: SlowSize) => !s.clearance && s.idle_days > 183,
    bar: 'border-t-orange-300', on: 'border-orange-300 bg-orange-50' },
  { key: 'm3', label: '3–6 months', sub: '92–183 days', test: (s: SlowSize) => s.idle_days > 91 && s.idle_days <= 183,
    bar: 'border-t-yellow-300', on: 'border-yellow-300 bg-yellow-50' },
] as const;
type BandKey = (typeof BANDS)[number]['key'];

// useSearchParams (← Back origin, band, sort) needs a Suspense boundary for Next's build.
export default function SlowSizesPage() {
  return (
    <Suspense fallback={null}>
      <SlowSizesBody />
    </Suspense>
  );
}

function SlowSizesBody() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // ← Back: ?from= when Slow sent us here (same-site paths only), else Back Office — the tile is the main door.
  const raw = sp.get('from');
  const from = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  const back = from ? sp.get('back') || 'Back' : null;

  const rawBand = sp.get('band');
  const open = BANDS.some((b) => b.key === rawBand) ? (rawBand as BandKey) : null;

  const q = useApiQuery('analytics-slow-sizes', () => getSlowSizes());
  // CUT — display only (see header). Held here, not in the table, so cuts survive switching boxes.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const sizes = q.data?.sizes ?? [];

  // Click handler, not an effect (docs/maintenance-notes.md). A new band drops the sort — each band opens longest first.
  function toggle(key: BandKey) {
    const nq = new URLSearchParams(sp.toString());
    nq.delete('sort');
    if (open === key) nq.delete('band'); else nq.set('band', key);
    router.replace(`${pathname}${nq.toString() ? `?${nq}` : ''}`, { scroll: false });
  }

  const summary = BANDS.map((b) => {
    const rows = sizes.filter((s) => b.test(s));
    return {
      ...b,
      rows,
      pairs: rows.reduce((t, s) => t + s.units, 0),
      styles: new Set(rows.map((s) => s.groupid)).size,
    };
  });
  const openBand = summary.find((b) => b.key === open);

  // THE BOXES AND THE LIST'S HEADERS STAY ON SCREEN, WITH ONE SCROLLBAR (owner, 2026-10-26 — the trick on Today, /process): the boxes
  // stick to the top of the page, the header row just under them, so it needs their height — measured, since the boxes stack on a
  // phone. The table has no scroll box of its own: an overflow container would capture the sticky header and add a second scrollbar.
  const [boxesHeight, setBoxesHeight] = useState(0);
  const boxesRef = (el: HTMLElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxesHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  };

  return (
    <AppShell backHref={from ?? '/dashboard?g=products'} backLabel={back ?? 'Products & stock'}>
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {q.data && (
        <>
          <div ref={boxesRef} className="sticky top-0 z-20 -mx-4 grid grid-cols-1 gap-3 bg-slate-100 px-4 py-3 sm:grid-cols-3">
            {summary.map((b) => (
              <button key={b.key} type="button" onClick={() => toggle(b.key)} aria-pressed={open === b.key}
                className={
                  `rounded-lg border border-t-4 ${b.bar} px-4 py-3 text-left shadow-sm transition ` +
                  (open === b.key ? b.on : 'border-slate-200 bg-white hover:border-slate-300')
                }>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700">{b.label}</span>
                  <span className="text-xs text-slate-400">{b.sub}</span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold leading-none text-slate-900">{n(b.pairs)}</span>
                  <span className="text-sm text-slate-500">in stock · {n(b.styles)} styles</span>
                </div>
              </button>
            ))}
          </div>
          {openBand && (
            <SizeTable key={openBand.key} stickyTop={boxesHeight} title={openBand.label} sub={openBand.sub} sizes={openBand.rows}
              hidden={hidden} onCut={(code) => setHidden((h) => new Set([...h, code]))} onReset={() => setHidden(new Set())} />
          )}
        </>
      )}
    </AppShell>
  );
}

// Opens in the server's order (longest idle first); headers sort, the sort sits in the URL so ← Back from the drill keeps it.
function SizeTable({ stickyTop, title, sub, sizes, hidden, onCut, onReset }: {
  stickyTop: number; title: string; sub: string; sizes: SlowSize[];
  hidden: Set<string>; onCut: (code: string) => void; onReset: () => void;
}) {
  const { sorted, sort, onSort } = useTableSort(sizes, {
    code: (s) => s.code,
    brand: (s) => (s.brand || '').toLowerCase(),
    units: (s) => s.units,
    days: (s) => s.idle_days,
    style_12m: (s) => s.style_sold_12m,
  });
  const th = { sort, onSort, stickyTop };
  const rows = sorted.filter((s) => !hidden.has(s.code));
  const cutHere = sizes.length - rows.length;
  // This page's own URL as it stands (band, sort, origin), so ← Back from the drill lands on the same view.
  const sp = useSearchParams();
  const selfPath = `/analytics/slow-sizes${sp.toString() ? `?${sp}` : ''}`;
  // The style screen's ← Back: this view, ending at the row that was clicked (see BACK LANDS ON THE ROW).
  const backTo = (code: string) => encodeURIComponent(`${selfPath}#size-${code}`);

  return (
    // THE WHOLE WIDTH, NUMBERS TOGETHER (owner, 2026-10-26: "move the other columns closer to each other", then "Use the whole
    // width"). The table spans the page; the number columns (and #, ×) shrink to their content (w-px + nowrap), so all the spare
    // width goes to Code and Brand and In stock / Last sold / Qty sold stay a tight block at the right.
    <div className="mt-1 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="text-sm font-medium text-slate-700">
          {title}{' '}
          <span className="font-normal text-slate-400">· {sub} · {n(sizes.reduce((t, s) => t + s.units, 0))} in stock</span>
        </div>
        {hidden.size > 0 && (
          <button type="button" onClick={onReset} className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline">
            Reset
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">{cutHere > 0 ? 'Every row is cut — Reset to bring them back.' : 'No sizes here.'}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className={`w-px px-4 py-2 text-right font-normal ${STICKY_TH}`} style={{ top: stickyTop }}>#</th>
              <SortableTh {...th} sortKey="code" label="Code" firstDir="asc" />
              <SortableTh {...th} sortKey="brand" label="Brand" firstDir="asc" />
              <SortableTh {...th} compact sortKey="units" label="In stock" align="right" />
              <SortableTh {...th} compact sortKey="days" label="Last sold" align="right" title="Days since it last sold, and the month" />
              <SortableTh {...th} compact sortKey="style_12m" label="Qty sold (12m)" align="right"
                title="Items of this style sold in the last 12 months, all sizes" />
              <th className={`w-px py-2 pl-2 pr-4 ${STICKY_TH}`} style={{ top: stickyTop }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              // Back from the style screen scrolls to this row: clear of the sticky boxes and header row (~2.5rem).
              <tr key={s.code} id={`size-${s.code}`} style={{ scrollMarginTop: stickyTop + 40 }}
                className="border-b border-slate-100 text-slate-700 last:border-0 hover:bg-slate-50">
                <td className="w-px px-4 py-1.5 text-right tabular-nums text-xs text-slate-400">{i + 1}</td>
                {/* The code gets room of its own (owner, 2026-10-26) — the longest (JLY219-BRONWYN-BK-06) fit with space to spare. */}
                <td className="w-[60%] whitespace-nowrap px-4 py-1.5">
                  <Link href={`/analytics/slow-sizes/${encodeURIComponent(s.groupid)}?from=${backTo(s.code)}`} title={s.title ?? undefined}
                    className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                    {s.code}
                  </Link>
                </td>
                <td className="w-[40%] whitespace-nowrap px-4 py-1.5 text-slate-500">{s.brand ?? <span className="text-slate-300">—</span>}</td>
                <td className="w-px whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">{n(s.units)}</td>
                <td className="w-px whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                  <LastSold days={s.idle_days} date={s.last_sale} from={s.idle_from} />
                </td>
                <td className="w-px whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                  {s.style_sold_12m ? n(s.style_sold_12m) : <span className="text-slate-300">—</span>}
                </td>
                <td className="w-px py-1.5 pl-2 pr-4 text-right">
                  <button type="button" aria-label={`Cut ${s.code}`} title="Cut this row (Reset brings it back)"
                    onClick={() => onCut(s.code)}
                    className="px-1 text-base leading-none text-slate-300 hover:text-slate-700">&times;</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// LAST SOLD — one cell: days since the last sale first (the read), the month it sold second and muted (owner, 2026-10-15: "I would
// look at the number of days first, date secondary. Only reason date helps is to see if it is season based") — so month + year only.
// Never sold = "never". The month sits in a fixed-width slot so the day counts line up.
// NEVER SOLD (owner, 2026-10-15: a bare "never" read as NEW): the day count runs from the day its oldest unit arrived, as though that
// were its last sale (the server's idle_days already is), and "no sale" takes the month's slot — so 653 "no sale" reads as stuck
// and 30 "no sale" as new. Every row leads with a number.
// RESTOCK (owner, same day): when the stock held now arrived after the last sale, the server runs the clock from that delivery, so the
// month would be a lie beside the number — "restock" takes its slot, the last sale on hover.
function LastSold({ days, date, from }: { days: number; date: string | null; from: 'sale' | 'arrival' }) {
  let month = '';
  // This year = month only ("Oct 26" read as the 26th, owner 2026-10-15); another year keeps its two digits.
  if (date) {
    const [y, m] = date.split('-').map(Number);
    month = y === new Date().getFullYear() ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${String(y).slice(2)}`;
  }
  const second = !date ? 'no sale' : from === 'arrival' ? 'restock' : month;
  return (
    <>
      <span className="font-semibold text-slate-900">{days.toLocaleString('en-GB')}</span>
      <span className="ml-2 inline-block w-12 text-left text-xs text-slate-400"
        title={date && from === 'arrival' ? `Last sold ${month}` : undefined}>{second}</span>
    </>
  );
}
