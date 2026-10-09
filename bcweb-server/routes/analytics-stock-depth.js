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
         BANDS      new      created under NEW_DAYS ago — too young to have a pace; shown apart so it is never read as stuck
                    none     no net sales in its window — not selling
                    under6   up to 6 months of its own sales
                    6to12    6 to 12 months
                    over12   more than a year — the over-deep pile
         EXCESS     = units beyond what the style NEEDS: units - NEED_MONTHS x pace, floored at 0. Need depends on how fast more can be
                      had (owner, 2026-10-09): Birkenstock is bought ~6 months ahead and cannot be re-ordered mid-season, so it needs 6
                      months; everything else (Lunar/IVES etc.) can be re-ordered any week, so 2 months. A 'none' style needs nothing —
                      all its units are excess. A 'new' style has no pace yet — counted as 0 excess, never guessed.
                      The page's "excess units" number is the sum: the stock bought beyond need, which the owner wants driven down.
         Thresholds are business judgements and live here as constants, not in the SQL.

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
"months" is null for the new and none bands. "sold" is net units in the style's window (12 months, or its life if younger).
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

router.use(verifyToken);

const NEW_DAYS = 56;          // 8 weeks — long enough for a fresh style to have shown some pace
const BAND_ORDER = ['under6', '6to12', 'over12', 'none', 'new'];
// Months of its own sales a style NEEDS to hold, by brand (how long until more can land). Anything not listed can be re-ordered weekly.
const NEED_MONTHS = { Birkenstock: 6 };
const NEED_MONTHS_DEFAULT = 2;

router.get('/', async (req, res) => {
  try {
    const r = await query(
      `WITH stock AS (
         SELECT groupid, SUM(qty)::int AS units FROM (
           SELECT groupid, qty FROM localstock WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE'
           UNION ALL
           SELECT groupid, amztotal FROM amzfeed WHERE groupid IS NOT NULL
         ) x
         GROUP BY groupid
         HAVING SUM(qty) > 0
       ),
       styles AS (
         -- Window = the last 365 days, or the style's life if shorter (min 1 day). created_at is authoritative (backfilled 2026-07).
         SELECT s.groupid, s.units, t.shopifytitle AS title, ss.brand,
                CURRENT_DATE - ss.created_at::date AS age_days,
                LEAST(365, GREATEST(COALESCE(CURRENT_DATE - ss.created_at::date, 365), 1)) AS window_days
         FROM stock s
         LEFT JOIN skusummary ss ON ss.groupid = s.groupid
         LEFT JOIN title t ON t.groupid = s.groupid
       ),
       sold AS (
         SELECT st.groupid, SUM(sa.qty) AS sold
         FROM styles st
         JOIN sales sa ON sa.groupid = st.groupid AND sa.solddate > CURRENT_DATE - st.window_days
         GROUP BY st.groupid
       )
       SELECT st.groupid, st.title, st.brand, st.units, st.age_days, st.window_days, COALESCE(so.sold, 0)::int AS sold
       FROM styles st
       LEFT JOIN sold so ON so.groupid = st.groupid`
    );

    const counts = Object.fromEntries(BAND_ORDER.map((b) => [b, { band: b, styles: 0, units: 0 }]));
    let excessUnits = 0;
    const rows = r.rows.map((s) => {
      const units = Number(s.units);
      const sold = Number(s.sold);
      let band;
      let months = null;
      let excess = 0;
      if (s.age_days !== null && Number(s.age_days) < NEW_DAYS) {
        band = 'new';
      } else if (sold <= 0) {
        band = 'none';
        excess = units;
      } else {
        const perMonth = sold / (Number(s.window_days) / 30.44);
        months = Math.round((units / perMonth) * 10) / 10;
        band = months <= 6 ? 'under6' : months <= 12 ? '6to12' : 'over12';
        const need = (NEED_MONTHS[s.brand] ?? NEED_MONTHS_DEFAULT) * perMonth;
        excess = Math.max(0, Math.round(units - need));
      }
      counts[band].styles += 1;
      counts[band].units += units;
      excessUnits += excess;
      return { groupid: s.groupid, title: s.title, brand: s.brand || null, units, sold, months, band, excess };
    });

    return res.json({ return_code: 'SUCCESS', bands: BAND_ORDER.map((b) => counts[b]), excess_units: excessUnits, rows });
  } catch (err) {
    logger.error('[analytics-stock-depth] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load stock depth' });
  }
});

module.exports = router;
