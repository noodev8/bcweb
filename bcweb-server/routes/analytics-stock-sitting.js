/*
=======================================================================================================================================
API Route: analytics_stock_sitting
=======================================================================================================================================
Method: GET
Purpose: Reports -> Stock vs Sales, the fourth number and the list under it: stock that is SITTING. Owner, 2026-10-10: "Stock comes in,
         goes out, happy. Sits, not happy so I push it." This is the "sits" — the styles to promote or clear, and one number to push
         down.

SITTING = a style we hold stock of with NO SALE ON ANY CHANNEL FOR 60 DAYS (or never sold). That single test is the whole rule.
         Deliveries are deliberately ignored (owner, 2026-10-10: "We shouldn't care about delivery. My fault if I'm still ordering
         while they are not selling. Just want to know what hasn't sold."). The first cut gave a fresh delivery its own 60 days; that
         was removed, so a style re-ordered while not selling shows here — which is the point.

         Why 60: the owner looked at 30/60/90 the same day. 30 days put HALF the stock on the list in October (summer stock resting —
         it measures the weather); 90 is too late to act on. 60 is "it has stopped" while there's still time to push.

THIS IS A FACT, NOT A FORECAST. Deliberately unlike the EXCESS rules removed 2026-10-10 (git f0ed513, e4f91fd, dd28eb4), which predicted
         need from past pace and misread seasonal buying (a selling Zermatt read as excess). "No sale and no delivery in 60 days" has
         no pace and no season in it. Don't grow it into a stock-needs rule without the owner.

STOCK is the utils/financeStock.js definition (local #FREE, not deleted + amzfeed.amztotal), per style, so `total_units` agrees with
         Month End and the nightly stock_daily line. Read LIVE here (stock_daily is a total, not per style), so it can differ from the
         page's "units in stock" number (last night's reading) by today's movement. Only styles with stock > 0 can be sitting.

NEW PRODUCTS GET THEIR CHANCE (owner, 2026-10-10: "Is NEW factored, to give it a chance?"). A style created in the last NEW_DAYS (90)
         days that hasn't sold in the window is NEW, not sitting — its own third part of the split, and off the list. The PRODUCT's
         age, skusummary.created_at — the same rule and constant as the NEW portfolio status (utils/portfolioStatus.js), so the two
         agree — never a delivery date: a re-order of a non-seller is still sitting (above). After 90 days an unsold new style becomes
         sitting with no action needed. A new style that HAS sold is just selling.

         So stock splits three ways and always adds to 100%: SELLING (sold in 60 days) | NEW (unsold, under 90 days old) | SITTING.

SALES are `sales` rows with qty > 0 on any channel (a return is not a sale). Units are local + Amazon as ONE number — the owner
         doesn't want the split on this list.

         All sitting styles are returned (51 at build time) — the count IS the job, same as the Repricing lists. Most pairs first.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "days": 60,
  "new_days": 90,
  "total_units": 2917,                 // all stock, live — the three parts below always add up to it
  "selling_units": 2527,
  "new_units": 93,
  "sitting_units": 297,                // = the styles below
  "styles": [
    { "groupid": "1017722-BEND", "title": "Birkenstock Bend Low Natural", "brand": "Birkenstock",
      "units": 24, "last_sale": "2026-06-02" | null,
      "idle_days": 130 }              // days since the last sale; null = never sold
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { NEW_DAYS } = require('../utils/portfolioStatus');

router.use(verifyToken);

const SITTING_DAYS = 60;   // see header — the owner's pick between 30/60/90

router.get('/', async (req, res) => {
  try {
    // Dates go out as text (CLAUDE.md: never hand a pg DATE to the JS Date parser).
    const r = await query(
      `WITH local_free AS (
         SELECT groupid, SUM(qty) AS qty FROM localstock
         WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE'
         GROUP BY groupid
       ),
       amz AS (
         SELECT groupid, SUM(amztotal) AS qty FROM amzfeed WHERE groupid IS NOT NULL GROUP BY groupid
       ),
       stock AS (
         SELECT g.groupid, COALESCE(lf.qty, 0)::int AS local_units, COALESCE(a.qty, 0)::int AS amz_units
         FROM (SELECT groupid FROM local_free UNION SELECT groupid FROM amz) g
         LEFT JOIN local_free lf ON lf.groupid = g.groupid
         LEFT JOIN amz a         ON a.groupid  = g.groupid
       ),
       held AS (
         SELECT * FROM stock WHERE local_units + amz_units > 0
       ),
       last_sale AS (
         SELECT groupid, MAX(solddate) AS d FROM sales
         WHERE qty > 0 AND groupid IN (SELECT groupid FROM held)
         GROUP BY groupid
       ),
       idle AS (
         SELECT h.*, s.d AS last_sale
         FROM held h
         LEFT JOIN last_sale s ON s.groupid = h.groupid
       )
       -- EVERY held style comes back (a few hundred rows), classified, so the three parts and the total come from one read and
       -- always add up. The JS below splits them.
       SELECT d.groupid, t.shopifytitle AS title, NULLIF(TRIM(ss.brand), '') AS brand,
              d.local_units + d.amz_units AS units,
              to_char(d.last_sale, 'YYYY-MM-DD') AS last_sale,
              CURRENT_DATE - d.last_sale AS idle_days,
              (d.last_sale IS NOT NULL AND d.last_sale >= CURRENT_DATE - $1::int) AS selling,
              COALESCE(ss.created_at >= now() - make_interval(days => $2::int), false) AS is_new
       FROM idle d
       LEFT JOIN skusummary ss ON ss.groupid = d.groupid
       LEFT JOIN title t       ON t.groupid  = d.groupid
       ORDER BY d.local_units + d.amz_units DESC, d.groupid`,
      [SITTING_DAYS, NEW_DAYS]
    );

    // Selling wins over NEW: a new style that has sold is simply selling. NEW is only the not-yet-sold-in-the-window new ones.
    let total = 0, selling = 0, newUnits = 0;
    const styles = [];
    for (const x of r.rows) {
      const units = Number(x.units);
      total += units;
      if (x.selling) { selling += units; continue; }
      if (x.is_new) { newUnits += units; continue; }
      styles.push({
        groupid: x.groupid,
        title: x.title || null,
        brand: x.brand || null,
        units,
        last_sale: x.last_sale,
        idle_days: x.idle_days === null ? null : Number(x.idle_days),
      });
    }

    return res.json({
      return_code: 'SUCCESS',
      days: SITTING_DAYS,
      new_days: NEW_DAYS,
      total_units: total,
      selling_units: selling,
      new_units: newUnits,
      sitting_units: total - selling - newUnits,
      styles,
    });
  } catch (err) {
    logger.error('[analytics-stock-sitting] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load sitting stock' });
  }
});

module.exports = router;
