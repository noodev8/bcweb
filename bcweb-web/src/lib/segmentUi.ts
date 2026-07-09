/*
=======================================================================================================================================
Module: src/lib/segmentUi.ts
=======================================================================================================================================
Purpose: Shared presentation helpers for the Segments heatmap + detail screens — due-state colours, cell/label text, the review-period
         pills, date formatting, and the "worst-overdue" sort score. Kept in one place so the overview grid and the detail page can't
         drift on how a clock looks or reads.
=======================================================================================================================================
*/

import { DueState, SegmentAreaCell, SegmentOverviewRow } from '@/lib/api';

// Review-period pills for "Mark worked + set review". Longer spans than the per-product pricing chips because segments are reviewed
// on a weekly→6-monthly rhythm (owner: IVES-WHITE weekly, Accessories 6-monthly). Value = days; label = the human cadence.
export const SEGMENT_REVIEW_CHIPS: { days: number; label: string }[] = [
  { days: 7, label: '1w' },
  { days: 14, label: '2w' },
  { days: 30, label: '1m' },
  { days: 60, label: '2m' },
  { days: 90, label: '3m' },
  { days: 182, label: '6m' },
];

// Tailwind classes per due state. Palette matches the rest of the app (green/amber/red/slate, cf. PriceSetter's core gauge).
// 'off' gets its own dashed-border slate tone so it reads as a deliberate operator decision, not just "grey = never worked".
export function dueTone(state: DueState): string {
  switch (state) {
    case 'overdue': return 'bg-red-100 text-red-700 border-red-200';
    case 'due-soon': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'ok': return 'bg-green-100 text-green-700 border-green-200';
    case 'off': return 'bg-slate-200 text-slate-500 border-slate-300 border-dashed';
    default: return 'bg-slate-100 text-slate-400 border-slate-200'; // never
  }
}

// Compact label for a grid cell — colour carries most of the meaning; a tooltip (see cellTitle) gives the detail.
export function dueCellLabel(cell: SegmentAreaCell): string {
  switch (cell.dueState) {
    case 'overdue': return `${cell.daysOverdue}d late`;
    case 'due-soon': return 'soon';
    case 'ok': return 'ok';
    case 'off': return 'off';
    default: return 'never';
  }
}

// Longer, human sentence for the detail page + cell tooltip.
export function dueText(cell: SegmentAreaCell): string {
  switch (cell.dueState) {
    case 'overdue': return `${cell.daysOverdue} day${cell.daysOverdue === 1 ? '' : 's'} overdue`;
    case 'due-soon': return cell.nextReview ? `due ${cell.nextReview}` : 'due soon';
    case 'ok': return cell.nextReview ? `next review ${cell.nextReview}` : 'ok';
    case 'off': return 'not applicable';
    default: return 'never worked';
  }
}

// Tooltip text for a grid cell — due state + who/when last worked.
export function cellTitle(cell: SegmentAreaCell): string {
  const worked = cell.lastWorkedAt
    ? `\nLast worked by ${cell.lastWorkedBy || '—'} on ${fmtDate(cell.lastWorkedAt)}`
    : '\nNever worked';
  return `${cell.area}: ${dueText(cell)}${worked}`;
}

// "Worst-overdue" sort score for a segment row = the most-urgent of its areas. Never-worked ranks highest (nothing's ever been done),
// then overdue by how late, then due-soon, then ok. 'off' ranks below even 'ok' — it's explicitly not this segment's job, so it
// should never make a row look urgent. Callers sort desc, tiebreak on revenue.
export function worstDueScore(row: SegmentOverviewRow): number {
  const NEVER = 1e6;
  let worst = -2;
  for (const a of row.areas) {
    const s = a.dueState === 'off' ? -2
      : a.dueState === 'never' ? NEVER
        : a.dueState === 'overdue' ? a.daysOverdue
          : a.dueState === 'due-soon' ? 0.5
            : -1;
    if (s > worst) worst = s;
  }
  return worst;
}

// Money: £ with thousands separators, no pence (gutter is about scale, not precision).
export function fmtMoney(n: number): string {
  return '£' + Math.round(n).toLocaleString('en-GB');
}

// A pg DATE / ISO timestamp -> short local date (e.g. "9 Jul 2026"). null-safe.
export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ISO timestamp -> local date + time (for the work-log). null-safe.
export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
