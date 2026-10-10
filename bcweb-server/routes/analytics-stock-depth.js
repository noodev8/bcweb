/*
=======================================================================================================================================
API Route: analytics_stock_depth
=======================================================================================================================================
Method: GET
Purpose: Reports -> Stock vs Sales, the "how deep is the stock?" card. For every style we hold, how many months of ITS OWN sales the
         stock on hand represents. Found 2026-10-09 while asking "have I over-ordered?": overall turnover was healthy (stock turned
         3.1x in the year, up from 2.6x), yet ~39% of all units sat in 68 styles holding MORE THAN A YEAR of what they sell. The average
         hid it — a fast top half carried the rate. Owner: "over-deep stock … I could have done just as much with less invoices." Dead
         stock (no sale at all) was small; depth on slow sellers was the problem. So the card buckets UNITS by depth, not styles by
         status, and lists the styles behind each bucket.

         UNITS      = per style (groupid): localstock #FREE + amzfeed.amztotal — the same definition as stock_daily / Month End
                      (utils/financeStock.js), so this card's total matches the big "units in stock" number.
         PACE       = units sold per month, all channels, net of returns, over the style's last 12 months — or over its life if it is
                      younger than that (a style added in June is judged on June->now, not diluted by months it didn't exist). 12 months
                      on purpose: a full season cycle, so a summer sandal isn't condemned for not selling in October.
         MONTHS     = units / pace.
         BANDS      new      created under NEW_DAYS ago — too young to have a pace; 0 excess, so the page leaves it off the card
                    under6   up to 6 months of its own sales
                    6to12    6 to 12 months
                    over12   more than a year — the over-deep pile. INCLUDES styles with no net sales in their window (months null):
                             that is the same pile at its extreme, and a separate "not selling" band (merged 2026-10-10, owner) only
                             meant one sale flipped a 15-unit style from one tile to the other.
         EXCESS     = units beyond what the style NEEDS: units - NEED_MONTHS x pace, floored at 0. Need depends on how fast more can be
                      had (owner, 2026-10-09): Birkenstock is bought ~6 months ahead and cannot be re-ordered mid-season, so it needs 6
                      months; everything else (Lunar/IVES etc.) can be re-ordered any week, so 2 months. A style with no sales needs
                      nothing — all its units are excess. A 'new' style has no pace yet — counted as 0 excess, never guessed.
                      The page's "excess units" number is the sum: the stock bought beyond need, which the owner wants driven down.
         Thresholds are business judgements and live as constants in utils/stockDepth.js (shared with the Repricing excess list).

         Right NOW only — there is no per-style stock history, so this cannot be shown as a trend.
         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "bands": [ { "band": "over12", "styles": 68, "units": 1153 }, ... ],   // every band, in display order, zeros included
  "excess_units": 942,
  "rows":  [ { "groupid": "...", "title": "...", "brand": "Birkenstock", "units": 40, "sold": 12, "months": 40.0,
               "band": "over12", "excess": 34 }, ... ]
}
"months" is null for the new band, and for over12 styles with no sales. "sold" is net units in the style's window (12 months, or its life if younger).
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { loadStockDepth } = require('../utils/stockDepth');
const logger = require('../utils/logger');

router.use(verifyToken);

// The rule itself (bands, need months, excess) lives in utils/stockDepth.js since 2026-10-10, shared with routes/pricing-excess-list.js
// so a depth tile and the Repricing list it opens always hold the same styles.
router.get('/', async (req, res) => {
  try {
    const { bands, excessUnits, rows } = await loadStockDepth();
    return res.json({ return_code: 'SUCCESS', bands, excess_units: excessUnits, rows });
  } catch (err) {
    logger.error('[analytics-stock-depth] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load stock depth' });
  }
});

module.exports = router;
