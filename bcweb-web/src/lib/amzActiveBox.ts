/*
=======================================================================================================================================
The user's ACTIVE AMZ BOX — the box being filled, before it's packed (owner, 2026-10-16: "dont want the box saved until its locked ...
dont even give them a box num till they press pack ... swapping between goods in and amz doesnt start a new box. just throw into the
users active box - once they save /lock it they start a new active box").
=======================================================================================================================================
One box per user, held in THIS BROWSER (owner's choice, 2026-10-16), keyed by the logged-in display name: Goods In puts the Amazon
units it books in here, AMZ Shipment scans into it, and the same PC sees the same box on both screens and after a reload. Nothing is
in the DB until Pack (POST /amz-shipment-pack), which stores it under its new number; then the box is emptied here and the next scan
starts the next one. Unpack (POST /amz-shipment-unpack) brings a stored box back into it.

Accepted trade-off: cleared browser data loses an unpacked box (the shoes are still booked in to C3-Amazon — they're rescanned), and a
different PC has its own box.

localStorage is an external store, so screens read it with useSyncExternalStore (useActiveBox) — never copied into state by an effect
(docs/maintenance-notes.md). Every change is read-modify-write from storage, so two tabs (Goods In and AMZ Shipment) can't overwrite
each other with a stale copy; the `storage` event updates the other tab, a local event this one. Storage that is blocked (private
window) just means an empty box that doesn't survive a reload.
=======================================================================================================================================
*/

import { useSyncExternalStore } from 'react';

export interface ActiveLine { code: string; qty: number; sku?: string; fnsku?: string; groupid?: string; title?: string }
export interface ActiveDims { length: string; width: string; height: string; weight: string }
// lastPacked = the number the last Pack gave this box, so Goods In can say it after going straight back there. Cleared by the next unit.
export interface ActiveBox { lines: ActiveLine[]; dims: ActiveDims; lastPacked: number | null }

export const NO_DIMS: ActiveDims = { length: '', width: '', height: '', weight: '' };
const EMPTY: ActiveBox = { lines: [], dims: NO_DIMS, lastPacked: null };
const EVENT = 'amz-active-box';
const keyOf = (user: string) => `amzShipment.activeBox.${user}`;

function parse(raw: string | null): ActiveBox {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw);
    const lines: ActiveLine[] = Array.isArray(v?.lines)
      ? v.lines.filter((l: ActiveLine) => l && typeof l.code === 'string' && Number.isInteger(l.qty) && l.qty > 0)
      : [];
    const dims = { ...NO_DIMS };
    for (const k of Object.keys(NO_DIMS) as (keyof ActiveDims)[]) dims[k] = String(v?.dims?.[k] ?? '');
    return { lines, dims, lastPacked: Number.isInteger(v?.lastPacked) ? v.lastPacked : null };
  } catch { return EMPTY; }
}

function readRaw(user: string): string | null {
  try { return localStorage.getItem(keyOf(user)); } catch { return null; }
}

// Blocked storage: kept in memory for this page so the screen still works until a reload.
const memory = new Map<string, string>();
function write(user: string, box: ActiveBox) {
  const raw = JSON.stringify(box);
  memory.set(user, raw);
  try { localStorage.setItem(keyOf(user), raw); } catch { /* memory only */ }
  window.dispatchEvent(new Event(EVENT));
}

export function readActiveBox(user: string): ActiveBox {
  return parse(readRaw(user) ?? memory.get(user) ?? null);
}

function update(user: string, fn: (b: ActiveBox) => ActiveBox) {
  write(user, fn(readActiveBox(user)));
}

// One unit in. The same code again is the same line; a new line goes on top (the newest scan first, as the box shows it).
export function addToActiveBox(user: string, line: Omit<ActiveLine, 'qty'>) {
  update(user, (b) => {
    const hit = b.lines.find((l) => l.code === line.code);
    const lines = hit ? b.lines.map((l) => (l.code === line.code ? { ...l, qty: l.qty + 1 } : l)) : [{ ...line, qty: 1 }, ...b.lines];
    return { ...b, lines, lastPacked: null };
  });
}

// One unit out. Returns false when the box holds no such line (it was packed since, or already taken out).
export function takeFromActiveBox(user: string, code: string): boolean {
  let found = false;
  update(user, (b) => {
    found = b.lines.some((l) => l.code === code);
    return { ...b, lines: b.lines.map((l) => (l.code === code ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0) };
  });
  return found;
}

export function setActiveDims(user: string, dims: ActiveDims) {
  update(user, (b) => ({ ...b, dims }));
}

// Empty box: everything out, the measurements kept (it's the same carton).
export function emptyActiveBox(user: string) {
  update(user, (b) => ({ ...b, lines: [] }));
}

// After Pack: a fresh box, remembering the number just given.
export function packedActiveBox(user: string, box: number) {
  write(user, { lines: [], dims: NO_DIMS, lastPacked: box });
}

export function dismissPacked(user: string) {
  update(user, (b) => ({ ...b, lastPacked: null }));
}

// After Unpack: the stored box becomes this one. Only offered while this box is empty, so nothing is lost.
export function replaceActiveBox(user: string, lines: ActiveLine[], dims: ActiveDims) {
  write(user, { lines, dims, lastPacked: null });
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

// Snapshots must be stable between changes: parsed once per distinct stored string.
const cache = new Map<string, { raw: string | null; box: ActiveBox }>();
function snapshot(user: string): ActiveBox {
  const raw = readRaw(user) ?? memory.get(user) ?? null;
  const hit = cache.get(user);
  if (hit && hit.raw === raw) return hit.box;
  const box = parse(raw);
  cache.set(user, { raw, box });
  return box;
}

export function useActiveBox(user: string): ActiveBox {
  return useSyncExternalStore(subscribe, () => snapshot(user), () => EMPTY);
}

export const activeUnits = (b: ActiveBox) => b.lines.reduce((n, l) => n + l.qty, 0);
