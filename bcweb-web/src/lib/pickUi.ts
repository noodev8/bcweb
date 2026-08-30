/*
=======================================================================================================================================
Module: src/lib/pickUi.ts
=======================================================================================================================================
Purpose: The Pick module's shared vocabulary — the state palette and the per-mode action buttons. Kept out of the page file because
         Next's App Router only allows a fixed set of named exports from a page.tsx.

THE PALETTE FOLLOWS orderStatusUi.ts's CUSTOMER_STATES DELIBERATELY, because the two screens describe the same physical units from
opposite ends and an operator moves between them all day. `picked` is teal in both. `waiting` here is the flat disabled grey that
`pending` wears there — same meaning (reserved on a shelf, nobody has moved), same job for the eye, which is to be skipped: on a
normal list EVERY row is waiting, so any colour on it would be colour on everything. The two exception states get the loud hues,
because they are the only rows on this screen that mean "a human hit a problem":

  not_found  RED    — the shoe wasn't on the shelf. Nobody has dealt with it; the stock figure is now wrong somewhere.
  restock    AMBER  — dealt with on purpose (it needs putting back), so it's held rather than broken. Same red/amber split as
                      no_stock vs waiting on Customer Orders.

`picked` is the only state a normal row is MEANT to reach, and it gets the first colour for the same reason it does there — it is
the first thing anyone actually did.
=======================================================================================================================================
*/

import type { PickState, PickMode, PickShopifyAction, PickAmazonAction } from '@/lib/api';

export const PICK_STATES: Record<PickState, { label: string; stripe: string; pill: string }> = {
  waiting:   { label: 'On shelf',  stripe: 'bg-slate-200',  pill: 'bg-slate-100 text-slate-400 ring-slate-200' },
  picked:    { label: 'Picked',    stripe: 'bg-teal-500',   pill: 'bg-teal-50 text-teal-700 ring-teal-200' },
  not_found: { label: 'Not found', stripe: 'bg-red-500',    pill: 'bg-red-50 text-red-700 ring-red-200' },
  restock:   { label: 'Re-stock',  stripe: 'bg-amber-400',  pill: 'bg-amber-50 text-amber-800 ring-amber-200' },
};

/*
 * The action buttons, per mode. `primary` is the one action a normal row is heading for, and it's the only filled button on the bar
 * (UI restraint: emphasise the element, not the button — one action gets weight, the rest are plain).
 *
 * The Shopify four are the legacy parm values (see utils/pick.js server-side). The Amazon two are NOT the legacy's — PowerBuilder's
 * Amazon branch ignored its parm and only ever unallocated, which left the tab with no button for the job it exists to do. Owner's
 * call, 2026-08-30.
 */
export interface PickActionSpec { action: PickShopifyAction | PickAmazonAction; label: string; primary?: boolean; hint: string }

export const SHOPIFY_ACTION_BAR: PickActionSpec[] = [
  { action: 'pick',      label: 'Pick',      primary: true, hint: 'Off the shelf and in the packing area' },
  { action: 'unpick',    label: 'Unpick',    hint: 'Put it back — undoes a pick, a not-found or a re-stock' },
  { action: 'not_found', label: 'Not found', hint: "Walked to the shelf and it wasn't there" },
  { action: 'restock',   label: 'Re-stock',  hint: 'Needs putting back into stock' },
];

export const AMAZON_ACTION_BAR: PickActionSpec[] = [
  { action: 'to_amazon',  label: 'Moved to C3-Amazon', primary: true, hint: 'Gathered onto the Amazon shelf for the next FBA shipment' },
  { action: 'unallocate', label: 'Unallocate',         hint: 'Not going to Amazon after all — hand it back to the free pool' },
];

export function actionBar(mode: PickMode): PickActionSpec[] {
  return mode === 'amazon' ? AMAZON_ACTION_BAR : SHOPIFY_ACTION_BAR;
}

/*
 * ageClass(days) -> tone for the Days column.
 *
 * A customer order sitting unpicked is OUR inaction, not a supplier's lead time, so this is the tight scale — the same reasoning as
 * chosenAgeClass in orderStatusUi.ts, and tighter still: everything on this list is already paid for and in the building. Two days
 * unpicked is a customer wondering where their shoes are.
 */
export function pickAgeClass(days: number | null): string {
  if (days === null) return 'text-slate-400';
  if (days >= 3) return 'text-red-700 bg-red-50';
  if (days >= 2) return 'text-amber-700 bg-amber-50';
  return 'text-slate-500';
}

/*
 * matchesTerm(row-ish, term) -> boolean
 *
 * The find box, which is the reason this screen exists on a desktop at all: the mobile app scans, so the useful desktop equivalent is
 * a box you can scan or type into. A scanner types the barcode and presses Enter, so BARCODE HAS TO MATCH EXACTLY somewhere in the
 * set — everything else is a loose contains.
 *
 * Matched fields are the four things printed on or near the shoe: barcode, SKU code, the order number, and the shelf location.
 */
export function matchesTerm(
  row: { barcode: string | null; code: string; ordernum: string; location: string; title: string | null },
  term: string,
): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return (
    (row.barcode || '').toLowerCase().includes(t) ||
    row.code.toLowerCase().includes(t) ||
    row.ordernum.toLowerCase().includes(t) ||
    row.location.toLowerCase().includes(t) ||
    (row.title || '').toLowerCase().includes(t)
  );
}
