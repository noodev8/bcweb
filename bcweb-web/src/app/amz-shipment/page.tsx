'use client';
/*
=======================================================================================================================================
Page: /amz-shipment  (AMZ Shipment — packing the Amazon boxes)
=======================================================================================================================================
Purpose: Where the FBA boxes get packed. Pick's Amazon tab gathers the units flagged for Amazon onto the C3-Amazon shelf; this screen is
         the next step — scanning those shoes into numbered boxes, then sending the shipment.

LAYOUT ONLY (owner, 2026-09-28: "just do the layout for now. users need to be able to scan shoes into an amz box").

BOXES FROM THE DB (owner, 2026-09-29: "look at the db and get any box info ... no edits yet just display"). The boxes already packed live
in the legacy `amzshipment` table (one row per box + code, with the Amazon sku/fnsku and the box's measurements on every row); GET
/amz-shipment-boxes reads them and they become this screen's starting boxes — numbers, contents and measurements as stored. Nothing is
written back: scanning, −, new/delete box and the measurement inputs still only change what's on screen, and a reload goes back to the
DB. A scan is recorded as the raw code the scanner sent; matching it to a SKU (barcode or FNSKU), checking it against what is on
C3-Amazon, and saving all come with the writes.

MARK SHIPPED (owner, 2026-10-01: "the shipped button should clear the whole shipment"). Live. POST /amz-shipment-ship, one transaction:
the stored shipment is archived to amzshipment_archive under a new shipment id, the boxed units come off the C3-Amazon shelf
(soft-deleted), and amzshipment is emptied. It acts on the STORED boxes — the confirm says so when this screen has unsaved scans — and
sends the counts it showed, so the server refuses if the legacy app has packed more since. Codes boxed with nothing on C3-Amazon to
take are listed in the notice afterwards. See the route header for the detail.

FIND (owner, 2026-10-01). "Which box is this SKU in?" — the box above the list narrows it to boxes holding a match (code, Amazon SKU,
FNSKU or title) and names the matching codes under each; the matching lines are highlighted in the open box.

SCANNING. A barcode scanner types the code and presses Enter, so the scan box is just an input that commits on Enter and keeps focus —
scan, scan, scan with no clicks. Every scan goes into the ACTIVE box (highlighted on the left); click another box, or New box, to switch.
The same code scanned twice is one line with qty 2. − takes one off a line; Undo takes off the last scan wherever it went.

MEASUREMENTS (owner, 2026-09-28). Once a box is packed, its length, width and height (cm) and weight (kg) go in under its contents —
Amazon wants all four for every carton. A box with units but no full set is flagged "needs size" in the list. Amazon's standard-carton
limits (63.5 cm on any side, 23 kg) are shown as a warning only; nothing blocks. Two quick fills (owner, 2026-10-01): "Birk box" puts in
the Birkenstock carton's sides (BIRK_BOX — weight left blank, it depends on the contents), and "Set" takes typed values, applies them to
the open box and remembers them in this browser so the next Set opens pre-filled.

SHIPPING PLAN (owner, 2026-10-01: "a button that makes my amz shipping plan file ... essentially just a list of whats in all the boxes").
Downloads Amazon-ShippingPlan.txt, the Seller Central shipping-plan upload, in the legacy app's exact layout: the template's header block,
then "Merchant SKU<TAB>Quantity", one line per Amazon SKU totalled across every box, CRLF line ends. Built here from the STORED boxes (as
Mark shipped is) because only a stored line carries its Amazon SKU — a scan made on this screen is just the raw code. No measurements in
this file, so it doesn't wait for them.
=======================================================================================================================================
*/

import { useRef, useState } from 'react';
import {
  PlusIcon, MinusIcon, CubeIcon, ArrowUturnLeftIcon, TrashIcon, TruckIcon, ArrowDownTrayIcon, MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getAmzShipmentBoxes, shipAmzShipment, type AmzBox, type AmzShipResult } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// sku / fnsku / title come with a line loaded from the DB; a line made by scanning here only has the raw code.
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
// After Mark shipped the boxes are re-read and Packing is REMOUNTED (key = round) so it re-seeds from the now-empty shipment — its
// useState only reads `initial` once, so a re-render alone would leave the shipped boxes on screen.
export default function AmzShipmentPage() {
  const { data, error, isLoading, refresh } = useApiQuery('amz-shipment-boxes', getAmzShipmentBoxes);
  const [round, setRound] = useState(0);
  const [shipped, setShipped] = useState<AmzShipResult | null>(null);

  async function onShipped(r: AmzShipResult) {
    setShipped(r);
    await refresh();
    setRound((n) => n + 1);
  }

  return (
    <AppShell title="AMZ Shipment">
      {shipped && <ShippedNotice result={shipped} onClose={() => setShipped(null)} />}
      {isLoading ? (
        <div className="py-10 text-center text-sm text-slate-400">Loading boxes…</div>
      ) : error || !data ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error?.message || 'Failed to load the Amazon boxes'}</div>
      ) : (
        <Packing key={round} initial={data.boxes.map(fromDb)} onShipped={onShipped} />
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

function Packing({ initial, onShipped }: { initial: Box[]; onShipped: (r: AmzShipResult) => Promise<void> }) {
  // No boxes packed yet -> one empty Box 1 to scan into.
  const [boxes, setBoxes] = useState<Box[]>(initial.length ? initial : [newBoxOf(1)]);
  const [activeId, setActiveId] = useState(initial.length ? initial[0].id : 1);
  const [scan, setScan] = useState('');
  // Every scan in order, so Undo can take off the last one whichever box it went into.
  const [history, setHistory] = useState<{ boxId: number; code: string }[]>([]);
  const [lastScan, setLastScan] = useState<{ boxId: number; code: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmShip, setConfirmShip] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  // FIND — which box is a SKU in? Matches code, Amazon SKU, FNSKU or title, case-insensitive, across every box.
  const [find, setFind] = useState('');
  const [presetOpen, setPresetOpen] = useState(false);
  const [preset, setPreset] = useState<BoxDims>(NO_DIMS);
  const scanRef = useRef<HTMLInputElement>(null);

  // What Mark shipped acts on: the STORED shipment as loaded, not this screen's unsaved scans (see the route header). These counts
  // are what the confirm states and what the server checks against, so it can refuse if the legacy app has packed more since.
  const storedBoxes = initial.length;
  const storedUnits = initial.reduce((n, b) => n + boxUnits(b), 0);
  const editedHere = JSON.stringify(boxes.map((b) => [b.id, b.lines.map((l) => [l.code, l.qty])]))
    !== JSON.stringify(initial.map((b) => [b.id, b.lines.map((l) => [l.code, l.qty])]));

  async function ship() {
    setShipping(true);
    setShipError(null);
    const res = await shipAmzShipment(storedBoxes, storedUnits);
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
  // Packed boxes still missing a measurement — the summary counts them, the list flags each.
  const needSize = boxes.filter((b) => boxUnits(b) > 0 && !dimsComplete(b.dims)).length;
  const warning = dimsWarning(active.dims);
  const refocus = () => scanRef.current?.focus();

  function addTo(boxId: number, code: string, delta: number) {
    setBoxes((prev) => prev.map((b) => {
      if (b.id !== boxId) return b;
      const hit = b.lines.find((l) => l.code === code);
      if (!hit) return delta > 0 ? { ...b, lines: [{ code, qty: delta }, ...b.lines] } : b;
      const lines = b.lines.map((l) => (l.code === code ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0);
      return { ...b, lines };
    }));
  }

  function onScan() {
    const code = scan.trim().toUpperCase();
    setScan('');
    if (!code) return;
    addTo(active.id, code, 1);
    setHistory((h) => [...h, { boxId: active.id, code }]);
    setLastScan({ boxId: active.id, code });
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
    setBoxes((prev) => prev.map((b) => {
      if (b.id !== active.id) return b;
      const next = { ...b.dims };
      for (const f of FIELDS) { const v = (d[f.key] ?? '').trim(); if (v) next[f.key] = v; }
      return { ...b, dims: next };
    }));
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

  // Delete the active box and everything in it (confirmed inline when it isn't empty). Boxes keep their numbers — Box 3 stays Box 3 —
  // because the number is what gets written on the carton; the last box can't go, there's always one to scan into.
  function deleteActive() {
    if (boxes.length === 1) return;
    if (boxUnits(active) > 0 && !confirmDelete) { setConfirmDelete(true); return; }
    const rest = boxes.filter((b) => b.id !== active.id);
    setBoxes(rest);
    setHistory((h) => h.filter((x) => x.boxId !== active.id));
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
          <span className="mx-2 text-slate-300">·</span>
          <span className="text-xs text-slate-400">Loaded from the database — changes here aren&apos;t saved yet</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={storedUnits === 0}
            onClick={() => downloadShippingPlan(initial)}
            title={storedUnits === 0 ? 'No packed boxes yet' : `Amazon shipping plan: ${storedUnits} units across ${storedBoxes} ${storedBoxes === 1 ? 'box' : 'boxes'}`
              + (editedHere ? ' — your unsaved changes here aren’t included' : '')}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Shipping plan
          </button>
          {/* MARK SHIPPED — clears the WHOLE stored shipment (owner, 2026-10-01): archive, stock off C3-Amazon, boxes emptied.
              Inline confirm stating exactly what goes; can't be undone from here, so it is never one click. */}
          {confirmShip ? (
            <span className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
              <span className="text-slate-700">
                Ship all {storedBoxes} {storedBoxes === 1 ? 'box' : 'boxes'} ({storedUnits} units)?
                {editedHere && <span className="text-amber-700"> Your unsaved changes here aren&apos;t included.</span>}
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
              disabled={storedUnits === 0}
              onClick={() => { setConfirmShip(true); setShipError(null); }}
              title={storedUnits === 0 ? 'No packed boxes to ship' : 'The boxes have gone — clear the whole shipment'}
              className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <TruckIcon className="h-4 w-4" />
              Mark shipped
            </button>
          )}
        </div>
        {shipError && <div className="w-full text-sm text-red-700">{shipError}</div>}
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
                  {confirmDelete ? `Delete Box ${active.id} and its ${boxUnits(active)} ${boxUnits(active) === 1 ? 'unit' : 'units'}?` : 'Delete box'}
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
              className="h-12 w-full rounded-md border border-slate-300 px-4 font-mono text-lg text-slate-900 placeholder:font-sans placeholder:text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="mt-1.5 h-5 text-sm">
              {lastScan && (
                <span className="text-emerald-700">
                  Added <span className="font-mono">{lastScan.code}</span> to Box {lastScan.boxId}
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
                  <th className="w-12 px-4 py-2" />
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
                    <td className="px-4 py-2 text-right">
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
