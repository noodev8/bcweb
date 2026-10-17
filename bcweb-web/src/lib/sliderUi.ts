/*
=======================================================================================================================================
Helper: sliderUi  (Pricing Slider — labels, colours and the rules arithmetic the form shows)
=======================================================================================================================================
Purpose: The small shared pieces of the Pricing Slider screens (/slider, /slider/[id]). The SERVER owns every rule that decides a price
         (bcweb-server/utils/slider.js); what lives here is only what the form needs to answer "if I set these rules, when does a product
         that starts at RRP reach the floor?" and the reverse "to reach the floor by this date, what step?" — owner, 2026-10-17: "I don't
         want it to wait too long and the season is over". Both assume a product starting AT RRP, a move pressed on the day it is due,
         and no sale; the group page shows each product's own date from the server.
=======================================================================================================================================
*/

import type { SliderAction, SliderGroupState, SliderMember, SliderMemberState, SliderRules } from '@/lib/api';

export const MEMBER_STATE_LABEL: Record<SliderMemberState, string> = {
  sliding: 'Sliding',
  found: 'Found',
  floor: 'At floor',
  repriced: 'Repriced by hand',
  moved: 'Moved',
  removed: 'Removed',
  reset: 'Reset to RRP',
  ended: 'Slider ended',
};
export const MEMBER_STATE_COLOR: Record<SliderMemberState, string> = {
  sliding: 'bg-sky-50 text-sky-700',
  found: 'bg-emerald-50 text-emerald-700',
  floor: 'bg-amber-50 text-amber-700',
  repriced: 'bg-slate-100 text-slate-500',
  moved: 'bg-slate-100 text-slate-500',
  removed: 'bg-slate-100 text-slate-500',
  reset: 'bg-slate-100 text-slate-500',
  ended: 'bg-slate-100 text-slate-500',
};
// What "Move prices" does to each product — the server's decide() (bcweb-server/utils/slider.js) names it, the page only words it.
export const DUE_ACTIONS: SliderAction[] = ['repriced', 'found', 'hold', 'floor', 'lift', 'step'];
export const isDue = (m: SliderMember) => DUE_ACTIONS.includes(m.action as SliderAction);
// The confirm line's tally: "9 cuts · 1 back to RRP · 2 sold"
export const ACTION_TALLY: Record<SliderAction, [string, string]> = {
  step: ['cut', 'cuts'],
  lift: ['back to RRP', 'back to RRP'],
  found: ['sold — holds for good', 'sold — hold for good'],
  hold: ['sold — holds another interval', 'sold — hold another interval'],
  floor: ['at the floor — holds', 'at the floor — hold'],
  repriced: ['priced by hand — leaves', 'priced by hand — leave'],
};
// The log's event names (slider_event.event).
export const EVENT_LABEL: Record<string, string> = {
  created: 'Created', edited: 'Rules changed', paused: 'Paused', resumed: 'Resumed', ended: 'Ended',
  joined: 'Joined', moved: 'Moved out', removed: 'Removed', reset: 'Reset to RRP',
  step: 'Price cut', lift: 'Back to RRP', hold: 'Sold — holding', found: 'Found', floor: 'At floor', repriced: 'Priced by hand',
};

export const GROUP_STATE_LABEL: Record<SliderGroupState, string> = { active: 'Active', paused: 'Paused', ended: 'Ended' };
export const GROUP_STATE_COLOR: Record<SliderGroupState, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  paused: 'bg-amber-50 text-amber-700',
  ended: 'bg-slate-100 text-slate-500',
};

export const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `£${n.toFixed(2)}`);
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

// "−2.3% of RRP every 2 days · floor 50% · stop after 1 sale"
export function rulesSummary(r: SliderRules): string {
  return [
    `−${pct(r.step_pct)} of RRP every ${r.every_days} day${r.every_days === 1 ? '' : 's'}`,
    `floor ${pct(r.floor_pct)}${r.floor_breakeven ? ' + break-even' : ''}`,
    `stop after ${r.stop_after_sales} sale${r.stop_after_sales === 1 ? '' : 's'}`,
  ].join(' · ');
}

// ---- dates: 'YYYY-MM-DD' strings, arithmetic in UTC so a clock change can't move a day -------------------------------------------

export function londonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
// '2026-11-28' -> '28 Nov' (adds the year when it isn't this year's)
export function fmtDay(ymd: string | null | undefined, today?: string): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T00:00:00Z`);
  const sameYear = (today ?? londonToday()).slice(0, 4) === ymd.slice(0, 4);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}
// An ISO instant in London: '17 Oct 14:05'
export function fmtWhen(isoAt: string | null | undefined): string {
  if (!isoAt) return '—';
  return new Date(isoAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

// ---- the rules arithmetic ---------------------------------------------------------------------------------------------------------

/*
 * fromRrp(step, floor, every) -> { moves, days } | null
 * A product starting AT RRP: how many cuts to the floor, and how many days that takes. The first cut is due straight away, so the last
 * lands (moves - 1) intervals later. Mirrors the server's plan() for that case.
 */
export function fromRrp(stepPct: number, floorPct: number, everyDays: number): { moves: number; days: number } | null {
  if (!(stepPct > 0) || !(floorPct > 0) || floorPct >= 100 || !(everyDays >= 1)) return null;
  const moves = Math.ceil((100 - floorPct) / stepPct - 1e-9);
  return { moves, days: Math.max(0, moves - 1) * everyDays };
}

/*
 * stepForDays(days, floor, every) -> step % | null
 * The reverse: the smallest step (to 0.01%) that reaches the floor within `days`, rounded UP so it gets there in time. Moves that fit in
 * the window = floor(days / every) + 1 (one is today). null when the date is not in the future or the step would exceed the 50% cap.
 */
export function stepForDays(days: number, floorPct: number, everyDays: number): number | null {
  if (!(days > 0) || !(floorPct > 0) || floorPct >= 100 || !(everyDays >= 1)) return null;
  const moves = Math.floor(days / everyDays) + 1;
  const step = Math.ceil(((100 - floorPct) / moves) * 100 - 1e-9) / 100;
  return step >= 0.1 && step <= 50 ? step : null;
}
