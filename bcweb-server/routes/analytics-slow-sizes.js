/*
=======================================================================================================================================
API Route: analytics_slow_sizes
=======================================================================================================================================
Method: GET
Purpose: Slow -> Sizes. Every SIZE (code) we hold, longest without a sale first. Owner, 2026-10-15: "My interest is in individual SKUs
         that just haven't shifted the longest. I get the top 50 of those and work on them ... I will then decide how to deal with
         them." Slow itself works per STYLE (utils/stockSitting.js), so a style that sells in its middle sizes never shows there even
         when one big size has sat for a year (the owner's example: Milano). This is the same question at code grain.

         A LIST, NOT A RULE. No window, no bar: every held size is returned, ranked. There is no "slow" cut-off here on purpose — the
         owner works the top of the list and decides; don't add a threshold or a flag without the owner. Nothing is written.

IDLE DAYS = days since the size last SOLD on any channel (sales rows with qty > 0 — a return is not a sale, so a pair that sold and
         came back still counts from the sale). Deliveries are ignored, as on Slow (owner, 2026-10-10: "We shouldn't care about
         delivery ... Just want to know what hasn't sold") — a size re-stocked last week that last sold a year ago is a year idle.

ON SHELF = days since the OLDEST pair still held arrived (utils/onShelf.js — oldest sells first; a pair from before Goods In logged
         arrivals is dated 31 Dec 2024, so every size has a number). A separate fact from idle days (owner, 2026-10-15): a size that
         last sold 300 days ago but was restocked last month is a re-order, not an old pair.

NEVER SOLD: idle days = on shelf days (it has been waiting since its oldest pair arrived). Since 2026-10-15 these roll in with the rest
         (owner: "everything rolls as standard instead of putting text in") — no "before 2025" text, no separate top rank.

STOCK = the utils/financeStock.js definition at code grain (local #FREE not deleted + amzfeed.amztotal), LIVE — one number, no Amazon
         split, the same as Slow and Sell-through.

STYLE SOLD (12M) = net units of the whole STYLE in the last 12 months (was 90 days until 2026-10-15 — owner: "shall we say a
         year ... its basically saying the style has sold this many in this time"), so a dead size in a selling style (the Milano case) can be told apart from a
         dead style (which Slow already lists).

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-10-15",
  "sizes": [
    { "code": "1017722-BEND-46", "groupid": "1017722-BEND", "size": "46", "title": "…", "brand": "Birkenstock",
      "units": 2,
      "last_sale": "2025-08-02" | null,         // null = never sold
      "idle_days": 439,                         // since the last sale; never sold = on_shelf_days
      "on_shelf": "2025-03-11",                 // oldest held pair's arrival ('2024-12-31' = before the log)
      "on_shelf_days": 218,
      "style_sold_12m": 41 }
  ]                                             // longest idle first; then most pairs
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
const { verifyToken } = require('../middleware/verifyToken');
const { query } = require('../database');
const { oldestHeldArrival } = require('../utils/onShelf');
const logger = require('../utils/logger');

router.use(verifyToken);

// Held sizes with their style facts and last sale. Dates go out as text (CLAUDE.md: never hand a pg DATE to the JS Date parser).
// Size is the suffix after the last dash (CLAUDE.md: not RIGHT(code,2) — half sizes and UK sizes).
const SIZES_SQL = `
  WITH held AS (
    SELECT code, SUM(q)::int AS units FROM (
      SELECT code, qty AS q FROM localstock WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE'
      UNION ALL
      SELECT code, amztotal FROM amzfeed WHERE code IS NOT NULL
    ) x GROUP BY code HAVING SUM(q) > 0
  ),
  last_sale AS (
    SELECT code, MAX(solddate) AS d FROM sales
    WHERE qty > 0 AND code IN (SELECT code FROM held)
    GROUP BY code
  ),
  today AS (SELECT (now() AT TIME ZONE 'Europe/London')::date AS d)
  SELECT h.code, h.units,
         COALESCE(m.groupid, h.code) AS groupid,
         SUBSTRING(h.code FROM '[^-]*$') AS size,
         t.shopifytitle AS title, NULLIF(TRIM(ss.brand), '') AS brand,
         to_char(s.d, 'YYYY-MM-DD') AS last_sale,
         (SELECT d FROM today) - s.d AS idle_days
  FROM held h
  LEFT JOIN last_sale s   ON s.code     = h.code
  LEFT JOIN skumap m      ON m.code     = h.code
  LEFT JOIN skusummary ss ON ss.groupid = m.groupid
  LEFT JOIN title t       ON t.groupid  = m.groupid
`;

router.get('/', async (req, res) => {
  try {
    const [sizesQ, todayQ, soldQ] = await Promise.all([
      query(SIZES_SQL),
      query(`SELECT to_char((now() AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS today`),
      query(`SELECT groupid, SUM(qty)::int AS q FROM sales
             WHERE solddate > (now() AT TIME ZONE 'Europe/London')::date - 365 AND groupid IS NOT NULL
             GROUP BY groupid`),
    ]);
    const today = todayQ.rows[0].today;

    const shelf = await oldestHeldArrival(new Map(sizesQ.rows.map((r) => [r.code, r.units])));

    // Whole days between two 'YYYY-MM-DD' strings, in UTC so BST never shifts a day.
    const day = (x) => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
    const sold12m = new Map(soldQ.rows.map((r) => [r.groupid, r.q]));

    const sizes = sizesQ.rows.map((r) => {
      const onShelf = shelf.get(r.code);
      const onShelfDays = day(today) - day(onShelf);
      return {
        code: r.code,
        groupid: r.groupid,
        size: r.size,
        title: r.title || null,
        brand: r.brand || null,
        units: r.units,
        last_sale: r.last_sale,
        idle_days: r.idle_days === null ? onShelfDays : Number(r.idle_days),
        on_shelf: onShelf,
        on_shelf_days: onShelfDays,
        style_sold_12m: sold12m.get(r.groupid) || 0,
      };
    });

    // Longest idle first, then longest on the shelf, then most pairs.
    sizes.sort((a, b) => b.idle_days - a.idle_days || b.on_shelf_days - a.on_shelf_days || b.units - a.units
      || a.code.localeCompare(b.code));

    return res.json({ return_code: 'SUCCESS', today, sizes });
  } catch (err) {
    logger.error('[analytics-slow-sizes] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load slow sizes' });
  }
});

module.exports = router;
