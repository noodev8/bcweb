'use client';
/*
=======================================================================================================================================
Component: AmzBoxSizeDialog — the BOX SIZE pop-up every AMZ box Pack goes through
=======================================================================================================================================
Shared by AMZ Shipment and Goods In (owner, 2026-10-28: "let the user pack an amz shipment box from goods in so dont need to swap
screen"). Moved here unchanged from app/amz-shipment/page.tsx — MEASUREMENTS in that page's header has the rules (all four needed,
Amazon's limits a warning only, Birk box / Set quick fills, a draft that only Pack keeps).
=======================================================================================================================================
*/

import { useRef, useState, type KeyboardEvent } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { NO_DIMS, type ActiveDims } from '@/lib/amzActiveBox';

type BoxDims = ActiveDims;

// Amazon's standard-carton limits (UK/EU): no side over 63.5 cm, no box over 23 kg. Advisory — see MEASUREMENTS in AMZ Shipment's header.
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
export const dimsComplete = (d: BoxDims) => FIELDS.every((f) => dimNum(d[f.key]) !== null);
function dimsWarning(d: BoxDims): string | null {
  const over = (['length', 'width', 'height'] as const).filter((k) => (dimNum(d[k]) ?? 0) > MAX_SIDE_CM);
  const heavy = (dimNum(d.weight) ?? 0) > MAX_WEIGHT_KG;
  const parts: string[] = [];
  if (over.length) parts.push(`${over.join(' / ')} over ${MAX_SIDE_CM} cm`);
  if (heavy) parts.push(`over ${MAX_WEIGHT_KG} kg`);
  return parts.length ? `Over Amazon's standard box limit: ${parts.join(', ')}.` : null;
}

// BOX SIZE pop-up (see MEASUREMENTS in AMZ Shipment's header). Opened by every Pack. The four fields big, the two quick fills,
// Amazon's limit warning, then Pack. It edits a DRAFT seeded from your box's size (owner, 2026-10-20: "if i type in box size then cancel
// the box cause i wasnt ready dont save those measurements") — only Pack writes it to your box; Cancel, Esc or the backdrop drop it.
// Enter: with all four filled it packs (ENTER ON WEIGHT PACKS, owner 2026-10-16 — now from any field); otherwise it moves to the next
// empty field. Opens on the first empty field.
export default function SizeDialog({ initial, packLabel, canPack, onPack, onClose }: {
  initial: BoxDims; packLabel: string; canPack: boolean; onPack: (d: BoxDims) => void; onClose: () => void;
}) {
  const [dims, setDims] = useState<BoxDims>(initial);
  const refs = useRef<Partial<Record<keyof BoxDims, HTMLInputElement | null>>>({});

  function onDim(key: keyof BoxDims, value: string) {
    setDims((d) => ({ ...d, [key]: value.replace(/[^0-9.]/g, '') }));
  }

  // Quick fill: only non-blank values are written, so Birk box (no weight) and a Set with a field left empty keep what's there.
  function fill(src: Partial<BoxDims>) {
    setDims((d) => {
      const next = { ...d };
      for (const f of FIELDS) { const v = (src[f.key] ?? '').trim(); if (v) next[f.key] = v; }
      return next;
    });
  }

  // SET (owner, 2026-10-15) — for packing the same size box again and again without retyping it. One click, no panel, no message:
  //   a size is typed  -> it becomes Set's saved values;
  //   none is          -> the saved values are filled in.
  function onSet() {
    if (FIELDS.some((f) => dims[f.key].trim() !== '')) savePreset(dims);
    else fill(loadPreset());
  }
  const onBirk = () => fill(BIRK_BOX);
  const doPack = () => onPack(dims);

  const complete = dimsComplete(dims);
  const warning = dimsWarning(dims);
  const firstEmpty = FIELDS.find((f) => dimNum(dims[f.key]) === null)?.key ?? 'weight';

  function onKey(e: KeyboardEvent, key: keyof BoxDims) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (complete) { if (canPack) doPack(); return; }
    const i = FIELDS.findIndex((f) => f.key === key);
    const next = [...FIELDS.slice(i + 1), ...FIELDS.slice(0, i)].find((f) => dimNum(dims[f.key]) === null);
    if (next) refs.current[next.key]?.focus();
  }

  // Quick fills move focus to whatever is still empty (weight, after Birk box) — read off the inputs once they've re-rendered, as this
  // render's `dims` is from before the fill.
  function afterFill(fill: () => void) {
    fill();
    setTimeout(() => {
      const empty = FIELDS.map((f) => refs.current[f.key]).find((el) => el && el.value.trim() === '');
      (empty ?? refs.current.weight)?.focus();
    }, 0);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-12" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="box-size-title" className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 id="box-size-title" className="text-lg font-semibold text-slate-900">Box size</h2>
          <p className="text-sm text-slate-500">Amazon needs all four before the box can be packed.</p>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">{f.label}</span>
                <span className="relative block">
                  <input
                    ref={(el) => { refs.current[f.key] = el; }}
                    autoFocus={f.key === firstEmpty}
                    type="text"
                    inputMode="decimal"
                    value={dims[f.key]}
                    onChange={(e) => onDim(f.key, e.target.value)}
                    onKeyDown={(e) => onKey(e, f.key)}
                    className={'h-11 w-full rounded-md border bg-white pl-3 pr-10 text-right text-lg tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500 '
                      + (dimNum(dims[f.key]) === null ? 'border-amber-300' : 'border-slate-300')}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{f.unit}</span>
                </span>
              </label>
            ))}
          </div>
          {/* QUICK FILL (owner, 2026-10-01). Birk box = the standard carton's three sides; weight is left alone because it depends on
              what's packed. Set saves the typed size, or fills an empty one with the saved size (onSet). */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => afterFill(onBirk)}
              title={`${BIRK_BOX.length} × ${BIRK_BOX.width} × ${BIRK_BOX.height} cm — weight left for you to enter`}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Birk box
            </button>
            <button type="button" onClick={() => afterFill(onSet)}
              title="Typed a size? Set saves it. Empty size? Set fills in the saved one."
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Set
            </button>
          </div>
          {warning && <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{warning}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={doPack} disabled={!complete || !canPack}
            className="flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40">
            <CheckCircleIcon className="h-4 w-4" />{packLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
