/*
=======================================================================================================================================
Util: onShelf
=======================================================================================================================================
Purpose: ON SHELF — when the OLDEST pair we still hold of a size (code) arrived. Read by GET /analytics-slow-sizes and
         GET /analytics-style-sizes (Back Office -> Slow Sizes). Owner, 2026-10-15: a column "saying how long its been on the shelf".

         Dated the unit ledger's way (utils/unitAge.js): oldest sells first, so the pairs held are the code's NEWEST Goods In
         arrivals; walk them newest -> oldest until every held pair is matched, and the last one reached dates the oldest pair.

BEFORE THE LOG = 31 DEC 2024. A held pair that can't be matched to a logged arrival came in before Goods In began logging. It is dated
         LOG_FLOOR (owner, same day: "just pick a date 31/12/2024 then everything rolls as standard instead of putting text in"), so
         every size has a day count. It is a floor, not a fact: such a pair may have been here much longer. A size that SOLD before
         2025 can therefore show more days since its last sale than on shelf — that is this floor, not an error.

         READ-ONLY.
=======================================================================================================================================
Exports:
  LOG_FLOOR                                     '2024-12-31'
  oldestHeldArrival(held: Map<code, units>) -> Map<code, 'YYYY-MM-DD'>   // every code with units > 0
=======================================================================================================================================
*/

const { query } = require('../database');

const LOG_FLOOR = '2024-12-31';

async function oldestHeldArrival(held) {
  const codes = [...held.entries()].filter(([, u]) => u > 0).map(([c]) => c);
  const out = new Map();
  if (codes.length === 0) return out;

  // Newest first within a code — the FIFO order.
  const r = await query(
    `SELECT code, to_char(arrival_date, 'YYYY-MM-DD') AS d, GREATEST(quantity_added, 1)::int AS q
     FROM incoming_stock WHERE code = ANY($1::text[]) AND arrival_date IS NOT NULL
     ORDER BY code, arrival_date DESC, id DESC`,
    [codes]
  );
  const arrivals = new Map();
  for (const a of r.rows) {
    if (!arrivals.has(a.code)) arrivals.set(a.code, []);
    arrivals.get(a.code).push(a);
  }

  for (const code of codes) {
    let left = held.get(code);
    let since = LOG_FLOOR;   // pairs left over after the logged arrivals predate the log
    for (const a of arrivals.get(code) || []) {
      left -= a.q;
      if (left <= 0) { since = a.d; break; }
    }
    out.set(code, since);
  }
  return out;
}

module.exports = { LOG_FLOOR, oldestHeldArrival };
