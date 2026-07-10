/*
=======================================================================================================================================
API Route: segments
=======================================================================================================================================
Method: GET
Purpose: Step 3 of the Segments module (docs/segments-spec.md §3, §5) — the overview "heatmap" read. Returns one row per ACTIVE
         segment with a live importance gutter (revenue + gross-profit %) and, for each work area, that review clock's due state.
         This is the front door that answers "which segment do I click and work on next".

Self-healing (spec §6-A): the read runs the reconcile FIRST, so a newly-tagged segment (or a newly-added area) shows up with its
clocks already seeded — no separate maintenance step. Reconcile is best-effort: if it fails we log and still serve the current
registry rather than blank the whole dashboard.

Importance gutter (spec §3): revenue/GP are computed LIVE, never stored. Revenue = SUM(qty × soldprice) over the window across ALL
channels (SHP + AMZ + …) — a segment's total worth, not just its Shopify slice — because one of the three areas is Amazon and ~46%
of units sell there. GP% = (revenue − COGS)/revenue, COGS = SUM(qty × skusummary.cost). Cost is a legacy VARCHAR → safeNumeric.

Due state per area (spec §4): from segment_area_state.next_review_date vs CURRENT_DATE —
  off    (grey)  = off = true (operator flagged this area N/A for this segment, e.g. EVA-SEG on Amazon) — checked first,
                   independent of the date, so a stale next_review_date underneath doesn't leak through
  overdue(red)   = next_review_date < today OR next_review_date IS NULL (never worked → straight to overdue, no separate
                   "never" state) → daysOverdue = today − next_review_date, or 0 when never worked (no baseline date)
  due-soon(amber)= due within AMBER_DAYS (incl. today)
  ok     (green) = further out
Last-worked (who/when) is the most recent segment_worklog row for that (segment, area).

Heat (🔥) is a deferred fast-follow (spec §3/§7) — returned as null for now.
=======================================================================================================================================
Request Query Params:
  days  (int, optional)  - revenue/GP lookback window in days; default 30 (matches the gutter label "Rev(30d)").

Success Response:
{
  "return_code": "SUCCESS",
  "days": 30,
  "segments": [
    {
      "name": "EVA-SEG",
      "revenue30": 9314.74,
      "gpPct": 44,
      "heat": null,
      "areas": [
        { "area": "Shopify", "cadenceDays": 30, "dueState": "overdue", "daysOverdue": 0,
          "nextReview": null, "lastWorkedBy": null, "lastWorkedAt": null },   // never worked → overdue, daysOverdue 0
        ...  // ordered by area.sort
      ]
    },
    ...  // ordered by revenue30 desc (importance); client may re-sort by worst-overdue
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
const { withTransaction } = require('../utils/transaction');
const { reconcileSegments } = require('../utils/segmentReconcile');
const { safeNumeric } = require('../utils/sql');
const { classifyDue, isoDate } = require('../utils/segmentDue');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 30;

    // 1) Self-heal the registry (best-effort — never let a reconcile hiccup blank the dashboard).
    try {
      await withTransaction((client) => reconcileSegments(client));
    } catch (recErr) {
      logger.warn('[segments] reconcile failed, serving current registry:', recErr.message);
    }

    // 2) Importance gutter — live revenue + COGS per segment, all channels, over the window. Keyed by segment name.
    const rev = await query(`
      SELECT ss.segment AS name,
             SUM(s.qty * s.soldprice)                 AS revenue,
             SUM(s.qty * ${safeNumeric('ss.cost')})   AS cogs
      FROM sales s
      JOIN skusummary ss ON ss.groupid = s.groupid
      WHERE s.qty > 0 AND s.soldprice > 0
        AND s.solddate >= CURRENT_DATE - $1::int
      GROUP BY ss.segment
    `, [days]);

    const revByName = new Map();
    for (const r of rev.rows) {
      const revenue = r.revenue === null ? 0 : Number(r.revenue);
      const cogs = r.cogs === null ? null : Number(r.cogs);
      const gpPct = revenue > 0 && cogs !== null ? Math.round(((revenue - cogs) / revenue) * 100) : null;
      revByName.set(r.name, { revenue30: Math.round(revenue * 100) / 100, gpPct });
    }

    // 3) Clocks + last-worked for every ACTIVE segment × ACTIVE area. One set-based query (no N+1), ordered for assembly.
    const clocks = await query(`
      SELECT s.name AS segment, a.name AS area, a.sort,
             st.cadence_days,
             st.next_review_date,
             st.off,
             (CURRENT_DATE - st.next_review_date) AS days_over,
             lw.worked_by AS last_worked_by,
             lw.worked_at AS last_worked_at
      FROM segment s
      JOIN segment_area_state st ON st.segment_id = s.id
      JOIN area a ON a.id = st.area_id AND a.active = true
      LEFT JOIN LATERAL (
        SELECT worked_by, worked_at
        FROM segment_worklog w
        WHERE w.segment_id = s.id AND w.area_id = a.id
        ORDER BY w.worked_at DESC
        LIMIT 1
      ) lw ON true
      WHERE s.active = true
      ORDER BY s.name, a.sort
    `);

    // 4) Assemble: group clock rows by segment, attach the live gutter, compute due state.
    const bySegment = new Map();
    for (const c of clocks.rows) {
      if (!bySegment.has(c.segment)) {
        const gutter = revByName.get(c.segment) || { revenue30: 0, gpPct: null };
        bySegment.set(c.segment, { name: c.segment, revenue30: gutter.revenue30, gpPct: gutter.gpPct, heat: null, areas: [] });
      }
      const daysOver = c.days_over === null ? null : Number(c.days_over);
      bySegment.get(c.segment).areas.push({
        area: c.area,
        cadenceDays: c.cadence_days,
        dueState: classifyDue(daysOver, c.off),
        daysOverdue: daysOver !== null && daysOver > 0 ? daysOver : 0,
        nextReview: isoDate(c.next_review_date),
        lastWorkedBy: c.last_worked_by || null,
        lastWorkedAt: c.last_worked_at ? c.last_worked_at.toISOString() : null,
      });
    }

    // Default order = importance (revenue desc); the client can offer a "worst-overdue" re-sort (spec §3).
    const segments = Array.from(bySegment.values()).sort((a, b) => b.revenue30 - a.revenue30);

    return res.json({ return_code: 'SUCCESS', days, segments });
  } catch (err) {
    logger.error('[segments] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load segments overview' });
  }
});

module.exports = router;
