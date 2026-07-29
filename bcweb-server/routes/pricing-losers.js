/*
=======================================================================================================================================
API Route: pricing_losers
=======================================================================================================================================
Method: GET
Purpose: The "LOSERS" list for a segment — the mirror of the WINNERS triage. Where WINNERS finds fast sellers to price UP (harvest),
         LOSERS finds slow / stuck stock to price DOWN — a "cut to get it moving" nudge that could turn a slow mover into a winner
         (see CLAUDE.md, LOSERS list).

Definition (owner, 2026-07-29 — SIMPLIFIED, see the note below on what was removed and why):
  - Candidates: in stock, un-parked, channel='SHP', in the chosen segment.
  - Membership: ZERO units sold in the last `days` (default 30). That is the whole test. Sold nothing in a month -> it's a loser.
  - Order: MOST STOCK first (stock at risk).

WHAT THIS REPLACED, AND THE TRADE-OFF THE OWNER ACCEPTED. This route used to measure over 90d and admit rows on DEAD (u_win=0) OR SLOW
(cover >= coverWeeks, default 26). The cover calculation, the `coverWeeks` param, and the cover_weeks / is_dead response fields are all
GONE — under a single "sold nothing in 30d" test every row is dead by definition, so is_dead was uniformly true and cover_weeks
uniformly null. Do not reintroduce them without reintroducing the 90d window they were derived from.

The 90d lens existed to separate "slow but alive" from "stone dead", and dropping it genuinely widens the net: measured on the run when
this changed, the Shopify list went 44 -> 53 styles, and 25 of those 53 HAD sold within 90d — 21 of them with healthy cover (would have
cleared inside 26 weeks at their own pace). Those 21 are styles a 30d window calls losers that the old rule called fine. The owner's
call, made with those numbers in front of him: a simple, explainable rule beats a more accurate one nobody can hold in their head. If
"we're cutting things that were going to sell anyway" ever becomes the complaint, THIS paragraph is the thing to revisit first.

Likewise there is no minimum stock depth: a style with 1 leftover unit of one size qualifies exactly like one with 40 units. On the
same measured run, 35 of the 53 had <=5 units and only 5 had more than 10, so the list is mostly size residue by count — the
most-stock-first ordering is what keeps the few high-stock styles at the top where the money is. Offered a stock floor; declined.
  - Size: the WHOLE qualifying set, not a top-N shortlist. `limit` is only a safety cap (utils/listLimit.js, default 100) so a
    pathological segment can't dump thousands of rows into the browser; `total` + `truncated` say whether it bit.
  - Seasonality + size-residue are deliberately NOT handled here: the human picks an appropriate segment (seasonality) and parks a
    residual style with a long review (size residue) so it stops surfacing.
  - Auto-matched styles (match_amazon_price) are KEPT in the list (owner): a slow/dead style whose Shopify price is auto-matched to Amazon
    is exactly where the operator decides the matched price is costing us and switches matching OFF. Their price is on autopilot
    (pricing-apply refuses a manual change), so the action is "turn matching off" or "keep matching + set a review". Rows carry match_amazon.

Schema landmines respected: stock from localstock (#FREE, not deleted, qty>0), never stockvariants. Human name from title.shopifytitle.
=======================================================================================================================================
Request Query Params:
  segment    (string, required)
  days       (int, optional)  - the "sold nothing in this many days" window; default 30
  limit      (int, optional)  - safety cap on rows returned; default 100, hard max 500 (utils/listLimit.js)

Success Response:
{
  "return_code": "SUCCESS",
  "segment": "GIZEH-SEG",
  "days": 30,
  "total": 3,           // qualifying styles in the segment, BEFORE the cap
  "truncated": false,   // true when the cap trimmed the set (rows.length < total)
  "rows": [
    { "rank": 1, "groupid": "...", "title": "...", "price": 42.00, "stock": 48, "u30": 0, "match_amazon": false },
    { "rank": 2, "groupid": "...", "title": "...", "price": 29.95, "stock": 14, "u30": 0, "match_amazon": false },
    ...  // most stock first
  ]
}
u30 is always 0 by construction (that IS the membership test). It is kept in the payload because the LOSERS table shares its column
layout with WINNERS and renders this into the shared "Units (30d)" cell — dropping it would break that alignment.
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

router.get('/', async (req, res) => {
  try {
    const { segment } = req.query;
    // Default window is now 30d (was 90d) — the membership test is "sold nothing in this window". `limit` is a safety cap, not a list
    // size (utils/listLimit.js). `coverWeeks` is gone: with no cover calculation left there is nothing for it to threshold. It is
    // ignored rather than rejected if an old client still sends it, so a stale browser tab degrades to the new behaviour, not an error.
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 30;
    const limit = parseListLimit(req.query.limit);

    if (!segment) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'segment is required' });
    }

    // $1 segment, $2 days, $3 limit.
    // Membership is the LEFT JOIN + "no sales row in the window" test: a style with no qualifying sale has u_win NULL -> COALESCE 0.
    const result = await query(`
      WITH stk AS (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY groupid
      ),
      win AS (   -- units sold in the window (default 30d) — the ONLY sales measure this route needs now
        SELECT groupid, SUM(qty) AS u_win FROM sales
        WHERE channel='SHP' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - $2::int
        GROUP BY groupid
      )
      SELECT ss.groupid,
             ${safeNumeric('ss.shopifyprice')} AS price,   -- current live price, so the bulk price-editor can compute per-row deltas
             st.stock,
             COALESCE(w.u_win,0) AS u30,               -- always 0 (that IS the test); kept for the shared "Units (30d)" column
             ss.match_amazon_price AS match_amazon,   -- kept IN the list: a slow/dead matched style is where the operator decides the
                                                      -- Amazon-matched price is costing us and switches matching OFF (owner). Badged in UI.
             t.shopifytitle,
             COUNT(*) OVER () AS total_rows            -- full qualifying count: window functions run BEFORE the LIMIT, so this is the
                                                       -- pre-cap total (free — no second round-trip to count)
      FROM skusummary ss
      JOIN stk st        ON st.groupid = ss.groupid            -- INNER JOIN: must have stock (nothing to act on otherwise)
      LEFT JOIN win w    ON w.groupid  = ss.groupid
      LEFT JOIN title t  ON t.groupid  = ss.groupid
      WHERE ss.segment = $1
        AND (ss.next_shopify_price_review IS NULL OR ss.next_shopify_price_review <= CURRENT_DATE)  -- drop parked
        AND COALESCE(w.u_win,0) = 0                            -- sold NOTHING in the window — the whole membership test
      ORDER BY st.stock DESC,     -- most stock at risk first
               ss.groupid         -- tie-break: stable ordering so equal-stock rows don't shuffle between requests
      LIMIT $3::int
    `, [segment, days, limit]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      groupid: r.groupid,
      title: r.shopifytitle || null,
      price: r.price === null || r.price === undefined ? null : Number(r.price),   // null when the legacy VARCHAR held junk/blank
      stock: Number(r.stock),
      u30: Number(r.u30),                       // always 0 — see the header note
      match_amazon: r.match_amazon === true   // auto-matched styles stay in the list so a margin-hurting match can be spotted + switched off
    }));

    // total = the qualifying set before the cap (0 when there are no rows at all); truncated tells the UI the cap bit.
    const total = result.rows.length > 0 ? Number(result.rows[0].total_rows) : 0;
    return res.json({ return_code: 'SUCCESS', segment, days, total, truncated: rows.length < total, rows });
  } catch (err) {
    logger.error('[pricing-losers] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load losers list' });
  }
});

module.exports = router;
