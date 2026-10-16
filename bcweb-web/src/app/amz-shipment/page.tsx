'use client';
/*
=======================================================================================================================================
Page: /amz-shipment  (AMZ Shipment — packing the Amazon boxes)
=======================================================================================================================================
Purpose: Where the FBA boxes get packed. Pick's Amazon tab gathers the units flagged for Amazon onto the C3-Amazon shelf; this screen is
         the next step — scanning those shoes into boxes, packing each box, then sending the shipment.

YOUR BOX, THEN PACK (owner, 2026-10-16: "dont want the box saved until its locked. change the word locked to packed. dont even give
them a box num till they press pack. then tell them their box num. swapping between goods in and amz doesnt start a new box. just
throw into the users active box - once they save /lock it they start a new active box").
  - YOUR BOX is the one being filled. One per user, held in THIS BROWSER (src/lib/amzActiveBox.ts) and shared with Goods In, which
    puts the Amazon units it books in into the same box. It has no number and isn't in the DB. Going to Goods In and back, or
    reloading, keeps it.
  - PACK (POST /amz-shipment-pack) stores it in amzshipment in one go, under the next number, and says the number — "Packed — that's
    Box 14, write 14 on the carton". Your box is then empty and the next scan starts the next one. Only a measured and weighed box can
    be packed (all four sizes). Enter on weight with all four filled packs, as Lock did.
  - PACKED BOXES are the stored ones (amzshipment; the column is still `locked`, the word on screen is "packed"). They can't be
    changed in place. UNPACK (POST /amz-shipment-unpack, owner 2026-10-16) takes one back out of the DB into your box to change it,
    and the boxes after it move down one, so the numbers stay 1..n (Amazon's B1..Bn). Only while your box is empty, so nothing gets
    mixed. Packing it again gives it a new number. A stored box that ISN'T packed (one the legacy app wrote) shows "not packed" and
    can be moved into your box the same way, then packed here.
  - AUTO BACK (owner, 2026-10-16): the tick-box in the header's Goods In button sends a Pack straight back to Goods In, which then
    shows the box's number. Unticked, the Packed panel here offers Back to Goods In.

MARK SHIPPED (owner, 2026-10-01: "the shipped button should clear the whole shipment"). Live. POST /amz-shipment-ship, one transaction:
the stored shipment is archived to amzshipment_archive under a new shipment id, the boxed units come off the C3-Amazon shelf
(soft-deleted), and amzshipment is emptied. It sends the boxes and units it showed, so the server refuses if the stored shipment differs.
Your box isn't stored, so it doesn't go — the confirm says so when it has shoes in it. Codes boxed with nothing on C3-Amazon to take
are listed in the notice afterwards. See the route header for the detail.

FRESH ON ARRIVAL. The packed boxes are read under a new cache key every visit, so a box packed on the other bench is seen. Pack and
Unpack re-read them after they write.

FIND (owner, 2026-10-01). "Which box is this SKU in?" — the box above the list narrows it to boxes holding a match (code, Amazon SKU,
FNSKU or title — your box too) and names the matching codes under each; the matching lines are highlighted in the open box.

KEPT SIMPLE (owner, 2026-10-16: "dont want them to really need to think"). Your box's rare actions (Print labels switch, Empty) sit in
a ⋯ menu beside Undo, a small "labels off" shows by the box name while printing is off; Finish shipment is folded to one line (green
with a tick once everything is packed); the contents show the shoe's groupid with its title under it, and its size big; and a good
scan flashes its line green and pops the qty (the animations are in tailwind.config.js).

SCANNING. A barcode scanner types the code and presses Enter, so the scan box is just an input that commits on Enter and keeps focus —
scan, scan, scan with no clicks. Every scan goes into YOUR BOX, whichever box is being looked at (the view switches back to it). The
same code scanned twice is one line with qty 2. − takes one off a line; Undo takes off the last scan made on this screen.

SCAN CHECK (owner, 2026-10-02). Every scan is looked up (GET /amz-shipment-scan — our code, the EAN or the FNSKU all resolve to the
product) BEFORE it goes in the box, and is refused if it isn't a product we know, or if Amazon hasn't given it an FNSKU ("it needs to have
an fnsku to go in an amz box"). A refused scan goes in no box: the scan field turns red, the reason shows under it with the product's name,
and the browser beeps — the packer is looking at the shoe, not the screen. It clears on the next good scan. A line made by a good scan
carries the product's code, Amazon SKU, FNSKU, groupid and title, so an EAN and an FNSKU scan of the same shoe are one line.

FNSKU LABELS (owner, 2026-10-02: "print a fnsku label when its scanned"). Every good scan prints one 54 × 25 mm Dymo label — the FNSKU's image from the
barcode folder, as the old system printed, with our code under it (2026-10-08) — via src/lib/fnskuLabel.ts (silent on the packing PC's --kiosk-printing Chrome shortcut, a print dialog anywhere else).
A refused scan prints nothing, and NEITHER DOES SCANNING THE FNSKU ITSELF (owner, 2026-10-09): a shoe whose FNSKU barcode can be scanned
is already labelled, so a scan that matches the product's FNSKU boxes it without printing. "Print labels" switches it off for shoes already labelled; the switch is remembered in this browser, as
it belongs to the bench, not the shipment. The printer icon on a line reprints that line's label (a jam, a smudge, a test).

MEASUREMENTS (owner, 2026-09-28). Once a box is filled, its length, width and height (cm) and weight (kg) go in above its contents —
Amazon wants all four for every carton, and Pack needs them. Amazon's standard-carton limits (63.5 cm on any side, 23 kg) are shown as
a warning only. Two quick fills (owner, 2026-10-01): "Birk box" puts in the Birkenstock carton's sides (BIRK_BOX — weight left blank,
it depends on the contents), and "Set" (one click, 2026-10-15) saves your box's typed size in this browser, or fills an empty size with
the saved one — the same box size packed again and again isn't retyped.

SHIPPING PLAN (owner, 2026-10-01: "a button that makes my amz shipping plan file ... essentially just a list of whats in all the boxes").
Downloads Amazon-ShippingPlan.txt, the Seller Central shipping-plan upload, in the legacy app's exact layout: the template's header block,
then "Merchant SKU<TAB>Quantity", one line per Amazon SKU totalled across every stored box, CRLF line ends. No measurements in this
file, so it doesn't wait for them.

AMAZON UPLOAD (owner, 2026-10-06: "we need the amz upload to fill in the details for this file ... they need to know what items are in
what boxes and all box sizes"). Pick the box contents .xlsx Amazon gives you in Send to Amazon; the screen fills in the box count,
each SKU's quantity per box and every box's weight and size from the stored boxes, and downloads it as <name>-filled.xlsx to upload
back. Done in the browser by src/lib/amzBoxUpload.ts (read its header) — the file never goes to our server. Problems (quantities that
don't match Amazon's expected, missing sizes…) are listed but the file is still made; only a file it can't fill is refused. Our boxes
are Amazon's B1..Bn in order, which is why Unpack renumbers.
=======================================================================================================================================
*/

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MinusIcon, CubeIcon, ArchiveBoxXMarkIcon, ArrowUturnLeftIcon, TruckIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, MagnifyingGlassIcon, PrinterIcon,
  InboxArrowDownIcon, EllipsisHorizontalIcon, ChevronDownIcon, CheckCircleIcon, ArrowUturnUpIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAmzShipmentBoxes, shipAmzShipment, lookupAmzShipmentScan, packAmzShipmentBox, unpackAmzShipmentBox,
  type AmzBox, type AmzShipResult, type AmzScanHit,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { printFnskuLabel } from '@/lib/fnskuLabel';
import { fillAmazonBoxFile } from '@/lib/amzBoxUpload';
import {
  useActiveBox, addToActiveBox, takeFromActiveBox, setActiveDims, emptyActiveBox, packedActiveBox, dismissPacked, replaceActiveBox,
  activeUnits, NO_DIMS, type ActiveLine, type ActiveDims,
} from '@/lib/amzActiveBox';

type BoxLine = ActiveLine;
type BoxDims = ActiveDims;
// A STORED box (packed, or one the legacy app wrote and didn't pack). `locked` is the DB column; on screen it's "packed".
interface Box { id: number; lines: BoxLine[]; dims: BoxDims; locked: boolean; }

// The box's small square button (the ⋯ menu).
const ICON_BTN = 'flex items-center gap-1 rounded-md border p-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ';
// The Finish shipment steps — full width, quiet: outline, numbered, nothing that shouts before it's time.
const FINISH_BTN = 'flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white';
// A row in the box's ⋯ menu.
const MENU_ITEM = 'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ';
const boxUnits = (b: { lines: BoxLine[] }) => b.lines.reduce((n, l) => n + l.qty, 0);
// Size = the code's suffix after the last '-' (CLAUDE.md: not the last two characters — half sizes and UK sizes).
const sizeOf = (code: string) => code.slice(code.lastIndexOf('-') + 1);
const fromDb = (b: AmzBox): Box => ({
  id: b.box,
  lines: b.lines.map((l) => ({ code: l.code, qty: l.qty, sku: l.sku, fnsku: l.fnsku, groupid: l.groupid, title: l.title })),
  dims: { length: b.length, width: b.width, height: b.height, weight: b.weight },
  locked: !!b.locked,
});

// Amazon's standard-carton limits (UK/EU): no side over 63.5 cm, no box over 23 kg. Advisory here — see MEASUREMENTS in the header.
const MAX_SIDE_CM = 63.5;
const MAX_WEIGHT_KG = 23;
const FIELDS: { key: keyof BoxDims; label: string; unit: string }[] = [
  { key: 'length', label: 'Length', unit: 'cm' },
  { key: 'width', label: 'Width', unit: 'cm' },
  { key: 'height', label: 'Height', unit: 'cm' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
];
// A refused scan's alert sound: two short low beeps, distinct from a scanner's own beep. Web Audio needs no file; any failure (no
// audio device, autoplay policy before the first click) is ignored — the red on screen still says it.
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

// Print labels on/off — remembered per browser (the bench's setting, see FNSKU LABELS). Default on; storage failures just mean on.
const PRINT_KEY = 'amzShipment.printLabels';
function loadPrintOn(): boolean {
  try { return localStorage.getItem(PRINT_KEY) !== '0'; } catch { return true; }
}
function savePrintOn(on: boolean) {
  try { localStorage.setItem(PRINT_KEY, on ? '1' : '0'); } catch { /* not remembered */ }
}

// AUTO BACK TO GOODS IN (owner, 2026-10-16: "if they working goods in they may not want to keep needing to click"). Ticked: packing a
// box goes straight back there. Unticked: the Packed panel offers it. Remembered per browser like Print labels — it's the bench's way
// of working. Default unticked; storage failures just mean unticked.
const BACK_KEY = 'amzShipment.autoBackToGoodsIn';
function loadAutoBack(): boolean {
  try { return localStorage.getItem(BACK_KEY) === '1'; } catch { return false; }
}
function saveAutoBack(on: boolean) {
  try { localStorage.setItem(BACK_KEY, on ? '1' : '0'); } catch { /* not remembered */ }
}

// The Birkenstock carton (owner, 2026-10-01). Nothing in the DB names it; 46 × 46 × 33 is the most common carton in amzshipment +
// archive (15 boxes) and the owner confirmed it. Sides only — weight depends on what's packed.
const BIRK_BOX: Partial<BoxDims> = { length: '46', width: '46', height: '33' };

// Set's remembered values. Browser storage: a per-person convenience (the last size YOU used), not shared state — and every access is
// guarded because storage can be blocked or empty (private window), in which case Set simply opens blank.
const PRESET_KEY = 'amzShipment.setDims';
function loadPreset(): BoxDims {
  try {
    const v = JSON.parse(localStorage.getItem(PRESET_KEY) || 'null');
    if (v && typeof v === 'object') return { ...NO_DIMS, ...Object.fromEntries(FIELDS.map((f) => [f.key, String(v[f.key] ?? '')])) };
  } catch { /* fall through to blank */ }
  return NO_DIMS;
}
function savePreset(d: BoxDims) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(d)); } catch { /* not remembered; still applied */ }
}

const dimNum = (v: string) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; };
const dimsComplete = (d: BoxDims) => FIELDS.every((f) => dimNum(d[f.key]) !== null);
function dimsWarning(d: BoxDims): string | null {
  const over = (['length', 'width', 'height'] as const).filter((k) => (dimNum(d[k]) ?? 0) > MAX_SIDE_CM);
  const heavy = (dimNum(d.weight) ?? 0) > MAX_WEIGHT_KG;
  const parts: string[] = [];
  if (over.length) parts.push(`${over.join(' / ')} over ${MAX_SIDE_CM} cm`);
  if (heavy) parts.push(`over ${MAX_WEIGHT_KG} kg`);
  return parts.length ? `Over Amazon's standard box limit: ${parts.join(', ')}.` : null;
}

// SHIPPING PLAN — the legacy Amazon-ShippingPlan.txt byte for byte in layout (see the header): the template's preamble, then one
// "SKU<TAB>qty" line per Amazon SKU summed over all boxes, in first-seen order (box, then code). Every stored line has a sku on live data;
// a blank one is skipped rather than sent as an empty SKU.
function downloadShippingPlan(boxes: Box[]) {
  const totals = new Map<string, number>();
  for (const b of boxes) for (const l of b.lines) {
    const sku = (l.sku || '').trim();
    if (sku) totals.set(sku, (totals.get(sku) || 0) + l.qty);
  }
  const lines = [
    'Please review the Example tab before you complete this sheet\t', '\t',
    'Default prep owner\tSeller', 'Default labeling owner\tSeller', '\t', '\t', '\t',
    'Merchant SKU\tQuantity',
    ...[...totals].map(([sku, qty]) => `${sku}\t${qty}`),
  ];
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Amazon-ShippingPlan.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Loads the stored boxes, then hands them to Packing as its starting list (so Packing's useState seeds from real data, no effect).
// FRESH ON ARRIVAL: every visit reads under its OWN cache key, so the list is never the one SWR cached last visit (see the header).
// After Mark shipped the boxes are re-read and Packing is REMOUNTED (key = round) so it re-seeds from the DB.
export default function AmzShipmentPage() {
  const [visit] = useState(() => Math.random());
  // Held here because its tick-box sits in the header, in the Goods In button.
  const [autoBack, setAutoBack] = useState(loadAutoBack);
  const { data, error, isLoading, refresh } = useApiQuery(['amz-shipment-boxes', visit], getAmzShipmentBoxes);
  const [round, setRound] = useState(0);
  const [shipped, setShipped] = useState<AmzShipResult | null>(null);

  async function onShipped(r: AmzShipResult) {
    setShipped(r);
    await refresh();
    setRound((n) => n + 1);
  }

  return (
    // Goods In and this screen link to each other (owner, 2026-10-15).
    // The AUTO BACK tick-box sits INSIDE the Goods In button — one bordered pill holding the tick-box and the link side by side (a
    // checkbox can't go inside the <a>, or ticking it would navigate).
    <AppShell title="AMZ Shipment" headerRight={
        <div className="flex items-center rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:border-slate-400">
          <input
            type="checkbox"
            checked={autoBack}
            onChange={(e) => { setAutoBack(e.target.checked); saveAutoBack(e.target.checked); }}
            title={autoBack ? 'Packing a box goes straight back to Goods In — untick to stay here' : 'Tick to go straight back to Goods In after packing a box'}
            aria-label="Go straight back to Goods In after packing a box"
            className="ml-2.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <Link href="/goods-in" className="flex items-center gap-1.5 rounded-md px-3 py-1.5 hover:bg-slate-50">
            <InboxArrowDownIcon className="h-4 w-4" />Goods In
          </Link>
        </div>
      }>
      {shipped && <ShippedNotice result={shipped} onClose={() => setShipped(null)} />}
      {isLoading ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading boxes…</div>
      ) : error || !data ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error?.message || 'Failed to load the Amazon boxes'}</div>
      ) : (
        <Packing key={round} initial={data.boxes.map(fromDb)} autoBack={autoBack} onShipped={onShipped} />
      )}
    </AppShell>
  );
}

// What Mark shipped did. The shortfall list is the one thing to act on: codes that were boxed but weren't (fully) on the C3-Amazon
// shelf, so the stock figure for them needs a look. Stays until closed — it's the only record on screen of what just went.
function ShippedNotice({ result, onClose }: { result: AmzShipResult; onClose: () => void }) {
  return (
    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      <div className="flex items-start gap-2">
        <TruckIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          Shipment {result.shipmentId} marked shipped: {result.boxes} {result.boxes === 1 ? 'box' : 'boxes'}, {result.units} units.{' '}
          {result.stockRemoved} taken off C3-Amazon.
          {result.shortfall.length > 0 && (
            <div className="mt-1 text-amber-800">
              Not on the C3-Amazon shelf, so no stock was taken for:{' '}
              {result.shortfall.map((s) => `${s.code} (${s.boxed - s.removed} of ${s.boxed})`).join(', ')} — worth checking where they came from.
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-xs text-emerald-700 hover:text-emerald-900">Close</button>
      </div>
    </div>
  );
}

function Packing({ initial, autoBack, onShipped }: {
  initial: Box[]; autoBack: boolean; onShipped: (r: AmzShipResult) => Promise<void>;
}) {
  const router = useRouter();
  const user = useAuth().displayName || '';
  // YOUR BOX — in this browser until Pack (see the header). Every change goes through src/lib/amzActiveBox.ts, which re-renders this.
  const mine = useActiveBox(user);
  const mineUnits = activeUnits(mine);
  // The STORED boxes, re-read after a Pack or Unpack.
  const [boxes, setBoxes] = useState<Box[]>(initial);
  // Which box is on show: 'mine', or a stored box's number.
  const [view, setView] = useState<'mine' | number>('mine');
  const [scan, setScan] = useState('');
  // This visit's scans in order, so Undo can take off the last one.
  const [history, setHistory] = useState<string[]>([]);
  // `printed` says whether that scan printed a label, so the confirmation line doesn't claim one when it didn't. `n` numbers the scan
  // so the same shoe scanned twice still replays the line's green flash (the row is re-keyed by it).
  const [lastScan, setLastScan] = useState<{ code: string; printed?: boolean; n: number } | null>(null);
  const scanCount = useRef(0);
  // The last scan refused by SCAN CHECK — drives the red scan field and the message under it.
  const [scanError, setScanError] = useState<{ scan: string; message: string; title?: string } | null>(null);
  // Good lookups this visit, by what was scanned, so a run of the same shoe is one round trip. Only products WITH an FNSKU are kept:
  // a refused one is asked again next time, in case Amazon's import has given it one since.
  const scanCache = useRef(new Map<string, AmzScanHit>());
  // Lazy initialiser: read once on mount (this component only renders client-side after the boxes load), no effect needed.
  const [printOn, setPrintOn] = useState(loadPrintOn);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // The box's ⋯ menu (print switch, Empty) — the rarely-used actions, out of the packer's way (owner, 2026-10-16).
  const [menuOpen, setMenuOpen] = useState(false);
  // FINISH SHIPMENT starts folded to one line (owner, 2026-10-16): it's done once per shipment, not while packing.
  const [finishOpen, setFinishOpen] = useState(false);
  const [confirmShip, setConfirmShip] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  // PACK / UNPACK in flight, and what went wrong (shown under the box header).
  const [working, setWorking] = useState(false);
  const [boxError, setBoxError] = useState<string | null>(null);
  // FIND — which box is a SKU in? Matches code, Amazon SKU, FNSKU or title, case-insensitive, across every box (yours too).
  const [find, setFind] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);
  // AMAZON UPLOAD: the hidden file picker, and what the last fill did (warnings stay on screen until closed).
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [upload, setUpload] = useState<{ error?: string; done?: string; warnings: string[] } | null>(null);

  const refocus = () => scanRef.current?.focus();
  const shown: Box | null = view === 'mine' ? null : boxes.find((b) => b.id === view) ?? null;
  const onMine = shown === null;
  const lines = onMine ? mine.lines : shown.lines;
  const dims = onMine ? mine.dims : shown.dims;

  const q = find.trim().toLowerCase();
  const lineMatches = (l: BoxLine) => q !== '' && [l.code, l.sku, l.fnsku, l.groupid, l.title].some((v) => (v || '').toLowerCase().includes(q));
  const mineHits = q ? mine.lines.filter(lineMatches) : [];
  const hits = q ? boxes.map((b) => ({ box: b, lines: b.lines.filter(lineMatches) })).filter((h) => h.lines.length > 0) : [];

  // What Mark shipped sends: the stored boxes and units on screen. The server refuses if its own counts differ.
  const totalUnits = boxes.reduce((n, b) => n + boxUnits(b), 0);
  const notPacked = boxes.filter((b) => !b.locked);
  const allPacked = boxes.length > 0 && notPacked.length === 0 && mineUnits === 0;
  const warning = onMine ? dimsWarning(dims) : null;
  const canPack = mineUnits > 0 && dimsComplete(mine.dims) && !working;

  async function rereadBoxes(): Promise<boolean> {
    const res = await getAmzShipmentBoxes();
    if (!res.success || !res.data) return false;
    setBoxes(res.data.boxes.map(fromDb));
    return true;
  }

  function showMine() {
    setView('mine');
    setMenuOpen(false);
    setConfirmEmpty(false);
    setBoxError(null);
  }

  // SCAN CHECK (see the header): look the scan up, refuse it red if it's unknown or has no FNSKU, otherwise put it in your box under its
  // real code. Always your box — if a packed box is on show, the view goes back to yours.
  async function onScan() {
    const raw = scan.trim().toUpperCase();
    setScan('');
    if (!raw) return;
    let hit = scanCache.current.get(raw);
    if (!hit) {
      const res = await lookupAmzShipmentScan(raw);
      if (!res.success || !res.data) {
        const message = res.return_code === 'NOT_FOUND'
          ? 'Product not found — not a code, barcode or FNSKU we know. Not added.'
          : `Couldn’t check this scan (${res.error || 'error'}) — scan it again. Not added.`;
        refuse({ scan: raw, message });
        return;
      }
      if (!res.data.fnsku) {
        refuse({ scan: raw, message: `${res.data.code} has no FNSKU, so it can’t go in an Amazon box. Not added.`, title: res.data.title });
        return;
      }
      hit = res.data;
      scanCache.current.set(raw, hit);
    }
    const { code, sku, fnsku, groupid, title } = hit;
    addToActiveBox(user, { code, sku, fnsku, groupid, title });
    if (!onMine) showMine();
    setHistory((h) => [...h, code]);
    // Scanned the FNSKU itself -> the shoe already wears its label; don't print another (see FNSKU LABELS in the header).
    const printed = printOn && raw !== fnsku.toUpperCase();
    setLastScan({ code, printed, n: ++scanCount.current });
    setScanError(null);
    if (printed) printLabel(fnsku, code);
  }

  // Print, then hand focus back to the scan field (printing focuses the label's iframe).
  function printLabel(fnsku: string, code: string) {
    printFnskuLabel(fnsku, code, refocus);
  }

  function togglePrint() {
    setPrintOn((on) => { savePrintOn(!on); return !on; });
    refocus();
  }

  function refuse(err: { scan: string; message: string; title?: string }) {
    setScanError(err);
    setLastScan(null);
    beepError();
  }

  function takeOne(code: string) {
    takeFromActiveBox(user, code);
    // Drop this visit's most recent scan of that code too, so Undo never re-removes it.
    setHistory((h) => {
      const i = h.lastIndexOf(code);
      return i < 0 ? h : [...h.slice(0, i), ...h.slice(i + 1)];
    });
    setLastScan(null);
    refocus();
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    takeFromActiveBox(user, last);
    setHistory((h) => h.slice(0, -1));
    showMine();
    setLastScan(null);
    refocus();
  }

  function setDim(key: keyof BoxDims, value: string) {
    setActiveDims(user, { ...mine.dims, [key]: value.replace(/[^0-9.]/g, '') });
  }

  // Quick fill: write the given measurements into your box. Only non-blank values are written, so Birk box (no weight) and a Set with
  // a field left empty keep whatever was already there.
  function fillDims(d: Partial<BoxDims>) {
    const next = { ...mine.dims };
    for (const f of FIELDS) { const v = (d[f.key] ?? '').trim(); if (v) next[f.key] = v; }
    setActiveDims(user, next);
  }

  // SET (owner, 2026-10-15) — for packing the same size box again and again without retyping it. One click, no panel, no message:
  //   your box has measurements typed  -> they become Set's saved values;
  //   it has none                      -> the saved values are filled in.
  function setButton() {
    if (FIELDS.some((f) => mine.dims[f.key].trim() !== '')) savePreset(mine.dims);
    else fillDims(loadPreset());
    refocus();
  }

  // Empty your box: everything out, the measurements kept. Confirmed inline first. Its scans leave Undo's history.
  function emptyMine() {
    if (mineUnits === 0) return;
    if (!confirmEmpty) { setConfirmEmpty(true); return; }
    emptyActiveBox(user);
    setHistory([]);
    setConfirmEmpty(false);
    setMenuOpen(false);
    setLastScan(null);
    refocus();
  }

  // PACK (see the header): store your box, get its number. Your box is emptied only once the server has it — a refusal leaves it as it
  // is and says why. AUTO BACK goes straight to Goods In, which shows the number from the same store.
  async function pack() {
    if (!canPack) return;
    setWorking(true);
    setBoxError(null);
    const res = await packAmzShipmentBox(mine.lines.map((l) => ({ code: l.code, qty: l.qty })), mine.dims);
    if (!res.success || !res.data) {
      setWorking(false);
      setBoxError(`Not packed: ${res.error || 'error'}`);
      return;
    }
    packedActiveBox(user, res.data.box);
    setHistory([]);
    setLastScan(null);
    setMenuOpen(false);
    if (autoBack) { router.push('/goods-in'); return; }
    await rereadBoxes();
    setWorking(false);
    refocus();
  }

  // UNPACK (see the header): a stored box back into your box, which must be empty. The server checks the box still holds what this
  // screen showed (STALE) — then the list is re-read, as the numbers may have moved.
  async function unpack(b: Box) {
    if (mineUnits > 0 || working) return;
    setWorking(true);
    setBoxError(null);
    const res = await unpackAmzShipmentBox(b.id, boxUnits(b));
    if (!res.success || !res.data) {
      await rereadBoxes();
      setWorking(false);
      setBoxError(res.error || `Box ${b.id} couldn’t be unpacked`);
      return;
    }
    replaceActiveBox(user, res.data.lines.map((l) => ({ ...l, qty: Number(l.qty) })), res.data.dims);
    setHistory([]);
    await rereadBoxes();
    setWorking(false);
    showMine();
    refocus();
  }

  async function ship() {
    setShipping(true);
    setShipError(null);
    const res = await shipAmzShipment(boxes.length, totalUnits);
    setShipping(false);
    setConfirmShip(false);
    if (!res.success || !res.data) { setShipError(res.error || 'Couldn’t mark the shipment shipped'); return; }
    await onShipped(res.data);
  }

  // AMAZON UPLOAD (see the header). Fills from the stored boxes and downloads.
  async function onUploadFile(file: File | undefined) {
    if (uploadRef.current) uploadRef.current.value = '';   // so picking the same file again still fires
    if (!file) return;
    setUploading(true);
    const res = await fillAmazonBoxFile(file, boxes);
    setUploading(false);
    if (!res.ok) { setUpload({ error: res.error, warnings: [] }); return; }
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setUpload({
      done: `Downloaded ${res.fileName}: ${res.boxes} ${res.boxes === 1 ? 'box' : 'boxes'}, ${res.units} units — upload it in Send to Amazon.`,
      warnings: res.warnings,
    });
  }

  const listCard = (on: boolean) => 'flex w-full flex-wrap items-center gap-x-3 rounded-lg border px-3 py-2.5 text-left '
    + (on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:bg-slate-50');
  const matchedList = (matched: BoxLine[]) => matched.length > 0 && (
    <span className="mt-1.5 w-full space-y-0.5">
      {matched.map((l) => (
        <span key={l.code} className="flex justify-between gap-2 font-mono text-xs text-amber-900">
          <span className="truncate">{l.code}</span>
          <span className="tabular-nums">×{l.qty}</span>
        </span>
      ))}
    </span>
  );

  return (
    <>
      {/* Shipment summary — counts only. The finishing steps live at the foot of the box list (owner, 2026-10-15). */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{boxes.length}</span> {boxes.length === 1 ? 'box' : 'boxes'} packed
          <span className="mx-2 text-slate-300">·</span>
          <span className="font-semibold text-slate-900">{totalUnits}</span> {totalUnits === 1 ? 'unit' : 'units'}
          <span className="mx-2 text-slate-300">·</span>
          your box: <span className="font-semibold text-slate-900">{mineUnits}</span>
        </div>
      </div>

      {/* The open box on the LEFT, the box list on the RIGHT (owner, 2026-10-16). The list stays first in the source so a phone, one
          column, still shows it above the box; md:order-last moves it right on a wider screen. */}
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="space-y-2 md:order-last">
          {/* FIND — "which box is this SKU in?". Its own input, NOT the scan box — a scan here would otherwise go into a box. */}
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value.toUpperCase())}
              placeholder="Find a SKU…"
              aria-label="Find which box a SKU is in"
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-7 text-sm uppercase placeholder:normal-case placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {find && (
              <button type="button" onClick={() => setFind('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-slate-400 hover:text-slate-700">×</button>
            )}
          </div>
          {q && (
            <div className="px-1 text-xs text-slate-500">
              {hits.length === 0 && mineHits.length === 0
                ? 'Not in any box'
                : `In ${hits.length + (mineHits.length ? 1 : 0)} ${hits.length + (mineHits.length ? 1 : 0) === 1 ? 'box' : 'boxes'}`}
            </div>
          )}

          {/* YOUR BOX — always at the top of the list (unless Find leaves it out). */}
          {(!q || mineHits.length > 0) && (
            <button type="button" onClick={() => { showMine(); refocus(); }} className={listCard(onMine)}>
              <CubeIcon className={'h-5 w-5 ' + (onMine ? 'text-brand-600' : 'text-slate-400')} />
              <span className="font-semibold text-slate-900">Your box</span>
              <span className="ml-auto text-right text-sm tabular-nums text-slate-500">
                {mineUnits} {mineUnits === 1 ? 'unit' : 'units'}
                {mineUnits > 0 && !dimsComplete(mine.dims) && <span className="block text-xs text-amber-700">needs size</span>}
              </span>
              {matchedList(mineHits)}
            </button>
          )}

          {/* PACKED BOXES — the stored ones, by number. A stored box that isn't packed (the legacy app's) says so in amber. */}
          {(q ? hits.map((h) => h.box) : boxes).map((b) => {
            const on = view === b.id;
            const units = boxUnits(b);
            return (
              <button key={b.id} type="button" onClick={() => { setView(b.id); setMenuOpen(false); setBoxError(null); refocus(); }}
                className={listCard(on)}>
                {b.locked
                  ? <CheckCircleIcon className={'h-5 w-5 ' + (on ? 'text-brand-600' : 'text-emerald-600')} aria-label="Packed" />
                  : <CubeIcon className="h-5 w-5 text-amber-600" />}
                <span className="font-medium text-slate-900">Box {b.id}</span>
                <span className="ml-auto text-right text-sm tabular-nums text-slate-500">
                  {units} {units === 1 ? 'unit' : 'units'}
                  {!b.locked && <span className="block text-xs text-amber-700">not packed</span>}
                </span>
                {q && matchedList(b.lines.filter(lineMatches))}
              </button>
            );
          })}

          {/* FINISH SHIPMENT — the end of the job, in the order it's done: 1 the shipping plan file, 2 the Amazon box-contents upload,
              3 Mark shipped. A PANEL folded to one line until clicked (owner, 2026-10-16); green with a tick once everything is packed.
              The status line is a guide only; the steps are usable any time, Mark shipped still behind its confirm. */}
          <div className={'mt-4 overflow-hidden rounded-lg border bg-white ' + (allPacked ? 'border-emerald-300' : 'border-slate-200')}>
            <button
              type="button"
              onClick={() => setFinishOpen((o) => !o)}
              aria-expanded={finishOpen}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50"
            >
              <span className={'flex h-8 w-8 shrink-0 items-center justify-center rounded-md '
                + (allPacked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                {allPacked ? <CheckCircleIcon className="h-5 w-5" /> : <TruckIcon className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">Finish shipment</span>
                <span className={'block text-xs ' + (allPacked ? 'text-emerald-700' : 'text-slate-500')}>
                  {boxes.length === 0 ? 'Nothing packed yet'
                    : allPacked ? 'All packed — ready'
                    : mineUnits > 0 ? 'Your box isn’t packed yet'
                    : `${notPacked.length} ${notPacked.length === 1 ? 'box' : 'boxes'} not packed`}
                </span>
              </span>
              <ChevronDownIcon className={'h-4 w-4 shrink-0 text-slate-400 transition-transform ' + (finishOpen ? 'rotate-180' : '')} />
            </button>
            {finishOpen && (<div className="space-y-2 border-t border-slate-200 bg-slate-50 p-2">
            <button
              type="button"
              disabled={totalUnits === 0}
              onClick={() => downloadShippingPlan(boxes)}
              title={totalUnits === 0 ? 'No packed boxes yet' : `Amazon shipping plan: ${totalUnits} units across ${boxes.length} ${boxes.length === 1 ? 'box' : 'boxes'}`}
              className={FINISH_BTN}
            >
              <span className="w-4 text-center text-xs font-semibold text-slate-400">1</span>
              <ArrowDownTrayIcon className="h-4 w-4 text-slate-400" />
              Shipping plan
            </button>
            {/* AMAZON UPLOAD — pick Amazon's box contents .xlsx, get it back filled in (see the header). */}
            <input ref={uploadRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onUploadFile(e.target.files?.[0])} />
            <button
              type="button"
              disabled={totalUnits === 0 || uploading}
              onClick={() => { setUpload(null); uploadRef.current?.click(); }}
              title={totalUnits === 0 ? 'No packed boxes yet' : 'Pick the box contents file from Send to Amazon — it comes back filled in'}
              className={FINISH_BTN}
            >
              <span className="w-4 text-center text-xs font-semibold text-slate-400">2</span>
              <ArrowUpTrayIcon className="h-4 w-4 text-slate-400" />
              {uploading ? 'Filling…' : 'Amazon upload'}
            </button>
            {upload && (
              <div className={'flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs '
                + (upload.error ? 'border-red-300 bg-red-50 text-red-800'
                  : upload.warnings.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
                <div className="flex-1">
                  {upload.error ? <>Amazon upload: {upload.error}</> : upload.done}
                  {upload.warnings.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {upload.warnings.map((w) => <li key={w}>{w}</li>)}
                    </ul>
                  )}
                </div>
                <button type="button" onClick={() => setUpload(null)} className="opacity-70 hover:opacity-100">×</button>
              </div>
            )}
            {/* MARK SHIPPED — clears the WHOLE stored shipment (owner, 2026-10-01): archive, stock off C3-Amazon, boxes emptied.
                RED, behind an inline confirm naming the boxes, units and the stock it takes; and that your box doesn't go. */}
            {confirmShip ? (
              <div role="alertdialog" className="space-y-2 rounded-md border-2 border-red-400 bg-red-50 p-2.5 text-sm">
                <div className="font-semibold text-red-800">Mark all {boxes.length} {boxes.length === 1 ? 'box' : 'boxes'} ({totalUnits} units) shipped?</div>
                <div className="text-xs text-red-700">Takes them off the C3-Amazon shelf and clears every box. This can’t be undone.</div>
                {mineUnits > 0 && (
                  <div className="text-xs font-semibold text-red-800">
                    Your box ({mineUnits} {mineUnits === 1 ? 'shoe' : 'shoes'}) isn’t packed, so it won’t go — it stays as your box.
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="button" disabled={shipping} onClick={ship}
                    className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                    {shipping ? 'Shipping…' : 'Yes, mark shipped'}
                  </button>
                  <button type="button" disabled={shipping} onClick={() => setConfirmShip(false)}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={totalUnits === 0}
                onClick={() => { setConfirmShip(true); setShipError(null); }}
                title={totalUnits === 0 ? 'No packed boxes to ship' : 'The boxes have gone — clear the whole shipment (asks first)'}
                className="flex w-full items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
              >
                <span className="w-4 text-center text-xs font-semibold text-red-400">3</span>
                <TruckIcon className="h-4 w-4 text-red-500" />
                Mark shipped
              </button>
            )}
            {shipError && <div className="px-1 text-xs text-red-700">{shipError}</div>}
            </div>)}
          </div>
        </div>

        {/* THE OPEN BOX — your box (scan into it, size it, Pack), or a stored box (look, reprint, Unpack). */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{onMine ? 'Your box' : `Box ${shown.id}`}</h2>
              <span className="text-sm text-slate-500">{boxUnits({ lines })} {boxUnits({ lines }) === 1 ? 'unit' : 'units'}</span>
              {!onMine && (shown.locked
                ? <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800"><CheckCircleIcon className="h-3 w-3" />PACKED</span>
                : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">NOT PACKED</span>)}
              {onMine && !printOn && <span className="text-xs text-slate-400">labels off</span>}
              <div className="ml-auto flex items-center gap-1.5">
                {onMine ? (
                  <>
                    <button
                      type="button"
                      onClick={undo}
                      disabled={history.length === 0}
                      title="Undo the last scan"
                      className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowUturnLeftIcon className="h-4 w-4" />
                      Undo
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => { setMenuOpen((o) => !o); setConfirmEmpty(false); }}
                        aria-label="More box actions"
                        aria-expanded={menuOpen}
                        title="More"
                        className={ICON_BTN + 'border-slate-300 text-slate-500 hover:bg-slate-50'}
                      >
                        <EllipsisHorizontalIcon className="h-4 w-4" />
                      </button>
                      {menuOpen && (
                        <>
                          {/* Click anywhere else closes it. */}
                          <div className="fixed inset-0 z-10" onClick={() => { setMenuOpen(false); setConfirmEmpty(false); refocus(); }} />
                          <div className="absolute right-0 z-20 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
                            <button type="button" onClick={togglePrint} className={MENU_ITEM + 'text-slate-700'}>
                              <PrinterIcon className="h-4 w-4 text-slate-400" />
                              <span className="flex-1">Print labels</span>
                              <span className={'text-xs font-medium ' + (printOn ? 'text-emerald-700' : 'text-slate-400')}>{printOn ? 'On' : 'Off'}</span>
                            </button>
                            <button type="button" onClick={emptyMine} disabled={mineUnits === 0}
                              className={MENU_ITEM + (confirmEmpty ? 'bg-amber-50 text-amber-800' : 'text-slate-700')}>
                              <ArchiveBoxXMarkIcon className="h-4 w-4 text-slate-400" />
                              {confirmEmpty ? `Take all ${mineUnits} out? Click again` : 'Empty box'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={pack}
                      disabled={!canPack}
                      title={mineUnits === 0 ? 'Nothing in your box yet'
                        : dimsComplete(mine.dims) ? 'Box done — store it and get its number'
                        : 'Put in its length, width, height and weight first'}
                      className="flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CheckCircleIcon className="h-4 w-4" />
                      {working ? 'Packing…' : 'Pack box'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => unpack(shown)}
                    disabled={mineUnits > 0 || working}
                    title={mineUnits > 0 ? 'Pack or empty your box first' : 'Moves it back into your box to change it — the boxes after it move down one'}
                    className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ArrowUturnUpIcon className="h-4 w-4" />
                    {working ? 'Moving…' : shown.locked ? 'Unpack' : 'Move to your box'}
                  </button>
                )}
              </div>
            </div>
            {!onMine && mineUnits > 0 && (
              <p className="mb-2 text-xs text-slate-500">To change this box, pack or empty your box first — then {shown.locked ? 'Unpack' : 'Move to your box'} brings it back into yours.</p>
            )}
            {boxError && <div className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{boxError}</div>}
            <input
              ref={scanRef}
              autoFocus
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(); } }}
              placeholder="Scan a shoe into your box"
              aria-label="Scan into your box"
              aria-invalid={scanError ? true : undefined}
              className={'h-12 w-full rounded-md border px-4 font-mono text-lg text-slate-900 placeholder:font-sans placeholder:text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 '
                + (scanError ? 'border-red-500 bg-red-50 focus:ring-red-500' : 'border-slate-300 focus:ring-brand-500')}
            />
            {/* Always mounted (a live region must exist before its message arrives), but takes no space until there is one. */}
            <div className={scanError || lastScan ? 'mt-1.5 text-sm' : ''} role="status" aria-live="assertive">
              {scanError ? (
                <div className="rounded-md border border-red-300 bg-red-100 px-3 py-2 font-medium text-red-800">
                  <span className="font-mono">{scanError.scan}</span>: {scanError.message}
                  {scanError.title && <div className="text-xs font-normal text-red-700">{scanError.title}</div>}
                </div>
              ) : lastScan && (
                <span className="text-emerald-700">
                  Added <span className="font-mono">{lastScan.code}</span> to your box
                  {lastScan.printed && ' · label printed'}
                </span>
              )}
            </div>
          </div>

          {/* PACKED — the number the box was just given (owner, 2026-10-16: "then tell them their box num"). Big, so it gets written on
              the carton. Stays until closed or the next shoe goes in. */}
          {onMine && mine.lastPacked !== null && (
            <div role="status" className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-emerald-50 px-4 py-3">
              <CheckCircleIcon className="h-7 w-7 text-emerald-600" />
              <span className="flex-1 text-emerald-900">
                <span className="block text-xl font-bold">Packed — that’s Box {mine.lastPacked}</span>
                <span className="text-sm">Write {mine.lastPacked} on the carton. Scan the next shoe to start the next box.</span>
              </span>
              <button type="button" onClick={() => router.push('/goods-in')}
                className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <InboxArrowDownIcon className="h-4 w-4" />Back to Goods In
              </button>
              <button type="button" onClick={() => { dismissPacked(user); refocus(); }} aria-label="Close"
                className="rounded px-2 py-1 text-lg text-emerald-700 hover:bg-emerald-100">×</button>
            </div>
          )}

          {/* MEASUREMENTS — your box's size and weight on ONE row above the contents, then the two quick fills. A stored box shows
              its measurements as text: it can't change in place. */}
          <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-2.5">
            {onMine ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-sm font-medium text-slate-700">Size</span>
                <div className="flex flex-wrap items-center gap-2">
                  {FIELDS.map((f) => (
                    <label key={f.key} className="relative block" title={`${f.label} (${f.unit})`}>
                      <span className="sr-only">{f.label}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={mine.dims[f.key]}
                        onChange={(e) => setDim(f.key, e.target.value)}
                        // ENTER ON WEIGHT PACKS (owner, 2026-10-16): weight is the last field, so Enter there with all four filled packs.
                        onKeyDown={f.key === 'weight' ? (e) => {
                          if (e.key !== 'Enter' || !canPack) return;
                          e.preventDefault();
                          void pack();
                        } : undefined}
                        placeholder={f.label}
                        className="h-8 w-24 rounded-md border border-slate-300 bg-white pl-2 pr-8 text-right text-sm tabular-nums text-slate-900 placeholder:text-left placeholder:text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{f.unit}</span>
                    </label>
                  ))}
                </div>
                {/* QUICK FILL (owner, 2026-10-01). Birk box = the standard carton's three sides; weight is left alone because it depends
                    on what's packed. Set saves your box's typed size, or fills an empty one with the saved size (setButton). */}
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => { fillDims(BIRK_BOX); refocus(); }}
                    title={`${BIRK_BOX.length} × ${BIRK_BOX.width} × ${BIRK_BOX.height} cm — weight left for you to enter`}
                    className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Birk box
                  </button>
                  <button
                    type="button"
                    onClick={setButton}
                    title="Typed a size? Set saves it. Empty size? Set fills in the saved one."
                    className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Set
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-600">
                <span className="font-medium text-slate-700">Size</span>{' '}
                {dimsComplete(dims)
                  ? <span className="tabular-nums">{dims.length} × {dims.width} × {dims.height} cm · {dims.weight} kg</span>
                  : <span className="text-amber-700">not measured</span>}
              </div>
            )}
            {warning && <div className="mt-1.5 text-xs text-amber-700">{warning}</div>}
          </div>

          {lines.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              {onMine ? 'Nothing in your box yet — scan a shoe to start.' : `Nothing in Box ${shown.id}.`}
            </div>
          ) : (
            // CONTENTS (owner, 2026-10-16): the shoe's groupid with its title under it, its size big, the qty. The line a good scan just
            // went to flashes green and its qty pops — re-keyed by the scan's number so a repeat scan replays it.
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-medium">Shoe</th>
                  <th className="px-4 py-2 text-center font-medium">Size</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="w-20 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const justScanned = onMine && lastScan?.code === l.code;
                  return (
                  <tr key={justScanned ? `${l.code}#${lastScan?.n}` : l.code}
                    className={'border-b border-slate-100 last:border-0 ' + (lineMatches(l) ? 'bg-amber-50' : justScanned ? 'animate-scan-flash' : '')}>
                    <td className="px-4 py-2.5">
                      {/* Led by the groupid (owner, 2026-10-16) — the packer reads the style off the box, the title is the reminder. */}
                      <div className="font-medium text-slate-900">{l.groupid || l.code}</div>
                      {l.title && <div className="text-xs text-slate-500">{l.title}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-lg font-semibold tabular-nums text-slate-900">{sizeOf(l.code)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={'inline-block text-lg font-semibold tabular-nums text-slate-900 ' + (justScanned ? 'animate-qty-bump' : '')}>{l.qty}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {l.fnsku && (
                        <button
                          type="button"
                          onClick={() => printLabel(l.fnsku!, l.code)}
                          aria-label={`Print a label for ${l.code}`}
                          title={`Print one ${l.fnsku} label`}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <PrinterIcon className="h-4 w-4" />
                        </button>
                      )}
                      {onMine && <button
                        type="button"
                        onClick={() => takeOne(l.code)}
                        aria-label={`Take one ${l.code} out`}
                        title="Take one out"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <MinusIcon className="h-4 w-4" />
                      </button>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
