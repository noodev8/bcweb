/*
=======================================================================================================================================
API Route: amz_shipment_box_arrived
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment — "Mark arrived" on a stored box: the shoes in it are marked ARRIVED in Order Status. For a delivery that went
         straight into an Amazon box without being scanned on Goods In (owner, 2026-11-03: "if forgot to scan on goods in ... dont need
         to worry about locations or anything literally just mark as arrived").

         ORDER STATUS ONLY. Sets `orderstatus.arrived = 1` + `arriveddate` (London date) and nothing else — no localstock, no
         incoming_stock, no Birk Tracker. The shoe is already in the box; this only stops Order Status showing it as still to come.

         WHICH LINES. Per code, as many lines as the box holds of it (orderstatus is one row per unit), picked by the SAME rule Goods In
         claims with (routes/goods-in-book.js step 3): still-open, genuinely placed (utils/orderStatus.js → placed), supplier lines only,
         AMAZON (ordertype 3) BEFORE LOCAL (2), oldest order first. The UPDATE re-checks arrived = 0 on each locked row, so a line a
         Goods In scan claims at the same moment is skipped, never marked twice. A code with fewer open lines than units boxed marks what there is and is reported in `short` — nothing to mark is
         not an error (it may have been booked in properly). Pressing it twice marks nothing the second time.

         STALE GUARD. The screen sends what it showed in the box (`expect`); if the stored box differs — another bench deleted an earlier
         box and the numbers moved — nothing is written (utils/amzShipment.js → lockBoxIfUnchanged).

         One bclog row (section 'AMZ Shipment'), all in one withTransaction.
=======================================================================================================================================
Request Payload:
{ "box": 3, "expect": [ { "code": "FLE030-IVES-BEIGE-04", "qty": 2 } ] }

Success Response:
{ "return_code": "SUCCESS", "box": 3, "marked": 2,
  "short": [ { "code": "FLE030-IVES-BEIGE-05", "boxed": 2, "marked": 1 } ] }   // codes with fewer open order lines than units boxed
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "STALE" (no such box, or it isn't what the screen showed) · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { lockBoxIfUnchanged } = require('../utils/amzShipment');
const { placed } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const box = Number(req.body?.box);
    const expect = req.body?.expect;
    if (!Number.isInteger(box) || box < 1 || !Array.isArray(expect)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'box and expect are required' });
    }
    const operator = req.user.display_name;

    const outcome = await withTransaction(async (client) => {
      // Same advisory lock as Pack / Delete, so the box numbers can't move under this.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('amzshipment:new-box'))`);
      const rows = await lockBoxIfUnchanged(client, box, expect);
      if (!rows) return null;

      // Units boxed per code (a box can't hold the same code twice — (box, sku) is the key — but total anyway).
      const boxed = new Map();
      for (const r of rows) boxed.set(String(r.code).trim(), (boxed.get(String(r.code).trim()) || 0) + Number(r.qty));
      const codes = [...boxed.keys()];
      const qtys = codes.map((c) => boxed.get(c));

      // Every open line for these codes, ranked per code by the Goods In claim order; keep the first <qty> of each. One query.
      const pick = await client.query(
        `SELECT ordernum, shopifysku FROM (
           SELECT o.ordernum, o.shopifysku, w.qty,
                  ROW_NUMBER() OVER (PARTITION BY UPPER(o.shopifysku)
                                     ORDER BY CASE WHEN o.ordertype = 3 THEN 0 ELSE 1 END, o.orderdate ASC, o.ordernum ASC) AS rn
             FROM orderstatus o
             JOIN unnest($1::text[], $2::int[]) AS w(code, qty) ON UPPER(o.shopifysku) = UPPER(w.code)
            WHERE o.ordertype IN (2,3)
              AND COALESCE(o.arrived, 0) = 0
              AND ${placed('o')}
         ) x
         WHERE rn <= qty`,
        [codes, qtys]
      );
      // Update by the table's key (ordernum, shopifysku). The UPDATE locks each row and re-checks arrived = 0, so a line a Goods In
      // scan claimed in the meantime is skipped, not marked twice; RETURNING is what was really marked.
      let done = [];
      if (pick.rows.length > 0) {
        done = (await client.query(
          `UPDATE orderstatus o
              SET arrived = 1, arriveddate = (now() AT TIME ZONE 'Europe/London')::date
             FROM unnest($1::text[], $2::text[]) AS k(ordernum, sku)
            WHERE o.ordernum = k.ordernum AND o.shopifysku = k.sku AND COALESCE(o.arrived, 0) = 0
            RETURNING o.shopifysku`,
          [pick.rows.map((r) => r.ordernum), pick.rows.map((r) => r.shopifysku)]
        )).rows;
      }

      const markedBy = new Map();
      for (const r of done) {
        const c = codes.find((x) => x.toUpperCase() === String(r.shopifysku).trim().toUpperCase()) || r.shopifysku;
        markedBy.set(c, (markedBy.get(c) || 0) + 1);
      }
      const short = codes
        .filter((c) => (markedBy.get(c) || 0) < boxed.get(c))
        .map((c) => ({ code: c, boxed: boxed.get(c), marked: markedBy.get(c) || 0 }));

      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ($1, 'AMZ Shipment', $2, (now() AT TIME ZONE 'Europe/London')::date,
                 to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [operator, `Box ${box} marked arrived in Order Status: ${done.length} line(s)`]
      );

      return { marked: done.length, short };
    });

    if (outcome === null) {
      return res.json({ return_code: 'STALE', message: `Box ${box} has changed since this screen loaded — it's been reloaded, check it and try again` });
    }
    return res.json({ return_code: 'SUCCESS', box, ...outcome });
  } catch (err) {
    logger.error('[amz-shipment-box-arrived] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark the box arrived' });
  }
});

module.exports = router;
