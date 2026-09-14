/*
=======================================================================================================================================
API Route: birk_tracker_clear_arrived
=======================================================================================================================================
Method: POST
Purpose: Birk Tracker module — WRITE, DESTRUCTIVE. Removes the lines that are fully arrived, so the order book keeps showing what is
         still outstanding rather than growing forever. This is the legacy screen's "Delete Green" button, which is what the operator
         calls it and why the front end says "Clear arrived".

WHAT IT DELETES: `requested > 0 AND invoiced = requested AND arrived = requested` — exactly the rows the screen paints green, no other
test. ALL THREE NUMBERS MUST AGREE (owner, 2026-09-14). An under-invoiced line that is fully here is NOT finished and is not deleted:
Birkenstock still owes us the billing, so the line has an open question against it, and a line with an open question must stay on the
screen that asks it. Over-invoiced lines are likewise never cleared — that is money to argue about.
  ⚠ THIS RULE IS SHARED WITH the `complete` flag in routes/birk-tracker-lines.js, which is what paints the row green. If one changes
  and the other does not, this button deletes something other than what the operator was looking at. Change both.

THE ROWS ARE GONE. `birktracker` has no soft-delete column and no archive table, and the legacy screen deletes outright, so there is
nothing to restore from and no undo to offer. That fact drives the two guards below; do not remove either without replacing them with
something better.

GUARD 1 — THE COUNT MUST MATCH (`expected`). The client sends how many rows it believes it is about to delete, taken from what it is
displaying, and the delete is refused if the database disagrees. The legacy PowerBuilder screen writes this same table, and someone
booking an arrival on it while this screen sits open is not a hypothetical — it is the normal way this business runs. Without this,
a delete pressed against a five-minute-old screen silently takes rows the operator never saw. `CHANGED` is therefore a normal
outcome, not a fault: the screen reloads and asks again.

GUARD 2 — SCOPE. `scope` limits the delete to one order or one invoice; 'all' clears every arrived line in the book. The screen sends
whatever the operator has filtered to, so what gets deleted is what they were looking at — the alternative is a button whose effect
depends on a filter it silently ignores.

EVERY RUN IS LOGGED to `bclog` inside the transaction, with the scope and the count. With no undo and no archive, that log line is the
only surviving record that the rows ever existed.
=======================================================================================================================================
Request Payload:
{
  "scope": "all" | "order" | "invoice",   // string, required
  "value": "0001927328",                   // string, required when scope is 'order' or 'invoice'
  "expected": 59                           // integer >= 0, required — how many rows the screen believes will go
}

Success Response:
{
  "return_code": "SUCCESS",
  "deleted": 59
}

Count-mismatch response (normal, not an error):
{
  "return_code": "CHANGED",
  "message": "The book changed — 61 lines are now fully arrived, not 59. Reload and try again.",
  "actual": 61
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"CHANGED"
"MISSING_FIELDS"
"INVALID_SCOPE"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

// The green row, stated once: ordered, billed and received all agree. Same rule as the `complete` flag the read route returns — they
// must never drift apart, or the button deletes something other than what the screen painted.
const ARRIVED = 'requested > 0 AND invoiced = requested AND arrived = requested';

router.post('/', async (req, res) => {
  try {
    const { scope, value, expected } = req.body || {};

    if (!['all', 'order', 'invoice'].includes(scope)) {
      return res.json({ return_code: 'INVALID_SCOPE', message: 'Scope must be all, order or invoice' });
    }
    const scoped = scope !== 'all';
    const scopeValue = typeof value === 'string' ? value.trim() : '';
    if (scoped && !scopeValue) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'That scope needs an order or invoice number' });
    }
    if (!Number.isInteger(expected) || expected < 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Expected count is required' });
    }

    // The scope clause and its parameter, built once so the COUNT and the DELETE can never be asked different questions — which is
    // the one bug that would make Guard 1 worthless.
    const column = scope === 'order' ? 'ordernum' : 'invoicenum';
    const where = scoped ? `${ARRIVED} AND btrim(${column}) = $1` : ARRIVED;
    const params = scoped ? [scopeValue] : [];

    const result = await withTransaction(async (client) => {
      // Counted inside the transaction so nothing can slip between the check and the delete.
      const count = await client.query(`SELECT count(*)::int AS n FROM birktracker WHERE ${where}`, params);
      const actual = count.rows[0].n;
      if (actual !== expected) return { changed: true, actual };

      const del = await client.query(`DELETE FROM birktracker WHERE ${where}`, params);

      // With no archive and no undo, this line is the only record the rows existed. Same transaction, so it cannot outlive a rollback.
      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Birk Tracker',
        log: `Cleared ${del.rowCount} fully-arrived line(s) — ${scoped ? `${scope} ${scopeValue}` : 'whole book'}`,
      });

      return { changed: false, deleted: del.rowCount };
    });

    if (result.changed) {
      return res.json({
        return_code: 'CHANGED',
        message: `The book changed — ${result.actual} lines are now fully arrived, not ${expected}. Reload and try again.`,
        actual: result.actual,
      });
    }
    return res.json({ return_code: 'SUCCESS', deleted: result.deleted });
  } catch (err) {
    logger.error('[birk-tracker-clear-arrived] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not clear those lines' });
  }
});

module.exports = router;
