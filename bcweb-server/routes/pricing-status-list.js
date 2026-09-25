/*
=======================================================================================================================================
API Route: pricing_status_list
=======================================================================================================================================
Method: GET
Purpose: Repricing — the Shopify list behind one PORTFOLIO STATUS (WINNERS | STEADY | NEW | HARVEST | LOSERS; the stored tag
         skusummary.portfolio_status, set by the Winners screen's "Update now" — utils/portfolioStatus.js). The Amazon twin is
         routes/amz-status-list.js (SKU grain).

         ONE LIST, NOT SPLIT (owner, 2026-09-24: "I don't think there's much point in splitting"). The segment / campaign lists are two
         lists with their own entry bars (pricing-triage: sold >= 2 at >= £2/unit; pricing-losers: sold nothing in 30d), and a style
         between the two bars is on NEITHER — so "Both" is not the whole group. A status list must be the whole status, so this returns
         EVERY style carrying it, whatever it sold, in the same row shape as those two routes so the list page renders it with the same
         table, drill and bulk bar.

         OUT OF STOCK IS INCLUDED (owner, 2026-09-24: "I do want to reprice out of stock when adjusting prices in preparation for stock
         arrival... Don't want to leave them at old clearance price"). stock = 0 for those; the other pricing lists still require stock.
         So the list's length equals the Winners screen's card. `out_of_stock` counts how many of the rows have none, for the screen.

         SHOPIFY'S STYLES ONLY (owner, 2026-09-25): styles whose lead channel (skusummary.portfolio_channel, stamped at Update) is SHP
         or BOTH. An Amazon-led winner earns ~nothing here — 23 of the 73 winners on the day — so it is on the Amazon list instead.
         The predicate is utils/portfolioStatus.js → channelFilterSql, shared with the overview's counts.

         Order: units sold in 30 days (Shopify) descending, then stock descending — the sellers first, then the biggest piles, then the
         empty ones. Parked styles (review date in the future) are dropped unless ?parked=include, where they come back flagged — the
         Due switch.

Requires auth.
=======================================================================================================================================
Request: GET /pricing-status-list?status=WINNERS[&parked=include][&limit=N]
  status   required — one of the five (case-insensitive). Anything else -> MISSING_FIELDS.
  limit    safety cap only (utils/listLimit.js, default 100 / max 500). The web client asks for 500: STEADY alone is ~175 styles.
  bar      optional, WINNERS only — one of the Winners screen's dial marks (WINNER_BAR_LADDER: 1500 / 2500 / 5000 / 10000). Keeps the
           winners whose 12m revenue AS STAMPED AT THE LAST UPDATE (skusummary.portfolio_revenue_12m) is over it, so tapping the card
           at £2,500 opens exactly the styles behind that card's number (owner, 2026-09-25). Stamped, not live, for the same reason the
           dial reads it: a live figure would drift from the card after the next sale. Anything else -> MISSING_FIELDS.

Success Response:
{
  "return_code": "SUCCESS",
  "status": "WINNERS",
  "bar": null,                 // the dial mark applied, or null
  "total": 73,                // styles with the status (pre-cap; parked included only with ?parked=include)
  "truncated": false,
  "out_of_stock": 15,          // how many of those have no sellable stock (listed, stock 0)
  "rows": [ { "rank": 1, "groupid": "…", "title": "…", "price": 49.95, "stock": 31, "u30": 12,
              "match_amazon": false, "next_review": null, "parked": false }, ... ]
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

router.get('/', async (req, res) => {
  try {
    // Only ?status= is accepted here — parseGroup validates it against the five statuses and builds the column.
    const group = typeof req.query.status === 'string' ? parseGroup({ status: req.query.status }) : null;
    if (!group) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'status must be one of WINNERS, STEADY, NEW, HARVEST, LOSERS' });
    }
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';

    // The dial's bar — WINNERS only, and only a mark the dial actually offers, so it can never become a free-form revenue filter.
    let bar = null;
    if (req.query.bar !== undefined && req.query.bar !== '') {
      bar = Number(req.query.bar);
      if (group.name !== 'WINNERS' || !WINNER_BAR_LADDER.includes(bar)) {
        return res.json({ return_code: 'MISSING_FIELDS', message: 'bar is only valid for WINNERS, and must be one of ' + WINNER_BAR_LADDER.join(', ') });
      }
    }

    // $1 status, $2 limit, $3 includeParked. Window functions run BEFORE the LIMIT, so total and out_of_stock are pre-cap figures.
    const result = await query(`
      WITH stk AS (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY groupid
      ),
      win AS (   -- Shopify units in the last 30 days — the same measure and filters the Selling/Stuck lists use
        SELECT groupid, SUM(qty) AS u30 FROM sales
        WHERE channel='SHP' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30
        GROUP BY groupid
      )
      SELECT ss.groupid,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.rrp')} AS rrp,              -- for the bulk bar's "Reset to RRP"
             COALESCE(st.stock, 0) AS stock,
             COALESCE(w.u30, 0) AS u30,
             ss.match_amazon_price AS match_amazon,
             t.shopifytitle,
             NULLIF(TRIM(ss.brand), '') AS brand,                                -- the list's Brand column (owner, 2026-09-25)
             ss.next_shopify_price_review::text AS next_review,                 -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(ss.next_shopify_price_review > CURRENT_DATE, false) AS parked,
             COUNT(*) OVER () AS total_rows,
             COUNT(*) FILTER (WHERE st.stock IS NULL) OVER () AS oos_rows
      FROM skusummary ss
      LEFT JOIN stk st  ON st.groupid = ss.groupid        -- LEFT: out-of-stock styles are repriced too (see header)
      LEFT JOIN win w   ON w.groupid  = ss.groupid
      LEFT JOIN title t ON t.groupid  = ss.groupid
      WHERE ${group.column} = $1
        AND ($4::numeric IS NULL OR ss.portfolio_revenue_12m > $4::numeric)   -- the dial's bar, on the STAMPED revenue (see header)
        AND ${channelFilterSql('ss', 'SHP')}                                   -- Shopify-led or BOTH (see header)
        AND ($3::boolean OR ss.next_shopify_price_review IS NULL OR ss.next_shopify_price_review <= CURRENT_DATE)
      ORDER BY COALESCE(w.u30, 0) DESC, COALESCE(st.stock, 0) DESC, ss.groupid
      LIMIT $2::int
    `, [group.name, limit, includeParked, bar]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      groupid: r.groupid,
      title: r.shopifytitle || null,
      brand: r.brand || null,
      price: r.price === null || r.price === undefined ? null : Number(r.price),   // null when the legacy VARCHAR held junk/blank
      rrp: r.rrp === null || r.rrp === undefined ? null : Number(r.rrp),
      stock: Number(r.stock),
      u30: Number(r.u30),
      match_amazon: r.match_amazon === true,
      next_review: r.next_review || null,
      parked: r.parked === true,
    }));

    const total = result.rows.length > 0 ? Number(result.rows[0].total_rows) : 0;
    const outOfStock = result.rows.length > 0 ? Number(result.rows[0].oos_rows) : 0;
    return res.json({
      return_code: 'SUCCESS', status: group.name, bar, total, truncated: rows.length < total, out_of_stock: outOfStock, rows,
    });
  } catch (err) {
    logger.error('[pricing-status-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load status list' });
  }
});

module.exports = router;
