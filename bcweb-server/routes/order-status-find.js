/*
=======================================================================================================================================
API Route: order_status_find
=======================================================================================================================================
Method: GET
Purpose: The SKU picker behind "add a line" on a supplier's TO PLACE sheet — for the case where the supplier offers a deal while the
         order is being placed and the operator wants it on this order rather than bouncing back to the legacy PowerBuilder screen.

WHY A PICKER AND NOT A TEXT BOX. The added row has to carry a code that genuinely exists in `skumap`, or every downstream join fails
quietly: no title, no barcode (so it's blocked from the CSV), no cost (so the order total lies). Rather than validate a typed code
after the fact, the operator can only choose from real rows — a typo, a non-existent code and a made-up code all become impossible by
construction.

SCOPED TO THE SUPPLIER. Results are restricted to `skumap.supplier = $supplier`, so a Rieker line can't be added to a Lunar order.
That's a real mistake to guard, not a theoretical one: codes are similar-looking and the operator is mid-phone-call. A style this
supplier doesn't sell simply won't appear.

`already` marks SKUs that are ALREADY sitting in this supplier's TO PLACE queue. They stay selectable — "add 2 more of the size we've
already got 1 of" is a normal thing to want, and the add route folds the quantity in — but the UI can say so, so the operator isn't
surprised when the sheet shows 3 rather than the 2 they just asked for.

Deleted SKUs (`skumap.deleted = 1`) are excluded: they're gone from the catalogue and shouldn't be re-orderable.
=======================================================================================================================================
Request Query Params:
  supplier  (string, required)
  term      (string, required, >= 2 chars) — matched case-insensitively against the SKU code and the human title

Success Response:
{
  "return_code": "SUCCESS",
  "results": [
    { "code": "ELZ006-LAKE-BL-04", "groupid": "ELZ006-LAKE-BL", "title": "Womens Lazy Dogz Ankle Wellingtons Navy",
      "size": "04", "uksize": "4 UK", "barcode": "5052149680778", "has_barcode": true, "cost": 17.50, "already": 0 }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { notPlaced } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_RESULTS = 40;

router.get('/', async (req, res) => {
  try {
    const supplier = (req.query.supplier || '').trim();
    const term = (req.query.term || '').trim();
    if (!supplier) return res.json({ return_code: 'MISSING_FIELDS', message: 'supplier is required' });
    if (term.length < 2) return res.json({ return_code: 'MISSING_FIELDS', message: 'term must be at least 2 characters' });

    // ILIKE with the term as a PARAMETER (never interpolated); the % wrappers are added here so the input can't smuggle in its own
    // wildcards beyond what a substring search already allows.
    const like = `%${term}%`;

    const result = await query(`
      SELECT sm.code, sm.groupid, t.shopifytitle AS title,
             RIGHT(sm.code, 2) AS size, sm.uksize,
             regexp_replace(COALESCE(sm.ean, ''), 'B$', '') AS barcode,
             ${safeNumeric('ss.cost')} AS cost,
             COALESCE(q.already, 0) AS already
      FROM skumap sm
      LEFT JOIN title t       ON t.groupid = sm.groupid
      LEFT JOIN skusummary ss ON ss.groupid = sm.groupid
      LEFT JOIN (
        SELECT o.shopifysku, COUNT(*) AS already
        FROM orderstatus o
        WHERE o.supplier = $1 AND o.ordertype IN (2,3) AND COALESCE(o.arrived,0) = 0 AND ${notPlaced()}
        GROUP BY o.shopifysku
      ) q ON q.shopifysku = sm.code
      WHERE sm.supplier = $1
        AND COALESCE(sm.deleted, 0) = 0
        AND (sm.code ILIKE $2 OR t.shopifytitle ILIKE $2)
      ORDER BY t.shopifytitle NULLS LAST, sm.groupid, size
      LIMIT ${MAX_RESULTS}
    `, [supplier, like]);

    const results = result.rows.map((r) => ({
      code: r.code,
      groupid: r.groupid || null,
      title: r.title || null,
      size: r.size,
      uksize: r.uksize || null,
      barcode: r.barcode || '',
      has_barcode: !!r.barcode,
      cost: r.cost === null ? null : Number(r.cost),
      already: Number(r.already) || 0,
    }));

    return res.json({ return_code: 'SUCCESS', results });
  } catch (err) {
    logger.error('[order-status-find] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to search SKUs' });
  }
});

module.exports = router;
