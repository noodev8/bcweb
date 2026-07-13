/*
=======================================================================================================================================
Module: src/lib/sessionCounter.ts
=======================================================================================================================================
Purpose: A session-only "actioned" counter for the pricing Winners list. Winners is a LIVE top-10 (routes/pricing-triage.js) — as
         you action the #1 style it drops out (parked) and the next one slides up, so the list never visibly shrinks even though
         you're working through a bounded pool. This counter is pure feel-good UX sugar to answer "am I getting anywhere": it has
         no relation to segment_worklog or price_change_log (the real audit trails) and is intentionally NOT persisted server-side —
         sessionStorage means it resets on tab close/refresh, which is fine since its only job is to make one sitting feel bounded.
=======================================================================================================================================
*/

const PREFIX = 'bc_pricing_actioned::';

export function getActionedCount(segment: string): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.sessionStorage.getItem(PREFIX + segment);
  return raw ? Number(raw) || 0 : 0;
}

// Bump by `by` (default 1) — the batch "mark reviewed" action parks several SKUs at once, so it adds its whole count in one go. Returns
// the new total so the caller can reflect it immediately (e.g. the list page, which doesn't remount after an in-place batch action).
export function bumpActionedCount(segment: string, by = 1): number {
  if (typeof window === 'undefined') return 0;
  const next = getActionedCount(segment) + Math.max(0, by);
  window.sessionStorage.setItem(PREFIX + segment, String(next));
  return next;
}
