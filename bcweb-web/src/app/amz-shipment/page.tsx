'use client';
/*
=======================================================================================================================================
Page: /amz-shipment  (AMZ Shipment — packing the Amazon boxes)
=======================================================================================================================================
Purpose: Where the FBA boxes get packed. Pick's Amazon tab gathers the units flagged for Amazon onto the C3-Amazon shelf; this screen is
         the next step — scanning those shoes into numbered boxes, then sending the shipment.

LAYOUT ONLY (owner, 2026-09-28: "just do the layout for now. users need to be able to scan shoes into an amz box"). Everything here is
client-side and in memory — nothing is looked up and nothing is written, and a reload starts over. A scan is recorded as the raw code the
scanner sent; matching it to a SKU (barcode or FNSKU), checking it against what is on C3-Amazon, and keeping boxes across a reload all
come with the back end.

Decided so far for that back end: when the boxes go out, "Mark shipped" takes the packed units out of localstock (C3-Amazon) in one
transaction. The button is here, disabled, so the layout has its place.

SCANNING. A barcode scanner types the code and presses Enter, so the scan box is just an input that commits on Enter and keeps focus —
scan, scan, scan with no clicks. Every scan goes into the ACTIVE box (highlighted on the left); click another box, or New box, to switch.
The same code scanned twice is one line with qty 2. − takes one off a line; Undo takes off the last scan wherever it went.

MEASUREMENTS (owner, 2026-09-28). Once a box is packed, its length, width and height (cm) and weight (kg) go in under its contents —
Amazon wants all four for every carton. A box with units but no full set is flagged "needs size" in the list. Amazon's standard-carton
limits (63.5 cm on any side, 23 kg) are shown as a warning only; nothing blocks.

AMAZON FILE (owner, 2026-09-28). "Amazon file" downloads the box-contents file uploaded to Seller Central — every box, what's in it (as
Amazon SKUs) and its measurements. Layout only for now: the button is placed and says why it can't be used yet. It needs at least one
packed box and every packed box measured; building the file itself needs the back end (a scan has to become an Amazon SKU) and the
Seller Central template's exact format.
=======================================================================================================================================
*/

import { useRef, useState } from 'react';
import { PlusIcon, MinusIcon, CubeIcon, ArrowUturnLeftIcon, TrashIcon, TruckIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';

interface BoxLine { code: string; qty: number; }
// Measurements are held as typed (strings), so a half-typed "12." isn't rewritten under the cursor.
interface BoxDims { length: string; width: string; height: string; weight: string; }
interface Box { id: number; lines: BoxLine[]; dims: BoxDims; }

const NO_DIMS: BoxDims = { length: '', width: '', height: '', weight: '' };
const newBoxOf = (id: number): Box => ({ id, lines: [], dims: NO_DIMS });
const boxUnits = (b: Box) => b.lines.reduce((n, l) => n + l.qty, 0);

// Amazon's standard-carton limits (UK/EU): no side over 63.5 cm, no box over 23 kg. Advisory here — see MEASUREMENTS in the header.
const MAX_SIDE_CM = 63.5;
const MAX_WEIGHT_KG = 23;
const FIELDS: { key: keyof BoxDims; label: string; unit: string }[] = [
  { key: 'length', label: 'Length', unit: 'cm' },
  { key: 'width', label: 'Width', unit: 'cm' },
  { key: 'height', label: 'Height', unit: 'cm' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
];
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

export default function AmzShipmentPage() {
  const [boxes, setBoxes] = useState<Box[]>([newBoxOf(1)]);
  const [activeId, setActiveId] = useState(1);
  const [scan, setScan] = useState('');
  // Every scan in order, so Undo can take off the last one whichever box it went into.
  const [history, setHistory] = useState<{ boxId: number; code: string }[]>([]);
  const [lastScan, setLastScan] = useState<{ boxId: number; code: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const active = boxes.find((b) => b.id === activeId) ?? boxes[0];
  const totalUnits = boxes.reduce((n, b) => n + boxUnits(b), 0);
  // Packed boxes still missing a measurement — the summary counts them, the list flags each.
  const needSize = boxes.filter((b) => boxUnits(b) > 0 && !dimsComplete(b.dims)).length;
  const warning = dimsWarning(active.dims);
  // Why the Amazon file can't be had yet, in the order you'd fix it — the button's tooltip and the line under it. See AMAZON FILE.
  const fileBlocker = totalUnits === 0 ? 'Scan some shoes into a box first'
    : needSize > 0 ? `Measure ${needSize} more ${needSize === 1 ? 'box' : 'boxes'} first`
    : 'Coming with the back end';
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
    <AppShell title="AMZ Shipment">
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
          <span className="hidden text-xs text-slate-400 sm:inline">{fileBlocker}</span>
          <button
            type="button"
            disabled
            title={fileBlocker}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Amazon file
          </button>
          <button
            type="button"
            disabled
            title="Coming with the back end"
            className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <TruckIcon className="h-4 w-4" />
            Mark shipped
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        {/* BOXES — pick the one you're filling. */}
        <div className="space-y-2">
          {boxes.map((b) => {
            const on = b.id === active.id;
            const units = boxUnits(b);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBox(b.id)}
                className={'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left '
                  + (on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 bg-white hover:bg-slate-50')}
              >
                <CubeIcon className={'h-5 w-5 ' + (on ? 'text-brand-600' : 'text-slate-400')} />
                <span className="font-medium text-slate-900">Box {b.id}</span>
                <span className="ml-auto text-right text-sm tabular-nums text-slate-500">
                  {units} {units === 1 ? 'unit' : 'units'}
                  {units > 0 && !dimsComplete(b.dims) && <span className="block text-xs text-amber-700">needs size</span>}
                </span>
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
                  <th className="px-4 py-2 font-medium">Scanned</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="w-12 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {active.lines.map((l) => (
                  <tr key={l.code} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-mono text-slate-900">{l.code}</td>
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
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Box {active.id} measurements</h3>
              {dimsComplete(active.dims)
                ? <span className="text-xs text-emerald-700">Done</span>
                : boxUnits(active) > 0 && <span className="text-xs text-amber-700">Needed before it can ship</span>}
            </div>
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
    </AppShell>
  );
}
