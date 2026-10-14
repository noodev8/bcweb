/*
=======================================================================================================================================
API Route: analytics_revenue
=======================================================================================================================================
Method: GET
Purpose: Reports -> Revenue, opened from the "12m revenue" box on Repricing's Status tab (owner, 2026-10-14: "On the WINNERS screen we
         have our revenue. I want to click on the card and go to the breakdown ... enough information to know how we are
         progressing"). The rolling 12 months split by channel (Shopify / Amazon / CM3), each figure beside the same figure for the 12
         months before (the year before, owner 2026-10-14). The page is a card per channel, which the owner will extend with each
         channel's expenses to see what is left.

         REVENUE = SUM(soldprice * qty), the same sum the Winners figure stamps (utils/portfolioStatus.js), so it is NET OF RETURNS
         (returns are qty < 0 rows) and VAT-INCLUSIVE — the number that reconciles with Shopify, Seller Central and the bank. `sold` and
         `returns` are the two halves of it (returns negative). Windows are the stamp's too: this year = solddate >= CURRENT_DATE - 12
         months (today included); last year = the 12 months before that. sales starts Aug 2024, so last year is complete.

         WHY THE TOTAL IS HIGHER THAN THE WINNERS BOX. The Winners box sums the revenue STAMPED on each style still in skusummary, at the
         last "Update now". This screen sums every sales row, so it also counts styles deleted since and shop items with no style
         (~£19k on 14 Oct 2026). `off_file` is that part, per channel, so the page can say so instead of leaving two numbers that
         don't agree. A small difference can also be today's sales since the last "Update now".

         COST OF GOODS (2026-10-14, owner: "start with VAT and cost of goods"). Sales rows carry no cost, so it is skusummary.cost
         (read via safeNumeric) x qty — TODAY's cost, so the year before reads a little high wherever a supplier has put prices up
         since. Returns (qty < 0) put their pair's cost back.
         DELETED STYLES (2026-10-14): a Shopify SALE of a style no longer in skusummary takes the cost recovered from its stored
         sales.profit (utils/shopifyProfit.js → costFromProfitSql; it recovers today's cost to the penny on 99.8% of live-style rows,
         and shows last year's sales were stamped at today's cost too — so "today's cost" is not reading last year high on Shopify).
         Still no cost: refunds of deleted styles (a refund's profit doesn't invert), Amazon / CM3 deleted styles (different or no
         formula — test Amazon's the same way when its turn comes), junk/blank cost. Their revenue is reported as `no_cost`.
         VAT is NOT computed here: the owner's rule is revenue / 6 (kids' zero-rated sales are next to nothing), done on the page.

         SHOPIFY EXPENSES (2026-10-14) — `shopify_expenses`, each line { cur, prev } for the two windows. ONE RULE FOR ALL: real
         figures where we hold them, an AVERAGE where they run out (owner: "just show your average figure used rather than the date.
         Every now and again I can give you data to recalculate the average"). Each line returns its `rate` so the page can show the
         averages in use; fee/ads windows also split `real` and `est` so a cell can say "est." / "part est.".
           shopify_payments, paypal   fee_daily (utils/feeDaily.js). Real for the days a source covers; outside them its own rate
                                      (its fees / Shopify revenue over the days it covers) x Shopify revenue.
           google_ads                 google_product_daily (manual import), as Ad Daily sums it. Real to the last imported day, then
                                      the ads' rate over the 12 months to that day x Shopify revenue. Ads first ran 2025-02-02, so the
                                      year before is complete as stored.
           figures                    expense_figure — Royal Mail, packing bags. Averages: each window takes its own figure (the
                                      newest ending by the window's end), / Shopify pairs sold over its period = a cost per pair,
                                      x the window's pairs sold. `per_pair` returned is this year's.

           delivery { cur, prev }     INCOME: what Shopify customers paid for delivery (shopify_delivery, net of refunds, inc.
                                      VAT). Not in `sales`, so not in revenue above. Free postage from 2026-10-14.

         KEEPING IT CURRENT — the owner supplies these by hand now and again, only to RECALCULATE the averages (nothing goes blank or
         stale without them; the page shows the averages in use, not dates):
           - Royal Mail + packing bags: a new period total → INSERT a new expense_figure row (newest per name wins).
           - PayPal: a new "All transactions" export → node scripts/paypal-fees-import.js <csv> --apply.
           - Google Ads: the Google Ads Import screen, as for the ads screens.
           Shopify Payments fees need nothing: "Update now" on Repricing tops them up.

         Channels are whatever `sales.channel` holds (SHP / AMZ / CM3 today), largest first; an unknown code still shows, never dropped.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "from": "2025-10-14", "to": "2026-10-14",           // this window, inclusive (London-ish: CURRENT_DATE of the pg session)
  "prev_from": "2024-10-14", "prev_to": "2025-10-13",
  "channels": [
    { "channel": "SHP", "revenue": 218833.20, "sold": 252250.81, "returns": -33417.61, "units": 3698,
      "prev_revenue": 153106.65, "prev_sold": ..., "prev_returns": ..., "prev_units": ...,   // the same four, the year before
      "off_file": 5448.13,
      "cogs": 120000.00, "prev_cogs": ...,          // cost of goods, ex VAT, at TODAY's skusummary.cost, returns put back
      "no_cost": 5600.00, "prev_no_cost": ... }, ...   // revenue with no usable cost (deleted styles, junk cost) — not in cogs
  ]
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
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { safeNumeric } = require('../utils/sql');
const { costFromProfitSql } = require('../utils/shopifyProfit');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // One pass over 24 months; FILTER splits the two windows. `cur` mirrors the Winners stamp's window exactly.
    const r = await query(`
      WITH w AS (
        SELECT s.channel, s.qty, s.soldprice * s.qty AS v,
               s.solddate >= CURRENT_DATE - INTERVAL '12 months' AS cur,
               ss.groupid IS NULL AS off_file,
               -- Cost of goods at TODAY's cost (sales rows carry none): a return's negative qty puts its pair back. A Shopify SALE of a
               -- style deleted since has no skusummary row, so its cost is recovered from its stored profit (see the header).
               CASE WHEN ss.groupid IS NOT NULL THEN ${safeNumeric('ss.cost')} * s.qty
                    WHEN s.channel = 'SHP' AND s.qty > 0 THEN ${costFromProfitSql('s.soldprice', 's.profit')} * s.qty
               END AS cogs
        FROM sales s
        LEFT JOIN skusummary ss ON ss.groupid = s.groupid
        WHERE s.solddate >= CURRENT_DATE - INTERVAL '24 months'
      )
      SELECT COALESCE(NULLIF(channel, ''), '?')                              AS channel,
             COALESCE(SUM(v) FILTER (WHERE cur), 0)::float8                   AS revenue,
             COALESCE(SUM(v) FILTER (WHERE cur AND qty > 0), 0)::float8       AS sold,
             COALESCE(SUM(v) FILTER (WHERE cur AND qty < 0), 0)::float8       AS returns,
             COALESCE(SUM(qty) FILTER (WHERE cur), 0)::int                    AS units,
             COALESCE(SUM(v) FILTER (WHERE NOT cur), 0)::float8               AS prev_revenue,
             COALESCE(SUM(v) FILTER (WHERE NOT cur AND qty > 0), 0)::float8   AS prev_sold,
             COALESCE(SUM(v) FILTER (WHERE NOT cur AND qty < 0), 0)::float8   AS prev_returns,
             COALESCE(SUM(qty) FILTER (WHERE NOT cur), 0)::int                AS prev_units,
             COALESCE(SUM(v) FILTER (WHERE cur AND off_file), 0)::float8      AS off_file,
             COALESCE(SUM(cogs) FILTER (WHERE cur), 0)::float8                AS cogs,
             COALESCE(SUM(cogs) FILTER (WHERE NOT cur), 0)::float8            AS prev_cogs,
             COALESCE(SUM(v) FILTER (WHERE cur AND cogs IS NULL), 0)::float8      AS no_cost,
             COALESCE(SUM(v) FILTER (WHERE NOT cur AND cogs IS NULL), 0)::float8  AS prev_no_cost
      FROM w
      GROUP BY 1
      ORDER BY 2 DESC
    `);
    const d = await query(`
      SELECT (CURRENT_DATE - INTERVAL '12 months')::date::text AS from,
             CURRENT_DATE::text                                 AS to,
             (CURRENT_DATE - INTERVAL '24 months')::date::text AS prev_from,
             (CURRENT_DATE - INTERVAL '12 months' - INTERVAL '1 day')::date::text AS prev_to
    `);
    const r2 = (x) => Math.round(x * 100) / 100;
    const channels = r.rows.map((c) => ({
      channel: c.channel, revenue: r2(c.revenue), sold: r2(c.sold), returns: r2(c.returns), units: c.units,
      prev_revenue: r2(c.prev_revenue), prev_sold: r2(c.prev_sold), prev_returns: r2(c.prev_returns), prev_units: c.prev_units,
      off_file: r2(c.off_file),
      cogs: r2(c.cogs), prev_cogs: r2(c.prev_cogs), no_cost: r2(c.no_cost), prev_no_cost: r2(c.prev_no_cost),
    }));
    const shopify_expenses = await shopifyExpenses();
    return res.json({ return_code: 'SUCCESS', ...d.rows[0], channels, shopify_expenses });
  } catch (err) {
    logger.error('[analytics-revenue] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Revenue' });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// SHOPIFY EXPENSES (see the header). Three reads, each giving { cur, prev } for the same two windows as the channels above.
// ---------------------------------------------------------------------------------------------------------------------------------
// Google Shopping first ran 2025-02-02 (owner, 2026-10-14: an export for 1 Oct 2024 – 31 Jul 2025 has no rows before it, and that is
// real, not a short export) — so the year before's ads are complete as stored, and only days AFTER the last import are estimated.

const WINDOWS_SQL = `
  SELECT 'cur' AS w, (CURRENT_DATE - INTERVAL '12 months')::date AS f, CURRENT_DATE AS t
  UNION ALL
  SELECT 'prev', (CURRENT_DATE - INTERVAL '24 months')::date, (CURRENT_DATE - INTERVAL '12 months' - INTERVAL '1 day')::date`;

async function shopifyExpenses(db = { query }) {   // db: a transaction client in the rollback test, else the pool
  const [fees, ads, figs, delivery] = await Promise.all([
    // FEES: real where fee_daily covers the day; outside a source's covered range, its own real rate (fees / Shopify revenue over
    // the covered range) x that day's Shopify revenue. rate NULL = nothing stored for the source yet, so no estimate either.
    db.query(`
      WITH win AS (${WINDOWS_SQL}),
      src AS (SELECT unnest(ARRAY['SHOPIFY_PAYMENTS', 'PAYPAL']) AS source),
      shp AS (SELECT solddate AS day, SUM(soldprice * qty) AS rev FROM sales WHERE channel = 'SHP' GROUP BY solddate),
      cov AS (SELECT source, MIN(day) AS f, MAX(day) AS t, SUM(fees) AS fees FROM fee_daily GROUP BY source),
      rate AS (SELECT c.source, c.f, c.t, c.fees / NULLIF((SELECT SUM(rev) FROM shp WHERE shp.day BETWEEN c.f AND c.t), 0) AS rate
               FROM cov c)
      SELECT s.source, w.w,
             COALESCE((SELECT SUM(fd.fees) FROM fee_daily fd
                       WHERE fd.source = s.source AND fd.day BETWEEN w.f AND w.t), 0)::float8 AS real,
             (SELECT SUM(shp.rev) FROM shp
              WHERE shp.day BETWEEN w.f AND w.t AND (r.f IS NULL OR shp.day NOT BETWEEN r.f AND r.t))::float8 AS uncovered_rev,
             r.rate::float8 AS rate,
             GREATEST(w.f, r.f)::text AS real_from, LEAST(w.t, r.t)::text AS real_to
      FROM src s CROSS JOIN win w LEFT JOIN rate r ON r.source = s.source
    `),
    // GOOGLE ADS: Shopping spend from the manual import (google_product_daily — the same sum as Ad Daily). Real up to the last
    // imported day; the days after it are ESTIMATED at the ads' own rate (spend / Shopify revenue over the 12 months to the last
    // import) x Shopify revenue. Nothing ran before GOOGLE_ADS_STARTED, so days before it are simply £0, not "missing".
    db.query(`
      WITH win AS (${WINDOWS_SQL}),
      last AS (SELECT MAX(snapshot_date) AS d FROM google_product_daily),
      shp AS (SELECT solddate AS day, SUM(soldprice * qty) AS rev FROM sales WHERE channel = 'SHP' GROUP BY solddate),
      rate AS (
        SELECT (SELECT SUM(cost) FROM google_product_daily, last WHERE snapshot_date > last.d - INTERVAL '12 months')
               / NULLIF((SELECT SUM(rev) FROM shp, last WHERE day > last.d - INTERVAL '12 months' AND day <= last.d), 0) AS rate
      )
      SELECT w.w,
             COALESCE((SELECT SUM(g.cost) FROM google_product_daily g WHERE g.snapshot_date BETWEEN w.f AND w.t), 0)::float8 AS real,
             (SELECT SUM(rev) FROM shp, last WHERE day BETWEEN w.f AND w.t AND day > last.d)::float8 AS uncovered_rev,
             rate.rate::float8 AS rate
      FROM win w CROSS JOIN rate
    `),
    // TYPED FIGURES (Royal Mail, packing bags) — AVERAGES (owner, 2026-10-14: "just show your average figure used ... every now and
    // again I can give you data to recalculate the average"). Each window takes ITS OWN figure — the newest per name that ended by
    // the window's end (else the newest there is) — turned into a cost per pair sold (amount / SHP pairs sold, qty > 0, over the
    // figure's own period), x the window's pairs sold. So a figure given for exactly the window comes back as itself, and as the
    // window rolls on it follows the average instead of going stale.
    db.query(`
      WITH win AS (${WINDOWS_SQL}),
      pairs AS (SELECT solddate AS day, SUM(qty) AS n FROM sales WHERE channel = 'SHP' AND qty > 0 GROUP BY solddate),
      names AS (SELECT DISTINCT name FROM expense_figure WHERE channel = 'SHP'),
      pick AS (
        SELECT n.name, w.w, w.f, w.t,
               (SELECT e.id FROM expense_figure e WHERE e.channel = 'SHP' AND e.name = n.name
                ORDER BY (e.period_to <= w.t) DESC, e.period_to DESC, e.id DESC LIMIT 1) AS id
        FROM names n CROSS JOIN win w
      )
      SELECT p.name, p.w,
             (e.amount / NULLIF((SELECT SUM(n) FROM pairs WHERE day BETWEEN e.period_from AND e.period_to), 0))::float8 AS per_pair,
             (SELECT SUM(n) FROM pairs WHERE day BETWEEN p.f AND p.t)::float8 AS window_pairs
      FROM pick p JOIN expense_figure e ON e.id = p.id
    `),
    // DELIVERY CHARGED to the customer (shopify_delivery, per order, net of delivery refunds, inc. VAT), by the order's day. INCOME,
    // not an expense — it sits under Revenue on the page. Free postage from 2026-10-14, so it runs to £0 from there on purpose.
    db.query(`
      WITH win AS (${WINDOWS_SQL})
      SELECT w.w, COALESCE(SUM(d.charged - d.refunded), 0)::float8 AS amount
      FROM win w LEFT JOIN shopify_delivery d ON d.order_day BETWEEN w.f AND w.t
      GROUP BY w.w
    `),
  ]);

  const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
  const feeLine = (source) => {
    const at = (w) => {
      const x = fees.rows.find((f) => f.source === source && f.w === w);
      const est = x.rate === null ? null : (x.uncovered_rev || 0) * x.rate;
      const real_days = x.real_from && x.real_to && x.real_from <= x.real_to ? { from: x.real_from, to: x.real_to } : null;
      return { amount: r2(x.real + (est || 0)), real: r2(x.real), est: r2(est), rate: x.rate, real_days };
    };
    return { cur: at('cur'), prev: at('prev') };
  };
  const adAt = (w) => {
    const x = ads.rows.find((a) => a.w === w);
    const est = x.rate === null ? null : (x.uncovered_rev || 0) * x.rate;
    return { amount: r2(x.real + (est || 0)), real: r2(x.real), est: r2(est), rate: x.rate, real_days: null };
  };
  return {
    shopify_payments: feeLine('SHOPIFY_PAYMENTS'),
    paypal: feeLine('PAYPAL'),
    google_ads: { cur: adAt('cur'), prev: adAt('prev') },
    delivery: Object.fromEntries(delivery.rows.map((d) => [d.w, r2(d.amount)])),
    figures: [...new Set(figs.rows.map((f) => f.name))].map((name) => {
      const at = (w) => figs.rows.find((f) => f.name === name && f.w === w);
      const cur = at('cur'), prev = at('prev');
      const amt = (x) => (x && x.per_pair !== null ? r2(x.per_pair * (x.window_pairs || 0)) : null);
      return { name, per_pair: cur ? r2(cur.per_pair) : null, cur: amt(cur), prev: amt(prev) };
    }).sort((a, b) => (b.cur || 0) - (a.cur || 0)),
  };
}

module.exports = router;
module.exports.shopifyExpenses = shopifyExpenses;   // for the rollback test only
