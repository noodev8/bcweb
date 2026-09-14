'use client';
/*
=======================================================================================================================================
Component: BirkTrackerBook
=======================================================================================================================================
Purpose: The Birk Tracker screen — where a Birkenstock season order lives between being placed and being on the shelf. Answers, in
         this order: what is still to come, what is on its way, what has landed. Reads /birk-tracker-lines. READ ONLY for now.

NOT A PORT OF THE LEGACY GRID (owner, 2026-09-14: "you dont need to copy the layout from the old app… think about how it can best be
done and used"). The first two cuts were the PowerBuilder screen redrawn in Tailwind — twelve columns, two filter rails, one row per
size — and they felt clunky because the legacy shape is wrong for the question, not merely old:

  - ONE ROW PER SIZE buried the reading. 166 rows say nothing you can hold in your head; the same book is 46 STYLES, and a style with
    its size run is how a shoe buyer already thinks about an order. Style is now the unit of reading and size the unit of detail, one
    click down. (Verified against the live table: every code splits cleanly on a trailing 2-digit size, and `due` never varies within
    a style, so a style block is a real object and not a convenient fiction.)
  - THE TWELVE COLUMNS WERE THE SIDE-SCROLL. Most were per-ORDER facts (ordernum, placed) repeated down forty rows, or one fact split
    in two (invoice number / invoice date, cost / rrp). Folded up, nothing needs a table at all — so there isn't one. Flex rows reflow;
    a table would put the columns back and the scrollbar with them.
  - THE STATUS WAS SOMETHING YOU DERIVED YOURSELF by comparing three columns across a row. That comparison IS the screen's job, so it
    is now computed and made the primary filter.

THE THREE STATES, and they are the screen's whole vocabulary — same three words, same three colours, at every level (book bar, order
bar, style row, size chip):
  STILL TO COME (slate)    ordered, not invoiced, not here. A promise with a month against it.
  ON THE WAY (amber)       invoiced or part-arrived. Birkenstock has billed it, so they have committed to it; it is between them and
                           us. This is the state worth chasing, hence the only warm colour on the screen.
  ARRIVED (emerald)        all of it is in the building. Done, so it recedes — the ink belongs on lines that still need something.
Note the live book currently holds no ON THE WAY lines at all (everything invoiced has also arrived). It is still a first-class state
rather than a special case: it is the entire reason `invoiced` and `arrived` are two numbers instead of one, and it is what the screen
will mostly be showing in the weeks after an invoice lands.

WHY A BAR AND NOT THREE STAT TILES at the top. The book's figures are PARTS OF ONE WHOLE (318 pairs, split three ways), and three
numbers in three boxes is the one arrangement that hides that. One segmented bar shows the proportion at a glance and the sentence
under it says the same thing in words for the person who wants the count. It is also the only loud element on the screen; everything
else is quiet on purpose.

FILTERS: status tabs (with live counts, so the tab itself says whether there is anything to do), plus order, invoice and a search box.
All of it is client-side over one response — a rail click is instant and the box filters per keystroke, which is most of what makes
this feel like the desktop app it replaces rather than a website. Choosing an invoice or typing a search AUTO-EXPANDS the matching
styles: both mean "show me the sizes", and making you click again afterwards is exactly the kind of clunk this pass is removing.

EVERYTHING ON SCREEN DESCRIBES THE FILTER, not the book — the summary, the tab counts and the order bars all follow what you have
narrowed to. Filter to one invoice and the top line is that invoice's position, which is the question being asked while holding it.

VALIDATE and CHECK SHOPIFY were removed outright (owner, 2026-09-14) — don't reinstate them from the legacy screenshot. The remaining
write actions aren't drawn as dead buttons either; a row of five greyed-out controls was its own kind of clunk. One quiet line at the
foot of the screen says what is coming instead.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { ArrowDownTrayIcon, MagnifyingGlassIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { getBirkTrackerLines, type BirkTrackerLine } from '@/lib/api';

// --- the three states ----------------------------------------------------------------------------------------------------------
// One definition, used by the filter, the counts, the rows and the chips, so the screen can never disagree with itself.
type State = 'awaiting' | 'transit' | 'arrived';

function lineState(r: BirkTrackerLine): State {
  if (r.requested > 0 && r.arrived >= r.requested) return 'arrived';
  // Billed but not all here, or part of it landed — either way it is between Birkenstock and us rather than still just a promise.
  if (r.invoiced > r.arrived || r.arrived > 0) return 'transit';
  return 'awaiting';
}

const STATE_LABEL: Record<State, string> = {
  awaiting: 'Still to come',
  transit: 'On the way',
  arrived: 'Arrived',
};

// Fill / text / soft-background per state. Kept in one table because the three colours are a vocabulary — if they ever drift apart
// between the bar and the chips, the screen stops being readable at a glance and starts needing a legend.
const STATE_STYLE: Record<State, { bar: string; dot: string; text: string; chip: string }> = {
  awaiting: { bar: 'bg-slate-300', dot: 'bg-slate-300', text: 'text-slate-500', chip: 'border-slate-200 bg-white text-slate-600' },
  transit: { bar: 'bg-amber-400', dot: 'bg-amber-400', text: 'text-amber-700', chip: 'border-amber-200 bg-amber-50 text-amber-800' },
  arrived: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
};

// Codes are `<style>-<2-digit EU size>` — verified across the whole live table. The fallback matters anyway: a code that ever stops
// following the rule must still appear (as its own single-size block) rather than vanish from the order it is part of.
function splitCode(code: string): { style: string; size: string } {
  const m = /^(.*)-(\d{2})$/.exec(code);
  return m ? { style: m[1], size: m[2] } : { style: code, size: '' };
}

function money(v: number | null): string {
  return v == null ? '' : v.toFixed(2);
}

// --- shapes the screen reads ---------------------------------------------------------------------------------------------------
interface Tally { requested: number; arrived: number; transit: number; awaiting: number }

// Units, not lines: a line is a row in a table, a pair is a shoe. Everything the operator counts is pairs.
function tally(rows: BirkTrackerLine[]): Tally {
  let requested = 0, arrived = 0, transit = 0;
  for (const r of rows) {
    requested += r.requested;
    arrived += r.arrived;
    // What has been billed but has not landed. Clamped: `invoiced` is keyed by hand and can overshoot what arrived on a correction,
    // and a negative segment would render as a bar going backwards.
    transit += Math.max(0, Math.min(r.invoiced, r.requested) - r.arrived);
  }
  return { requested, arrived, transit, awaiting: Math.max(0, requested - arrived - transit) };
}

interface StyleBlock {
  key: string;
  style: string;
  lines: BirkTrackerLine[];
  sizes: { size: string; line: BirkTrackerLine; state: State }[];
  state: State;          // worst-case across its sizes: one size still to come keeps the whole style unfinished
  due: string;
  invoices: string[];
  cost: number | null;
  rrp: number | null;
  totals: Tally;
}

interface OrderBlock {
  ordernum: string;
  placed: string;
  styles: StyleBlock[];
  totals: Tally;
}

// The style's state is the least-finished of its sizes. A style showing "Arrived" while one size is still outstanding would be the
// single most misleading thing this screen could say.
function worst(states: State[]): State {
  if (states.includes('awaiting')) return 'awaiting';
  if (states.includes('transit')) return 'transit';
  return 'arrived';
}

// --- small pieces --------------------------------------------------------------------------------------------------------------

// The book, an order, or a style as one bar: arrived | on the way | still to come. Proportion is the whole point, so it is never
// scaled to anything but the requested total.
function StateBar({ t, className = 'h-2' }: { t: Tally; className?: string }) {
  const pct = (n: number) => (t.requested > 0 ? (n / t.requested) * 100 : 0);
  return (
    <div className={'flex w-full overflow-hidden rounded-full bg-slate-200 ' + className} role="presentation">
      <div className={STATE_STYLE.arrived.bar} style={{ width: `${pct(t.arrived)}%` }} />
      <div className={STATE_STYLE.transit.bar} style={{ width: `${pct(t.transit)}%` }} />
      <div className={STATE_STYLE.awaiting.bar} style={{ width: `${pct(t.awaiting)}%` }} />
    </div>
  );
}

function Dot({ state }: { state: State }) {
  return <span className={'inline-block h-2 w-2 shrink-0 rounded-full ' + STATE_STYLE[state].dot} />;
}

// A <select> rather than the legacy screen's standing list: seven orders and eight invoices don't earn a permanent column of the
// screen, and the width they were taking is what the size chips now use.
function Picker({
  label, value, options, onChange,
}: { label: string; value: string | null; options: string[]; onChange: (v: string | null) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-500">
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs tabular-nums text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        <option value="">Any</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export default function BirkTrackerBook() {
  const { data, error, isLoading, busy, refresh } = useApiQuery('birk-tracker-lines', getBirkTrackerLines);

  const [state, setState] = useState<State | 'all'>('all');
  const [invoice, setInvoice] = useState<string | null>(null);
  const [ordernum, setOrdernum] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const rows = useMemo(() => data?.rows ?? [], [data]);

  // Everything except the status tabs. The tab COUNTS are taken from this, so they always say what clicking that tab would actually
  // show — a count that ignores the other filters sends you to an empty list.
  const scoped = useMemo(() => {
    const q = find.trim().toLowerCase();
    return rows.filter((r) => {
      if (invoice && r.invoice_num !== invoice) return false;
      if (ordernum && r.ordernum !== ordernum) return false;
      // Code, order and invoice number — the three things anyone arrives at this screen holding.
      if (q && !(r.code.toLowerCase().includes(q) || r.ordernum.toLowerCase().includes(q) || r.invoice_num.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, invoice, ordernum, find]);

  const counts = useMemo(() => {
    const c = { all: scoped.length, awaiting: 0, transit: 0, arrived: 0 };
    for (const r of scoped) c[lineState(r)] += 1;
    return c;
  }, [scoped]);

  const shown = useMemo(
    () => (state === 'all' ? scoped : scoped.filter((r) => lineState(r) === state)),
    [scoped, state],
  );

  // Order -> style -> size. Built in the order the route already sorted (ordernum, then code, which puts sizes in size order), so
  // nothing is re-sorted here and a block always reads the way the paperwork being checked against it reads.
  const orders = useMemo(() => {
    const out: OrderBlock[] = [];
    for (const r of shown) {
      const { style, size } = splitCode(r.code);
      let o = out[out.length - 1];
      if (!o || o.ordernum !== r.ordernum) {
        o = { ordernum: r.ordernum, placed: r.placed, styles: [], totals: tally([]) };
        out.push(o);
      }
      let s = o.styles[o.styles.length - 1];
      if (!s || s.style !== style) {
        s = { key: r.ordernum + '|' + style, style, lines: [], sizes: [], state: 'arrived', due: r.due, invoices: [], cost: null, rrp: null, totals: tally([]) };
        o.styles.push(s);
      }
      s.lines.push(r);
      s.sizes.push({ size, line: r, state: lineState(r) });
      if (r.invoice_num && !s.invoices.includes(r.invoice_num)) s.invoices.push(r.invoice_num);
      // Cost/RRP are per line in the table but per style in reality; first non-null wins, which is what the legacy screen shows too.
      if (s.cost == null) s.cost = r.cost;
      if (s.rrp == null) s.rrp = r.rrp;
    }
    for (const o of out) {
      for (const s of o.styles) {
        s.state = worst(s.sizes.map((x) => x.state));
        s.totals = tally(s.lines);
      }
      o.totals = tally(o.styles.flatMap((s) => s.lines));
    }
    return out;
  }, [shown]);

  const totals = useMemo(() => tally(shown), [shown]);
  const filtered = state !== 'all' || invoice !== null || ordernum !== null || find.trim() !== '';
  // Picking an invoice or typing a search both mean "show me the sizes" — expand without being asked.
  const forceOpen = invoice !== null || find.trim() !== '';

  function reset() {
    setState('all');
    setInvoice(null);
    setOrdernum(null);
    setFind('');
  }

  // Exports what is on screen: the filter is part of the question. The file keeps the flat one-row-per-size shape with every legacy
  // column, including the ones this screen folds up — a spreadsheet has no width problem, and flat is what makes it sortable.
  function exportCsv() {
    const head = ['Ordernum', 'Placed', 'Code', 'Requested', 'Cost', 'RRP', 'BK Size', 'Invoiced', 'Arrived', 'Invoice Date', 'Invoice Num', 'Due', 'Status', 'EAN'];
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      head.map(cell).join(','),
      ...shown.map((r) => [
        r.ordernum, r.placed, r.code, r.requested, money(r.cost), money(r.rrp), r.bksize,
        r.invoiced, r.arrived, r.invoice_date, r.invoice_num, r.due, STATE_LABEL[lineState(r)], r.ean,
      ].map(cell).join(',')),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `birk-tracker-${ordernum || invoice || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) return <div className="py-10 text-center text-sm text-slate-400">Loading the order book…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error.message}
        <button onClick={() => refresh()} className="ml-3 underline">Try again</button>
      </div>
    );
  }

  const TABS: { key: State | 'all'; label: string; count: number }[] = [
    { key: 'all', label: 'Everything', count: counts.all },
    { key: 'awaiting', label: STATE_LABEL.awaiting, count: counts.awaiting },
    { key: 'transit', label: STATE_LABEL.transit, count: counts.transit },
    { key: 'arrived', label: STATE_LABEL.arrived, count: counts.arrived },
  ];

  return (
    <div className="space-y-5">
      {/* --- the book in one line ------------------------------------------------------------------------------------------------
          The sentence carries the counts and the bar carries the proportion. Both describe what the filters have narrowed to, so this
          block answers "where is this order / this invoice up to?" as readily as it answers it of the whole book. */}
      <section>
        <p className="text-lg text-slate-900">
          <span className="font-semibold tabular-nums">{totals.requested}</span> pairs {filtered ? 'in view' : 'on order'}
          {totals.requested > 0 && (
            <span className="text-slate-500">
              {' — '}
              <span className="font-medium tabular-nums text-emerald-700">{totals.arrived}</span> arrived,{' '}
              <span className="font-medium tabular-nums text-amber-700">{totals.transit}</span> on the way,{' '}
              <span className="font-medium tabular-nums text-slate-700">{totals.awaiting}</span> still to come
            </span>
          )}
        </p>
        <div className="mt-2.5">
          <StateBar t={totals} className="h-2.5" />
        </div>
      </section>

      {/* --- filters -------------------------------------------------------------------------------------------------------------
          Status first and biggest: it is the question the screen exists for, and the count on each tab says whether there is anything
          behind it before you click. Order / invoice / search are the narrowing controls and sit on their own quieter line. */}
      <section className="space-y-3">
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {TABS.map((t) => {
            const active = state === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setState(t.key)}
                aria-pressed={active}
                className={
                  'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm transition ' +
                  (active ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')
                }
              >
                {t.key !== 'all' && <Dot state={t.key} />}
                {t.label}
                <span className={'tabular-nums ' + (active ? 'text-slate-500' : 'text-slate-400')}>{t.count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a style, order or invoice"
              className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <Picker label="Order" value={ordernum} options={data?.ordernums ?? []} onChange={setOrdernum} />
          <Picker label="Invoice" value={invoice} options={data?.invoices ?? []} onChange={setInvoice} />
          {filtered && (
            <button type="button" onClick={reset} className="text-sm text-slate-500 underline hover:text-slate-700">
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={exportCsv}
            disabled={shown.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <ArrowDownTrayIcon className="h-4 w-4" /> Export
          </button>
        </div>
      </section>

      {data?.truncated && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing {rows.length} of {data.total} lines — the safety cap cut the rest.
        </div>
      )}

      {/* --- the orders ----------------------------------------------------------------------------------------------------------- */}
      {orders.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center">
          <p className="text-sm text-slate-600">
            {state === 'transit' && !invoice && !ordernum && !find
              ? 'Nothing is on the way — everything Birkenstock has invoiced has already arrived.'
              : 'Nothing here matches.'}
          </p>
          {filtered && (
            <button onClick={reset} className="mt-2 text-sm text-brand-600 underline hover:text-brand-700">
              Show the whole book
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <section key={o.ordernum} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {/* The order: its number, when we placed it, and how much of it is here. Per-order facts live here once instead of
                  repeating down every row, which is what the legacy grid did and what made it need scrolling. */}
              <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="min-w-0">
                  <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">{o.ordernum}</span>
                  {o.placed && <span className="ml-3 text-xs tabular-nums text-slate-500">placed {o.placed}</span>}
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-xs tabular-nums text-slate-500">
                    {o.totals.arrived} of {o.totals.requested} pairs arrived
                  </span>
                  <StateBar t={o.totals} className="h-1.5 w-24" />
                </div>
              </header>

              <ul className="divide-y divide-slate-100">
                {o.styles.map((s) => {
                  const isOpen = forceOpen || !!open[s.key];
                  const st = STATE_STYLE[s.state];
                  const range = s.sizes.length > 1 ? `${s.sizes[0].size}–${s.sizes[s.sizes.length - 1].size}` : s.sizes[0]?.size;
                  return (
                    <li key={s.key}>
                      {/* The style row. Everything needed to decide whether to open it: state, name, size range, pairs, and — when it
                          matters — the month it is due or the invoice that brought it. */}
                      <button
                        type="button"
                        onClick={() => setOpen((p) => ({ ...p, [s.key]: !isOpen }))}
                        aria-expanded={isOpen}
                        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-slate-50"
                      >
                        <ChevronRightIcon className={'h-4 w-4 shrink-0 text-slate-400 transition-transform ' + (isOpen ? 'rotate-90' : '')} />
                        <Dot state={s.state} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800" title={s.style}>{s.style}</span>

                        <span className="shrink-0 text-xs tabular-nums text-slate-400">
                          <span className="mr-3">{range}</span>
                          {s.totals.requested} {s.totals.requested === 1 ? 'pair' : 'pairs'}
                        </span>

                        {/* The one fact that changes with the state: what is still owed, or what brought it in. */}
                        <span className={'w-36 shrink-0 text-right text-xs font-medium ' + st.text}>
                          {s.state === 'arrived' && 'All arrived'}
                          {s.state === 'transit' && `${s.totals.arrived} of ${s.totals.requested} here`}
                          {s.state === 'awaiting' && (s.due ? `Due ${s.due}` : 'Still to come')}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
                          {/* The size run. Every ordered size, in size order, showing what arrived against what was asked for —
                              a part-delivered order is read size by size, and the gaps are the point. */}
                          <div className="flex flex-wrap gap-1.5">
                            {s.sizes.map(({ size, line, state: sz }) => (
                              <div
                                key={line.code}
                                title={`${line.code}${line.bksize ? ` — Birkenstock size ${line.bksize}` : ''}`}
                                className={'w-14 rounded-md border px-1.5 py-1 text-center ' + STATE_STYLE[sz].chip}
                              >
                                <div className="text-sm font-semibold tabular-nums">{size}</div>
                                <div className="text-[11px] tabular-nums opacity-80">
                                  {line.arrived} / {line.requested}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* The paperwork behind the row, and the money. Only what is actually known — a blank column is the legacy
                              screen's habit, not a fact worth printing. */}
                          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
                            {s.invoices.length > 0 && (
                              <span>
                                {s.invoices.length === 1 ? 'Invoice ' : 'Invoices '}
                                <span className="font-mono tabular-nums text-slate-700">{s.invoices.join(', ')}</span>
                                {s.lines.find((l) => l.invoice_date)?.invoice_date && (
                                  <span className="ml-1.5 tabular-nums">{s.lines.find((l) => l.invoice_date)?.invoice_date}</span>
                                )}
                              </span>
                            )}
                            {s.due && <span>Due <span className="text-slate-700">{s.due}</span></span>}
                            {s.cost != null && <span>Cost <span className="tabular-nums text-slate-700">{money(s.cost)}</span></span>}
                            {s.rrp != null && <span>RRP <span className="tabular-nums text-slate-700">{money(s.rrp)}</span></span>}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Read-only for now. Booking invoices and arrivals, adding lines and loading a Birkenstock confirmation file come next.
        {busy && <span className="ml-2">Refreshing.</span>}
      </p>
    </div>
  );
}
