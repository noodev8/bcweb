'use client';
/*
=======================================================================================================================================
Component: CustomerOrderList
=======================================================================================================================================
Purpose: The fulfilment screen — what customers have bought, and can we send it. Ported from the legacy PowerBuilder Status screen
         (Downloads/legacy-status.png), then rebuilt (2026-10-15) around the two people who use it.

TWO JOBS, ONE SCREEN, SO TWO REGIONS (owner, 2026-10-15). The screen is used by the admin at the desk (what's sold, what's packed,
what's waiting, what needs FBA) and by the packer at the bench, scanning from a distance. The old layout served both from one pinned
stack of small controls above a per-unit grid — it gave the packer 14px text and took a third of the admin's screen. Now:

  THE BOARD   across the top: the day as stages — To pack (with the packed bar), Packed, FBA, Waiting, No stock, All — each a big
              number in ORDERS and each a filter. Replaces the old headline strip and the filter chips. No stock is a stage of its own
              now: it was the red state with no way to find it except by spotting a stripe.
  THE LIST    on the left, full height, one row PER ORDER with its shoes stacked in the row. Every action is per order (as the server
              routes are, and as the operator thinks — "chase BC18665"), so the order is the row. The old per-unit grid printed the
              ordernum once per group to fake this. Each row also carries its age and its state in words, not only the stripe.
  THE BOX     on the right, sticky: the scan box, and the order in hand in large type — its shoes ticking off, "1 of 2", the label
              printed, a refused scan in red. The same panel is the admin's detail-and-actions pane when they click a row.
  (A full-screen "bench view" of the box was built and dropped the same day — owner: not needed.)

SCAN READINESS. The scan box only works while it has the cursor: a scanner is a keyboard, so with focus in the note or the find box a
barcode types itself into THAT box. The box's strip says which it is — green "Ready" or a grey "Click to scan" (the whole strip is a
<label>, so clicking it focuses the box). A row click hands focus straight back to the scan box, so selecting an order never leaves
the bench deaf.

TWO REFRESH-SHAPED THINGS, AND THEY ARE NOT THE SAME (see the Refresh button for the full note): REFRESH here re-reads our own DB —
free, read-only, press it all day. UPDATE ORDERS in the title row calls Shopify and writes. Only the second one can make a packed
order leave the list, because that's the archive phase of the sync.

SCAN TO LABEL (docs/clickdrop-labels-plan.md, wired 2026-10-13). A scanner types the code or EAN and presses Enter, focus stays, scan
scan scan. The server resolves it to our code (/order-status-customer-scan); the OLDEST open order still needing that shoe takes it,
is selected, and the unit is ticked; a scan nothing is waiting for turns the box red and beeps, as on AMZ Shipment. When every unit of
an order is scanned, /order-status-customer-label creates the Royal Mail shipment in Click & Drop, marks the order packed (batch '2')
and returns the label PDF, which prints straight away (lib/printPdf.ts). If a shoe has no stored weight the server says WEIGHT_NEEDED
and a kg box appears for the whole parcel. The box then offers Reprint (a jam, a smudge — the SAME Click & Drop label) and Cancel
label (printed by mistake — voids it in Click & Drop and un-packs the order).
NO bcweb TABLE (owner, 2026-10-13): scan progress lives here, in this component, while the box is being filled — a reload starts the
order's scans again — and the label route checks the scanned codes cover the order before it buys postage. "Printed 10:42 /
reprinted 2×" is this session's memory only; after a reload a labelled order simply reads Packed.

DATA comes from useApiQuery (SWR). Never fetch in a useEffect — docs/maintenance-notes.md.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowPathIcon, ArrowUturnLeftIcon, CheckBadgeIcon, ChevronDownIcon, ExclamationTriangleIcon,
  MagnifyingGlassIcon, PrinterIcon, QrCodeIcon, TrashIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import { ChatBubbleLeftEllipsisIcon, CheckCircleIcon } from '@heroicons/react/24/solid';
import {
  CustomerOrderLine, CustomerOrderState, cancelCustomerLabel, deleteCustomerOrder, resetCustomerOrder, fulfilCustomerOrders, getCustomerOrderFbaFile, getCustomerOrders,
  printCustomerLabel, resolveCustomerScan, setCustomerOrderCourier, setCustomerOrderFba, setCustomerOrderNote,
  setCustomerOrderWaiting,
  setCustomerOrderDoNotOrder,
} from '@/lib/api';
import { printPdfBase64 } from '@/lib/printPdf';
import {
  COURIERS, CUSTOMER_ORDERS_KEY, CUSTOMER_STATES,
  courierShort, isFba, isOutstanding, isWaiting, orderedAt, worstCustomerState,
} from '@/lib/orderStatusUi';
import { useApiQuery } from '@/lib/useApiQuery';
import PickLink from '@/components/PickLink';
import { fulfilSummary } from '@/components/ManifestButton';

// localStorage key for the "Last order" button (see lastPacked).
const LAST_PACKED_KEY = 'customerOrders.lastPacked';

// Stable "nothing loaded yet" identity so the derived memos below aren't invalidated on every render.
const NO_LINES: CustomerOrderLine[] = [];

// Pack-only is a courier CODE on the row ('0', see COURIERS) but not a courier CHOICE on this screen — it has its own button in the
// box, so it's split out of the dropdown's options here. COURIERS stays the full list: the list's Courier column still has to render
// 'Pack', and the server still validates '0' like any other code.
const PACK_ONLY = '0';
const SHIPPING = COURIERS.filter((c) => c.code !== PACK_ONLY);

// Scanned units per order: ordernum -> code -> units scanned. Counts, not line keys, because one order can hold two identical pairs
// (two rows, same code) and either physical shoe is the right one.
type ScanMap = Map<string, Map<string, number>>;
// A printed label, per order. `reprints` is shown so a third reprint of the same order reads as "something's wrong with the printer".
interface LabelInfo { printedAt: Date; reprints: number }

// One order: the unit of the list, of every action, and of the board's counts.
interface OrderGroup {
  ordernum: string; lines: CustomerOrderLine[]; state: CustomerOrderState;
  customer: string | null; postcode: string | null; courier: string | null; note: string; waiting: boolean;
  created: string;   // the EARLIEST line's — when the customer first ordered, for the age
}

// The board's stages. They overlap on purpose (a No stock order is also To pack); each answers its own question, and `all` is the
// only one that counts everything.
type Stage = 'all' | 'topack' | 'packed' | 'fba' | 'waiting' | 'nostock';

// Can this line still take a scan? Open = still on our packing job (isOutstanding, which includes 'Do not order' — owner, 2026-10-15:
// "do not order DOES NOT MEAN do not pack") — PLUS Waiting (owner, 2026-10-12): Waiting is set aside on the customer's say-so, not
// unpackable, so when the shoe is in hand it scans and packs like any other. It stays out of isOutstanding (the To pack count and
// bar), which is a different question. FBA too (owner, 2026-10-15): if the shoe is here it packs, and the line reads Packed — as it
// already does once its Amazon file is made. The only refusals are pack only, already packed, and not all scanned.
const scannable = (l: CustomerOrderLine) => isOutstanding(l.state) || isWaiting(l.state) || isFba(l.state);

// The order-level tests behind the board. `toPack` and `packed` are the old headline's rules, unchanged: an order is left to do while
// any line is outstanding, and done once none is and a non-FBA line is packed. FBA and Waiting lines are in neither half.
const orderToPack = (o: OrderGroup) => o.lines.some((l) => isOutstanding(l.state));
const orderPacked = (o: OrderGroup) => !orderToPack(o) && o.lines.some((l) => l.state === 'packed' && l.fba === 0);
function inStage(o: OrderGroup, s: Stage): boolean {
  switch (s) {
    case 'topack':  return orderToPack(o);
    case 'packed':  return orderPacked(o);
    case 'fba':     return o.lines.some((l) => isFba(l.state));
    case 'waiting': return o.lines.some((l) => isWaiting(l.state));
    case 'nostock': return o.lines.some((l) => l.state === 'no_stock');
    default:        return true;
  }
}

// Calendar days since 'YYYYMMDD HH24:MI:SS' (Europe/London, which is the bench's clock too). Calendar days, not 24h blocks: an order
// from 23:50 last night is "1d" this morning, which is how the bench counts it.
function ageDays(created: string): number | null {
  const m = (created || '').match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / 86400000);
}

// Why an order can't have a label, or null if it can. The plan's refusals that the list payload can see; non-GB country is checked
// server-side once the route exists (country isn't on the line).
function labelBlock(o: { courier: string | null; postcode: string | null }): string | null {
  if (o.courier === PACK_ONLY) return 'Pack only — no label';
  if (!SHIPPING.some((c) => c.code === o.courier)) return 'Choose a courier first';
  if (!o.postcode?.trim()) return 'No postcode on this order';
  return null;
}

// Same two low beeps as AMZ Shipment's refused scan, so the bench learns one sound for "no". Failures (no audio device, autoplay
// policy before the first click) are ignored — the red box still says it.
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

function readStored(key: string): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* not remembered across a reload; fine */ }
}

export default function CustomerOrderList() {
  // Same SWR key the module home uses to headline the counts. SWR dedupes by key, so the two call sites share one request and one
  // cache entry — which is why this component doesn't report its counts upward through a prop.
  const { data, error: loadError, isLoading, busy, refresh } = useApiQuery(
    CUSTOMER_ORDERS_KEY,
    () => getCustomerOrders(),
  );

  const lines = data?.lines ?? NO_LINES;
  const truncated = data?.truncated ?? false;

  const [selected, setSelected] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('all');
  const [term, setTerm] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  // The outcome of an order's own Fulfil button, shown in that order's box.
  const [fulfilNote, setFulfilNote] = useState<{ ordernum: string; ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState(false);

  // --- scan to label (see the header: scans live here, the label lives in Click & Drop) -----------------------------------------
  const [scan, setScan] = useState('');
  const [scanFocused, setScanFocused] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scans, setScans] = useState<ScanMap>(() => new Map());
  const [labels, setLabels] = useState<Map<string, LabelInfo>>(() => new Map());
  // The label that just came off the printer, for the box's green "Label printed" moment. Cleared by the next scan.
  const [printed, setPrinted] = useState<{ ordernum: string; reprint: boolean } | null>(null);
  // The order waiting on a typed parcel weight (the server said WEIGHT_NEEDED), with the server's message naming the shoes.
  const [weightAsk, setWeightAsk] = useState<{ ordernum: string; message: string } | null>(null);
  // The parcel weight already typed for an order this session. ONE weight per order — the packed box, all pairs in it (owner,
  // 2026-10-15) — so a retry after a failed print, or a re-scan of one of its shoes, reuses it instead of asking again.
  const weights = useRef<Map<string, number>>(new Map());
  // The last order THIS packer labelled, for the "Last order" button — a click elsewhere loses the selection, and this brings it back.
  // Kept in localStorage so it survives a refresh; per browser, not shared (each bench has its own last box).
  const [lastPacked, setLastPacked] = useState<string | null>(() => readStored(LAST_PACKED_KEY));
  const rememberPacked = (ordernum: string) => {
    setLastPacked(ordernum);
    writeStored(LAST_PACKED_KEY, ordernum);
  };
  const scanRef = useRef<HTMLInputElement | null>(null);
  // The board sticks to the top of the window (owner, 2026-10-15: the numbers stay in sight while scrolling), so the sticky box and
  // the table heading must stick BELOW it. Its height changes (tiles wrap, the No stock / FBA / Waiting tiles come and go), so it is
  // measured and handed down as --board-h rather than guessed.
  const [boardH, setBoardH] = useState(0);
  const boardObserver = useRef<ResizeObserver | null>(null);
  const boardRef = useCallback((el: HTMLDivElement | null) => {
    boardObserver.current?.disconnect();
    boardObserver.current = null;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoardH(el.offsetHeight));
    ro.observe(el);
    boardObserver.current = ro;
  }, []);
  // Scans arrive faster than the server answers, so they run one at a time through this chain, and read the latest scans from a
  // ref rather than a render's closure — two quick scans of a 2-pair order must tick two units, not the same one twice.
  const scanQueue = useRef<Promise<void>>(Promise.resolve());
  const scansRef = useRef(scans);
  const updateScans = (next: ScanMap) => { scansRef.current = next; setScans(next); };

  // --- derived -----------------------------------------------------------------------------------------------------------------

  // Per-order roll-up, computed once: the row of the list, and everything the box needs. Insertion order is the server's order.
  const orders = useMemo(() => {
    const map = new Map<string, OrderGroup>();
    for (const l of lines) {
      let o = map.get(l.ordernum);
      if (!o) {
        // Placeholder state only — overwritten by the worstCustomerState roll-up once every line of the group has been collected.
        o = { ordernum: l.ordernum, lines: [], state: 'pending', customer: l.customer, postcode: l.postcode,
              courier: l.courier, note: '', waiting: false, created: l.created };
        map.set(l.ordernum, o);
      }
      // ONE LINE PER SHOE (owner, 2026-10-19, BC19335: "dont STACK them just cause they're the same size"). A customer row can carry
      // qty 2; it's split into qty-1 lines here so each pair shows as its own row and takes its own scan, like two rows of one code.
      for (let k = 0; k < Math.max(l.qty, 1); k++) o.lines.push({ ...l, qty: 1 });
      if (l.created < o.created) o.created = l.created;
      // First non-empty note in the group wins. Writes fan out across every line, so they normally agree — this only matters for
      // orders PowerBuilder noted line-by-line before this screen existed.
      if (!o.note && l.note) o.note = l.note;
      if (l.state === 'waiting') o.waiting = true;
    }
    for (const o of map.values()) o.state = worstCustomerState(o.lines.map((l) => l.state));
    return map;
  }, [lines]);

  // The board, in ORDERS — one order is one box and one label, which is how the bench counts what's left.
  const counts = useMemo(() => {
    const c: Record<Stage, number> = { all: 0, topack: 0, packed: 0, fba: 0, waiting: 0, nostock: 0 };
    for (const o of orders.values()) {
      for (const s of Object.keys(c) as Stage[]) if (inStage(o, s)) c[s] += 1;
    }
    return c;
  }, [orders]);

  // Search spans everything you'd have in your hand when looking an order up: the order number off a picking note, the customer's
  // name off an email, a postcode off a label, or the SKU / name of any shoe in it. Case-insensitive substring, no term parsing.
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return [...orders.values()].filter((o) => {
      if (!inStage(o, stage)) return false;
      if (!q) return true;
      return (
        o.ordernum.toLowerCase().includes(q) ||
        (o.customer || '').toLowerCase().includes(q) ||
        (o.postcode || '').toLowerCase().includes(q) ||
        o.lines.some((l) => l.code.toLowerCase().includes(q) || (l.title || '').toLowerCase().includes(q))
      );
    });
  }, [orders, stage, term]);

  const active = selected ? orders.get(selected) ?? null : null;
  const orderPackedNum = (ordernum: string) => { const o = orders.get(ordernum); return !!o && orderPacked(o); };

  // Which LINES carry a scan tick, and each order's n-of-m. Ticks go on the first n scannable lines of each code in the order, so two
  // identical pairs fill in one at a time. Lines that aren't scannable (already packed) are out of the count entirely —
  // they aren't going in this box.
  const scanState = useMemo(() => {
    const ticked = new Set<CustomerOrderLine>();
    const progress = new Map<string, { scanned: number; total: number }>();
    for (const o of orders.values()) {
      const done = scans.get(o.ordernum);
      const used = new Map<string, number>();
      const p = { scanned: 0, total: 0 };
      for (const l of o.lines) {
        if (!scannable(l)) continue;
        p.total += l.qty;
        const n = used.get(l.code) ?? 0;
        if (n < (done?.get(l.code) ?? 0)) { ticked.add(l); p.scanned += l.qty; used.set(l.code, n + 1); }
      }
      progress.set(o.ordernum, p);
    }
    return { ticked, progress };
  }, [orders, scans]);

  // The list as of the last render, for a queued scan: it may run after a print has refreshed the list, and must see the order as it
  // is now (Packed), not as it was when Enter was pressed.
  const latest = useRef({ orders, labels, lines });
  useEffect(() => { latest.current = { orders, labels, lines }; }, [orders, labels, lines]);

  // Select an order and bring its row into view, clearing a stage or search that would hide it. Used by a scan and by Last order.
  function reveal(ordernum: string) {
    setStage('all');
    setTerm('');
    setSelected(ordernum);
    requestAnimationFrame(() => document.getElementById(`order-${ordernum}`)?.scrollIntoView({ block: 'center' }));
  }

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

  // One order's Fulfil (owner, 2026-10-20: one at a time while it's tested). Writes nothing here — Shopify only — so no refresh: the
  // order stays on the list as Packed until Update orders sees it fulfilled and archives it. A second press reads "already fulfilled".
  async function fulfilOne(ordernum: string) {
    setWorking(true);
    setActionError(null);
    setFulfilNote(null);
    const res = await fulfilCustomerOrders(ordernum);
    setWorking(false);
    if (!res.success || !res.data) {
      setActionError(res.error || 'Fulfill didn’t go through');
      return;
    }
    setFulfilNote({ ordernum, ...fulfilSummary(res.data) });
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
    const weightKg = opts.weightKg ?? weights.current.get(ordernum);
    let res: Awaited<ReturnType<typeof printCustomerLabel>>;
    try {
      res = await printCustomerLabel(ordernum, opts.reprint ? { reprint: true } : { codes: scannedCodes(ordernum), weightKg });
    } catch {
      // A dropped connection: the label may or may not have been made. Re-read the list (a made one shows Packed, which hides the
      // weight prompt); otherwise the next scan retries with the weight already typed.
      setWorking(false);
      setActionError('Lost the connection while printing — check the order, re-scan a shoe to try again');
      beepError();
      await refresh();
      return;
    }
    setWorking(false);
    if (!res.success || !res.data) {
      if (res.return_code === 'WEIGHT_NEEDED') {
        // A group order's message is ours, not the server's: one weight for the whole packed box, never one per shoe.
        const o = latest.current.orders.get(ordernum);
        const units = o ? o.lines.reduce((n, l) => n + (scannable(l) ? l.qty : 0), 0) : 0;
        setWeightAsk({
          ordernum,
          message: units > 1
            ? `${units} pairs in one parcel — weigh the packed box with them all in, and enter that one weight`
            : res.error || 'No stored weight — weigh the parcel',
        });
        return;
      }
      // Already packed (elsewhere, or by an attempt whose reply was lost): nothing to weigh any more.
      if (res.return_code === 'NOTHING_TO_PACK') setWeightAsk(null);
      setActionError(res.error || 'The label didn’t print');
      beepError();
      return;
    }
    setWeightAsk(null);
    weights.current.delete(ordernum);
    printPdfBase64(res.data.pdf, refocusScan);
    rememberPacked(ordernum);
    setPrinted({ ordernum, reprint: !!res.data.reprint });
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

  // Voids the Click & Drop order (refused once Royal Mail has manifested it — the error shows in the box) and un-packs the order.
  // Its scans clear with it, so the packer starts the order again from the first shoe rather than half-way through a box they may
  // have just unpacked.
  async function cancelLabel(ordernum: string) {
    const ok = await run(() => cancelCustomerLabel(ordernum));
    if (!ok) return;
    setLabels((prev) => { const next = new Map(prev); next.delete(ordernum); return next; });
    setPrinted(null);
    weights.current.delete(ordernum);
    const next = new Map(scansRef.current);
    next.delete(ordernum);
    updateScans(next);
  }

  // Drop every other order's scans (ONE ORDER AT A TIME, see handleScan). Silently — no note when a part-scanned order is dropped
  // (owner, 2026-10-15).
  function keepOnly(ordernum: string) {
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
      setPrinted(null);
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
      if (!best || o.created < best.created) best = { ordernum: o.ordernum, created: o.created };
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
        setPrinted(null);
        setSelected(retry.ordernum);
        const block = labelBlock(retry);
        if (block) { setActionError(`All scanned, but no label: ${block}`); beepError(); }
        else await printLabel(retry.ordernum);
        return;
      }

      // Three different "no"s, worded apart so the packer knows whether to look for a mistake or put the shoe back: no order wants
      // it at all, every order that wants it is already scanned, or the only orders for it aren't open (already packed).
      const hits = lines.filter((l) => l.code.toUpperCase() === code);
      setPrinted(null);
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
    setPrinted(null);
    // The order must be on screen: drop a stage or search that would hide it, then bring its row into view.
    reveal(o.ordernum);

    // Last shoe in: print straight away, no click — the packer's hands are full. A blocked order says why in the box instead.
    const p = { scanned: 0, total: 0 };
    for (const l of o.lines) if (scannable(l)) p.total += l.qty;
    for (const n of perCode.values()) p.scanned += n;
    if (p.scanned >= p.total) {
      const block = labelBlock(o);
      if (block) setActionError(`All scanned, but no label: ${block}`);
      else await printLabel(o.ordernum);
    }
  }

  // The parcel weight typed in after WEIGHT_NEEDED. Whole order, kg, this label only. The modal closes the moment the weight is
  // entered (owner, 2026-10-22) — before, it stayed up whenever the print then failed. The weight is kept, so if the label doesn't
  // print, re-scanning a shoe retries with it rather than asking again; only a fresh WEIGHT_NEEDED brings the modal back.
  async function submitWeight(kg: number) {
    if (!weightAsk) return;
    const { ordernum } = weightAsk;
    weights.current.set(ordernum, kg);
    setWeightAsk(null);
    await printLabel(ordernum, { weightKg: kg });
  }

  // --- render ------------------------------------------------------------------------------------------------------------------

  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (loadError) return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>;

  const progress = active ? scanState.progress.get(active.ordernum) ?? null : null;
  const justPrinted = printed && active && printed.ordernum === active.ordernum ? printed : null;
  const finished = counts.topack === 0;
  const packedPct = counts.topack + counts.packed > 0 ? Math.round((counts.packed / (counts.topack + counts.packed)) * 100) : 0;
  const lastAvailable = !!lastPacked && orders.has(lastPacked);

  // The box's border says what just happened, before a word is read: red for a refused scan, green for a label off the printer.
  const boxTone = scanError ? 'border-red-500' : justPrinted ? 'border-emerald-500' : active ? 'border-brand-500/50' : 'border-slate-200';

  return (
    <div style={{ '--board-h': `${boardH}px` } as CSSProperties}>
      {/* --- the board ---------------------------------------------------------------------------------------------------------
          The day as stages, in ORDERS, each a filter. To pack leads and carries the packed bar; at zero it goes green and says All
          packed — the end of the job is worth seeing. FBA, Waiting and No stock appear only when there are some: each is an
          exception, so the tile appearing IS the reminder, where a permanent "0" would be noise you'd learn to look past. */}
      {/* Sticky, on the page's own background so rows scroll out of sight beneath it. The margin is inside it (pb-4, not mb-4) so the
          gap travels with it and the box and table heading below sit flush under its measured height. */}
      <div ref={boardRef} className="sticky top-0 z-30 flex flex-wrap items-stretch gap-2 bg-slate-100 pb-4 pt-3">
        <button
          type="button"
          onClick={() => setStage(stage === 'topack' ? 'all' : 'topack')}
          aria-pressed={stage === 'topack'}
          className={'flex min-w-[280px] flex-[2] items-center gap-4 rounded-xl border-2 px-4 py-3 text-left transition ' +
            (finished ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300') +
            (stage === 'topack' ? ' ring-2 ring-slate-800 ring-offset-1' : '')}
        >
          {finished ? (
            <span className="flex items-center gap-2 text-2xl font-bold text-emerald-700">
              <CheckCircleIcon className="h-8 w-8" />All packed
            </span>
          ) : (
            <span className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums leading-none text-slate-900">{counts.topack}</span>
              <span className="text-sm font-semibold text-slate-700">to pack</span>
            </span>
          )}
          <span
            className="flex min-w-0 flex-1 flex-col gap-1"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={counts.topack + counts.packed}
            aria-valuenow={counts.packed}
            aria-label={`${counts.packed} of ${counts.topack + counts.packed} orders packed`}
          >
            <span className="h-2.5 overflow-hidden rounded-full bg-slate-200">
              <span
                className={'block h-full rounded-full transition-[width] duration-700 ease-out ' + (finished ? 'bg-emerald-500' : 'bg-emerald-400')}
                style={{ width: `${packedPct}%` }}
              />
            </span>
            <span className="text-xs font-medium tabular-nums text-slate-500">
              {counts.packed} of {counts.topack + counts.packed} packed
            </span>
          </span>
        </button>

        <StageTile label="Packed" count={counts.packed} tone="emerald" active={stage === 'packed'}
          onClick={() => setStage(stage === 'packed' ? 'all' : 'packed')} />
        {counts.nostock > 0 && (
          <StageTile label="No stock" count={counts.nostock} tone="red" active={stage === 'nostock'}
            onClick={() => setStage(stage === 'nostock' ? 'all' : 'nostock')} />
        )}
        {counts.fba > 0 && (
          <StageTile label="FBA to send" count={counts.fba} tone="sky" active={stage === 'fba'}
            onClick={() => setStage(stage === 'fba' ? 'all' : 'fba')} />
        )}
        {counts.waiting > 0 && (
          <StageTile label="Waiting" count={counts.waiting} tone="amber" active={stage === 'waiting'}
            onClick={() => setStage(stage === 'waiting' ? 'all' : 'waiting')} />
        )}
        <StageTile label="All orders" count={counts.all} tone="slate" active={stage === 'all'} onClick={() => setStage('all')} />
        {/* Shelf picks still to do — a link to /pick, not a filter (owner, 2026-10-15: same vibe as the board's numbers). */}
        <PickLink />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,440px)]">
        {/* --- the box ---------------------------------------------------------------------------------------------------------
            First in the DOM so it stacks ABOVE the list on a narrow screen (the bench needs it more than the list); placed right
            from lg up. Sticky so it stays beside whatever row you've scrolled to. */}
        <aside className="lg:sticky lg:top-[var(--board-h)] lg:order-2 lg:max-h-[calc(100vh-var(--board-h)-0.75rem)] lg:self-start lg:overflow-y-auto">
          <div className={'overflow-hidden rounded-xl border-2 bg-white transition-colors ' + boxTone}>
            {/* --- scan strip: readiness first ----------------------------------------------------------------------------------
                A <label>, so a click anywhere on the strip puts the cursor in the box. */}
            <label
              htmlFor={SCAN_INPUT_ID}
              className={'flex cursor-text items-center gap-3 border-b px-4 py-3 ' +
                (scanError ? 'border-red-200 bg-red-50' : scanFocused ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-100')}
            >
              <span className={'relative flex shrink-0 h-3 w-3'}>
                {scanFocused && !scanError && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
                )}
                <span className={'relative inline-flex h-full w-full rounded-full ' +
                  (scanError ? 'bg-red-500' : scanFocused ? 'bg-emerald-500' : 'bg-slate-400')} />
              </span>
              <QrCodeIcon className={'shrink-0 h-5 w-5 ' +
                (scanError ? 'text-red-500' : scanFocused ? 'text-emerald-600' : 'text-slate-400')} />
              <input
                ref={scanRef}
                id={SCAN_INPUT_ID}
                // Focused on arrival: the first thing done on this screen is pick up a shoe and scan it, no click first. It mounts with
                // the list (after the loading render), so autoFocus fires once the list is there.
                autoFocus
                value={scan}
                onChange={(e) => setScan(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(); } }}
                onFocus={() => setScanFocused(true)}
                onBlur={() => setScanFocused(false)}
                placeholder={scanFocused ? 'Scan a shoe' : 'Click here to scan'}
                aria-label="Scan a shoe"
                aria-invalid={!!scanError}
                autoComplete="off"
                className={'min-w-0 flex-1 bg-transparent font-semibold uppercase tracking-wide text-slate-900 placeholder:font-medium placeholder:normal-case placeholder:tracking-normal focus:outline-none ' +
                  'text-lg ' +
                  (scanFocused ? 'placeholder:text-emerald-700/60' : 'placeholder:text-slate-500')}
              />
              <span className={'shrink-0 font-semibold text-sm ' +
                (scanError ? 'text-red-700' : scanFocused ? 'text-emerald-700' : 'text-slate-500')}>
                {scanFocused ? 'Ready' : 'Not ready'}
              </span>
            </label>

            {/* --- what just happened: one banner, the loudest thing in the box -------------------------------------------------- */}
            {scanError ? (
              <div className={'flex items-start gap-3 bg-red-600 px-5 text-white py-4'} role="alert">
                <ExclamationTriangleIcon className={'shrink-0 h-7 w-7'} />
                <p className={'font-semibold leading-snug text-lg'}>{scanError}</p>
              </div>
            ) : justPrinted ? (
              <div className={'flex items-center gap-3 bg-emerald-600 px-5 text-white py-4'} role="status">
                <PrinterIcon className={'shrink-0 h-7 w-7'} />
                <p className={'font-semibold text-xl'}>
                  {justPrinted.reprint ? 'Label reprinted' : 'Label printed'}
                </p>
              </div>
            ) : null}

            <div className="p-4">
              {/* The parcel weight: one, for the whole packed box (a group order always; a single pair only when it has none stored).
                  A full-screen modal (owner, 2026-10-22: the inline box was easy to miss). Enter prints and closes it; Cancel (or Esc)
                  leaves the order fully scanned, so re-scanning any of its shoes asks again. Gone once the order is packed or labelled. */}
              {weightAsk && !labels.has(weightAsk.ordernum) && !orderPackedNum(weightAsk.ordernum) && (
                <WeightPrompt
                  // Not the bare ordernum: the OrderBox beside it is keyed by that, and a shared key left the modal on screen after Cancel.
                  key={`weight-${weightAsk.ordernum}`}
                  ordernum={weightAsk.ordernum}
                  message={weightAsk.message}
                  onSubmit={submitWeight}
                  onCancel={() => { setWeightAsk(null); scanRef.current?.focus(); }}
                />
              )}

              {active ? (
                <OrderBox
                  key={active.ordernum}
                  order={active}
                  progress={progress}
                  ticked={scanState.ticked}
                  label={labels.get(active.ordernum) ?? null}
                  working={working}
                  error={actionError}
                  fulfilNote={fulfilNote?.ordernum === active.ordernum ? fulfilNote : null}
                  onClose={() => { setSelected(null); setActionError(null); setFulfilNote(null); scanRef.current?.focus(); }}
                  onNote={(note) => run(() => setCustomerOrderNote(active.ordernum, note))}
                  onWaiting={(w) => run(() => setCustomerOrderWaiting(active.ordernum, w))}
                  onDoNotOrder={(d) => run(() => setCustomerOrderDoNotOrder(active.ordernum, d))}
                  onCourier={(c) => run(() => setCustomerOrderCourier(active.ordernum, c))}
                  // Flag it, then hand over the Amazon file straight away — flagging alone leaves the order sitting there until somebody
                  // uploads the file to Seller Central, so the two are one job and the operator expects the file from this click (owner).
                  onFba={async () => {
                    if (await run(() => setCustomerOrderFba(active.ordernum))) await downloadFbaFile(active.ordernum);
                  }}
                  onFbaFile={() => downloadFbaFile(active.ordernum)}
                  onDelete={async () => { if (await run(() => deleteCustomerOrder(active.ordernum))) setSelected(null); }}
                  onReset={() => run(() => resetCustomerOrder(active.ordernum))}
                  // Each label action hands focus back to the scan box: the next thing the packer does is scan the next shoe.
                  onPrint={() => printLabel(active.ordernum, { reprint: true })}
                  onCancelLabel={async () => { await cancelLabel(active.ordernum); scanRef.current?.focus(); }}
                  onFulfil={() => fulfilOne(active.ordernum)}
                />
              ) : (
                // Nothing in hand. Says what to do next, in the box's own size, and offers the way back to the last box — the
                // click off it that wasn't meant (owner, 2026-10-13).
                <div className={'flex flex-col items-center text-center gap-3 py-8'}>
                  <p className={'font-semibold text-slate-400 text-lg'}>
                    {finished ? 'Nothing left to pack' : 'Scan a shoe to start a box'}
                  </p>
                  <p className="text-sm text-slate-400">or click an order in the list</p>
                  {actionError && <p className="text-sm text-red-700">{actionError}</p>}
                  <button
                    type="button"
                    onClick={() => {
                      if (!lastPacked) return;
                      reveal(lastPacked);
                      setActionError(null);
                      scanRef.current?.focus();
                    }}
                    disabled={!lastAvailable}
                    title={lastPacked ? `Select ${lastPacked}, the last order you printed a label for` : 'No label printed yet'}
                    className={'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 ' +
                      'px-3 py-1.5 text-sm'}
                  >
                    <ArrowUturnLeftIcon className="h-4 w-4" />
                    {lastAvailable ? `Back to ${lastPacked}` : 'Last order'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* --- the list --------------------------------------------------------------------------------------------------------- */}
          <section className="min-w-0 lg:order-1">
            <div className="mb-3 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                {/* Forced UPPERCASE, like the Pricing and Inventory find boxes (owner) — order numbers and SKUs are uppercase, so typing
                    matches what's on the screen. Purely cosmetic to the filter: `shown` lowercases both sides. */}
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value.toUpperCase())}
                  placeholder="Find an order, customer, postcode or shoe"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm uppercase placeholder:normal-case placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
                />
                {term && (
                  <button type="button" onClick={() => setTerm('')} aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700">
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
              {/* REFRESH, as the find box's partner: both are about what the list is SHOWING, neither changes anything. It re-reads
                  OUR database and nothing else — one query, no Shopify call, no writes — so it's an icon, quiet, press it all day. It
                  shows the team's progress in our own DB (notes, courier, Waiting, the localstock allocation PowerBuilder writes as
                  things are picked) but does NOT make a packed order leave the list: that's the sync's archive phase, so it needs
                  Update orders in the title row (or the cron run). */}
              <button
                type="button"
                onClick={async () => { await refresh(); scanRef.current?.focus(); }}
                disabled={busy}
                title="Re-read the list (doesn't contact Shopify)"
                aria-label="Refresh the list"
                className="flex w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 disabled:opacity-60"
              >
                <ArrowPathIcon className={'h-4 w-4 ' + (busy ? 'animate-spin' : '')} />
              </button>
            </div>

            {truncated && (
              <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Showing the first {lines.length} lines — there are more. Narrow it down with the search box.
              </div>
            )}

            {/* `overflow-x-auto` makes this a scroll container, which would pin the sticky heading to a box that never scrolls; from lg
                up the table fits, so the scroller is dropped and the heading sticks to the window. */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white lg:overflow-visible">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead className="sticky top-[var(--board-h)] z-10 bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="w-1.5 p-0" aria-label="Status" />
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-2 py-2 font-medium">Shoes</th>
                    <th className="px-2 py-2 font-medium">Customer</th>
                    <th className="px-2 py-2 text-right font-medium">Age</th>
                    <th className="px-2 py-2 font-medium">Courier</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((o) => {
                    const isSelected = selected === o.ordernum;
                    const s = CUSTOMER_STATES[o.state];
                    const age = ageDays(o.created);
                    // Old and still ours to do: the order the admin should be asking about.
                    const stale = age !== null && age >= 2 && orderToPack(o);
                    return (
                      <tr
                        key={o.ordernum}
                        id={`order-${o.ordernum}`}
                        // Selecting an order hands the cursor straight back to the scan box, so a click never leaves the bench deaf.
                        onClick={() => { setSelected(isSelected ? null : o.ordernum); setActionError(null); scanRef.current?.focus(); }}
                        className={
                          'cursor-pointer border-b border-slate-100 align-top last:border-b-0 ' +
                          // Whole-row washes for the orders that have LEFT the packing job — done (green), set aside (amber),
                          // Amazon's (sky) — so what's left to pack is the white that remains. Selection wins.
                          (isSelected ? 'bg-brand-100/70'
                            : o.state === 'packed' ? 'bg-emerald-50/70 hover:bg-emerald-100/70'
                            : isWaiting(o.state) ? 'bg-amber-50/70 hover:bg-amber-100/70'
                            : isFba(o.state) ? 'bg-sky-50 hover:bg-sky-100/70'
                            : 'hover:bg-slate-50')
                        }
                      >
                        <td className={'w-1.5 p-0 ' + s.stripe} />
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="flex items-center gap-1.5 font-semibold tabular-nums text-slate-900">
                            {o.ordernum}
                            {o.note && (
                              // `title` makes heroicons render a real <svg><title>, which is what gives the hover; aria-hidden={false}
                              // so the note is announced — this icon carries information.
                              <ChatBubbleLeftEllipsisIcon
                                className="h-3.5 w-3.5 shrink-0 text-amber-500"
                                title={`Note: ${o.note}`}
                                titleId={`note-${o.ordernum}`}
                                aria-hidden={false}
                              />
                            )}
                          </span>
                          {o.note && <span className="block max-w-[160px] truncate text-xs text-amber-700" title={o.note}>{o.note}</span>}
                        </td>
                        <td className="px-2 py-2">
                          <ul className="flex flex-col gap-0.5">
                            {o.lines.map((l, i) => {
                              const ticked = scanState.ticked.has(l);
                              return (
                                <li key={`${l.code}|${i}`} className="flex min-w-0 items-center gap-1.5" title={[l.title, l.supplier].filter(Boolean).join(' · ') || l.code}>
                                  {ticked && <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Scanned" />}
                                  <span className={'whitespace-nowrap tabular-nums ' + (ticked ? 'font-semibold text-emerald-700' : 'font-medium text-slate-700')}>
                                    {l.code}{l.qty > 1 && <span className="text-slate-400"> ×{l.qty}</span>}
                                  </span>
                                  <span className="min-w-0 truncate text-xs text-slate-400">{l.title}</span>
                                  {/* A line whose state differs from the order's says so — "one pair packed, one on the shelf" is
                                      the thing the order-level roll-up hides. */}
                                  {l.state !== o.state && l.state !== 'pending' && (
                                    <span className={'shrink-0 rounded px-1 text-[11px] font-medium ring-1 ring-inset ' + CUSTOMER_STATES[l.state].pill}>
                                      {CUSTOMER_STATES[l.state].label}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                        <td className="max-w-[180px] px-2 py-2">
                          <span className="block truncate text-slate-700">{o.customer || '—'}</span>
                          <span className="block text-xs text-slate-400">{o.postcode || '—'}</span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums" title={`Ordered ${orderedAt(o.created)}`}>
                          <span className={stale ? 'rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800' : 'text-slate-500'}>
                            {age === null ? '—' : age === 0 ? 'Today' : `${age}d`}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-500">{courierShort(o.courier)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className={'rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ' + s.pill}>{s.label}</span>
                          {/* A label printed this session, until the server's Packed catches up. */}
                          {labels.has(o.ordernum) && o.state !== 'packed' && (
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
                <p className="px-3 py-10 text-center text-sm text-slate-400">
                  {orders.size === 0 ? 'No customer orders to fulfill.' : 'No orders match. Clear the search or pick All orders.'}
                </p>
              )}
            </div>

            <p className="mt-2 text-xs text-slate-400">
              {shown.length === orders.size
                ? `${orders.size} order${orders.size === 1 ? '' : 's'}, ${lines.length} pair${lines.length === 1 ? '' : 's'}`
                : `${shown.length} of ${orders.size} orders`}
              {busy && ' · refreshing…'}
            </p>
          </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * StageTile — one stage on the board: a big number and its name, and a filter. `tone` is spelled out per stage rather than passed as
 * classes, so the next stage that wants a colour has to justify it here; each matches its row wash / stripe.
 */
const TILE_TONES = {
  slate:   { idle: 'border-slate-200 bg-white',      num: 'text-slate-900',   label: 'text-slate-500' },
  emerald: { idle: 'border-emerald-200 bg-white',    num: 'text-emerald-700', label: 'text-emerald-700/80' },
  red:     { idle: 'border-red-300 bg-red-50',       num: 'text-red-700',     label: 'text-red-700' },
  sky:     { idle: 'border-sky-200 bg-sky-50',       num: 'text-sky-700',     label: 'text-sky-700' },
  amber:   { idle: 'border-amber-200 bg-amber-50',   num: 'text-amber-700',   label: 'text-amber-800' },
} as const;

function StageTile({ label, count, tone, active, onClick }: {
  label: string; count: number; tone: keyof typeof TILE_TONES; active: boolean; onClick: () => void;
}) {
  const t = TILE_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={'flex min-w-[96px] flex-1 flex-col justify-center rounded-xl border-2 px-4 py-2 text-left transition hover:brightness-[0.98] ' +
        t.idle + (active ? ' ring-2 ring-slate-800 ring-offset-1' : '')}
    >
      <span className={'text-2xl font-bold tabular-nums leading-tight ' + t.num}>{count}</span>
      <span className={'text-xs font-semibold ' + t.label}>{label}</span>
    </button>
  );
}

/*
 * OrderBox — the order in hand, in the box. The packer's half on top (the order number, the shoes ticking off, n of m, in type sized
 * to read from the bench) and the admin's half under it (note, Pack only, courier, label, More). Keyed on ordernum by the caller, so its own
 * state — the note being typed, a half-answered confirm, More left open — never carries across to a different order; arming
 * "Delete?" on one order and then clicking another must not leave the confirm standing against the new one.
 *
 * ACTIONS ARE RANKED BY HOW OFTEN THEY'RE USED (owner's calls): Note, Pack only and Courier always on show; Waiting, Send from FBA and
 * Delete behind More. PACK ONLY is its own button, not a courier option: it's the decision NOT to ship yet, and it still writes the
 * same courier='0'.
 *
 * NO PRINT BUTTON (owner, 2026-10-12): labels come off the scan and nothing else — the scan is the check that what's in hand is what
 * was ordered. An order whose last scan was blocked (no courier, say) is fixed and then re-scanned. Once there IS a label: Reprint
 * (same label, never buys postage twice) and Cancel label (behind a confirm, voids the shipment).
 */
function OrderBox({
  order, progress, ticked, label, working, error, fulfilNote,
  onClose, onNote, onWaiting, onDoNotOrder, onCourier, onFba, onFbaFile, onDelete, onReset, onPrint, onCancelLabel, onFulfil,
}: {
  order: OrderGroup;
  progress: { scanned: number; total: number } | null;
  ticked: Set<CustomerOrderLine>;
  label: LabelInfo | null;
  working: boolean;
  error: string | null;
  fulfilNote: { ok: boolean; text: string } | null;
  onClose: () => void;
  onNote: (note: string) => void;
  onWaiting: (w: boolean) => void;
  onDoNotOrder: (d: boolean) => void;
  onCourier: (c: string) => void;
  onFba: () => void;
  onFbaFile: () => void;
  onDelete: () => void;
  onReset: () => void;
  onPrint: () => void;
  onCancelLabel: () => void;
  onFulfil: () => void;
}) {
  const [note, setNote] = useState(order.note);
  const [confirm, setConfirm] = useState<'fba' | 'delete' | 'reset' | 'cancelLabel' | 'fulfil' | null>(null);
  const [more, setMore] = useState(false);

  const multiLine = order.lines.length > 1;
  const noteChanged = note.trim() !== order.note.trim();
  const packOnly = order.courier === PACK_ONLY;
  // Keyed on the amz count, not the state: once the file is made the line reads Packed, and the button must stay so a lost or failed
  // upload can be re-downloaded (the server keeps the first file's stamp). `fileMade` only changes the wording.
  const hasFba = order.lines.some((l) => l.fba > 0);
  const fileMade = hasFba && !order.lines.some((l) => isFba(l.state));
  // A label to reprint or cancel: one printed this session, or a PACKED order (after a reload, packed is what a labelled order looks
  // like). Not an FBA order (packed by its Amazon file) or a pack-only one: neither ever had a Royal Mail label.
  const hasLabel = !!label || (order.state === 'packed' && !hasFba && !packOnly);
  const scanning = !!progress && progress.total > 0 && progress.scanned > 0 && !label;
  const allIn = scanning && progress!.scanned >= progress!.total;
  const s = CUSTOMER_STATES[order.state];
  // Do Not Order is written per order, so one parked line means the order is marked.
  const doNotOrder = order.lines.some((l) => l.state === 'parked');

  return (
    <div>
      {/* --- who and where ------------------------------------------------------------------------------------------------------ */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={'font-bold tabular-nums leading-none tracking-tight text-slate-900 text-3xl'}>
            {order.ordernum}
          </p>
          <p className={'mt-2 truncate text-slate-600 text-base'}>
            {order.customer || '—'}
            <span className="text-slate-400"> · {order.postcode || 'no postcode'} · {courierShort(order.courier)}</span>
          </p>
        </div>
        {/* n of m — the number the bench reads from across the room. */}
        {scanning ? (
          <div className={'shrink-0 text-right ' + (allIn ? 'text-emerald-600' : 'text-brand-700')}>
            <p className={'font-bold tabular-nums leading-none text-4xl'}>
              {progress!.scanned}<span className="text-slate-300">/</span>{progress!.total}
            </p>
            <p className={'mt-1 font-medium text-xs'}>scanned</p>
          </div>
        ) : (
          <span className={'shrink-0 rounded px-2 py-0.5 text-sm font-medium ring-1 ring-inset ' + s.pill}>{s.label}</span>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      {order.note && (
        <p className={'mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-900 text-sm'}>
          <ChatBubbleLeftEllipsisIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />{order.note}
        </p>
      )}

      {/* --- the shoes: a list to tick down ------------------------------------------------------------------------------------- */}
      <ul className={'mt-4 flex flex-col gap-2'}>
        {order.lines.map((l, i) => <ShoeRow key={`${l.code}|${i}`} line={l} scanned={ticked.has(l)} />)}
      </ul>

      {error && (
        <p className={'mt-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 font-medium text-red-700 text-sm'} role="alert">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </p>
      )}

      {/* --- the label, once there is one --------------------------------------------------------------------------------------- */}
      {hasLabel && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-sky-700"
            title={label ? label.printedAt.toLocaleString('en-GB') : undefined}>
            <PrinterIcon className="h-4 w-4" />
            {label
              ? <>Printed {label.printedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</>
              : 'Packed'}
            {label && label.reprints > 0 && <span className="font-normal text-slate-500">, reprinted {label.reprints}×</span>}
          </span>
          <button
            type="button"
            disabled={working}
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
              disabled={working}
              onClick={() => setConfirm('cancelLabel')}
              title="Printed by mistake — void the label and start this order's scans again"
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              Cancel label
            </button>
          )}
        </div>
      )}

      {/* --- Fulfil on Shopify: a packed order, Royal Mail or FBA (file made). Its own button while the fulfil is tested (owner,
          2026-10-20); the server says why if this one can't go (no tracking yet, pack only, already fulfilled). ----------------- */}
      {order.state === 'packed' && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {fulfilNote && (
            <span className={'mr-auto text-sm font-medium ' + (fulfilNote.ok ? 'text-emerald-700' : 'text-red-700')}>{fulfilNote.text}</span>
          )}
          {confirm === 'fulfil' ? (
            <ConfirmBox
              message="Fulfill on Shopify? The customer is emailed."
              onYes={() => { setConfirm(null); onFulfil(); }}
              onNo={() => setConfirm(null)}
            />
          ) : (
            <button
              type="button"
              disabled={working}
              onClick={() => setConfirm('fulfil')}
              title={hasFba
                ? 'Mark fulfilled on Shopify with the Amazon courier and email the customer'
                : 'Mark fulfilled on Shopify with the Royal Mail tracking number and email the customer'}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
            >
              <CheckBadgeIcon className="h-4 w-4" /> Fulfill
            </button>
          )}
        </div>
      )}

      {/* --- the desk's controls ------------------------------------------------------------------------------------------------
          Under a rule, in normal type, whatever the view: these are clicked, not read from a distance. */}
      <div className="mt-4 border-t border-slate-200 pt-4">
        <label htmlFor="cust-note" className="mb-1 block text-xs font-medium text-slate-500">Note</label>
        <div className="flex gap-2">
          <input
            id="cust-note"
            value={note}
            disabled={working}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && noteChanged && !working) onNote(note); }}
            maxLength={500}
            placeholder="e.g. waiting for customer to confirm size"
            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none disabled:bg-slate-100"
          />
          <button
            type="button"
            disabled={working || !noteChanged}
            onClick={() => onNote(note)}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Toggle-styled because it's a STATE the order is in. There's no "un-pack": you leave it by picking a real courier. */}
          <button
            type="button"
            disabled={working}
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

          <select
            aria-label="Courier"
            value={SHIPPING.some((c) => c.code === order.courier) ? (order.courier as string) : ''}
            disabled={working}
            onChange={(e) => e.target.value && onCourier(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-100 disabled:opacity-60"
          >
            {/* Present whenever the stored code isn't one of the shipping services. An unrecognised code is shown raw rather than
                silently re-labelled as something we do offer. */}
            {!SHIPPING.some((c) => c.code === order.courier) && (
              <option value="">
                {packOnly ? 'Pack only' : order.courier ? `Other (${order.courier})` : 'Courier not set'}
              </option>
            )}
            {SHIPPING.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>

          {/* An FBA order's whole outstanding job is this file, so it's on the face of the box, not behind More. */}
          {hasFba && (
            <button
              type="button"
              disabled={working}
              onClick={onFbaFile}
              title={fileMade
                ? 'File already made — download it again (the order stays done)'
                : 'Download the Amazon order file to upload to Seller Central. Marks the order done.'}
              className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-40"
            >
              {fileMade ? 'AMZ order file again' : 'AMZ order file'}
            </button>
          )}

          <button
            type="button"
            disabled={working}
            aria-expanded={more}
            onClick={() => { setMore(!more); setConfirm(null); }}
            className="ml-auto flex items-center gap-1 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
          >
            More
            <ChevronDownIcon className={'h-4 w-4 transition-transform ' + (more ? 'rotate-180' : '')} />
          </button>
        </div>

        {more && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              disabled={working}
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

            {/* Don't source it — the order sync stops reserving or flagging stock for it. It still scans and packs (owner, 2026-10-15). */}
            <button
              type="button"
              disabled={working}
              aria-pressed={doNotOrder}
              title="Stops the order sync sourcing stock for it — it can still be scanned and packed"
              onClick={() => onDoNotOrder(!doNotOrder)}
              className={
                'rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ' +
                (doNotOrder
                  ? 'border-slate-400 bg-slate-200 text-slate-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
              }
            >
              {doNotOrder ? 'Do not order ✓' : 'Do not order'}
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
                disabled={working || multiLine}
                title={multiLine ? 'FBA can only be set on a single-line order' : undefined}
                onClick={() => setConfirm('fba')}
                className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40"
              >
                Send from FBA
              </button>
            )}

            {/* RESET (owner, 2026-10-22): back to how the sync first inserted it — FBA, the Amazon file stamp, shelf picks and Do not
                order all cleared; the next Update orders sorts it again. Refused server-side while it has a label. */}
            {confirm === 'reset' ? (
              <ConfirmBox
                message="Reset to new?"
                onYes={() => { setConfirm(null); onReset(); }}
                onNo={() => setConfirm(null)}
              />
            ) : (
              <button
                type="button"
                disabled={working}
                title="Clear FBA, picks and Do not order — the next Update orders sorts it again (shelf, then FBA, then supplier)"
                onClick={() => setConfirm('reset')}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300 disabled:opacity-40"
              >
                <ArrowPathIcon className="h-4 w-4" /> Reset
              </button>
            )}

            {confirm === 'delete' ? (
              <ConfirmBox
                // Deleting is per ORDER, so a multi-line order takes its siblings with it — the count is what tells you that.
                message={order.lines.length === 1 ? 'Delete this order?' : `Delete all ${order.lines.length} lines?`}
                onYes={() => { setConfirm(null); onDelete(); }}
                onNo={() => setConfirm(null)}
              />
            ) : (
              <button
                type="button"
                disabled={working}
                onClick={() => setConfirm('delete')}
                className="flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                <TrashIcon className="h-4 w-4" /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * ShoeRow — one unit of the order in the box: an empty ring to fill, the code (bold — it's what's on the box), the name to check it
 * against, and a state for the ones not going in this box.
 *   scanned     green, filled tick
 *   to scan     white, empty ring — what's still to find
 *   packed/FBA  done or Amazon's; labelled as such, no ring
 */
function ShoeRow({ line, scanned }: { line: CustomerOrderLine; scanned: boolean }) {
  const open = scannable(line);
  const tone = scanned ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
    : line.state === 'packed' ? 'border-emerald-200 bg-emerald-50/60 text-emerald-700'
    : isFba(line.state) ? 'border-sky-200 bg-sky-50 text-sky-700'
    : open ? 'border-slate-300 bg-white text-slate-800'
    : 'border-slate-200 bg-slate-50 text-slate-500';
  const status = scanned ? null
    : line.state === 'packed' ? 'Packed'
    : isFba(line.state) ? 'FBA'
    : open ? null
    : CUSTOMER_STATES[line.state].label;
  const icon = 'h-6 w-6';
  return (
    <li className={'flex items-center rounded-lg border-2 transition-colors ' + tone + ' gap-3 px-3 py-2.5'}
      title={`${line.code}${line.title ? ' — ' + line.title : ''}${line.supplier ? ' · ' + line.supplier : ''}`}>
      {scanned
        ? <CheckCircleIcon className={'shrink-0 text-emerald-600 ' + icon} aria-label="Scanned" />
        : open
          ? <span className={'shrink-0 rounded-full border-[3px] border-slate-300 ' + icon} aria-label="To scan" />
          : <span className={'shrink-0 ' + icon} />}
      <span className="min-w-0 flex-1">
        <span className={'block font-bold tabular-nums text-lg'}>
          {line.code}{line.qty > 1 && <span className="font-medium opacity-60"> ×{line.qty}</span>}
        </span>
        {line.title && <span className={'block truncate opacity-75 text-sm'}>{line.title}</span>}
      </span>
      {status && <span className={'shrink-0 font-semibold text-sm'}>{status}</span>}
    </li>
  );
}

/*
 * WeightPrompt — the whole parcel's weight in kg, asked only when a shoe in the order has no stored weight (skumap.weight). A modal
 * over the whole screen so it can't be missed, focused on arrival so the packer can put the box on the scale, type, Enter. Used for
 * this label only; not saved back to the product. Portalled to <body>: drawn inside the sticky panel it sat in that panel's stacking
 * context, and the sticky board above showed through the backdrop un-dimmed.
 */
function WeightPrompt({ ordernum, message, onSubmit, onCancel }: {
  ordernum: string; message: string; onSubmit: (kg: number) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const kg = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(kg) && kg > 0 && kg <= 20;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="weight-prompt-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(kg); }}
        className="w-full max-w-md rounded-xl border-4 border-amber-400 bg-white p-6 shadow-2xl"
      >
        <p id="weight-prompt-title" className="text-2xl font-semibold text-slate-900">Weigh the box for {ordernum}</p>
        <p className="mt-2 text-base text-amber-800">{message}</p>
        <div className="mt-5 flex items-center gap-3">
          <input
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(',', '.'))}
            placeholder="0.0"
            aria-label="Parcel weight in kg"
            className="w-36 rounded-md border-2 border-amber-300 bg-white px-3 py-2 text-3xl tabular-nums focus:border-amber-500 focus:outline-none"
          />
          <span className="text-2xl text-slate-700">kg</span>
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-base text-slate-600 hover:text-slate-900">Cancel</button>
          <button
            type="submit"
            disabled={!valid}
            className="rounded-md bg-slate-800 px-5 py-2 text-base font-medium text-white disabled:opacity-40"
          >
            Print label
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// Inline confirm rather than window.confirm: a native modal blocks the whole tab and reads as a browser error.
function ConfirmBox({ message, onYes, onNo }: { message: string; onYes: () => void; onNo: () => void }) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
      <span className="text-slate-700">{message}</span>
      <button type="button" onClick={onYes} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Yes</button>
      <button type="button" onClick={onNo} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">No</button>
    </span>
  );
}
