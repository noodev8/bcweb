/*
=======================================================================================================================================
API Route: order_status_list
=======================================================================================================================================
Method: GET
Purpose: Stage 1 of the Order Status module — every open-or-recent SUPPLIER order (ordertype 2=local, 3=amazon) for one supplier,
         grouped into "batches" the operator can act on together.

Grouping key: (ordertype, createddate) — NOT ponumber. `ponumber` looks like a natural order id, but the owner is moving away from
relying on it (operators may place several individual orders a day rather than one batch PO), so it is surfaced as a detail field
only. `createddate` is the day the rows were written into orderstatus and is always populated, so grouping on it naturally clusters
"today's order for this supplier" together regardless of whether it came from one PO or several.

`orderstatus` has one row PER UNIT (qty is always 1, duplicated lines — CLAUDE.md landmine), so batch totals are COUNT(*), and
"arrived"/"waiting" are COUNT(*) filtered on the arrived flag. Style/size breakdown joins skumap (code -> groupid, size = RIGHT(code,2)
per CLAUDE.md) and title (human name) so the operator can see WHAT was ordered, not just a SKU code.

Scope: only rows with arrived=0, OR arrived=1 within the last 30 days (createddate) — i.e. everything that could plausibly still be
on this screen given the legacy auto-cleanup windows (7d for arrived Amazon rows, 30d blanket). Older arrived rows are already gone
or about to be; no point surfacing them here.
=======================================================================================================================================
Request Query Params:
  supplier  (string, required)
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "supplier": "Lunar",
  "batches": [
    {
      "ordertype": 3,
      "createddate": "2026-07-13",
      "days": 8,
      "ponumbers": ["140832"],
      "total": 43,
      "arrived": 27,
      "waiting": 16,
      "lines": [
        { "ordernum": "AMZ-O-WS7-4515", "code": "40713-FRISCO-KHAKI-05", "groupid": "40713-FRISCO-KHAKI", "title": "...",
          "size": "05", "arrived": 0, "ponumber": "158807" },
        ...
      ]
    }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { supplier } = req.query;
    if (!supplier) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'supplier is required' });
    }

    const result = await query(`
      SELECT o.ordernum, o.shopifysku AS code, o.ordertype, o.createddate, o.ponumber,
             COALESCE(o.arrived,0) AS arrived,
             sm.groupid, t.shopifytitle AS title, RIGHT(o.shopifysku, 2) AS size
      FROM orderstatus o
      LEFT JOIN skumap sm ON sm.code = o.shopifysku
      LEFT JOIN title t   ON t.groupid = sm.groupid
      WHERE o.supplier = $1
        AND o.ordertype IN (2,3)
        AND (COALESCE(o.arrived,0) = 0 OR o.createddate >= CURRENT_DATE - 30)
      ORDER BY o.createddate DESC, o.ordertype, sm.groupid, size
    `, [supplier]);

    // Group rows into batches keyed by (ordertype, createddate). Map preserves first-seen order (already date-desc from the query).
    const batchMap = new Map();
    for (const r of result.rows) {
      const dateStr = r.createddate ? r.createddate.toISOString().slice(0, 10) : null;
      const key = `${r.ordertype}|${dateStr}`;
      if (!batchMap.has(key)) {
        batchMap.set(key, {
          ordertype: r.ordertype,
          createddate: dateStr,
          days: dateStr ? Math.floor((Date.now() - new Date(dateStr + 'T00:00:00Z').getTime()) / 86400000) : null,
          ponumbers: new Set(),
          total: 0,
          arrived: 0,
          waiting: 0,
          lines: [],
        });
      }
      const batch = batchMap.get(key);
      if (r.ponumber) batch.ponumbers.add(r.ponumber);
      batch.total += 1;
      if (Number(r.arrived) > 0) batch.arrived += 1; else batch.waiting += 1;
      batch.lines.push({
        ordernum: r.ordernum,
        code: r.code,
        groupid: r.groupid,
        title: r.title || null,
        size: r.size,
        arrived: Number(r.arrived) > 0,
        ponumber: r.ponumber || null,
      });
    }

    const batches = Array.from(batchMap.values()).map((b) => ({ ...b, ponumbers: Array.from(b.ponumbers) }));

    return res.json({ return_code: 'SUCCESS', supplier, batches });
  } catch (err) {
    logger.error('[order-status-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load order list' });
  }
});

module.exports = router;
