/*
=======================================================================================================================================
API Route: analytics_stock_position
=======================================================================================================================================
Method: GET
Purpose: Reports -> Stock Position (2026-10-15). THE stock screen — Sell-through's top stats plus the summary, merged the same day
         (owner: "I only use the top stats of the sell through. The rest is just data"). Sell-through's tables became its data page. Owner: "As a summary I need report for
         current position, progress and something to act on ... cards and numbers at a glance." Sell-through stays the detail behind it.

         POSITION  pairs held now, the share past 90 days, and months of stock at the last 12 months' pace — each against the SAME DAY
                   a year ago (not a month end: mid-month the two differ by a fortnight of trade).
         PROGRESS  rolling 12 months to today against the 12 before: pairs sold, pairs bought, and sold as a share of bought. Plus pairs
                   held against pairs sold in the 90 days before, at each month end (the snake — see `snakeQ`).
         ACT ON    Slow (utils/stockSitting.js — no sale in 90 days), and the styles with more pairs past 90 days than they sold in
                   the last 90 (see `top` below).

         90 DAYS (owner, 2026-10-15): "we generally say sell the item inside 90 days". It is the house target, so it's the one line here,
         and it matches Slow's 90. Labelled "past 90 days", never "old" — Birkenstock is bought ~6 months ahead for a season, so a good
         share past 90 days is normal in autumn; that's why every number sits beside the same day last year rather than a target.

         Everything held/aged comes from utils/unitAge.js (FIFO-dated pairs, rebuilt backwards — rules there). Sold = sales, all channels,
         net of returns; bought = incoming_stock (logged from 31 Dec 2024, so a window reaching earlier comes back null, not short).

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-10-15", "year_ago": "2025-10-15",
  "position": { "held": 2886, "held_ya": 2700, "past90": 1896, "past90_ya": 1300, "cover": 4.0, "cover_ya": 4.4 },
  "progress": { "sold": 8800, "sold_prev": 6100, "bought": 9400, "bought_prev": null },
  "trend":    [ { "month": "2025-01", "held": 1585, "sold90": 900, "partial": false }, ... ],   // every ledger month end, oldest first
  "recent":   { "d1": { "in": 0, "sold": 7 }, "d7": {...}, "d30": {...}, "d90": {...} },   // Sell-through's moves, same numbers
  "act":      { "slow_styles": 52, "slow_units": 390,
                "top": [ { "groupid", "title", "units", "past90", "sold_90" } ] }               // past 90 > sold 90, furthest behind first, top 8
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
const logger = require('../utils/logger');
const { query } = require('../database');
const { loadUnitLedger } = require('../utils/unitAge');
const { loadStockSplit } = require('../utils/stockSitting');

const LOG_FIRST_DAY = '2024-12-31';   // first incoming_stock row — a "bought" window starting before it isn't complete
const TOP_N = 8;

const past90 = (b) => b.m3_6 + b.m6_12 + b.m12 + b.pre;   // unitAge's m0_3 is "up to 91 days"; everything else is past it

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const [ledger, split, flowQ] = await Promise.all([
      loadUnitLedger(),
      loadStockSplit(),
      // Rolling 12 months to today (UK) and the 12 before. Windows are (start, end] so a day is never counted twice.
      query(`WITH d AS (SELECT (now() AT TIME ZONE 'Europe/London')::date AS t)
             SELECT
               (SELECT COALESCE(SUM(qty),0) FROM sales, d WHERE solddate > t - interval '1 year' AND solddate <= t)::int                   AS sold,
               (SELECT COALESCE(SUM(qty),0) FROM sales, d WHERE solddate > t - interval '2 years' AND solddate <= t - interval '1 year')::int AS sold_prev,
               (SELECT COALESCE(SUM(GREATEST(quantity_added,1)),0) FROM incoming_stock, d
                  WHERE arrival_date > t - interval '1 year' AND arrival_date <= t)::int                                                  AS bought,
               (SELECT COALESCE(SUM(GREATEST(quantity_added,1)),0) FROM incoming_stock, d
                  WHERE arrival_date > t - interval '2 years' AND arrival_date <= t - interval '1 year')::int                              AS bought_prev,
               to_char((SELECT t FROM d) - interval '2 years', 'YYYY-MM-DD') AS prev_start`),
    ]);

    // THE SNAKE (owner, 2026-10-15: "stock held against the stock sold ... a line fat or thin like a snake but hopefully moving
    // upwards. If too fat, I am not selling enough, if too thin, close to running out of stock but quite efficient"). At every month end:
    // pairs held, and pairs sold in the 90 days to that day — the house "sell within 90 days", so where the two lines meet we hold
    // exactly 90 days of sales. Sold is a rolling 90 days, not the calendar month: one month's sales against a whole stock reads
    // three times fatter and jumps with every slow week. The open month is to today (= Sell-through's 90-day box).
    const snakeQ = await query(
      `SELECT e::text AS e, (SELECT COALESCE(SUM(qty),0) FROM sales WHERE solddate > e - 90 AND solddate <= e)::int AS q
       FROM unnest($1::date[]) AS e`, [ledger.months.map((p) => p.end)]);
    const sold90At = new Map(snakeQ.rows.map((r) => [r.e, r.q]));

    const f = flowQ.rows[0];
    const now = ledger.months[ledger.months.length - 1];
    const ya = ledger.year_ago;
    const cover = (held, sold) => (sold > 0 ? Math.round((held / (sold / 12)) * 10) / 10 : null);

    // Every month end of the ledger (up to 24), so last year's snake sits to the left of this year's — the compare is by eye.
    const trend = ledger.months.map((p) => ({ month: p.month, held: p.held, sold90: sold90At.get(p.end) ?? 0, partial: p.partial }));

    const top = ledger.styles
      .map((s) => ({ groupid: s.groupid, title: s.title, units: s.units, past90: past90(s.bands), sold_90: s.sold_90 }))
      // NOT KEEPING UP: more pairs past 90 days than the style sold in the last 90. A style past 90 days that sells faster than that
      // (FLE030-IVES-WHITE at build: 229 past, 277 sold) is just a big holding of a seller, not something to act on. Most pairs over
      // that line first. A plain compare of two facts shown side by side on screen — not a forecast.
      .filter((s) => s.past90 > s.sold_90)
      .sort((a, b) => (b.past90 - b.sold_90) - (a.past90 - a.sold_90) || b.past90 - a.past90)
      .slice(0, TOP_N);

    return res.json({
      return_code: 'SUCCESS',
      today: ledger.today,
      year_ago: ya.date,
      position: {
        held: now.held,
        held_ya: ya.held,
        past90: past90(now.bands),
        past90_ya: past90(ya.bands),
        cover: cover(now.held, f.sold),
        cover_ya: cover(ya.held, f.sold_prev),
      },
      progress: {
        sold: f.sold,
        sold_prev: f.sold_prev,
        bought: f.bought,
        // The log began 31 Dec 2024; a window that starts before it would read short, so it's withheld until it's whole.
        bought_prev: f.prev_start >= LOG_FIRST_DAY ? f.bought_prev : null,
      },
      trend,
      act: { slow_styles: split.styles.length, slow_units: split.sitting_units, top },
      recent: ledger.recent,   // the moves boxes at the top (moved here from Sell-through when the screens merged, 2026-10-15)
    });
  } catch (err) {
    logger.error('[analytics-stock-position] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Stock Position' });
  }
});

module.exports = router;
