/*
=======================================================================================================================================
API Route: goods_in_book
=======================================================================================================================================
Method: POST
Purpose: Book ONE physical unit in off a delivery. The only write in the Goods In module, and the port of the legacy PowerBuilder
         of_save (docs/goodsin/). Four things happen and they happen together or not at all:

           1. the order line it arrived against is marked ARRIVED
           2. the unit is placed on a shelf            -> localstock
           3. the arrival is recorded                  -> incoming_stock
           4. the operator's action is logged          -> bclog, section 'Goods In'

         All four inside one withTransaction (CLAUDE.md). Half of this landing is worse than none of it: a localstock row with no
         arrived flag is stock that exists twice (once on the shelf, once still on order), and an arrived flag with no localstock row
         is a shoe that has physically vanished.

ONE ROUND TRIP PER SCAN. This route takes the RAW SCAN, not a code, and resolves it itself — the operator is standing at a bench
firing a gun, and a lookup call followed by a book call doubles the latency of the one thing this screen does. (An earlier
/goods-in-lookup did the identify half separately; it was folded in here and deleted rather than left as a second way to do the same
thing.) The scan is matched against `skumap.code` or `skumap.ean` with the trailing 'B' stripped (CLAUDE.md), exactly, both sides
upper-cased. Exact on purpose: a substring match on a barcode is how you book in the wrong shoe.

WHICH ORDER LINE GETS CLAIMED. The first still-open, genuinely-placed supplier line for this SKU, AMAZON (ordertype 3) BEFORE LOCAL
(2) — the order of_scan2 tests them in, and it matters because it decides where the shoe goes. "Genuinely placed" is
COALESCE(orderdate,'') <> '' via utils/orderStatus.js: an un-placed row is chosen-but-not-bought and cannot have arrived, and the
predicate is never `IS NULL` because the column is varchar and holds an EMPTY STRING (CLAUDE.md landmine). Oldest order first within
each type, so a long-outstanding line is cleared before a fresh one. The row is taken FOR UPDATE, so two operators scanning the same
delivery cannot both claim the same unit.

NOTHING ON ORDER IS NOT AN ERROR. Suppliers ship things nobody ordered, and the legacy screen has a branch for it (of_save falls
through to a plain shelf placement). The unit still goes away as free stock; the response says `expected: false` so the screen can
flag it and the operator can chase it afterwards. Refusing the scan would leave a real, sellable pair in a box.

WHERE IT GOES. A claimed AMAZON line sends the unit to the C3-Amazon staging bay as `allocated='amz'` — it belongs to FBA, not to the
pick pool, and utils/orderSync.js re-flags that bay on every run anyway. Everything else goes to the shelf the operator chose, free and
unallocated. THE SHELF IS VALIDATED against the `location` table: the legacy screen could only offer real racks because it was a
dropdown, and an API that trusts the string would let a typo mint a phantom location that nothing else references.

`workstation` CARRIES THE LOGIN NAME, not a machine tag. Legacy wrote 'WS7' there; the point of the log is which operator did what
(owner, same call as inv-adjust.js), and the login name answers that where a workstation id no longer does. The log line keeps the
legacy phrasing ("Goods In <code> to <target>") so web and PowerBuilder rows read identically in bclog.
=======================================================================================================================================
Request Payload:
{
  "scan":  "5052149511232",     // required — a barcode or a SKU code, any case, trailing 'B' tolerated
  "shelf": "C3-Back-Stage"      // required — where LOCAL stock goes. Ignored when an Amazon line is claimed.
}

Success Response:
{
  "return_code": "SUCCESS",
  "code": "FLE030-IVES-BLACKSOLE-06",
  "title": "Womens Lunar St Ives Leather Casual Trainer",
  "destination": "C3-Amazon",       // where the operator must physically put it
  "amazon": true,                   // claimed an Amazon line -> staged for FBA
  "expected": true,                 // false = nothing was on order; booked in as free stock
  "supplier": "Lunar",
  "ordernum": "AMZ-O-WS7-4515",     // the claimed line, null when nothing was on order
  "incomingId": 16376,              // handles for /goods-in-cancel
  "localstockId": "WEB-8f2c…"
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"        -- nothing in skumap matches the scan; the screen stops the line
"BAD_SHELF"        -- the shelf is not a rack in `location`
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { placed } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

// The FBA staging bay. Matches AMAZON_SHELF in utils/pick.js and the exclusion in goods-in-shelves.js.
const AMAZON_SHELF = 'C3-Amazon';

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const rawScan = typeof body.scan === 'string' ? body.scan.trim() : '';
    const shelf = typeof body.shelf === 'string' ? body.shelf.trim() : '';

    if (!rawScan || !shelf) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'scan and shelf are required' });
    }

    // Same normalisation the client does (src/lib/goodsIn.ts -> normaliseScan), repeated here so the route is correct on its own: a
    // future caller that forgets would otherwise get NOT_FOUND for a shoe sitting in the catalogue.
    const scan = /^\d+B$/i.test(rawScan) ? rawScan.slice(0, -1) : rawScan;

    // The logged-in operator, resolved server-side by verifyToken and never trusted from the client (CLAUDE.md).
    const operator = req.user.display_name;

    const outcome = await withTransaction(async (client) => {
      // --- 1. WHAT IS IN MY HAND. skusummary carries the supplier/brand a localstock row needs; skumap maps the scan to a groupid.
      const skuRes = await client.query(`
        SELECT m.code, m.groupid, t.shopifytitle AS title, s.supplier, s.brand
        FROM skumap m
        LEFT JOIN skusummary s ON s.groupid = m.groupid
        LEFT JOIN title t      ON t.groupid = m.groupid
        WHERE UPPER(m.code) = UPPER($1)
           OR regexp_replace(COALESCE(m.ean, ''), 'B$', '') = $1
        ORDER BY COALESCE(m.deleted, 0) ASC
        LIMIT 1
      `, [scan]);
      if (skuRes.rows.length === 0) return { fail: 'NOT_FOUND' };
      const sku = skuRes.rows[0];

      // --- 2. IS THAT SHELF REAL. Checked against the racks table, not against a string the client sent. C3-Amazon is refused as a
      // manual choice for the same reason goods-in-shelves.js doesn't offer it: a unit reaches the outbound bay by claiming an Amazon
      // line, never by being told to.
      const shelfRes = await client.query(
        `SELECT location FROM location WHERE lower(btrim(location)) = lower($1) LIMIT 1`, [shelf]
      );
      if (shelfRes.rows.length === 0) return { fail: 'BAD_SHELF' };
      if (shelfRes.rows[0].location.trim().toLowerCase() === AMAZON_SHELF.toLowerCase()) return { fail: 'BAD_SHELF' };
      const chosenShelf = shelfRes.rows[0].location.trim();

      // --- 3. CLAIM AN ORDER LINE. Amazon before local (of_scan2), oldest order first within each. FOR UPDATE so two operators
      // working the same delivery cannot claim the same unit. (ordernum, shopifysku) is the table's real primary key, so the row can
      // be updated — and later un-claimed by /goods-in-cancel — precisely.
      const claimRes = await client.query(`
        SELECT o.ordernum, o.shopifysku, o.ordertype, o.supplier, o.ponumber
        FROM orderstatus o
        WHERE UPPER(o.shopifysku) = UPPER($1)
          AND o.ordertype IN (2,3)
          AND COALESCE(o.arrived, 0) = 0
          AND ${placed('o')}
        ORDER BY CASE WHEN o.ordertype = 3 THEN 0 ELSE 1 END, o.orderdate ASC, o.ordernum ASC
        LIMIT 1
        FOR UPDATE
      `, [sku.code]);
      const claim = claimRes.rows[0] || null;

      if (claim) {
        await client.query(
          `UPDATE orderstatus
             SET arrived = 1, arriveddate = (now() AT TIME ZONE 'Europe/London')::date
           WHERE ordernum = $1 AND shopifysku = $2`,
          [claim.ordernum, claim.shopifysku]
        );
      }

      const amazon = claim ? Number(claim.ordertype) === 3 : false;
      const target = amazon ? AMAZON_SHELF : chosenShelf;
      const allocated = amazon ? 'amz' : 'unallocated';

      // --- 4. PUT IT ON THE SHELF. One row, qty 1, matching how goods-in has always written localstock (one row per physical unit).
      // The legacy 'YYYYMMDD HH24:MI:SS' Europe/London stamp so a web-written row is indistinguishable from a PowerBuilder one.
      const stampRes = await client.query(`SELECT to_char(now() AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS') AS stamp`);
      const stamp = stampRes.rows[0].stamp;
      const localstockId = `WEB-${crypto.randomUUID()}`;
      await client.query(`
        INSERT INTO localstock (id, updated, ordernum, location, groupid, code, supplier, qty, brand, deleted, assigned, pickorder, allocated)
        VALUES ($1, $2, '#FREE', $3, $4, $5, $6, 1, $7, 0, NULL, 100, $8)
      `, [localstockId, stamp, target, sku.groupid, sku.code, sku.supplier, sku.brand, allocated]);

      // --- 5. RECORD THE ARRIVAL. arrival_date is the London date cast in SQL — never a JS Date, which under BST would land a day
      // early (CLAUDE.md).
      const incRes = await client.query(`
        INSERT INTO incoming_stock (code, groupid, arrival_date, quantity_added, created_at, target, workstation)
        VALUES ($1, $2, (now() AT TIME ZONE 'Europe/London')::date, 1, now(), $3, $4)
        RETURNING id
      `, [sku.code, sku.groupid, target, operator]);

      // --- 6. LOG IT. Legacy phrasing, login name where the workstation tag used to go. bclog.id is a generated identity — never written.
      await client.query(`
        INSERT INTO bclog (workstation, section, log, date, time, created_at)
        VALUES ($1, 'Goods In', $2,
                (now() AT TIME ZONE 'Europe/London')::date,
                to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())
      `, [operator, `Goods In ${sku.code} to ${target}`]);

      return {
        code: sku.code,
        title: sku.title || null,
        destination: target,
        amazon,
        expected: Boolean(claim),
        supplier: claim ? claim.supplier : (sku.supplier || null),
        ordernum: claim ? claim.ordernum : null,
        incomingId: Number(incRes.rows[0].id),
        localstockId,
      };
    });

    if (outcome.fail === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'No SKU matches that scan' });
    }
    if (outcome.fail === 'BAD_SHELF') {
      return res.json({ return_code: 'BAD_SHELF', message: 'That is not a shelf a delivery can be put on' });
    }
    return res.json({ return_code: 'SUCCESS', ...outcome });
  } catch (err) {
    logger.error('[goods-in-book] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to book that unit in' });
  }
});

module.exports = router;
