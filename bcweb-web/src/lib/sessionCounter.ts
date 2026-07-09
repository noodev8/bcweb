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

export function bumpActionedCount(segment: string): number {
  if (typeof window === 'undefined') return 0;
  const next = getActionedCount(segment) + 1;
  window.sessionStorage.setItem(PREFIX + segment, String(next));
  return next;
}
