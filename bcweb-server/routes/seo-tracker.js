/*
=======================================================================================================================================
API Route: seo_tracker
=======================================================================================================================================
Method: GET
Purpose: The SEO TRACKER — the main SEO page (owner, 2026-11-07: "What I would really want is a SEO tracker … see if we are motivated to
         continue. We can look at visits from google but ultimately we want purchases, and then probably visits before the purchase").
         The goal (docs/seo/PLAN.md): more Shopify sales we didn't pay Google for. The visits target is kept internally — NOT on this screen (owner).
         OUR OWN DATA FIRST (shopify_order_source, shopify_sessions_daily), Google's view last (Search Console).

         FREE = every came_from not in NOT_FREE (utils/orderSource.js — owner chose "everything not paid": Google free, AI, other
         search, Direct, Email, Social, Other site). Unknown (~1 in 3 web orders, tracking declined) and "Google (paid or free?)" are
         never counted as free — and never guessed.

         Every comparison is against the SAME PERIOD A YEAR EARLIER, shifted 364 days so the weekdays line up — seasons mislead
         anything else (sandals in July). Windows end YESTERDAY (London): today is partial.

         Blocks:
           sales      free orders + £: last 28 days vs the same 28 days a year earlier, and the YEAR SO FAR vs the same point last year
                      (the "keep going?" number); plus the 28-day split by source
           visits     Shopify sessions a day, last 7 days' average (a plain number, no target); 28 days vs a year earlier; orders per 100 visits (all
                      sources — the paid / free split of visits only exists from 2026-11-08, PAID_SPLIT_FROM); visits by source 28d
           ai         visits and orders from AI (ChatGPT, Perplexity …), year so far vs the same point last year
           google     Search Console free clicks / impressions / position, 28 days to its last complete day vs the same 28 days a
                      year earlier — Google's view, an early sign, never the score (held in memory 1h)
           months     month by month, this year and last: free orders, free £, visits

         READ ONLY.

Requires auth.
=======================================================================================================================================
Request: GET /seo-tracker

Success Response:
{ "return_code": "SUCCESS", "today": "2026-11-07", "paid_split_from": "2026-11-08",
  "sales": { "d28": { "now": { "orders": 28, "gbp": 1707, "from": "…", "to": "…" }, "ly": {…} }, "ytd": { "now": {…}, "ly": {…} },
             "by_source": [ { "came_from": "Direct", "orders": 12, "gbp": 762 } ], "unknown_share": 0.31 },
  "visits": { "avg7": 25.6, "d28": { "now": 900, "ly": 2600 }, "per100": { "now": 3.1, "ly": 2.0 }, "by_source": [ … ] },
  "ai": { "ytd": { "now": { "visits": 260, "orders": 16, "gbp": 1200 }, "ly": {…} } },
  "google": { "now": { "clicks": 328, "impressions": 21425, "position": 12.0 }, "ly": {…}, "to": "…" } | null,
  "months": [ { "month": 1, "label": "Jan", "now": { "orders": 3, "gbp": 200, "visits": 2109 }, "ly": {…} } ] }
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
const { LONDON_TODAY_SQL } = require('../utils/sql');
const { NOT_FREE } = require('../utils/orderSource');
const { PAID_SPLIT_FROM } = require('../utils/shopifySessions');
const { gscQuery, gscEnd, addDays, ymd } = require('../utils/searchConsole');
const logger = require('../utils/logger');

router.use(verifyToken);

// No target here — the team's visits target is kept internally, never sent to or shown on the screen (owner, 2026-11-07).
const SHIFT = 364;                // days back for "the same period a year earlier" — whole weeks, so weekdays line up
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORDER_DAY = `(created_at AT TIME ZONE 'Europe/London')::date`;

const GSC_TTL_MS = 60 * 60 * 1000;
let gscCache = null;   // { at, value }

// Search Console totals for two 28-day windows; null if Google can't be read (the rest of the page still loads).
async function googleView() {
  if (gscCache && Date.now() - gscCache.at < GSC_TTL_MS) return gscCache.value;
  try {
    const end = gscEnd();
    const win = async (e) => {
      const [r] = await gscQuery({ start: addDays(e, -27), end: e });
      return r ? { clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 } : { clicks: 0, impressions: 0, position: null };
    };
    const value = { to: ymd(end), now: await win(end), ly: await win(addDays(end, -SHIFT)) };
    gscCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.error('[seo-tracker] Search Console unavailable:', err.message);
    return null;
  }
}

router.get('/', async (req, res) => {
  try {
    // The windows, all in London days, all ending yesterday. ly = shifted back SHIFT days; YTD = 1 Jan → yesterday, and last year's
    // 1 Jan → the same calendar date last year.
    const w = (await query(`
      SELECT t::text AS today, (t - 1)::text AS y, (t - 28)::text AS d28_from,
             (t - 1 - ${SHIFT})::text AS ly_to, (t - 28 - ${SHIFT})::text AS ly_from,
             date_trunc('year', t - 1)::date::text AS ytd_from,
             (date_trunc('year', t - 1) - interval '1 year')::date::text AS lytd_from,
             ((t - 1) - interval '1 year')::date::text AS lytd_to
      FROM (SELECT ${LONDON_TODAY_SQL} AS t) x`)).rows[0];

    const freeOrders = async (from, to) => {
      const r = await query(
        `SELECT COUNT(*)::int AS orders, COALESCE(ROUND(SUM(total)), 0)::int AS gbp FROM shopify_order_source
         WHERE ${ORDER_DAY} BETWEEN $1 AND $2 AND came_from <> ALL($3)`, [from, to, NOT_FREE]);
      return { ...r.rows[0], from, to };
    };
    const visits = async (from, to) => (await query(
      `SELECT COALESCE(SUM(sessions), 0)::int AS n FROM shopify_sessions_daily WHERE day BETWEEN $1 AND $2`, [from, to])).rows[0].n;
    const allOrders = async (from, to) => (await query(
      `SELECT COUNT(*)::int AS n FROM shopify_order_source WHERE ${ORDER_DAY} BETWEEN $1 AND $2 AND came_from <> 'Not online'`, [from, to])).rows[0].n;

    const [d28Now, d28Ly, ytdNow, ytdLy, google] = await Promise.all([
      freeOrders(w.d28_from, w.y), freeOrders(w.ly_from, w.ly_to), freeOrders(w.ytd_from, w.y), freeOrders(w.lytd_from, w.lytd_to), googleView(),
    ]);

    // Sales by source, last 28 days — every source, free or not, so the headline can be read against the whole.
    const bySource = (await query(
      `SELECT came_from, COUNT(*)::int AS orders, COALESCE(ROUND(SUM(total)), 0)::int AS gbp FROM shopify_order_source
       WHERE ${ORDER_DAY} BETWEEN $1 AND $2 AND came_from <> 'Not online' GROUP BY came_from ORDER BY orders DESC`, [w.d28_from, w.y])).rows;
    const webOrders28 = bySource.reduce((a, r) => a + r.orders, 0);
    const unknown28 = (bySource.find((r) => r.came_from === 'Unknown') || { orders: 0 }).orders;

    // Visits.
    const [v7, v28, v28ly, o28, o28ly] = await Promise.all([
      visits((await query(`SELECT ($1::date - 6)::text AS d`, [w.y])).rows[0].d, w.y),
      visits(w.d28_from, w.y), visits(w.ly_from, w.ly_to), allOrders(w.d28_from, w.y), allOrders(w.ly_from, w.ly_to),
    ]);
    const visitsBySource = (await query(
      `SELECT came_from, SUM(sessions)::int AS visits FROM shopify_sessions_daily WHERE day BETWEEN $1 AND $2
       GROUP BY came_from ORDER BY visits DESC`, [w.d28_from, w.y])).rows;

    // AI, year so far vs the same point last year.
    const aiBlock = async (from, to) => {
      const [v, o] = await Promise.all([
        query(`SELECT COALESCE(SUM(sessions), 0)::int AS n FROM shopify_sessions_daily WHERE came_from = 'AI' AND day BETWEEN $1 AND $2`, [from, to]),
        query(`SELECT COUNT(*)::int AS n, COALESCE(ROUND(SUM(total)), 0)::int AS gbp FROM shopify_order_source
               WHERE came_from = 'AI' AND ${ORDER_DAY} BETWEEN $1 AND $2`, [from, to]),
      ]);
      return { visits: v.rows[0].n, orders: o.rows[0].n, gbp: o.rows[0].gbp };
    };
    const [aiNow, aiLy] = await Promise.all([aiBlock(w.ytd_from, w.y), aiBlock(w.lytd_from, w.lytd_to)]);

    // Month by month, this year and last (to yesterday).
    const yNow = Number(w.y.slice(0, 4));
    const mo = await query(`
      WITH o AS (
        SELECT EXTRACT(YEAR FROM ${ORDER_DAY})::int AS yr, EXTRACT(MONTH FROM ${ORDER_DAY})::int AS m,
               COUNT(*)::int AS orders, COALESCE(ROUND(SUM(total)), 0)::int AS gbp
        FROM shopify_order_source WHERE ${ORDER_DAY} BETWEEN make_date($1 - 1, 1, 1) AND $2::date AND came_from <> ALL($3)
        GROUP BY 1, 2),
      v AS (
        SELECT EXTRACT(YEAR FROM day)::int AS yr, EXTRACT(MONTH FROM day)::int AS m, SUM(sessions)::int AS visits
        FROM shopify_sessions_daily WHERE day BETWEEN make_date($1 - 1, 1, 1) AND $2::date GROUP BY 1, 2)
      SELECT COALESCE(o.yr, v.yr) AS yr, COALESCE(o.m, v.m) AS m, COALESCE(o.orders, 0) AS orders, COALESCE(o.gbp, 0) AS gbp,
             COALESCE(v.visits, 0) AS visits
      FROM o FULL JOIN v ON v.yr = o.yr AND v.m = o.m`, [yNow, w.y, NOT_FREE]);
    const cell = (yr, m) => {
      const r = mo.rows.find((x) => x.yr === yr && x.m === m);
      return r ? { orders: r.orders, gbp: r.gbp, visits: r.visits } : { orders: 0, gbp: 0, visits: 0 };
    };
    const months = MONTHS.map((label, i) => ({ month: i + 1, label, now: i + 1 <= Number(w.y.slice(5, 7)) ? cell(yNow, i + 1) : null, ly: cell(yNow - 1, i + 1) }));

    const per100 = (o, v) => (v ? Math.round((o / v) * 1000) / 10 : null);
    return res.json({
      return_code: 'SUCCESS',
      today: w.today, paid_split_from: PAID_SPLIT_FROM,
      sales: {
        d28: { now: d28Now, ly: d28Ly }, ytd: { now: ytdNow, ly: ytdLy },
        by_source: bySource.map((r) => ({ ...r, free: !NOT_FREE.includes(r.came_from) })),
        unknown_share: webOrders28 ? Math.round((unknown28 / webOrders28) * 100) / 100 : null,
      },
      visits: {
        avg7: Math.round((v7 / 7) * 10) / 10,
        d28: { now: v28, ly: v28ly, from: w.d28_from, to: w.y },
        per100: { now: per100(o28, v28), ly: per100(o28ly, v28ly) },
        by_source: visitsBySource,
      },
      ai: { ytd: { now: aiNow, ly: aiLy, from: w.ytd_from, to: w.y } },
      google,
      months,
    });
  } catch (err) {
    logger.error('[seo-tracker] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the SEO tracker' });
  }
});

module.exports = router;
