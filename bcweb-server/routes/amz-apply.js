/*
=======================================================================================================================================
API Route: amz_apply
=======================================================================================================================================
Method: POST
Purpose: The Amazon Pricing write (W-A1, docs/amz-pricing-spec.md §4) — record a new Amazon price for ONE SKU. Deliberately smaller
         than the Shopify apply: it does NOT change any live price by itself. It writes a single amz_price_log row; the price only
         actually reaches Amazon when the operator downloads the one-file upload (/amz-upload-file) and uploads it to Seller Central.

Rules enforced here (never trust the client):
  - BLOCK  newPrice < hard-floor (cost + FBA fee)      -> PRICE_BELOW_FLOOR   (breakeven; can't knowingly sell at a loss)
  - ALLOW+FLAG newPrice > RRP                            -> warnings:['ABOVE_RRP']
    (The tidy working-floor and any discovered ceiling are *guidance in the suggestion*, not hard write bounds — the playbook
     deliberately clears dead piles below the tidy floor and harvests above prior levels. Only breakeven and RRP are hard here.)
  - Money rounded to 2dp. amz_price_log.old_price/new_price are numeric columns, so numbers are written (not strings).
  - NEVER write amzfeed (it is refreshed nightly from Amazon — any write is clobbered; hard rule from AMZ_PRICING.md).
  - The optional `note` carries the operator's rationale (the row's suggestion "why" is a good default the client can pass). Capped.

Schema note: amz_price_log has no `changed_by` column yet (schema is id, log_date, code, old_price, new_price, notes). Per the spec
(§4/§6) recording who applied a change wants that column added; until then this route resolves the operator from the token but does not
persist it. Adding `changed_by text` + one extra INSERT column is the intended follow-up.
=======================================================================================================================================
Request Payload:
{ "code": "FLE030-IVES-WHITE-05", "newPrice": 39.79, "note": "creep 0.50 — 14u/7d" }   // note optional

Success Response:
{ "return_code": "SUCCESS", "code": "...", "new_price": 39.79, "old_price": 39.29, "warnings": ["ABOVE_RRP"] }  // warnings [] if none
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "INVALID_PRICE" · "PRICE_BELOW_FLOOR" · "NOT_FOUND" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { code } = body;
    const newPriceRaw = body.newPrice;

    if (!code || newPriceRaw === undefined || newPriceRaw === null) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code and newPrice are required' });
    }

    const newPriceNum = Number(newPriceRaw);
    if (!Number.isFinite(newPriceNum) || newPriceNum <= 0) {
      return res.json({ return_code: 'INVALID_PRICE', message: 'newPrice must be a positive number' });
    }
    const rounded = Math.round(newPriceNum * 100) / 100;

    const note = (body.note === undefined || body.note === null ? '' : String(body.note)).trim().slice(0, 500);

    // Load the SKU's live price (for old_price) + economics for the floor. amzfeed is FBA/Amazon truth; cost/rrp on skusummary.
    const cur = await query(`
      SELECT ${safeNumeric('a.amzprice')} AS live_price,
             ${safeNumeric('a.fbafee')}   AS fbafee,
             ${safeNumeric('sk.cost')}    AS cost,
             ${safeNumeric('sk.rrp')}     AS rrp
      FROM amzfeed a
      LEFT JOIN skusummary sk ON sk.groupid = a.groupid
      WHERE a.code = $1
    `, [code]);

    if (cur.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'SKU not found in amzfeed' });
    }

    const row = cur.rows[0];
    const oldPrice = num(row.live_price);
    const cost = num(row.cost);
    const fbafee = num(row.fbafee);
    const rrp = num(row.rrp);

    // BLOCK below breakeven (only when both parts are known — can't enforce what we can't read).
    if (cost !== null && fbafee !== null) {
      const hardFloor = Math.round((cost + fbafee) * 100) / 100;
      if (rounded < hardFloor) {
        return res.json({ return_code: 'PRICE_BELOW_FLOOR', message: `Price ${rounded.toFixed(2)} is below the floor ${hardFloor.toFixed(2)} (cost + FBA fee)` });
      }
    }

    const warnings = [];
    if (rrp !== null && rounded > rrp) warnings.push('ABOVE_RRP');

    // Single INSERT, wrapped for consistency with the platform's write convention (utils/transaction.js).
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO amz_price_log (code, old_price, new_price, notes) VALUES ($1, $2, $3, $4)`,
        [code, oldPrice, rounded, note]
      );
    });

    return res.json({ return_code: 'SUCCESS', code, new_price: rounded, old_price: oldPrice, warnings });
  } catch (err) {
    logger.error('[amz-apply] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to apply Amazon price' });
  }
});

module.exports = router;
