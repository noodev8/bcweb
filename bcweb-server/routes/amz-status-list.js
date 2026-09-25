/*
=======================================================================================================================================
API Route: amz_status_list
=======================================================================================================================================
Method: GET
Purpose: Repricing — the AMAZON list behind one PORTFOLIO STATUS (WINNERS | STEADY | NEW | HARVEST | LOSERS; skusummary.portfolio_status,
         set by the Winners screen's "Update now"). The Amazon twin of routes/pricing-status-list.js, at SKU grain because Amazon prices
         per size: every amzfeed SKU whose STYLE carries the status (the tag is per style; each of its sizes inherits it).

         ONE LIST, NOT SPLIT, OUT OF STOCK INCLUDED — both owner calls of 2026-09-24, argued in pricing-status-list.js: no Selling /
         Stuck bars (a SKU between them would vanish), and a SKU with 0 FBA is still listed so its price can be set ahead of stock
         arriving rather than sit at an old clearance price. `out_of_stock` counts the rows with no FBA stock.

         Same row shape as amz-winners / amz-losers, so /amz/[segment] renders it with the same table, drill, bulk bar and upload
         basket. Apply is unchanged: it logs to amz_price_log and queues the Seller Central upload — amzfeed stays READ ONLY.

         AMAZON'S STYLES ONLY (owner, 2026-09-25): SKUs of styles whose lead channel (skusummary.portfolio_channel, stamped at Update)
         is AMZ or BOTH — a Shopify-led winner earns ~nothing here, so it is on the Shopify list instead. Same predicate as the
         overview (utils/portfolioStatus.js → channelFilterSql).

         Order: Amazon units in 30 days descending, then FBA stock descending, then code. Parked SKUs (skumap.next_amz_price_review in
         the future) are dropped unless ?parked=include — the Due switch.

Requires auth.
=======================================================================================================================================
Request: GET /amz-status-list?status=WINNERS[&parked=include][&limit=N]
  status   required — one of the five (case-insensitive). Anything else -> MISSING_FIELDS.
  limit    safety cap only (utils/listLimit.js, default 100 / max 500). The web client asks for 500: STEADY alone is ~300 SKUs.
  bar      optional, WINNERS only — a Winners-screen dial mark (1500 / 2500 / 5000 / 10000): only the SKUs of winners whose 12m
           revenue AS STAMPED AT THE LAST UPDATE is over it — the Shopify list's rule (pricing-status-list.js), same reason.

Success Response:
{
  "return_code": "SUCCESS",
  "status": "WINNERS",
  "total": 131, "truncated": false,
  "out_of_stock": 54,              // rows with 0 FBA stock (listed)
  "rows": [ { "rank": 1, "code": "…-38", "amz_sku": "…", "groupid": "…", "size": "38", "title": "…", "price": 42.5, "fba": 12,
              "units": 6, "u7": 2, "last_sold": "2026-09-20", "next_review": null, "parked": false }, ... ]
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
const { parseListLimit } = require('../utils/listLimit');
const { parseGroup } = require('../utils/pricingGroup');
const { WINNER_BAR_LADDER } = require('../utils/portfolio');
const { channelFilterSql } = require('../utils/portfolioStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    // Only ?status= is accepted here. `sk` is this route's skusummary alias, as in the other Amazon list routes.
    const group = typeof req.query.status === 'string'
      ? parseGroup({ status: req.query.status }, { alias: 'sk', channel: 'AMZ' })
      : null;
    if (!group) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'status must be one of WINNERS, STEADY, NEW, HARVEST, LOSERS' });
    }
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';

    // The dial's bar — WINNERS only, and only a mark the dial offers (see pricing-status-list.js).
    let bar = null;
    if (req.query.bar !== undefined && req.query.bar !== '') {
      bar = Number(req.query.bar);
      if (group.name !== 'WINNERS' || !WINNER_BAR_LADDER.includes(bar)) {
        return res.json({ return_code: 'MISSING_FIELDS', message: 'bar is only valid for WINNERS, and must be one of ' + WINNER_BAR_LADDER.join(', ') });
      }
    }

    // $1 status, $2 limit, $3 includeParked, $4 bar. total / oos_rows are window functions, so pre-cap.
    const result = await query(`
      WITH u AS (       -- Amazon units: 30 days and 7 days, one pass (the two columns the shared table shows)
        SELECT code,
               SUM(qty) AS u30,
               COALESCE(SUM(qty) FILTER (WHERE solddate >= CURRENT_DATE - 7), 0) AS u7
        FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30
        GROUP BY code
      ),
      ls AS (           -- last sold (ignores returns), same as the other Amazon lists
        SELECT code, MAX(solddate) AS last_sold FROM sales
        WHERE channel='AMZ' AND qty>0
        GROUP BY code
      )
      SELECT a.code, a.groupid, a.sku AS amz_sku, SUBSTRING(a.code FROM '[^-]*$') AS size,   -- size = suffix after the last '-'
             t.shopifytitle AS title,
             NULLIF(TRIM(sk.brand), '') AS brand,   -- the list's Brand column (owner, 2026-09-25)
             ${safeNumeric('a.amzprice')} AS price,
             ${safeNumeric('sk.rrp')} AS rrp,              -- for the bulk bar's "Reset to RRP" (skusummary, same as amz-apply's bound)
             COALESCE(a.amzlive,0) AS fba,
             COALESCE(u.u30,0)     AS units,
             COALESCE(u.u7,0)      AS u7,
             to_char(ls.last_sold,'YYYY-MM-DD') AS last_sold,
             m.next_amz_price_review::text AS next_review,                -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(m.next_amz_price_review > CURRENT_DATE, false) AS parked,
             COUNT(*) OVER () AS total_rows,
             COUNT(*) FILTER (WHERE COALESCE(a.amzlive,0) = 0) OVER () AS oos_rows
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN skumap m      ON m.code    = a.code                      -- per-SKU review date (next_amz_price_review); 1:1
      LEFT JOIN u        ON u.code    = a.code
      LEFT JOIN ls       ON ls.code   = a.code
      LEFT JOIN title t  ON t.groupid = a.groupid
      WHERE ${group.column} = $1
        AND ($4::numeric IS NULL OR sk.portfolio_revenue_12m > $4::numeric)   -- the dial's bar, on the STAMPED revenue
        AND ${channelFilterSql('sk', 'AMZ')}                                   -- Amazon-led or BOTH (see header)
        AND ($3::boolean OR m.next_amz_price_review IS NULL OR m.next_amz_price_review <= CURRENT_DATE)
      ORDER BY COALESCE(u.u30,0) DESC, COALESCE(a.amzlive,0) DESC, a.code
      LIMIT $2::int
    `, [group.name, limit, includeParked, bar]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      code: r.code,
      amz_sku: r.amz_sku,
      groupid: r.groupid,
      size: r.size,
      title: r.title || null,
      brand: r.brand || null,
      price: num(r.price),
      rrp: num(r.rrp),
      fba: Number(r.fba),
      units: Number(r.units),
      u7: Number(r.u7),
      last_sold: r.last_sold || null,
      next_review: r.next_review || null,
      parked: r.parked === true,
    }));

    const total = result.rows.length > 0 ? Number(result.rows[0].total_rows) : 0;
    const outOfStock = result.rows.length > 0 ? Number(result.rows[0].oos_rows) : 0;
    return res.json({ return_code: 'SUCCESS', status: group.name, bar, total, truncated: rows.length < total, out_of_stock: outOfStock, rows });
  } catch (err) {
    logger.error('[amz-status-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Amazon status list' });
  }
});

module.exports = router;
