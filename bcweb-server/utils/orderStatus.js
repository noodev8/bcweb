/*
=======================================================================================================================================
Module: utils/orderStatus.js
=======================================================================================================================================
Purpose: Shared SQL fragments for the Order Status module's two stages, so every route agrees on what "ordered" actually means.

The lifecycle is Chosen -> Placed -> Arrived, and `orderstatus.orderdate` is the marker between the first two:

  - The legacy PowerBuilder request screen (docs/orders/legacy/order-request.txt) INSERTS the orderstatus rows and deliberately never
    touches `orderdate` — the goods have been CHOSEN but not yet bought from the supplier.
  - A later action stamps `orderdate` in bulk once the order is genuinely placed (42 live rows share the stamp '20260714 11:16:50').
    That stamp is what this module now owns (POST /order-status-place).

LANDMINE 1: `orderdate` is `character varying`, NOT a date, and an un-placed row holds an EMPTY STRING, not NULL — so the predicate is
COALESCE(orderdate,'') = '', never `IS NULL`. Getting this wrong silently returns every row.

LANDMINE 2: the text format is the legacy 'YYYYMMDD HH24:MI:SS' (Europe/London wall clock, same convention as skusummary.created /
updated per CLAUDE.md). placedDate() parses the leading date out of it, guarded by a regex so a malformed legacy value degrades to NULL
instead of throwing on to_date.

LANDMINE 3 (dates in JS): never hand a pg DATE to Date.toISOString() — node-postgres parses it as LOCAL midnight, so under BST the UTC
conversion shifts the day back by one. These routes cast dates to text IN SQL (`createddate::text`) so no JS date parsing happens at
all, which sidesteps the whole class of bug. (utils/segmentDue.js documents the same trap.)
=======================================================================================================================================
*/

// Rows that are genuinely on order with the supplier vs merely chosen. Both take the orderstatus table alias so a route reading two
// aliases can't accidentally apply the wrong one.
function placed(alias = 'o') { return `COALESCE(${alias}.orderdate,'') <> ''`; }
function notPlaced(alias = 'o') { return `COALESCE(${alias}.orderdate,'') = ''`; }

// The legacy text stamp -> a real DATE. NULL when the value isn't a parseable 'YYYYMMDD...' (defensive: legacy free-text column).
function placedDate(alias = 'o') {
  return `CASE WHEN ${alias}.orderdate ~ '^[0-9]{8}' THEN to_date(left(${alias}.orderdate, 8), 'YYYYMMDD') ELSE NULL END`;
}

// "Now" in the exact legacy format the PowerBuilder app writes, so a web-placed row is indistinguishable from a legacy-placed one to
// every existing report and script. now() is timestamptz; AT TIME ZONE converts it to London wall-clock before formatting.
const LEGACY_STAMP = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

// Our own PO/order reference: 'BC-YYYYMMDD-NNN'. Legacy ponumbers are strictly 6-digit zero-padded numerics ('158807'), so the 'BC-'
// prefix puts ours in a disjoint space that can never collide with — or be mistaken for — one the supplier allocated.
const PO_PREFIX = 'BC-';

/*
 * nextPoNumber(client) -> 'BC-20260722-001'
 *
 * MUST be called inside a withTransaction callback (it takes a transaction-scoped advisory lock). The lock serialises PO minting so
 * two operators placing orders in the same instant can't both read the same MAX() and mint a duplicate reference — a plain
 * read-then-insert has that race, and the whole point of the reference is that it's unique.
 *
 * The counter is derived from the data rather than a sequence so it self-heals: it reads BOTH orderstatus and orderstatus_archive,
 * because a placed order can be archived out of the live table and a sequence-free counter would otherwise restart and collide.
 * Numbering restarts at 001 each day (the date is already in the reference, so the counter only has to be unique within the day).
 */
async function nextPoNumber(client) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('bcweb_order_po'))`);

  // substring(from 13) = the NNN tail: 'BC-' (3) + 'YYYYMMDD' (8) + '-' (1) = 12 characters of prefix.
  const { rows } = await client.query(`
    WITH today AS (SELECT '${PO_PREFIX}' || to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD') || '-' AS pfx),
    used AS (
      SELECT ponumber FROM orderstatus,        today WHERE ponumber LIKE today.pfx || '%'
      UNION ALL
      SELECT ponumber FROM orderstatus_archive, today WHERE ponumber LIKE today.pfx || '%'
    )
    SELECT (SELECT pfx FROM today) AS pfx,
           COALESCE(MAX(NULLIF(regexp_replace(substring(ponumber from 13), '[^0-9]', '', 'g'), '')::int), 0) + 1 AS seq
    FROM used
  `);

  const { pfx, seq } = rows[0];
  return `${pfx}${String(seq).padStart(3, '0')}`;
}

module.exports = { placed, notPlaced, placedDate, LEGACY_STAMP, PO_PREFIX, nextPoNumber };
