/*
=======================================================================================================================================
API Route: pricing_campaigns
=======================================================================================================================================
Method: GET
Purpose: The Segments screen's CAMPAIGN view (owner, 2026-09-23) — the same front door, grouped by Google campaign instead of segment.
         One row per campaign bucket in use, with a Shopify revenue/GP gutter and the derived Shopify cell, in exactly the shape GET
         /segments returns so the page renders both views with the same table. Clicking a row opens the ordinary Shopify WINNERS /
         LOSERS lists scoped by ?campaign= (pricing-triage / pricing-losers). Requires auth. Read-only.

WHAT A "CAMPAIGN" IS HERE: our bucket — skusummary.googlecampaign (TRIMmed), the label google-ads-assign writes and the feed ships as
custom_label_0. NOT Google's own campaign entities (google_campaign_daily); see the google-ads-campaigns header for why those differ.
Membership is TODAY's label: a style moved on the Google Ads screen moves list immediately here, a day before Google sees it.

WHAT'S LEFT OUT, AND WHY (owner, 2026-09-23):
  - SHOPIFY ONLY. Google Shopping advertises the Shopify site, so there is no Amazon cell and no Amazon list by campaign.
  - No Housekeeping cell. That is a manual clock that only exists per segment (segment_area_state).
  - `pause` and blank buckets are hidden. Blank = not in Google at all; pause = deliberately pulled out. Neither is a campaign
    anyone prices "for". The list routes still accept ?campaign=pause if asked directly — this is only the front door.
  - Styles not live on Shopify (shopify <> 1) don't count, matching the Google Ads screen's bucket membership.

Only buckets that currently hold at least one live style appear — an empty bucket has nothing to price. Archived buckets that still
hold styles DO appear: the styles are still in them, and archiving only stops new assignments.

The revenue gutter is SHOPIFY revenue (channel SHP), unlike GET /segments which sums all channels — a campaign drives Shopify sales
only, so an all-channel figure would credit it with Amazon money it had nothing to do with. The page labels the column accordingly.
=======================================================================================================================================
Request Query Params:
  days  (int, optional)  - revenue/GP lookback window in days; default 30.

Success Response:
{
  "return_code": "SUCCESS",
  "days": 30,
  "campaigns": [
    {
      "name": "standard",
      "revenue30": 18211.40,     // Shopify revenue over the window, styles currently in this bucket
      "gpPct": 41,               // (revenue − COGS) / revenue, null when no revenue
      "heat": null,
      "areas": [                 // exactly one cell — Shopify — in the SegmentAreaCell shape
        { "area": "Shopify", "cadenceDays": 0, "dueState": "due", "daysOverdue": 0, "outstanding": 12, "instock": 30,
          "nextReview": null, "lastWorkedBy": null, "lastWorkedAt": null }
      ]
    },
    ...  // ordered by revenue30 desc
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
const { safeNumeric } = require('../utils/sql');
const { deriveShopify } = require('../utils/segmentDerived');
const { shopifyActionableByGroup } = require('../utils/shopifyActionable');
const { GROUP_COLUMNS } = require('../utils/pricingGroup');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Buckets the front door never shows (compared upper-case). Blank is filtered separately.
const HIDDEN_BUCKETS = ['PAUSE'];

router.get('/', async (req, res) => {
  try {
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 30;

    // 1) The buckets in use + their Shopify revenue/COGS gutter, in one pass. LEFT JOIN so a bucket with no sales in the window still
    //    appears (revenue 0) — it may well be all losers, which is exactly what someone would open it to work on.
    const groups = await query(`
      WITH members AS (
        SELECT ss.groupid, ${GROUP_COLUMNS.campaign} AS name, ${safeNumeric('ss.cost')} AS cost
        FROM skusummary ss
        WHERE ss.shopify = 1
          AND COALESCE(${GROUP_COLUMNS.campaign}, '') <> ''
          AND UPPER(${GROUP_COLUMNS.campaign}) <> ALL($2::text[])
      ),
      rev AS (
        SELECT s.groupid, SUM(s.qty * s.soldprice) AS revenue, SUM(s.qty) AS units
        FROM sales s
        WHERE s.channel = 'SHP' AND s.qty > 0 AND s.soldprice > 0
          AND s.solddate >= CURRENT_DATE - $1::int
        GROUP BY s.groupid
      )
      SELECT m.name,
             COALESCE(SUM(r.revenue), 0)   AS revenue,
             SUM(r.units * m.cost)          AS cogs
      FROM members m
      LEFT JOIN rev r ON r.groupid = m.groupid
      GROUP BY m.name
    `, [days, HIDDEN_BUCKETS]);

    // 2) The derived Shopify cell per bucket — the SAME count the segment heatmap uses, grouped by campaign instead.
    const shopifyByName = await shopifyActionableByGroup(GROUP_COLUMNS.campaign);

    const campaigns = groups.rows.map((g) => {
      const revenue = Number(g.revenue) || 0;
      const cogs = g.cogs === null ? null : Number(g.cogs);
      const gpPct = revenue > 0 && cogs !== null ? Math.round(((revenue - cogs) / revenue) * 100) : null;
      const d = deriveShopify(shopifyByName.get(g.name), false);   // no `off` flag for a campaign — that is a per-segment decision
      return {
        name: g.name,
        revenue30: Math.round(revenue * 100) / 100,
        gpPct,
        heat: null,
        areas: [{
          area: 'Shopify',
          cadenceDays: 0,              // derived clocks have no cadence
          dueState: d.dueState,
          daysOverdue: 0,
          nextReview: d.nextReview,
          outstanding: d.outstanding,
          instock: d.instock,
          lastWorkedBy: null,
          lastWorkedAt: null,
        }],
      };
    }).sort((a, b) => b.revenue30 - a.revenue30);

    return res.json({ return_code: 'SUCCESS', days, campaigns });
  } catch (err) {
    logger.error('[pricing-campaigns] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load campaigns overview' });
  }
});

module.exports = router;
