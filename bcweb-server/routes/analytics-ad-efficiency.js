/*
=======================================================================================================================================
API Route: analytics_ad_efficiency
=======================================================================================================================================
Method: GET
Purpose: Reports — is Google advertising still paying for itself? One row per month: units, Shopify net profit, Google ad spend, what
         is left, and the two figures that make the answer comparable across a growing or shrinking month.

         Requires auth. Read-only.

WHY THIS REPORT EXISTS
The 2026 season made money on every measure the business normally watches — units up, revenue up, profit up — while the share of that
profit surviving ad spend fell every single month:

    Mar 57%   Apr 54%   May 40%   Jun 21%   Jul 13%   Aug 8%

Volume grew and looked like success right until the margin was gone. The owner reports the same shape preceded a loss-making year
two years earlier. Nothing on any existing screen would have shown it: the Sales report says profit is up (true), and the Google Ads
screen works a 30-day window, which is too short to see a slide this slow. A monthly series is the only shape this fault is visible in.

THE TWO SCALE-FREE FIGURES ARE THE POINT
Absolute spend is the wrong yardstick and misleads in BOTH directions — it screams at you for spending more in a growing month when
spending more is correct, and it reassures you in a quiet month while efficiency collapses. `pctKept` and `keptPerUnit` are
independent of scale: £4 a pair on 200 pairs and £4 a pair on 800 pairs are both healthy; 86p on 420 is not, whatever last year did.

THRESHOLDS ARE THE CLIENT'S, NOT THIS ROUTE'S. It returns the arithmetic and no verdict. What counts as an alarming month is a
business judgement the owner sets and changes, and burying it in SQL would make it invisible and hard to move.

SALES ARE SHOPIFY ONLY, PROFIT IS NET — matching routes/google-ads-styles.js exactly, so the two screens cannot disagree. Google
Shopping points at the Shopify store, so that is the revenue these ads can plausibly have caused; `sales.profit` is after payment
fees, packing, postage and the returns haircut (utils/shopifyProfit.js), which is what makes "what is left" a real figure and not a
gross margin with ad spend subtracted from it.

THE CURRENT MONTH IS PARTIAL AND IS FLAGGED, NOT HIDDEN. Five days into September the ratios are violent (63% kept on 26 units) and
would read as a recovery. `partial` lets the client grey it; dropping it instead would leave the operator wondering where this month
went.

SPEND COMES FROM google_product_daily, not google_campaign_daily — it reaches back to 1 Aug 2025 where the campaign table starts in
April 2026, and this report is worthless without a full year behind it. The two agree where they overlap (verified 2026-09-05:
identical 30-day totals to the penny).
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  months   optional, default 13, max 36 — how many months back, ending with the current (partial) one

Success Response:
{
  "return_code": "SUCCESS",
  "months": [
    {
      "month": "2026-08",             // sortable; the client formats it
      "label": "Aug 26",
      "units": 420,
      "profit": 4562.10,              // Shopify net profit
      "spend": 4201.55,               // Google ad spend
      "kept": 360.55,                 // profit - spend
      "pctKept": 8,                   // kept as a % of profit; null when there was no profit to take a share of
      "adCostPerUnit": 10.00,         // null when nothing sold
      "keptPerUnit": 0.86,            // null when nothing sold
      "partial": false                // true only for the month in progress
    }
  ]
}
  - A month with ad data but no sales still returns a row: spend with nothing to show for it is the most important row on the report.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"INVALID_MONTHS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

const DEFAULT_MONTHS = 13;   // a full year plus the current partial one, so every month has its own counterpart above it
const MAX_MONTHS = 36;

const round2 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

router.get('/', async (req, res) => {
  try {
    const months = req.query.months === undefined ? DEFAULT_MONTHS : Number(req.query.months);
    if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
      return res.json({ return_code: 'INVALID_MONTHS', message: `months must be a whole number between 1 and ${MAX_MONTHS}` });
    }

    // generate_series drives the month list rather than either data table, so a month with spend but no sales — or sales but no
    // imported ad data — still produces a row. A gap in the series would read as "nothing happened", which is the opposite of what
    // an unimported month means.
    //
    // Dates are cast to text in SQL and never handed back as a pg DATE (CLAUDE.md): a DATE arriving in Node becomes local midnight
    // and shifts a day under BST, which at a month boundary moves a whole row.
    const result = await query(`
      WITH span AS (
        SELECT generate_series(
                 date_trunc('month', CURRENT_DATE) - ($1::int - 1) * interval '1 month',
                 date_trunc('month', CURRENT_DATE),
                 interval '1 month'
               )::date AS m
      ),
      ads AS (
        SELECT date_trunc('month', snapshot_date)::date AS m, SUM(cost) AS spend
        FROM google_product_daily
        GROUP BY 1
      ),
      shp AS (
        SELECT date_trunc('month', solddate)::date AS m,
               -- revenue is not currently SELECTed by the outer query, but is kept correct so wiring it up later cannot
               -- reintroduce the bare-SUM fault: soldprice is per-unit and positive on returns. See analytics-ad-payback.
               SUM(qty) AS units, SUM(soldprice * qty) AS revenue, SUM(profit) AS profit
        FROM sales
        WHERE channel = 'SHP'
        GROUP BY 1
      )
      SELECT to_char(span.m, 'YYYY-MM')  AS month,
             to_char(span.m, 'Mon YY')   AS label,
             COALESCE(shp.units, 0)      AS units,
             COALESCE(shp.profit, 0)     AS profit,
             COALESCE(ads.spend, 0)      AS spend,
             (span.m = date_trunc('month', CURRENT_DATE)::date) AS partial
      FROM span
      LEFT JOIN ads ON ads.m = span.m
      LEFT JOIN shp ON shp.m = span.m
      ORDER BY span.m
    `, [months]);

    const rows = result.rows.map((r) => {
      const units = Number(r.units);
      const profit = round2(r.profit) ?? 0;
      const spend = round2(r.spend) ?? 0;
      const kept = round2(profit - spend);
      return {
        month: r.month,
        label: r.label,
        units,
        profit,
        spend,
        kept,
        // Null rather than 0 when there is no profit to take a share OF — a loss-making month has no meaningful "percentage kept",
        // and printing one would invent a measurement. `kept` is still the honest figure there.
        pctKept: profit > 0 ? Math.round((kept / profit) * 100) : null,
        adCostPerUnit: units > 0 ? round2(spend / units) : null,
        keptPerUnit: units > 0 ? round2(kept / units) : null,
        partial: r.partial,
      };
    });

    return res.json({ return_code: 'SUCCESS', months: rows });
  } catch (err) {
    logger.error('[analytics-ad-efficiency] failed:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the ad efficiency report' });
  }
});

module.exports = router;
