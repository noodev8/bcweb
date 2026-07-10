/*
=======================================================================================================================================
API Route: amz_segments
=======================================================================================================================================
Method: GET
Purpose: The segment chips for the Amazon Pricing screen. Each managed segment (one that has live amzfeed rows we can price) becomes a
         chip carrying a needs-attention badge and, for context, its recent Amazon performance. Selecting a chip is the delegation
         primitive — it bounds the whole screen (and a shareable ?segment= URL) to that segment. The "All" chip is derived client-side
         by summing these rows, so this endpoint returns per-segment rows only.

  - attention_count = number of SKUs in the segment the engine flags 🟢 or 🟡 (a real move suggested). Computed by running the SAME
    per-SKU classifier the list uses (utils/amzSkuState + amzSuggest) across all managed SKUs, so a chip's badge can never disagree
    with the list you see after clicking it.
  - units_90d / profit_90d / last_sold give the "where is attention owed" context (a big earner with 0 attention is fine; a big
    earner going quiet is not). 90 days mirrors the coverage snapshot in AMZ_PRICING.md.

Read-only; amzfeed is never written.
=======================================================================================================================================
Request Query Params: none

Success Response:
{
  "return_code": "SUCCESS",
  "rows": [
    { "segment": "IVES-WHITE", "sku_count": 7, "attention_count": 4, "green": 3, "amber": 1,
      "units_90d": 812, "profit_90d": 9123, "last_sold": "2026-07-08" }, ...
  ]  // ordered: most attention first, then biggest 90d earner
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
const { getSkuState, coerce } = require('../utils/amzSkuState');
const { classify } = require('../utils/amzSuggest');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // 1) Per-SKU classification across ALL managed SKUs → per-segment sku_count + attention counts (same engine as the list).
    const raw = await getSkuState(null);
    const bySeg = new Map();
    for (const r0 of raw) {
      const r = coerce(r0);
      const s = classify(r);
      let acc = bySeg.get(r.segment);
      if (!acc) { acc = { segment: r.segment, sku_count: 0, green: 0, amber: 0 }; bySeg.set(r.segment, acc); }
      acc.sku_count++;
      if (s.tier === 'green') acc.green++;
      else if (s.tier === 'amber') acc.amber++;
    }

    // 2) 90-day Amazon performance per segment (context for the chip). Left-merged onto the SKU-backed segment set so a segment with
    //    stock but no recent sales still shows (units 0), and stray sales under a segment with no amzfeed rows are ignored.
    const perf = await query(`
      SELECT sk.segment,
             SUM(CASE WHEN s.qty>0 THEN s.qty ELSE 0 END)::int AS units_90d,
             ROUND(SUM(s.profit)::numeric, 0)                  AS profit_90d,
             MAX(CASE WHEN s.qty>0 THEN s.solddate END)        AS last_sold
      FROM sales s
      JOIN skusummary sk ON s.groupid = sk.groupid
      WHERE s.channel='AMZ' AND s.solddate >= CURRENT_DATE - 90
        AND sk.segment IS NOT NULL AND sk.segment <> ''
      GROUP BY sk.segment
    `);
    const perfBySeg = new Map();
    for (const p of perf.rows) {
      perfBySeg.set(p.segment, {
        units_90d: Number(p.units_90d) || 0,
        profit_90d: p.profit_90d == null ? null : Number(p.profit_90d),
        last_sold: p.last_sold ? String(p.last_sold).slice(0, 10) : null,
      });
    }

    const rows = [...bySeg.values()].map((acc) => {
      const pf = perfBySeg.get(acc.segment) || { units_90d: 0, profit_90d: null, last_sold: null };
      return {
        segment: acc.segment,
        sku_count: acc.sku_count,
        attention_count: acc.green + acc.amber,
        green: acc.green,
        amber: acc.amber,
        units_90d: pf.units_90d,
        profit_90d: pf.profit_90d,
        last_sold: pf.last_sold,
      };
    });

    // Most attention first (that is what the screen is for); tie-break by biggest recent earner.
    rows.sort((a, b) => b.attention_count - a.attention_count || b.units_90d - a.units_90d);

    return res.json({ return_code: 'SUCCESS', rows });
  } catch (err) {
    logger.error('[amz-segments] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Amazon segments' });
  }
});

module.exports = router;
