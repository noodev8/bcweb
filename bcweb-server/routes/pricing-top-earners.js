/*
=======================================================================================================================================
API Route: pricing_top_earners
=======================================================================================================================================
Method: GET
Purpose: The Repricing screen's Top earners tab (owner, 2026-09-23 — first a row pinned above the segments, then its own tab, then
         two channel CARDS). ONE row in the shape GET /segments returns, plus per-cell extras the cards need: the due count split
         Selling / Stuck, and that channel's own revenue + GP. Its cells open the ordinary WINNERS / LOSERS lists scoped by
         ?topearners= (pricing-triage / pricing-losers on Shopify, amz-winners / amz-losers on Amazon). Requires auth. Read-only.

WHAT A TOP EARNER IS: a style whose revenue ON THAT CHANNEL cleared the portfolio winner bar over the rolling 12 months — the Winners
screen's test, read per channel (utils/portfolio.js → topEarnerGroupidsSql, which has the argument). So the Shopify cell counts
Shopify top earners and the Amazon cell counts the SKUs of Amazon top earners; a style is in one or the other in practice (no winner
was genuinely split between channels when this was built).

WHY IT IS NOT A THIRD SWITCH OPTION: it is one group, not a set of groups, so a "Top earners" view would be a one-row table. Pinned
above the segments/campaigns it is always one click away without hiding the rest.

THE TWO VIEWS (?by=):
  segment  (default) — Shopify + Amazon cells; revenue/GP over ALL channels, for styles that are a top earner on either channel
                       (matches the segment rows, whose gutter is all-channel).
  campaign           — Shopify cell only; revenue/GP over SHOPIFY sales of Shopify top earners (matches the campaign rows, whose
                       gutter is Shopify-only because a campaign drives nothing else).
No `off` flag and no Housekeeping cell: both are per-segment decisions (segment_area_state) that don't exist for this group.
=======================================================================================================================================
Request Query Params:
  days  (int, optional)     - revenue/GP lookback window in days; default 30.
  by    (string, optional)  - 'campaign' for the campaign view's row; anything else = the segment view's row.

Success Response:
{
  "return_code": "SUCCESS",
  "days": 30,
  "row": {
    "name": "Top earners",
    "revenue30": 21480.10,
    "gpPct": 38,
    "heat": null,
    "areas": [
      { "area": "Shopify", "cadenceDays": 0, "dueState": "due", "daysOverdue": 0, "outstanding": 19, "instock": 30,
        "selling": 12, "stuck": 7,                 // outstanding split by list (Selling = WINNERS, Stuck = LOSERS)
        "revenue30": 14210.55, "gpPct": 58,        // THIS channel's sales of THIS channel's top earners, over the window
        "nextReview": null, "lastWorkedBy": null, "lastWorkedAt": null },
      { "area": "Amazon", ... }    // segment view only
    ]
  }
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
const { safeNumeric } = require('../utils/sql');
const { deriveShopify } = require('../utils/segmentDerived');
const { shopifyActionableByGroup } = require('../utils/shopifyActionable');
const { amazonActionableByGroup } = require('../utils/amazonActionable');
const { topEarnerGroupidsSql } = require('../utils/portfolio');
const { groupColumn, TOP_EARNERS_NAME } = require('../utils/pricingGroup');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Revenue / GP% from summed revenue + COGS (COGS null when every cost was junk).
function gutter(revenue, cogs) {
  const rev = Number(revenue) || 0;
  const c = cogs === null || cogs === undefined ? null : Number(cogs);
  return { revenue30: Math.round(rev * 100) / 100, gpPct: rev > 0 && c !== null ? Math.round(((rev - c) / rev) * 100) : null };
}

// One derived cell in the SegmentAreaCell shape, plus the cards' extras. No `off` for this group (see header).
function cell(area, counts, money) {
  const d = deriveShopify(counts, false);
  return {
    area,
    selling: d.dueState === 'due' ? Number(counts && counts.selling) || 0 : 0,
    stuck: d.dueState === 'due' ? Number(counts && counts.stuck) || 0 : 0,
    revenue30: money.revenue30,
    gpPct: money.gpPct,
    cadenceDays: 0,              // derived clocks have no cadence
    dueState: d.dueState,
    daysOverdue: 0,
    nextReview: d.nextReview,
    outstanding: d.outstanding,
    instock: d.instock,
    lastWorkedBy: null,
    lastWorkedAt: null,
  };
}

router.get('/', async (req, res) => {
  try {
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 30;
    const isCampaign = req.query.by === 'campaign';

    // 1) Revenue / COGS gutter over the window. Membership + channel filter depend on the view (see header). Both SQL fragments come
    //    from fixed helpers, never the request.
    const members = isCampaign
      ? topEarnerGroupidsSql('SHP')
      : `${topEarnerGroupidsSql('SHP')} UNION ${topEarnerGroupidsSql('AMZ')}`;
    const rev = await query(`
      SELECT SUM(s.qty * s.soldprice)                AS revenue,
             SUM(s.qty * ${safeNumeric('ss.cost')})  AS cogs
      FROM sales s
      JOIN skusummary ss ON ss.groupid = s.groupid
      WHERE s.groupid IN (${members})
        AND s.qty > 0 AND s.soldprice > 0
        AND s.solddate >= CURRENT_DATE - $1::int
        ${isCampaign ? "AND s.channel = 'SHP'" : ''}
    `, [days]);
    const { revenue30, gpPct } = gutter(rev.rows[0] && rev.rows[0].revenue, rev.rows[0] && rev.rows[0].cogs);

    // 1b) Per-channel money for the cards: each channel's OWN sales of its OWN top earners (a Shopify card shouldn't carry Amazon
    //     revenue of the same style). Same predicates as the row gutter above.
    const byCh = await query(`
      SELECT s.channel,
             SUM(s.qty * s.soldprice)                AS revenue,
             SUM(s.qty * ${safeNumeric('ss.cost')})  AS cogs
      FROM sales s
      JOIN skusummary ss ON ss.groupid = s.groupid
      WHERE ( (s.channel = 'SHP' AND s.groupid IN (${topEarnerGroupidsSql('SHP')}))
           OR (s.channel = 'AMZ' AND s.groupid IN (${topEarnerGroupidsSql('AMZ')})) )
        AND s.qty > 0 AND s.soldprice > 0
        AND s.solddate >= CURRENT_DATE - $1::int
      GROUP BY s.channel
    `, [days]);
    const money = (ch) => {
      const r = byCh.rows.find((x) => x.channel === ch);
      return gutter(r && r.revenue, r && r.cogs);
    };

    // 2) The derived cells — the SAME counts the segment heatmap uses, grouped by the Top-earners column instead. Everything that
    //    isn't a top earner lands in the NULL group, which is simply not read.
    const [shp, amz] = await Promise.all([
      shopifyActionableByGroup(groupColumn('topearners', { alias: 'ss', channel: 'SHP' })),
      isCampaign ? null : amazonActionableByGroup(groupColumn('topearners', { alias: 'sk', channel: 'AMZ' })),
    ]);

    const areas = [cell('Shopify', shp.get(TOP_EARNERS_NAME), money('SHP'))];
    if (amz) areas.push(cell('Amazon', amz.get(TOP_EARNERS_NAME), money('AMZ')));

    return res.json({
      return_code: 'SUCCESS',
      days,
      row: { name: TOP_EARNERS_NAME, revenue30, gpPct, heat: null, areas },
    });
  } catch (err) {
    logger.error('[pricing-top-earners] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load top earners' });
  }
});

module.exports = router;
