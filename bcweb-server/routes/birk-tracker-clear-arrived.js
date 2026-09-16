/*
=======================================================================================================================================
API Route: birk_tracker_clear_arrived
=======================================================================================================================================
Method: POST
Purpose: Birk Tracker module — WRITE. Takes the lines that are fully arrived off the order book, so the book keeps showing what is
         still outstanding rather than growing forever. This is the legacy screen's "Delete Green" button, which is what the operator
         calls it and why the front end says "Archive arrived".

IT IS NO LONGER A DELETE (owner, 2026-09-16). The rows are COPIED INTO `birktracker_archive` and then removed from `birktracker`, both
in the same transaction, so a clear can be undone — see routes/birk-tracker-restore.js. Every row of the copy is whole: all 15 legacy
columns move (utils/birkTracker.js → BOOK_COLUMNS), including the two this platform never reads, because an archive that hands back a
different row from the one it took is not an archive.
  Before this, the header here said "THE ROWS ARE GONE… there is nothing to restore from and no undo to offer". That was true and it
  was the reason the two guards below exist. They are KEPT anyway — see each one for why the archive does not make it redundant.
  WHY A SEPARATE TABLE rather than a status column on `birktracker`: the book is shared with the legacy PowerBuilder app, which knows
  nothing about any such column and would go on treating archived lines as live. The full argument is in the migration,
  migrations/20260916_birktracker_archive.sql.
  NOT COVERED: PowerBuilder's own Delete Green still deletes outright. This is a net under the bcweb screen only.

WHAT IT ARCHIVES: `requested > 0 AND invoiced = requested AND arrived = requested` — exactly the rows the screen paints green, no other
test. ALL THREE NUMBERS MUST AGREE (owner, 2026-09-14). An under-invoiced line that is fully here is NOT finished and is not touched:
Birkenstock still owes us the billing, so the line has an open question against it, and a line with an open question must stay on the
screen that asks it. Over-invoiced lines are likewise never cleared — that is money to argue about.
  The rule itself now lives in utils/birkTracker.js and is imported by both this route and the read route that paints the row green, so
  the two can no longer drift. It used to be typed out in both places under a warning comment.

GUARD 1 — THE COUNT MUST MATCH (`expected`). The client sends how many rows it believes it is about to archive, taken from what it is
displaying, and the write is refused if the database disagrees. The legacy PowerBuilder screen writes this same table, and someone
booking an arrival on it while this screen sits open is not a hypothetical — it is the normal way this business runs. Without this, a
press against a five-minute-old screen silently takes rows the operator never saw. `CHANGED` is therefore a normal outcome, not a
fault: the screen reloads and asks again.
  STILL EARNS ITS PLACE WITH AN ARCHIVE BEHIND IT. Undoing is a thing the operator has to notice they need to do, and the rows they
  never saw go are exactly the ones they will not think to look for. The archive is the net; this is the aim.

GUARD 2 — SCOPE. `scope` limits the write to one order or one invoice; 'all' clears every arrived line in the book. The screen sends
whatever the operator has filtered to, so what gets archived is what they were looking at — the alternative is a button whose effect
depends on a filter it silently ignores.

ONE PRESS IS ONE BATCH. Every row written by a single call carries the same `batch_id`, plus who pressed it, when, and the scope they
were looking at. That is what makes "undo that clear" one act rather than a hunt through a list of lines, and it is why the response
returns the id. EVERY RUN IS ALSO LOGGED to `bclog` inside the transaction.
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
  "deleted": 59,                                          // kept under this name: it is what left the book, and the client reads it
  "batch_id": "0f1c9a3e-6a1e-4a54-9a43-2b5f4c9d8e77"      // hand this to /birk-tracker-restore to undo the whole press
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
const { randomUUID } = require('crypto');
const { verifyToken } = require('../middleware/verifyToken');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog } = require('../utils/bclog');
const { ARRIVED_SQL, BOOK_COLUMNS_SQL } = require('../utils/birkTracker');
const logger = require('../utils/logger');

router.use(verifyToken);

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

    // The scope clause and its parameter, built once so the COUNT, the COPY and the DELETE can never be asked different questions —
    // which is the one bug that would make Guard 1 worthless, and the one that would archive a different set than it removed.
    const column = scope === 'order' ? 'ordernum' : 'invoicenum';
    const where = scoped ? `${ARRIVED_SQL} AND btrim(${column}) = $1` : ARRIVED_SQL;
    const params = scoped ? [scopeValue] : [];

    // Stored on every archived row so the batch can describe itself later: "59 lines, whole book" means something, "59 lines" does not.
    const scopeLabel = scoped ? `${scope} ${scopeValue}` : 'all';
    const batchId = randomUUID();

    const result = await withTransaction(async (client) => {
      // Counted inside the transaction so nothing can slip between the check and the write.
      const count = await client.query(`SELECT count(*)::int AS n FROM birktracker WHERE ${where}`, params);
      const actual = count.rows[0].n;
      if (actual !== expected) return { changed: true, actual };

      // COPY FIRST, then delete — same transaction, same WHERE, so the two can only both happen or neither. The column list comes
      // from one constant used on both sides of the INSERT … SELECT: written out twice by hand, a single transposed pair would put
      // cost into rrp on every archived row and nothing would notice until someone restored one.
      const copied = await client.query(
        `INSERT INTO birktracker_archive (${BOOK_COLUMNS_SQL}, batch_id, archived_by, scope)
              SELECT ${BOOK_COLUMNS_SQL}, $${params.length + 1}, $${params.length + 2}, $${params.length + 3}
                FROM birktracker
               WHERE ${where}`,
        [...params, batchId, req.user.display_name || 'unknown', scopeLabel]
      );

      const del = await client.query(`DELETE FROM birktracker WHERE ${where}`, params);

      // Belt and braces on the one thing that would make the archive a lie: if the copy and the delete ever disagreed, the rows
      // would be gone from the book with no matching archive row (or the reverse). Throwing rolls the whole thing back.
      if (copied.rowCount !== del.rowCount) {
        throw new Error(`archive/delete mismatch: copied ${copied.rowCount}, deleted ${del.rowCount}`);
      }

      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Birk Tracker',
        log: `Archived ${del.rowCount} fully-arrived line(s) — ${scoped ? scopeLabel : 'whole book'}`,
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
    return res.json({ return_code: 'SUCCESS', deleted: result.deleted, batch_id: batchId });
  } catch (err) {
    logger.error('[birk-tracker-clear-arrived] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not archive those lines' });
  }
});

module.exports = router;
