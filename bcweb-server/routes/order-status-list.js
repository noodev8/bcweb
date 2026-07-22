/*
=======================================================================================================================================
API Route: order_status_list
=======================================================================================================================================
Method: GET
Purpose: The ON ORDER stage of the Order Status module — every supplier order (ordertype 2=local, 3=amazon) that has genuinely been
         PLACED and is now being waited on, grouped into "batches" the operator can act on together.

SCOPE — placed only. Rows still sitting in the TO PLACE queue (orderdate = '', chosen but never actually bought) are excluded and
belong to GET /order-status-to-place. This matters: before the two stages were split, an un-ordered row counted as "waiting 21 days",
which read as an overdue delivery when in fact nobody had ordered it. "On order" now means on order.

GROUPING KEY: (ordertype, placed-date) — the `orderdate` stamp, i.e. the day the order was actually put in with the supplier. NOT
`ponumber` (the owner is moving away from relying on it — operators may place several individual orders a day) and no longer
`createddate` (the day the rows were chosen, which fragments a single real order placed from several days' picks, and conversely
merges two separate orders that happened to be chosen on the same day). Both the legacy app and POST /order-status-place stamp the
whole placement with one shared value, so `orderdate` clusters a batch exactly as the order actually went out.

AGE is likewise days since PLACED, not days since chosen — that's the number you'd quote chasing a supplier. A row chosen on the 1st
and ordered on the 5th is 3 days late today, not 7.

`orderstatus` has one row PER UNIT (qty is always 1, duplicated lines — CLAUDE.md landmine), so batch totals are COUNT(*), and
"arrived"/"waiting" are COUNT(*) filtered on the arrived flag. Style/size breakdown joins skumap (code -> groupid, size = RIGHT(code,2)
per CLAUDE.md) and title (human name) so the operator can see WHAT was ordered, not just a SKU code.

Scope: only rows with arrived=0, OR arrived=1 within the last 30 days (createddate) — i.e. everything that could plausibly still be
on this screen given the legacy auto-cleanup windows (7d for arrived Amazon rows, 30d blanket). Older arrived rows are already gone
or about to be; no point surfacing them here.

DATES: every date is cast to text IN SQL. Never hand a pg DATE to Date.toISOString() — node-postgres parses it as local midnight and
the UTC conversion shifts the day back one under BST (this route used to do exactly that, showing every batch a day early).
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
      "placeddate": "2026-07-15",     // the day the order was actually placed with the supplier
      "placedtime": "13:09",          // time of day off the legacy stamp, so two orders placed on one day read apart
      "days": 7,                      // days since PLACED
      "ponumbers": ["158807"],
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
const { placed, placedDate } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { supplier } = req.query;
    if (!supplier) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'supplier is required' });
    }

    // placeddate/placedtime are derived from the legacy 'YYYYMMDD HH24:MI:SS' text stamp: the date via placedDate() (regex-guarded
    // to_date, so a malformed legacy value degrades to NULL rather than throwing), the time by slicing characters 10-14 out of the
    // string. days counts from the placed date, falling back to nothing when it couldn't be parsed.
    const result = await query(`
      SELECT o.ordernum, o.shopifysku AS code, o.ordertype, o.ponumber,
             COALESCE(o.arrived,0) AS arrived,
             ${placedDate()}::text AS placeddate,
             NULLIF(substring(o.orderdate from 10 for 5), '') AS placedtime,
             CURRENT_DATE - ${placedDate()} AS days,
             sm.groupid, t.shopifytitle AS title, RIGHT(o.shopifysku, 2) AS size
      FROM orderstatus o
      LEFT JOIN skumap sm ON sm.code = o.shopifysku
      LEFT JOIN title t   ON t.groupid = sm.groupid
      WHERE o.supplier = $1
        AND o.ordertype IN (2,3)
        AND ${placed()}
        AND (COALESCE(o.arrived,0) = 0 OR o.createddate >= CURRENT_DATE - 30)
      ORDER BY ${placedDate()} DESC NULLS LAST, o.ordertype, sm.groupid, size
    `, [supplier]);

    // Group rows into batches keyed by (ordertype, placed date). Map preserves first-seen order (already date-desc from the query).
    const batchMap = new Map();
    for (const r of result.rows) {
      const key = `${r.ordertype}|${r.placeddate}`;
      if (!batchMap.has(key)) {
        batchMap.set(key, {
          ordertype: r.ordertype,
          placeddate: r.placeddate,
          placedtime: r.placedtime || null,
          days: r.days === null ? null : Number(r.days),
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
