/*
=======================================================================================================================================
API Route: locations_empty
=======================================================================================================================================
Method: POST
Purpose: Take EVERYTHING off one rack in a single move. The Locations module's first write, and the biggest one it will ever make.

WHY A BULK CLEAR EXISTS AT ALL. Emptying a shelf is a real job — a bay is being rearranged, a rack is retired, or a stock check found
it holding nothing that is actually there. Doing it through inv-adjust is one call per size, forty-odd times on a busy rack, and a
half-finished sweep leaves the shelf in a state nobody can tell from a genuine one.

IT REMOVES PICKED AND AMAZON-ALLOCATED UNITS TOO (owner, 2026-09-10 — "everything, with a warning"). That is not a detail: a picked
unit is committed to a customer order that still expects it, and clearing the shelf does NOT tell the order anything. inv-adjust makes
the same choice one unit at a time ("the operator is in control ... from anywhere") and can rely on the operator seeing the state tag
on the line they are touching. In bulk there is no line to look at, so the WARNING is the thing that carries that weight and it lives
in the UI: the confirm step names the picked and Amazon counts before the button will fire. This route returns those counts in its
response so the screen can say what it just did, and the client sends `units` so a shelf that changed under the operator between the
warning and the button is refused rather than cleared blind.

SOFT DELETE, never a DELETE. `deleted = 1` with a fresh legacy stamp, exactly as inv-adjust removes units, so a mistaken sweep is
recoverable by hand and the row keeps its history. NOTHING ELSE IS TOUCHED — not ordernum, not allocated, not qty. A cleared row is a
row that is no longer on a shelf; it is not a row that has been un-picked or un-allocated, and rewriting those fields would put the
rack's stock and the order that claimed it into two different stories.

AUDIT, and this is where the bulk really matters. One bclog line PER CODE, phrased exactly like inv-adjust's ("Inv Remove: <code> from
<loc> x<n>"), because the log's job is answering "where did that shoe go" months later and a single summary line would leave every one
of those codes unfindable. Plus one "Inv Empty" line so the sweep also reads as the single deliberate act it was. Section 'Inventory',
the operator's login name in the workstation column — same as every other stock write.

Everything is one withTransaction: the whole rack clears, or none of it does.
=======================================================================================================================================
Request Payload:
{
  "location": "C3-Front-05",       // required — the rack to clear
  "units": 14                      // required — the unit count the operator was shown. A guard, not data: if the rack no longer holds
                                   // exactly this, nothing is written and the screen re-reads. Pass -1 to skip the check deliberately.
}

Success Response:
{
  "return_code": "SUCCESS",
  "location": "C3-Front-05",
  "units": 14,                     // units taken off
  "rows": 12,                      // localstock rows soft-deleted (a row can hold more than one unit)
  "codes": 9,                      // distinct sizes cleared — one bclog line each
  "picked": 3,                     // of those units, committed to a customer order
  "amz": 2                         // of those units, allocated to Amazon
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    -- no location, or `units` is not an integer
"NOT_FOUND"         -- the rack is already empty; nothing was written
"CHANGED"           -- the rack no longer holds what the operator was shown; nothing was written, re-read and try again
"TOO_MANY"          -- more units on the rack than one sweep is allowed to take (see MAX_UNITS)
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

// A ceiling on one sweep. The busiest rack in the building holds ~96 units, so this is roughly four times the worst real case: high
// enough that no honest empty is ever refused, low enough that a bug pointing this at something enormous stops rather than runs.
const MAX_UNITS = 400;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const expected = Number(body.units);

    if (!location) return res.json({ return_code: 'MISSING_FIELDS', message: 'location is required' });
    if (!Number.isInteger(expected)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'units is required — the count the operator was shown' });
    }

    // The logged-in operator, resolved server-side by verifyToken and never trusted from the client (CLAUDE.md).
    const changedBy = req.user.display_name;

    const result = await withTransaction(async (client) => {
      const stampRes = await client.query(`SELECT to_char(now() AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS') AS stamp`);
      const stamp = stampRes.rows[0].stamp;

      // Every live row on the rack, locked for the duration so a concurrent pick or adjust cannot slip in behind the count we are
      // about to check. Matched case-insensitively for the reason locations-racks.js explains: nothing constrains the column.
      const rowsRes = await client.query(
        `SELECT id, code, qty, ordernum, allocated
         FROM localstock
         WHERE lower(btrim(location)) = lower($1) AND COALESCE(deleted, 0) = 0 AND qty > 0
         ORDER BY code, id
         FOR UPDATE`,
        [location]
      );
      const rows = rowsRes.rows;
      if (rows.length === 0) return { fail: 'NOT_FOUND' };

      const units = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);
      if (units > MAX_UNITS) return { fail: 'TOO_MANY', units };
      // The guard. -1 is the deliberate opt-out; anything else must match what the operator was looking at when they confirmed.
      if (expected !== -1 && expected !== units) return { fail: 'CHANGED', units };

      // Counted before anything is written, because these are what the response tells the operator they just did.
      let picked = 0;
      let amz = 0;
      const byCode = new Map();
      for (const r of rows) {
        const q = Number(r.qty) || 0;
        if (r.ordernum !== '#FREE') picked += q;
        else if (r.allocated === 'amz') amz += q;
        byCode.set(r.code, (byCode.get(r.code) || 0) + q);
      }

      await client.query(
        `UPDATE localstock SET deleted = 1, updated = $1 WHERE id = ANY($2::text[])`,
        [stamp, rows.map((r) => r.id)]
      );

      // One line per code so a stock hunt finds it, then the summary so the sweep reads as one act. Same phrasing as inv-adjust.
      for (const [code, n] of byCode) {
        await client.query(
          `INSERT INTO bclog (workstation, section, log, date, time, created_at)
           VALUES ($1, 'Inventory', $2,
                   (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
          [changedBy, `Inv Remove: ${code} from ${location}${n > 1 ? ` x${n}` : ''}`]
        );
      }
      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ($1, 'Inventory', $2,
                 (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [changedBy, `Inv Empty: ${location} x${units}`]
      );

      return { units, rows: rows.length, codes: byCode.size, picked, amz };
    });

    if (result.fail === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'There is nothing on that rack' });
    }
    if (result.fail === 'CHANGED') {
      return res.json({ return_code: 'CHANGED', message: `That rack now holds ${result.units} units, not what was on screen`, units: result.units });
    }
    if (result.fail === 'TOO_MANY') {
      return res.json({ return_code: 'TOO_MANY', message: `That rack holds ${result.units} units — more than one sweep can take` });
    }
    return res.json({ return_code: 'SUCCESS', location, ...result });
  } catch (err) {
    logger.error('[locations-empty] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to empty that rack' });
  }
});

module.exports = router;
