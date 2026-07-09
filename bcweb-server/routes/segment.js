/*
=======================================================================================================================================
API Route: segment
=======================================================================================================================================
Method: GET
Purpose: Step 4 of the Segments module (docs/segments-spec.md §3, §5) — the DETAIL read behind clicking a segment name on the
         overview heatmap. Returns the segment's header stats, its per-area review clocks, and its recent work-log history
         (who / when / note) — the attention history made visible, so an operator (or a delegate) can see what's been done.

Shape mirrors GET /segments for the header + clocks (same live all-channel revenue/GP, same due-state classification via
utils/segmentDue), then adds:
  - stats.stock  : current SELLABLE stock across the segment (localstock #FREE, not deleted, qty>0 — never skusummary.stockvariants).
  - stats.styles : number of styles (skusummary rows) in the segment.
  - worklog[]    : recent work events across all areas, newest first, MOST-RECENT-N (lazy, like pricing-history) — sparse data, so a
                   fixed cap always shows something where a date window could come back empty.

A segment reached from the overview is always active, but this endpoint also serves a segment that has since gone inactive (e.g. a
rename/emptied out) so its history stays reachable — `active` is returned so the UI can flag it. Unknown name → NOT_FOUND.
=======================================================================================================================================
Request Query Params:
  name  (string, required) - the segment name (= skusummary.segment / segment.name).
  days  (int, optional)    - revenue/GP lookback window; default 30.
  limit (int, optional)    - max work-log rows; default 20, clamped to [1, 100].

Success Response:
{
  "return_code": "SUCCESS",
  "name": "EVA-SEG",
  "active": true,
  "days": 30,
  "stats": { "revenue30": 9314.74, "gpPct": 44, "stock": 812, "styles": 37, "heat": null },
  "areas": [ { "area": "Shopify", "cadenceDays": 30, "dueState": "never", "daysOverdue": 0,
               "nextReview": null, "lastWorkedBy": null, "lastWorkedAt": null }, ... ],   // ordered by area.sort
  "worklog": [ { "area": "Shopify", "workedBy": "Andreas", "workedAt": "2026-07-09T10:11:12.000Z", "note": "harvest" }, ... ],
  "limit": 20,
  "truncated": false
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { safeNumeric } = require('../utils/sql');
const { classifyDue, isoDate } = require('../utils/segmentDue');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'name is required' });
    }
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 30;
    let limit = Number.parseInt(req.query.limit, 10);
    if (!(limit > 0)) limit = 20;
    if (limit > 100) limit = 100;

    // Resolve the segment in the registry (any active state). Unknown → NOT_FOUND rather than an empty-but-valid detail.
    const seg = await query('SELECT id, name, active FROM segment WHERE name = $1', [name]);
    if (seg.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Segment not found' });
    }
    const segmentId = seg.rows[0].id;

    // Header stats — live revenue/COGS (all channels), current sellable stock, and style count. Run in parallel; independent reads.
    const [rev, stockStyles, clocks, work] = await Promise.all([
      query(`
        SELECT SUM(s.qty * s.soldprice)               AS revenue,
               SUM(s.qty * ${safeNumeric('ss.cost')}) AS cogs
        FROM sales s
        JOIN skusummary ss ON ss.groupid = s.groupid
        WHERE ss.segment = $1 AND s.qty > 0 AND s.soldprice > 0
          AND s.solddate >= CURRENT_DATE - $2::int
      `, [name, days]),

      query(`
        SELECT
          (SELECT COUNT(*) FROM skusummary WHERE segment = $1)::int AS styles,
          (SELECT COALESCE(SUM(ls.qty), 0)
             FROM localstock ls
             JOIN skusummary ss ON ss.groupid = ls.groupid
             WHERE ss.segment = $1 AND ls.ordernum = '#FREE' AND COALESCE(ls.deleted, 0) = 0 AND ls.qty > 0)::int AS stock
      `, [name]),

      // Per-area clocks + last-worked (same shape as the overview), for this one segment.
      query(`
        SELECT a.name AS area, a.sort, st.cadence_days, st.next_review_date,
               (CURRENT_DATE - st.next_review_date) AS days_over,
               lw.worked_by AS last_worked_by, lw.worked_at AS last_worked_at
        FROM segment_area_state st
        JOIN area a ON a.id = st.area_id AND a.active = true
        LEFT JOIN LATERAL (
          SELECT worked_by, worked_at FROM segment_worklog w
          WHERE w.segment_id = st.segment_id AND w.area_id = a.id
          ORDER BY w.worked_at DESC LIMIT 1
        ) lw ON true
        WHERE st.segment_id = $1
        ORDER BY a.sort
      `, [segmentId]),

      // Recent work-log across all areas, newest first. limit+1 to detect truncation without a COUNT.
      query(`
        SELECT a.name AS area, w.worked_by, w.worked_at, w.note
        FROM segment_worklog w
        JOIN area a ON a.id = w.area_id
        WHERE w.segment_id = $1
        ORDER BY w.worked_at DESC, w.id DESC
        LIMIT $2::int
      `, [segmentId, limit + 1]),
    ]);

    const revenue = rev.rows[0].revenue === null ? 0 : Number(rev.rows[0].revenue);
    const cogs = rev.rows[0].cogs === null ? null : Number(rev.rows[0].cogs);
    const gpPct = revenue > 0 && cogs !== null ? Math.round(((revenue - cogs) / revenue) * 100) : null;

    const areas = clocks.rows.map((c) => {
      const daysOver = c.days_over === null ? null : Number(c.days_over);
      return {
        area: c.area,
        cadenceDays: c.cadence_days,
        dueState: classifyDue(daysOver),
        daysOverdue: daysOver !== null && daysOver > 0 ? daysOver : 0,
        nextReview: isoDate(c.next_review_date),
        lastWorkedBy: c.last_worked_by || null,
        lastWorkedAt: c.last_worked_at ? c.last_worked_at.toISOString() : null,
      };
    });

    const truncated = work.rows.length > limit;
    const worklog = work.rows.slice(0, limit).map((w) => ({
      area: w.area,
      workedBy: w.worked_by || null,
      workedAt: w.worked_at ? w.worked_at.toISOString() : null,
      note: w.note || '',
    }));

    return res.json({
      return_code: 'SUCCESS',
      name: seg.rows[0].name,
      active: seg.rows[0].active,
      days,
      stats: {
        revenue30: Math.round(revenue * 100) / 100,
        gpPct,
        stock: stockStyles.rows[0].stock,
        styles: stockStyles.rows[0].styles,
        heat: null,
      },
      areas,
      worklog,
      limit,
      truncated,
    });
  } catch (err) {
    logger.error('[segment] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load segment detail' });
  }
});

module.exports = router;
