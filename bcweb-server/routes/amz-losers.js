/*
=======================================================================================================================================
API Route: amz_losers
=======================================================================================================================================
Method: GET
Purpose: The LOSERS list for a segment — the mirror of the Amazon WINNERS shortlist and of Shopify's pricing-losers. Where WINNERS finds
         fast, well-stocked sizes to price UP, LOSERS finds slow / stuck FBA stock to price DOWN — "cut to get it moving"
         (docs/amz-pricing-spec.md §1). SKU-grain: one row per SKU (size), so a dead size shows up even when its groupid looks healthy.

Definition (Amazon-native windows — faster than Shopify's, matching the engine's velocity lens):
  - Candidates: in FBA stock (amzfeed.amzlive > 0), channel='AMZ', in the chosen segment.
  - DEAD  = no Amazon sale in the last 14 days (stock sitting, gone quiet). Flagged "no recent sales".
  - SLOW  = cover >= coverWeeks, where cover = weeks-to-clear at current pace = amzlive * (days/7) / u_win, and u_win = units sold in the
            cover window `days` (default 90 — a longer lens so a slow-but-alive size isn't mistaken for dead). The cover gate is what keeps
            healthy high-stock sellers OFF the list.
  - Membership: DEAD OR SLOW.
  - Order: DEAD cluster FIRST (flagged), then SLOW; within each cluster, MOST FBA STOCK first (stock at risk). Top N.

There is NO park / review concept on Amazon (docs/amz-pricing-spec.md §4), so nothing is hidden for a cooldown — the equivalent of
"leave it alone" is simply not changing the price.

Schema landmines respected: amzfeed FBA-only, READ ONLY; amzprice via safeNumeric; amzlive a real integer. Size = RIGHT(code,2). Human
name from title.shopifytitle. Requires auth.
=======================================================================================================================================
Request Query Params:
  segment    (string, required)
  days       (int, optional)  - sales window for the pace/cover measure; default 90
  limit      (int, optional)  - list size; default 10
  coverWeeks (int, optional)  - "too slow" threshold in weeks of cover; default 16 (tighter than Shopify's 26 — Amazon moves faster)

Success Response:
{
  "return_code": "SUCCESS",
  "segment": "IVES-WHITE",
  "days": 90,
  "coverWeeks": 16,
  "rows": [
    { "rank": 1, "code": "...-52", "amz_sku": "...", "groupid": "...", "size": "52", "title": "...", "price": 38.49,
      "fba": 22, "u30": 0, "u90": 1, "u14": 0, "cover_weeks": 282.9, "is_dead": true, "last_sold": "2026-05-20", "days_since_sale": 51 },
    ...  // dead cluster first (is_dead true), then slow; most FBA stock first within each
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

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const { segment } = req.query;
    // Defaults: 90d cover window, top 10, 16-week cover cutoff. Parse defensively; fall back on anything non-numeric.
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 90;
    const limit = Number.parseInt(req.query.limit, 10) > 0 ? Number.parseInt(req.query.limit, 10) : 10;
    const coverWeeks = Number.parseInt(req.query.coverWeeks, 10) > 0 ? Number.parseInt(req.query.coverWeeks, 10) : 16;

    if (!segment) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'segment is required' });
    }

    // $1 segment, $2 days (cover window), $3 limit, $4 coverWeeks.
    // cover = amzlive * (days/7) / u_win. Guard the denominator with NULLIF so a size with no sales in the window (u_win NULL) never
    // divides by zero; a genuinely dead size (no sale in 14d) is caught by the DEAD branch instead.
    const result = await query(`
      WITH cover AS (   -- units in the cover window (default 90d)
        SELECT code, SUM(qty) AS u_win FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - $2::int
        GROUP BY code
      ),
      s30 AS (          -- 30d units, context so the human can spot a size waking back up
        SELECT code, SUM(qty) AS u30 FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30
        GROUP BY code
      ),
      s14 AS (          -- 14d units — the DEAD test (no recent sale)
        SELECT code, SUM(qty) AS u14 FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 14
        GROUP BY code
      ),
      ls AS (           -- last sold (ignores returns) for the "days since sale" context
        SELECT code, MAX(solddate) AS last_sold FROM sales
        WHERE channel='AMZ' AND qty>0
        GROUP BY code
      )
      SELECT a.code, a.groupid, a.sku AS amz_sku, RIGHT(a.code,2) AS size,
             t.shopifytitle AS title,
             ${safeNumeric('a.amzprice')} AS price,
             COALESCE(a.amzlive,0) AS fba,
             COALESCE(s30.u30,0)   AS u30,
             COALESCE(c.u_win,0)   AS u_win,
             COALESCE(s14.u14,0)   AS u14,
             CASE WHEN COALESCE(c.u_win,0)=0 THEN NULL
                  ELSE round(COALESCE(a.amzlive,0) * ($2::numeric/7.0) / c.u_win, 1) END AS cover_weeks,
             (COALESCE(s14.u14,0)=0) AS is_dead,
             to_char(ls.last_sold,'YYYY-MM-DD') AS last_sold,
             (CURRENT_DATE - ls.last_sold)::int AS days_since_sale
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      LEFT JOIN cover c  ON c.code   = a.code
      LEFT JOIN s30      ON s30.code = a.code
      LEFT JOIN s14      ON s14.code = a.code
      LEFT JOIN ls       ON ls.code  = a.code
      LEFT JOIN title t  ON t.groupid = a.groupid
      WHERE sk.segment = $1
        AND COALESCE(a.amzlive,0) > 0                                                    -- must have FBA stock (nothing to act on otherwise)
        AND (
              COALESCE(s14.u14,0) = 0                                                     -- DEAD (no sale in 14d)
              OR COALESCE(a.amzlive,0) * ($2::numeric/7.0) / NULLIF(c.u_win,0) >= $4::numeric  -- SLOW (cover >= coverWeeks)
            )
      ORDER BY is_dead DESC,   -- dead cluster first
               fba DESC,       -- most stock at risk first, within each cluster
               u_win ASC       -- tie-break: slower first
      LIMIT $3::int
    `, [segment, days, limit, coverWeeks]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      code: r.code,
      amz_sku: r.amz_sku,
      groupid: r.groupid,
      size: r.size,
      title: r.title || null,
      price: num(r.price),
      fba: Number(r.fba),
      u30: Number(r.u30),
      u90: Number(r.u_win),                                    // labelled u90 in the payload (default window is 90d)
      u14: Number(r.u14),
      cover_weeks: r.cover_weeks === null ? null : Number(r.cover_weeks),
      is_dead: r.is_dead,
      last_sold: r.last_sold || null,
      days_since_sale: r.days_since_sale === null ? null : Number(r.days_since_sale),
    }));

    return res.json({ return_code: 'SUCCESS', segment, days, coverWeeks, rows });
  } catch (err) {
    logger.error('[amz-losers] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load losers list' });
  }
});

module.exports = router;
