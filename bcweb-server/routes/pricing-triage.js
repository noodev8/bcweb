/*
=======================================================================================================================================
API Route: pricing_triage
=======================================================================================================================================
Method: GET
Purpose: Stage 1 — the shortlist. For a chosen segment, returns the top N in-stock, un-parked styles by units sold in the last
         `days` on Shopify. This is a sanity shortlist ("which styles are worth a look"), nothing more (CLAUDE.md Stage 1).

Key domain rules baked into the SQL (S2, CLAUDE.md) — do not change without re-reading CLAUDE.md:
  - Shopify only (channel='SHP'); positive sales only (qty>0, soldprice>0).
  - Drop styles with 0 current stock: the INNER JOIN to the localstock-derived stock CTE removes them, and LIMIT tops the list
    back up to N. Rationale: Birkenstock can't be restocked, so a 0-stock style has nothing to price (CLAUDE.md).
  - Drop "parked" styles: a future next_shopify_price_review hides a style until the cooldown passes.
  - Stock is derived from localstock (#FREE, not deleted, qty>0) — NEVER skusummary.stockvariants (stale) (CLAUDE.md).
  - Auto-matched styles (match_amazon_price) are deliberately KEPT in the list (owner): triage is where the operator re-decides whether a
    style should stay in the Amazon-match bracket. Their price is on autopilot (pricing-apply refuses a manual change), so the action for
    them is "keep matching → set a review to snooze" or "turn matching off". Each row carries match_amazon so the UI can badge it.
=======================================================================================================================================
Request Query Params:
  segment  (string, required)  - the segment to shortlist within
  days     (int, optional)     - lookback window in days for sales; default 30 (CLAUDE.md Stage 1)
  limit    (int, optional)     - shortlist size; default 10

Success Response:
{
  "return_code": "SUCCESS",
  "segment": "EVA-SEG",
  "days": 30,
  "rows": [
    { "rank": 1, "groupid": "ABC123", "title": "Arizona Birko-Flor", "units": 25, "stock": 8, "price": 36.95, "match_amazon": false },
    ...   // ordered by units desc; rank is 1-based row number for the numbered list (CLAUDE.md). match_amazon=true => auto-matched (badge + review-only).
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
    // Defaults per CLAUDE.md: 30-day window, top 10. Parse defensively; fall back to the defaults on anything non-numeric.
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 30;
    const limit = Number.parseInt(req.query.limit, 10) > 0 ? Number.parseInt(req.query.limit, 10) : 10;

    if (!segment) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'segment is required' });
    }

    // S2 (CLAUDE.md) — verbatim. $1 segment, $2 days, $3 limit.
    const result = await query(`
      WITH win AS (
        SELECT s.groupid,
               SUM(s.qty) AS units,
               MAX(s.solddate::text || ' ' || LPAD(COALESCE(s.ordertime,'00:00'),5,'0')) AS last_ts
        FROM sales s
        JOIN skusummary ss ON ss.groupid = s.groupid
        WHERE ss.segment = $1 AND s.channel='SHP'
          AND s.qty > 0 AND s.soldprice > 0
          AND s.solddate >= CURRENT_DATE - $2::int
          AND (ss.next_shopify_price_review IS NULL OR ss.next_shopify_price_review <= CURRENT_DATE)
        GROUP BY s.groupid
      ),
      stk AS (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY groupid
      )
      SELECT w.groupid, w.units, st.stock, t.shopifytitle,
             ${safeNumeric('sp.shopifyprice')} AS price,  -- current live price, so the bulk price-editor can compute per-row deltas
             sp.match_amazon_price AS match_amazon        -- so the list can badge auto-matched styles (kept IN the list for review)
      FROM win w
      JOIN stk st ON st.groupid = w.groupid            -- INNER JOIN drops 0-stock styles
      LEFT JOIN skusummary sp ON sp.groupid = w.groupid -- for the current price (legacy VARCHAR -> safeNumeric)
      LEFT JOIN title t ON t.groupid = w.groupid
      ORDER BY w.units DESC, w.last_ts DESC
      LIMIT $3::int
    `, [segment, days, limit]);

    // Shape for the numbered list (CLAUDE.md): row number + units + groupid + title + stock + current price (for the bulk editor).
    // price is NULL when the legacy VARCHAR held junk/blank (safeNumeric) — the client shows "—" and skips that row's delta preview.
    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      groupid: r.groupid,
      title: r.shopifytitle || null,
      units: Number(r.units),
      stock: Number(r.stock),
      price: r.price === null || r.price === undefined ? null : Number(r.price),
      match_amazon: r.match_amazon === true   // auto-matched styles stay in the list for a "keep matching?" review; badged in the UI
    }));

    return res.json({ return_code: 'SUCCESS', segment, days, rows });
  } catch (err) {
    logger.error('[pricing-triage] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load triage list' });
  }
});

module.exports = router;
