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

BIRK TRACKER (ALWAYS, owner 2026-09-21 — it was the screen's toggle from 2026-09-17 and is no longer optional). Birkenstock is never
in `orderstatus`, so a Birk pair books in here as free stock and, separately, used to need beeping in again on the Birk Tracker. Goods
In is now the ONLY way a Birk delivery is counted in — the tracker screen's own scan box was removed on 2026-09-21 — so this step can
no longer be left off: a scan that skipped it would silently under-count the season order with nothing recording why. Every scan counts
the pair arrived on the season order book, on the line invoiced longest ago (utils/birkTracker.js, header point 3, owns that rule).
Running it unconditionally costs a non-Birkenstock scan one indexed lookup that returns nothing: `markArrivedFromGoodsIn` returns null
for a shoe that was never going to be on the book, so the screen shows nothing and nothing is written.
It runs INSIDE this transaction but behind a SAVEPOINT, and that asymmetry is the point: the shoe is physically in the
operator's hand and must get a shelf whatever the tracker thinks, so a tracker problem — no open line, not on the book, a database
error — rolls back only the tracker step and comes back in `birk` as a message for the screen. The reverse is not true: if the
booking fails, the tick goes with it, because a pair the tracker counts but no shelf holds is exactly the double-count this avoids.

AMAZON UNITS GO STRAIGHT INTO AN AMZ BOX (owner, 2026-10-07: "if i scan 3 amz products on goods in and then go to the amz boxing
screen those 3 will be in an amz box together ready"). A claimed AMAZON line also puts the unit into `amzshipment`, the table the AMZ
Shipment screen packs from, and the screen prints its FNSKU label (the response's `amzBox.fnsku`). WHICH BOX: ONE BOX PER GOODS IN
SESSION (owner, 2026-10-07: "each goods in session / screen is 1 box. only do a NEW box if its a new session"). The screen sends the
box its session's Amazon units are going into (`amzBox`) and the unit goes in it, unconditionally — even if that box has since been
emptied, the session keeps its number. Only when none is sent (the session's first Amazon unit) is a NEW box started, max(box) + 1, so
a session never lands in a box someone is already packing. The new number is taken under a transaction-scoped advisory lock, so two
benches starting boxes at once can't both pick the same one. Known edge, accepted: if AMZ Shipment deletes an EARLIER box mid-session,
its renumbering moves this session's box down one and the session keeps writing to the old number. Same savepoint asymmetry as the Birk Tracker: the shoe still books in to C3-Amazon
whatever the box step does (no FNSKU in amzfeed yet, a database error) and the reason comes back as `amzBox.message` — the operator can
box it by hand on AMZ Shipment. Stock is untouched by boxing, as on that screen: the unit is still the C3-Amazon localstock row written
here, and Mark shipped takes it off.
=======================================================================================================================================
Request Payload:
{
  "scan":   "5052149511232",    // required — a barcode or a SKU code, any case, trailing 'B' tolerated
  "shelf":  "C3-Back-Stage",    // required — where LOCAL stock goes. Ignored when an Amazon line is claimed.
  "amzBox": 4                   // optional — this session's AMZ box; omitted for its first Amazon unit (see above)
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
  "localstockId": "WEB-8f2c…",
  "birk": null,                     // null = not a Birk and not on the book. Otherwise ONE of:
      // { "marked": true, "ordernum": "0001927328", "code": "…-38", "requested": 3, "invoiced": 3, "arrived": 2, "invoicenum": "5290103870" }
      // { "marked": false, "reason": "NOT_ON_TRACKER" | "ALL_ARRIVED" | "ERROR", "message": "…" }   -- the unit WAS still booked in
  "amzBox": null                    // null = not an Amazon unit. Otherwise ONE of:
      // { "boxed": true, "box": 4, "sku": "…", "fnsku": "X001L0082L", "qty": 2 }  -- qty = that code's line in the box after this unit; sku+fnsku print the label
      // { "boxed": false, "message": "…" }                               -- the unit WAS still booked in to C3-Amazon
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
const { markArrivedFromGoodsIn } = require('../utils/birkTracker');
const { addUnitToBox } = require('../utils/amzShipment');
const logger = require('../utils/logger');

router.use(verifyToken);

// The FBA staging bay. Matches AMAZON_SHELF in utils/pick.js. Still where a claimed AMAZON line is sent whatever the operator picked;
// no longer a shelf the operator is forbidden to pick (see step 2).
const AMAZON_SHELF = 'C3-Amazon';

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const rawScan = typeof body.scan === 'string' ? body.scan.trim() : '';
    const shelf = typeof body.shelf === 'string' ? body.shelf.trim() : '';
    const wantBox = body.amzBox == null ? null : Number(body.amzBox);

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
        SELECT m.code, m.groupid, m.ean, t.shopifytitle AS title, s.supplier, s.brand
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

      // --- 2. IS THAT SHELF REAL. Checked against the racks table, not against a string the client sent. Any rack in `location` is
      // allowed, C3-Amazon included: it used to be refused here to match goods-in-shelves.js, and both were opened up together
      // (owner, 2026-09-11) — see the NOT_A_DESTINATION note there for what booking a local unit onto the bay does and does not mean.
      // The route still refuses anything that is not in the table at all, which is what BAD_SHELF is for.
      const shelfRes = await client.query(
        `SELECT location FROM location WHERE lower(btrim(location)) = lower($1) LIMIT 1`, [shelf]
      );
      if (shelfRes.rows.length === 0) return { fail: 'BAD_SHELF' };
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

      // --- 7. BIRK TRACKER, always. Behind a savepoint so a failure here undoes only this step — see the header.
      let birk;
      await client.query('SAVEPOINT birk_tracker');
      try {
        birk = await markArrivedFromGoodsIn(client, {
          code: sku.code,
          eans: [scan, String(sku.ean || '').trim().replace(/B$/i, '')],
          isBirk: /^birkenstock$/i.test(String(sku.brand || '').trim()),
          who: operator,
        });
        await client.query('RELEASE SAVEPOINT birk_tracker');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT birk_tracker');
        logger.error('[goods-in-book] birk tracker step failed:', err.message);
        birk = { marked: false, reason: 'ERROR', message: 'Could not update the Birk Tracker — mark this pair there by hand' };
      }

      // --- 8. AMAZON -> AN AMZ BOX. Behind a savepoint so a failure here undoes only this step — see the header.
      let amzBox = null;
      if (amazon) {
        await client.query('SAVEPOINT amz_box');
        try {
          // The session's box if it has one; a new box only for the session's first Amazon unit — see the header.
          let box = Number.isInteger(wantBox) && wantBox >= 1 ? wantBox : null;
          if (box === null) {
            await client.query(`SELECT pg_advisory_xact_lock(hashtext('amzshipment:new-box'))`);
            box = Number((await client.query(`SELECT COALESCE(MAX(box), 0) + 1 AS box FROM amzshipment`)).rows[0].box);
          }
          const added = await addUnitToBox(client, box, sku.code);
          if (added.noSku) {
            await client.query('ROLLBACK TO SAVEPOINT amz_box');
            amzBox = { boxed: false, message: `${sku.code} has no FNSKU yet, so it wasn't put in an Amazon box — box it on AMZ Shipment once it has one` };
          } else {
            await client.query('RELEASE SAVEPOINT amz_box');
            amzBox = { boxed: true, box, sku: added.sku, fnsku: added.fnsku, qty: Number(added.qty) };
            logger.info(`[goods-in-book] ${sku.code} -> AMZ box ${box} (screen sent ${wantBox === null ? 'none' : wantBox})`);
          }
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT amz_box');
          logger.error('[goods-in-book] amz box step failed:', err.message);
          amzBox = { boxed: false, message: 'Could not put it in an Amazon box — box it on AMZ Shipment' };
        }
      }

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
        birk,
        amzBox,
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
