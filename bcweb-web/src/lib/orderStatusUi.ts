/*
=======================================================================================================================================
Module: src/lib/orderStatusUi.ts
=======================================================================================================================================
Purpose: Shared "how stale is this" styling for the Order Status module — one place for the amber/red day thresholds so the supplier
         list and the batch list agree on what "stuck" means. (Can't live in a page.tsx: Next's App Router only allows a fixed set of
         named exports from a page file.)
=======================================================================================================================================
*/

// Amber before red, giving about a week's warning ahead of the legacy 30-day auto-purge (clean_sales.sql).
export const STALE_AMBER_DAYS = 14;
export const STALE_RED_DAYS = 21;

export function ageClass(days: number): string {
  if (days >= STALE_RED_DAYS) return 'text-red-700 bg-red-50';
  if (days >= STALE_AMBER_DAYS) return 'text-amber-700 bg-amber-50';
  return 'text-slate-500';
}
