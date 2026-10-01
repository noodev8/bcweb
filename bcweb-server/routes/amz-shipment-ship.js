/*
=======================================================================================================================================
API Route: amz_shipment_ship
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment's "Mark shipped" — the boxes have gone to Amazon, so clear the WHOLE shipment (owner, 2026-10-01). One transaction:

  1. ARCHIVE  every amzshipment row is copied to amzshipment_archive under ONE new shipment id (MAX(id) + 1). That is the legacy
              layout: the archive's `id` is the shipment number, shared by every row of that shipment (161 = 2026-08-19, 162 =
              2026-09-08), and created_at defaults to now(). Inventory's `transit` bucket reads this table (routes/inv-stock.js), so
              the units stay counted for the day or two before Amazon books them into amztotal.
  2. STOCK    the boxed units come off the C3-Amazon shelf. Boxing never touched localstock — the units sit there as ordernum '#FREE',
              allocated 'amz' until the shipment goes (see the `boxed` note in routes/inv-stock.js) — so this is where they leave the
              building. Per code, oldest row first, never more than were boxed. SOFT delete (deleted = 1 + legacy stamp), the same as
              inv-adjust and locations-empty, so a mistake is recoverable until the order sync's housekeeping purges deleted rows.
              A row bigger than what's left to take is decremented instead (live rows are all qty 1, but the table allows more).
  3. CLEAR    amzshipment is emptied — the screen goes back to an empty Box 1.

SHORTFALL IS REPORTED, NOT BLOCKED. A code can be boxed with fewer units on C3-Amazon than in the box (moved there under another location,
or a box packed before the stock was booked in). The archive still records what was SHIPPED — the box is the truth about what went —
and the response lists each code where the shelf came up short, so someone can check the stock. Blocking would strand a shipment
that has already physically left. Spare shelf units that were NOT boxed are left alone.

STALE-SCREEN GUARD: the client sends the box and unit counts it showed when the operator confirmed. The legacy app can still pack into
the same table, so if the stored shipment no longer matches, nothing is written and STALE comes back — you never ship boxes you
didn't see. The table is locked (EXCLUSIVE) for the transaction, so two clicks can't both archive the same rows.

WHAT IS SHIPPED IS THE STORED SHIPMENT. The screen's scans and measurement edits aren't saved yet (see app/amz-shipment/page.tsx), so
they are not part of this; the confirm on screen says so.
=======================================================================================================================================
Request Payload:
{ "boxes": 20, "units": 212 }        // what the operator saw; must match the stored shipment

Success Response:
{
  "return_code": "SUCCESS",
  "shipmentId": 163,
  "boxes": 20, "lines": 131, "units": 212,
  "stockRemoved": 209,                // units taken off C3-Amazon
  "shortfall": [ { "code": "NICE-BLACK2-41", "boxed": 1, "removed": 0 } ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOTHING_TO_SHIP"    — amzshipment is empty
"STALE"              — the stored shipment changed since the screen loaded; reload and look again
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
// Shared date-format constant only — localstock.updated holds the legacy text stamp.
const { LEGACY_STAMP } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

// The shelf the Amazon units are gathered on (Pick's Amazon tab / Goods In for type-3 orders) and the allocation they carry there.
const AMZ_LOCATION = 'C3-Amazon';
const AMZ_ALLOCATED = 'amz';

router.post('/', async (req, res) => {
  try {
    const seenBoxes = Number(req.body?.boxes);
    const seenUnits = Number(req.body?.units);
    if (!Number.isInteger(seenBoxes) || !Number.isInteger(seenUnits)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'boxes and units (as shown on screen) are required' });
    }

    const outcome = await withTransaction(async (client) => {
      // Serialise with any other writer of amzshipment (a second click, the legacy app packing) until commit.
      await client.query('LOCK TABLE amzshipment IN EXCLUSIVE MODE');

      const now = (await client.query(
        `SELECT COUNT(DISTINCT box) AS boxes, COUNT(*) AS lines, COALESCE(SUM(qty), 0) AS units FROM amzshipment`
      )).rows[0];
      const boxes = Number(now.boxes);
      const lines = Number(now.lines);
      const units = Number(now.units);

      if (lines === 0) return { code: 'NOTHING_TO_SHIP' };
      if (boxes !== seenBoxes || units !== seenUnits) return { code: 'STALE', boxes, units };

      // 1. ARCHIVE under one new shipment id. The archive is only ever written here and by the legacy app, both under this lock's
      // transaction or its own, and shipments are days apart, so MAX + 1 is the legacy numbering without a sequence.
      const shipmentId = Number((await client.query(
        `SELECT COALESCE(MAX(id), 0) + 1 AS id FROM amzshipment_archive`
      )).rows[0].id);
      await client.query(
        `INSERT INTO amzshipment_archive (id, box, supplier, code, sku, fnsku, qty, weight, length, height, width)
         SELECT $1, box, supplier, code, sku, fnsku, qty, weight, length, height, width FROM amzshipment`,
        [shipmentId]
      );

      // 2. STOCK. For each boxed code, walk its C3-Amazon rows oldest first with a running total: rows wholly inside the boxed qty are
      // soft-deleted, the one row that straddles it (if any) keeps only the excess. One statement, no per-code loop. `id` is VARCHAR
      // of 8 digits on every live row, so ordering it as text is chronological (same assumption as orderSync.js phase E).
      const removed = await client.query(
        `WITH boxed AS (
           SELECT code, SUM(qty) AS boxed FROM amzshipment GROUP BY code
         ), shelf AS (
           SELECT l.id, l.code, l.qty, b.boxed,
                  SUM(l.qty) OVER (PARTITION BY l.code ORDER BY l.id) AS run
             FROM localstock l
             JOIN boxed b ON b.code = l.code
            WHERE l.location = $1 AND l.allocated = $2 AND l.ordernum = '#FREE'
              AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0
         )
         UPDATE localstock ls
            SET deleted = CASE WHEN s.run <= s.boxed THEN 1 ELSE COALESCE(ls.deleted, 0) END,
                qty     = CASE WHEN s.run <= s.boxed THEN ls.qty ELSE s.run - s.boxed END,
                updated = ${LEGACY_STAMP}
           FROM shelf s
          WHERE ls.id = s.id
            AND s.run - s.qty < s.boxed
         RETURNING ls.code,
                   CASE WHEN s.run <= s.boxed THEN s.qty ELSE s.boxed - (s.run - s.qty) END AS taken`,
        [AMZ_LOCATION, AMZ_ALLOCATED]
      );

      const takenByCode = new Map();
      for (const r of removed.rows) takenByCode.set(r.code, (takenByCode.get(r.code) || 0) + Number(r.taken));
      const boxedByCode = (await client.query(
        `SELECT code, SUM(qty) AS boxed FROM amzshipment GROUP BY code ORDER BY code`
      )).rows;
      const shortfall = boxedByCode
        .map((r) => ({ code: r.code, boxed: Number(r.boxed), removed: takenByCode.get(r.code) || 0 }))
        .filter((r) => r.removed < r.boxed);
      const stockRemoved = [...takenByCode.values()].reduce((n, v) => n + v, 0);

      // 3. CLEAR.
      await client.query('DELETE FROM amzshipment');

      return { code: 'SUCCESS', shipmentId, boxes, lines, units, stockRemoved, shortfall };
    });

    if (outcome.code === 'NOTHING_TO_SHIP') {
      return res.json({ return_code: 'NOTHING_TO_SHIP', message: 'There are no packed boxes to ship' });
    }
    if (outcome.code === 'STALE') {
      return res.json({
        return_code: 'STALE',
        message: `The stored shipment has changed (now ${outcome.boxes} boxes, ${outcome.units} units) — reload and check before shipping`,
      });
    }

    logger.info(`[amz-shipment-ship] shipment ${outcome.shipmentId}: ${outcome.boxes} boxes, ${outcome.units} units, `
      + `${outcome.stockRemoved} off ${AMZ_LOCATION}, ${outcome.shortfall.length} short — by ${req.user.display_name}`);

    const { shipmentId, boxes, lines, units, stockRemoved, shortfall } = outcome;
    return res.json({ return_code: 'SUCCESS', shipmentId, boxes, lines, units, stockRemoved, shortfall });
  } catch (err) {
    logger.error('[amz-shipment-ship] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark the shipment as shipped' });
  }
});

module.exports = router;
