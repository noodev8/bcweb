/*
=======================================================================================================================================
The user's ACTIVE AMZ BOX — the box being filled, before it's packed (owner, 2026-10-16: "dont want the box saved until its locked ...
dont even give them a box num till they press pack ... swapping between goods in and amz doesnt start a new box. just throw into the
users active box - once they save /lock it they start a new active box").
=======================================================================================================================================
One box per user, held in THIS BROWSER (owner's choice, 2026-10-16), keyed by the logged-in display name: Goods In puts the Amazon
units it books in here, AMZ Shipment scans into it, and the same PC sees the same box on both screens and after a reload. Nothing is
in the DB until Pack (POST /amz-shipment-pack), which stores it under its new number; then the box is emptied here and the next scan
starts the next one.

REFILL — UNPACK / EMPTY KEEP THE NUMBER (owner, 2026-10-16: "unpack should keep the number - it just loads that box to the users box so
they can add or remove if needed. then packing it saves the new shoes but keeps that num. the only thing that changes numbers is
deleting a box"). Unpack on a stored box loads its shoes and size into this box; Empty does the same with no shoes (rescan it). Either
way `refill` = that box's number and what was in it, nothing is written yet — the stored box keeps its old contents, so its number
can't be taken — and Pack replaces them under the same number (routes/amz-shipment-pack.js, REFILL).

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
// refill = the stored box this one will replace when packed (see REFILL), with what the screen showed in it.
export interface ActiveRefill { box: number; expect: { code: string; qty: number }[] }
export interface ActiveBox { lines: ActiveLine[]; dims: ActiveDims; lastPacked: number | null; refill: ActiveRefill | null }

export const NO_DIMS: ActiveDims = { length: '', width: '', height: '', weight: '' };
const EMPTY: ActiveBox = { lines: [], dims: NO_DIMS, lastPacked: null, refill: null };
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
    const r = v?.refill;
    const refill = r && Number.isInteger(r.box) && Array.isArray(r.expect)
      ? { box: r.box, expect: r.expect.map((l: { code: unknown; qty: unknown }) => ({ code: String(l.code), qty: Number(l.qty) })) }
      : null;
    return { lines, dims, lastPacked: Number.isInteger(v?.lastPacked) ? v.lastPacked : null, refill };
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

// One unit in: EACH SCAN IS ITS OWN LINE (owner, 2026-10-19: "each scan is its own line"), on top — the newest scan first, as the box
// shows it. Never merged here; Pack's route adds up repeated codes (routes/amz-shipment-pack.js).
export function addToActiveBox(user: string, line: Omit<ActiveLine, 'qty'>) {
  update(user, (b) => {
    return { ...b, lines: [{ ...line, qty: 1 }, ...b.lines], lastPacked: null };
  });
}

// One unit out. Returns false when the box holds no such line (it was packed since, or already taken out).
export function takeFromActiveBox(user: string, code: string): boolean {
  let found = false;
  update(user, (b) => {
    // From the newest line of that code only (lines are newest first) — a refill's loaded lines can still hold a qty above 1.
    const i = b.lines.findIndex((l) => l.code === code);
    found = i >= 0;
    if (!found) return b;
    return { ...b, lines: b.lines.map((l, j) => (j === i ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0) };
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
  write(user, { lines: [], dims: NO_DIMS, lastPacked: box, refill: null });
}

// Unpack (with its shoes) or Empty (none) on a stored box: this box becomes its refill. Only offered while this box is empty.
export function startRefill(user: string, refill: ActiveRefill, lines: ActiveLine[], dims: ActiveDims) {
  write(user, { lines, dims, lastPacked: null, refill });
}

// Stop refilling: the stored box stays as it was; whatever is in this box stays here, to pack as a new box. `box` changes the number
// instead (this screen deleted an earlier box, so the refill's box moved down one).
export function setRefill(user: string, refill: ActiveRefill | null) {
  update(user, (b) => ({ ...b, refill }));
}

export function dismissPacked(user: string) {
  update(user, (b) => ({ ...b, lastPacked: null }));
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
