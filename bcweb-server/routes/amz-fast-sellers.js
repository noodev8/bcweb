/*
=======================================================================================================================================
API Route: amz_fast_sellers
=======================================================================================================================================
Method: GET
Purpose: The Fast sellers screen (Amazon Pricing, /amz/fast — owner, 2026-10-22): every Amazon size that sold in the last 30 days, with
         HOW FAST it sold — days from its price going live to the sale, and from its last FBA shipment to the sale (utils/sellSpeed.js,
         which owns those rules). Fastest first. The job is PRICING: a size that sells within days at a thin price can take more. The
         case that asked for it: Rieker X9165-00-38, priced to the Buy Box and sold at £1.91 a unit the same day — "we sold it under £3
         when matching buy box and believe can get more for it".

         NOT ORDERING. Amazon Order's Simmer preset answers "order 1 to try it?" over a narrower set (thin margin, nothing at Amazon);
         this answers "is the price too low?" over every size that sold, whatever its margin or stock — so a size still holding FBA stock
         shows here, which is where a price rise does the most. No links to the order screens (CLAUDE.md: pricing stays apart from
         ordering).

MEMBERSHIP (owner): net units sold in the last 30 days > 0 — amzfeed.amzsold - amzreturn, the same fixed window Amazon Order's Hot and
         Simmer read, so a sale returned the next day doesn't count. Any margin, any stock. NO cutoff on speed (owner: sort, judge by
         eye) and NO review cooldown (owner: always show) — a size priced here stays on the list, and `last_priced` says so.

ORDER: priced_to_sold ascending (fastest first), sizes with no measurable price change after them, then shipped_to_sold, then units
         sold. The page re-sorts client-side; this is the default.

PRICE IN THE BASKET: `queued_price` is the newest price set but not yet uploaded — the same pending rule as routes/amz-basket.js and
         routes/amazon-order-list.js (not uploaded, inside 72h, newest per code, not already the live price); keep the three in step.

`next_review` is skumap.next_amz_price_review as text — the page's Set uses it for the review rule (7 days, or the later date kept).

Schema landmines respected: amzfeed price/fee and skumap.amzprofit / skusummary cost/rrp are VARCHAR -> safeNumeric. Size = the suffix
after the last '-'. Human name from title.shopifytitle. Dates as text. amzfeed is READ ONLY. Requires auth.
=======================================================================================================================================
Request Query Params: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "count": 152,
  "warm_min_unit_profit": 3,                // the £3 line (utils/portfolio.js) — the page's "£3 price" button aims a penny over it
  "rows": [
    { "code": "X9165-00-38", "groupid": "X9165-00", "size": "38", "title": "...", "brand": "Rieker", "segment": "RIEKER-WIN",
      "price": 52.99, "queued_price": null, "rrp": 85.00, "floor": 44.10, "warm_price": 54.11,
      "units_30d": 1, "units_7d": 0, "unit_profit": 1.91, "fba_live": 1, "fba_total": 1, "next_review": "2026-10-29",
      "last_sold": "2026-10-06", "last_sold_price": 52.99,
      "priced_on": "2026-10-06", "priced_to_sold": 0, "shipped_on": "2026-10-01", "shipped_to_sold": 5,
      "last_priced": { "on": "2026-10-06", "by": "Andreas", "note": "...", "price": 52.99, "uploaded": true } },   // null if never
    ...
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
const { safeNumeric } = require('../utils/sql');
const { WARM_MIN_UNIT_PROFIT } = require('../utils/portfolio');
const { priceForProfit } = require('../utils/amzProfit');
const { SELL_SPEED_CTES, sellSpeedSelectSql, sellSpeedJoinSql, sellSpeedFields } = require('../utils/sellSpeed');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// The "£3 price" — a penny over the £3 line, because Warm is unit profit OVER £3 and a booked profit is rounded (as amazon-order-list).
const WARM_PRICE_PROFIT = WARM_MIN_UNIT_PROFIT + 0.01;

router.get('/', async (req, res) => {
  try {
    const result = await query(`
      WITH ${SELL_SPEED_CTES},
      queued AS (
        -- Set but not yet uploaded — EXACTLY the pending rule of routes/amz-basket.js (see the header).
        SELECT DISTINCT ON (l.code) l.code, l.new_price
        FROM amz_price_log l
        LEFT JOIN amzfeed af ON af.code = l.code
        WHERE l.uploaded_at IS NULL
          AND l.changed_at >= now() - interval '72 hours'
          AND ROUND(l.new_price, 2) IS DISTINCT FROM ROUND(${safeNumeric('af.amzprice')}, 2)
        ORDER BY l.code, l.id DESC
      )
      SELECT a.code, a.groupid, SUBSTRING(a.code FROM '[^-]*$') AS size,
             t.shopifytitle AS title, sk.brand AS brand, sk.segment AS segment,
             ${safeNumeric('a.amzprice')} AS price,
             queued.new_price AS queued_price,
             ${safeNumeric('sk.rrp')} AS rrp,
             ${safeNumeric('sk.cost')} AS cost,
             ${safeNumeric('sk.cost')} + ${safeNumeric('a.fbafee')} AS floor,
             ${safeNumeric('a.fbafee')} AS fbafee, sk.tax AS tax,
             GREATEST(COALESCE(a.amzsold,0) - COALESCE(a.amzreturn,0), 0) AS units_30d,
             COALESCE(a.amzsold7,0) AS units_7d,
             ${safeNumeric('m.amzprofit')} AS unit_profit,
             COALESCE(a.amzlive,0) AS fba_live,
             COALESCE(a.amztotal,0) AS fba_total,
             m.next_amz_price_review::text AS next_review,
             ${sellSpeedSelectSql()}
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN skumap m ON m.code = a.code
      LEFT JOIN title t ON t.groupid = a.groupid
      LEFT JOIN queued ON queued.code = a.code
      ${sellSpeedJoinSql('a.code')}
      WHERE COALESCE(a.amzsold,0) - COALESCE(a.amzreturn,0) > 0
      ORDER BY ss_priced_to_sold ASC NULLS LAST, ss_shipped_to_sold ASC NULLS LAST, units_30d DESC, a.code
    `);

    const rows = result.rows.map((r) => ({
      code: r.code,
      groupid: r.groupid,
      size: r.size,
      title: r.title || null,
      brand: r.brand || null,
      segment: r.segment || null,   // for the upload basket item, as the other Amazon pricing screens
      price: num(r.price),
      queued_price: num(r.queued_price),
      rrp: num(r.rrp),
      floor: r.floor === null ? null : Math.round(Number(r.floor) * 100) / 100,
      warm_price: priceForProfit({ cost: r.cost, fbafee: r.fbafee, tax: r.tax }, WARM_PRICE_PROFIT),
      units_30d: Number(r.units_30d) || 0,
      units_7d: Number(r.units_7d) || 0,
      unit_profit: num(r.unit_profit),
      fba_live: Number(r.fba_live) || 0,
      fba_total: Number(r.fba_total) || 0,
      next_review: r.next_review || null,
      ...sellSpeedFields(r),
    }));

    return res.json({ return_code: 'SUCCESS', count: rows.length, warm_min_unit_profit: WARM_MIN_UNIT_PROFIT, rows });
  } catch (err) {
    logger.error('[amz-fast-sellers] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Fast sellers' });
  }
});

module.exports = router;
