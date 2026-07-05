/*
=======================================================================================================================================
API Route: product_sizes
=======================================================================================================================================
Method: POST
Purpose: Save the size list for a product (skumap). The client sends the FULL desired list in display order; we reconcile skumap to it,
         atomically (withTransaction), mirroring the legacy PowerBuilder save:
           - ORDER: each row's `optionsize` is rewritten as "<position+100>--<sizeDisplay>" (row 1 -> '101--...'), so manual re-ordering
             just re-numbers the prefix — which is exactly what we read the sizes back by.
           - BARCODE: stored in `ean` with a trailing 'B' appended (blank stays blank) — the legacy Excel-guard marker.
           - EXISTING row (matched by `code`): UPDATE ean + optionsize (+ updated). code/groupid never change (code is locked).
           - NEW size (code not in skumap): INSERT with the legacy scaffold, seeding cost from the product's cost and the Amazon
             price fields from RRP (owner decision), so a new size behaves like its siblings. uksize left blank for now.
           - REMOVED (a live code no longer in the list): HARD DELETE (owner decision, matches legacy deleterow).
         Only barcode + size display are editable; code is derived (groupid-<size>) on the client for new rows. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid": "0128221-GIZEH",
  "sizes": [                                   // full list, in display order
    { "code": "0128221-GIZEH-35", "sizeDisplay": "35 EU / 2.5 UK", "barcode": "" },
    { "code": "0128221-GIZEH-36", "sizeDisplay": "36 EU / 3.5 UK", "barcode": "4052001424459" }
  ]
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0128221-GIZEH",
  "sizes": [ { "code": "...", "barcode": "..."|null, "sizeDisplay": "..." }, ... ]   // normalised, in saved order
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_SIZES"   // empty list, blank code/size, spaces in code, or duplicate code/barcode
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

// Format a numeric (or null) as a legacy 2dp string. null -> '0.00'.
const money2 = (n) => (n === null || n === undefined ? '0.00' : Number(n).toFixed(2));

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const groupid = (body.groupid || '').trim();
    const rawSizes = Array.isArray(body.sizes) ? body.sizes : null;

    if (!groupid || !rawSizes) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and sizes[] are required' });
    }

    // Normalise + validate the submitted list (before any DB work).
    const sizes = rawSizes.map((s) => ({
      code: (s && s.code ? String(s.code) : '').trim(),
      sizeDisplay: (s && s.sizeDisplay ? String(s.sizeDisplay) : '').trim(),
      barcode: (s && s.barcode ? String(s.barcode) : '').trim(),
    }));

    if (sizes.length === 0) {
      return res.json({ return_code: 'INVALID_SIZES', message: 'At least one size is required' });
    }
    const seenCodes = new Set();
    const seenBarcodes = new Set();
    for (const s of sizes) {
      if (!s.code || /\s/.test(s.code)) {
        return res.json({ return_code: 'INVALID_SIZES', message: 'Every size needs a code with no spaces' });
      }
      if (!s.sizeDisplay) {
        return res.json({ return_code: 'INVALID_SIZES', message: `Size display is required (code ${s.code})` });
      }
      if (seenCodes.has(s.code)) {
        return res.json({ return_code: 'INVALID_SIZES', message: `Duplicate code: ${s.code}` });
      }
      seenCodes.add(s.code);
      if (s.barcode) {
        if (seenBarcodes.has(s.barcode)) {
          return res.json({ return_code: 'INVALID_SIZES', message: `Duplicate barcode: ${s.barcode}` });
        }
        seenBarcodes.add(s.barcode);
      }
    }

    await withTransaction(async (client) => {
      // Product context: existence + seed values for any new size. safeNumeric guards the legacy varchar price columns.
      const ctx = await client.query(`
        SELECT ${safeNumeric('cost')} AS cost, ${safeNumeric('rrp')} AS rrp, supplier
        FROM skusummary WHERE groupid = $1
      `, [groupid]);
      if (ctx.rows.length === 0) {
        const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e;
      }
      const cost = ctx.rows[0].cost;
      const rrp = ctx.rows[0].rrp;
      const supplier = ctx.rows[0].supplier || '';
      // Amazon seed values (owner: derive from RRP), and an FBA fee copied from a sibling size, else the legacy ini default.
      const amzPrice = money2(rrp);
      const amzMax = money2(rrp);
      const amzMin = rrp === null ? '0.00' : (Number(rrp) * 0.70).toFixed(2);
      const costStr = money2(cost);
      const fbaRow = await client.query(`SELECT fba FROM skumap WHERE groupid = $1 AND fba IS NOT NULL AND fba <> '' LIMIT 1`, [groupid]);
      const fba = fbaRow.rows[0] ? fbaRow.rows[0].fba : '2.24';

      // Which codes currently exist (non-deleted)? Anything here but NOT in the submitted list gets hard-deleted.
      const ex = await client.query(`SELECT code FROM skumap WHERE groupid = $1 AND COALESCE(deleted, 0) = 0`, [groupid]);
      const existing = new Set(ex.rows.map((r) => r.code));

      // Upsert each submitted row in order; the position drives the optionsize ordering prefix.
      for (let i = 0; i < sizes.length; i++) {
        const s = sizes[i];
        const optionsize = `${i + 101}--${s.sizeDisplay}`;   // position (1-based) + 100
        const ean = s.barcode ? `${s.barcode}B` : '';        // re-append the legacy 'B' marker

        if (existing.has(s.code)) {
          await client.query(`
            UPDATE skumap SET ean = $2, optionsize = $3, updated = ${UPDATED_EXPR}
             WHERE groupid = $1 AND code = $4
          `, [groupid, ean, optionsize, s.code]);
        } else {
          // NEW size — legacy scaffold, seeded from the product (cost) and RRP (amazon prices).
          await client.query(`
            INSERT INTO skumap (
              updated, sku, groupid, optionsize, ean, search2, uksize, supplier, code, googleid,
              cost, amzprice, amzminprice, amzmaxprice, fba, deleted, googlestatus, googlecampaign,
              status, pricestatus, amzperformance, amz365, shp365
            ) VALUES (
              ${UPDATED_EXPR}, '', $1, $2, $3, '', '', $4, $5, $5,
              $6, $7, $8, $9, $10, 0, 1, '00',
              '1', 0, 0, 0, 0
            )
          `, [groupid, optionsize, ean, supplier, s.code, costStr, amzPrice, amzMin, amzMax, fba]);
        }
      }

      // Hard-delete the sizes that were removed from the list (only among non-deleted rows, so we never touch legacy soft-deletes).
      const submitted = sizes.map((s) => s.code);
      const toDelete = [...existing].filter((c) => !submitted.includes(c));
      if (toDelete.length > 0) {
        await client.query(`DELETE FROM skumap WHERE groupid = $1 AND code = ANY($2::text[])`, [groupid, toDelete]);
      }
    });

    // Echo the normalised list back (barcode without the 'B') so the client can reset its baseline.
    const outSizes = sizes.map((s) => ({ code: s.code, barcode: s.barcode || null, sizeDisplay: s.sizeDisplay }));
    return res.json({ return_code: 'SUCCESS', groupid, sizes: outSizes });
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'Product not found' });
    }
    logger.error('[product-sizes] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save sizes' });
  }
});

module.exports = router;
