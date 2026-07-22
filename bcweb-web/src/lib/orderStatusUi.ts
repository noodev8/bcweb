/*
=======================================================================================================================================
Module: src/lib/orderStatusUi.ts
=======================================================================================================================================
Purpose: Shared "how stale is this" styling for the Order Status module — one place for the amber/red day thresholds so the supplier
         list and the batch/order lists agree on what "stuck" means. (Can't live in a page.tsx: Next's App Router only allows a fixed
         set of named exports from a page file.)

TWO SCALES, because the module's two stages age completely differently:

  ON ORDER  (ageClass)       — days since the order was PLACED with the supplier. A few days is just delivery; the thresholds give
                               about a week's warning ahead of the legacy 30-day auto-purge (clean_sales.sql).
  TO PLACE  (chosenAgeClass) — days since the goods were CHOSEN and left un-ordered. Far tighter, because this clock measures our own
                               inaction rather than a supplier's lead time: nothing is on its way, and every day of it is a day the
                               stock lands later. Two days sitting in the queue already deserves a nudge.
=======================================================================================================================================
*/

// --- ON ORDER: waiting on the supplier ---------------------------------------------------------------------------------------
export const STALE_AMBER_DAYS = 14;
export const STALE_RED_DAYS = 21;

export function ageClass(days: number): string {
  if (days >= STALE_RED_DAYS) return 'text-red-700 bg-red-50';
  if (days >= STALE_AMBER_DAYS) return 'text-amber-700 bg-amber-50';
  return 'text-slate-500';
}

// --- TO PLACE: sitting in our own queue --------------------------------------------------------------------------------------
export const UNPLACED_AMBER_DAYS = 2;
export const UNPLACED_RED_DAYS = 4;

export function chosenAgeClass(days: number): string {
  if (days >= UNPLACED_RED_DAYS) return 'text-red-700 bg-red-50';
  if (days >= UNPLACED_AMBER_DAYS) return 'text-amber-700 bg-amber-50';
  return 'text-slate-500';
}

// £ for a possibly-unknown cost. Whole pounds once the total is big enough that pennies are noise — which is how an order value
// actually gets read ("about £400") — but exact to 2dp below that, where the pennies still say something.
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v >= 1000 ? `£${Math.round(v).toLocaleString('en-GB')}` : `£${v.toFixed(2)}`;
}
