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

         WINNERS' SHARE (2026-10-12, owner: Slow shows "10% of stock" sitting — "is there a percentage we can put on the winners, just
         to compare?"). Each dial mark also carries `share`: the pairs held in those winner styles and their stamped 12m revenue, with
         `share_totals` as the denominators — drawn in the Slow card beside its %. ALL-CHANNEL, like Slow's 10% — stock is
         one pool. STOCK is utils/stockSitting.js's definition (local #FREE + amzfeed
         amztotal, styles with stock > 0) so the denominator is the same total Slow divides by. REVENUE is the stamped
         portfolio_revenue_12m (net of returns, all-channel — what the tier itself reads) over the LIVE 12m sales total (since
         2026-10-15 — the same figure as Reports -> Revenue, which the "12m revenue" box opens; was the stamped sum over tagged
         styles, ~£19k lower because it missed deleted styles and shop items). STYLES is how many
         winners over every tagged style — the "N% of styles earn N% of revenue" (80/20) line under the figures.

         HELD STYLES (2026-10-13, owner: "I want them to line up ... glance at the screen and see it"). `held_styles` = winner styles
         WITH STOCK, over `share_totals.held_styles` = every style with stock. That is the base Slow's styles sit on, so the
         Stock now card can print Winners and Slow as shares of the same 258 styles / 2,917 pairs. `styles` (all tagged, out of stock
         included) stays for the revenue line's context but is no longer printed as a %.

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
    { "bar": 1500, "shopify": { "total": 50, "due": 24, "styles": 50 }, "amazon": { "total": 131, "due": 66, "styles": 23 },
      "share": { "units": 1573, "revenue": 298738.30, "styles": 63, "held_styles": 58 } }, ...  // all-channel: pairs held / 12m revenue / styles / styles with stock
  ],
  "share_totals": { "units": 2889, "revenue": 408264.12, "styles": 296, "held_styles": 258 }  // denominators: all stock / tagged styles' revenue / tagged styles / styles with stock
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
const { inSliderSql } = require('../utils/slider');   // a live slider product reads as parked (owner, 2026-10-29)
const { verifyToken } = require('../middleware/verifyToken');
const { STATUSES, channelFilterSql } = require('../utils/portfolioStatus');
const { WINNER_BAR_LADDER } = require('../utils/portfolio');
const logger = require('../utils/logger');

router.use(verifyToken);

const ZERO = { total: 0, due: 0, parked: 0, out_of_stock: 0, styles: 0, due_styles: 0 };

router.get('/', async (req, res) => {
  try {
    // Independent reads, run together: the four statuses per channel, then the WINNERS counts at each dial mark per channel.
    const [shp, amz, shpBars, amzBars, share] = await Promise.all([
      query(`
        WITH stk AS (
          SELECT groupid FROM localstock
          WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
          GROUP BY groupid
        )
        SELECT ss.portfolio_status AS status,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE (ss.next_shopify_price_review IS NULL
                                   OR ss.next_shopify_price_review <= CURRENT_DATE) AND NOT ${inSliderSql('SHP', 'ss.groupid')})::int AS due,
               COUNT(*) FILTER (WHERE ss.next_shopify_price_review > CURRENT_DATE OR ${inSliderSql('SHP', 'ss.groupid')})::int AS parked,
               COUNT(*) FILTER (WHERE st.groupid IS NULL)::int AS out_of_stock,
               COUNT(*)::int AS styles,                                -- a Shopify row IS a style
               COUNT(*) FILTER (WHERE (ss.next_shopify_price_review IS NULL
                                   OR ss.next_shopify_price_review <= CURRENT_DATE) AND NOT ${inSliderSql('SHP', 'ss.groupid')})::int AS due_styles,
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
               COUNT(*) FILTER (WHERE (m.next_amz_price_review IS NULL
                                   OR m.next_amz_price_review <= CURRENT_DATE) AND NOT ${inSliderSql('AMZ', 'm.code')})::int AS due,
               COUNT(*) FILTER (WHERE m.next_amz_price_review > CURRENT_DATE OR ${inSliderSql('AMZ', 'm.code')})::int AS parked,
               COUNT(*) FILTER (WHERE COALESCE(a.amzlive,0) = 0)::int AS out_of_stock,
               COUNT(DISTINCT a.groupid)::int AS styles,               -- rows are sizes; this is how many styles they belong to
               COUNT(DISTINCT a.groupid) FILTER (WHERE (m.next_amz_price_review IS NULL
                                                    OR m.next_amz_price_review <= CURRENT_DATE) AND NOT ${inSliderSql('AMZ', 'm.code')})::int AS due_styles
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
               COUNT(*) FILTER (WHERE (ss.next_shopify_price_review IS NULL
                                   OR ss.next_shopify_price_review <= CURRENT_DATE) AND NOT ${inSliderSql('SHP', 'ss.groupid')})::int AS due,
               COUNT(*)::int AS styles,
               COUNT(*) FILTER (WHERE (ss.next_shopify_price_review IS NULL
                                   OR ss.next_shopify_price_review <= CURRENT_DATE) AND NOT ${inSliderSql('SHP', 'ss.groupid')})::int AS due_styles
        FROM skusummary ss
        JOIN unnest($1::numeric[]) AS b(bar) ON ss.portfolio_revenue_12m > b.bar
        WHERE ss.portfolio_status = 'WINNERS'
          AND ${channelFilterSql('ss', 'SHP')}
        GROUP BY b.bar
      `, [WINNER_BAR_LADDER]),
      query(`
        SELECT b.bar::int AS bar,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE (m.next_amz_price_review IS NULL
                                   OR m.next_amz_price_review <= CURRENT_DATE) AND NOT ${inSliderSql('AMZ', 'm.code')})::int AS due,
               COUNT(DISTINCT a.groupid)::int AS styles,
               COUNT(DISTINCT a.groupid) FILTER (WHERE (m.next_amz_price_review IS NULL
                                                    OR m.next_amz_price_review <= CURRENT_DATE) AND NOT ${inSliderSql('AMZ', 'm.code')})::int AS due_styles
        FROM amzfeed a
        JOIN skusummary sk ON sk.groupid = a.groupid
        JOIN skumap m      ON m.code    = a.code
        JOIN unnest($1::numeric[]) AS b(bar) ON sk.portfolio_revenue_12m > b.bar
        WHERE sk.portfolio_status = 'WINNERS'
          AND ${channelFilterSql('sk', 'AMZ')}
        GROUP BY b.bar
      `, [WINNER_BAR_LADDER]),
      // Winners' share at each mark (see the header). Totals ride on every row (CROSS JOIN) so it is one read.
      query(`
        WITH local_free AS (
          SELECT groupid, SUM(qty) AS qty FROM localstock
          WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE'
          GROUP BY groupid
        ),
        amz AS (
          SELECT groupid, SUM(amztotal) AS qty FROM amzfeed WHERE groupid IS NOT NULL GROUP BY groupid
        ),
        stock AS (
          SELECT groupid, SUM(qty) AS qty
          FROM (SELECT groupid, qty FROM local_free UNION ALL SELECT groupid, qty FROM amz) x
          GROUP BY groupid
          HAVING SUM(qty) > 0
        ),
        tot AS (
          SELECT (SELECT COALESCE(SUM(qty), 0) FROM stock)::int AS units,
                 -- The live 12m total, the SAME sum as Reports -> Revenue (analytics-revenue.js), which this box opens. The two agreed
                 -- until 2026-10-26, when that page moved to the last 12 COMPLETE P&L months (owner: "Always from last month"); this
                 -- one still rolls to today for the winner shares, and its label says "to today". Not the stamped per-style sum,
                 -- which misses deleted styles / shop items.
                 (SELECT COALESCE(SUM(soldprice * qty), 0) FROM sales
                  WHERE solddate >= CURRENT_DATE - INTERVAL '12 months')::float8 AS revenue,
                 (SELECT COUNT(*) FROM skusummary WHERE portfolio_status IS NOT NULL)::int AS styles,
                 (SELECT COUNT(*) FROM stock)::int AS held_styles
        )
        SELECT b.bar::int AS bar,
               COALESCE(SUM(st.qty), 0)::int                    AS units,
               COALESCE(SUM(ss.portfolio_revenue_12m), 0)::float8 AS revenue,
               COUNT(ss.groupid)::int                            AS styles,
               COUNT(st.groupid)::int                            AS held_styles,
               MAX(tot.units)   AS total_units,
               MAX(tot.revenue) AS total_revenue,
               MAX(tot.styles)  AS total_styles,
               MAX(tot.held_styles) AS total_held_styles
        FROM unnest($1::numeric[]) AS b(bar)
        CROSS JOIN tot
        LEFT JOIN skusummary ss ON ss.portfolio_status = 'WINNERS' AND ss.portfolio_revenue_12m > b.bar
        LEFT JOIN stock st      ON st.groupid = ss.groupid
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
    const shareAt = (bar) => {
      const x = share.rows.find((r) => r.bar === bar);
      return { units: x ? x.units : 0, revenue: x ? Math.round(x.revenue * 100) / 100 : 0, styles: x ? x.styles : 0, held_styles: x ? x.held_styles : 0 };
    };
    const winnerBars = WINNER_BAR_LADDER.map((bar) => ({
      bar, shopify: atBar(shpBars.rows, bar), amazon: atBar(amzBars.rows, bar), share: shareAt(bar),
    }));
    const t = share.rows[0];
    const shareTotals = { units: t ? t.total_units : 0, revenue: t ? Math.round(t.total_revenue * 100) / 100 : 0, styles: t ? t.total_styles : 0,
                          held_styles: t ? t.total_held_styles : 0 };
    const updatedAt = shp.rows.map((x) => x.last_at).filter(Boolean).sort().pop() || null;

    return res.json({ return_code: 'SUCCESS', updated_at: updatedAt, statuses, winner_bars: winnerBars, share_totals: shareTotals });
  } catch (err) {
    logger.error('[pricing-status-overview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load status overview' });
  }
});

module.exports = router;
