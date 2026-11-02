/*
=======================================================================================================================================
API Route: ebay_profit_preview
=======================================================================================================================================
Method: GET
Purpose: The eBay profit beside the price box on the listing form (owner, 2026-11-01: "Shopify price editable before listing", with the
         eBay profit beside it) — recalculated as the price is typed. THE EBY formula (utils/ebayProfit.js), with the postage the
         buyer pays (utils/ebayListingRules.js POSTAGE — £0, free, since 2026-11-02) — the server's formula, so the screen never carries a second copy. READ ONLY.

Requires auth.
=======================================================================================================================================
Request: GET /ebay-profit-preview?groupid=FLE030-IVES-WHITE&price=39.99

Success Response: { "return_code": "SUCCESS", "profit": 8.62 }      // null when the style's cost is unusable
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BAD_REQUEST"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { ebayProfit } = require('../utils/ebayProfit');
const { POSTAGE } = require('../utils/ebayListingRules');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  const groupid = String(req.query.groupid || '').trim();
  const price = Number(req.query.price);
  if (!groupid || !Number.isFinite(price) || price <= 0) return res.json({ return_code: 'BAD_REQUEST', message: 'groupid and a price above 0 are needed' });
  try {
    const r = await query(`SELECT ${safeNumeric('cost')} AS cost FROM skusummary WHERE groupid = $1`, [groupid]);
    const cost = r.rows[0] && r.rows[0].cost !== null ? Number(r.rows[0].cost) : null;
    const p = cost === null ? null : ebayProfit({ price, postage: POSTAGE, cost, orderTotal: price + POSTAGE, orderUnits: 1 });
    return res.json({ return_code: 'SUCCESS', profit: p === null ? null : Math.round(p * 100) / 100 });
  } catch (err) {
    logger.error('[ebay-profit-preview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not work out the profit' });
  }
});

module.exports = router;
