/*
=======================================================================================================================================
Module: utils/segmentDue.js
=======================================================================================================================================
Purpose: Shared helpers for the Segments review clocks, used by both GET /segments (overview) and GET /segment (detail) so the two
         can never drift on how a clock is classified or how a date is formatted.

  - AMBER_DAYS: how many days before a review date a clock turns amber ("due-soon"). Fixed for v1 (spec §7, tunable).
  - classifyDue(daysOver, off): map days_over = (CURRENT_DATE − next_review_date) to a state. off=true short-circuits to 'off'
    regardless of the date (an operator decision that this area doesn't apply to this segment, e.g. EVA-SEG on Amazon — not
    derived from the date, so it's checked first). Otherwise: +ve = overdue, 0 = due today, −ve = days remaining. A never-worked
    area (next_review_date IS NULL → days_over null) is treated as 'overdue' too (owner: no separate "never" state — a segment
    that's never been reviewed needs attention now, same as an expired clock). daysOverdue stays 0 in that case (no baseline date
    to count from); the UI shows a bare "overdue" instead of "Nd late".
  - isoDate(d): format a pg DATE as 'YYYY-MM-DD' from LOCAL components. IMPORTANT: do NOT use Date.toISOString() for DATE columns —
    node-postgres parses a date as local midnight, and toISOString() converts to UTC, which under BST (Europe/London, +1) shifts the
    day back by one. Timestamps (timestamptz, an actual instant) are fine with toISOString(); only bare DATEs need this.
=======================================================================================================================================
*/

// A clock flips amber this many days before its review date (spec §7 — tunable; fixed for v1).
const AMBER_DAYS = 3;

function classifyDue(daysOver, off) {
  if (off) return 'off';
  if (daysOver === null) return 'overdue'; // never worked → straight to overdue (no separate "never" state; needs attention now)
  if (daysOver > 0) return 'overdue';
  if (daysOver >= -AMBER_DAYS) return 'due-soon';
  return 'ok';
}

// Local-component YYYY-MM-DD for a pg DATE (null-safe). Avoids the UTC day-shift toISOString() would cause under BST.
function isoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

module.exports = { AMBER_DAYS, classifyDue, isoDate };
