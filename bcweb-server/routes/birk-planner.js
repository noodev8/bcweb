/*
=======================================================================================================================================
API Route: birk_planner
=======================================================================================================================================
Method: GET
Purpose: Birkenstock module — the PLANNER (port of the legacy screen's Planner button). One style's still-to-come Birkenstock units,
         broken down by DELIVERY MONTH and size: the operator picks a line on /birkenstock and this says WHEN the stock they already
         have on order actually turns up.

         Requires auth. Read-only.

WHY IT MATTERS: the /birkenstock grid's FULL switch says "35 more are coming" for a style, which is enough to stop an over-order but
not enough to plan. Three units in May and thirty-two in August is a different season from thirty-five in May. This route is the month
axis behind that one number — same source (birktracker), same arithmetic, one level finer.

STILL TO COME ONLY (owner, 2026-09-04): every figure is requested MINUS arrived, floored at 0 — exactly what the FULL switch adds to a
style's Stock, so the two always reconcile. A month whose delivery has fully landed therefore shows NOTHING: those units are on the
shelf and already counted in the grid behind the panel. That is the deliberate trade — the Planner is a forward view, not the season's
delivery history. Showing raw `requested` instead would double-count landed stock against a grid the operator is reading at the
same time.

THE MONTH IS `birktracker.due` — a bare 3-letter code ('MAY', 'SEP'), with NO year on it. Birkenstock's order book runs a season at a
time and the code is all the supplier gives, so the client orders the months SEPTEMBER -> AUGUST (the season year, as the legacy
Planner did) rather than pretending to know a calendar date. A line with no due code at all is returned under due = '' and the client
shows it as "Unscheduled" — none exist today, but a blank is a legitimate state on a legacy free-text column.

ONLY MONTHS WITH UNITS ARE RETURNED. The legacy Planner drew all twelve rows whether or not anything was due; here the panel opens
INSIDE the grid, underneath the style's own row, so nine empty month rows would push the sheet apart for nothing. The client renders
what comes back, in season order.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  groupid   REQUIRED — the style to plan (skusummary.groupid)

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0034703-MILANO",
  "total": 35,                                  // still-to-come units across every month; equals what FULL adds to this style's Stock
  "months": [
    { "due": "MAY", "units": 13, "sizes": { "35": 1, "36": 1, "37": 2, "38": 3, "39": 3, "40": 3 } },
    { "due": "JUN", "units": 15, "sizes": { ... } },
    { "due": "JUL", "units": 7,  "sizes": { ... } }
  ]
}
  - months carry ONLY the sizes with units due that month (a size with none is simply absent) — the client already holds the style's
    full size range from the list payload and draws the columns from that, so repeating the zeroes here would be dead weight.
  - `months` is returned in the order the rows came out; the client sorts into season order (September -> August).
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
    const groupid = (req.query.groupid || '').trim();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    // One row per (month, size) with anything still outstanding. Joined through skumap the same way the list route is: birktracker.code
    // is already our own code grain, so the size is its last dash-segment and the style is skumap's groupid. The HAVING drops sizes
    // that have fully landed, which is what keeps the panel to the months that still matter.
    const result = await query(
      `SELECT COALESCE(UPPER(TRIM(b.due)), '') AS due,
              substring(m.code from '[^-]+$')  AS sz,
              SUM(GREATEST(COALESCE(b.requested, 0) - COALESCE(b.arrived, 0), 0)) AS units
         FROM birktracker b
         JOIN skumap m ON m.code = b.code
        WHERE m.groupid = $1
        GROUP BY 1, 2
       HAVING SUM(GREATEST(COALESCE(b.requested, 0) - COALESCE(b.arrived, 0), 0)) > 0`,
      [groupid]
    );

    // Fold (month, size) rows into one entry per month. Built in a Map so a month keeps its own size bag and its own total, and so the
    // shape is stable whether the style has one delivery or five.
    const byMonth = new Map();
    let total = 0;
    for (const r of result.rows) {
      const units = Number(r.units) || 0;
      if (units <= 0) continue;
      const due = r.due || '';
      if (!byMonth.has(due)) byMonth.set(due, { due, units: 0, sizes: {} });
      const month = byMonth.get(due);
      month.sizes[r.sz] = (month.sizes[r.sz] || 0) + units;
      month.units += units;
      total += units;
    }

    return res.json({ return_code: 'SUCCESS', groupid, total, months: [...byMonth.values()] });
  } catch (err) {
    logger.error('[birk-planner] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the planner' });
  }
});

module.exports = router;
