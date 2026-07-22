/*
=======================================================================================================================================
API Route: order_status_add
=======================================================================================================================================
Method: POST
Purpose: Add a NEW SKU line to a supplier's TO PLACE queue — the "the supplier just offered us a deal on this while I'm placing the
         order" case. Inserts `qty` fresh `orderstatus` rows (one per unit, per the schema's one-row-per-unit rule) with `orderdate`
         left blank, so the line lands in the queue exactly as if it had been chosen in the legacy PowerBuilder request screen.

TO PLACE ONLY — this route cannot add to an order that has already been placed, and that's deliberate rather than an oversight. A row
inserted into a placed batch would claim to be part of a placement that already happened, carrying an `orderdate` and a PO reference
the supplier's actual order does not contain: Goods In then reconciles against a receipt that was never ordered, and the PO stops
meaning "what I asked for". If more is genuinely wanted after an order has gone in, that's a new order. (Adding to a placed batch is
not blocked by a check here — it simply isn't expressible: every row this route writes is un-placed by construction.)

WHY THIS ROUTE EXISTS SEPARATELY FROM /order-status-adjust-qty: `+` there is safe precisely because it CLONES an existing row, so all
~40 legacy columns (supplier, ordertype, ponumber, the 'x' placeholders, ukd/othersupplier, batch, channel) come along for free. A
brand-new code has no template to clone, so every one of those fields has to be set correctly from scratch. The values below mirror
`docs/orders/legacy/order-request.txt` (the PowerBuilder Request write) field for field, verified against live MANUAL rows:

  qty=1, batch='0', channel='MANUAL', arrived=0, orderdate='' (blank — stamped later at Place), createddate=today, amz=0,
  pickedqty/courierfixed/customerwaiting/notorderamz/alloworder/picknotfound/shopcustomer/localstock = 0,
  every shipping/customer text column = 'x' (legacy calls wf_blankorderstatus() first; those columns are nullable but the legacy app
  and its reports expect the placeholder, so we write it rather than leaving NULLs it has never seen),
  ukd/othersupplier: supplier 'UKD' -> ukd=1, othersupplier=0; anything else -> ukd=0, othersupplier=1 (confirmed rule).

`fnsku` is looked up from `amzfeed` (the Amazon fulfilment id) when the SKU has one, matching what the legacy screen carries across;
NULL when it isn't an FBA line. `amzfeed` is READ ONLY here as everywhere (CLAUDE.md).

VALIDATION: the code must exist in `skumap` AND belong to this supplier AND not be deleted. That combination is what stops a typo, a
non-existent code, or a Rieker line landing on a Lunar order — a code that fails it is rejected outright rather than inserted to fail
quietly later (no title, no barcode, no cost, silently dropped from the CSV).
=======================================================================================================================================
Request Payload:
{
  "supplier": "Lunar",              // required — must match the SKU's skumap.supplier
  "code": "ELZ006-LAKE-BL-04",      // required — must exist in skumap
  "qty": 2,                         // required, integer 1..MAX_QTY
  "ordertype": 3                    // optional, 2 = local / 3 = Amazon (default 3, matching the legacy request screen)
}

Success Response:
{ "return_code": "SUCCESS", "added": 2, "code": "ELZ006-LAKE-BL-04", "qty": 2 }   // qty = the line's NEW total in the queue
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"        // code isn't in skumap, is deleted, or belongs to a different supplier
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { notPlaced, LEGACY_STAMP } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

// Caps a single add so a typo (an extra zero) can't insert a silly number of rows. Generous enough for a real bulk deal.
const MAX_QTY = 200;

// The legacy placeholder the PowerBuilder app writes into every shipping/customer text column via wf_blankorderstatus().
const X = 'x';

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const supplier = typeof body.supplier === 'string' ? body.supplier.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const qty = Number(body.qty);
    const ordertype = body.ordertype === undefined || body.ordertype === null ? 3 : Number(body.ordertype);

    if (!supplier || !code) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'supplier and code are required' });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `qty must be an integer between 1 and ${MAX_QTY}` });
    }
    if (ordertype !== 2 && ordertype !== 3) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordertype must be 2 (local) or 3 (Amazon)' });
    }

    const result = await withTransaction(async (client) => {
      // The gate: real, live, and this supplier's. fnsku rides along from amzfeed for FBA lines (READ ONLY).
      // NB the join is amzfeed.CODE, not amzfeed.sku — `sku` there is the Amazon seller-SKU (e.g. 'FLE030 BK-06'), a different
      // string from our internal code; joining on it silently yields no fnsku for most rows.
      const sku = await client.query(`
        SELECT sm.code, af.fnsku
        FROM skumap sm
        LEFT JOIN amzfeed af ON af.code = sm.code
        WHERE sm.code = $1 AND sm.supplier = $2 AND COALESCE(sm.deleted, 0) = 0
        LIMIT 1
      `, [code, supplier]);
      if (sku.rows.length === 0) return null;
      const fnsku = sku.rows[0].fnsku || null;

      const isUkd = supplier.toUpperCase() === 'UKD';

      // One row per unit. ordernum is a free unique field (owner) — the WEB-ADD- prefix keeps it clear of every legacy id space and
      // says where the row came from, which matters when someone is reading the table by hand months from now.
      for (let i = 0; i < qty; i++) {
        await client.query(`
          INSERT INTO orderstatus (
            ordernum, shopifysku, qty, created, updated, batch, supplier, channel, ordertype, createddate,
            arrived, arriveddate, orderdate, fnsku,
            ukd, othersupplier, amz, localstock,
            title, shippingname, postcode, address1, address2, company, city, county, country, phone, shippingnotes,
            email, courier, weight, searchalt,
            pickedqty, courierfixed, customerwaiting, notorderamz, alloworder, picknotfound, shopcustomer
          ) VALUES (
            $1, $2, 1, ${LEGACY_STAMP}, ${LEGACY_STAMP}, '0', $3, 'MANUAL', $4, CURRENT_DATE,
            0, NULL, '', $5,
            $6, $7, 0, 0,
            $8, $8, $8, $8, $8, $8, $8, $8, $8, $8, $8,
            $8, $8, $8, $8,
            0, 0, 0, 0, 0, 0, 0
          )
        `, [
          `WEB-ADD-${crypto.randomUUID()}`,
          code,
          supplier,
          ordertype,
          fnsku,
          isUkd ? 1 : 0,
          isUkd ? 0 : 1,
          X,
        ]);
      }

      // The line's new total in the queue, so the client can confirm "now 3" rather than just "added 2".
      const total = await client.query(`
        SELECT COUNT(*) AS qty FROM orderstatus o
         WHERE o.shopifysku = $1 AND o.supplier = $2 AND o.ordertype IN (2,3) AND COALESCE(o.arrived,0) = 0 AND ${notPlaced()}
      `, [code, supplier]);

      return { added: qty, code, qty: Number(total.rows[0].qty) || 0 };
    });

    if (result === null) {
      return res.json({ return_code: 'NOT_FOUND', message: `${code} isn't a live SKU for ${supplier}` });
    }

    logger.info(`[order-status-add] ${result.added} x ${code} added to ${supplier}'s queue by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', ...result });
  } catch (err) {
    logger.error('[order-status-add] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to add the line' });
  }
});

module.exports = router;
