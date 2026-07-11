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
    case 'due': return 'bg-red-100 text-red-700 border-red-200';      // derived Shopify "work waiting" — same red, no new colour (§9.2)
    case 'due-soon': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'ok': return 'bg-green-100 text-green-700 border-green-200';
    case 'off': return 'bg-slate-200 text-slate-500 border-slate-300 border-dashed';
    default: return 'bg-red-100 text-red-700 border-red-200'; // defensive: unknown → treat as overdue
  }
}

// A derived (Shopify) cell carries live style counts (instock !== null); manual clocks (Housekeeping, Amazon-for-now) don't.
function isDerived(cell: SegmentAreaCell): boolean {
  return cell.instock !== null && cell.instock !== undefined;
}

// A never-worked area comes through as overdue with no baseline date (daysOverdue 0) — show a bare "overdue", not "0d late".
function isNeverWorked(cell: SegmentAreaCell): boolean {
  return cell.dueState === 'overdue' && cell.daysOverdue <= 0;
}

// Compact label for a grid cell — colour carries most of the meaning; a tooltip (see cellTitle) gives the detail.
// A derived Shopify cell shows its live style counts ("12 / 30") rather than a "Nd late" clock (spec §9.3).
export function dueCellLabel(cell: SegmentAreaCell): string {
  if (isDerived(cell)) {
    if (cell.dueState === 'off') return 'off';
    if (cell.instock === 0) return '—';                          // nothing in stock to price
    // Show progress done/total (parked so far / candidates): 0/9 = nothing done yet, ticks up to 9/9 as styles are parked.
    return cell.dueState === 'due' ? `${(cell.instock ?? 0) - (cell.outstanding ?? 0)} / ${cell.instock}` : 'ok';
  }
  switch (cell.dueState) {
    case 'overdue': return isNeverWorked(cell) ? 'overdue' : `${cell.daysOverdue}d late`;
    case 'due-soon': return 'soon';
    case 'ok': return 'ok';
    case 'off': return 'off';
    default: return 'overdue';
  }
}

// Longer, human sentence for the detail page + cell tooltip.
export function dueText(cell: SegmentAreaCell): string {
  if (isDerived(cell)) {
    // Both pricing areas derive the same way; only the channel nouns differ (Amazon counts SKUs/sizes, Shopify counts styles).
    const isAmazon = cell.area.toLowerCase() === 'amazon';
    const noun = isAmazon ? 'SKUs' : 'styles';
    if (cell.dueState === 'off') return 'not applicable';
    if (cell.instock === 0) return isAmazon ? 'no Amazon stock' : 'no Shopify stock';
    if (cell.dueState === 'due') return `${(cell.instock ?? 0) - (cell.outstanding ?? 0)} of ${cell.instock} ${noun} done · ${cell.outstanding} waiting`;
    return cell.nextReview ? `all parked · back ${cell.nextReview}` : `all ${noun} parked`;
  }
  switch (cell.dueState) {
    case 'overdue': return isNeverWorked(cell) ? 'overdue' : `${cell.daysOverdue} day${cell.daysOverdue === 1 ? '' : 's'} overdue`;
    case 'due-soon': return cell.nextReview ? `due ${cell.nextReview}` : 'due soon';
    case 'ok': return cell.nextReview ? `next review ${cell.nextReview}` : 'ok';
    case 'off': return 'not applicable';
    default: return 'overdue';
  }
}

// Tooltip text for a grid cell — due state + who/when last worked.
export function cellTitle(cell: SegmentAreaCell): string {
  // Derived cells (Shopify) have no worklog clock — their status is fully in dueText; skip the worked line.
  const worked = isDerived(cell)
    ? ''
    : cell.lastWorkedAt
      ? `\nLast worked by ${cell.lastWorkedBy || '—'} on ${fmtDate(cell.lastWorkedAt)}`
      : '\nNever worked';
  return `${cell.area}: ${dueText(cell)}${worked}`;
}

// "Worst-overdue" sort score for a segment row = the most-urgent of its areas. Never-worked ranks highest (nothing's ever been done —
// it arrives as overdue with daysOverdue 0), then overdue by how late, then due-soon, then ok. 'off' ranks below even 'ok' — it's
// explicitly not this segment's job, so it should never make a row look urgent. Callers sort desc, tiebreak on revenue.
export function worstDueScore(row: SegmentOverviewRow): number {
  const NEVER = 1e6;
  let worst = -2;
  for (const a of row.areas) {
    const s = a.dueState === 'off' ? -2
      : a.dueState === 'due' ? Math.max(a.outstanding ?? 0, 1)      // derived Shopify: rank by how many styles are waiting (>=1)
        : a.dueState === 'overdue' ? (a.daysOverdue > 0 ? a.daysOverdue : NEVER)
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
