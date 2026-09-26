/*
=======================================================================================================================================
API Route: pricing_status_overview
=======================================================================================================================================
Method: GET
Purpose: Repricing — the STATUS tab (the first and default tab since 2026-09-24, replacing Top earners — owner: "This pricing group
         should replace the old top earners"). Per portfolio status (the stored skusummary.portfolio_status tag) and per CHANNEL, how
         much pricing work is behind it, so each tile says so before you open the list.

         The counts use exactly the list routes' rules (pricing-status-list.js for Shopify styles, amz-status-list.js for Amazon SKUs),
         so a tile's `due` IS the length of the list it opens with the Due switch on:
           total          everything with the status — styles on Shopify (= the Winners screen's card), amzfeed SKUs on Amazon
           due            of those, not parked (review date absent or today/past) — OUT OF STOCK INCLUDED (owner, 2026-09-24: price
                          ahead of stock arriving, not at an old clearance price)
           parked         review date in the future — what switching Due off adds
           out_of_stock   of `total`, how many have no stock (Shopify: #FREE localstock; Amazon: FBA amzlive). Listed, just flagged.
           due_styles     how many STYLES have at least one row due — a style is due if ANY of its sizes is (owner, 2026-09-25). The
                          tile's due line; on Shopify it equals `due`. The list it opens is still per size, so on Amazon it shows
                          more rows than this number.
           styles         how many STYLES those rows are — equals `total` on Shopify; on Amazon the rows are sizes (SKUs), and the
                          style count is what matches the Winners screen's chip (owner, 2026-09-25: "23 styles ... showing 78").

         EACH CHANNEL COUNTS ONLY ITS OWN STYLES (2026-09-25): lead channel (skusummary.portfolio_channel) SHP|BOTH for Shopify,
         AMZ|BOTH for Amazon — the same predicate the lists use (utils/portfolioStatus.js → channelFilterSql).

         Always four statuses in rule order, zeros included, so the screen draws a stable set of tiles. Read-only.

         THE WINNERS DIAL (2026-09-25 — the Winners screen's £1,500 / £2,500 / £5,000 / £10,000 toggle, moving onto Repricing).
         `winner_bars` gives the WINNERS tile's counts at every mark of WINNER_BAR_LADDER, per channel, in one read so the toggle
         needs no refetch. Same rule as the status lists' ?bar= (pricing-status-list.js / amz-status-list.js): tagged WINNERS whose
         STAMPED portfolio_revenue_12m is over the mark. That revenue is ALL-CHANNEL — the Amazon row at £5,000 is the winners whose
         total 12m turnover beats £5,000, not their Amazon turnover. At bars[0] (= WINNER_BAR) the counts equal the WINNERS tile.

Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "updated_at": "2026-09-24 22:44",   // London time the tags were last set; null = never
  "statuses": [
    { "status": "WINNERS",
      "shopify": { "total": 50,  "due": 27, "parked": 23, "out_of_stock": 5,  "styles": 50 },
      "amazon":  { "total": 131, "due": 78, "parked": 53, "out_of_stock": 54, "styles": 23, "due_styles": 18 } }, ...
  ],
  "winner_bars": [                    // one per dial mark, ascending; zeros included
    { "bar": 1500, "shopify": { "total": 50, "due": 24, "styles": 50 }, "amazon": { "total": 131, "due": 66, "styles": 23 } }, ...
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
const { STATUSES, channelFilterSql } = require('../utils/portfolioStatus');
const { WINNER_BAR_LADDER } = require('../utils/portfolio');
const logger = require('../utils/logger');

router.use(verifyToken);

const ZERO = { total: 0, due: 0, parked: 0, out_of_stock: 0, styles: 0, due_styles: 0 };

router.get('/', async (req, res) => {
  try {
    // Independent reads, run together: the four statuses per channel, then the WINNERS counts at each dial mark per channel.
    const [shp, amz, shpBars, amzBars] = await Promise.all([
      query(`
        WITH stk AS (
          SELECT groupid FROM localstock
          WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
          GROUP BY groupid
        )
        SELECT ss.portfolio_status AS status,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE ss.next_shopify_price_review IS NULL
                                   OR ss.next_shopify_price_review <= CURRENT_DATE)::int AS due,
               COUNT(*) FILTER (WHERE ss.next_shopify_price_review > CURRENT_DATE)::int AS parked,
               COUNT(*) FILTER (WHERE st.groupid IS NULL)::int AS out_of_stock,
               COUNT(*)::int AS styles,                                -- a Shopify row IS a style
               COUNT(*) FILTER (WHERE ss.next_shopify_price_review IS NULL
                                   OR ss.next_shopify_price_review <= CURRENT_DATE)::int AS due_styles,
               to_char(MAX(ss.portfolio_status_at) AT TIME ZONE 'Europe/London', 'YYYY-MM-DD HH24:MI') AS last_at
        FROM skusummary ss
        LEFT JOIN stk st ON st.groupid = ss.groupid
        WHERE ss.portfolio_status IS NOT NULL
          AND ${channelFilterSql('ss', 'SHP')}
        GROUP BY ss.portfolio_status
      `),
      query(`
        SELECT sk.portfolio_status AS status,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE m.next_amz_price_review IS NULL
                                   OR m.next_amz_price_review <= CURRENT_DATE)::int AS due,
               COUNT(*) FILTER (WHERE m.next_amz_price_review > CURRENT_DATE)::int AS parked,
               COUNT(*) FILTER (WHERE COALESCE(a.amzlive,0) = 0)::int AS out_of_stock,
               COUNT(DISTINCT a.groupid)::int AS styles,               -- rows are sizes; this is how many styles they belong to
               COUNT(DISTINCT a.groupid) FILTER (WHERE m.next_amz_price_review IS NULL
                                                    OR m.next_amz_price_review <= CURRENT_DATE)::int AS due_styles
        FROM amzfeed a
        JOIN skusummary sk ON sk.groupid = a.groupid
        JOIN skumap m      ON m.code    = a.code
        WHERE sk.portfolio_status IS NOT NULL
          AND ${channelFilterSql('sk', 'AMZ')}
        GROUP BY sk.portfolio_status
      `),
      // The dial: one row per mark a winner clears (a style over £5,000 counts at 1,500, 2,500 and 5,000). A mark nobody clears
      // returns no row and reads as zero below.
      query(`
        SELECT b.bar::int AS bar,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE ss.next_shopify_price_review IS NULL
                                   OR ss.next_shopify_price_review <= CURRENT_DATE)::int AS due,
               COUNT(*)::int AS styles,
               COUNT(*) FILTER (WHERE ss.next_shopify_price_review IS NULL
                                   OR ss.next_shopify_price_review <= CURRENT_DATE)::int AS due_styles
        FROM skusummary ss
        JOIN unnest($1::numeric[]) AS b(bar) ON ss.portfolio_revenue_12m > b.bar
        WHERE ss.portfolio_status = 'WINNERS'
          AND ${channelFilterSql('ss', 'SHP')}
        GROUP BY b.bar
      `, [WINNER_BAR_LADDER]),
      query(`
        SELECT b.bar::int AS bar,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE m.next_amz_price_review IS NULL
                                   OR m.next_amz_price_review <= CURRENT_DATE)::int AS due,
               COUNT(DISTINCT a.groupid)::int AS styles,
               COUNT(DISTINCT a.groupid) FILTER (WHERE m.next_amz_price_review IS NULL
                                                    OR m.next_amz_price_review <= CURRENT_DATE)::int AS due_styles
        FROM amzfeed a
        JOIN skusummary sk ON sk.groupid = a.groupid
        JOIN skumap m      ON m.code    = a.code
        JOIN unnest($1::numeric[]) AS b(bar) ON sk.portfolio_revenue_12m > b.bar
        WHERE sk.portfolio_status = 'WINNERS'
          AND ${channelFilterSql('sk', 'AMZ')}
        GROUP BY b.bar
      `, [WINNER_BAR_LADDER]),
    ]);

    const pick = (rows, status) => {
      const x = rows.find((r) => r.status === status);
      return x ? { total: x.total, due: x.due, parked: x.parked, out_of_stock: x.out_of_stock, styles: x.styles, due_styles: x.due_styles } : { ...ZERO };
    };
    const statuses = STATUSES.map((status) => ({ status, shopify: pick(shp.rows, status), amazon: pick(amz.rows, status) }));
    const atBar = (rows, bar) => {
      const x = rows.find((r) => r.bar === bar);
      return x ? { total: x.total, due: x.due, styles: x.styles, due_styles: x.due_styles } : { total: 0, due: 0, styles: 0, due_styles: 0 };
    };
    const winnerBars = WINNER_BAR_LADDER.map((bar) => ({ bar, shopify: atBar(shpBars.rows, bar), amazon: atBar(amzBars.rows, bar) }));
    const updatedAt = shp.rows.map((x) => x.last_at).filter(Boolean).sort().pop() || null;

    return res.json({ return_code: 'SUCCESS', updated_at: updatedAt, statuses, winner_bars: winnerBars });
  } catch (err) {
    logger.error('[pricing-status-overview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load status overview' });
  }
});

module.exports = router;
