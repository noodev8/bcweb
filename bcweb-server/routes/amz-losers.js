/*
=======================================================================================================================================
API Route: amz_losers
=======================================================================================================================================
Method: GET
Purpose: The LOSERS list for a segment — the mirror of the Amazon WINNERS shortlist and of Shopify's pricing-losers. Where WINNERS finds
         fast, well-stocked sizes to price UP, LOSERS finds slow / stuck FBA stock to price DOWN — "cut to get it moving"
         (docs/amz-pricing-spec.md §1). SKU-grain: one row per SKU (size), so a dead size shows up even when its groupid looks healthy.

Definition (owner, 2026-07-29 — SIMPLIFIED, and now IDENTICAL to Shopify's pricing-losers by explicit instruction that both channels
share one definition):
  - Candidates: in FBA stock (amzfeed.amzlive > 0), channel='AMZ', in the chosen segment, un-parked.
  - Membership: ZERO units sold in the last `days` (default 30). That is the whole test.
  - Order: MOST FBA STOCK first (stock at risk).

WHAT THIS REPLACED. The old rule was DEAD (no sale in 14d) OR SLOW (cover >= coverWeeks, default 16) measured over a 90d cover window.
The cover calculation, the `coverWeeks` param, and the cover_weeks / is_dead response fields are GONE — under a single "sold nothing in
30d" test is_dead is uniformly true and cover_weeks uniformly null, so both were noise. The u90 and u14 fields go with them: u90 existed
only to feed the cover sum and u14 only to be the DEAD test, and neither is rendered by the UI. Reintroducing any of these means
reintroducing the windows they were derived from.

Note the 14d -> 30d move makes the DEAD test LESS trigger-happy, while losing the cover gate makes the list wider overall: measured on
the run when this changed, 74 SKUs -> 88, of which 16 had sold within 90d. Same trade-off the Shopify route documents at length — a
simple rule the operator can hold in their head, at the cost of occasionally cutting something that would have sold anyway.

There is deliberately NO minimum FBA stock depth (offered; declined) — one leftover unit qualifies like forty. Most-stock-first ordering
is what keeps the SKUs that actually matter at the top.
  - Size: the WHOLE qualifying set, not a top-N shortlist. `limit` is only a safety cap (utils/listLimit.js, default 100) so a
    pathological segment can't dump thousands of rows into the browser; `total` + `truncated` say whether it bit.

On parking: the spec text (docs/amz-pricing-spec.md §4) says Amazon has no park/review concept, but the SQL below DOES honour
skumap.next_amz_price_review (§10.4 added it later, and /amz-review writes it). The code is the truth here — parked SKUs are hidden.

Schema landmines respected: amzfeed FBA-only, READ ONLY; amzprice via safeNumeric; amzlive a real integer. Size = RIGHT(code,2). Human
name from title.shopifytitle. Requires auth.
=======================================================================================================================================
Request Query Params:
  segment    (string, required)
  days       (int, optional)  - the "sold nothing in this many days" window; default 30
  limit      (int, optional)  - safety cap on rows returned; default 100, hard max 500 (utils/listLimit.js)

Success Response:
{
  "return_code": "SUCCESS",
  "segment": "IVES-WHITE",
  "days": 30,
  "total": 5,           // qualifying SKUs in the segment, BEFORE the cap
  "truncated": false,   // true when the cap trimmed the set (rows.length < total)
  "rows": [
    { "rank": 1, "code": "...-52", "amz_sku": "...", "groupid": "...", "size": "52", "title": "...", "price": 38.49,
      "fba": 22, "u7": 0, "u30": 0, "last_sold": "2026-05-20", "days_since_sale": 51 },
    ...  // most FBA stock first
  ]
}
u7 and u30 are always 0 by construction (u30 IS the membership test, and u7 is a subset of it). Both are kept because the LOSERS table
shares its column layout with the WINNERS table and renders them into the shared unit cells.
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
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const { segment } = req.query;
    // Default window is now 30d (was a 90d cover window + a 14d dead test). `limit` is a safety cap, not a list size
    // (utils/listLimit.js). `coverWeeks` is gone — nothing left for it to threshold. It is ignored rather than rejected if an old
    // client still sends it, so a stale browser tab degrades to the new behaviour instead of erroring.
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 30;
    const limit = parseListLimit(req.query.limit);

    if (!segment) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'segment is required' });
    }

    // $1 segment, $2 days, $3 limit.
    // Membership is the LEFT JOIN + "no sales row in the window" test: a SKU with no qualifying sale has u_win NULL -> COALESCE 0.
    const result = await query(`
      WITH win AS (     -- units in the window (default 30d) — the ONLY sales measure this route needs now
        SELECT code, SUM(qty) AS u_win FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - $2::int
        GROUP BY code
      ),
      s7 AS (           -- 7d units — same short-window column the WINNERS list shows (matched headers). Always 0 here (subset of the
                        -- window that must be empty), kept so the shared table layout has a value to render.
        SELECT code, SUM(qty) AS u7 FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 7
        GROUP BY code
      ),
      ls AS (           -- last sold (ignores returns) for the "days since sale" context — the one genuinely useful signal left, since
                        -- every row here is by definition quiet: this says whether it went quiet last month or last year.
        SELECT code, MAX(solddate) AS last_sold FROM sales
        WHERE channel='AMZ' AND qty>0
        GROUP BY code
      )
      SELECT a.code, a.groupid, a.sku AS amz_sku, RIGHT(a.code,2) AS size,
             t.shopifytitle AS title,
             ${safeNumeric('a.amzprice')} AS price,
             COALESCE(a.amzlive,0) AS fba,
             COALESCE(w.u_win,0)   AS u30,   -- always 0 (that IS the test); kept for the shared units column
             COALESCE(s7.u7,0)     AS u7,    -- likewise always 0
             to_char(ls.last_sold,'YYYY-MM-DD') AS last_sold,
             (CURRENT_DATE - ls.last_sold)::int AS days_since_sale,
             COUNT(*) OVER () AS total_rows                 -- full qualifying count: window functions run BEFORE the LIMIT, so this is
                                                            -- the pre-cap total (free — no second round-trip to count)
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN skumap m      ON m.code   = a.code                                            -- per-SKU review date (next_amz_price_review); 1:1
      LEFT JOIN win w    ON w.code   = a.code
      LEFT JOIN s7       ON s7.code  = a.code
      LEFT JOIN ls       ON ls.code  = a.code
      LEFT JOIN title t  ON t.groupid = a.groupid
      WHERE sk.segment = $1
        AND COALESCE(a.amzlive,0) > 0                                                    -- must have FBA stock (nothing to act on otherwise)
        AND (m.next_amz_price_review IS NULL OR m.next_amz_price_review <= CURRENT_DATE) -- un-parked only (drops reviewed SKUs; §10.4)
        AND COALESCE(w.u_win,0) = 0                                                      -- sold NOTHING in the window — the whole test
      ORDER BY fba DESC,       -- most stock at risk first
               a.code          -- tie-break: stable ordering so equal-stock rows don't shuffle between requests
      LIMIT $3::int
    `, [segment, days, limit]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      code: r.code,
      amz_sku: r.amz_sku,
      groupid: r.groupid,
      size: r.size,
      title: r.title || null,
      price: num(r.price),
      fba: Number(r.fba),
      u30: Number(r.u30),                                      // always 0 — see the header note
      u7: Number(r.u7),                                        // likewise
      last_sold: r.last_sold || null,
      days_since_sale: r.days_since_sale === null ? null : Number(r.days_since_sale),
    }));

    // total = the qualifying set before the cap (0 when there are no rows at all); truncated tells the UI the cap bit.
    const total = result.rows.length > 0 ? Number(result.rows[0].total_rows) : 0;
    return res.json({ return_code: 'SUCCESS', segment, days, total, truncated: rows.length < total, rows });
  } catch (err) {
    logger.error('[amz-losers] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load losers list' });
  }
});

module.exports = router;
