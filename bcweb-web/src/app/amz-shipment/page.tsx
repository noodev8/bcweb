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
− and Undo via POST /amz-shipment-line (+1/−1), Delete box via /amz-shipment-box-delete, measurements via /amz-shipment-dims when a
field is left or a quick fill is used. The screen updates at once and the writes queue behind it in order (persist), so a fast run
of scans can't arrive out of order. A failed save shows a red bar with Reload — the screen may no longer match the DB, and reloading
puts it back to what is stored. A new box is only stored once something is in it (there's no row to hold an empty one), so an empty
box doesn't survive a reload; its typed measurements go in with its first unit.

MARK SHIPPED (owner, 2026-10-01: "the shipped button should clear the whole shipment"). Live. POST /amz-shipment-ship, one transaction:
the stored shipment is archived to amzshipment_archive under a new shipment id, the boxed units come off the C3-Amazon shelf
(soft-deleted), and amzshipment is emptied. It waits for any queued saves, then sends the packed boxes and units it showed, so the
server refuses if the stored shipment differs (a failed save, or the legacy app packing too). Codes boxed with nothing on C3-Amazon to
take are listed in the notice afterwards. See the route header for the detail.

FIND (owner, 2026-10-01). "Which box is this SKU in?" — the box above the list narrows it to boxes holding a match (code, Amazon SKU,
FNSKU or title) and names the matching codes under each; the matching lines are highlighted in the open box.

SCANNING. A barcode scanner types the code and presses Enter, so the scan box is just an input that commits on Enter and keeps focus —
scan, scan, scan with no clicks. Every scan goes into the ACTIVE box (highlighted on the left); click another box, or New box, to switch.
The same code scanned twice is one line with qty 2. − takes one off a line; Undo takes off the last scan wherever it went.

SCAN CHECK (owner, 2026-10-02). Every scan is looked up (GET /amz-shipment-scan — our code, the EAN or the FNSKU all resolve to the
product) BEFORE it goes in a box, and is refused if it isn't a product we know, or if Amazon hasn't given it an FNSKU ("it needs to have
an fnsku to go in an amz box"). A refused scan goes in no box: the scan field turns red, the reason shows under it with the product's name,
and the browser beeps — the packer is looking at the shoe, not the screen. It clears on the next good scan. A line made by a good scan
carries the product's code, Amazon SKU, FNSKU and title like a stored one, so an EAN and an FNSKU scan of the same shoe are one line.

FNSKU LABELS (owner, 2026-10-02: "print a fnsku label when its scanned"). Every good scan prints one 54 × 25 mm Dymo label — FNSKU barcode +
the Amazon SKU under it, nothing else (2026-10-07) — via src/lib/fnskuLabel.ts (silent on the packing PC's --kiosk-printing Chrome shortcut, a print dialog anywhere else).
A refused scan prints nothing. "Print labels" switches it off for shoes already labelled; the switch is remembered in this browser, as
it belongs to the bench, not the shipment. The printer icon on a line reprints that line's label (a jam, a smudge, a test).

MEASUREMENTS (owner, 2026-09-28). Once a box is packed, its length, width and height (cm) and weight (kg) go in under its contents —
Amazon wants all four for every carton. A box with units but no full set is flagged "needs size" in the list. Amazon's standard-carton
limits (63.5 cm on any side, 23 kg) are shown as a warning only; nothing blocks. Two quick fills (owner, 2026-10-01): "Birk box" puts in
the Birkenstock carton's sides (BIRK_BOX — weight left blank, it depends on the contents), and "Set" takes typed values, applies them to
the open box and remembers them in this browser so the next Set opens pre-filled.

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

import { useRef, useState } from 'react';
import {
  PlusIcon, MinusIcon, CubeIcon, ArrowUturnLeftIcon, TrashIcon, TruckIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, MagnifyingGlassIcon, PrinterIcon,
} from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import {
  getAmzShipmentBoxes, shipAmzShipment, lookupAmzShipmentScan, saveAmzShipmentLine, saveAmzShipmentDims, deleteAmzShipmentBox,
  type AmzBox, type AmzShipResult, type AmzScanHit,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { printFnskuLabel } from '@/lib/fnskuLabel';
import { fillAmazonBoxFile } from '@/lib/amzBoxUpload';

// sku / fnsku / title come with every line — from the DB for a stored line, from the scan lookup for one scanned here.
interface BoxLine { code: string; qty: number; sku?: string; fnsku?: string; title?: string; }
// Measurements are held as typed (strings), so a half-typed "12." isn't rewritten under the cursor.
interface BoxDims { length: string; width: string; height: string; weight: string; }
interface Box { id: number; lines: BoxLine[]; dims: BoxDims; }

const NO_DIMS: BoxDims = { length: '', width: '', height: '', weight: '' };
const newBoxOf = (id: number): Box => ({ id, lines: [], dims: NO_DIMS });
const boxUnits = (b: Box) => b.lines.reduce((n, l) => n + l.qty, 0);
const fromDb = (b: AmzBox): Box => ({
  id: b.box,
  lines: b.lines.map((l) => ({ code: l.code, qty: l.qty, sku: l.sku, fnsku: l.fnsku, title: l.title })),
  dims: { length: b.length, width: b.width, height: b.height, weight: b.weight },
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
export default function AmzShipmentPage() {
  const { data, error, isLoading, refresh } = useApiQuery('amz-shipment-boxes', getAmzShipmentBoxes);
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
    <AppShell title="AMZ Shipment">
      {shipped && <ShippedNotice result={shipped} onClose={() => setShipped(null)} />}
      {isLoading ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading boxes…</div>
      ) : error || !data ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error?.message || 'Failed to load the Amazon boxes'}</div>
      ) : (
        <Packing key={round} initial={data.boxes.map(fromDb)} onShipped={onShipped} onReload={reload} />
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

function Packing({ initial, onShipped, onReload }: {
  initial: Box[]; onShipped: (r: AmzShipResult) => Promise<void>; onReload: () => Promise<void>;
}) {
  // No boxes packed yet -> one empty Box 1 to scan into.
  const [boxes, setBoxes] = useState<Box[]>(initial.length ? initial : [newBoxOf(1)]);
  const [activeId, setActiveId] = useState(initial.length ? initial[0].id : 1);
  const [scan, setScan] = useState('');
  // Every scan in order, so Undo can take off the last one whichever box it went into.
  const [history, setHistory] = useState<{ boxId: number; code: string }[]>([]);
  const [lastScan, setLastScan] = useState<{ boxId: number; code: string } | null>(null);
  // The last scan refused by SCAN CHECK — drives the red scan field and the message under it.
  const [scanError, setScanError] = useState<{ scan: string; message: string; title?: string } | null>(null);
  // Good lookups this visit, by what was scanned, so a run of the same shoe is one round trip. Only products WITH an FNSKU are kept:
  // a refused one is asked again next time, in case Amazon's import has given it one since.
  const scanCache = useRef(new Map<string, AmzScanHit>());
  // Lazy initialiser: read once on mount (this component only renders client-side after the boxes load), no effect needed.
  const [printOn, setPrintOn] = useState(loadPrintOn);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmShip, setConfirmShip] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  // FIND — which box is a SKU in? Matches code, Amazon SKU, FNSKU or title, case-insensitive, across every box.
  const [find, setFind] = useState('');
  const [presetOpen, setPresetOpen] = useState(false);
  const [preset, setPreset] = useState<BoxDims>(NO_DIMS);
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
    const boxId = active.id;
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
    const { code, sku, fnsku, title } = hit;
    addTo(boxId, code, 1, { sku, fnsku, title });
    setHistory((h) => [...h, { boxId, code }]);
    setLastScan({ boxId, code });
    setScanError(null);
    if (printOn) printLabel(fnsku, sku);
  }

  // Print, then hand focus back to the scan field (printing focuses the label's iframe).
  function printLabel(fnsku: string, sku: string) {
    printFnskuLabel(fnsku, sku, refocus);
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
    if (!last) return;
    addTo(last.boxId, last.code, -1);
    setHistory((h) => h.slice(0, -1));
    setActiveId(last.boxId);
    setLastScan(null);
    refocus();
  }

  function newBox() {
    const id = Math.max(0, ...boxes.map((b) => b.id)) + 1;
    setBoxes((prev) => [...prev, newBoxOf(id)]);
    setActiveId(id);
    setLastScan(null);
    refocus();
  }

  function setDim(key: keyof BoxDims, value: string) {
    const clean = value.replace(/[^0-9.]/g, '');
    setBoxes((prev) => prev.map((b) => (b.id === active.id ? { ...b, dims: { ...b.dims, [key]: clean } } : b)));
  }

  // Quick fill: write the given measurements into the open box. Only non-blank values are written, so Birk box (no weight) and a Set
  // with a field left empty keep whatever that box already had there.
  function fillDims(d: Partial<BoxDims>) {
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
  }

  function openPreset() {
    setPreset(loadPreset());
    setPresetOpen(true);
  }

  function applyPreset() {
    savePreset(preset);
    fillDims(preset);
    setPresetOpen(false);
    refocus();
  }

  function selectBox(id: number) {
    setActiveId(id);
    setConfirmDelete(false);
    setLastScan(null);
    refocus();
  }

  // Delete the active box and everything in it (confirmed inline when it isn't empty); the last box can't go, there's always one to
  // scan into. The boxes after it are RENUMBERED down one (owner, 2026-10-06) so the numbers stay 1..n and match Amazon's B1..Bn in the
  // Amazon upload — the server does the same to the stored rows (amz-shipment-box-delete), and Undo's history follows the new numbers.
  function deleteActive() {
    if (boxes.length === 1) return;
    if (boxUnits(active) > 0 && !confirmDelete) { setConfirmDelete(true); return; }
    const gone = active.id;
    const shift = (id: number) => (id > gone ? id - 1 : id);
    const rest = boxes.filter((b) => b.id !== gone).map((b) => ({ ...b, id: shift(b.id) }));
    persist(`Deleting Box ${gone}`, () => deleteAmzShipmentBox(gone));
    setBoxes(rest);
    setHistory((h) => h.filter((x) => x.boxId !== gone).map((x) => ({ ...x, boxId: shift(x.boxId) })));
    setActiveId(rest[rest.length - 1].id);
    setConfirmDelete(false);
    setLastScan(null);
    refocus();
  }

  return (
    <>
      {/* Shipment summary + the send action. */}
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
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={totalUnits === 0}
            onClick={() => downloadShippingPlan(boxes)}
            title={totalUnits === 0 ? 'No packed boxes yet' : `Amazon shipping plan: ${totalUnits} units across ${packedBoxes} ${packedBoxes === 1 ? 'box' : 'boxes'}`}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Shipping plan
          </button>
          {/* AMAZON UPLOAD — pick Amazon's box contents .xlsx, get it back filled in (see the header). */}
          <input ref={uploadRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onUploadFile(e.target.files?.[0])} />
          <button
            type="button"
            disabled={totalUnits === 0 || uploading}
            onClick={() => { setUpload(null); uploadRef.current?.click(); }}
            title={totalUnits === 0 ? 'No packed boxes yet' : 'Pick the box contents file from Send to Amazon — it comes back filled in'}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            {uploading ? 'Filling…' : 'Amazon upload'}
          </button>
          {/* MARK SHIPPED — clears the WHOLE stored shipment (owner, 2026-10-01): archive, stock off C3-Amazon, boxes emptied.
              Inline confirm stating exactly what goes; can't be undone from here, so it is never one click. */}
          {confirmShip ? (
            <span className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
              <span className="text-slate-700">
                Ship all {packedBoxes} {packedBoxes === 1 ? 'box' : 'boxes'} ({totalUnits} units)?
              </span>
              <button type="button" disabled={shipping} onClick={ship}
                className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50">
                {shipping ? 'Shipping…' : 'Yes, shipped'}
              </button>
              <button type="button" disabled={shipping} onClick={() => setConfirmShip(false)}
                className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">No</button>
            </span>
          ) : (
            <button
              type="button"
              disabled={totalUnits === 0}
              onClick={() => { setConfirmShip(true); setShipError(null); }}
              title={totalUnits === 0 ? 'No packed boxes to ship' : 'The boxes have gone — clear the whole shipment'}
              className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <TruckIcon className="h-4 w-4" />
              Mark shipped
            </button>
          )}
        </div>
        {shipError && <div className="w-full text-sm text-red-700">{shipError}</div>}
        {upload && (
          <div className={'flex w-full items-start gap-3 rounded-md border px-3 py-2 text-sm '
            + (upload.error ? 'border-red-300 bg-red-50 text-red-800'
              : upload.warnings.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
            <div className="flex-1">
              {upload.error ? <>Amazon upload: {upload.error}</> : upload.done}
              {upload.warnings.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {upload.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
            </div>
            <button type="button" onClick={() => setUpload(null)} className="text-xs opacity-70 hover:opacity-100">Close</button>
          </div>
        )}
        {saveError && (
          <div className="flex w-full items-center gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            <span className="flex-1">{saveError}. The screen may not match what is stored.</span>
            <button type="button" onClick={onReload}
              className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700">Reload</button>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        {/* BOXES — pick the one you're filling. */}
        <div className="space-y-2">
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
                <span className="ml-auto text-right text-sm tabular-nums text-slate-500">
                  {units} {units === 1 ? 'unit' : 'units'}
                  {units > 0 && !dimsComplete(b.dims) && <span className="block text-xs text-amber-700">needs size</span>}
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
            onClick={newBox}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <PlusIcon className="h-4 w-4" />
            New box
          </button>
        </div>

        {/* THE ACTIVE BOX — scan into it, see what's in it. */}
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Box {active.id}</h2>
              <span className="text-sm text-slate-500">{boxUnits(active)} {boxUnits(active) === 1 ? 'unit' : 'units'}</span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={togglePrint}
                  aria-pressed={printOn}
                  title={printOn ? 'A label prints for every good scan — click to stop' : 'Labels are off — click to print one per scan'}
                  className={'flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm '
                    + (printOn ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-500 hover:bg-slate-50')}
                >
                  <PrinterIcon className="h-4 w-4" />
                  {printOn ? 'Print labels: on' : 'Print labels: off'}
                </button>
                <button
                  type="button"
                  onClick={undo}
                  disabled={history.length === 0}
                  className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4" />
                  Undo last scan
                </button>
                <button
                  type="button"
                  onClick={deleteActive}
                  disabled={boxes.length === 1}
                  className={'flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40 '
                    + (confirmDelete ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}
                >
                  <TrashIcon className="h-4 w-4" />
                  {confirmDelete
                    ? `Delete Box ${active.id} and its ${boxUnits(active)} ${boxUnits(active) === 1 ? 'unit' : 'units'}?`
                      + (boxes.some((b) => b.id > active.id) ? ' Later boxes move down one.' : '')
                    : 'Delete box'}
                </button>
              </div>
            </div>
            <input
              ref={scanRef}
              autoFocus
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(); } }}
              placeholder={`Scan a shoe into Box ${active.id}`}
              aria-label={`Scan into Box ${active.id}`}
              aria-invalid={scanError ? true : undefined}
              className={'h-12 w-full rounded-md border px-4 font-mono text-lg text-slate-900 placeholder:font-sans placeholder:text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 '
                + (scanError ? 'border-red-500 bg-red-50 focus:ring-red-500' : 'border-slate-300 focus:ring-brand-500')}
            />
            <div className="mt-1.5 min-h-5 text-sm" role="status" aria-live="assertive">
              {scanError ? (
                <div className="rounded-md border border-red-300 bg-red-100 px-3 py-2 font-medium text-red-800">
                  <span className="font-mono">{scanError.scan}</span>: {scanError.message}
                  {scanError.title && <div className="text-xs font-normal text-red-700">{scanError.title}</div>}
                </div>
              ) : lastScan && (
                <span className="text-emerald-700">
                  Added <span className="font-mono">{lastScan.code}</span> to Box {lastScan.boxId}
                  {printOn && ' · label printed'}
                </span>
              )}
            </div>
          </div>

          {active.lines.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">Nothing in Box {active.id} yet — scan a shoe to start.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Amazon SKU</th>
                  <th className="px-4 py-2 font-medium">FNSKU</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="w-20 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {active.lines.map((l) => (
                  <tr key={l.code} className={'border-b border-slate-100 last:border-0 ' + (lineMatches(l) ? 'bg-amber-50' : '')}>
                    <td className="px-4 py-2">
                      <div className="font-mono text-slate-900">{l.code}</div>
                      {l.title && <div className="text-xs text-slate-500">{l.title}</div>}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-600">{l.sku || '—'}</td>
                    <td className="px-4 py-2 font-mono text-slate-600">{l.fnsku || '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">{l.qty}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {l.fnsku && (
                        <button
                          type="button"
                          onClick={() => printLabel(l.fnsku!, l.sku || '')}
                          aria-label={`Print a label for ${l.code}`}
                          title={`Print one ${l.fnsku} label`}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <PrinterIcon className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => takeOne(l.code)}
                        aria-label={`Take one ${l.code} out`}
                        title="Take one out"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <MinusIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* MEASUREMENTS — the packed carton's size and weight. Below the contents: you measure once it's packed. */}
          <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Box {active.id} measurements</h3>
              {dimsComplete(active.dims)
                ? <span className="text-xs text-emerald-700">Done</span>
                : boxUnits(active) > 0 && <span className="text-xs text-amber-700">Needed before it can ship</span>}
              {/* QUICK FILL (owner, 2026-10-01). Birk box = the standard carton's three sides; weight is left alone because it depends on
                  what's packed. Set = your own values, remembered for next time. Both fill the OPEN box only. */}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fillDims(BIRK_BOX)}
                  title={`${BIRK_BOX.length} × ${BIRK_BOX.width} × ${BIRK_BOX.height} cm — weight left for you to enter`}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Birk box
                </button>
                <button
                  type="button"
                  onClick={() => (presetOpen ? setPresetOpen(false) : openPreset())}
                  aria-expanded={presetOpen}
                  className={'rounded-md border px-2.5 py-1 text-sm font-medium '
                    + (presetOpen ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}
                >
                  Set
                </button>
              </div>
            </div>
            {/* SET — type the values once, Apply fills the open box and remembers them; the next Set opens with them already in.
                A blank field leaves that measurement as it is, so you can keep just a size and weigh each box. */}
            {presetOpen && (
              <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-brand-200 bg-white p-2">
                {FIELDS.map((f) => (
                  <label key={f.key} className="block w-24">
                    <span className="mb-0.5 block text-xs text-slate-500">{f.label} ({f.unit})</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={preset[f.key]}
                      onChange={(e) => setPreset((p) => ({ ...p, [f.key]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPreset(); } }}
                      className="h-8 w-full rounded-md border border-slate-300 px-2 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </label>
                ))}
                <button type="button" onClick={applyPreset}
                  className="h-8 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">
                  Apply to Box {active.id}
                </button>
                <button type="button" onClick={() => setPresetOpen(false)}
                  className="h-8 rounded-md px-2 text-sm text-slate-500 hover:text-slate-800">Cancel</button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-xs text-slate-500">{f.label}</span>
                  <span className="relative block">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={active.dims[f.key]}
                      onChange={(e) => setDim(f.key, e.target.value)}
                      onBlur={() => saveDims(active.id, active.dims)}
                      placeholder="0"
                      className="h-10 w-full rounded-md border border-slate-300 bg-white pl-3 pr-10 text-right tabular-nums text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{f.unit}</span>
                  </span>
                </label>
              ))}
            </div>
            {warning && <div className="mt-2 text-sm text-amber-700">{warning}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
