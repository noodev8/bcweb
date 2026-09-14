'use client';
/*
=======================================================================================================================================
Component: BirkTrackerBook
=======================================================================================================================================
Purpose: The Birk Tracker screen — where a Birkenstock season order lives between being placed and being on the shelf, and where an
         invoice gets keyed against it. Answers: what is still to come, what is on its way, what has landed, and what Birkenstock has
         billed us for that we never ordered. Reads /birk-tracker-lines; writes /birk-tracker-save and /birk-tracker-clear-arrived.

-- ONE ROW PER SIZE (owner, 2026-09-14 — after a size-grid pass was tried and rejected) -------------------------------------------
A size is a ROW: size, Birkenstock's size label, the three counts, and THE INVOICE IT CAME ON. The size-grid
layout (sizes across the top, the three counts stacked down) reads beautifully and was the wrong answer for one concrete reason: it
has nowhere to put a per-size invoice number. A grid can only carry one invoice per style heading, and in this book four styles
already span two invoices — so the moment a style is delivered across two invoices, the grid either lies or hides the split. Checking
paperwork is the job, the invoice number is the paperwork, and it belongs on the same line as the numbers it paid for.

So: rows, but not the legacy grid's rows. The three things carried over from the grid attempt, which were real improvements:
  1. THE THREE COUNTS ARE ONE BLOCK. Ordered / Invoiced / Arrived sit adjacent in a tinted group rather than spread across the row
     with other columns between them. "Do these three agree?" is then a glance at one object, not a scan across a row.
  2. NO STATUS COLUMN AT ALL. It first held a status WORD, which only restated the stripe colour; that was replaced by a computed
     "outstanding" note ("2 to come", "1 not billed"), and the note went too (owner, 2026-09-14). With the three counts sitting
     adjacent, the gap between them IS visible — spelling it out in a fourth column was the screen doing arithmetic out loud that
     the reader can already see, and it cost the invoice column the width instead.
  3. KEYBOARD FLOW. Tab moves across a size (invoiced, then arrived, then the next size), and ENTER MOVES DOWN THE COLUMN to the same
     field of the next size. Keying an invoice is a column of numbers down a size run, so Enter is the stroke that matches the job.

-- WHAT THE THREE NUMBERS MEAN ---------------------------------------------------------------------------------------------------------
Their gaps are three different problems, which is why all three are on screen at once:
    ordered vs arrived    where is it?
    ordered vs invoiced   ARE WE BEING OVERCHARGED? — billed for more than we asked for
    invoiced vs arrived   billed and not here yet, or here and not yet billed
An over-invoice is a FLAG, not a state: a line can be fully arrived AND over-invoiced, and collapsing the two would hide the case
worth catching. It renders on top of the state — red row, its own filter tab, and a banner counted across the whole book, because
an overcharge you only see when you happen to filter the right way is one you will pay. The server never blocks it either (see
routes/birk-tracker-save.js): you must be able to key what the invoice ACTUALLY says in order to argue with it.

THE THREE STATES, the screen's whole vocabulary — same words, same colours, at every level (book bar, order bar, style dot, row stripe):
  STILL TO COME (slate)    ordered, not invoiced, not here. A promise with a month against it.
  ON THE WAY (amber)       billed or part-delivered, but the three do not yet agree. Worth chasing, hence the only warm colour.
  ARRIVED (emerald)        ordered, invoiced and arrived ALL MATCH. Done, so it recedes.

GREEN NEEDS ALL THREE TO AGREE (owner), not merely "everything turned up". The three numbers are three separate promises and a line is
finished only when none is left open: under-invoiced means Birkenstock still owes us the billing, over-invoiced means money to argue
about. Either way the line carries a question, and a line with a question stays on the screen that asks it. The rule lives in three
places that must move together — `stateOf` here, `complete` in routes/birk-tracker-lines.js, and the DELETE predicate in
routes/birk-tracker-clear-arrived.js, which removes exactly the rows this paints green.

"X OF Y ARRIVED" COUNTS AGAINST INVOICED, NOT ORDERED (owner). You can only receive what has been billed, so the invoice is the right
denominator for a delivery — measured against the order, a fully-delivered part-invoice reads as though it were short. What has NOT
been invoiced is a separate fact and the bar carries it: the bar stays proportioned against the order (the whole commitment, split
three ways) and is the one place the un-invoiced remainder is visible.

EDITING IS INLINE AND BATCHED. Nothing is written until Save. It batches because keying an invoice is ONE act covering tens of sizes
(the server writes the batch in one transaction), and because the invoice number and date belong to all of those rows at once — typed
once in the save bar, stamped across everything touched, rather than retyped into every size.
  THE STYLE HEADING IS NOT A CONTROL (owner, 2026-09-14). It briefly carried a pair count and two bulk shortcuts ("All as ordered",
  "Arrived = invoiced"); all three went. The pair count was already said by the order's own totals above and by the rows below it, and
  the shortcuts put two clickable things on a line whose whole job is to label the block beneath it — the row colours and the order
  summary already answer what those shortcuts were shortcutting to. The heading now says what the style is, when it is due and what it
  costs, and nothing else.
  State and colour recompute as you type, so a row turns green the moment the last pair is keyed in. That live feedback is why the
  editable cells are the same cells you read, rather than a separate edit mode.

CLEAR ARRIVED is the legacy "Delete Green" and it DELETES — no undo, no archive (see the route). Hence: confirmed with the count and
scope spelled out, disabled while edits are unsaved, and sends the count it expects so a stale screen is refused by the server rather
than silently taking rows nobody looked at.

ORDER AND INVOICE ARE ONE FILTER (owner): two ways of asking for one delivery's lines, so picking either REPLACES the other — there is
no state where both are set. Status tabs and the search box are genuine co-filters and do still stack.

UPLOAD is present but inert until the Birkenstock order-confirmation file format is known. Wire it to a real parse route before
enabling it; don't guess the columns.

NOTHING SCROLLS SIDEWAYS AT ANY WIDTH. Fixed-width slots keep the counts in a straight line down the page; the invoice column takes
what is left and truncates. Below `sm` the Birkenstock size label drops out, leaving size, the three counts and the invoice — which
is the minimum that still answers "where is this size, and what paid for it?".
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import {
  ArrowDownTrayIcon, ArrowUpTrayIcon, MagnifyingGlassIcon, ExclamationTriangleIcon, TrashIcon,
} from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getBirkTrackerLines, saveBirkTrackerLines, clearBirkTrackerArrived,
  type BirkTrackerLine,
} from '@/lib/api';

// --- the three states ----------------------------------------------------------------------------------------------------------
type State = 'awaiting' | 'transit' | 'arrived';

// Takes the counts rather than the row, so it can be asked about a line's SAVED values or about what is currently typed into it — the
// screen needs both, and one definition has to answer both or the colours drift from the numbers.
function stateOf(requested: number, invoiced: number, arrived: number): State {
  if (requested > 0 && invoiced === requested && arrived === requested) return 'arrived';
  if (invoiced > 0 || arrived > 0) return 'transit';
  return 'awaiting';
}

const STATE_LABEL: Record<State, string> = {
  awaiting: 'Still to come',
  transit: 'On the way',
  arrived: 'Arrived',
};

// Bar fill, row stripe, the tint behind the three-count block, and the figure colour. One table because these colours are a
// vocabulary: if the rows' greens stop matching the bar's, the screen needs a legend, and a screen that needs a legend is not
// glanceable.
const STATE_STYLE: Record<State, { bar: string; dot: string; stripe: string; group: string; text: string }> = {
  awaiting: { bar: 'bg-slate-300', dot: 'bg-slate-300', stripe: 'border-l-slate-300', group: 'bg-slate-100/70', text: 'text-slate-400' },
  transit: { bar: 'bg-amber-400', dot: 'bg-amber-400', stripe: 'border-l-amber-400', group: 'bg-amber-100/70', text: 'text-amber-800' },
  arrived: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', stripe: 'border-l-emerald-500', group: 'bg-emerald-100/60', text: 'text-emerald-800' },
};

// Stable DOM id per editable cell, so Enter can hand focus to the same field of the next size. getElementById takes any string, so
// the style names with spaces in them need no escaping.
function cellId(r: { ordernum: string; code: string }, field: 'invoiced' | 'arrived'): string {
  return `bt|${r.ordernum}|${r.code}|${field}`;
}

// Codes are `<style>-<2-digit EU size>` — verified across the whole live table. The fallback matters anyway: a code that ever stops
// following the rule must still appear (as its own single-size block) rather than vanish from the order it is part of.
function splitCode(code: string): { style: string; size: string } {
  const m = /^(.*)-(\d{2})$/.exec(code);
  return m ? { style: m[1], size: m[2] } : { style: code, size: '' };
}

function money(v: number | null): string {
  return v == null ? '' : v.toFixed(2);
}

// The natural key of a line, and of an edit against it — (ordernum, code), the pair the write route addresses rows by.
function keyOf(r: BirkTrackerLine): string {
  return r.ordernum + '|' + r.code;
}

interface Tally { requested: number; invoiced: number; arrived: number; barArrived: number; transit: number; awaiting: number }
interface Edit { invoiced: number; arrived: number }
interface Live { r: BirkTrackerLine; invoiced: number; arrived: number; state: State; over: boolean; dirty: boolean }

export default function BirkTrackerBook() {
  const { data, error, isLoading, busy, refresh } = useApiQuery('birk-tracker-lines', getBirkTrackerLines);

  const [state, setState] = useState<State | 'all' | 'over'>('all');
  const [focus, setFocus] = useState<{ kind: 'order' | 'invoice'; value: string } | null>(null);
  const [find, setFind] = useState('');

  // Unsaved edits, keyed by (ordernum|code). Absence means "unchanged", so discarding is emptying this and nothing has to be
  // reconciled against the server's copy.
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [stampNum, setStampNum] = useState('');
  const [stampDate, setStampDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  // What a line currently SHOWS — saved values with any unsaved edit laid over the top. Every count, colour and filter reads through
  // this, so typing moves a column through the states and the tabs exactly as saving it would.
  const live = useMemo(() => {
    const m = new Map<string, Live>();
    for (const r of rows) {
      const e = edits[keyOf(r)];
      const invoiced = e ? e.invoiced : r.invoiced;
      const arrived = e ? e.arrived : r.arrived;
      m.set(keyOf(r), {
        r, invoiced, arrived,
        state: stateOf(r.requested, invoiced, arrived),
        // Billed OR delivered above what we ordered — both mean they sent or charged more than we asked, and both want chasing.
        over: invoiced > r.requested || arrived > r.requested,
        dirty: !!e && (e.invoiced !== r.invoiced || e.arrived !== r.arrived),
      });
    }
    return m;
  }, [rows, edits]);

  const view = (r: BirkTrackerLine): Live => live.get(keyOf(r))!;

  // Everything except the status tabs — the tab COUNTS come from this, so they always say what clicking that tab would show.
  const scoped = useMemo(() => {
    const q = find.trim().toLowerCase();
    return rows.filter((r) => {
      if (focus?.kind === 'order' && r.ordernum !== focus.value) return false;
      if (focus?.kind === 'invoice' && r.invoice_num !== focus.value) return false;
      if (q && !(r.code.toLowerCase().includes(q) || r.ordernum.toLowerCase().includes(q) || r.invoice_num.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, focus, find]);

  /* eslint-disable react-hooks/exhaustive-deps -- `view` closes over `live`, which is the real dependency in each of these */
  const counts = useMemo(() => {
    const c = { all: scoped.length, awaiting: 0, transit: 0, arrived: 0, over: 0 };
    for (const r of scoped) {
      const v = view(r);
      c[v.state] += 1;
      if (v.over) c.over += 1;
    }
    return c;
  }, [scoped, live]);

  // Over-invoicing across the WHOLE book, not just the filtered view: an overcharge you only see after filtering the right way is one
  // you will end up paying.
  const overAll = useMemo(() => rows.filter((r) => view(r).over).length, [rows, live]);

  const shown = useMemo(() => {
    if (state === 'all') return scoped;
    if (state === 'over') return scoped.filter((r) => view(r).over);
    return scoped.filter((r) => view(r).state === state);
  }, [scoped, state, live]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Units, not lines: a line is a row in a table, a pair is a shoe. `invoiced`/`arrived` are the RAW keyed totals — uncapped, so an
  // over-invoice shows as a bigger number, which is the point of the column. `barArrived` is clamped, for the bar only.
  const tally = (list: BirkTrackerLine[]): Tally => {
    let requested = 0, invoiced = 0, arrived = 0, barArrived = 0, transit = 0;
    for (const r of list) {
      const v = view(r);
      requested += r.requested;
      invoiced += v.invoiced;
      arrived += v.arrived;
      const landed = Math.min(v.arrived, r.requested);
      barArrived += landed;
      transit += Math.max(0, Math.min(v.invoiced, r.requested) - landed);
    }
    return { requested, invoiced, arrived, barArrived, transit, awaiting: Math.max(0, requested - barArrived - transit) };
  };

  // "X of Y arrived", where Y is what has been INVOICED (owner) — see the header.
  const arrivedOf = (t: Tally) => (t.invoiced === 0 ? 'not invoiced yet' : `${t.arrived} of ${t.invoiced} arrived`);

  // Order -> style -> the style's own size run, in the order the route already sorted (ordernum, then code, which puts sizes in size
  // order). Nothing is re-sorted here.
  const orders = useMemo(() => {
    type StyleBlock = {
      key: string; style: string; lines: BirkTrackerLine[]; sizes: string[];
      due: string; cost: number | null; rrp: number | null;
    };
    type OrderBlock = { ordernum: string; placed: string; styles: StyleBlock[]; lines: BirkTrackerLine[] };
    const out: OrderBlock[] = [];
    for (const r of shown) {
      const { style, size } = splitCode(r.code);
      let o = out[out.length - 1];
      if (!o || o.ordernum !== r.ordernum) {
        o = { ordernum: r.ordernum, placed: r.placed, styles: [], lines: [] };
        out.push(o);
      }
      o.lines.push(r);
      let s = o.styles[o.styles.length - 1];
      if (!s || s.style !== style) {
        s = { key: keyOf(r) + '|style', style, lines: [], sizes: [], due: r.due, cost: null, rrp: null };
        o.styles.push(s);
      }
      s.lines.push(r);
      s.sizes.push(size);
      // Cost/RRP are per line in the table but per style in reality; first known value wins, as on the legacy screen.
      if (s.cost == null) s.cost = r.cost;
      if (s.rrp == null) s.rrp = r.rrp;
    }
    return out;
  }, [shown]);

  const dirtyRows = useMemo(() => rows.filter((r) => view(r).dirty), [rows, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = state !== 'all' || focus !== null || find.trim() !== '';

  // What "Clear arrived" would delete. Deliberately reads the SAVED values and ignores the status tab and search box: the server
  // counts the database, and the guard only works if both sides ask the same question.
  const clearScope = focus ? { scope: focus.kind, value: focus.value } : { scope: 'all' as const };
  const clearable = useMemo(
    () => rows.filter((r) => {
      if (focus?.kind === 'order' && r.ordernum !== focus.value) return false;
      if (focus?.kind === 'invoice' && r.invoice_num !== focus.value) return false;
      return r.complete;
    }).length,
    [rows, focus],
  );

  function reset() {
    setState('all');
    setFocus(null);
    setFind('');
  }

  // Stage one edit. Typing a value back to what it already was drops the entry, so the save bar disappears on its own rather than
  // claiming a change that isn't one.
  function stage(r: BirkTrackerLine, patch: Partial<Edit>) {
    setEdits((prev) => {
      const k = keyOf(r);
      const cur = prev[k] ?? { invoiced: r.invoiced, arrived: r.arrived };
      const merged = { ...cur, ...patch };
      if (merged.invoiced === r.invoiced && merged.arrived === r.arrived) {
        const rest = { ...prev };
        delete rest[k];
        return rest;
      }
      return { ...prev, [k]: merged };
    });
  }

  async function save() {
    if (dirtyRows.length === 0) return;
    setSaving(true);
    setNotice(null);
    const res = await saveBirkTrackerLines({
      rows: dirtyRows.map((r) => {
        const v = view(r);
        return { ordernum: r.ordernum, code: r.code, invoiced: v.invoiced, arrived: v.arrived };
      }),
      invoice_num: stampNum.trim() || undefined,
      invoice_date: stampDate.trim() || undefined,
    });
    setSaving(false);

    if (!res.success) {
      setNotice({ tone: 'warn', text: res.error || 'Could not save those lines' });
      return;
    }
    const { saved, missing, over } = res.data!;
    // Only clear the edits once the server has them — a failed save must leave the operator's typing on screen.
    setEdits({});
    setStampNum('');
    setStampDate('');
    await refresh();

    const parts = [`Saved ${saved} ${saved === 1 ? 'line' : 'lines'}`];
    if (missing.length) parts.push(`${missing.length} no longer exist (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''})`);
    if (over.length) parts.push(`${over.length} invoiced above what was ordered`);
    setNotice({ tone: missing.length || over.length ? 'warn' : 'ok', text: parts.join(' — ') });
  }

  async function clearArrived() {
    setConfirmClear(false);
    setSaving(true);
    setNotice(null);
    const res = await clearBirkTrackerArrived({ ...clearScope, expected: clearable });
    setSaving(false);
    if (!res.success) {
      // CHANGED is a normal outcome, not a fault: someone booked an arrival on the legacy screen while this one sat open.
      setNotice({ tone: 'warn', text: res.error || 'Could not clear those lines' });
      await refresh();
      return;
    }
    await refresh();
    setNotice({ tone: 'ok', text: `Cleared ${res.data!.deleted} fully-arrived ${res.data!.deleted === 1 ? 'line' : 'lines'}` });
  }

  // Exports what is on screen: the filter is part of the question. Flat, one row per size, every legacy column — a spreadsheet has no
  // width problem, and flat is what makes it sortable.
  function exportCsv() {
    const head = ['Ordernum', 'Placed', 'Code', 'Requested', 'Cost', 'RRP', 'BK Size', 'Invoiced', 'Arrived', 'Invoice Date', 'Invoice Num', 'Due', 'Status', 'EAN'];
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      head.map(cell).join(','),
      ...shown.map((r) => {
        const v = view(r);
        return [
          r.ordernum, r.placed, r.code, r.requested, money(r.cost), money(r.rrp), r.bksize,
          v.invoiced, v.arrived, r.invoice_date, r.invoice_num, r.due, STATE_LABEL[v.state], r.ean,
        ].map(cell).join(',');
      }),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `birk-tracker-${focus ? focus.value : 'all'}.csv`;
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

  // The bar stays proportioned against what was ORDERED — it shows the whole commitment split three ways, and is the one place the
  // un-invoiced remainder is visible. The counters beside it are the ones measured against invoiced.
  const pct = (t: Tally, n: number) => (t.requested > 0 ? (n / t.requested) * 100 : 0);
  const bar = (t: Tally, className: string) => (
    <div className={'flex overflow-hidden rounded-full bg-slate-200 ' + className} role="presentation">
      <div className={STATE_STYLE.arrived.bar} style={{ width: `${pct(t, t.barArrived)}%` }} />
      <div className={STATE_STYLE.transit.bar} style={{ width: `${pct(t, t.transit)}%` }} />
      <div className={STATE_STYLE.awaiting.bar} style={{ width: `${pct(t, t.awaiting)}%` }} />
    </div>
  );

  // One tally for the headline. Plain render-time work, not a hook: it reads `live`, which already memoises the expensive part.
  const totals = tally(shown);

  const TABS: { key: State | 'all' | 'over'; label: string; count: number }[] = [
    { key: 'all', label: 'Everything', count: counts.all },
    { key: 'awaiting', label: STATE_LABEL.awaiting, count: counts.awaiting },
    { key: 'transit', label: STATE_LABEL.transit, count: counts.transit },
    { key: 'arrived', label: STATE_LABEL.arrived, count: counts.arrived },
    { key: 'over', label: 'Over-invoiced', count: counts.over },
  ];

  // Column widths, declared once and shared by the heading and the rows so they cannot drift apart. Fixed slots (not a table) keep the
  // counts in a straight line down the page while still letting the row reflow; the invoice takes whatever is left.
  const COL = {
    size: 'w-9 shrink-0',
    bk: 'hidden w-16 shrink-0 sm:block',
    count: 'w-[4.5rem] shrink-0 text-center tabular-nums',
    invoice: 'min-w-0 flex-1 truncate',
  };
  // Inputs sit flush in the row — no visible box until you touch one. A permanent box on every count made the book look like a form
  // rather than something you read.
  const FIELD = 'w-full rounded border border-transparent bg-transparent py-0.5 text-center text-sm tabular-nums hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500';

  // Enter moves DOWN the column — same field, next size — because keying an invoice is a column of numbers down a size run. Tab is
  // left alone and still walks across a size (invoiced, then arrived, then on to the next size).
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, next: BirkTrackerLine | undefined, field: 'invoiced' | 'arrived') => {
    if (e.key !== 'Enter' || !next) return;
    e.preventDefault();
    document.getElementById(cellId(next, field))?.focus();
  };

  return (
    <div className="space-y-5 pb-24">
      {/* --- the book in three numbers ------------------------------------------------------------------------------------------- */}
      <section>
        <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-lg text-slate-900">
            <span className="font-semibold tabular-nums">{totals.requested}</span>
            <span className="ml-1.5 text-sm text-slate-500">pairs {filtered ? 'in view' : 'ordered'}</span>
          </span>
          <span className="text-lg text-slate-900">
            <span className={'font-semibold tabular-nums ' + (totals.invoiced > totals.requested ? 'text-red-700' : '')}>
              {totals.invoiced}
            </span>
            <span className="ml-1.5 text-sm text-slate-500">invoiced</span>
          </span>
          <span className="text-lg text-slate-900">
            <span className="font-semibold tabular-nums text-emerald-700">{totals.arrived}</span>
            <span className="ml-1.5 text-sm text-slate-500">arrived</span>
          </span>
        </p>
        <div className="mt-2.5">{bar(totals, 'h-2.5 w-full')}</div>
        <p className="mt-1.5 text-sm text-slate-500">
          {arrivedOf(totals)}
          {totals.transit > 0 && <>, <span className="tabular-nums text-amber-700">{totals.transit}</span> on the way</>}
          {totals.awaiting > 0 && <>, <span className="tabular-nums text-slate-700">{totals.awaiting}</span> still to come</>}
        </p>
      </section>

      {/* Counted across the whole book and shown whatever the filters are — this is the one thing on the screen that costs money to miss. */}
      {overAll > 0 && (
        <button
          type="button"
          onClick={() => { setFocus(null); setFind(''); setState('over'); }}
          className="flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm text-red-800 hover:bg-red-100"
        >
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold tabular-nums">{overAll}</span>{' '}
            {overAll === 1 ? 'line is' : 'lines are'} invoiced or delivered above what was ordered
          </span>
          <span className="ml-auto shrink-0 text-xs underline">Show them</span>
        </button>
      )}

      {/* --- filters and actions -------------------------------------------------------------------------------------------------- */}
      <section className="space-y-3">
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {TABS.map((t) => {
            const active = state === t.key;
            const over = t.key === 'over';
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setState(t.key)}
                aria-pressed={active}
                className={
                  'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm transition ' +
                  (active ? 'bg-white font-medium shadow-sm ring-1 ring-slate-200 ' : 'hover:text-slate-800 ') +
                  (over && t.count > 0 ? 'text-red-700' : active ? 'text-slate-900' : 'text-slate-500')
                }
              >
                {t.key !== 'all' && !over && <span className={'inline-block h-2 w-2 shrink-0 rounded-full ' + STATE_STYLE[t.key as State].dot} />}
                {over && t.count > 0 && <ExclamationTriangleIcon className="h-3.5 w-3.5" />}
                {t.label}
                <span className="tabular-nums opacity-60">{t.count}</span>
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
          {/* Both pickers write the SAME state, so choosing one visibly resets the other to "Any". */}
          {([
            { label: 'Order', kind: 'order' as const, options: data?.ordernums ?? [] },
            { label: 'Invoice', kind: 'invoice' as const, options: data?.invoices ?? [] },
          ]).map((p) => (
            <label key={p.kind} className="inline-flex items-center gap-2 text-sm text-slate-500">
              {p.label}
              <select
                value={focus?.kind === p.kind ? focus.value : ''}
                onChange={(e) => setFocus(e.target.value ? { kind: p.kind, value: e.target.value } : null)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs tabular-nums text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Any</option>
                {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
          {filtered && (
            <button type="button" onClick={reset} className="text-sm text-slate-500 underline hover:text-slate-700">Clear</button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Inert until someone hands over a Birkenstock confirmation file — the columns can't be guessed. */}
            <button
              type="button"
              disabled
              title="Needs a sample Birkenstock order confirmation file before it can read one"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400"
            >
              <ArrowUpTrayIcon className="h-4 w-4" /> Upload
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={shown.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ArrowDownTrayIcon className="h-4 w-4" /> Export
            </button>
            {/* Disabled while there are unsaved edits: clearing rows you are part-way through keying is how work gets lost. */}
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={clearable === 0 || dirtyRows.length > 0 || saving}
              title={dirtyRows.length > 0 ? 'Save or discard your changes first' : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <TrashIcon className="h-4 w-4" /> Clear arrived
              {clearable > 0 && <span className="tabular-nums text-slate-400">{clearable}</span>}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-400">An order or an invoice, one at a time — picking one clears the other.</p>
      </section>

      {notice && (
        <div className={'rounded-md px-3 py-2 text-sm ' + (notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')}>
          {notice.text}
          <button onClick={() => setNotice(null)} className="ml-3 text-xs underline opacity-70">Dismiss</button>
        </div>
      )}

      {/* Spells out the count AND the scope, because the button's effect depends on a filter set elsewhere on the screen, and because
          nothing it removes can be brought back. */}
      {confirmClear && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-900">
            Delete <span className="font-semibold tabular-nums">{clearable}</span> fully-arrived{' '}
            {clearable === 1 ? 'line' : 'lines'} from{' '}
            {clearScope.scope === 'all' ? 'the whole book' : <>{clearScope.scope} <span className="font-mono">{clearScope.value}</span></>}?
            This cannot be undone.
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={clearArrived} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
              Delete {clearable} {clearable === 1 ? 'line' : 'lines'}
            </button>
            <button onClick={() => setConfirmClear(false)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Keep them
            </button>
          </div>
        </div>
      )}

      {data?.truncated && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing {rows.length} of {data.total} lines — the safety cap cut the rest.
        </div>
      )}

      {/* --- the orders ----------------------------------------------------------------------------------------------------------- */}
      {orders.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center">
          <p className="text-sm text-slate-600">
            {state === 'transit' && !focus && !find
              ? 'Nothing is on the way — everything Birkenstock has invoiced has already arrived.'
              : state === 'over' && !focus && !find
                ? 'Nothing is over-invoiced. Every line has been billed for what we ordered or less.'
                : 'Nothing here matches.'}
          </p>
          {filtered && (
            <button onClick={reset} className="mt-2 text-sm text-brand-600 underline hover:text-brand-700">Show the whole book</button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => {
            const ot = tally(o.lines);
            return (
              <section key={o.ordernum} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {/* Per-order facts live here ONCE instead of repeating down every row. */}
                <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">{o.ordernum}</span>
                    {o.placed && <span className="ml-3 text-xs tabular-nums text-slate-500">placed {o.placed}</span>}
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-xs tabular-nums text-slate-500">
                      <span className="text-slate-700">{ot.requested}</span> ordered
                      <span className={'ml-3 ' + (ot.invoiced > ot.requested ? 'font-semibold text-red-700' : 'text-slate-700')}>{ot.invoiced}</span> invoiced
                      <span className="ml-3">{arrivedOf(ot)}</span>
                    </span>
                    {bar(ot, 'h-1.5 w-24')}
                  </div>
                </header>

                {/* Column headings once per order, not once per style — a heading every few rows would break the run of stripe colour
                    that makes the book glanceable. */}
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-1.5 pl-[19px] text-xs text-slate-400">
                  <span className={COL.size}>Size</span>
                  <span className={COL.bk}>BK</span>
                  <span className="flex shrink-0 items-center">
                    <span className={COL.count}>Ordered</span>
                    <span className={COL.count}>Invoiced</span>
                    <span className={COL.count}>Arrived</span>
                  </span>
                  <span className={COL.invoice}>Invoice</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {o.styles.map((s) => {
                    const views = s.lines.map((l) => view(l));
                    const styleState: State = views.some((v) => v.state === 'awaiting') ? 'awaiting'
                      : views.some((v) => v.state === 'transit') ? 'transit' : 'arrived';

                    return (
                      <div key={s.key}>
                        {/* The style heading — not a control. It carries what belongs to the style rather than to a size. The invoice
                            is deliberately NOT here: it belongs on each size's own row, because a style can be delivered across two. */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-50/60 px-4 py-1.5">
                          <span className={'inline-block h-2 w-2 shrink-0 rounded-full ' + STATE_STYLE[styleState].dot} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800" title={s.style}>{s.style}</span>

                          {s.due && (
                            <span className={'shrink-0 text-xs font-medium ' + (styleState === 'arrived' ? 'text-slate-400' : STATE_STYLE[styleState].text)}>
                              Due {s.due}
                            </span>
                          )}
                          {(s.cost != null || s.rrp != null) && (
                            <span className="shrink-0 text-xs tabular-nums text-slate-400">
                              {s.cost != null && <>cost {money(s.cost)}</>}
                              {s.cost != null && s.rrp != null && ' / '}
                              {s.rrp != null && <>rrp {money(s.rrp)}</>}
                            </span>
                          )}
                        </div>

                        {/* ONE ROW PER SIZE. The three counts sit adjacent in a tinted block so the comparison is a glance at one
                            object; the invoice that paid for this size is on the same line, which is what a size grid could not do. */}
                        {s.lines.map((r, i) => {
                          const v = view(r);
                          const next = s.lines[i + 1];
                          // Red when over, amber while unsaved, otherwise the line's own state.
                          const group = v.over ? 'bg-red-100/70' : v.dirty ? 'bg-amber-100/70' : STATE_STYLE[v.state].group;
                          return (
                            <div
                              key={r.code}
                              className={
                                'flex items-center gap-3 border-l-[3px] px-4 py-0.5 text-sm ' +
                                STATE_STYLE[v.state].stripe + ' ' + (v.over ? 'bg-red-50/50' : 'hover:bg-slate-50')
                              }
                            >
                              <span className={COL.size + ' font-semibold tabular-nums text-slate-800'}>{s.sizes[i]}</span>
                              {/* Birkenstock's own size label — what the paperwork in your hand is printed with. */}
                              <span className={COL.bk + ' text-xs tabular-nums text-slate-400'}>{r.bksize}</span>

                              <span className={'flex shrink-0 items-center rounded ' + group}>
                                {/* Ordered is the baseline the other two are measured against, and the only count that is not
                                    editable: it is what we asked Birkenstock for, and it arrives with the order, not a delivery. */}
                                <span className={COL.count + ' py-0.5 text-slate-600'}>{r.requested || '–'}</span>
                                <span className={COL.count}>
                                  <input
                                    id={cellId(r, 'invoiced')}
                                    inputMode="numeric"
                                    value={v.invoiced || ''}
                                    placeholder="–"
                                    onFocus={(e) => e.target.select()}
                                    onKeyDown={(e) => onCellKey(e, next, 'invoiced')}
                                    onChange={(e) => stage(r, { invoiced: toCount(e.target.value) })}
                                    aria-label={`${s.style} size ${s.sizes[i]} invoiced`}
                                    className={FIELD + ' ' + (v.invoiced > r.requested ? 'font-semibold text-red-700' : 'text-slate-800')}
                                  />
                                </span>
                                <span className={COL.count}>
                                  <input
                                    id={cellId(r, 'arrived')}
                                    inputMode="numeric"
                                    value={v.arrived || ''}
                                    placeholder="–"
                                    onFocus={(e) => e.target.select()}
                                    onKeyDown={(e) => onCellKey(e, next, 'arrived')}
                                    onChange={(e) => stage(r, { arrived: toCount(e.target.value) })}
                                    aria-label={`${s.style} size ${s.sizes[i]} arrived`}
                                    className={FIELD + ' ' + (v.arrived > r.requested ? 'font-semibold text-red-700' : 'text-slate-800')}
                                  />
                                </span>
                              </span>

                              {/* THE INVOICE THIS SIZE CAME ON — the reason this is a row layout and not a size grid. */}
                              <span className={COL.invoice + ' font-mono text-xs tabular-nums text-slate-500'}>
                                {r.invoice_num}
                                {r.invoice_date && <span className="ml-2 text-slate-400">{r.invoice_date}</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!dirtyRows.length && (
        <p className="text-xs text-slate-400">
          Type into Invoiced or Arrived to key a delivery — Tab across a size, Enter down the column. Nothing is written until you save.
          {busy && <span className="ml-2">Refreshing.</span>}
        </p>
      )}

      {/* --- the save bar -------------------------------------------------------------------------------------------------------
          The invoice number and date live HERE rather than in every grid because they belong to all the sizes you just keyed — one
          invoice, many sizes — and typing them once is the whole reason editing batches. */}
      {dirtyRows.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="text-sm font-medium text-slate-800">
              <span className="tabular-nums">{dirtyRows.length}</span> {dirtyRows.length === 1 ? 'size' : 'sizes'} changed
            </span>
            <label className="inline-flex items-center gap-2 text-sm text-slate-500">
              Invoice
              <input
                value={stampNum}
                onChange={(e) => setStampNum(e.target.value)}
                placeholder="5290103870"
                className="w-32 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-500">
              Dated
              <input
                value={stampDate}
                onChange={(e) => setStampDate(e.target.value)}
                placeholder="26.08.2026"
                className="w-28 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </label>
            <span className="hidden text-xs text-slate-400 lg:inline">stamped on every changed size</span>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setEdits({}); setStampNum(''); setStampDate(''); }}
                disabled={saving}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
              >
                {saving ? 'Saving…' : `Save ${dirtyRows.length} ${dirtyRows.length === 1 ? 'size' : 'sizes'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A keyed count. Anything that isn't digits is ignored rather than rejected, and an empty box means zero — the grid prints 0 as "–"
// so that a block of nothing-yet reads as quiet space instead of a wall of zeros.
function toCount(raw: string): number {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits === '') return 0;
  return Math.min(99999, parseInt(digits, 10));
}
