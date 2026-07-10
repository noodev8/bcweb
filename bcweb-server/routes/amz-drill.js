/*
=======================================================================================================================================
API Route: amz_drill
=======================================================================================================================================
Method: GET
Purpose: Stage 2 — the drill-down / decision screen for ONE Amazon SKU (one size), the mirror of Shopify's pricing-drill. Returns the
         header stats plus the two evidence datasets a price decision needs (docs/amz-pricing-spec.md §2/§5). Everything read-only:
           - header : current Amazon price, cost, FBA fee, RRP, computed floor (cost+FBA) and net margin, FBA live/inbound stock, the
                      Amazon SKU (amz_sku — needed for the upload file), title. This is the frame for the decision.
           - weeks  : 6-week velocity, zero-filled (units, avg sold price, profit per week). Shows the TREND — a halving week over week is
                      the act-now signal; a gap week reads as 0, not a hidden hole. (Returns are deliberately NOT surfaced — noise for
                      pricing intent, owner decision.)
           - bands  : units sold at each distinct price over 60 days (the resistance guardrail). Where units dry up above a price is the
                      discovered ceiling; useful before creeping past a level that just failed.

         The price-change history and the raw sales list are SEPARATE lazily-loaded reports (amz-history / amz-sales), fetched only when the
         operator opens those sections — keeping the initial drill fast (mirrors the Shopify pricing-history / pricing-sales split).

Never writes; amzfeed is untouched (FBA-only, refreshed nightly from Amazon). Sales are channel='AMZ' only (qty<0 = a return). Margin here
is the NET Amazon contribution (price - cost - FBA fee), since the FBA fee is a real per-unit cost on this channel.

Schema landmines respected: amzprice/cost/rrp/fbafee are junk-prone VARCHARs -> safeNumeric (NULL on non-numeric). amzlive/amztotal are
real integers; inbound = amztotal - amzlive. Size = RIGHT(code,2). Requires auth.
=======================================================================================================================================
Request Query Params:
  code (string, required)  - our SKU (amzfeed.code / sales.code), e.g. 'FLE030-IVES-WHITE-38'

Success Response:
{
  "return_code": "SUCCESS",
  "header": {
    "code": "FLE030-IVES-WHITE-38", "amz_sku": "AD-0XF8D-48L", "groupid": "FLE030-IVES-WHITE", "segment": "IVES-WHITE",
    "size": "38", "title": "...",
    "price": 37.99, "cost": 15.99, "fbafee": 3.06, "rrp": 45.00,
    "floor": 19.05,                            // cost + FBA fee (breakeven)
    "margin": 18.94, "margin_pct": 50,         // net = price - cost - FBA fee, and as % of price (null if any part unknown)
    "fba_live": 96, "fba_inbound": 0
  },
  "weeks":   [ { "week_start": "2026-06-01", "units": 9, "avg_price": 39.82, "profit": 154.74 }, ... ],  // oldest -> newest
  "bands":   [ { "price": 38.99, "units": 49, "first": "2026-05-16", "last": "2026-05-29" }, ... ]                     // ascending price
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code is required' });
    }

    // ---- Header: economics for this SKU. amzfeed is the Amazon/FBA truth (price, fee, stock); cost/rrp live on skusummary. ----
    const headerResult = await query(`
      SELECT a.code, a.groupid, sk.segment, RIGHT(a.code,2) AS size, a.sku AS amz_sku,
             t.shopifytitle AS title,
             ${safeNumeric('a.amzprice')} AS price,
             ${safeNumeric('sk.cost')}    AS cost,
             ${safeNumeric('sk.rrp')}     AS rrp,
             ${safeNumeric('a.fbafee')}   AS fbafee,
             COALESCE(a.amzlive,0)  AS fba_live,
             GREATEST(COALESCE(a.amztotal,0) - COALESCE(a.amzlive,0), 0) AS fba_inbound
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      LEFT JOIN title t ON t.groupid = a.groupid
      WHERE a.code = $1
    `, [code]);

    if (headerResult.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'SKU not found in amzfeed' });
    }

    const h = headerResult.rows[0];
    const price = num(h.price);
    const cost = num(h.cost);
    const fbafee = num(h.fbafee);
    const rrp = num(h.rrp);
    // Floor = cost + FBA fee (breakeven). Net margin = price - cost - FBA fee (the real per-unit contribution on this channel).
    const floor = cost !== null && fbafee !== null ? Math.round((cost + fbafee) * 100) / 100 : null;
    const margin = price !== null && cost !== null && fbafee !== null ? Math.round((price - cost - fbafee) * 100) / 100 : null;
    const marginPct = margin !== null && price ? Math.round((margin / price) * 100) : null;

    const header = {
      code: h.code,
      amz_sku: h.amz_sku,
      groupid: h.groupid,
      segment: h.segment || null,
      size: h.size,
      title: h.title || null,
      price,
      cost,
      fbafee,
      rrp,
      floor,
      margin,
      margin_pct: marginPct,
      fba_live: Number(h.fba_live),
      fba_inbound: Number(h.fba_inbound),
    };

    // ---- Evidence: 6-week zero-filled velocity + 60-day sold-price bands. Independent reads, run in parallel. ----
    const [weeksR, bandsR] = await Promise.all([
      query(`
        WITH wk AS (
          SELECT generate_series(date_trunc('week', CURRENT_DATE) - INTERVAL '5 weeks',
                                 date_trunc('week', CURRENT_DATE), INTERVAL '1 week')::date AS week_start
        ),
        s AS (
          SELECT date_trunc('week', solddate)::date AS week_start,
                 SUM(CASE WHEN qty>0 THEN qty ELSE 0 END)::int AS units,
                 ROUND(AVG(CASE WHEN qty>0 THEN soldprice END)::numeric, 2) AS avg_price,
                 ROUND(SUM(profit)::numeric, 2) AS profit
          FROM sales
          WHERE channel='AMZ' AND code=$1 AND solddate >= date_trunc('week', CURRENT_DATE) - INTERVAL '5 weeks'
          GROUP BY 1
        )
        SELECT to_char(wk.week_start, 'YYYY-MM-DD') AS week_start,
               COALESCE(s.units,0) AS units, s.avg_price, COALESCE(s.profit,0) AS profit
        FROM wk LEFT JOIN s USING (week_start)
        ORDER BY wk.week_start
      `, [code]),

      query(`
        SELECT ${safeNumeric('soldprice')} AS price, SUM(qty)::int AS units,
               to_char(MIN(solddate), 'YYYY-MM-DD') AS first, to_char(MAX(solddate), 'YYYY-MM-DD') AS last
        FROM sales
        WHERE channel='AMZ' AND code=$1 AND qty>0 AND solddate >= CURRENT_DATE - 60
        GROUP BY ${safeNumeric('soldprice')} ORDER BY 1
      `, [code]),
    ]);

    const weeks = weeksR.rows.map((r) => ({
      week_start: r.week_start, units: Number(r.units),
      avg_price: num(r.avg_price), profit: Number(r.profit),
    }));
    const bands = bandsR.rows.map((r) => ({
      price: num(r.price), units: Number(r.units), first: r.first, last: r.last,
    }));

    return res.json({ return_code: 'SUCCESS', header, weeks, bands });
  } catch (err) {
    logger.error('[amz-drill] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load SKU detail' });
  }
});

module.exports = router;
