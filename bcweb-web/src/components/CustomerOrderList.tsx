'use client';
/*
=======================================================================================================================================
Component: CustomerOrderList
=======================================================================================================================================
Purpose: The CUSTOMERS stage of the Order Status module — the fulfilment grid, ported from the legacy PowerBuilder Status screen
         (Downloads/legacy-status.png). What have customers bought, and can we send it.

WHY A DENSE TABLE AND NOT CARDS (owner, explicitly): there can be 100+ orders and the job is to GLANCE at the list — spot the red,
deal with it, move on. Cards turn a one-screen scan into four screens of scrolling. So: ~28px rows, tabular figures, one row per
physical unit, and colour doing the talking. This is the one screen in the app where a plain table beats anything prettier.

COLUMNS — the legacy grid's, less four that were saying the same thing twice (all owner's calls):
  Local, UKD  the pick count and the UKD-stock count. Both are folded into the state stripe. UKD sourcing isn't done any more anyway.
  FBA         an integer column that was empty on all but a handful of rows. FBA is one of the six states, so the status pill says it.
  Ordered     showed `createddate` while "Order date" showed `orderdate`. Neither was the right source. The surviving column is
              headed "Ordered" and reads `created` — WHEN THE CUSTOMER ORDERED, always present, always to the second. `orderdate`
              is when WE last acted on the line and only agrees with it ~63% of the time; it stays in the payload to drive the
              state derivation but is not printed. When-we-ordered may earn a column later; it isn't this one.

GRAIN vs GROUPING: `orderstatus` holds one row per physical unit (CLAUDE.md landmine), so a 2-pair order is two rows sharing an
ordernum. Rows stay flat — that's what keeps the list scannable — but the ordernum is printed only on a group's first row and a hairline
separates groups, so the eye reads "one order, two pairs" without the layout changing shape. Every ACTION is per-order, matching both
the server routes and the way an operator thinks ("chase BC18665"), so clicking any line selects the whole order.

SELECTION drives one action bar above the table rather than a control per row: 100 rows x 5 controls would be unreadable, and the
legacy screen worked exactly this way (pick a row, choose from the dropdown, Apply). The note lives in that bar too — it's the blank
strip across the top of the legacy grid, which is where the feature came from.

STICKY CONTROLS: filters + find box + action bar are pinned to the top of the viewport (`position: sticky`), because the two halves
of every job on this screen are 80 rows apart — you find the row down the list, then act on it in a bar that used to be off-screen by
then. Scrolling back up to reach the bar, with the selection made blind, was the friction. Now the bar follows.

The column header sticks BELOW that block, which is why its `top` is measured at runtime rather than written as a class: the block
grows and shrinks (error line, confirm box, chips wrapping), so a hard-coded offset would either overlap the headings or leave a gap.
Sticky only bites when no ancestor is a scroll container, hence `lg:overflow-visible` on the table wrapper — below lg the table needs
its horizontal scroller more than it needs a pinned heading row.

TWO REFRESH-SHAPED THINGS, AND THEY ARE NOT THE SAME (see the Refresh button for the full note): REFRESH here re-reads our own DB —
free, read-only, press it all day. UPDATE ORDERS in the title row calls Shopify and writes. Only the second one can make a packed
order leave the list, because that's the archive phase of the sync.

SCAN TO LABEL (docs/clickdrop-labels-plan.md, wired 2026-10-13). A scan field sits beside the find box: a scanner types the code or
EAN and presses Enter, focus stays, scan scan scan. The server resolves it to our code (/order-status-customer-scan); the OLDEST open
order still needing that shoe takes it, is selected, and the unit is ticked; a scan nothing is waiting for turns the field red and
beeps, as on AMZ Shipment. When every unit of an order is scanned, /order-status-customer-label creates the Royal Mail shipment in
Click & Drop, marks the order packed (batch '2') and returns the label PDF, which prints straight away (lib/printPdf.ts). If a shoe
has no stored weight the server says WEIGHT_NEEDED and a kg box appears for the whole parcel. The action bar then offers Reprint
(a jam, a smudge — the SAME Click & Drop label) and Cancel label (printed by mistake — voids it in Click & Drop and un-packs the order).
NO bcweb TABLE (owner, 2026-10-13): scan progress lives here, in this component, while the box is being filled — a reload starts the
order's scans again — and the label route checks the scanned codes cover the order before it buys postage. "Printed 10:42 /
reprinted 2×" is this session's memory only; after a reload a labelled order simply reads Packed.

DATA comes from useApiQuery (SWR). Never fetch in a useEffect — docs/maintenance-notes.md.
=======================================================================================================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon, ArrowUturnLeftIcon, ChevronDownIcon, ExclamationTriangleIcon, MagnifyingGlassIcon, PrinterIcon, QrCodeIcon, TrashIcon,
} from '@heroicons/react/24/outline';
import { ChatBubbleLeftEllipsisIcon, CheckCircleIcon } from '@heroicons/react/24/solid';
import {
  CustomerOrderLine, CustomerOrderState, cancelCustomerLabel, deleteCustomerOrder, getCustomerOrderFbaFile, getCustomerOrders,
  manifestCustomerOrders, printCustomerLabel, resolveCustomerScan, setCustomerOrderCourier, setCustomerOrderFba, setCustomerOrderNote,
  setCustomerOrderWaiting,
} from '@/lib/api';
import { printPdfBase64 } from '@/lib/printPdf';
import {
  COURIERS, CUSTOMER_ORDERS_KEY, CUSTOMER_STATES,
  courierShort, isFba, isOutstanding, isWaiting, orderedAt, worstCustomerState,
} from '@/lib/orderStatusUi';
import { useApiQuery } from '@/lib/useApiQuery';

// localStorage key for the "Last order" button (see lastPacked).
const LAST_PACKED_KEY = 'customerOrders.lastPacked';

// Stable "nothing loaded yet" identity so the derived memos below aren't invalidated on every render.
const NO_LINES: CustomerOrderLine[] = [];

// Pack-only is a courier CODE on the row ('0', see COURIERS) but not a courier CHOICE on this screen — it has its own button on the
// action bar, so it's split out of the dropdown's options here. COURIERS stays the full list: the grid's Courier column still has to
// render 'Pack', and the server still validates '0' like any other code.
const PACK_ONLY = '0';
const SHIPPING = COURIERS.filter((c) => c.code !== PACK_ONLY);

// Scanned units per order: ordernum -> code -> units scanned. Counts, not line keys, because one order can hold two identical pairs
// (two rows, same code) and either physical shoe is the right one.
type ScanMap = Map<string, Map<string, number>>;
// A printed label, per order. `reprints` is shown so a third reprint of the same order reads as "something's wrong with the printer".
interface LabelInfo { printedAt: Date; reprints: number }

// Can this line still take a scan? Open = still on our packing job (isOutstanding) and not 'Do not order' — PLUS Waiting (owner,
// 2026-10-12): Waiting is set aside on the customer's say-so, not unpackable, so when the shoe is in hand it scans and packs like
// any other. It stays out of isOutstanding (the Pending count and progress bar), which is a different question.
const scannable = (l: CustomerOrderLine) => (isOutstanding(l.state) || isWaiting(l.state)) && l.state !== 'parked';

// Why an order can't have a label, or null if it can. The plan's refusals that the list payload can see; non-GB country is checked
// server-side once the route exists (country isn't on the line).
function labelBlock(o: { courier: string | null; postcode: string | null }): string | null {
  if (o.courier === PACK_ONLY) return 'Pack only — no label';
  if (!SHIPPING.some((c) => c.code === o.courier)) return 'Choose a courier first';
  if (!o.postcode?.trim()) return 'No postcode on this order';
  return null;
}

// Same two low beeps as AMZ Shipment's refused scan, so the bench learns one sound for "no". Failures (no audio device, autoplay
// policy before the first click) are ignored — the red field still says it.
function beepError() {
  try {
    const ctx = new AudioContext();
    for (const at of [0, 0.22]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 220;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.15);
    }
    setTimeout(() => ctx.close(), 600);
  } catch { /* silent; the screen still goes red */ }
}

// The scan box's DOM id, so the page can hand focus back to it after Update orders, which lives in the page's title row, outside this
// component (owner, 2026-10-14: after Refresh or Update orders, the cursor goes back to scan).
const SCAN_INPUT_ID = 'customer-order-scan';
export function focusCustomerScan() {
  document.getElementById(SCAN_INPUT_ID)?.focus();
}

export default function CustomerOrderList() {
  // Same SWR key the module home uses to headline the counts on the stage switch. SWR dedupes by key, so the two call sites share
  // one request and one cache entry — which is why this component doesn't report its counts upward through a prop. (It used to, and
  // that meant calling the parent's setState during this component's render: React rejects that outright, and rightly.)
  const { data, error: loadError, isLoading, busy, refresh } = useApiQuery(
    CUSTOMER_ORDERS_KEY,
    () => getCustomerOrders(),
  );

  const lines = data?.lines ?? NO_LINES;
  const truncated = data?.truncated ?? false;

  const [selected, setSelected] = useState<string | null>(null);
  // Two positions, not eight. See isOutstanding() — the screen asks one question and this is it. (Four now: 'fba' and 'waiting' are
  // a different question each — "what has Amazon got to ship", "what have we told the customer to expect" — not further slices of
  // the packing job.)
  const [filter, setFilter] = useState<'all' | 'pending' | 'fba' | 'waiting'>('all');
  const [term, setTerm] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // --- Fulfill (manifest step) — see manifest() -----------------------------------------------------------------------------------
  const [manifestConfirm, setManifestConfirm] = useState(false);
  const [manifesting, setManifesting] = useState(false);
  const [manifestNote, setManifestNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingManifests, setPendingManifests] = useState<string[]>([]);

  // --- scan to label (see the header: scans live here, the label lives in Click & Drop) -----------------------------------------
  const [scan, setScan] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  // An amber note under the scan row — currently only "a part-scanned order was dropped" (see ONE ORDER AT A TIME in handleScan).
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scans, setScans] = useState<ScanMap>(() => new Map());
  const [labels, setLabels] = useState<Map<string, LabelInfo>>(() => new Map());
  // The order waiting on a typed parcel weight (the server said WEIGHT_NEEDED), with the server's message naming the shoes.
  const [weightAsk, setWeightAsk] = useState<{ ordernum: string; message: string } | null>(null);
  // The last order THIS packer labelled, for the "Last order" button — a click elsewhere loses the selection, and this brings it back.
  // Kept in localStorage so it survives a refresh; per browser, not shared (each bench has its own last box). Read lazily and every
  // access guarded, because storage can be unavailable (private window, blocked site data).
  const [lastPacked, setLastPacked] = useState<string | null>(() => {
    try { return typeof window === 'undefined' ? null : window.localStorage.getItem(LAST_PACKED_KEY); } catch { return null; }
  });
  const rememberPacked = (ordernum: string) => {
    setLastPacked(ordernum);
    try { window.localStorage.setItem(LAST_PACKED_KEY, ordernum); } catch { /* not remembered across a reload; fine */ }
  };
  const scanRef = useRef<HTMLInputElement | null>(null);
  // Scans arrive faster than the server answers, so they run one at a time through this chain, and read the latest scans from a
  // ref rather than a render's closure — two quick scans of a 2-pair order must tick two units, not the same one twice.
  const scanQueue = useRef<Promise<void>>(Promise.resolve());
  const scansRef = useRef(scans);
  const updateScans = (next: ScanMap) => { scansRef.current = next; setScans(next); };

  // How tall the pinned control block currently is, so the table's heading row can stick directly underneath it instead of behind it.
  // Measured rather than assumed because the block changes height in normal use: selecting an order fills the bar, a failed write adds
  // an error line, a confirm swaps a button for a wider box, and the filter chips wrap on a narrow window.
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [controlsHeight, setControlsHeight] = useState(0);
  useEffect(() => {
    const el = controlsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setControlsHeight(el.offsetHeight));
    ro.observe(el);
    setControlsHeight(el.offsetHeight);
    return () => ro.disconnect();
    // The ref is null on the loading/error renders (the block isn't mounted), so the effect has to run again once the grid appears —
    // that is what these deps are for, not the values themselves.
  }, [isLoading, loadError]);

  // --- derived -----------------------------------------------------------------------------------------------------------------

  // Per-order roll-up, computed once: the state stripe, the line count, and the order-level fields the action bar needs. Keyed by
  // ordernum because that is the unit of action.
  const orders = useMemo(() => {
    const map = new Map<string, {
      ordernum: string; lines: CustomerOrderLine[]; state: CustomerOrderState;
      customer: string | null; postcode: string | null; courier: string | null; note: string; waiting: boolean;
    }>();
    for (const l of lines) {
      let o = map.get(l.ordernum);
      if (!o) {
        // Placeholder only — overwritten by the worstCustomerState roll-up once every line of the group has been collected.
        o = { ordernum: l.ordernum, lines: [], state: 'pending', customer: l.customer, postcode: l.postcode,
              courier: l.courier, note: '', waiting: false };
        map.set(l.ordernum, o);
      }
      o.lines.push(l);
      // First non-empty note in the group wins. Writes fan out across every line, so they normally agree — this only matters for
      // orders PowerBuilder noted line-by-line before this screen existed.
      if (!o.note && l.note) o.note = l.note;
      if (l.state === 'waiting') o.waiting = true;
    }
    for (const o of map.values()) o.state = worstCustomerState(o.lines.map((l) => l.state));
    return map;
  }, [lines]);

  // Three tallies, and they do NOT add up to lines.length — that is the point. `outstanding` is our packing job; `fba` is Amazon's
  // and `waiting` is the customer's, both counted apart so neither can make a finished day look unfinished (see isOutstanding).
  // Only `All` counts every line.
  const outstanding = useMemo(() => lines.reduce((n, l) => n + (isOutstanding(l.state) ? 1 : 0), 0), [lines]);
  const fbaCount = useMemo(() => lines.reduce((n, l) => n + (isFba(l.state) ? 1 : 0), 0), [lines]);
  const waitingCount = useMemo(() => lines.reduce((n, l) => n + (isWaiting(l.state) ? 1 : 0), 0), [lines]);

  // The headline, in ORDERS — one order is one box and one label, which is how the bench counts what's left. An order is in today's
  // job if any line is ours to pack or already packed (FBA and Waiting lines are out, as in the line counts above); it's left to do
  // while any of its lines is outstanding.
  const job = useMemo(() => {
    let left = 0, done = 0;
    for (const o of orders.values()) {
      const out = o.lines.some((l) => isOutstanding(l.state));
      const packed = o.lines.some((l) => l.state === 'packed' && l.fba === 0);
      if (out) left += 1; else if (packed) done += 1;
    }
    return { left, done, total: left + done };
  }, [orders]);

  // Search spans everything you'd have in your hand when looking an order up: the order number off a picking note, the customer's
  // name off an email, a postcode off a label, or the SKU. Case-insensitive substring, no term parsing — this is a find box, not a
  // query language (contrast the Inventory/Sales modules, where stepwise Contains filters earn their complexity).
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return lines.filter((l) => {
      // The same isOutstanding()/isFba() the chips counted with, so what a chip says and what it shows can never disagree.
      if (filter === 'pending' && !isOutstanding(l.state)) return false;
      if (filter === 'fba' && !isFba(l.state)) return false;
      if (filter === 'waiting' && !isWaiting(l.state)) return false;
      if (!q) return true;
      return (
        l.ordernum.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q) ||
        (l.customer || '').toLowerCase().includes(q) ||
        (l.postcode || '').toLowerCase().includes(q) ||
        (l.title || '').toLowerCase().includes(q)
      );
    });
  }, [lines, filter, term]);

  const active = selected ? orders.get(selected) ?? null : null;

  // Which LINES carry a scan tick, and each order's n-of-m. Ticks go on the first n scannable rows of each code in the order, so two
  // identical pairs fill in one at a time. Lines that aren't scannable (already packed, FBA, do not order) are out of the count entirely —
  // they aren't going in this box.
  const scanState = useMemo(() => {
    const ticked = new Set<CustomerOrderLine>();
    const progress = new Map<string, { scanned: number; total: number; missing: string[] }>();
    for (const o of orders.values()) {
      const done = scans.get(o.ordernum);
      const used = new Map<string, number>();
      const p = { scanned: 0, total: 0, missing: [] as string[] };
      for (const l of o.lines) {
        if (!scannable(l)) continue;
        p.total += l.qty;
        const n = used.get(l.code) ?? 0;
        if (n < (done?.get(l.code) ?? 0)) { ticked.add(l); p.scanned += l.qty; used.set(l.code, n + 1); }
        else p.missing.push(l.code);
      }
      progress.set(o.ordernum, p);
    }
    return { ticked, progress };
  }, [orders, scans]);

  // The list as of the last render, for a queued scan: it may run after a print has refreshed the list, and must see the order as it
  // is now (Packed), not as it was when Enter was pressed.
  const latest = useRef({ orders, labels, lines });
  useEffect(() => { latest.current = { orders, labels, lines }; }, [orders, labels, lines]);

  // Read off the per-order roll-up rather than the line being rendered: the note may sit on any line of the group (PowerBuilder wrote
  // only the clicked row), so testing the current line would hide the marker whenever the noted line isn't the one on top.
  const noteFor = (ordernum: string) => orders.get(ordernum)?.note || '';

  // --- actions -----------------------------------------------------------------------------------------------------------------

  // One wrapper for all five writes: they share a shape (act on the selected order, surface the error inline, refetch). api.ts never
  // throws on an API-level error, so this branches on the envelope, not on a catch.
  async function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setWorking(true);
    setActionError(null);
    const res = await fn();
    if (!res.success) setActionError(res.error || 'That didn’t work');
    else await refresh();
    setWorking(false);
    return res.success;
  }

  // The Amazon order file. Not through run(), because the response carries the file text that has to be handed to the browser — but
  // it IS a write (making the file stamps the order done, so the line turns Packed), hence the refresh. Plain Blob text is UTF-8 with
  // no BOM; the server already supplies the CRLF line endings.
  async function downloadFbaFile(ordernum: string) {
    setWorking(true);
    setActionError(null);
    const res = await getCustomerOrderFbaFile(ordernum);
    if (!res.success || !res.data) {
      setActionError(res.error || 'Couldn’t build the Amazon file');
      setWorking(false);
      return;
    }
    const url = URL.createObjectURL(new Blob([res.data.content], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = res.data.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await refresh();
    setWorking(false);
  }

  // --- scan to label -----------------------------------------------------------------------------------------------------------

  // Put the cursor back in the scan box after a print, so the next order's first shoe scans without a click (owner, 2026-10-13).
  // Printing takes focus into the hidden label frame — and with kiosk printing the PDF viewer can take it again a moment later — so
  // this runs at once and twice more. It only takes focus back from the label frame or from nowhere (body), never from a box the
  // packer has clicked into meanwhile (the weight prompt, the note, the find box).
  function refocusScan() {
    for (const ms of [0, 500, 1500]) {
      setTimeout(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el.tagName === 'IFRAME') scanRef.current?.focus();
      }, ms);
    }
  }

  // The order's scanned codes, one entry per unit — what the label route checks against the order before it buys postage.
  const scannedCodes = (ordernum: string) =>
    [...(scansRef.current.get(ordernum) ?? new Map<string, number>())].flatMap(([code, n]) => Array<string>(n).fill(code));

  // First print (the last shoe went in) or reprint. The server never makes a second Click & Drop order for an ordernum — a first
  // print of an order Click & Drop already has (PowerBuilder's, or an attempt whose reply was lost) reuses that label.
  async function printLabel(ordernum: string, opts: { weightKg?: number; reprint?: boolean } = {}) {
    setWorking(true);
    setActionError(null);
    const res = await printCustomerLabel(ordernum, opts.reprint ? { reprint: true } : { codes: scannedCodes(ordernum), weightKg: opts.weightKg });
    setWorking(false);
    if (!res.success || !res.data) {
      if (res.return_code === 'WEIGHT_NEEDED') {
        setWeightAsk({ ordernum, message: res.error || 'No stored weight — enter the parcel weight' });
        return;
      }
      setActionError(res.error || 'The label didn’t print');
      beepError();
      return;
    }
    setWeightAsk(null);
    printPdfBase64(res.data.pdf, refocusScan);
    rememberPacked(ordernum);
    setLabels((prev) => {
      const next = new Map(prev);
      const had = prev.get(ordernum);
      next.set(ordernum, had ? { ...had, reprints: had.reprints + 1 } : { printedAt: new Date(), reprints: 0 });
      return next;
    });
    if (res.data.existing && !res.data.reprint) {
      setActionError('Click & Drop already had this order (made elsewhere) — its existing label was printed');
    }
    // A first print packed the order on the server; re-read so it shows Packed.
    if (!res.data.reprint) await refresh();
    scanRef.current?.focus();
  }

  // Manifest and fulfil, manifest step (see the button). Downloads each finished manifest; one still processing at Click & Drop is kept so
  // the next press collects it rather than starting another.
  async function manifest() {
    setManifesting(true);
    setManifestNote(null);
    const res = await manifestCustomerOrders(pendingManifests);
    setManifesting(false);
    if (!res.success || !res.data) {
      const nothing = res.return_code === 'NOTHING_TO_MANIFEST';
      setManifestNote({ ok: nothing, text: res.error || 'The manifest didn’t go through' });
      if (nothing) setPendingManifests([]);
      return;
    }
    const all = res.data;
    const done = all.filter((m) => !m.pending && !m.failed);
    const pending = all.filter((m) => m.pending);
    const failed = all.filter((m) => m.failed);
    setPendingManifests(pending.map((m) => m.id));

    // Saved to Downloads, not printed (owner, 2026-10-14). Named by date + the manifest id's first block, so two in a day don't clash.
    const day = new Date().toISOString().slice(0, 10);
    for (const m of done) {
      if (!m.pdf) continue;
      const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(m.pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `manifest-${day}-${m.id.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    const orders = done.reduce((n, m) => n + m.orders.length, 0);
    const parts: string[] = [];
    if (done.length) parts.push(`Manifested ${orders} order${orders === 1 ? '' : 's'} — manifest saved to Downloads`);
    if (done.some((m) => !m.pdf)) parts.push('a manifest came back with no PDF — download it from Click & Drop');
    const unread = pending.filter((m) => m.readError);
    if (unread.length) parts.push(`manifested, but the PDF couldn’t be fetched (${unread[0].readError}) — press Collect manifest to try again`);
    if (pending.length > unread.length) parts.push('Click & Drop is still making the manifest — press Collect manifest in a minute to collect it');
    if (failed.length) parts.push(`manifest failed at Click & Drop (ref ${failed.map((m) => m.errorReference || m.id).join(', ')})`);
    setManifestNote({ ok: !failed.length && !unread.length && done.every((m) => m.pdf), text: parts.join('; ') });
  }

  // Voids the Click & Drop order (refused once Royal Mail has manifested it — the error shows in the bar) and un-packs the order.
  // Its scans clear with it, so the packer starts the order again from the first shoe rather than half-way through a box they may
  // have just unpacked.
  async function cancelLabel(ordernum: string) {
    const ok = await run(() => cancelCustomerLabel(ordernum));
    if (!ok) return;
    setLabels((prev) => { const next = new Map(prev); next.delete(ordernum); return next; });
    const next = new Map(scansRef.current);
    next.delete(ordernum);
    updateScans(next);
  }

  // Drop every other order's scans (ONE ORDER AT A TIME, see handleScan), saying so if one was part-scanned — the packer needs to
  // know those shoes have to be scanned again, together.
  function keepOnly(ordernum: string) {
    const { orders } = latest.current;
    const dropped: string[] = [];
    for (const [other, perCode] of scansRef.current) {
      if (other === ordernum) continue;
      const o = orders.get(other);
      const total = o ? o.lines.reduce((n, l) => n + (scannable(l) ? l.qty : 0), 0) : 0;
      const scanned = [...perCode.values()].reduce((n, c) => n + c, 0);
      if (o && scanned < total) dropped.push(`${other} (${scanned} of ${total})`);
    }
    setScanNote(dropped.length
      ? `Scans cleared on ${dropped.join(', ')} — an order's shoes are scanned together, so scan all of it again.`
      : null);
    const kept = scansRef.current.get(ordernum);
    updateScans(kept ? new Map([[ordernum, kept]]) : new Map());
  }

  // Enter in the scan box. Queued so scans are handled strictly in order (see scanQueue).
  function onScan() {
    const raw = scan.trim().toUpperCase();
    setScan('');
    if (!raw) return;
    scanQueue.current = scanQueue.current.then(() => handleScan(raw)).catch(() => {});
  }

  // A scanner types the code or EAN. The OLDEST open order still short of this shoe takes it — first come, first boxed, the same
  // rule the shelf follows. Orders already labelled are out: their box is shut.
  async function handleScan(raw: string) {
    const resolved = await resolveCustomerScan(raw);
    if (!resolved.success || !resolved.data) {
      setScanError(`${raw} — ${resolved.error || 'couldn’t look it up'}`);
      beepError();
      return;
    }
    const code = resolved.data.code.toUpperCase();
    const scans = scansRef.current;
    const { orders, labels, lines } = latest.current;

    // ONE ORDER AT A TIME (owner, 2026-10-13): a group order's shoes are scanned together, into one box. So the order already being
    // scanned gets first claim on the shoe; only if it doesn't want it does the oldest open order take it — and then the part-scanned
    // one is dropped (below), not left half ticked to be finished later from a box that's been put aside.
    let best: { ordernum: string; created: string } | null = null;
    for (const o of orders.values()) {
      if (labels.has(o.ordernum)) continue;
      const match = o.lines.find((l) => l.code.toUpperCase() === code);
      if (!match) continue;
      const wanted = o.lines.filter((l) => scannable(l) && l.code === match.code).length;
      const have = scans.get(o.ordernum)?.get(match.code) ?? 0;
      if (wanted <= have) continue;
      if (scans.has(o.ordernum)) { best = { ordernum: o.ordernum, created: '' }; break; }   // the order in hand
      const created = o.lines.reduce((m, l) => (l.created < m ? l.created : m), o.lines[0].created);
      if (!best || created < best.created) best = { ordernum: o.ordernum, created };
    }

    if (!best) {
      // RETRY BY RE-SCAN. With no Print button, an order whose last scan was blocked (no courier, no postcode) gets its label by
      // fixing the order and scanning one of its shoes again: a fully scanned, unlabelled order holding this shoe takes the scan as
      // "try the label now" rather than a refusal.
      const retry = [...orders.values()].find((o) => {
        if (labels.has(o.ordernum) || !o.lines.some((l) => scannable(l) && l.code.toUpperCase() === code)) return false;
        const total = o.lines.reduce((n, l) => n + (scannable(l) ? l.qty : 0), 0);
        const scanned = [...(scans.get(o.ordernum)?.values() ?? [])].reduce((n, c) => n + c, 0);
        return total > 0 && scanned >= total;
      });
      if (retry) {
        keepOnly(retry.ordernum);
        setScanError(null);
        setSelected(retry.ordernum);
        const block = labelBlock(retry);
        if (block) { setActionError(`All scanned, but no label: ${block}`); beepError(); }
        else await printLabel(retry.ordernum);
        return;
      }

      // Three different "no"s, worded apart so the packer knows whether to look for a mistake or put the shoe back: no order wants
      // it at all, every order that wants it is already scanned, or the only orders for it aren't open (packed, FBA, do not order).
      const hits = lines.filter((l) => l.code.toUpperCase() === code);
      setScanError(
        hits.length === 0 ? `${code} — no customer order waiting for this shoe`
        : hits.some(scannable) ? `${code} — every order for this shoe is already scanned`
        : `${code} — its order isn’t open for packing (${[...new Set(hits.map((l) => CUSTOMER_STATES[l.state].label))].join(', ')})`
      );
      beepError();
      return;
    }

    const o = orders.get(best.ordernum)!;
    const realCode = o.lines.find((l) => l.code.toUpperCase() === code)!.code;
    keepOnly(o.ordernum);
    const next = new Map(scansRef.current);
    const perCode = new Map(next.get(o.ordernum) ?? []);
    perCode.set(realCode, (perCode.get(realCode) ?? 0) + 1);
    next.set(o.ordernum, perCode);
    updateScans(next);
    setWeightAsk(null);
    setScanError(null);
    setActionError(null);
    // The order must be on screen: drop a filter or search that would hide it, then bring its first row into view.
    setFilter('all');
    setTerm('');
    setSelected(o.ordernum);
    requestAnimationFrame(() => document.getElementById(`order-${o.ordernum}`)?.scrollIntoView({ block: 'center' }));

    // Last shoe in: print straight away, no click — the packer's hands are full. A blocked order says why in the bar instead.
    const p = { scanned: 0, total: 0 };
    for (const l of o.lines) if (scannable(l)) p.total += l.qty;
    for (const n of perCode.values()) p.scanned += n;
    if (p.scanned >= p.total) {
      const block = labelBlock(o);
      if (block) setActionError(`All scanned, but no label: ${block}`);
      else await printLabel(o.ordernum);
    }
  }

  // The parcel weight typed in after WEIGHT_NEEDED. Whole order, kg, this label only.
  async function submitWeight(kg: number) {
    if (!weightAsk) return;
    await printLabel(weightAsk.ordernum, { weightKg: kg });
  }

  // --- render ------------------------------------------------------------------------------------------------------------------

  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (loadError) return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>;

  return (
    <div>
      {/* --- the pinned control block ------------------------------------------------------------------------------------------
          Everything you can DO on this screen, held at the top of the viewport while the list scrolls under it. The negative margin
          + matching padding let the opaque background span the full width of AppShell's container, so rows disappear cleanly behind
          it rather than showing through at the edges. -top-px kills the hairline gap some browsers leave at fractional scroll
          offsets. z-30 keeps it above the table's own sticky heading row (z-10). */}
      <div ref={controlsRef} className="sticky -top-px z-30 -mx-4 border-b border-slate-200 bg-white px-4 pb-3 pt-1">
      {/* --- what's left: the headline -----------------------------------------------------------------------------------------
          First and biggest in the pinned block, so "how much is left" is answered from across the room. Over OUR work only — FBA and
          Waiting are out, so it can say "All packed" on a day with an MCF order to place or a customer on backorder; the chips
          below are what say otherwise. */}
      <PackSummary left={job.left} done={job.done} total={job.total} />

      {/* --- filter chips, Last order, Refresh (rightmost) — then scan and find, a row each -------------------------------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* TWO CHIPS. Pending is always rendered, even at zero — a day finished is worth seeing as "Pending 0", and a chip that
            disappears when it empties takes the reassurance with it. */}
        <Chip label="All" count={lines.length} active={filter === 'all'} onClick={() => setFilter('all')} />
        <Chip
          label="Pending"
          count={outstanding}
          active={filter === 'pending'}
          onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
        />

        {/* FBA, and ONLY when there are some. The opposite call to Pending's above, for the opposite reason: an FBA line is an
            exception that needs an MCF order placing, so the chip appearing IS the reminder — where "FBA 0" every day would be
            noise you'd stop seeing, which is exactly how the thing gets forgotten. Sky, to match the row stripe. */}
        {fbaCount > 0 && (
          <Chip
            label="FBA"
            count={fbaCount}
            active={filter === 'fba'}
            onClick={() => setFilter(filter === 'fba' ? 'all' : 'fba')}
            tone="sky"
          />
        )}

        {/* Waiting, on the same terms as FBA above and for the same reason — an exception that can't be packed today, so the chip
            appearing is the reminder it's there. Amber, to match the row stripe. */}
        {waitingCount > 0 && (
          <Chip
            label="Waiting"
            count={waitingCount}
            active={filter === 'waiting'}
            onClick={() => setFilter(filter === 'waiting' ? 'all' : 'waiting')}
            tone="amber"
          />
        )}

        {/* --- fulfill ---------------------------------------------------------------------------------------------------------
            Acts on the list, not on one order (owner, 2026-10-14). For now it MANIFESTS only — everything Click & Drop has waiting,
            then saves the manifest PDF to Downloads; the Shopify fulfil step comes later (docs/fulfil-plan.md). Behind a confirm: a manifest can't be
            undone. While a manifest is still processing at Click & Drop the button collects it instead of starting another. */}
        <span className="ml-auto">
          {manifestConfirm ? (
            <ConfirmBox
              message="Manifest everything on Click & Drop? This can’t be undone."
              onYes={() => { setManifestConfirm(false); manifest(); }}
              onNo={() => setManifestConfirm(false)}
            />
          ) : (
            <button
              type="button"
              disabled={manifesting}
              onClick={() => (pendingManifests.length ? manifest() : setManifestConfirm(true))}
              title={pendingManifests.length ? 'Collect the manifest Click & Drop is still making' : 'Manifest everything waiting on Click & Drop and download the manifest'}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {manifesting && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
              {manifesting ? 'Manifesting…' : pendingManifests.length ? 'Collect manifest' : 'Manifest and fulfil'}
            </button>
          )}
        </span>

        {/* --- last order ------------------------------------------------------------------------------------------------------
            Re-selects the last order this packer labelled (owner, 2026-10-13) — for the click off it that wasn't meant. Clears a
            filter or search that would hide it and scrolls to it, like a scan does. Disabled once that order has left the list
            (archived after Shopify fulfilment) or before anything has been labelled. */}
        <button
          type="button"
          onClick={() => {
            if (!lastPacked) return;
            setFilter('all');
            setTerm('');
            setSelected(lastPacked);
            setActionError(null);
            requestAnimationFrame(() => document.getElementById(`order-${lastPacked}`)?.scrollIntoView({ block: 'center' }));
            scanRef.current?.focus();
          }}
          disabled={!lastPacked || !orders.has(lastPacked)}
          title={lastPacked ? `Select ${lastPacked}, the last order you printed a label for` : 'No label printed yet'}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
        >
          <ArrowUturnLeftIcon className="h-4 w-4" />
          Last order{lastPacked && orders.has(lastPacked) ? ` · ${lastPacked}` : ''}
        </button>

        {/* --- refresh ---------------------------------------------------------------------------------------------------------
            NOT "Update orders". This re-reads OUR database and nothing else: one query, no Shopify call, no writes. It's here so
            that checking pick progress through the busy part of the day — which is done constantly — costs nothing and can't hammer
            the Shopify API. Update orders stays in the title row, deliberately further away, because it writes.

            WHAT IT DOES AND DOESN'T SHOW, because the difference matters and isn't obvious:
              it DOES show   progress the team makes in our own DB — notes, courier / Pack only, Waiting, and the localstock
                             allocation PowerBuilder writes as things are picked.
              it does NOT    make a packed order leave the list. A line only disappears once Shopify reports it fulfilled and the
                             ARCHIVE phase moves it to orderstatus_archive — and that phase is part of the sync, so it needs an
                             Update orders (or the cron run, which fires around the dispatch window).
            So: Refresh to see how the picking is going, Update orders when you want the count to come down. */}
        <button
          type="button"
          // Back to the scan box once the re-read lands (owner, 2026-10-14) — the next thing done is scan a shoe, not click again.
          onClick={async () => { await refresh(); scanRef.current?.focus(); }}
          disabled={busy}
          title="Re-read our order list. Doesn't contact Shopify."
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowPathIcon className={'h-4 w-4 ' + (busy ? 'animate-spin' : '')} />
          Refresh
        </button>
      </div>

      {/* --- scan --------------------------------------------------------------------------------------------------------------
          Scan and find share one full-width row below the chips, half each (owner, 2026-10-13). Separate boxes, not one: the find box FILTERS the list as you type, the scan box ACTS on Enter — mixing the two would narrow the grid to one
          shoe on every scan. Brand-ringed so the eye finds it first; red after a refusal. */}
      <div className="mb-2 flex gap-2">
        <div className="relative flex-1">
          <QrCodeIcon className={'pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ' +
            (scanError ? 'text-red-500' : 'text-brand-500')} />
          <input
            ref={scanRef}
            id={SCAN_INPUT_ID}
            // Focused on arrival: the first thing done on this screen is pick up a shoe and scan it, no click first. It mounts with
            // the grid (after the loading render), so autoFocus fires once the list is there.
            autoFocus
            value={scan}
            onChange={(e) => setScan(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(); } }}
            placeholder="Scan a shoe…"
            aria-label="Scan a shoe"
            aria-invalid={!!scanError}
            autoComplete="off"
            className={'w-full rounded-md border py-1.5 pl-8 pr-3 text-sm uppercase placeholder:normal-case placeholder:text-slate-400 focus:outline-none ' +
              (scanError
                ? 'border-red-400 bg-red-50 ring-1 ring-red-300'
                : 'border-brand-500/50 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30')}
          />
        </div>

        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          {/* Forced UPPERCASE, like the Pricing and Inventory find boxes (owner) — order numbers and SKUs are uppercase, so typing
              matches what's on the screen and on the picking note. Purely cosmetic to the filter: `shown` lowercases both sides, so
              a lowercase customer name or title still matches. `placeholder:normal-case` keeps the hint readable. */}
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            placeholder="Order, customer, postcode, SKU…"
            className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-sm uppercase placeholder:normal-case placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
          />
        </div>
      </div>

      {manifestNote && (
        <p className={'mb-2 flex items-center gap-1.5 text-sm font-medium ' + (manifestNote.ok ? 'text-emerald-700' : 'text-red-700')}
          role={manifestNote.ok ? 'status' : 'alert'}>
          {manifestNote.ok
            ? <CheckCircleIcon className="h-4 w-4 shrink-0" />
            : <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />}
          {manifestNote.text}
        </p>
      )}

      {scanNote && (
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-800" role="status">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />{scanNote}
        </p>
      )}

      {/* The refusal, right under the scan row. Clears on the next good scan, like AMZ Shipment's. */}
      {scanError && (
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-red-700" role="alert">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />{scanError}
        </p>
      )}

      {/* The parcel weight, only when a shoe in the order has none stored. Whole order, kg. Enter prints; Not now leaves the order
          fully scanned, so re-scanning any of its shoes asks again. */}
      {weightAsk && (
        <WeightPrompt
          key={weightAsk.ordernum}
          ordernum={weightAsk.ordernum}
          message={weightAsk.message}
          working={working}
          onSubmit={submitWeight}
          onCancel={() => { setWeightAsk(null); scanRef.current?.focus(); }}
        />
      )}

      {/* --- the action bar: the legacy screen's top strip ---------------------------------------------------------------------
          ALWAYS RENDERED, never conditionally mounted. Showing it only when a row was selected made the whole grid jump down the
          page on the click that selected it — and then jump back up on deselect, moving the row you were aiming at. With nothing
          selected it renders in the same footprint with its controls disabled, so clicking a row changes the contents of a box that
          was already there and the table never moves. */}
      <OrderActionBar
        order={active}
        working={working}
        error={actionError}
        onClose={() => { setSelected(null); setActionError(null); }}
        onNote={(note) => active && run(() => setCustomerOrderNote(active.ordernum, note))}
        onWaiting={(w) => active && run(() => setCustomerOrderWaiting(active.ordernum, w))}
        onCourier={(c) => active && run(() => setCustomerOrderCourier(active.ordernum, c))}
        // Flag it, then hand over the Amazon file straight away — flagging alone leaves the order sitting there until somebody
        // uploads the file to Seller Central, so the two are one job and the operator expects the file from this click (owner).
        onFba={async () => {
          if (active && await run(() => setCustomerOrderFba(active.ordernum))) await downloadFbaFile(active.ordernum);
        }}
        onFbaFile={() => active && downloadFbaFile(active.ordernum)}
        onDelete={async () => { if (active && await run(() => deleteCustomerOrder(active.ordernum))) setSelected(null); }}
        progress={active ? scanState.progress.get(active.ordernum) ?? null : null}
        label={active ? labels.get(active.ordernum) ?? null : null}
        ticked={scanState.ticked}
        // Each label action hands focus back to the scan box: the next thing the packer does is scan the next shoe.
        onPrint={() => { if (active) printLabel(active.ordernum, { reprint: true }); }}
        onCancelLabel={async () => { if (active) { await cancelLabel(active.ordernum); scanRef.current?.focus(); } }}
      />
      </div>

      {/* Outside the pinned block on purpose: it's a one-off notice, not a control, and it would cost the grid a permanent strip of
          the viewport for something you read once. */}
      {truncated && (
        <div className="mb-2 mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing the first {lines.length} lines — there are more. Narrow it down with the search box.
        </div>
      )}

      {/* --- the grid ---------------------------------------------------------------------------------------------------------- */}
      {/* `overflow-x-auto` makes this a scroll container, and a sticky child positions against its nearest scrolling ancestor — which
          would pin the heading row to a box that never scrolls, i.e. not at all. From lg up the table fits the container outright, so
          the scroller is dropped and the heading sticks to the window like it's meant to. Below lg the horizontal scroll is worth
          more than a pinned heading. */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white lg:overflow-visible">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          {/* `top` is the live height of the pinned control block above — see the note on controlsHeight. */}
          <thead
            style={{ top: controlsHeight }}
            className="sticky z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"
          >
            <tr>
              <th className="w-1 p-0" aria-label="Status" />
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-2 py-2 font-medium">Code</th>
              <th className="px-2 py-2 text-right font-medium">Qty</th>
              <th className="px-2 py-2 font-medium">Supplier</th>
              <th className="px-2 py-2 font-medium">Customer</th>
              <th className="px-2 py-2 font-medium">Post code</th>
              {/* One date column, not two. The old "Ordered" showed createddate and "Order date" showed the orderdate stamp — the
                  same event at two precisions, in two columns, which is why one of them had to go. FBA lost its column too: it is
                  one of the states, so the stripe already says it and a mostly-empty integer column said it twice. */}
              <th className="px-2 py-2 font-medium">Ordered</th>
              <th className="px-2 py-2 font-medium">Courier</th>
              {/* Holds "Packed" and "Waiting" — the two ends of the list. Headed Status rather than either of them. */}
              <th className="px-2 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => {
              // A group's first VISIBLE row prints the ordernum and gets the separator. Computed against the filtered list, so
              // filtering to one state never leaves a group looking headerless.
              const firstOfGroup = i === 0 || shown[i - 1].ordernum !== l.ordernum;
              const isSelected = selected === l.ordernum;
              const s = CUSTOMER_STATES[l.state];
              return (
                <tr
                  key={`${l.ordernum}|${l.code}`}
                  id={firstOfGroup ? `order-${l.ordernum}` : undefined}
                  onClick={() => { setSelected(isSelected ? null : l.ordernum); setActionError(null); }}
                  className={
                    'cursor-pointer ' +
                    (firstOfGroup ? 'border-t border-slate-200 ' : '') +
                    // A waiting line is out of the packing job entirely (see isOutstanding), so it gets a faint amber wash across
                    // the whole row — the 1px stripe alone is easy to skim past when you're scanning for what's left to do, and
                    // this is the state you most need to not pick up by mistake. Selection still wins, so the row you clicked is
                    // never ambiguous.
                    // Packed gets the same treatment in green (owner, 2026-10-13): done rows read as done across the whole width, so
                    // what's left to pack is the white that remains.
                    (isSelected ? 'bg-brand-50'
                      : isWaiting(l.state) ? 'bg-amber-50/70 hover:bg-amber-100/70'
                      : l.state === 'packed' ? 'bg-emerald-50 hover:bg-emerald-100/70'
                      // FBA in sky, to match its stripe and chip — Amazon's to ship, not ours to pack. Once the Amazon file is made the
                      // line reads Packed and turns green with the rest of the done work.
                      : isFba(l.state) ? 'bg-sky-50 hover:bg-sky-100/70'
                      : 'hover:bg-slate-50')
                  }
                >
                  {/* The stripe is the whole point of the screen: state read by colour, at a glance, without reading a word. */}
                  <td className={'w-1 p-0 ' + s.stripe} />
                  {/* The note marker rides with the ordernum because the note is per-ORDER, so it must appear once per group and not
                      once per unit. Amber and solid-filled so it reads as "there is something here to read" against a row of grey
                      text — a hollow outline icon at this size disappears. The native title gives it away on hover for a mouse
                      user; the click that opens it is the row click that's already there. */}
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium tabular-nums text-slate-800">
                    {firstOfGroup && (
                      <span className="flex items-center gap-1.5">
                        {l.ordernum}
                        {noteFor(l.ordernum) && (
                          // `title` makes heroicons render a real <svg><title> child, which is what actually produces the hover
                          // tooltip (the title ATTRIBUTE does nothing on an SVG). titleId + aria-hidden={false} override the
                          // library's decorative defaults so the note is announced rather than skipped — this icon carries
                          // information, so it must not be hidden from assistive tech.
                          <ChatBubbleLeftEllipsisIcon
                            className="h-3.5 w-3.5 shrink-0 text-amber-500"
                            title={`Note: ${noteFor(l.ordernum)}`}
                            titleId={`note-${l.ordernum}`}
                            aria-hidden={false}
                          />
                        )}
                      </span>
                    )}
                  </td>
                  {/* The scan tick rides on the code because the code is what was scanned. Always reserving the icon's width would
                      shift every code right for a feature most rows never use, so it's drawn only on a scanned line. */}
                  <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-600" title={l.title || l.code}>
                    {scanState.ticked.has(l) ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircleIcon className="h-3.5 w-3.5 shrink-0" aria-label="Scanned" />{l.code}
                      </span>
                    ) : l.code}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{l.qty}</td>
                  <td className="max-w-[120px] truncate px-2 py-1.5 text-slate-500">{l.supplier || '—'}</td>
                  <td className="max-w-[150px] truncate px-2 py-1.5 text-slate-600">{l.customer || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{l.postcode || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-500">{orderedAt(l.created)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{courierShort(l.courier)}</td>
                  {/* TWO PILLS, PACKED AND WAITING (owner). A pill on every row meant the column was a wall of badges you had to
                      read to find the few that mattered; badging only the lines that have LEFT the packing job — finished one end,
                      set aside the other — keeps "what's done and what isn't mine today" a shape you can see without reading a
                      word, and an empty cell still means "still to pack". The rest haven't gone: they colour the stripe. */}
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {(l.state === 'packed' || l.state === 'waiting') && (
                      <span className={'rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ' + s.pill}>{s.label}</span>
                    )}
                    {/* Once per ORDER (a label is one parcel), on the group's first row. Sky outline: done-ish but not Packed's
                        solid green — until the server writes batch='2', a printed label is not the same as packed. */}
                    {firstOfGroup && labels.has(l.ordernum) && (
                      <span className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-300">
                        <PrinterIcon className="h-3 w-3" />Label
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-400">
            {lines.length === 0 ? 'No customer orders to fulfil.' : 'Nothing matches that filter.'}
          </p>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {shown.length === lines.length
          ? `${lines.length} line${lines.length === 1 ? '' : 's'} across ${orders.size} order${orders.size === 1 ? '' : 's'}`
          : `${shown.length} of ${lines.length} lines`}
        {busy && ' · refreshing…'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * PackSummary — what's left to pack today, as the headline of the screen.
 *
 * Big number first: ORDERS LEFT (one order = one box = one label), because the packer asks "how many more boxes" and the number has
 * to be readable from the bench, not just from the chair. Then a thick bar and "x of y packed", which turns the same fact into a shape. At zero the whole strip goes green and says All packed — the end of the job is
 * worth seeing, not just the absence of work.
 *
 * Fixed height and tabular figures so the pinned block — and so the grid under it — never shifts as the numbers change. The fill
 * animates its width (transition-[width], not -all, so the colour swap at 100% lands at once). Hidden on an empty list: a 0-of-0
 * bar reads as broken rather than done.
 */
function PackSummary({ left, done, total }: { left: number; done: number; total: number }) {
  if (total === 0) return null;

  const pct = Math.round((done / total) * 100);
  const finished = left === 0;

  return (
    <div
      className={'mb-3 flex h-16 items-center gap-5 rounded-lg border px-4 transition-colors ' +
        (finished ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}
    >
      <div className="flex shrink-0 items-baseline gap-2">
        {finished ? (
          <span className="flex items-center gap-2 text-2xl font-bold text-emerald-700">
            <CheckCircleIcon className="h-7 w-7" />All packed
          </span>
        ) : (
          <>
            <span className="text-4xl font-bold tabular-nums leading-none text-slate-900">{left}</span>
            <span className="text-sm font-semibold text-slate-700">order{left === 1 ? '' : 's'} left to pack</span>
          </>
        )}
      </div>

      <div
        className="flex min-w-0 flex-1 items-center gap-3"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`${done} of ${total} orders packed`}
      >
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className={'h-full rounded-full transition-[width] duration-700 ease-out ' + (finished ? 'bg-emerald-500' : 'bg-emerald-400')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={'shrink-0 text-sm font-semibold tabular-nums ' + (finished ? 'text-emerald-700' : 'text-slate-600')}>
          {done} of {total} packed
        </span>
      </div>
    </div>
  );
}

/*
 * Chip — All / Pending / FBA / Waiting.
 *
 * `tone` is the one bit of styling it takes: default slate for the two chips that slice our own work, 'sky' for FBA and 'amber' for
 * Waiting so each reads as a different KIND of thing at a glance and matches that row's stripe. Not a general colour prop — spelled
 * out per tone, because the next state that wants a colour should have to justify it here rather than pass a class in.
 */
function Chip({ label, count, active, onClick, tone = 'slate' }: {
  label: string; count: number; active: boolean; onClick: () => void; tone?: 'slate' | 'sky' | 'amber';
}) {
  const idle =
    tone === 'sky' ? 'border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300'
    : tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300'
    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300';
  const on =
    tone === 'sky' ? 'border-sky-600 bg-sky-600 text-white'
    : tone === 'amber' ? 'border-amber-500 bg-amber-500 text-white'
    : 'border-slate-800 bg-slate-800 text-white';
  const countTone = tone === 'sky' ? 'text-sky-400' : tone === 'amber' ? 'text-amber-500' : 'text-slate-400';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ' + (active ? on : idle)
      }
    >
      {label}
      <span className={active ? 'text-white/70' : countTone}>{count}</span>
    </button>
  );
}

/*
 * OrderActionBar — everything you can do to the selected order, in the strip above the grid.
 *
 * ACTIONS ARE RANKED BY HOW OFTEN THEY'RE ACTUALLY USED (all owner's calls), not by how interesting they are:
 *
 *   Note, Pack only, Courier      on the face of the bar, always visible, no click to reach them.
 *   Waiting, Send from FBA, Delete  rare. Behind a "More" disclosure.
 *
 * PACK ONLY is promoted OUT of the courier dropdown and onto the bar as its own button — it's one of the two things done most on
 * this screen ("deal with this, don't send it out"), and it isn't really a shipping choice at all: it's the decision NOT to ship
 * yet. Buried as one of three options in a select, a main action cost two clicks and read as a courier. It still writes the same
 * `courier='0'` through the same route, so the table column and the legacy screen are unaffected — only the control moved.
 *
 * The disclosure is the ONE thing here allowed to change the bar's height. Everything else is pinned (see below), but this only
 * expands on an explicit click on "More", when the operator is aiming at the bar rather than at the table.
 *
 * `order` is NULLABLE and the bar renders either way — see the note at the call site. Every control is simply disabled when nothing
 * is selected, which keeps the footprint identical between the two states; that is the whole point, so don't "tidy" this into an
 * early return.
 */
function OrderActionBar({
  order, working, error, onClose, onNote, onWaiting, onCourier, onFba, onFbaFile, onDelete, progress, label, ticked, onPrint, onCancelLabel,
}: {
  order: { ordernum: string; state: CustomerOrderState; customer: string | null; postcode: string | null; courier: string | null; note: string;
           waiting: boolean; lines: CustomerOrderLine[] } | null;
  working: boolean;
  error: string | null;
  onClose: () => void;
  onNote: (note: string) => void;
  onWaiting: (w: boolean) => void;
  onCourier: (c: string) => void;
  onFba: () => void;
  onFbaFile: () => void;
  onDelete: () => void;
  progress: { scanned: number; total: number; missing: string[] } | null;
  ticked: Set<CustomerOrderLine>;
  label: LabelInfo | null;
  onPrint: () => void;
  onCancelLabel: () => void;
}) {
  // Keyed on ordernum so selecting a different order re-seeds the field instead of carrying the previous order's note across.
  // Deriving state during render like this is the sanctioned React pattern for "reset when a prop changes" — note it sets THIS
  // component's own state, which is exactly what made the earlier parent-notifying version illegal.
  const [note, setNote] = useState(order?.note ?? '');
  const [noteFor, setNoteFor] = useState(order?.ordernum ?? null);
  const [confirm, setConfirm] = useState<'fba' | 'delete' | 'cancelLabel' | null>(null);
  const [more, setMore] = useState(false);

  if (noteFor !== (order?.ordernum ?? null)) {
    setNoteFor(order?.ordernum ?? null);
    setNote(order?.note ?? '');
    // Clear any half-answered confirm too. Without this, arming "Delete?" on one order and then clicking a different row would
    // leave the confirm showing against the new selection — one more click and the wrong order is gone. The disclosure re-closes
    // for the same reason: the rare actions should be a deliberate choice per order, never left standing open from the last one.
    setConfirm(null);
    setMore(false);
  }

  const idle = order === null;
  // Disabled whenever there's nothing selected OR a write is in flight, so the two cases never need separate handling below.
  const off = idle || working;
  const multiLine = (order?.lines.length ?? 0) > 1;
  const noteChanged = !idle && note.trim() !== order.note.trim();
  const packOnly = order?.courier === PACK_ONLY;
  // Keyed on the amz count, not the state: once the file is made the line reads Packed, and the button must stay so a lost or failed
  // upload can be re-downloaded (the server keeps the first file's stamp). `fileMade` only changes the wording.
  const hasFba = order?.lines.some((l) => l.fba > 0) ?? false;
  const fileMade = hasFba && !order!.lines.some((l) => isFba(l.state));
  // Does this order have a label to reprint or cancel? One printed this session, or a PACKED order — once the server writes
  // batch='2' at print time, packed is what a labelled order looks like after a reload. Not an FBA order (packed by its Amazon file)
  // or a pack-only one: neither ever had a Royal Mail label.
  const hasLabel = !!label || (order?.state === 'packed' && !hasFba && !packOnly);
  // Only worth saying once a scan has started on this order; "0 of 1 scanned" on every click would be noise.
  const showProgress = !!progress && progress.total > 0 && progress.scanned > 0 && !label;

  return (
    // No bottom margin: the pinned block that wraps this owns the gap to the grid, and a margin here would be dead pinned pixels.
    <div className={'rounded-lg border p-3 transition-colors ' +
      (idle ? 'border-slate-200 bg-slate-50/60' : 'border-brand-200 bg-brand-50/50')}>
      {/* ONE header structure for both states, never a branch between two different layouts — that branch was the flip. Every slot
          is always present and always occupies its space: the order number falls back to a placeholder dash, the hint takes the
          customer slot, and Close goes `invisible` (which still reserves its box) rather than unmounting. The explicit min-height
          pins the row even if every slot happens to be empty, so the table below never moves. */}
      <div className="mb-2 flex min-h-[1.5rem] flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={'font-semibold ' + (idle ? 'text-slate-300' : 'text-slate-900')}>
          {order ? order.ordernum : '—'}
        </span>
        <span className={'text-sm ' + (idle ? 'text-slate-400' : 'text-slate-600')}>
          {order ? (order.customer || '—') : 'Select an order below'}
        </span>
        <span className="text-sm text-slate-400">{order?.postcode || ''}</span>
        {/* n of m. WHICH shoes are still missing is the chip row below. */}
        {showProgress && (
          <span className={'text-sm font-medium ' +
            (progress!.scanned >= progress!.total ? 'text-emerald-700' : 'text-brand-700')}>
            {progress!.scanned} of {progress!.total} scanned
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={idle}
          className={'ml-auto text-xs text-slate-400 hover:text-slate-600 ' + (idle ? 'invisible' : '')}
        >
          Close
        </button>
      </div>

      {/* --- the shoes in this order (owner, 2026-10-13) ----------------------------------------------------------------------
          One chip per unit: the code to go and find, the name to check it against, and whether it's been scanned. Packed and FBA
          units aren't going in this box, so they say so instead. Always rendered at a minimum height (empty when nothing is
          selected) so selecting an order doesn't push the grid down. ONE SHOE PER ROW, full width (owner) — a list to tick down, not a
          row of tags; a bigger order makes the bar taller, which only happens on a click or a scan. */}
      <div className="mb-3 flex min-h-[2.25rem] flex-col gap-1.5">
        {order?.lines.map((l, i) => <ShoeChip key={`${l.code}|${i}`} line={l} scanned={ticked.has(l)} />)}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {/* --- the note: the legacy blank bar ------------------------------------------------------------------------------- */}
        <div className="min-w-[260px] flex-1">
          <label htmlFor="cust-note" className="mb-1 block text-xs font-medium text-slate-500">Note</label>
          <div className="flex gap-2">
            <input
              id="cust-note"
              value={note}
              disabled={off}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={idle ? '' : 'e.g. waiting for customer to confirm size'}
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none disabled:bg-slate-100"
            />
            <button
              type="button"
              disabled={off || !noteChanged}
              onClick={() => onNote(note)}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>

        {/* --- pack only ------------------------------------------------------------------------------------------------------ */}
        {/* A main action, so it gets a button. Toggle-styled rather than fire-and-forget because it's a STATE the order is in — you
            need to see at a glance that the selected order is already held back. There's no "un-pack": you leave it by picking a
            real courier next door, which is exactly what the operator does. */}
        <button
          type="button"
          disabled={off}
          aria-pressed={packOnly}
          onClick={() => onCourier(PACK_ONLY)}
          className={
            'rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ' +
            (packOnly
              ? 'border-amber-300 bg-amber-100 text-amber-900'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
          }
        >
          {packOnly ? 'Pack only ✓' : 'Pack only'}
        </button>

        {/* --- courier -------------------------------------------------------------------------------------------------------- */}
        <div>
          <label htmlFor="cust-courier" className="mb-1 block text-xs font-medium text-slate-500">Courier</label>
          <select
            id="cust-courier"
            value={SHIPPING.some((c) => c.code === order?.courier) ? (order!.courier as string) : ''}
            disabled={off}
            onChange={(e) => e.target.value && onCourier(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-100 disabled:opacity-60"
          >
            {/* Present whenever the stored code isn't one of the shipping services — pack-only (now the button's job), an
                unexpected value, or nothing selected. An unrecognised code is shown raw rather than silently re-labelled as
                something we do offer. */}
            {!SHIPPING.some((c) => c.code === order?.courier) && (
              <option value="">
                {packOnly ? 'Pack only' : order?.courier ? `Other (${order.courier})` : idle ? '—' : 'Not set'}
              </option>
            )}
            {SHIPPING.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>

        {/* --- label ---------------------------------------------------------------------------------------------------------- */}
        {/* NO PRINT BUTTON (owner, 2026-10-12): labels come off the scan and nothing else — clicking an order and pressing Print is
            how the wrong shoes get sent, because the scan is the check that what's in hand is what was ordered. So before a label
            exists this slot is empty, and an order whose last scan was blocked (no courier, say) is fixed and then re-scanned (see
            onScan). Once there IS a label, two controls: Reprint for a jam or a smudge, which re-fetches the SAME label and never
            buys postage twice; and Cancel label for a print made by mistake, behind a confirm because it voids the shipment. */}
        {hasLabel && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-sm font-medium text-sky-700"
              title={label ? label.printedAt.toLocaleString('en-GB') : undefined}>
              <PrinterIcon className="h-4 w-4" />
              {label
                ? <>Printed {label.printedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</>
                : 'Packed'}
              {label && label.reprints > 0 && <span className="font-normal text-slate-500">· reprinted {label.reprints}×</span>}
            </span>
            <button
              type="button"
              disabled={off}
              onClick={onPrint}
              className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40"
            >
              Reprint
            </button>
            {confirm === 'cancelLabel' ? (
              <ConfirmBox
                message="Cancel this label?"
                onYes={() => { setConfirm(null); onCancelLabel(); }}
                onNo={() => setConfirm(null)}
              />
            ) : (
              <button
                type="button"
                disabled={off}
                onClick={() => setConfirm('cancelLabel')}
                title="Printed by mistake — void the label and start this order's scans again"
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                Cancel label
              </button>
            )}
          </div>
        )}

        {/* --- Amazon order file -------------------------------------------------------------------------------------------- */}
        {/* Only on an FBA order, and on the FACE of the bar rather than behind More: an FBA order's whole outstanding job is this
            file, so when one is selected this is the button you came for. Sky, to match the FBA stripe and chip. Appearing doesn't
            move the table — it sits in the same row, and the note field beside it is what gives way. */}
        {hasFba && (
          <button
            type="button"
            disabled={off}
            onClick={onFbaFile}
            title={fileMade
              ? 'File already made — download it again (the order stays done)'
              : 'Download the Amazon order file to upload to Seller Central. Marks the order done.'}
            className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-40"
          >
            {fileMade ? 'AMZ order file again' : 'AMZ order file'}
          </button>
        )}

        {/* --- the way through to the rare three ------------------------------------------------------------------------------ */}
        {/* Quiet on purpose: a plain text button, no border, no colour. It isn't an action, it's a door — and the whole point of
            moving Waiting, FBA and Delete behind it was to stop rarely-used buttons drawing the eye on every selection. */}
        <button
          type="button"
          disabled={off}
          aria-expanded={more}
          onClick={() => { setMore(!more); setConfirm(null); }}
          className="ml-auto flex items-center gap-1 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
        >
          More
          <ChevronDownIcon className={'h-4 w-4 transition-transform ' + (more ? 'rotate-180' : '')} />
        </button>
      </div>

      {/* --- the rare three ----------------------------------------------------------------------------------------------------
          Waiting, FBA and Delete. The two that can't be undone from this screen keep their confirm step; that's the whole warning,
          there's no prose telling the operator what they already know. */}
      {more && order && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            disabled={off}
            aria-pressed={order.waiting}
            onClick={() => onWaiting(!order.waiting)}
            className={
              'rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ' +
              (order.waiting
                ? 'border-amber-300 bg-amber-100 text-amber-900'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
            }
          >
            {order.waiting ? 'Waiting ✓' : 'Waiting'}
          </button>

          {confirm === 'fba' ? (
            <ConfirmBox
              message="Send from FBA?"
              onYes={() => { setConfirm(null); onFba(); }}
              onNo={() => setConfirm(null)}
            />
          ) : (
            <button
              type="button"
              disabled={off || multiLine}
              title={multiLine ? 'FBA can only be set on a single-line order' : undefined}
              onClick={() => setConfirm('fba')}
              className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40"
            >
              Send from FBA
            </button>
          )}

          {confirm === 'delete' ? (
            <ConfirmBox
              // The line count is the one thing the confirm has to say: deleting is per-ORDER, so a multi-line order takes its
              // siblings with it and the count is what tells you that.
              message={order.lines.length === 1 ? 'Delete this order?' : `Delete all ${order.lines.length} lines?`}
              onYes={() => { setConfirm(null); onDelete(); }}
              onNo={() => setConfirm(null)}
            />
          ) : (
            <button
              type="button"
              disabled={off}
              onClick={() => setConfirm('delete')}
              className="flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              <TrashIcon className="h-4 w-4" /> Delete
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-red-700">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

/*
 * ShoeChip — one unit of the selected order in the action bar: code (bold — it's what's on the box), name, and its scan state.
 *   scanned     green with a tick
 *   to scan     white with an empty ring — what's still to find
 *   packed/FBA  done or Amazon's; not going in this box, labelled as such
 */
function ShoeChip({ line, scanned }: { line: CustomerOrderLine; scanned: boolean }) {
  const open = scannable(line);
  const tone = scanned ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
    : line.state === 'packed' ? 'border-emerald-200 bg-emerald-50/60 text-emerald-700'
    : isFba(line.state) ? 'border-sky-200 bg-sky-50 text-sky-700'
    : open ? 'border-slate-300 bg-white text-slate-700'
    : 'border-slate-200 bg-slate-50 text-slate-500';
  const status = scanned ? null
    : line.state === 'packed' ? 'Packed'
    : isFba(line.state) ? 'FBA'
    : open ? null
    : CUSTOMER_STATES[line.state].label;
  return (
    <span className={'flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-sm ' + tone}
      title={`${line.code}${line.title ? ' — ' + line.title : ''}${scanned ? ' (scanned)' : open ? ' (to scan)' : ''}`}>
      {scanned
        ? <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Scanned" />
        : open && <span className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-300" aria-label="To scan" />}
      <span className="font-semibold tabular-nums">{line.code}</span>
      {line.title && <span className="truncate opacity-75">{line.title}</span>}
      {status && <span className="shrink-0 font-medium">· {status}</span>}
    </span>
  );
}

/*
 * WeightPrompt — the whole parcel's weight in kg, asked only when a shoe in the order has no stored weight (skumap.weight). Focused
 * on arrival so the packer can put the box on the scale, type, Enter. Used for this label only; not saved back to the product.
 */
function WeightPrompt({ ordernum, message, working, onSubmit, onCancel }: {
  ordernum: string; message: string; working: boolean; onSubmit: (kg: number) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const kg = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(kg) && kg > 0 && kg <= 20;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid && !working) onSubmit(kg); }}
      className="-mt-1 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
    >
      <span className="font-medium text-amber-900">{ordernum}</span>
      <span className="text-amber-800">{message}</span>
      <input
        autoFocus
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(',', '.'))}
        placeholder="kg"
        aria-label="Parcel weight in kg"
        className="w-20 rounded-md border border-amber-300 bg-white px-2 py-1 text-sm tabular-nums focus:border-amber-500 focus:outline-none"
      />
      <span className="text-amber-800">kg</span>
      <button
        type="submit"
        disabled={!valid || working}
        className="rounded-md bg-slate-800 px-3 py-1 text-sm font-medium text-white disabled:opacity-40"
      >
        {working ? 'Printing…' : 'Print label'}
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-amber-800 hover:text-amber-950">Not now</button>
    </form>
  );
}

// Inline confirm rather than window.confirm: a native modal blocks the whole tab and reads as a browser error.
function ConfirmBox({ message, onYes, onNo }: { message: string; onYes: () => void; onNo: () => void }) {
  return (
    // nowrap on the message: if it wrapped, the confirm would grow taller than the button it replaced and shunt the table down —
    // the same flip this bar exists to avoid, just triggered by a different click.
    <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
      <span className="text-slate-700">{message}</span>
      <button type="button" onClick={onYes} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Yes</button>
      <button type="button" onClick={onNo} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">No</button>
    </span>
  );
}
