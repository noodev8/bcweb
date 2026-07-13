/*
=======================================================================================================================================
API Route: pricing_losers
=======================================================================================================================================
Method: GET
Purpose: The "LOSERS" list for a segment — the mirror of the WINNERS triage. Where WINNERS finds fast sellers to price UP (harvest),
         LOSERS finds slow / stuck stock to price DOWN — a "cut to get it moving" nudge that could turn a slow mover into a winner
         (see CLAUDE.md, LOSERS list).

Definition (agreed with owner):
  - Candidates: in stock, un-parked, channel='SHP', in the chosen segment.
  - Measure over `days` (default 90 — a longer lens than WINNERS' 30d, because a genuine slow mover often shows 0 in 30d but a few
    sales over 90d; that's what separates "slow but alive" from "stone dead").
  - cover = weeks to clear at current pace = stock / (u_win / weeks_in_window) = stock * (days/7) / u_win.
  - Membership: DEAD (u_win = 0) OR SLOW (cover >= coverWeeks, default 26 ≈ 6 months of stock on hand). The cover gate is what keeps
    healthy high-stock sellers OFF the list — without it, ranking by stock would just surface big winners.
  - Order: DEAD cluster FIRST (flagged "no recent sales"), then SLOW; within each cluster, MOST STOCK first (stock at risk). Top N.
  - Seasonality + size-residue are deliberately NOT handled here: the human picks an appropriate segment (seasonality) and parks a
    residual style with a long review (size residue) so it stops surfacing.

Schema landmines respected: stock from localstock (#FREE, not deleted, qty>0), never stockvariants. Human name from title.shopifytitle.
=======================================================================================================================================
Request Query Params:
  segment    (string, required)
  days       (int, optional)  - sales window for the pace/cover measure; default 90
  limit      (int, optional)  - list size; default 10
  coverWeeks (int, optional)  - "too slow" threshold in weeks of cover; default 26 (~6 months). Tunable.

Success Response:
{
  "return_code": "SUCCESS",
  "segment": "GIZEH-SEG",
  "days": 90,
  "coverWeeks": 26,
  "rows": [
    { "rank": 1, "groupid": "...", "title": "...", "price": 42.00, "stock": 48, "u30": 1, "u90": 2, "cover_weeks": 308.6, "is_dead": false },
    { "rank": 2, "groupid": "...", "title": "...", "price": 29.95, "stock": 14, "u30": 0, "u90": 0, "cover_weeks": null, "is_dead": true },
    ...  // dead cluster first (cover_weeks null / is_dead true), then slow; most stock first within each
  ]
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
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { segment } = req.query;
    // Defaults: 90d window, top 10, 26-week (~6mo) cover cutoff. Parse defensively; fall back on anything non-numeric.
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 90;
    const limit = Number.parseInt(req.query.limit, 10) > 0 ? Number.parseInt(req.query.limit, 10) : 10;
    const coverWeeks = Number.parseInt(req.query.coverWeeks, 10) > 0 ? Number.parseInt(req.query.coverWeeks, 10) : 26;

    if (!segment) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'segment is required' });
    }

    // $1 segment, $2 days, $3 limit, $4 coverWeeks.
    // cover = stock * (days/7) / u_win. Guard the denominator with NULLIF so a dead style (no sales row -> u_win NULL) never divides
    // by zero; its membership is caught by the DEAD branch instead.
    const result = await query(`
      WITH stk AS (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY groupid
      ),
      win AS (   -- units sold in the cover window (default 90d)
        SELECT groupid, SUM(qty) AS u_win FROM sales
        WHERE channel='SHP' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - $2::int
        GROUP BY groupid
      ),
      recent AS ( -- 30d units, shown as context so the human can spot a style waking back up
        SELECT groupid, SUM(qty) AS u30 FROM sales
        WHERE channel='SHP' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30
        GROUP BY groupid
      )
      SELECT ss.groupid,
             ${safeNumeric('ss.shopifyprice')} AS price,   -- current live price, so the bulk price-editor can compute per-row deltas
             st.stock,
             COALESCE(r.u30,0)   AS u30,
             COALESCE(w.u_win,0) AS u_win,
             CASE WHEN COALESCE(w.u_win,0)=0 THEN NULL
                  ELSE round(st.stock * ($2::numeric/7.0) / w.u_win, 1) END AS cover_weeks,
             (COALESCE(w.u_win,0)=0) AS is_dead,
             t.shopifytitle
      FROM skusummary ss
      JOIN stk st        ON st.groupid = ss.groupid            -- INNER JOIN: must have stock (nothing to act on otherwise)
      LEFT JOIN win w    ON w.groupid  = ss.groupid
      LEFT JOIN recent r ON r.groupid  = ss.groupid
      LEFT JOIN title t  ON t.groupid  = ss.groupid
      WHERE ss.segment = $1
        AND (ss.next_shopify_price_review IS NULL OR ss.next_shopify_price_review <= CURRENT_DATE)  -- drop parked
        AND (
              COALESCE(w.u_win,0) = 0                                                   -- DEAD
              OR st.stock * ($2::numeric/7.0) / NULLIF(w.u_win,0) >= $4::numeric        -- SLOW (cover >= coverWeeks)
            )
      ORDER BY is_dead DESC,      -- dead cluster first
               st.stock DESC,     -- most stock at risk first, within each cluster
               w.u_win ASC        -- tie-break: slower first
      LIMIT $3::int
    `, [segment, days, limit, coverWeeks]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      groupid: r.groupid,
      title: r.shopifytitle || null,
      price: r.price === null || r.price === undefined ? null : Number(r.price),   // null when the legacy VARCHAR held junk/blank
      stock: Number(r.stock),
      u30: Number(r.u30),
      u90: Number(r.u_win),                                     // labelled u90 in the payload (default window is 90d)
      cover_weeks: r.cover_weeks === null ? null : Number(r.cover_weeks),
      is_dead: r.is_dead
    }));

    return res.json({ return_code: 'SUCCESS', segment, days, coverWeeks, rows });
  } catch (err) {
    logger.error('[pricing-losers] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load losers list' });
  }
});

module.exports = router;
