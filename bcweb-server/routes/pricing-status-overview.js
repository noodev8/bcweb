/*
=======================================================================================================================================
API Route: pricing_status_overview
=======================================================================================================================================
Method: GET
Purpose: Repricing — the STATUS tab (the first and default tab since 2026-09-24, replacing Top earners — owner: "This pricing group
         should replace the old top earners"). Per portfolio status (the stored skusummary.portfolio_status tag) and per CHANNEL, how
         much pricing work is behind it, so each tile says so before you open the list.

         The counts use exactly the list routes' rules (pricing-status-list.js for Shopify styles, amz-status-list.js for Amazon SKUs),
         so a tile's `due` IS the length of the list it opens with the Due switch on:
           total          everything with the status — styles on Shopify (= the Winners screen's card), amzfeed SKUs on Amazon
           due            of those, not parked (review date absent or today/past) — OUT OF STOCK INCLUDED (owner, 2026-09-24: price
                          ahead of stock arriving, not at an old clearance price)
           parked         review date in the future — what switching Due off adds
           out_of_stock   of `total`, how many have no stock (Shopify: #FREE localstock; Amazon: FBA amzlive). Listed, just flagged.
           styles         how many STYLES those rows are — equals `total` on Shopify; on Amazon the rows are sizes (SKUs), and the
                          style count is what matches the Winners screen's chip (owner, 2026-09-25: "23 styles ... showing 78").

         EACH CHANNEL COUNTS ONLY ITS OWN STYLES (2026-09-25): lead channel (skusummary.portfolio_channel) SHP|BOTH for Shopify,
         AMZ|BOTH for Amazon — the same predicate the lists use (utils/portfolioStatus.js → channelFilterSql).

         Always five statuses in rule order, zeros included, so the screen draws a stable set of tiles. Read-only.

Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "updated_at": "2026-09-24 22:44",   // London time the tags were last set; null = never
  "statuses": [
    { "status": "WINNERS",
      "shopify": { "total": 50,  "due": 27, "parked": 23, "out_of_stock": 5,  "styles": 50 },
      "amazon":  { "total": 131, "due": 78, "parked": 53, "out_of_stock": 54, "styles": 23 } }, ...
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
const { STATUSES, channelFilterSql } = require('../utils/portfolioStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

const ZERO = { total: 0, due: 0, parked: 0, out_of_stock: 0, styles: 0 };

router.get('/', async (req, res) => {
  try {
    // Two independent reads, one per channel, run together.
    const [shp, amz] = await Promise.all([
      query(`
        WITH stk AS (
          SELECT groupid FROM localstock
          WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
          GROUP BY groupid
        )
        SELECT ss.portfolio_status AS status,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE ss.next_shopify_price_review IS NULL
                                   OR ss.next_shopify_price_review <= CURRENT_DATE)::int AS due,
               COUNT(*) FILTER (WHERE ss.next_shopify_price_review > CURRENT_DATE)::int AS parked,
               COUNT(*) FILTER (WHERE st.groupid IS NULL)::int AS out_of_stock,
               COUNT(*)::int AS styles,                                -- a Shopify row IS a style
               to_char(MAX(ss.portfolio_status_at) AT TIME ZONE 'Europe/London', 'YYYY-MM-DD HH24:MI') AS last_at
        FROM skusummary ss
        LEFT JOIN stk st ON st.groupid = ss.groupid
        WHERE ss.portfolio_status IS NOT NULL
          AND ${channelFilterSql('ss', 'SHP')}
        GROUP BY ss.portfolio_status
      `),
      query(`
        SELECT sk.portfolio_status AS status,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE m.next_amz_price_review IS NULL
                                   OR m.next_amz_price_review <= CURRENT_DATE)::int AS due,
               COUNT(*) FILTER (WHERE m.next_amz_price_review > CURRENT_DATE)::int AS parked,
               COUNT(*) FILTER (WHERE COALESCE(a.amzlive,0) = 0)::int AS out_of_stock,
               COUNT(DISTINCT a.groupid)::int AS styles                -- rows are sizes; this is how many styles they belong to
        FROM amzfeed a
        JOIN skusummary sk ON sk.groupid = a.groupid
        JOIN skumap m      ON m.code    = a.code
        WHERE sk.portfolio_status IS NOT NULL
          AND ${channelFilterSql('sk', 'AMZ')}
        GROUP BY sk.portfolio_status
      `),
    ]);

    const pick = (rows, status) => {
      const x = rows.find((r) => r.status === status);
      return x ? { total: x.total, due: x.due, parked: x.parked, out_of_stock: x.out_of_stock, styles: x.styles } : { ...ZERO };
    };
    const statuses = STATUSES.map((status) => ({ status, shopify: pick(shp.rows, status), amazon: pick(amz.rows, status) }));
    const updatedAt = shp.rows.map((x) => x.last_at).filter(Boolean).sort().pop() || null;

    return res.json({ return_code: 'SUCCESS', updated_at: updatedAt, statuses });
  } catch (err) {
    logger.error('[pricing-status-overview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load status overview' });
  }
});

module.exports = router;
