/*
=======================================================================================================================================
Module: utils/listLimit.js
=======================================================================================================================================
Purpose: One source of truth for how many rows the WINNERS / LOSERS lists return (Shopify + Amazon, four routes).

Why it exists: those lists used to default to the top 10, which was an arbitrary shortlist size — the operator would clear it and the
list would silently refill, so "10" told them nothing about how much work the segment actually held. The lists are now "show the whole
qualifying set" (today the biggest real list is ~30 rows), with a LIMIT kept purely as a safety net so a pathological segment can never
dump thousands of rows into the browser. Keeping the numbers here stops the four routes drifting apart.

parseListLimit(raw): clamp a client-supplied ?limit= into [1, MAX_LIST_LIMIT]; anything absent/non-numeric falls back to the default.
=======================================================================================================================================
*/

const DEFAULT_LIST_LIMIT = 100;   // effectively "everything" for today's data — a cap, not a shortlist size
const MAX_LIST_LIMIT = 500;       // hard ceiling, even if a client asks for more

function parseListLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!(n > 0)) return DEFAULT_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}

module.exports = { parseListLimit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT };
