/*
=======================================================================================================================================
API Route: analytics_activity_log
=======================================================================================================================================
Method: GET
Purpose: Reports module — Activity Log. Reads `bclog`, the shared "who did what, when" ledger that BOTH this platform and the legacy
         PowerBuilder app write to (utils/bclog.js). Until now it was written by half the modules and readable by none of them without
         a SQL prompt. READ ONLY — this route has no write counterpart and should not grow one: the log is a record of what happened,
         and a record you can edit is not one.

WHAT IS IN IT, which shapes the filters: ~5,400 rows over about four months, across 11 sections (Goods In is 70% of them), written by
7 different `workstation` values. Those values are a MIX OF TWO THINGS and that is not a bug — PowerBuilder writes the machine name
(WS1, WS7, WS9, WS10) and bcweb writes the login name (Andreas, Summer) or a label for automation (Scheduler). See utils/bclog.js for
why. The filter therefore says "Who or where", because that column honestly holds both.

DISPLAY USES THE LEGACY `date` + `time`, NOT `created_at`. All three are written together and agree, but date/time are Europe/London
as PowerBuilder renders them, which is what the operator recognises. `created_at` is the real timestamptz and is what the SORT uses —
ordering on a text 'HH24:MI' would be wrong across midnight, and ordering on the DATE alone would scramble a day's entries.
  `date` is a genuine pg DATE, so it is cast to text IN SQL rather than handed back as an object: the CLAUDE.md landmine about
  toISOString() turning a DATE into the previous day under BST applies exactly here.

THE FILTER LISTS COVER THE WHOLE TABLE, not the current window. A section that stopped being written months ago (AMZ Label last wrote
in May) must still be selectable, or the log can only show you what is already recent — which is the opposite of what a log is for.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  days     optional integer — trailing window in days (default 30). 0 means the whole log; capped at 3650.
  section  optional string — exact match on `section`.
  who      optional string — exact match on `workstation`.
  q        optional string — case-insensitive substring of the log text, the section or the who/where column.
  limit    optional integer — max rows returned (default 200, max 1000).

Success Response:
{
  "return_code": "SUCCESS",
  "total": 412,                 // rows matching the filters, BEFORE the limit
  "truncated": false,           // true when `limit` cut the set
  "rows": [
    { "id": 34379, "who": "Summer", "section": "Order Sync", "date": "2026-09-14", "time": "13:08",
      "log": "Order Sync: Up to date" }
  ],                            // newest first
  "sections": ["AMZ Label", "Amazon Order", ...],   // every section ever written — the filter list
  "people":   ["Andreas", "Scheduler", "Summer", "WS1", ...]
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

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // Window. 0 is a deliberate "everything" rather than a missing value — a log is often searched precisely because you do not know
    // when the thing happened. Capped at ten years so the parameter cannot be used to ask for something unbounded by accident.
    let days = parseInt(req.query.days, 10);
    if (!Number.isInteger(days) || days < 0) days = 30;
    if (days > 3650) days = 3650;

    let limit = parseInt(req.query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) limit = 200;
    if (limit > 1000) limit = 1000;

    const section = typeof req.query.section === 'string' ? req.query.section.trim() : '';
    const who = typeof req.query.who === 'string' ? req.query.who.trim() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    // One WHERE for the count and the page, built once so the two can never disagree about what "matching" means.
    const where = [];
    const params = [];
    if (days > 0) {
      params.push(days);
      // On created_at, the real timestamp — the legacy `date` is fine for display but the window should follow the clock.
      where.push(`created_at >= now() - ($${params.length}::int * interval '1 day')`);
    }
    if (section) {
      params.push(section);
      where.push(`section = $${params.length}`);
    }
    if (who) {
      params.push(who);
      where.push(`workstation = $${params.length}`);
    }
    if (q) {
      // Searches the message AND the two labels, because "goods in" and "summer" are things people type into a search box expecting
      // them to work, and making them pick the right dropdown first would be a worse screen.
      params.push(`%${q}%`);
      const i = params.length;
      where.push(`(log ILIKE $${i} OR section ILIKE $${i} OR workstation ILIKE $${i})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rowsQ = query(
      `SELECT id, workstation, section, to_char(date, 'YYYY-MM-DD') AS date, time, log
         FROM bclog
         ${clause}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1}`,
      [...params, limit]
    );
    const countQ = query(`SELECT count(*)::int AS n FROM bclog ${clause}`, params);

    // The filter lists deliberately ignore `clause` — see the header.
    const listsQ = query(
      `SELECT
         (SELECT COALESCE(array_agg(DISTINCT section ORDER BY section), '{}')
            FROM bclog WHERE COALESCE(btrim(section), '') <> '')         AS sections,
         (SELECT COALESCE(array_agg(DISTINCT workstation ORDER BY workstation), '{}')
            FROM bclog WHERE COALESCE(btrim(workstation), '') <> '')     AS people`
    );

    const [rowsRes, countRes, listsRes] = await Promise.all([rowsQ, countQ, listsQ]);
    const total = countRes.rows[0].n;

    return res.json({
      return_code: 'SUCCESS',
      total,
      truncated: rowsRes.rowCount < total,
      rows: rowsRes.rows.map((r) => ({
        id: Number(r.id),
        who: (r.workstation || '').trim(),
        section: (r.section || '').trim(),
        date: r.date || '',
        time: (r.time || '').trim(),
        log: r.log || '',
      })),
      sections: listsRes.rows[0].sections || [],
      people: listsRes.rows[0].people || [],
    });
  } catch (err) {
    logger.error('[analytics-activity-log] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the activity log' });
  }
});

module.exports = router;
