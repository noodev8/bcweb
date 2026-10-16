'use client';
/*
=======================================================================================================================================
Page: /amz-shipment  (AMZ Shipment — packing the Amazon boxes)
=======================================================================================================================================
Purpose: Where the FBA boxes get packed. Pick's Amazon tab gathers the units flagged for Amazon onto the C3-Amazon shelf; this screen is
         the next step — scanning those shoes into numbered boxes, then sending the shipment.

LAYOUT ONLY (owner, 2026-09-28: "just do the layout for now. users need to be able to scan shoes into an amz box").

BOXES FROM THE DB (owner, 2026-09-29). The boxes live in the legacy `amzshipment` table (one row per box + Amazon SKU, with the
code, fnsku, qty and the box's measurements on every row); GET /amz-shipment-boxes reads them and they become this screen's starting
boxes — numbers, contents and measurements as stored.

SAVING (owner, 2026-10-06: "THE BOXES AREN'T SAVING?" → save every change). Each change is written the moment it's made: a good scan,
− and Undo via POST /amz-shipment-line (+1/−1), Delete box via /amz-shipment-box-delete, Empty box via /amz-shipment-box-empty, measurements via /amz-shipment-dims when a
field is left or a quick fill is used. The screen updates at once and the writes queue behind it in order (persist), so a fast run
of scans can't arrive out of order. A failed save shows a red bar with Reload — the screen may no longer match the DB, and reloading
puts it back to what is stored. A new box is only stored once something is in it (there's no row to hold an empty one), so an empty
box doesn't survive a reload; its typed measurements go in with its first unit.

MARK SHIPPED (owner, 2026-10-01: "the shipped button should clear the whole shipment"). Live. POST /amz-shipment-ship, one transaction:
the stored shipment is archived to amzshipment_archive under a new shipment id, the boxed units come off the C3-Amazon shelf
(soft-deleted), and amzshipment is emptied. It waits for any queued saves, then sends the packed boxes and units it showed, so the
server refuses if the stored shipment differs (a failed save, or the legacy app packing too). Codes boxed with nothing on C3-Amazon to
take are listed in the notice afterwards. See the route header for the detail.

LOCK (owner, 2026-10-15: "if a box is done they lock whats in it and its values"). Lock box fixes a packed box's contents and
measurements until Unlock: no scans in, no −, no Undo into it, no Empty / Delete, size fields read-only. Stored in amzshipment.locked
(POST /amz-shipment-box-lock) so every bench sees it, and the write routes refuse a locked box. Goods In starts a new box rather than
adding to a locked one. Arriving from Goods In (?box=newest) opens the newest box as stored — locked or not; arriving changes nothing.
NEXT BOX (owner, 2026-10-16). Locking a box shows "Box n locked" with Start next box and Back to Goods In — unless the tick-box in the
header's Goods In button is ticked: then locking goes straight back to Goods In, whichever screen they came from.
Scanning a shoe while a locked box is open starts the next box and puts the shoe in it — only once the scan has passed the check, and
loudly: a "New box" banner over the scan field and a rising chime, so nobody packs it into the locked carton. Every start goes through
newBox (re-reads the stored boxes), so with two benches the number is always free.
WARN ON NEW BOX WHILE ONE IS OPEN (owner, 2026-10-15: "dont let user start a new box if their box hasnt been locked", then "dont STOP
users making a new box if ones unlocked (incase multiple ppl) just warn them"). While any box is unlocked a line under New box names
it, one click away — New box still works, as the open box may be someone else's on the other bench. Goods In shows the same warning
as a standing strip (goods-in/page.tsx). New box re-reads the stored boxes first (see newBox), so a box the other bench started is
seen and the new number is never one that already exists.

FIND (owner, 2026-10-01). "Which box is this SKU in?" — the box above the list narrows it to boxes holding a match (code, Amazon SKU,
FNSKU or title) and names the matching codes under each; the matching lines are highlighted in the open box.

KEPT SIMPLE (owner, 2026-10-16: "dont want them to really need to think"). The box's rare actions (Print labels switch, Empty, Delete)
sit in a ⋯ menu beside Undo, a small "labels off" shows by the box name while printing is off; Finish shipment is folded to one
line (green with a tick once every packed box is locked); the contents show the shoe's name and size big, codes small; and a good
scan flashes its line green and pops the qty (the animations are in tailwind.config.js).

SCANNING. A barcode scanner types the code and presses Enter, so the scan box is just an input that commits on Enter and keeps focus —
scan, scan, scan with no clicks. Every scan goes into the ACTIVE box (highlighted on the left); click another box, or New box, to switch.
The same code scanned twice is one line with qty 2. − takes one off a line; Undo takes off the last scan wherever it went.

SCAN CHECK (owner, 2026-10-02). Every scan is looked up (GET /amz-shipment-scan — our code, the EAN or the FNSKU all resolve to the
product) BEFORE it goes in a box, and is refused if it isn't a product we know, or if Amazon hasn't given it an FNSKU ("it needs to have
an fnsku to go in an amz box"). A refused scan goes in no box: the scan field turns red, the reason shows under it with the product's name,
and the browser beeps — the packer is looking at the shoe, not the screen. It clears on the next good scan. A line made by a good scan
carries the product's code, Amazon SKU, FNSKU and title like a stored one, so an EAN and an FNSKU scan of the same shoe are one line.

FNSKU LABELS (owner, 2026-10-02: "print a fnsku label when its scanned"). Every good scan prints one 54 × 25 mm Dymo label — the FNSKU's image from the
barcode folder, as the old system printed, with our code under it (2026-10-08) — via src/lib/fnskuLabel.ts (silent on the packing PC's --kiosk-printing Chrome shortcut, a print dialog anywhere else).
A refused scan prints nothing, and NEITHER DOES SCANNING THE FNSKU ITSELF (owner, 2026-10-09): a shoe whose FNSKU barcode can be scanned
is already labelled, so a scan that matches the product's FNSKU boxes it without printing. "Print labels" switches it off for shoes already labelled; the switch is remembered in this browser, as
it belongs to the bench, not the shipment. The printer icon on a line reprints that line's label (a jam, a smudge, a test).

MEASUREMENTS (owner, 2026-09-28). Once a box is packed, its length, width and height (cm) and weight (kg) go in above its contents (moved up 2026-10-15) —
Amazon wants all four for every carton. A box with units but no full set is flagged "needs size" in the list. Amazon's standard-carton
limits (63.5 cm on any side, 23 kg) are shown as a warning only; nothing blocks. Two quick fills (owner, 2026-10-01): "Birk box" puts in
the Birkenstock carton's sides (BIRK_BOX — weight left blank, it depends on the contents), and "Set" (one click, 2026-10-15) saves the open
box's typed size in this browser, or fills an empty box with the saved size — the same box size packed again and again isn't retyped.

SHIPPING PLAN (owner, 2026-10-01: "a button that makes my amz shipping plan file ... essentially just a list of whats in all the boxes").
Downloads Amazon-ShippingPlan.txt, the Seller Central shipping-plan upload, in the legacy app's exact layout: the template's header block,
then "Merchant SKU<TAB>Quantity", one line per Amazon SKU totalled across every box, CRLF line ends. Built from the boxes on screen
(every line carries its Amazon SKU — stored ones from the DB, scanned ones from the scan lookup). No measurements in this file, so it
doesn't wait for them.

AMAZON UPLOAD (owner, 2026-10-06: "we need the amz upload to fill in the details for this file ... they need to know what items are in
what boxes and all box sizes"). Pick the box contents .xlsx Amazon gives you in Send to Amazon; the screen fills in the box count,
each SKU's quantity per box and every box's weight and size, and downloads it as <name>-filled.xlsx to upload back. Done in the
browser by src/lib/amzBoxUpload.ts (read its header) — the file never goes to our server. Problems (quantities that don't match
Amazon's expected, missing sizes…) are listed but the file is still made; only a file it can't fill is refused. Our boxes are
Amazon's B1..Bn in order, which is why Delete box renumbers.
=======================================================================================================================================
*/

import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PlusIcon, MinusIcon, CubeIcon, ArchiveBoxXMarkIcon, ArrowUturnLeftIcon, TrashIcon, TruckIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, MagnifyingGlassIcon, PrinterIcon,
  InboxArrowDownIcon, LockClosedIcon, LockOpenIcon, EllipsisHorizontalIcon, ChevronRightIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import {
  getAmzShipmentBoxes, shipAmzShipment, lookupAmzShipmentScan, saveAmzShipmentLine, saveAmzShipmentDims, deleteAmzShipmentBox, emptyAmzShipmentBox, setAmzShipmentBoxLock,
  type AmzBox, type AmzShipResult, type AmzScanHit,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { printFnskuLabel } from '@/lib/fnskuLabel';
import { fillAmazonBoxFile } from '@/lib/amzBoxUpload';

// sku / fnsku / title come with every line — from the DB for a stored line, from the scan lookup for one scanned here.
interface BoxLine { code: string; qty: number; sku?: string; fnsku?: string; title?: string; }
// Measurements are held as typed (strings), so a half-typed "12." isn't rewritten under the cursor.
interface BoxDims { length: string; width: string; height: string; weight: string; }
// locked = the box is done (owner, 2026-10-15): contents and measurements fixed until unlocked. Stored on the server (amzshipment.locked).
interface Box { id: number; lines: BoxLine[]; dims: BoxDims; locked: boolean; }

// The Finish shipment steps — full width, quiet: outline, numbered, nothing that shouts before it's time.
const FINISH_BTN = 'flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white';
// The box header's small square button (the ⋯ menu).
const ICON_BTN = 'flex items-center gap-1 rounded-md border p-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ';
// A row in the box's ⋯ menu.
const MENU_ITEM = 'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ';
const NO_DIMS: BoxDims = { length: '', width: '', height: '', weight: '' };
const newBoxOf = (id: number): Box => ({ id, lines: [], dims: NO_DIMS, locked: false });
const boxUnits = (b: Box) => b.lines.reduce((n, l) => n + l.qty, 0);
// Size = the code's suffix after the last '-' (CLAUDE.md: not the last two characters — half sizes and UK sizes).
const sizeOf = (code: string) => code.slice(code.lastIndexOf('-') + 1);
const fromDb = (b: AmzBox): Box => ({
  id: b.box,
  lines: b.lines.map((l) => ({ code: l.code, qty: l.qty, sku: l.sku, fnsku: l.fnsku, title: l.title })),
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

// A box started by itself (a scan into a locked box): two rising notes — the opposite of the refusal's low beeps, so the packer hears
// "something new happened" without it sounding like an error. Failures ignored, the banner still says it.
function chimeNewBox() {
  try {
    const ctx = new AudioContext();
    [[0, 660], [0.16, 990]].forEach(([at, hz]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      gain.gain.value = 0.2;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.14);
    });
    setTimeout(() => ctx.close(), 600);
  } catch { /* silent; the banner still says it */ }
}

// Print labels on/off — remembered per browser (the bench's setting, see FNSKU LABELS). Default on; storage failures just mean on.
const PRINT_KEY = 'amzShipment.printLabels';
function loadPrintOn(): boolean {
  try { return localStorage.getItem(PRINT_KEY) !== '0'; } catch { return true; }
}
function savePrintOn(on: boolean) {
  try { localStorage.setItem(PRINT_KEY, on ? '1' : '0'); } catch { /* not remembered */ }
}

// AUTO BACK TO GOODS IN (owner, 2026-10-16: "if they working goods in they may not want to keep needing to click"). Ticked: locking a
// box goes straight back there, whichever screen they came from. Unticked: the Start next box / Back to Goods In panel asks. Remembered per
// browser like Print labels — it's the bench's way of working. Default unticked; storage failures just mean unticked.
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

// Loads the packed boxes, then hands them to Packing as its starting state (so Packing's useState seeds from real data, no effect).
// After Mark shipped (or Reload after a failed save) the boxes are re-read and Packing is REMOUNTED (key = round) so it re-seeds from
// the DB — its useState only reads `initial` once, so a re-render alone would leave the old boxes on screen.
// useSearchParams needs a Suspense boundary for Next's build, so the page body is AmzShipmentContent and this is a thin wrapper — the
// same split /amazon-order uses.
export default function AmzShipmentPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <AmzShipmentContent />
    </Suspense>
  );
}

function AmzShipmentContent() {
  // ?box=newest (the Goods In button): open the newest box. Read through Next's router, NOT window.location — on an in-app
  // navigation window.location can still be Goods In's URL when this first renders, which is why it kept opening Box 1.
  const startNewest = useSearchParams().get('box') === 'newest';
  // FRESH ON ARRIVAL (owner, 2026-10-15; fixed 2026-10-16). Packing seeds from `initial` only once, so it must be seeded from THIS
  // visit's read, never the boxes SWR cached on the last visit — that showed boxes locked since as unlocked, and missed a box Goods In
  // had just started. Waiting on `busy` didn't do it: on the first render SWR hasn't begun its re-read yet, so the stale cache got
  // through. So every visit reads under its OWN cache key: nothing cached, `isLoading` until the fresh read lands. reload() re-reads
  // the same key and remounts Packing.
  const [visit] = useState(() => Math.random());
  // Held here because its tick-box sits in the header, in the Goods In button.
  const [autoBack, setAutoBack] = useState(loadAutoBack);
  const { data, error, isLoading, refresh } = useApiQuery(['amz-shipment-boxes', visit], getAmzShipmentBoxes);
  const [round, setRound] = useState(0);
  const [shipped, setShipped] = useState<AmzShipResult | null>(null);

  async function reload() {
    await refresh();
    setRound((n) => n + 1);
  }

  async function onShipped(r: AmzShipResult) {
    setShipped(r);
    await reload();
  }

  return (
    // Goods In and this screen link to each other (owner, 2026-10-15).
    // The AUTO BACK tick-box sits INSIDE the Goods In button — one bordered pill holding the tick-box and the link side by side (a
    // checkbox can't go inside the <a>, or ticking it would navigate). Shown whichever screen they came from (owner, 2026-10-16).
    <AppShell title="AMZ Shipment" headerRight={
        <div className="flex items-center rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:border-slate-400">
          <input
            type="checkbox"
            checked={autoBack}
            onChange={(e) => { setAutoBack(e.target.checked); saveAutoBack(e.target.checked); }}
            title={autoBack ? 'Locking a box goes straight back to Goods In — untick to be asked' : 'Tick to go straight back to Goods In after locking a box'}
            aria-label="Go straight back to Goods In after locking a box"
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
        <Packing key={round} initial={data.boxes.map(fromDb)} startNewest={startNewest} autoBack={autoBack} onShipped={onShipped} onReload={reload} />
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

function Packing({ initial, startNewest, autoBack, onShipped, onReload }: {
  initial: Box[]; startNewest: boolean; autoBack: boolean; onShipped: (r: AmzShipResult) => Promise<void>; onReload: () => Promise<void>;
}) {
  // No boxes packed yet -> one empty Box 1 to scan into.
  const [boxes, setBoxes] = useState<Box[]>(initial.length ? initial : [newBoxOf(1)]);
  const router = useRouter();
  // Arriving from Goods In (?box=newest, owner 2026-10-15) opens the NEWEST box — the one that bench has just been filling — exactly as
  // it is stored. If it's locked it shows locked: arriving never starts or unlocks anything (owner, 2026-10-16: Goods In only ever
  // scans shoes into a NEW box). A scan into it then starts the next box (see onScan).
  const [activeId, setActiveId] = useState(() => {
    if (!initial.length) return 1;
    return startNewest ? Math.max(...initial.map((b) => b.id)) : initial[0].id;
  });
  // NEW BOX STARTED FOR YOU (owner, 2026-10-16: "make that obvs to the user") — the banner over the scan field saying a scan into a
  // locked box started a new one. Stays until closed or another box is picked.
  const [autoStarted, setAutoStarted] = useState<{ from: number; to: number } | null>(null);
  // AFTER LOCK (owner, 2026-10-16): the box just locked, so the panel asking "start the next box?" shows under it.
  const [lockedAsk, setLockedAsk] = useState<number | null>(null);
  // A scan into a locked box starts ONE new box, even if the scanner fires again before it's made: keyed by the locked box, the
  // in-flight start is shared. Cleared when that box is picked again, unlocked or locked anew. `announced` = starts already bannered and chimed.
  const autoNext = useRef(new Map<number, Promise<number | null>>());
  const announced = useRef(new WeakSet<Promise<number | null>>());
  const [scan, setScan] = useState('');
  // Every scan in order, so Undo can take off the last one whichever box it went into.
  const [history, setHistory] = useState<{ boxId: number; code: string }[]>([]);
  // `printed` says whether that scan printed a label, so the confirmation line doesn't claim one when it didn't. `n` numbers the scan
  // so the same shoe scanned twice still replays the line's green flash (the row is re-keyed by it).
  const [lastScan, setLastScan] = useState<{ boxId: number; code: string; printed?: boolean; n: number } | null>(null);
  const scanCount = useRef(0);
  // The last scan refused by SCAN CHECK — drives the red scan field and the message under it.
  const [scanError, setScanError] = useState<{ scan: string; message: string; title?: string } | null>(null);
  // Good lookups this visit, by what was scanned, so a run of the same shoe is one round trip. Only products WITH an FNSKU are kept:
  // a refused one is asked again next time, in case Amazon's import has given it one since.
  const scanCache = useRef(new Map<string, AmzScanHit>());
  // Lazy initialiser: read once on mount (this component only renders client-side after the boxes load), no effect needed.
  const [printOn, setPrintOn] = useState(loadPrintOn);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // The box's ⋯ menu (print switch, Empty, Delete) — the rarely-used actions, out of the packer's way (owner, 2026-10-16).
  const [menuOpen, setMenuOpen] = useState(false);
  // FINISH SHIPMENT starts folded to one line (owner, 2026-10-16): it's done once per shipment, not while packing.
  const [finishOpen, setFinishOpen] = useState(false);
  // LOCK PROMPT (owner, 2026-10-15): once a packed box's four measurements are all in, ask whether to lock it. Asked once per box —
  // "Not now" isn't repeated on the next field left — until its measurements stop being complete again.
  const [lockAsk, setLockAsk] = useState<number | null>(null);
  const lockAsked = useRef(new Set<number>());
  const [confirmShip, setConfirmShip] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  // FIND — which box is a SKU in? Matches code, Amazon SKU, FNSKU or title, case-insensitive, across every box.
  const [find, setFind] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);
  // SAVING (see the header): writes run one after another on this chain, in the order the changes were made.
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const [saveError, setSaveError] = useState<string | null>(null);
  // AMAZON UPLOAD: the hidden file picker, and what the last fill did (warnings stay on screen until closed).
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [upload, setUpload] = useState<{ error?: string; done?: string; warnings: string[] } | null>(null);

  function persist(what: string, call: () => Promise<{ success: boolean; error?: string }>) {
    saveChain.current = saveChain.current.then(async () => {
      try {
        const res = await call();
        if (!res.success) setSaveError(`${what} wasn’t saved: ${res.error || 'error'}`);
      } catch {
        setSaveError(`${what} wasn’t saved: no connection to the server`);
      }
    });
  }

  async function ship() {
    setShipping(true);
    setShipError(null);
    await saveChain.current;
    const res = await shipAmzShipment(packedBoxes, totalUnits);
    setShipping(false);
    setConfirmShip(false);
    if (!res.success || !res.data) { setShipError(res.error || 'Couldn’t mark the shipment shipped'); return; }
    await onShipped(res.data);
  }

  const q = find.trim().toLowerCase();
  const lineMatches = (l: BoxLine) => q !== '' && [l.code, l.sku, l.fnsku, l.title].some((v) => (v || '').toLowerCase().includes(q));
  // Per box, the lines that match — drives the results list and the highlight in the box list and the open box.
  const hits = q ? boxes.map((b) => ({ box: b, lines: b.lines.filter(lineMatches) })).filter((h) => h.lines.length > 0) : [];

  const active = boxes.find((b) => b.id === activeId) ?? boxes[0];
  const totalUnits = boxes.reduce((n, b) => n + boxUnits(b), 0);
  // What Mark shipped sends: the packed boxes and units on screen, which (saves done) are the stored shipment. An empty box has no
  // rows in the table, so it isn't counted. The server refuses if its own counts differ.
  const packedBoxes = boxes.filter((b) => boxUnits(b) > 0).length;
  // Packed boxes still missing a measurement — the summary counts them, the list flags each.
  const needSize = boxes.filter((b) => boxUnits(b) > 0 && !dimsComplete(b.dims)).length;
  // Shown in the Finish shipment heading as a guide only — Mark shipped doesn't wait for locks (owner, 2026-10-15).
  const lockedBoxes = boxes.filter((b) => boxUnits(b) > 0 && b.locked).length;
  const allLocked = packedBoxes > 0 && lockedBoxes === packedBoxes;
  const warning = dimsWarning(active.dims);
  const refocus = () => scanRef.current?.focus();

  // `info` is the product a new line is made from (a scan's lookup); taking one off an existing line needs only the code.
  function addTo(boxId: number, code: string, delta: 1 | -1, info?: Omit<BoxLine, 'code' | 'qty'>) {
    const dims = boxes.find((b) => b.id === boxId)?.dims;
    persist(delta > 0 ? `Adding ${code} to Box ${boxId}` : `Taking ${code} out of Box ${boxId}`,
      () => saveAmzShipmentLine(boxId, code, delta, dims));
    setBoxes((prev) => prev.map((b) => {
      if (b.id !== boxId) return b;
      const hit = b.lines.find((l) => l.code === code);
      if (!hit) return delta > 0 ? { ...b, lines: [{ ...info, code, qty: delta }, ...b.lines] } : b;
      const lines = b.lines.map((l) => (l.code === code ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0);
      return { ...b, lines };
    }));
  }

  // SCAN CHECK (see the header): look the scan up, refuse it red if it's unknown or has no FNSKU, otherwise box it under its real code.
  // The box is fixed at the moment of the scan, so clicking another box while the lookup is in flight can't redirect it.
  async function onScan() {
    const raw = scan.trim().toUpperCase();
    setScan('');
    if (!raw) return;
    let boxId = active.id;
    const fromLocked = active.locked ? active.id : null;
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
    // SCAN INTO A LOCKED BOX (owner, 2026-10-16) starts the next box and puts the shoe in it — after the check above, so a refused scan
    // never starts a box. Made obvious: a banner over the scan field and a rising two-note chime (distinct from the refusal beep).
    if (fromLocked !== null) {
      let pending = autoNext.current.get(fromLocked);
      if (!pending) { pending = newBox(); autoNext.current.set(fromLocked, pending); }
      const id = await pending;
      if (id === null) {
        refuse({ scan: raw, message: `Box ${fromLocked} is locked and a new box couldn’t be started — try New box. Not added.` });
        return;
      }
      boxId = id;
      if (!announced.current.has(pending)) {
        announced.current.add(pending);
        setAutoStarted({ from: fromLocked, to: id });
        chimeNewBox();
      }
    }
    const { code, sku, fnsku, title } = hit;
    addTo(boxId, code, 1, { sku, fnsku, title });
    setHistory((h) => [...h, { boxId, code }]);
    // Scanned the FNSKU itself -> the shoe already wears its label; don't print another (see FNSKU LABELS in the header).
    const printed = printOn && raw !== fnsku.toUpperCase();
    setLastScan({ boxId, code, printed, n: ++scanCount.current });
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
    if (active.locked) return;
    addTo(active.id, code, -1);
    // Drop that box's most recent scan of this code from the history too, so Undo never re-removes it.
    setHistory((h) => {
      const i = h.map((x) => x.boxId === active.id && x.code === code).lastIndexOf(true);
      return i < 0 ? h : [...h.slice(0, i), ...h.slice(i + 1)];
    });
    setLastScan(null);
    refocus();
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last || boxes.find((b) => b.id === last.boxId)?.locked) return;
    addTo(last.boxId, last.code, -1);
    setHistory((h) => h.slice(0, -1));
    setActiveId(last.boxId);
    setLastScan(null);
    refocus();
  }

  // The box the warning under New box names (see the header): the first one not locked — an empty box counts, scan into it instead.
  const openBox = boxes.find((b) => !b.locked);

  // CHECKED AGAINST THE STORED BOXES (owner, 2026-10-15 — two people packing at once). This screen reads the boxes only on arrival, so
  // its list can be behind the other bench. New box waits for this screen's queued saves, re-reads the stored boxes and takes them as
  // the list: the new number is one past the highest box that really exists, and a box the other bench started shows up (and, while
  // unlocked, in the warning). It never refuses over an unlocked box — warning only. A failed read starts nothing. An empty box on this
  // screen isn't stored, so it drops out of the list here and the new box takes its place.
  const [checkingNew, setCheckingNew] = useState(false);
  const [newBoxError, setNewBoxError] = useState<string | null>(null);
  // Returns the new box's number, or null when nothing was started. Used by New box, Start next box and a scan into a locked box.
  async function newBox(): Promise<number | null> {
    if (checkingNew) return null;
    setCheckingNew(true);
    setNewBoxError(null);
    await saveChain.current;
    const res = await getAmzShipmentBoxes();
    setCheckingNew(false);
    if (!res.success || !res.data) { setNewBoxError(`Couldn’t check the stored boxes: ${res.error || 'error'} — try again`); refocus(); return null; }
    const stored = res.data.boxes.map(fromDb);
    setLastScan(null);
    setLockedAsk(null);
    const id = Math.max(0, ...stored.map((b) => b.id)) + 1;
    setBoxes([...stored, newBoxOf(id)]);
    setActiveId(id);
    refocus();
    return id;
  }

  function setDim(key: keyof BoxDims, value: string) {
    if (active.locked) return;
    const clean = value.replace(/[^0-9.]/g, '');
    setBoxes((prev) => prev.map((b) => (b.id === active.id ? { ...b, dims: { ...b.dims, [key]: clean } } : b)));
  }

  // Quick fill: write the given measurements into the open box. Only non-blank values are written, so Birk box (no weight) and a Set
  // with a field left empty keep whatever that box already had there.
  function fillDims(d: Partial<BoxDims>) {
    if (active.locked) return;
    const next = { ...active.dims };
    for (const f of FIELDS) { const v = (d[f.key] ?? '').trim(); if (v) next[f.key] = v; }
    setBoxes((prev) => prev.map((b) => (b.id === active.id ? { ...b, dims: next } : b)));
    saveDims(active.id, next);
  }

  // AMAZON UPLOAD (see the header). Waits for queued saves so the file matches what is stored, then fills and downloads.
  async function onUploadFile(file: File | undefined) {
    if (uploadRef.current) uploadRef.current.value = '';   // so picking the same file again still fires
    if (!file) return;
    setUploading(true);
    await saveChain.current;
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

  // Measurements are saved when a field is left (not per keystroke) and by the quick fills.
  function saveDims(boxId: number, dims: BoxDims) {
    persist(`Box ${boxId} measurements`, () => saveAmzShipmentDims(boxId, dims));
    const box = boxes.find((b) => b.id === boxId);
    if (!dimsComplete(dims)) { lockAsked.current.delete(boxId); return; }
    if (box && !box.locked && boxUnits(box) > 0 && !lockAsked.current.has(boxId)) {
      lockAsked.current.add(boxId);
      setLockAsk(boxId);
    }
  }

  // SET (owner, 2026-10-15) — for packing the same size box again and again without retyping it. One click, no panel, no message:
  //   the open box has measurements typed  -> they become Set's saved values;
  //   the open box has none                -> the saved values are filled in.
  function setButton() {
    if (FIELDS.some((f) => active.dims[f.key].trim() !== '')) savePreset(active.dims);
    else fillDims(loadPreset());
    refocus();
  }

  // LOCK (owner, 2026-10-15): a finished box's contents and measurements are fixed until it's unlocked — every change on this screen is
  // blocked for it, and the server refuses one anyway. Only a box with something in it can be locked (an empty box isn't stored).
  // Locking only once the box is MEASURED AND WEIGHED (owner, 2026-10-15) — all four fields; unlocking always works.
  async function toggleLock() {
    if (boxUnits(active) === 0 || (!active.locked && !dimsComplete(active.dims))) return;
    const id = active.id;
    const locked = !active.locked;
    // AUTO BACK (ticked — whichever screen they came from, owner 2026-10-16): the lock is written straight away — after any queued saves, not queued itself, as the
    // page is about to go — and only once it's stored do we leave. A refusal stays here and says why.
    if (locked && autoBack) {
      setLockAsk(null);
      await saveChain.current;
      const res = await setAmzShipmentBoxLock(id, true);
      if (!res.success) { setSaveError(`Locking Box ${id} wasn’t saved: ${res.error || 'error'}`); return; }
      setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, locked: true } : b)));
      router.push('/goods-in');
      return;
    }
    persist(`${locked ? 'Locking' : 'Unlocking'} Box ${id}`, () => setAmzShipmentBoxLock(id, locked));
    setLockAsk(null);
    // Just locked -> ask "start the next box?" right there (see AFTER LOCK). A fresh lock (or an unlock) means a later scan into it
    // starts a fresh box, not one remembered from before.
    setLockedAsk(locked ? id : null);
    autoNext.current.delete(id);
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, locked } : b)));
    setConfirmEmpty(false);
    setConfirmDelete(false);
    setMenuOpen(false);
    refocus();
  }

  function selectBox(id: number) {
    setActiveId(id);
    setLockAsk(null);
    setLockedAsk(null);
    setAutoStarted(null);
    autoNext.current.delete(id);
    setMenuOpen(false);
    setConfirmDelete(false);
    setConfirmEmpty(false);
    setLastScan(null);
    refocus();
  }

  // Empty the active box (owner, 2026-10-15): everything out, the box kept — same number, same measurements, no renumbering, so it can
  // be packed again. Always confirmed inline first. Its scans leave Undo's history, so Undo can't take out a unit that's already gone.
  function emptyActive() {
    if (boxUnits(active) === 0 || active.locked) return;
    if (!confirmEmpty) { setConfirmEmpty(true); setConfirmDelete(false); return; }
    const id = active.id;
    persist(`Emptying Box ${id}`, () => emptyAmzShipmentBox(id));
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, lines: [] } : b)));
    setHistory((h) => h.filter((x) => x.boxId !== id));
    setConfirmEmpty(false);
    setMenuOpen(false);
    setLastScan(null);
    refocus();
  }

  // Delete the active box and everything in it (confirmed inline when it isn't empty); the last box can't go, there's always one to
  // scan into. The boxes after it are RENUMBERED down one (owner, 2026-10-06) so the numbers stay 1..n and match Amazon's B1..Bn in the
  // Amazon upload — the server does the same to the stored rows (amz-shipment-box-delete), and Undo's history follows the new numbers.
  function deleteActive() {
    if (boxes.length === 1 || active.locked) return;
    if (boxUnits(active) > 0 && !confirmDelete) { setConfirmDelete(true); setConfirmEmpty(false); return; }
    const gone = active.id;
    const shift = (id: number) => (id > gone ? id - 1 : id);
    const rest = boxes.filter((b) => b.id !== gone).map((b) => ({ ...b, id: shift(b.id) }));
    persist(`Deleting Box ${gone}`, () => deleteAmzShipmentBox(gone));
    setBoxes(rest);
    setHistory((h) => h.filter((x) => x.boxId !== gone).map((x) => ({ ...x, boxId: shift(x.boxId) })));
    setActiveId(rest[rest.length - 1].id);
    setConfirmDelete(false);
    setMenuOpen(false);
    setLastScan(null);
    refocus();
  }

  return (
    <>
      {/* Shipment summary — counts only. The finishing steps (plan, Amazon upload, Mark shipped) are the LAST job, so they live at the
          foot of the box list, not up here where they read as the first thing to do (owner, 2026-10-15: "they seem a bit scary"). */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{boxes.length}</span> {boxes.length === 1 ? 'box' : 'boxes'}
          <span className="mx-2 text-slate-300">·</span>
          <span className="font-semibold text-slate-900">{totalUnits}</span> {totalUnits === 1 ? 'unit' : 'units'}
          {needSize > 0 && (
            <>
              <span className="mx-2 text-slate-300">·</span>
              <span className="text-amber-700">{needSize} {needSize === 1 ? 'box needs' : 'boxes need'} measuring</span>
            </>
          )}
        </div>
        {saveError && (
          <div className="flex w-full items-center gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <span className="flex-1">{saveError}. The screen may not match what is stored.</span>
            <button type="button" onClick={onReload}
              className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700">Reload</button>
          </div>
        )}
      </div>

      {/* The open box on the LEFT, the box list on the RIGHT (owner, 2026-10-16). The list stays first in the source so a phone, one
          column, still shows it above the box; md:order-last moves it right on a wider screen. */}
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        {/* BOXES — pick the one you're filling. */}
        <div className="space-y-2 md:order-last">
          {/* FIND — "which box is this SKU in?". Typing narrows the list to the boxes holding a match and names the matching codes under
              each; click one to open it. Uppercased like the app's other find boxes (codes are uppercase); matching ignores case.
              Its own input, NOT the scan box — a scan here would otherwise go into a box. */}
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
              {hits.length === 0
                ? 'Not in any box'
                : `In ${hits.length} ${hits.length === 1 ? 'box' : 'boxes'} · ${hits.reduce((n, h) => n + h.lines.reduce((m, l) => m + l.qty, 0), 0)} units`}
            </div>
          )}
          {(q ? hits.map((h) => h.box) : boxes).map((b) => {
            const on = b.id === active.id;
            const units = boxUnits(b);
            const matched = q ? b.lines.filter(lineMatches) : [];
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBox(b.id)}
                className={'flex w-full flex-wrap items-center gap-x-3 rounded-lg border px-3 py-2.5 text-left '
                  + (on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:bg-slate-50')}
              >
                <CubeIcon className={'h-5 w-5 ' + (on ? 'text-brand-600' : 'text-slate-400')} />
                <span className="font-medium text-slate-900">Box {b.id}</span>
                {b.locked && <LockClosedIcon className="h-4 w-4 text-slate-500" aria-label="Locked" />}
                <span className="ml-auto text-right text-sm tabular-nums text-slate-500">
                  {units} {units === 1 ? 'unit' : 'units'}
                  {units > 0 && !b.locked && !dimsComplete(b.dims) && <span className="block text-xs text-amber-700">needs size</span>}
                </span>
                {matched.length > 0 && (
                  <span className="mt-1.5 w-full space-y-0.5">
                    {matched.map((l) => (
                      <span key={l.code} className="flex justify-between gap-2 font-mono text-xs text-amber-900">
                        <span className="truncate">{l.code}</span>
                        <span className="tabular-nums">×{l.qty}</span>
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => { void newBox(); }}
            disabled={checkingNew}
            title={openBox && boxUnits(openBox) > 0 ? `Box ${openBox.id} isn’t locked yet` : undefined}
            // Amber while a box is unlocked (owner, 2026-10-15: "so more clear") — a warning, not a stop; it still makes the box.
            className={'flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 '
              + (openBox ? 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}
          >
            <PlusIcon className="h-4 w-4" />
            {checkingNew ? 'Checking boxes…' : 'New box'}
          </button>
          {newBoxError && <p className="px-1 text-xs text-red-700">{newBoxError}</p>}
          {openBox && (
            <p className="px-1 text-xs text-amber-700">
              {boxUnits(openBox) === 0 ? `Box ${openBox.id} is empty — scan into it` : `Box ${openBox.id} isn’t locked yet — lock it once it’s done`}
              {openBox.id !== active.id && (
                <> · <button type="button" onClick={() => selectBox(openBox.id)} className="font-medium underline hover:text-amber-900">Open Box {openBox.id}</button></>
              )}
            </p>
          )}

          {/* FINISH SHIPMENT — the end of the job, in the order it's done: 1 the shipping plan file, 2 the Amazon box-contents upload,
              3 Mark shipped. FOLDED to one line until clicked (owner, 2026-10-16) — it's done once per shipment, so while packing it
              stays out of the way. The line turns green with a tick once every packed box is locked: the cue that it's time. "n of m
              locked" is a guide only; the steps are usable any time, Mark shipped still behind its confirm. */}
          <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setFinishOpen((o) => !o)}
              aria-expanded={finishOpen}
              className={'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium '
                + (allLocked ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
            >
              {allLocked ? <CheckCircleIcon className="h-4 w-4" /> : <ChevronRightIcon className={'h-4 w-4 text-slate-400 transition-transform ' + (finishOpen ? 'rotate-90' : '')} />}
              <span className="flex-1">Finish shipment</span>
              {packedBoxes > 0 && (
                <span className={'text-xs font-normal ' + (allLocked ? 'text-emerald-700' : 'text-slate-500')}>
                  {lockedBoxes} of {packedBoxes} locked
                </span>
              )}
            </button>
            {finishOpen && (<>
            <button
              type="button"
              disabled={totalUnits === 0}
              onClick={() => downloadShippingPlan(boxes)}
              title={totalUnits === 0 ? 'No packed boxes yet' : `Amazon shipping plan: ${totalUnits} units across ${packedBoxes} ${packedBoxes === 1 ? 'box' : 'boxes'}`}
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
                Inline confirm stating exactly what goes; can't be undone from here, so it is never one click. */}
            {confirmShip ? (
              <div className="space-y-2 rounded-md border border-slate-300 bg-white p-2.5 text-sm">
                <div className="text-slate-700">Ship all {packedBoxes} {packedBoxes === 1 ? 'box' : 'boxes'} ({totalUnits} units)? This clears the shipment.</div>
                <div className="flex gap-2">
                  <button type="button" disabled={shipping} onClick={ship}
                    className="rounded bg-brand-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                    {shipping ? 'Shipping…' : 'Yes, shipped'}
                  </button>
                  <button type="button" disabled={shipping} onClick={() => setConfirmShip(false)}
                    className="rounded bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">No</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={totalUnits === 0}
                onClick={() => { setConfirmShip(true); setShipError(null); }}
                title={totalUnits === 0 ? 'No packed boxes to ship' : 'The boxes have gone — clear the whole shipment'}
                className={FINISH_BTN}
              >
                <span className="w-4 text-center text-xs font-semibold text-slate-400">3</span>
                <TruckIcon className="h-4 w-4 text-slate-400" />
                Mark shipped
              </button>
            )}
            {shipError && <div className="px-1 text-xs text-red-700">{shipError}</div>}
            </>)}
          </div>
        </div>

        {/* THE ACTIVE BOX — scan into it, see what's in it. */}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Box {active.id}</h2>
              <span className="text-sm text-slate-500">{boxUnits(active)} {boxUnits(active) === 1 ? 'unit' : 'units'}</span>
              {active.locked && <LockClosedIcon className="h-4 w-4 text-slate-500" aria-label="Locked" />}
              {!printOn && !active.locked && <span className="text-xs text-slate-400">labels off</span>}
              {/* Kept short (owner, 2026-10-15: "too much going on"; 2026-10-16: the rare ones in a menu). A LOCKED box offers only
                  Unlock — nothing else can change it. Open, it's Undo, the ⋯ menu (print switch, Empty, Delete — Empty and Delete ask
                  first, in the menu), then Lock box. */}
              <div className="ml-auto flex items-center gap-1.5">
                {!active.locked && (
                  <>
                    <button
                      type="button"
                      onClick={undo}
                      disabled={history.length === 0 || !!boxes.find((b) => b.id === history[history.length - 1]?.boxId)?.locked}
                      title="Undo the last scan"
                      className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowUturnLeftIcon className="h-4 w-4" />
                      Undo
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => { setMenuOpen((o) => !o); setConfirmEmpty(false); setConfirmDelete(false); }}
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
                          <div className="fixed inset-0 z-10" onClick={() => { setMenuOpen(false); setConfirmEmpty(false); setConfirmDelete(false); refocus(); }} />
                          <div className="absolute right-0 z-20 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
                            <button type="button" onClick={togglePrint} className={MENU_ITEM + 'text-slate-700'}>
                              <PrinterIcon className="h-4 w-4 text-slate-400" />
                              <span className="flex-1">Print labels</span>
                              <span className={'text-xs font-medium ' + (printOn ? 'text-emerald-700' : 'text-slate-400')}>{printOn ? 'On' : 'Off'}</span>
                            </button>
                            <button type="button" onClick={emptyActive} disabled={boxUnits(active) === 0}
                              className={MENU_ITEM + (confirmEmpty ? 'bg-amber-50 text-amber-800' : 'text-slate-700')}>
                              <ArchiveBoxXMarkIcon className="h-4 w-4 text-slate-400" />
                              {confirmEmpty ? `Take all ${boxUnits(active)} out? Click again` : 'Empty box'}
                            </button>
                            <button type="button" onClick={deleteActive} disabled={boxes.length === 1}
                              className={MENU_ITEM + (confirmDelete ? 'bg-red-50 text-red-700' : 'text-slate-700')}>
                              <TrashIcon className="h-4 w-4 text-slate-400" />
                              {confirmDelete
                                ? `Delete Box ${active.id}? Click again` + (boxes.some((b) => b.id > active.id) ? ' (later boxes move down one)' : '')
                                : 'Delete box'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={toggleLock}
                  disabled={boxUnits(active) === 0 || (!active.locked && !dimsComplete(active.dims))}
                  title={active.locked ? 'Unlock to change what’s in it or its size'
                    : dimsComplete(active.dims) ? 'Box done — fix what’s in it and its size'
                    : 'Put in its length, width, height and weight first'}
                  className={'flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40 '
                    + (active.locked ? 'border-slate-800 bg-slate-800 text-white hover:bg-slate-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}
                >
                  {active.locked ? <LockOpenIcon className="h-4 w-4" /> : <LockClosedIcon className="h-4 w-4" />}
                  {active.locked ? 'Unlock' : 'Lock box'}
                </button>
              </div>
            </div>
            {/* NEW BOX STARTED FOR YOU — loud on purpose (owner, 2026-10-16: "make that obvs"): the packer must know the shoe went into
                a NEW box, not the one they locked. */}
            {autoStarted && autoStarted.to === active.id && (
              <div role="status" className="mb-2 flex items-center gap-3 rounded-md border-2 border-brand-500 bg-brand-50 px-3 py-2.5 text-brand-700">
                <CubeIcon className="h-6 w-6 shrink-0" />
                <div className="flex-1">
                  <div className="text-base font-bold">New box: Box {autoStarted.to}</div>
                  <div className="text-sm">
                    Box {autoStarted.from} is locked, so that shoe went into Box {autoStarted.to} — get a new carton.
                  </div>
                </div>
                <button type="button" onClick={() => { setAutoStarted(null); refocus(); }} aria-label="Close"
                  className="rounded px-2 py-1 text-lg text-brand-500 hover:bg-brand-100">×</button>
              </div>
            )}
            <input
              ref={scanRef}
              autoFocus
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(); } }}
              placeholder={active.locked ? `Box ${active.id} is locked — scan a shoe to start a new box` : `Scan a shoe into Box ${active.id}`}
              aria-label={`Scan into Box ${active.id}`}
              aria-invalid={scanError ? true : undefined}
              className={'h-12 w-full rounded-md border px-4 font-mono text-lg text-slate-900 placeholder:font-sans placeholder:text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 '
                + (scanError ? 'border-red-500 bg-red-50 focus:ring-red-500' : 'border-slate-300 focus:ring-brand-500')}
            />
            {/* Always mounted (a live region must exist before its message arrives), but takes no space until there is one (owner,
                2026-10-15: the empty line under the scan box was awkward). */}
            <div className={scanError || lastScan ? 'mt-1.5 text-sm' : ''} role="status" aria-live="assertive">
              {scanError ? (
                <div className="rounded-md border border-red-300 bg-red-100 px-3 py-2 font-medium text-red-800">
                  <span className="font-mono">{scanError.scan}</span>: {scanError.message}
                  {scanError.title && <div className="text-xs font-normal text-red-700">{scanError.title}</div>}
                </div>
              ) : lastScan && (
                <span className="text-emerald-700">
                  Added <span className="font-mono">{lastScan.code}</span> to Box {lastScan.boxId}
                  {lastScan.printed && ' · label printed'}
                </span>
              )}
            </div>
          </div>

          {/* MEASUREMENTS — the packed carton's size and weight, on ONE row above the contents (owner, 2026-10-15: above the items, and
              tidier): the four fields with their units, then the two quick fills (no status pill — owner, 2026-10-15). */}
          <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm font-medium text-slate-700">Size</span>
              <div className="flex flex-wrap items-center gap-2">
                {FIELDS.map((f) => (
                  <label key={f.key} className="relative block" title={`${f.label} (${f.unit})`}>
                    <span className="sr-only">{f.label}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={active.dims[f.key]}
                      onChange={(e) => setDim(f.key, e.target.value)}
                      onBlur={() => { if (!active.locked) saveDims(active.id, active.dims); }}
                      disabled={active.locked}
                      placeholder={f.label}
                      className="h-8 w-24 rounded-md border border-slate-300 bg-white pl-2 pr-8 text-right text-sm tabular-nums text-slate-900 placeholder:text-left placeholder:text-xs placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{f.unit}</span>
                  </label>
                ))}
              </div>
              {/* QUICK FILL (owner, 2026-10-01). Birk box = the standard carton's three sides; weight is left alone because it depends on
                  what's packed. Set saves the open box's typed size, or fills an empty one with the saved size (setButton). */}
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => fillDims(BIRK_BOX)}
                  disabled={active.locked}
                  title={`${BIRK_BOX.length} × ${BIRK_BOX.width} × ${BIRK_BOX.height} cm — weight left for you to enter`}
                  className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Birk box
                </button>
                <button
                  type="button"
                  onClick={setButton}
                  disabled={active.locked}
                  title="Typed a size? Set saves it. Empty box? Set fills in the saved size."
                  className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Set
                </button>
              </div>
            </div>
            {warning && <div className="mt-1.5 text-xs text-amber-700">{warning}</div>}
            {lockAsk === active.id && !active.locked && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                <LockClosedIcon className="h-4 w-4 text-slate-500" />
                <span className="text-slate-700">Box {active.id} is measured — lock it?</span>
                <button type="button" onClick={toggleLock}
                  className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700">Lock box</button>
                <button type="button" onClick={() => { setLockAsk(null); refocus(); }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-800">Not now</button>
              </div>
            )}
          </div>

          {/* AFTER LOCK (owner, 2026-10-16): the box is done — what next? Start the next box here, or (arrived from Goods In) go back
              there. Either way scanning a shoe also starts the next box (see onScan), so ignoring this is fine too. */}
          {lockedAsk === active.id && active.locked && (
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-emerald-50 px-4 py-3">
              <CheckCircleIcon className="h-6 w-6 text-emerald-600" />
              <span className="flex-1 font-semibold text-emerald-800">Box {active.id} locked</span>
              <button type="button" onClick={() => { void newBox(); }} disabled={checkingNew}
                className="flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                <PlusIcon className="h-4 w-4" />{checkingNew ? 'Starting…' : 'Start next box'}
              </button>
              <button type="button" onClick={() => router.push('/goods-in')}
                className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <InboxArrowDownIcon className="h-4 w-4" />Back to Goods In
              </button>
            </div>
          )}

          {active.lines.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">Nothing in Box {active.id} yet — scan a shoe to start.</div>
          ) : (
            // CONTENTS (owner, 2026-10-16): what a packer looks for is the SHOE — its name and size, big, with the qty; our code, the
            // Amazon SKU and the FNSKU are on one small line under it (still there to check against a label, and for Find).
            // The line a good scan just went to flashes green and its qty pops — re-keyed by the scan's number so a repeat scan replays it.
            // A LOCKED box's contents are greyed (owner, 2026-10-16: "clear from a glance") — still readable, and its reprint buttons work.
            <table className={'w-full ' + (active.locked ? 'bg-slate-50 opacity-50 grayscale' : '')}>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-medium">Shoe</th>
                  <th className="px-4 py-2 text-center font-medium">Size</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="w-20 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {active.lines.map((l) => {
                  const justScanned = lastScan?.boxId === active.id && lastScan.code === l.code;
                  return (
                  <tr key={justScanned ? `${l.code}#${lastScan?.n}` : l.code}
                    className={'border-b border-slate-100 last:border-0 ' + (lineMatches(l) ? 'bg-amber-50' : justScanned ? 'animate-scan-flash' : '')}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{l.title || l.code}</div>
                      <div className="font-mono text-xs text-slate-400">
                        {l.code}{l.sku && ` · ${l.sku}`}{l.fnsku && ` · ${l.fnsku}`}
                      </div>
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
                      {!active.locked && <button
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
