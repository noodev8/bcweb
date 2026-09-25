/*
=======================================================================================================================================
API Route: product_seasons   (Back Office → Seasons)
=======================================================================================================================================
Method: GET
Purpose: Every style's SEASON (skusummary.season: Summer | Winter | Any) beside a picture of its year — units sold in each calendar
         month — so the owner can see which styles really sell all year and re-season them in bulk (POST /product-season-bulk).

         WHY IT MATTERS: the portfolio status (utils/portfolioStatus.js) only lets a style be a WINNER while it is IN SEASON — an
         out-of-season earner is HARVEST. So a summer style that keeps selling through the winter needs season 'Any', or it drops out
         of WINNERS for half the year. "It's just a slow period, not a switch off" (owner, 2026-09-25). This screen is where that
         call is made — a quarterly-ish Back Office review, deliberately separate from repricing.

         LOGIC SUGGESTS, THE OWNER DECIDES. `suggested` is a hint, never an action — nothing here re-seasons automatically:
           Summer / Winter  suggested for 'Any' when it sold in at least SUGGEST_SHARE of its OFF-SEASON months. Counted against the
                            months the off-season HAS (7 winter months for a Summer style, 5 summer months for a Winter one), NOT a
                            flat "sold in N of 12" — a flat count is easier for a Winter style to pass than a Summer one, because
                            its own season is the longer one (owner agreed, 2026-09-25).
           Any              suggested back to one season when every month it sold in falls in ONE season (and it sold in at least
                            ANY_MIN_MONTHS months, so one stray sale doesn't flag it). `suggested_season` names which.

         THE WINDOW is the last 12 WHOLE calendar months (this month excluded), London time — so each month of the year appears
         exactly once. A rolling "last 365 days" would count part of this month AND the same month last year into one bucket.
         Seasons match utils/portfolioStatus.js: Summer = April–August, Winter = September–March.

         Units only (qty > 0 — returns excluded, same as the status rules). Revenue is over the same window, for sorting and for
         spotting the earners; `status` is the stored portfolio tag, shown for context only.

         Rows with a season other than Summer/Winter/Any (blank, legacy junk) are left out — there is nothing to re-season FROM, and
         Add/Modify is the place to fix a blank.

         Requires auth. Read-only.
=======================================================================================================================================
Request: none

Success Response:
{
  "return_code": "SUCCESS",
  "window": { "from": "2025-09", "to": "2026-08" },     // first and last month of the window, 'YYYY-MM'
  "last_change": { "at": "2026-09-25 14:02", "who": "Andreas" } | null,   // last bulk season change (bclog, section 'Seasons')
  "rows": [
    {
      "groupid": "0034701-MILANO", "title": "Birkenstock Milano …", "brand": "Birkenstock",
      "season": "Summer",                        // normalised: Summer | Winter | Any
      "status": "HARVEST" | null,                // stored portfolio tag
      "months": [2,1,0,3,…],                     // 12 numbers, JANUARY first — units sold in that calendar month in the window
      "months_sold": 11,                         // months with a sale
      "off_sold": 6, "off_total": 7,             // off-season months with a sale / off-season months there are (Any: null, null)
      "revenue_12m": 8410.00, "units_12m": 109,
      "rev_summer": 7575.00, "rev_winter": 845.00,  // the same revenue split by the month it SOLD in
      "in_stock": true,                              // any sellable size now (localstock #FREE)
      "added_12m": false,                            // record created in the last 12 months
      "suggested": true, "suggested_season": "Any" | "Summer" | "Winter" | null
    }, …
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
const { SUMMER_FIRST_MONTH, SUMMER_LAST_MONTH } = require('../utils/portfolioStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

// A Summer/Winter style is suggested for 'Any' when it sold in at least this share of its off-season months: 4 of 7 winter months
// for a Summer style, 3 of 5 summer months for a Winter one. "Slow, not switched off" — at least every other month.
const SUGGEST_SHARE = 0.5;
// An 'Any' style is only suggested back to one season if it sold in at least this many months, all in that season.
const ANY_MIN_MONTHS = 3;

const isSummer = (m) => m >= SUMMER_FIRST_MONTH && m <= SUMMER_LAST_MONTH; // m = 1..12
const SUMMER_MONTHS = SUMMER_LAST_MONTH - SUMMER_FIRST_MONTH + 1; // 5
const WINTER_MONTHS = 12 - SUMMER_MONTHS;                          // 7

const SEASON_LABEL = { summer: 'Summer', winter: 'Winter', any: 'Any' };

router.get('/', async (req, res) => {
  try {
    // One pass over sales in the window, bucketed by calendar month. The window bounds are London months, computed in SQL — never a
    // JS "today" (the DB session is UTC and the box is London).
    const r = await query(`
      WITH win AS (
        SELECT (date_trunc('month', now() AT TIME ZONE 'Europe/London') - INTERVAL '12 months')::date AS from_date,
               date_trunc('month', now() AT TIME ZONE 'Europe/London')::date                         AS to_date
      ),
      sold AS (
        SELECT s.groupid,
               EXTRACT(MONTH FROM s.solddate)::int AS m,
               SUM(s.qty)::int                     AS units,
               SUM(s.soldprice * s.qty)            AS revenue
        FROM sales s CROSS JOIN win
        WHERE s.qty > 0
          AND s.groupid IS NOT NULL AND s.groupid <> ''
          AND s.solddate >= win.from_date AND s.solddate < win.to_date
        GROUP BY s.groupid, EXTRACT(MONTH FROM s.solddate)
      ),
      -- Styles with sellable stock now (CLAUDE.md: localstock #FREE, not deleted, qty > 0 — never skusummary's stale stock columns).
      stocked AS (
        SELECT DISTINCT m.groupid
        FROM localstock l JOIN skumap m ON m.code = l.code
        WHERE l.ordernum = '#FREE' AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0
      ),
      per_style AS (
        SELECT groupid,
               json_object_agg(m, units) AS by_month,
               SUM(units)::int           AS units_12m,
               ROUND(SUM(revenue), 2)    AS revenue_12m,
               -- split by the month it SOLD in (not the style's season) — for the season summary panel
               ROUND(COALESCE(SUM(revenue) FILTER (WHERE m BETWEEN ${Number(SUMMER_FIRST_MONTH)} AND ${Number(SUMMER_LAST_MONTH)}), 0), 2) AS rev_summer,
               ROUND(COALESCE(SUM(revenue) FILTER (WHERE m NOT BETWEEN ${Number(SUMMER_FIRST_MONTH)} AND ${Number(SUMMER_LAST_MONTH)}), 0), 2) AS rev_winter
        FROM sold
        GROUP BY groupid
      )
      SELECT ss.groupid,
             t.shopifytitle                          AS title,
             NULLIF(TRIM(ss.brand), '')              AS brand,
             LOWER(TRIM(ss.season))                  AS season,
             ss.portfolio_status                     AS status,
             p.by_month,
             COALESCE(p.units_12m, 0)                AS units_12m,
             COALESCE(p.revenue_12m, 0)              AS revenue_12m,
             COALESCE(p.rev_summer, 0)               AS rev_summer,
             COALESCE(p.rev_winter, 0)               AS rev_winter,
             (st.groupid IS NOT NULL)                AS in_stock,
             COALESCE(ss.created_at >= now() - INTERVAL '12 months', false) AS added_12m,   -- created_at is the authoritative record date
             (SELECT to_char(from_date, 'YYYY-MM') FROM win)                          AS win_from,
             (SELECT to_char(to_date - INTERVAL '1 day', 'YYYY-MM') FROM win)          AS win_to
      FROM skusummary ss
      LEFT JOIN title t     ON t.groupid = ss.groupid
      LEFT JOIN per_style p ON p.groupid = ss.groupid
      LEFT JOIN stocked st  ON st.groupid = ss.groupid
      WHERE LOWER(TRIM(ss.season)) IN ('summer', 'winter', 'any')
    `);

    // The last bulk change, so the screen can say when the review was last done. London wall-clock, as text.
    const last = await query(`
      SELECT workstation AS who,
             to_char(created_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD HH24:MI') AS at
      FROM bclog WHERE section = 'Seasons'
      ORDER BY created_at DESC LIMIT 1
    `);

    const rows = r.rows.map((x) => {
      const byMonth = x.by_month || {};
      const months = Array.from({ length: 12 }, (_, i) => Number(byMonth[i + 1]) || 0);
      const soldIn = months.map((u, i) => (u > 0 ? i + 1 : 0)).filter(Boolean);
      const season = SEASON_LABEL[x.season];

      let offSold = null;
      let offTotal = null;
      let suggestedSeason = null;
      if (season === 'Any') {
        const summerOnly = soldIn.length >= ANY_MIN_MONTHS && soldIn.every(isSummer);
        const winterOnly = soldIn.length >= ANY_MIN_MONTHS && soldIn.every((m) => !isSummer(m));
        suggestedSeason = summerOnly ? 'Summer' : winterOnly ? 'Winter' : null;
      } else {
        const offIsSummer = season === 'Winter';
        offTotal = offIsSummer ? SUMMER_MONTHS : WINTER_MONTHS;
        offSold = soldIn.filter((m) => isSummer(m) === offIsSummer).length;
        if (offSold >= Math.ceil(SUGGEST_SHARE * offTotal)) suggestedSeason = 'Any';
      }

      return {
        groupid: x.groupid,
        title: x.title || null,
        brand: x.brand || null,
        season,
        status: x.status || null,
        months,
        months_sold: soldIn.length,
        off_sold: offSold,
        off_total: offTotal,
        revenue_12m: Number(x.revenue_12m) || 0,   // pg NUMERIC arrives as a string
        units_12m: Number(x.units_12m) || 0,
        rev_summer: Number(x.rev_summer) || 0,     // sold in April–August, whatever the style's season
        rev_winter: Number(x.rev_winter) || 0,     // sold in September–March
        in_stock: x.in_stock === true,
        added_12m: x.added_12m === true,
        suggested: suggestedSeason !== null,
        suggested_season: suggestedSeason,
      };
    });

    const first = r.rows[0];
    return res.json({
      return_code: 'SUCCESS',
      window: first ? { from: first.win_from, to: first.win_to } : null,
      last_change: last.rows[0] || null,
      rows,
    });
  } catch (err) {
    logger.error('[product-seasons] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load seasons' });
  }
});

module.exports = router;
