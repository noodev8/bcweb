/*
=======================================================================================================================================
API Route: locations_restore
=======================================================================================================================================
Method: POST
Purpose: UNDO a removal on the Location screen — a scanned Remove, a chip's minus, or a whole Empty rack — by reversing exactly the rows
         that removal changed. The screen offers it only while the line reporting the removal is still on screen.

WHY NOT JUST ADD THE UNITS BACK with inv-adjust. An add mints a fresh row, and the fresh row is FREE and unallocated. A unit taken off
the shelf may have been picked for a customer order or allocated to Amazon, and putting a free pair back in its place would quietly
un-pick the order waiting for it. So the removing routes (inv-adjust, locations-empty) report `touched` — the rows they wrote — and
this route reverses those rows in place: a soft-deleted row is un-deleted, a decremented row gets its units back. The unit comes back
exactly as it was, ordernum and allocated included, under the id it always had.

GUARDS, because the ids come from the client and un-deleting is the one thing that could resurrect stock from months ago:
  - the row must still be at `location` (case-insensitively) and hold `code` when one is given — an undo is about THIS rack
  - it must have been written in the last UNDO_HOURS, judged on the legacy `updated` stamp the removal just wrote. A row someone has
    touched since carries a newer stamp and still passes; a row whose stamp is older was not removed by the action on screen
  - a soft-deleted entry is only un-deleted if it is still deleted, a decremented one only topped up if it is still live. A row that
    has moved on (un-deleted by hand, soft-deleted since) is skipped and counted, never forced
Rows that fail a guard are skipped rather than failing the call: the rest of the undo is still right, and the response says how many
units actually came back so the screen can say so.

AUDIT: one bclog line per code, legacy phrasing ("Inv Add: <code> to <loc>") so a stock hunt finds the return exactly as it finds any
other add, with " (undo)" so it reads as the reversal it was.
=======================================================================================================================================
Request Payload:
{
  "location": "C3-Front-05",                                       // required — the rack the units come back to
  "rows": [{ "id": "WS7-...", "units": 1, "deleted": true }]      // required — `touched`, verbatim from inv-adjust or locations-empty
}

Success Response:
{
  "return_code": "SUCCESS",
  "restored": 3,                   // units put back
  "skipped": 0                     // units whose row had moved on and was left alone
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    -- no location, or no usable rows
"NOT_FOUND"         -- none of the rows could be put back; nothing was written
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// How long after a removal it can still be undone. The screen only offers Undo while the line is on screen, which in practice is
// minutes; this is the server's own ceiling, so an id kept in a tab left open overnight cannot un-delete stock from yesterday's shift.
const UNDO_HOURS = 12;

// Same ceiling as locations-empty: the busiest rack holds ~96 units.
const MAX_ROWS = 400;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const rows = Array.isArray(body.rows)
      ? body.rows
          .filter((r) => r && typeof r.id === 'string' && r.id.trim() !== '' && Number.isInteger(Number(r.units)) && Number(r.units) > 0)
          .map((r) => ({ id: r.id.trim(), units: Number(r.units), deleted: r.deleted === true }))
      : [];

    if (!location) return res.json({ return_code: 'MISSING_FIELDS', message: 'location is required' });
    if (rows.length === 0 || rows.length > MAX_ROWS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'rows are required — the rows the removal reported' });
    }

    const changedBy = req.user.display_name;

    const result = await withTransaction(async (client) => {
      const stampRes = await client.query(
        `SELECT to_char(now() AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS') AS stamp,
                to_char((now() - make_interval(hours => $1)) AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS') AS cutoff`,
        [UNDO_HOURS]
      );
      const { stamp, cutoff } = stampRes.rows[0];

      // The rows as they are NOW, locked. The legacy stamp compares as text because its format sorts chronologically. ~3% of localstock
      // carries an ISO stamp instead ('2026-08-12 21:00:02...', a script's) — '-' sorts below any digit, so those FAIL the guard, which
      // is the safe way round, and a row this screen removed always carries the legacy stamp the removal just wrote.
      const liveRes = await client.query(
        `SELECT id, code, COALESCE(deleted, 0) AS deleted
         FROM localstock
         WHERE id = ANY($1::text[])
           AND lower(btrim(location)) = lower($2)
           AND updated >= $3
         FOR UPDATE`,
        [rows.map((r) => r.id), location, cutoff]
      );
      const live = new Map(liveRes.rows.map((r) => [r.id, r]));

      let restored = 0;
      let skipped = 0;
      const byCode = new Map();
      for (const r of rows) {
        const now = live.get(r.id);
        // Still in the state the removal left it in, or it is not this undo's to change.
        if (!now || (r.deleted ? Number(now.deleted) !== 1 : Number(now.deleted) !== 0)) { skipped += r.units; continue; }
        if (r.deleted) {
          await client.query(`UPDATE localstock SET deleted = 0, updated = $1 WHERE id = $2`, [stamp, r.id]);
        } else {
          await client.query(`UPDATE localstock SET qty = qty + $1, updated = $2 WHERE id = $3`, [r.units, stamp, r.id]);
        }
        restored += r.units;
        byCode.set(now.code, (byCode.get(now.code) || 0) + r.units);
      }
      if (restored === 0) return { fail: 'NOT_FOUND' };

      for (const [code, n] of byCode) {
        await client.query(
          `INSERT INTO bclog (workstation, section, log, date, time, created_at)
           VALUES ($1, 'Inventory', $2,
                   (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
          [changedBy, `Inv Add: ${code} to ${location}${n > 1 ? ` x${n}` : ''} (undo)`]
        );
      }
      return { restored, skipped };
    });

    if (result.fail === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'Those units have changed since — nothing to put back' });
    }
    return res.json({ return_code: 'SUCCESS', ...result });
  } catch (err) {
    logger.error('[locations-restore] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to put those units back' });
  }
});

module.exports = router;
