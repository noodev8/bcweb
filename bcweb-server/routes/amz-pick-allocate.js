/*
=======================================================================================================================================
API Route: amz_pick_allocate
=======================================================================================================================================
Method: POST
Purpose: The Amazon Order screen's PICK write — turn "send 3 of this SKU to Amazon" into three real, flagged shelf rows. It is the
         missing first link of a chain whose other three links already existed:

           /amazon-order (Pick basket)   code + qty, a browser scratchpad          <- planned here, never persisted
           THIS ROUTE                    localstock.allocated := 'amz'             <- the unit is now committed to FBA
           /pick (Amazon tab)            allocated='amz' AND location<>'C3-Amazon' <- the gather list, unchanged
           /pick -> to_amazon            location := 'C3-Amazon'                   <- off the list, waiting for DPD
           orderSync phase F             re-flags anything on that shelf to 'amz'  <- the backstop

         A ROW IS A PICK **BECAUSE** IT IS NOT AT C3-AMAZON YET. This route never writes `location`; it only raises the flag, wherever
         on the racks the unit happens to sit. C3-Amazon is the DESTINATION, and arriving there is what drops the row off the pick
         list. Rows already there are excluded from the candidate set for the opposite reason — they are staged for a previous
         shipment, not free stock.

ONE SKU PER CALL, and the web page loops it (owner, 2026-09-02 — "do it the same as the order ... just so we know what works and
not"). Same shape as Confirm Basket's existing loop over /order-status-add: each SKU is its own transaction, a SKU that lands clears
its own box, and a SKU that fails leaves that one box filled while the rest go through. A partial BASKET is therefore possible and is
the point — you can see per-SKU which ones didn't land. A partial SKU (asked for 3, only 2 free on the shelf) is reported in `short`,
never an error: the pick list moves under us (the mobile app, orderSync phase E) so the screen's stock figure is always a little old.

IDEMPOTENT BY COUNTING WHAT IS ALREADY PENDING. `already_pending` is the units for this code that are ALREADY flagged and still
waiting to be gathered — utils/pick.js -> modeFilter('amazon'), the very same predicate the pick list selects on, so there is exactly
one definition of "a pending pick" in the codebase. Only the shortfall against it is allocated, which makes a double-tap of Confirm
Basket harmless rather than doubling the pick. Units already AT C3-Amazon are deliberately NOT counted: they are staged stock and the
order screen already has them inside fba_total, so the shortfall it asked for was computed net of them.

SPLIT DOWN TO ONE ROW PER UNIT (owner, 2026-09-02 — "just like how everything else works"). A shelf row can hold several units, and a
row cannot be half-flagged. Taking k units from a row of n leaves k rows of qty 1 flagged 'amz' and, when n > k, one free remainder
row of qty n-k on the same shelf — the same manoeuvre orderSync phase E performs when it allocates a customer pick. One unit per row
is what lets /pick select by `localstock.id` and lets a gather come back partial ("found 2 of the 3").

NEVER WRITES qty AS A STATUS, ordernum OR location. Writing qty on a '#FREE' row is the hazard utils/pick.js's mode gate exists to
prevent — qty=0 both hides the unit from sellable stock and gets it DELETED outright by orderSync phase F, shelf still full. The
flagged row stays '#FREE' at qty 1, on the shelf it was already on.

THE COST OF A PICK, worth knowing before pressing the button: orderSync phase E only allocates `allocated='unallocated'` rows, so
flagging a unit for Amazon takes it away from Shopify customer orders. That is what the screen's Pick keep rate is protecting. This is
a real commitment to physical stock, not more scratchpad — which is why the web side confirms with a unit total first.

Candidates are taken `ORDER BY location, id` — the same order phase E takes them in, so the two allocators competing for the same
shelf agree on which unit goes first, and FOR UPDATE so two operators confirming at once cannot spend the same unit twice.

Schema landmines respected: localstock.updated is TEXT ('YYYYMMDD HH24:MI:SS', Europe/London) and is written on every row touched
(CLAUDE.md). New row ids are minted 'WEB-<uuid>' — the same scheme routes/inv-adjust.js uses for bcweb-authored rows (localstock.id is
a VARCHAR PK with no sequence). Sellable stock is localstock, never skusummary.stockvariants. Audited to bclog in-transaction;
changed_by is resolved from the token, never sent by the client. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "code": "0745531-GIZEH-37",   // required — the SKU (localstock.code), one per call
  "qty": 3                      // required — units to commit to Amazon, integer 1..50
}
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "code": "0745531-GIZEH-37",
  "requested": 3,
  "already_pending": 1,   // units for this code already flagged and awaiting gathering, BEFORE this call
  "allocated": 2,         // units this call actually flagged (0 when already covered)
  "pending_total": 3,     // already_pending + allocated — what the /pick Amazon tab now holds for this code
  "short": 0,             // requested - pending_total, i.e. units the shelf could not supply. NOT an error.
  "splits": 1             // multi-unit rows broken up to get there (diagnostic only)
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_QTY"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { writeBcLog } = require('../utils/bclog');
const { AMAZON_SHELF, modeFilter } = require('../utils/pick');
const logger = require('../utils/logger');

router.use(verifyToken);

// A single SKU's pick. The real numbers are one or two units; 50 is far above any honest send and far below "the whole shelf".
const MAX_QTY = 50;

// The legacy text stamp PowerBuilder writes (CLAUDE.md), as a SQL fragment — same one routes/pick-action.js uses.
const LEGACY_STAMP = `to_char(now() AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS')`;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const qty = Number(body.qty);

    if (!code) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code is required' });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return res.json({ return_code: 'INVALID_QTY', message: `qty must be a whole number between 1 and ${MAX_QTY}` });
    }

    const who = req.user.display_name;

    const result = await withTransaction(async (client) => {
      // One legacy-format stamp for every row this call touches, so a web-written row is indistinguishable from a PowerBuilder one.
      const stampRes = await client.query(`SELECT ${LEGACY_STAMP} AS stamp`);
      const stamp = stampRes.rows[0].stamp;

      // Units already flagged for Amazon and still waiting to be gathered — the pick list's OWN predicate (utils/pick.js), so this
      // can never drift from what /pick shows. Anything already at C3-Amazon is staged, not pending, and that filter excludes it.
      const pendingRes = await client.query(
        `SELECT COALESCE(SUM(ls.qty), 0)::int AS units
           FROM localstock ls
          WHERE ls.code = $1 AND ls.qty > 0 AND ${modeFilter('amazon', 'ls')}`,
        [code]
      );
      const alreadyPending = Number(pendingRes.rows[0].units) || 0;

      const needed = qty - alreadyPending;
      if (needed <= 0) {
        // Already covered — say so rather than flagging more. This is the double-tap guard.
        return { alreadyPending, allocated: 0, splits: 0 };
      }

      // Free shelf stock for this exact SKU. Same predicate and same ORDER BY as orderSync phase E's freeSql (which is competing for
      // these very rows), narrowed to exclude the C3-Amazon shelf: units staged there belong to a shipment, not to the pool.
      // FOR UPDATE so two operators confirming baskets at the same moment cannot both spend the same unit.
      const freeRes = await client.query(
        `SELECT id, qty, location, groupid, supplier, brand, pickorder, assigned
           FROM localstock
          WHERE code = $1 AND ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
            AND allocated = 'unallocated' AND location <> $2
          ORDER BY location, id
          FOR UPDATE`,
        [code, AMAZON_SHELF]
      );

      let taken = 0;
      let splits = 0;

      for (const row of freeRes.rows) {
        if (taken >= needed) break;

        const rowQty = Number(row.qty) || 0;
        const take = Math.min(needed - taken, rowQty); // how many of THIS shelf row's units the pick claims

        // The row itself becomes the first flagged unit. qty drops to 1 whenever it held more — the units that drop off it are not
        // lost, they are re-created as the clones and the remainder below.
        await client.query(
          `UPDATE localstock SET qty = 1, allocated = 'amz', updated = $1 WHERE id = $2`,
          [stamp, row.id]
        );

        // Units 2..take from the same row become their own qty=1 flagged rows, cloned from the source so they inherit its exact
        // placement (location/supplier/brand/pickorder/assigned) and stay in the same shelf cluster.
        for (let i = 1; i < take; i++) {
          await client.query(
            `INSERT INTO localstock (id, updated, ordernum, location, groupid, code, supplier, qty, brand, deleted, assigned, pickorder, allocated)
             VALUES ($1, $2, '#FREE', $3, $4, $5, $6, 1, $7, 0, $8, $9, 'amz')`,
            [`WEB-${crypto.randomUUID()}`, stamp, row.location, row.groupid, code, row.supplier, row.brand, row.assigned, row.pickorder]
          );
        }

        // Whatever the pick didn't claim goes back on the shelf as a free row — the same split orderSync phase E does, and the reason
        // this route can take 2 units off a row of 5 without stranding the other 3.
        if (rowQty > take) {
          await client.query(
            `INSERT INTO localstock (id, updated, ordernum, location, groupid, code, supplier, qty, brand, deleted, assigned, pickorder, allocated)
             VALUES ($1, $2, '#FREE', $3, $4, $5, $6, $7, $8, 0, $9, $10, 'unallocated')`,
            [`WEB-${crypto.randomUUID()}`, stamp, row.location, row.groupid, code, row.supplier, rowQty - take, row.brand, row.assigned, row.pickorder]
          );
          splits += 1;
        }

        taken += take;
      }

      if (taken > 0) {
        await writeBcLog(client, {
          who,
          section: 'Amazon Order',
          log: `Amz Pick: ${code} x${taken}${taken < needed ? ` (short ${needed - taken})` : ''}`,
        });
      }

      return { alreadyPending, allocated: taken, splits };
    });

    const pendingTotal = result.alreadyPending + result.allocated;

    return res.json({
      return_code: 'SUCCESS',
      code,
      requested: qty,
      already_pending: result.alreadyPending,
      allocated: result.allocated,
      pending_total: pendingTotal,
      short: Math.max(qty - pendingTotal, 0),
      splits: result.splits,
    });
  } catch (err) {
    logger.error('[amz-pick-allocate] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to allocate the pick' });
  }
});

module.exports = router;
