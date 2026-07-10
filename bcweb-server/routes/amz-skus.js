/*
=======================================================================================================================================
API Route: amz_skus
=======================================================================================================================================
Method: GET
Purpose: The heart of the Amazon Pricing screen — one row PER SKU (per size) for a segment, each carrying its raw performance signals
         AND a computed suggested move (🟢 CREEP/DROP/REVERT the operator can accept in one click, 🟡 a flagged judgment call, ⚪ hold).
         Amazon prices per size (each size is its own SKU), so unlike the Shopify triage this is deliberately SKU-grain, not groupid.
         Both price directions live in one list (a colour can have a dead-pile size to cut AND a scarce size to harvest up), so there
         is no WINNERS|LOSERS split — the suggestion column carries the direction.

  - The per-SKU signals come from utils/amzSkuState.js (shared with /amz-segments so the list and the chip counts never drift).
  - The suggestion comes from utils/amzSuggest.js (a faithful port of AMZ_FULL_REVIEW.md's 🟢/🟡/⚪ classifier).
  - Rows are ordered actionable-first (green, then amber, then hold) so the work sits at the top; within a tier, busier/riskier first.

Read-only. FBA data (amzfeed) is never written here (nightly-refreshed from Amazon). No price is changed — that is POST /amz-apply.
=======================================================================================================================================
Request Query Params:
  segment  (string, optional)  - scope to one skusummary.segment; omit or 'all' for every managed SKU (the "All" chip).

Success Response:
{
  "return_code": "SUCCESS",
  "segment": "IVES-WHITE",        // echoes the filter; null for all
  "counts": { "green": 3, "amber": 2, "white": 2, "total": 7 },
  "rows": [
    {
      "code": "FLE030-IVES-WHITE-04", "amz_sku": "AD-0XF8D-48L", "groupid": "FLE030-IVES-WHITE", "segment": "IVES-WHITE",
      "size": "04", "title": "...",
      "current_price": 37.99, "cost": 15.99, "rrp": 45.00, "fbafee": 3.06,
      "fba_live": 96, "fba_inbound": 0, "sold_7d": 4, "sold_14d": 9, "returns_14d": 1, "return_rate": 0.11,
      "days_since_sale": 0, "days_since_change": 5, "last_direction": "creep", "last_sold": "2026-07-08",
      "suggestion": { "tier": "green", "action": "creep", "target": 38.29, "why": "creep 0.30 — 4u/7d" }
    }, ...
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
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { getSkuState, coerce } = require('../utils/amzSkuState');
const { classify } = require('../utils/amzSuggest');

router.use(verifyToken);

// Sort actionable rows to the top: green, then amber, then hold. Within green/amber, MOST FBA STOCK first — one rule that reads
// sensibly in both directions (biggest pile to clear on a drop, most units to harvest on a creep), tie-broken by 7d velocity. Holds
// fall to the bottom in their query order (segment, then size).
const TIER_RANK = { green: 0, amber: 1, white: 2 };

router.get('/', async (req, res) => {
  try {
    const segParam = req.query.segment;
    const segment = !segParam || segParam === 'all' ? null : String(segParam);

    const raw = await getSkuState(segment);

    const rows = raw.map((r0) => {
      const r = coerce(r0);
      const s = classify(r);
      return {
        code: r.code,
        amz_sku: r.amz_sku,
        groupid: r.groupid,
        segment: r.segment,
        size: r.size,
        title: r.title,
        current_price: r.current_price,
        cost: r.cost,
        rrp: r.rrp,
        fbafee: r.fbafee,
        fba_live: r.fba_live,
        fba_inbound: r.fba_inbound,
        sold_7d: r.sold_7d,
        sold_14d: r.sold_14d,
        returns_14d: r.returns_14d,
        return_rate: Math.round(s.return_rate * 100) / 100,
        days_since_sale: r.days_since_sale,
        days_since_change: r.days_since_change,
        last_direction: r.last_direction,
        last_sold: r.last_sold,
        suggestion: { tier: s.tier, action: s.action, target: s.target, why: s.why },
      };
    });

    rows.sort((a, b) => {
      const t = TIER_RANK[a.suggestion.tier] - TIER_RANK[b.suggestion.tier];
      if (t !== 0) return t;
      if (a.suggestion.tier === 'white') return 0; // keep holds in query (segment/size) order
      if (b.fba_live !== a.fba_live) return b.fba_live - a.fba_live; // most stock at stake first
      return b.sold_7d - a.sold_7d;                                  // tie-break: busier first
    });

    const counts = { green: 0, amber: 0, white: 0, total: rows.length };
    for (const r of rows) counts[r.suggestion.tier]++;

    return res.json({ return_code: 'SUCCESS', segment, counts, rows });
  } catch (err) {
    logger.error('[amz-skus] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Amazon SKU list' });
  }
});

module.exports = router;
