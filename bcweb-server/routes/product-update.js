/*
=======================================================================================================================================
API Route: product_update
=======================================================================================================================================
Method: POST
Purpose: Edit Stage 1 — save the product's ATTRIBUTE/ENUM fields only. These span two tables, so the write is atomic (withTransaction):
           - skusummary: brand, colour, segment, season   (+ `updated` audit stamp)
           - attributes: gender, producttype              (+ `updated`); INSERTs a row if the product has none yet
         Deliberately NOT in scope here (own stages, different rules): price/cost/rrp/tax (price goes through the pricing W1 route with
         shopifychange + price_change_log), shopify title, width/material, sizes. So this route does NOT touch shopifychange or write a
         price log — it's a plain catalogue-attribute edit.

         Values are stored as trimmed strings as-is (the legacy data is free-form and lookup tables can be incomplete, e.g. brand
         'Lazy Dogz' isn't in the brand table), so we don't reject off-list values. `updated` is written in the legacy
         'YYYYMMDD HH24:MI:SS' format in Europe/London wall-clock to match existing rows. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid":     "0128221-GIZEH",  // string, required
  "brand":       "Birkenstock",    // string, optional (stored '' if blank)
  "colour":      "White",          // string, optional
  "segment":     "EVA-SEG",        // string, optional
  "season":      "Summer",         // string, optional
  "gender":      "Unisex",         // string, optional -> attributes
  "producttype": "Sandals"         // string, optional -> attributes
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0128221-GIZEH",
  "saved": { "brand": "...", "colour": "...", "segment": "...", "season": "...", "gender": "...", "producttype": "..." }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// SQL expression for the legacy `updated` stamp: 'YYYYMMDD HH24:MI:SS' in UK wall-clock (matches existing rows regardless of server tz).
const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const groupid = (body.groupid || '').trim();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    // Normalise the editable fields to trimmed strings (empty stays '' — matches the legacy blank convention).
    const brand = (body.brand || '').trim();
    const colour = (body.colour || '').trim();
    const segment = (body.segment || '').trim();
    const season = (body.season || '').trim();
    const gender = (body.gender || '').trim();
    const producttype = (body.producttype || '').trim();

    await withTransaction(async (client) => {
      // 1) skusummary header fields. RETURNING confirms the product exists; 0 rows -> abort the whole unit (rollback) as NOT_FOUND.
      const ss = await client.query(`
        UPDATE skusummary
           SET brand = $2, colour = $3, segment = $4, season = $5, updated = ${UPDATED_EXPR}
         WHERE groupid = $1
         RETURNING groupid
      `, [groupid, brand, colour, segment, season]);

      if (ss.rows.length === 0) {
        const e = new Error('NOT_FOUND');
        e.code = 'NOT_FOUND';
        throw e; // withTransaction rolls back
      }

      // 2) attributes (gender/producttype). Most products already have a row; if not (edge case), INSERT the minimal real columns.
      const upd = await client.query(`
        UPDATE attributes
           SET gender = $2, producttype = $3, updated = ${UPDATED_EXPR}
         WHERE groupid = $1
      `, [groupid, gender, producttype]);

      if (upd.rowCount === 0) {
        await client.query(`
          INSERT INTO attributes (groupid, gender, producttype, updated)
          VALUES ($1, $2, $3, ${UPDATED_EXPR})
        `, [groupid, gender, producttype]);
      }
    });

    return res.json({
      return_code: 'SUCCESS',
      groupid,
      saved: { brand, colour, segment, season, gender, producttype },
    });
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'Product not found' });
    }
    logger.error('[product-update] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save product' });
  }
});

module.exports = router;
