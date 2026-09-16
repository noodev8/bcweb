'use client';
/*
=======================================================================================================================================
Component: BirkTrackerBook
=======================================================================================================================================
Purpose: The Birk Tracker screen — where a Birkenstock season order lives between being placed and being on the shelf, and where an
         invoice gets keyed against it. Answers: what is still to come, what is on its way, what has landed, and what Birkenstock has
         billed us for that we never ordered. Reads /birk-tracker-lines; writes /birk-tracker-save and /birk-tracker-clear-arrived.
         The Archive panel beside it (BirkArchivePanel) reads /birk-tracker-archive and writes /birk-tracker-restore.

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
worth catching. It shows ON TOP of the state — the row turns red, its invoiced figure turns red, and so does the invoiced total in
the headline and on the order it belongs to.
  IT NO LONGER HAS A BANNER OR A TAB OF ITS OWN (owner, 2026-09-14: "is rare so seems unnecessary"). Both were built on the argument
  that an overcharge is expensive to miss; the owner's judgement is that it is rare enough not to hold permanent space at the top of
  a screen that is worked every week, and a standing "Over-invoiced 0" told nobody anything. The DETECTION is untouched — a red row
  is impossible to scroll past, and the picker lists still label an affected order "over-invoiced", which is the one place a rare
  thing can be found without hunting for it. If it ever stops being rare, the tab is a two-line restoration.
The server never blocks an over-invoice either (see routes/birk-tracker-save.js): you must be able to key what the invoice ACTUALLY
says in order to argue with it.

THE THREE STATES, the screen's whole vocabulary — same words, same colours, at every level (book bar, order bar, style dot, row stripe):
  STILL TO COME (slate)    ordered, not invoiced, not here. A promise with a month against it.
  ON THE WAY (amber)       billed or part-delivered, but the three do not yet agree. Worth chasing, hence the only warm colour.
  ARRIVED (emerald)        ordered, invoiced and arrived ALL MATCH. Done, so it recedes.

GREEN NEEDS ALL THREE TO AGREE (owner), not merely "everything turned up". The three numbers are three separate promises and a line is
finished only when none is left open: under-invoiced means Birkenstock still owes us the billing, over-invoiced means money to argue
about. Either way the line carries a question, and a line with a question stays on the screen that asks it. On the server the rule is
now stated once, in utils/birkTracker.js, and shared by the read route and the archive button — which archives exactly the rows this
paints green. `stateOf` here is the third copy and cannot import that one: it recomputes state from unsaved typing, live, before
anything reaches the server. It must be changed with them.

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

ARCHIVE ARRIVED is the legacy "Delete Green", and since 2026-09-16 (owner) it no longer deletes: the rows move to an archive table and
can be put back from the Archive panel (BirkArchivePanel, which is where the reasoning for a separate table rather than a status flag
lives). The safeguards around the button all STAY anyway — confirmed with the count and scope spelled out, disabled while edits are
unsaved, and sending the count it expects so a stale screen is refused by the server rather than silently taking rows nobody looked at.
An undo is only reached by an operator who noticed they need it, and the rows taken from a stale screen are exactly the ones nobody
will think to look for. What changed is the TONE: the confirm is no longer red and no longer says "cannot be undone", because saying
so would now be a lie and would make people hesitate over something safe.
  The legacy PowerBuilder screen's own Delete Green still deletes outright. This net is under this screen only.

ORDER AND INVOICE ARE ONE FILTER (owner): two ways of asking for one delivery's lines, so picking either REPLACES the other — there is
no state where both are set. Status tabs and the search box are genuine co-filters and do still stack.
  BOTH LISTS CARRY THEIR OWN STATE (owner, 2026-09-14): each entry is coloured and labelled by how much of it is finished — "all
  arrived", "3 of 14", "nothing yet", "over-invoiced". Before, the only way to learn whether an order was done was to select it and
  read the screen, once per order. Colour alone would not do: an <option> can only be coloured through an inline style, which Chrome,
  Edge and Firefox on Windows honour but other browsers ignore entirely, so the words carry the meaning and the colour is the glance.

-- SCANNING A DELIVERY IN (owner, 2026-09-14) ------------------------------------------------------------------------------------------
A REAL BOX, AND NO MODE. Two owner notes pull in opposite directions and both are right: "i wanna be able to just scan" (no switch to
arm first) and "i would like an actual input rather than just assuming its on" (not an invisible listener you have to trust). So the
scan box is permanently visible in the toolbar, autofocused on load and refocused after every beep — and any typing that lands on the
PAGE rather than in a field is redirected into it, the first character appended by hand since it is consumed before the box can take
focus, the rest arriving there on their own. You can therefore beep the moment the screen opens without clicking anything, and still
watch the digits arrive and correct them. It is also the only way to book in the six lines that carry no EAN: type the barcode, or use
the row's Arrived cell.
  The earlier version detected the gun by keystroke SPEED and had no box at all. It worked, and it was the wrong shape: a scanner
  that silently does nothing is indistinguishable from one that is not plugged in.
  KEYS AIMED AT A FIELD ARE NEVER TOUCHED. Counts, search terms and invoice numbers are all typed on this screen; only keystrokes with
  no field to land in are redirected.
  IT WRITES IMMEDIATELY, one beep at a time (owner), which is the opposite of the typed edits above. A delivery is dozens of pairs
  over a few minutes and a closed tab must not lose the lot. The safety net that immediate writing needs is the log: every beep is
  listed and every one can be undone — and Undo goes back through /birk-tracker-save with the values the line held a moment ago
  rather than through a decrement endpoint, because there should be one way to change this column, not two.
  THE GUN STANDS DOWN WHILE THERE IS UNSAVED TYPING. Scans and edits write the same column on different schedules, so rather than
  make the operator choose a mode, the box disables itself and its placeholder says why.
  THE SCREEN'S FILTER IS THE SCAN'S SCOPE. A barcode does NOT identify an order line — the same EAN sits on up to four orders — so
  picking the order or invoice you are unpacking first is what makes a repeated barcode unambiguous. When it still isn't, the server
  returns the candidates and the operator taps one; see routes/birk-tracker-scan.js for why it asks rather than guesses.
  IT TOUCHES NO STOCK (owner). It marks the order book, nothing else. This is not Goods In for Birkenstock — that supplier has never
  been in `orderstatus` at all.
Six lines in the live book carry no EAN and can never be scanned; they are keyed by hand, which is the other reason the typed columns
stay exactly where they are.

LOAD ORDER and LOAD INVOICE open a real file dialog (owner, 2026-09-14), starting in Downloads on the browsers that allow it to be
asked. Both are live and both are two-step — the server reads the file and returns a plan, a dialog reviews it, and only its own
button writes. Load order takes the portal's .xlsx order export (BirkOrderDialog, utils/birkOrder.js on the server — the port of the
PowerBuilder Bulk Upload); Load invoice takes the invoice PDF (BirkInvoiceDialog, utils/birkInvoice.js).
They are named for what they load rather than for the act of loading — "Upload" stopped meaning anything once there were two of them,
and the operator is holding one piece of paper or the other. Load order feeds the Ordered column; Load invoice feeds Invoiced plus the
invoice number and date.

NOTHING SCROLLS SIDEWAYS AT ANY WIDTH. Fixed-width slots keep the counts in a straight line down the page; the invoice column takes
what is left and truncates. Below `sm` the Birkenstock size label drops out, leaving size, the three counts and the invoice — which
is the minimum that still answers "where is this size, and what paid for it?".
=======================================================================================================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveBoxIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, DocumentArrowUpIcon, MagnifyingGlassIcon, TrashIcon,
  XMarkIcon, QrCodeIcon,
} from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getBirkTrackerLines, saveBirkTrackerLines, clearBirkTrackerArrived, scanBirkTrackerArrival, previewBirkInvoice, previewBirkOrder,
  type BirkTrackerLine, type BirkTrackerScanLine, type BirkInvoicePreview, type BirkOrderPreview,
} from '@/lib/api';
import BirkInvoiceDialog from '@/components/BirkInvoiceDialog';
import BirkOrderDialog from '@/components/BirkOrderDialog';
import BirkArchivePanel from '@/components/BirkArchivePanel';

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

// --- the picker roll-ups -------------------------------------------------------------------------------------------------------
// An order or invoice summarised for the dropdown: how many of its sizes are finished, whether any is over-invoiced, and whether
// anything has moved at all. The same three states as everywhere else, plus over, so the lists speak the screen's own vocabulary.
interface Roll { done: number; total: number; over: boolean; moved: boolean }

// Raw hex rather than Tailwind classes: these go through an inline `style` on an <option>, which a class cannot reach. Values are
// the same palette steps the rest of the screen uses (red-700, emerald-700, amber-700, slate-400).
const ROLL_COLOUR = { over: '#b91c1c', all: '#047857', part: '#b45309', none: '#94a3b8' };

function rollColour(g: Roll | undefined): string {
  if (!g) return ROLL_COLOUR.none;
  if (g.over) return ROLL_COLOUR.over;
  if (g.done === g.total) return ROLL_COLOUR.all;
  if (g.done > 0 || g.moved) return ROLL_COLOUR.part;
  return ROLL_COLOUR.none;
}

// The words that carry the same meaning where the colour cannot be relied on. "x of y" counts SIZES rather than pairs: this is a
// glance at how much of a delivery is settled, and a part-arrived size is not settled however many pairs of it turned up.
function rollLabel(g: Roll): string {
  if (g.over) return 'over-invoiced';
  if (g.done === g.total) return 'all arrived';
  if (g.done > 0) return `${g.done} of ${g.total}`;
  if (g.moved) return 'part arrived';
  return 'nothing yet';
}

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
  const { data, error, isLoading, busy, refresh, mutate } = useApiQuery('birk-tracker-lines', getBirkTrackerLines);

  const [state, setState] = useState<State | 'all'>('all');
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
  // The archive is a panel rather than a tab, and is only fetched once it is opened — see BirkArchivePanel's header for why it is
  // kept out of the book's own rows, totals and rails entirely.
  const [showArchive, setShowArchive] = useState(false);
  // The parsed invoice awaiting review. Non-null means the dialog is up; nothing has been written at that point.
  const [invoicePreview, setInvoicePreview] = useState<BirkInvoicePreview | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  // The same, for Load order.
  const [orderPreview, setOrderPreview] = useState<BirkOrderPreview | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);

  // --- scanning a delivery in ----------------------------------------------------------------------------------------------------
  // THERE IS NO SCAN MODE (owner, 2026-09-14: "i wanna be able to just scan"). The page listens for the gun the whole time it is
  // open — no button to arm it, no box to aim at. Every beep is committed on its own so a closed tab mid-delivery loses nothing,
  // which is the opposite of the typed edits above; the two are kept from colliding by pausing the listener while edits are pending
  // rather than by making the operator choose a mode.
  const [scanBusy, setScanBusy] = useState(false);
  // The scan box is a real, permanently visible field (owner, 2026-09-14) — not an invisible listener you have to trust is running.
  // It is also the page's default keyboard target, so nothing has to be clicked before beeping; see the listener below.
  const [scanInput, setScanInput] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);
  // Newest first. `candidates` carries the choices when a barcode could not be resolved; `undo` the values to write back.
  const [scanLog, setScanLog] = useState<{
    id: number;
    tone: 'ok' | 'ask' | 'warn';
    text: string;
    candidates?: BirkTrackerScanLine[];
    undo?: { ordernum: string; code: string; invoiced: number; arrived: number };
  }[]>([]);

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
    const c = { all: scoped.length, awaiting: 0, transit: 0, arrived: 0 };
    for (const r of scoped) c[view(r).state] += 1;
    return c;
  }, [scoped, live]);

  const shown = useMemo(() => {
    if (state === 'all') return scoped;
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
  // Per-order and per-invoice roll-ups for the two pickers (owner, 2026-09-14: "so i dont need to go through each one"). Without
  // these, finding out whether an order is finished meant selecting it and reading the screen — seven times. Reads through `live`, so
  // an order goes green in the list the moment its last size is keyed in, before saving.
  const rollups = useMemo(() => {
    const build = (keyFor: (r: BirkTrackerLine) => string) => {
      const m = new Map<string, { done: number; total: number; over: boolean; moved: boolean }>();
      for (const r of rows) {
        const k = keyFor(r);
        if (!k) continue;
        const v = view(r);
        const g = m.get(k) ?? { done: 0, total: 0, over: false, moved: false };
        g.total += 1;
        if (v.state === 'arrived') g.done += 1;
        if (v.over) g.over = true;
        if (v.invoiced > 0 || v.arrived > 0) g.moved = true;
        m.set(k, g);
      }
      return m;
    };
    return { order: build((r) => r.ordernum), invoice: build((r) => r.invoice_num) };
  }, [rows, live]); // eslint-disable-line react-hooks/exhaustive-deps -- `view` closes over `live`

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
      setNotice({ tone: 'warn', text: res.error || 'Could not archive those lines' });
      await refresh();
      return;
    }
    await refresh();
    // Says where they went, not just that they are gone — the whole point of the change is that this is reversible, and a message
    // that only counts what left would leave the operator no better off than the old delete did.
    setNotice({
      tone: 'ok',
      text: `Archived ${res.data!.deleted} fully-arrived ${res.data!.deleted === 1 ? 'line' : 'lines'} — open Archive to put them back`,
    });
  }

  // Patch one line in the SWR cache after a scan instead of refetching the book. A delivery is dozens of beeps in a couple of
  // minutes, and a full reload per beep would put that many round trips on the live DB for data we already have in hand.
  function applyScanned(line: BirkTrackerScanLine) {
    mutate(
      (cur) => (cur ? {
        ...cur,
        rows: cur.rows.map((r) => (r.ordernum === line.ordernum && r.code === line.code
          ? { ...r, invoiced: line.invoiced, arrived: line.arrived, complete: line.complete }
          : r)),
      } : cur),
      false,
    );
  }

  const logScan = (entry: Omit<(typeof scanLog)[number], 'id'>) =>
    setScanLog((prev) => [{ id: Date.now() + Math.random(), ...entry }, ...prev].slice(0, 40));

  async function sendScan(args: { barcode?: string; ordernum?: string; code?: string }) {
    setScanBusy(true);
    // The scope is whatever the screen is focused on — unpacking a known delivery is what makes an ambiguous barcode unambiguous.
    const body = await scanBirkTrackerArrival({ ...args, scope: focus ? { kind: focus.kind, value: focus.value } : undefined });
    setScanBusy(false);
    scanRef.current?.focus(); // hand the gun its box back, so a delivery is one beep after another with nothing to click

    if (body.return_code === 'SUCCESS' && body.line) {
      const l = body.line;
      // The undo target holds the values from BEFORE this scan, so undoing writes them back verbatim.
      applyScanned(l);
      logScan({
        tone: 'ok',
        text: `${l.code} — arrived ${l.arrived} of ${l.requested}${l.complete ? ', all in' : ''}`,
        undo: { ordernum: l.ordernum, code: l.code, invoiced: l.invoiced, arrived: l.arrived - 1 },
      });
      return;
    }
    if (body.return_code === 'AMBIGUOUS') {
      logScan({ tone: 'ask', text: body.message || 'That barcode is on more than one order', candidates: body.candidates });
      return;
    }
    logScan({ tone: 'warn', text: body.message || 'That scan could not be recorded' });
  }

  // The scan box is submitted by the gun's own trailing Enter, or by hand for one of the six lines that carry no barcode.
  function submitScan() {
    const barcode = scanInput.trim();
    setScanInput('');
    if (!barcode) return;
    // Typed edits batch and scans commit instantly; both write `arrived`. Rather than make the operator pick a mode, scanning stands
    // down while there is unsaved typing, and says so.
    if (dirtyRows.length > 0) {
      logScan({ tone: 'warn', text: `${barcode} — save or discard your typed changes first` });
      return;
    }
    if (scanBusy) return; // one beep at a time; the gun outruns the round trip otherwise
    sendScan({ barcode });
  }

  // Keystrokes that land on the PAGE rather than in a field are pushed into the scan box, which is then focused so the rest of the
  // burst arrives there on its own. That is what keeps "just scan" true without pretending the box isn't there: you can beep without
  // clicking into it first, and you still see the digits arrive and can correct them.
  //   The first character has already been consumed by the time we react, so it is appended by hand; everything after it types
  //   straight into the now-focused input.
  //   Keys aimed at a real field are never touched — counts, search terms and invoice numbers are all typed on this screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      setScanInput((v) => v + e.key);
      scanRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Undo writes the old values back through the ordinary save route rather than a decrement endpoint — the client knows exactly what
  // the line held a moment ago, and reusing the tested write beats adding a second way to change the same column.
  async function undoScan(entry: (typeof scanLog)[number]) {
    if (!entry.undo) return;
    const u = entry.undo;
    setScanBusy(true);
    const res = await saveBirkTrackerLines({ rows: [{ ordernum: u.ordernum, code: u.code, invoiced: u.invoiced, arrived: u.arrived }] });
    setScanBusy(false);
    if (!res.success) {
      logScan({ tone: 'warn', text: `Could not undo ${u.code} — ${res.error}` });
      return;
    }
    applyScanned({ ...u, size: '', requested: 0, complete: false });
    await refresh(); // the patch above cannot know the line's `requested`, so take the real row back
    setScanLog((prev) => prev.map((e) => (e.id === entry.id ? { ...e, tone: 'warn', text: `${u.code} — undone`, undo: undefined } : e)));
  }

  // --- picking a file to load ------------------------------------------------------------------------------------------------------
  // Opens the operator's Downloads folder where the browser allows it (owner: "it should open my downloads"). Only Chrome and Edge
  // can be told WHERE to start — `showOpenFilePicker({ startIn: 'downloads' })`, and only on a secure origin, which localhost and
  // Vercel both are. Everywhere else falls back to a plain file input, which opens wherever the OS last left the dialog. The
  // fallback is not a lesser path to be removed later: Safari and Firefox have no equivalent at all.
  // Each loader offers only its own file type, so the dialog opens showing the one file the operator is looking for.
  const FILE_TYPES = {
    order: { description: 'Birkenstock order export', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
    invoice: { description: 'Birkenstock invoice', mime: 'application/pdf', ext: '.pdf' },
  } as const;

  async function chooseFile(kind: keyof typeof FILE_TYPES): Promise<File | null> {
    const t = FILE_TYPES[kind];
    const picker = (window as unknown as {
      showOpenFilePicker?: (o: unknown) => Promise<Array<{ getFile(): Promise<File> }>>;
    }).showOpenFilePicker;

    if (picker) {
      try {
        const [handle] = await picker({
          startIn: 'downloads',
          multiple: false,
          types: [{ description: t.description, accept: { [t.mime]: [t.ext] } }],
        });
        return await handle.getFile();
      } catch {
        return null; // the operator cancelled the dialog — not an error
      }
    }

    return new Promise((resolve) => {
      const el = document.createElement('input');
      el.type = 'file';
      el.accept = t.ext;
      el.onchange = () => resolve(el.files?.[0] ?? null);
      el.click();
    });
  }

  // LOAD INVOICE. Parses the PDF server-side and matches it against the order book, then hands the plan to BirkInvoiceDialog for
  // review. NOTHING IS WRITTEN by this — the preview route is read-only, and the dialog's own button does the commit.
  async function loadInvoice() {
    const file = await chooseFile('invoice');
    if (!file) return;
    setNotice(null);
    setInvoiceBusy(true);
    const res = await previewBirkInvoice(file);
    setInvoiceBusy(false);
    if (!res.success) {
      // NOT_A_PDF / UNREADABLE_PDF / NO_INVOICE_NUMBER are ordinary outcomes of pointing this at the wrong file, and the server's
      // message already says which — so it is shown as it is rather than translated into something vaguer.
      setNotice({ tone: 'warn', text: res.error || 'That invoice could not be read' });
      return;
    }
    setInvoicePreview(res.data!);
  }

  // LOAD ORDER. Reads the portal's .xlsx export server-side and matches it against the book, then hands the plan to BirkOrderDialog.
  // NOTHING IS WRITTEN by this — same shape as Load invoice above.
  async function loadOrderFile() {
    const file = await chooseFile('order');
    if (!file) return;
    setNotice(null);
    setOrderBusy(true);
    const res = await previewBirkOrder(file);
    setOrderBusy(false);
    if (!res.success) {
      // NOT_AN_XLSX / NOT_AN_ORDER_FILE / NO_ORDER_LINES are what pointing this at the wrong file looks like, and the server's message
      // already says which (naming the missing columns, for the second).
      setNotice({ tone: 'warn', text: res.error || 'That order file could not be read' });
      return;
    }
    setOrderPreview(res.data!);
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

  const TABS: { key: State | 'all'; label: string; count: number }[] = [
    { key: 'all', label: 'Everything', count: counts.all },
    { key: 'awaiting', label: STATE_LABEL.awaiting, count: counts.awaiting },
    { key: 'transit', label: STATE_LABEL.transit, count: counts.transit },
    { key: 'arrived', label: STATE_LABEL.arrived, count: counts.arrived },
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
      {/* --- the actions ---------------------------------------------------------------------------------------------------------
          ABOVE EVERYTHING (owner, 2026-09-14). They used to ride on the right-hand end of the filter row, which made that row do two
          unrelated jobs — narrowing the list, and acting on it — and left a void in its middle where neither reached. As their own
          strip under the page title they read as a toolbar, which is what they are, and the filter row below is free to be only
          about filtering. Right-aligned so the eye still starts at the left edge, where the content does. */}
      <section className="flex flex-wrap items-center gap-2">
        {/* THE SCAN BOX, always present and never a mode (owner: an actual input rather than assuming it is on). It is autofocused on
            load and refocused after every beep, and any typing that lands on the page rather than in a field is redirected into it —
            so you can beep the moment the screen opens without clicking anything, while still SEEING what the gun sent and being able
            to fix it. It also takes a barcode typed by hand, which is the only way to book in the six lines that carry no EAN. */}
        <form onSubmit={(e) => { e.preventDefault(); submitScan(); }} className="relative w-full sm:w-72">
          <QrCodeIcon className={'pointer-events-none absolute left-3 top-2.5 h-4 w-4 ' + (dirtyRows.length > 0 ? 'text-slate-300' : 'text-emerald-600')} />
          <input
            ref={scanRef}
            autoFocus
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            disabled={dirtyRows.length > 0}
            placeholder={dirtyRows.length > 0 ? 'Save your changes to scan' : 'Scan a pair to book it in'}
            aria-label="Scan a barcode to mark a pair arrived"
            className={
              'w-full rounded-md border py-2 pl-9 pr-3 font-mono text-sm tabular-nums placeholder:font-sans focus:outline-none focus:ring-1 ' +
              (dirtyRows.length > 0
                ? 'border-slate-200 bg-slate-50 text-slate-400 placeholder:text-slate-400'
                : 'border-emerald-300 bg-white placeholder:text-slate-400 focus:border-emerald-500 focus:ring-emerald-500')
            }
          />
        </form>
        {scanBusy && <span className="text-xs text-slate-400">working…</span>}

        <span className="ml-auto" />

        {/* THE TWO FILE LOADERS. Both open in Downloads where the browser allows it, and both review before they write.
            They sit together and are named for WHAT THEY LOAD rather than for the act of loading: "Upload" alone stopped meaning
            anything the moment there were two of them, and an operator holding a piece of paper knows which one they have.
              Load order    the Birkenstock order confirmation — what we asked for, i.e. the Ordered column.
              Load invoice  what Birkenstock has billed — the Invoiced column, and the invoice number and date with it. */}
        <button
          type="button"
          onClick={loadOrderFile}
          disabled={orderBusy}
          title="Choose the Birkenstock portal's order export (.xlsx)"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <ArrowUpTrayIcon className="h-4 w-4" /> {orderBusy ? 'Reading…' : 'Load order'}
        </button>
        <button
          type="button"
          onClick={loadInvoice}
          disabled={invoiceBusy}
          title="Choose a Birkenstock invoice PDF"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <DocumentArrowUpIcon className="h-4 w-4" /> {invoiceBusy ? 'Reading…' : 'Load invoice'}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={shown.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <ArrowDownTrayIcon className="h-4 w-4" /> Export
        </button>
        {/* Disabled while there are unsaved edits: archiving rows you are part-way through keying is how work gets lost. */}
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          disabled={clearable === 0 || dirtyRows.length > 0 || saving}
          title={dirtyRows.length > 0 ? 'Save or discard your changes first' : undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <TrashIcon className="h-4 w-4" /> Archive arrived
          {clearable > 0 && <span className="tabular-nums text-slate-400">{clearable}</span>}
        </button>
        {/* The way back. Sits next to the button whose effect it undoes, rather than on a screen of its own — restoring is something
            you do while looking at the book you are restoring to. */}
        <button
          type="button"
          onClick={() => setShowArchive((v) => !v)}
          className={
            'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ' +
            (showArchive ? 'border-slate-400 bg-slate-100 text-slate-900' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
          }
        >
          <ArchiveBoxIcon className="h-4 w-4" /> Archive
        </button>
      </section>

      {showArchive && (
        <BirkArchivePanel
          onClose={() => setShowArchive(false)}
          // A restore puts lines back on the book, so the book must be re-read — the panel writes rows this component is displaying.
          onRestored={refresh}
        />
      )}

      {/* --- the book in three numbers -------------------------------------------------------------------------------------------
          THE SUMMARY IS ONE BLOCK, not three stacked ones (owner, 2026-09-14: "stuff is split awkwardly onto their own rows"). The
          three figures, the bar and the line that reads the bar are one statement about the book, so they sit tight together with no
          gaps between them, and the scanner indicator takes the empty right-hand side rather than earning a row of its own.
          The gloss no longer repeats "x of y arrived": with invoiced and arrived side by side an arm's length above it, saying it
          again in words was the screen talking to itself. It now carries only what the numbers above do not — the two parts of the
          order that have NOT landed. The per-order lines still spell out "x of y arrived", which is where that phrasing was asked for
          and where the denominator is not otherwise visible. */}
      <section className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
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
          <div className="mt-2">{bar(totals, 'h-2.5 w-full')}</div>
          <p className="mt-1.5 text-sm text-slate-500">
            {totals.transit === 0 && totals.awaiting === 0
              ? 'Everything ordered is here and billed.'
              : [
                totals.transit > 0 ? `${totals.transit} on the way` : null,
                totals.awaiting > 0 ? `${totals.awaiting} still to come` : null,
              ].filter(Boolean).join(', ')}
          </p>
        </div>
      </section>

      {/* --- filters and actions --------------------------------------------------------------------------------------------------
          ORDER OF CONTROLS (owner, 2026-09-14): status tabs, then search, then the order/invoice pickers. Broadest to narrowest, and
          the tabs lead because they are the question the screen exists for — the count on each says whether there is anything to do
          before you touch anything else. Search sits second as the way in when you already have a style in mind, and the pickers
          last, since they narrow to one delivery. */}
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
                {t.key !== 'all' && <span className={'inline-block h-2 w-2 shrink-0 rounded-full ' + STATE_STYLE[t.key as State].dot} />}
                {t.label}
                <span className="tabular-nums opacity-60">{t.count}</span>
              </button>
            );
          })}
        </div>

        {/* THE FILTER ROW SPANS THE SAME MEASURE AS THE SUMMARY (owner, 2026-09-14: "make sure it used the same length as the summary
            one cause rn it looks awkward"). It is built the same way as the summary block above — one thing at the left edge, the rest
            hard right — so the two rows reach both margins and read as the same column of page rather than two different widths
            stacked. The search keeps a ~24rem ceiling (it holds a style code; a full-bleed box would be a lot of white for a short
            string) and the pickers take the right, where the summary puts its scanner pill. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="relative w-full min-w-[14rem] sm:w-auto sm:flex-1 sm:max-w-sm">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a style, order or invoice"
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Both pickers write the SAME state, so choosing one visibly resets the other to "Any". */}

          {([
            { label: 'Order', kind: 'order' as const, options: data?.ordernums ?? [], roll: rollups.order },
            { label: 'Invoice', kind: 'invoice' as const, options: data?.invoices ?? [], roll: rollups.invoice },
          ]).map((p, i) => {
            const selected = focus?.kind === p.kind ? focus.value : '';
            return (
              // The first picker carries the auto-margin that pushes this half of the row to the right edge — a spacer element would
              // do the same until the row wraps, at which point it becomes a stray blank item.
              <label key={p.kind} className={'inline-flex items-center gap-2 text-sm text-slate-500' + (i === 0 ? ' sm:ml-auto' : '')}>
                {p.label}
                <select
                  value={selected}
                  onChange={(e) => setFocus(e.target.value ? { kind: p.kind, value: e.target.value } : null)}
                  // The closed box takes the selected entry's colour too, so the picker keeps saying "this one is finished" while
                  // you work inside it.
                  style={{ color: rollColour(p.roll.get(selected)) }}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="" style={{ color: ROLL_COLOUR.none }}>Any</option>
                  {p.options.map((o) => {
                    const g = p.roll.get(o);
                    // Colour AND words. Option colouring is honoured by Chrome, Edge and Firefox on Windows — which is what this is
                    // run on — but is ignored outright by some browsers, so the state is spelled out in the label as well and the
                    // colour is the bonus rather than the message.
                    return (
                      <option key={o} value={o} style={{ color: rollColour(g) }}>
                        {o}{g ? ` — ${rollLabel(g)}` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
            );
          })}
          {filtered && (
            <button type="button" onClick={reset} className="text-sm text-slate-500 underline hover:text-slate-700">Clear</button>
          )}
        </div>
      </section>

      {/* --- what the gun has just done -----------------------------------------------------------------------------------------
          There is no scanning MODE any more (owner, 2026-09-14: "i wanna be able to just scan"), so there is no station to open and
          no box to aim at — the page listens, and this appears only once something has been beeped. Each beep commits on its own, so
          the undo on each line is the safety net that immediate writing needs. */}
      {scanLog.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center gap-3 text-xs text-slate-500">
            <span className="font-medium text-slate-700">Scanned just now</span>
            {focus
              ? <span>into {focus.kind} <span className="font-mono">{focus.value}</span></span>
              : <span>across the whole book — pick an order or invoice above to stop a repeated barcode being ambiguous</span>}
            {scanBusy && <span className="text-slate-400">working…</span>}
            <button type="button" onClick={() => setScanLog([])} className="ml-auto underline hover:text-slate-700">Clear list</button>
          </div>

          <ul className="space-y-1">
              {scanLog.map((e) => (
                <li
                  key={e.id}
                  className={
                    'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-1.5 text-sm ' +
                    (e.tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : e.tone === 'ask' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-600')
                  }
                >
                  <span className="min-w-0 flex-1 font-mono text-xs">{e.text}</span>

                  {/* The barcode could not be resolved to one line — the operator names it. See the route header for why this asks
                      rather than guesses: a wrong guess puts two orders out, one over and one under. */}
                  {e.candidates?.map((c) => (
                    <button
                      key={c.ordernum + c.code}
                      type="button"
                      onClick={() => { setScanLog((prev) => prev.filter((x) => x.id !== e.id)); sendScan({ ordernum: c.ordernum, code: c.code }); }}
                      className="rounded border border-amber-300 bg-white px-2 py-0.5 font-mono text-xs hover:bg-amber-100"
                    >
                      {c.ordernum} · {c.arrived}/{c.requested}
                    </button>
                  ))}

                  {e.undo && (
                    <button
                      type="button"
                      onClick={() => undoScan(e)}
                      disabled={scanBusy}
                      className="inline-flex items-center gap-1 text-xs underline opacity-70 hover:opacity-100 disabled:opacity-30"
                    >
                      <XMarkIcon className="h-3.5 w-3.5" /> Undo
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}

      {notice && (
        <div className={'rounded-md px-3 py-2 text-sm ' + (notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')}>
          {notice.text}
          <button onClick={() => setNotice(null)} className="ml-3 text-xs underline opacity-70">Dismiss</button>
        </div>
      )}

      {/* Still spells out the count AND the scope, because the button's effect depends on a filter set elsewhere on the screen. It is
          no longer red or dire — the lines go to the archive and can be brought back — but it is still confirmed, because taking
          fifty lines off the book is worth a deliberate second press whether or not it can be undone. */}
      {confirmClear && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-800">
            Archive <span className="font-semibold tabular-nums">{clearable}</span> fully-arrived{' '}
            {clearable === 1 ? 'line' : 'lines'} from{' '}
            {clearScope.scope === 'all' ? 'the whole book' : <>{clearScope.scope} <span className="font-mono">{clearScope.value}</span></>}?
            They come off the book and into the archive, where you can put them back.
          </p>
          <div className="mt-2 flex gap-2">
            <button onClick={clearArrived} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900">
              Archive {clearable} {clearable === 1 ? 'line' : 'lines'}
            </button>
            <button onClick={() => setConfirmClear(false)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Keep them on the book
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

      {/* The review step of Load invoice. Read-only until its own Apply button — see BirkInvoiceDialog. */}
      {invoicePreview && (
        <BirkInvoiceDialog
          preview={invoicePreview}
          onClose={() => setInvoicePreview(null)}
          onApplied={async (summary) => {
            setInvoicePreview(null);
            await refresh();
            setNotice({ tone: 'ok', text: summary });
          }}
        />
      )}

      {/* The review step of Load order. Read-only until its own Load button — see BirkOrderDialog. */}
      {orderPreview && (
        <BirkOrderDialog
          preview={orderPreview}
          onClose={() => setOrderPreview(null)}
          onApplied={async (summary) => {
            setOrderPreview(null);
            await refresh();
            setNotice({ tone: 'ok', text: summary });
          }}
        />
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
