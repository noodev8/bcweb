/*
=======================================================================================================================================
API Route: analytics_deep_sizes
=======================================================================================================================================
Method: GET
Purpose: DEEP SELLERS (owner, 2026-11-06): SKUs that sell (Range's green card) but hold 3+ pairs beyond 90 days' worth at their
         12-month pace. The rule, the reasons and the way-out tag live in utils/deepSizes.js (THE copy); this route is the HTTP wrapper
         plus the extras the style rows draw (Range's list layout):
           styles[]  each listed style's picture (skusummary.imagename) and its way out ('shopify' | 'amazon' | 'off')
           held[]    EVERY held size of a listed style (deep or not), so the run can show the deep sizes against the rest
           others[]  the style's sizes we DON'T hold that ever arrived on Goods In or ever sold (grey tiles), as Range's list

         READ-ONLY so far: the owner wants to SEE them first ("I need to see them, know what they are"). Actions come after the test.
         Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-11-06",
  "rule": { "range_days": 90, "new_days": 90, "min_over": 3 },
  "sizes": [                                       // the deep sizes
    { "code": "1017723-BEND-41", "groupid": "1017723-BEND", "size": "41", "title": "…", "brand": "Birkenstock",
      "units": 13,                                 // local + Amazon
      "last_sale": "2026-09-20", "idle_days": 47,
      "sold_12m": 6, "sold_90d": 1,                // net of returns
      "first_seen": "2025-03-10" | null,           // earlier of first Goods In arrival / first sale; null = before the log
      "days_here": 606 | null,
      "keep": 2,                                   // 90 days' worth at its pace, at least 1
      "over": 11,                                  // units − keep
      "on_order": 0,                               // supplier lines not arrived
      "on_amazon": false }
  ],
  "held":   [ same shape as sizes — every held size of the listed styles ],
  "styles": [ { "groupid": "1017723-BEND", "imagename": "1017723.jpg" | null, "units": 61, "deep_units": 40, "way_out": "shopify" } ],
  "others": [ { "groupid": "1017723-BEND", "code": "1017723-BEND-46", "size": "46" } ]
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
const { verifyToken } = require('../middleware/verifyToken');
const { query } = require('../database');
const { readDeepSizes, RANGE_DAYS, NEW_DAYS, MIN_OVER } = require('../utils/deepSizes');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { today, sizes, styles, held } = await readDeepSizes();
    const groupids = styles.map((s) => s.groupid);
    const heldCodes = held.map((x) => x.code);

    // Pictures, and the grey "not held" sizes, as routes/analytics-slow-sizes.js (never-stocked placeholders left out).
    const [imgQ, othersQ] = await Promise.all([
      query(`SELECT groupid, NULLIF(TRIM(imagename), '') AS imagename FROM skusummary WHERE groupid = ANY($1::text[])`, [groupids]),
      query(`SELECT DISTINCT m.groupid, m.code, SUBSTRING(m.code FROM '[^-]*$') AS size
               FROM skumap m
              WHERE m.groupid = ANY($1::text[]) AND m.code IS NOT NULL AND NOT (m.code = ANY($2::text[]))
                AND (EXISTS (SELECT 1 FROM incoming_stock i WHERE i.code = m.code)
                     OR EXISTS (SELECT 1 FROM sales s WHERE s.code = m.code))`, [groupids, heldCodes]),
    ]);
    const img = new Map(imgQ.rows.map((r) => [r.groupid, r.imagename || null]));

    return res.json({
      return_code: 'SUCCESS', today,
      rule: { range_days: RANGE_DAYS, new_days: NEW_DAYS, min_over: MIN_OVER },
      sizes, held,
      styles: styles.map((s) => ({ ...s, imagename: img.get(s.groupid) ?? null })),
      others: othersQ.rows.map((r) => ({ groupid: r.groupid, code: r.code, size: r.size })),
    });
  } catch (err) {
    logger.error('[analytics-deep-sizes] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load deep sellers' });
  }
});

module.exports = router;
