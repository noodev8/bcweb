/*
=======================================================================================================================================
API Route: product_overview
=======================================================================================================================================
Method: GET
Purpose: The PRODUCT-FIRST front door (owner, 2026-09-22). "We always start with PRODUCT — from the product I need to find what I need
         or adjust anything about it, without hunting around for the correct screen." This is the list behind /product: one row per
         STYLE, carrying the four numbers that decide which screen you actually want next, so the operator can pick the right style and
         then jump straight into Amazon Order / Amazon Pricing / Shopify Pricing / Add-Modify / Inventory with the groupid already in
         hand. Read-only; the writes live on the modules this hands off to.

         It is NOT a replacement for the screens it links to. /pricing-find and /amz-find stay exactly as they are (amz-find carries the
         bulk price bar, and both are deep-link targets from Analytics' "reprice this"); this route answers a different question — not
         "which SKU am I repricing" but "which product am I working on at all".

WHY NOT JUST REUSE inv-styles. That route ships the WHOLE catalogue (~280 styles) unfiltered so Inventory can narrow it client-side,
and it is built for the picture browse: two per-size JSON maps, the Birk pre-order book, the season tag, the created stamp. This one is
term-filtered server-side and carries the Amazon PRICE spread, which inv-styles has no reason to know. Bolting the spread onto
inv-styles would put it on 280 rows nobody asked for. They share the loc/feed CTE shapes on purpose — if you change what "local" or
"at Amazon" means, change both.

STOCK IS ONE COLUMN: local + Amazon-held (owner, 2026-09-22 — "just add local + Amz at this stage"). Deliberately NOT inv-styles'
`total`, which also folds in the Birkenstock pre-order book: that is stock ~6 months out, and this screen is about the product in front
of you now. So a style can legitimately read LOWER here than on its Inventory card, and the gap is the Birk book. Shipped as the two
parts plus the sum so the client can explain the number on hover without a second call.

THE AMAZON PRICE IS A SPREAD, NOT AN AVERAGE (owner, 2026-09-22), and this is the one thing in this file not to "tidy". Amazon prices
per SIZE: IVES WHITE ran £37.30-£41.09 across its sizes. CLAUDE.md records that the retired match_amazon_price autopilot was killed for
exactly this reason — "there is no single Amazon price and the rule let one thin size set the style's price". An AVG(amzprice) column
would revive that error in a number read every day, so the route ships MIN and MAX and the client prints one value only when they are
equal. pricing-drill already returns the same pair (amazon_lowest / amazon_highest) for the same reason; keep them consistent.
  The spread is taken over LIVE FBA rows (amzlive > 0) — what a customer can actually buy today. A style with an amzfeed row but no FBA
  stock still gets its spread, taken over ALL its rows, with amz_live=false so the client can dim it: "this is what it WOULD sell at"
  is worth seeing, and a blank would read as "not on Amazon at all", which is a different fact.

SOLD IS 30 DAYS, all channels, positive sales only (owner, 2026-09-22) — the same basis as inv-styles' sold30 and as the WINNERS bar in
CLAUDE.md, so the number means one thing across the platform. Requires auth.
=======================================================================================================================================
Request Query Params:
  term  (string, required) - free text. Matched with ILIKE %term% against groupid, the human title (title.shopifytitle - NOT the
                             overloaded colour tag, CLAUDE.md), and - through skumap - the internal size code and the full Amazon
                             Seller SKU. So a pasted '0151183-ARIZONA-38' or '17659-23-42-2607' finds its style.
  limit (int, optional)    - row cap; default 100, clamped to [1, 500] (utils/listLimit.js). The COUNT is never capped.

Success Response:
{
  "return_code": "SUCCESS",
  "term": "ARIZONA",
  "rows": [
    {
      "groupid": "1005292-ARIZONA",
      "title": "Birkenstock Arizona Two-Strap Sandals Black",  // title.shopifytitle; null if none
      "segment": "ARIZONA-GENERAL",
      "imagename": "birkenstock-....jpg",   // bare filename; the web builds https://images.brookfieldcomfort.com/<imagename>
      "stock": 38,                          // local + Amazon-held. THE column (owner) - see the note above
      "local": 27,                          // the two parts, for the hover
      "amazon": 11,
      "amz_low": 37.30, "amz_high": 41.09,  // the SPREAD across sizes; equal when only one size carries a price. null if no amzfeed row
      "amz_live": true,                     // spread taken over in-stock FBA sizes; false = no FBA stock, spread is over all rows
      "amz_sizes": 4,                       // how many sizes the spread covers - "41.09" off one size is not the same fact as off six
      "price": 46.95,                       // live Shopify price (safeNumeric; null if the legacy varchar holds junk)
      "sold30": 19                          // units sold in 30 days, all channels, returns excluded
    }
  ],
  "total": 12,        // TRUE number of matching styles, ignoring the cap
  "count": 12,        // rows actually returned
  "truncated": false  // total > count
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
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const term = (req.query.term || '').trim();
    if (!term) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'term is required' });
    }
    const limit = parseListLimit(req.query.limit);

    // $1 = %term%. Built here and BOUND, never interpolated into the SQL, so it stays injection-safe (CLAUDE.md).
    const like = `%${term}%`;

    // One query, no N+1. Each number is pre-aggregated to style grain in its own CTE and LEFT JOINed on, so a style with no rows in a
    // given source reads 0 rather than dropping out of the list.
    //
    // The MATCH is an EXISTS over skumap rather than a join, on purpose: a style has one row per size there, so joining would fan the
    // result out and then need a DISTINCT to put it back. EXISTS keeps the outer query one-row-per-style throughout.
    // NB: no backticks anywhere in this string; it is a JS template literal and one would end the query mid-flight (CLAUDE.md).
    const sql = `
      WITH matched AS (
        SELECT s.groupid
        FROM skusummary s
        LEFT JOIN title t ON t.groupid = s.groupid
        WHERE s.groupid ILIKE $1
           OR t.shopifytitle ILIKE $1
           OR EXISTS (
                SELECT 1 FROM skumap m
                WHERE m.groupid = s.groupid
                  AND (m.code ILIKE $1 OR m.sku ILIKE $1)
              )
      ),
      loc AS (
        -- Local: SUM(qty), ALL states (free, picked, amz-allocated) - a picked unit is still physically in the building. Excludes
        -- soft-deleted rows only. SUM not COUNT: localstock.qty is NOT always 1 (see the inv-styles header - COUNT under-reports ~7%).
        SELECT ls.groupid, SUM(ls.qty) AS units
        FROM localstock ls
        JOIN matched mt ON mt.groupid = ls.groupid
        WHERE COALESCE(ls.deleted, 0) = 0 AND ls.qty > 0
        GROUP BY ls.groupid
      ),
      feed AS (
        -- At Amazon: amztotal is live + inbound already (verified amztotal >= amzlive on every live row), so it is the single correct
        -- figure - do NOT add amzlive to it. amzfeed is FBA-only and READ ONLY (CLAUDE.md).
        SELECT f.groupid, SUM(COALESCE(f.amztotal, 0)) AS units
        FROM amzfeed f
        JOIN matched mt ON mt.groupid = f.groupid
        GROUP BY f.groupid
      ),
      amz_live AS (
        -- The price spread across sizes a customer can buy TODAY (amzlive > 0). Junk-prone varchar, so safeNumeric - a size whose
        -- price is unreadable contributes nothing rather than throwing the request. The COUNT is of PRICED sizes, so the client can
        -- say how thin the spread is: one size reading 41.09 is not the same fact as six sizes reading it.
        SELECT f.groupid,
               MIN(${safeNumeric('f.amzprice')}) AS lo,
               MAX(${safeNumeric('f.amzprice')}) AS hi,
               COUNT(${safeNumeric('f.amzprice')}) AS sizes
        FROM amzfeed f
        JOIN matched mt ON mt.groupid = f.groupid
        WHERE COALESCE(f.amzlive, 0) > 0
        GROUP BY f.groupid
      ),
      amz_any AS (
        -- The same spread over EVERY amzfeed row, live or not. Used only when the style has no live size at all - see the header: a
        -- blank would read as "not on Amazon", which is a different fact from "on Amazon, currently out of stock".
        SELECT f.groupid,
               MIN(${safeNumeric('f.amzprice')}) AS lo,
               MAX(${safeNumeric('f.amzprice')}) AS hi,
               COUNT(${safeNumeric('f.amzprice')}) AS sizes
        FROM amzfeed f
        JOIN matched mt ON mt.groupid = f.groupid
        GROUP BY f.groupid
      ),
      sold AS (
        -- Units sold in the last 30 days, ALL channels (AMZ + SHP + CM3). qty > 0 drops returns so a refund does not read as a
        -- negative sale. sales.groupid is already style-grain, so no join.
        SELECT sa.groupid, SUM(sa.qty) AS units
        FROM sales sa
        JOIN matched mt ON mt.groupid = sa.groupid
        WHERE sa.solddate >= CURRENT_DATE - INTERVAL '30 days' AND sa.qty > 0
        GROUP BY sa.groupid
      )
      SELECT
        s.groupid,
        t.shopifytitle                          AS title,
        s.segment,
        s.imagename,
        ${safeNumeric('s.shopifyprice')}         AS price,
        COALESCE(loc.units, 0)                  AS local_units,
        COALESCE(feed.units, 0)                 AS amazon_units,
        COALESCE(sold.units, 0)                 AS sold_units,
        amz_live.lo                             AS live_lo,
        amz_live.hi                             AS live_hi,
        amz_live.sizes                          AS live_sizes,
        amz_any.lo                              AS any_lo,
        amz_any.hi                              AS any_hi,
        amz_any.sizes                           AS any_sizes,
        COUNT(*) OVER ()                        AS total_matches
      FROM skusummary s
      JOIN matched mt ON mt.groupid = s.groupid
      LEFT JOIN title    t        ON t.groupid        = s.groupid
      LEFT JOIN loc               ON loc.groupid      = s.groupid
      LEFT JOIN feed              ON feed.groupid     = s.groupid
      LEFT JOIN sold              ON sold.groupid     = s.groupid
      LEFT JOIN amz_live          ON amz_live.groupid = s.groupid
      LEFT JOIN amz_any           ON amz_any.groupid  = s.groupid
      ORDER BY t.shopifytitle NULLS LAST, s.groupid
      LIMIT $2
    `;

    const result = await query(sql, [like, limit]);

    // COUNT(*) OVER () rides along on every row, so the TRUE match count costs no second query. Zero rows means zero matches.
    const total = result.rows.length ? Number(result.rows[0].total_matches) : 0;

    const rows = result.rows.map((r) => {
      // pg returns SUM()/COUNT() as strings (numeric/bigint) - coerce so the JSON carries real numbers the client never parses.
      const local = Number(r.local_units) || 0;
      const amazon = Number(r.amazon_units) || 0;
      // Live sizes first; fall back to the whole feed only when nothing is in stock (see the header). `hasLive` is shipped as
      // amz_live so the client can dim an out-of-stock spread rather than present it as a price you can buy at today.
      const hasLive = Number(r.live_sizes) > 0;
      const lo = hasLive ? r.live_lo : r.any_lo;
      const hi = hasLive ? r.live_hi : r.any_hi;
      const sizes = Number(hasLive ? r.live_sizes : r.any_sizes) || 0;
      return {
        groupid: r.groupid,
        title: r.title || null,
        segment: r.segment || null,
        imagename: r.imagename || null,
        // THE stock column: local + Amazon-held, one number (owner). The parts ride along for the hover.
        stock: local + amazon,
        local,
        amazon,
        amz_low: lo === null || lo === undefined ? null : Number(lo),
        amz_high: hi === null || hi === undefined ? null : Number(hi),
        amz_live: hasLive,
        amz_sizes: sizes,
        price: r.price === null ? null : Number(r.price),
        sold30: Number(r.sold_units) || 0,
      };
    });

    return res.json({
      return_code: 'SUCCESS',
      term,
      rows,
      total,
      count: rows.length,
      truncated: total > rows.length,
    });
  } catch (err) {
    logger.error('[product-overview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Search failed' });
  }
});

module.exports = router;
