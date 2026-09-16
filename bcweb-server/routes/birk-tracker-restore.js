/*
=======================================================================================================================================
API Route: birk_tracker_restore
=======================================================================================================================================
Method: POST
Purpose: Birk Tracker module — WRITE. Puts archived lines back on the order book: the undo for "Archive arrived"
         (routes/birk-tracker-clear-arrived.js). Reads `birktracker_archive`, writes `birktracker`, and removes from the archive only
         what actually landed.

TWO SCOPES, MATCHING THE TWO WAYS THIS GOES WRONG (owner, 2026-09-16):
  batch   undo a whole press. The common case by far — the wrong button, or the wrong filter, noticed straight after.
  lines   put back specific lines out of a batch. The other case: the press was right, but one line turns out to be short after all,
          or Birkenstock re-billed it. Undoing the whole delivery to fix one size would put thirteen finished lines back on a screen
          whose job is to show what is unfinished.

RESTORING IS A MOVE, NOT A COPY. A line ends up in the book or in the archive, never both — otherwise the archive slowly fills with
rows that are also live, and "what did we clear?" stops having an answer. Insert and archive-delete are one transaction per call.

THE PAIR MAY BE LIVE AGAIN, AND THAT IS NOT AN ERROR. The book has a unique index on (code, ordernum); the archive deliberately does
not (migrations/20260916_birktracker_archive.sql). A style cleared this season and ordered again next season puts that pair back in the
book legitimately, and restoring the old row would overwrite a current order line with last season's numbers. So the insert is
ON CONFLICT DO NOTHING, the archive row is KEPT when nothing landed, and the response names it in `skipped`. Silently overwriting would
be the worst outcome available here: it destroys live data in the name of restoring old data.
  The read route computes the same test as `restorable` so the panel does not offer a button that cannot work. This check is the one
  that counts — it is made against the database, inside the transaction, at the moment of writing.

ROW BY ROW, NOT ONE BULK INSERT. A bulk INSERT … SELECT would be shorter, but then the archive rows could only be deleted by matching
(code, ordernum) against what came back — and the same pair can legitimately sit in the archive twice (cleared in two different
seasons). That would delete both archive rows while only one line went back. Restoring by `id`, one at a time, is the only version
where what is removed from the archive is exactly what was written to the book. A batch is tens of rows; this is not a hot path.

THE COUNT GUARD (`expected`), same as on the archive button and for the same reason: the client sends how many lines it believes will
go back, counted from what it is showing, and a disagreement comes back as `CHANGED` rather than a surprise. The archive is quieter
than the book — the legacy PowerBuilder screen cannot touch it — but two operators with the panel open is enough, and a restore that
quietly puts back more than someone looked at is the same problem in the other direction.

EVERY RUN IS LOGGED to `bclog` inside the transaction, naming the batch and the count.
=======================================================================================================================================
Request Payload:
{
  "scope": "batch" | "lines",                  // string, required
  "batch_id": "0f1c9a3e-6a1e-4a54-9a43-…",     // string, required when scope is 'batch'
  "ids": [412, 413, 414],                      // integer array, required when scope is 'lines' (1..1000 archive row ids)
  "expected": 14                               // integer >= 1, required — how many lines the screen believes will go back
}

Success Response:
{
  "return_code": "SUCCESS",
  "restored": 12,
  "skipped": [ { "ordernum": "0001927328", "code": "0034703-MILANO-38" } ]  // pair is live in the book again — archive row kept
}

Count-mismatch response (normal, not an error):
{
  "return_code": "CHANGED",
  "message": "The archive changed — 12 lines can go back, not 14. Reload and try again.",
  "actual": 12
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"CHANGED"
"NOT_FOUND"
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
const { BOOK_COLUMNS_SQL } = require('../utils/birkTracker');
const logger = require('../utils/logger');

router.use(verifyToken);

// A press of the archive button is tens of lines. A thousand is far past any real batch and is a bug or a script, not an undo.
const MAX_LINES = 1000;

router.post('/', async (req, res) => {
  try {
    const { scope, batch_id: batchId, ids, expected } = req.body || {};

    if (!['batch', 'lines'].includes(scope)) {
      return res.json({ return_code: 'INVALID_SCOPE', message: 'Scope must be batch or lines' });
    }
    if (!Number.isInteger(expected) || expected < 1) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Expected count is required' });
    }

    // The scope as a WHERE clause and its parameter, built once so the count and the fetch cannot be asked different questions.
    let where;
    let params;
    if (scope === 'batch') {
      const id = typeof batchId === 'string' ? batchId.trim() : '';
      // Shape-checked here rather than left to Postgres: a malformed uuid throws a type error mid-transaction, which would surface
      // as SERVER_ERROR and tell the operator nothing.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.json({ return_code: 'MISSING_FIELDS', message: 'That scope needs a batch id' });
      }
      where = 'batch_id = $1';
      params = [id];
    } else {
      const list = Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n) && n > 0) : [];
      if (list.length === 0) {
        return res.json({ return_code: 'MISSING_FIELDS', message: 'No lines to restore' });
      }
      if (list.length > MAX_LINES) {
        return res.json({ return_code: 'MISSING_FIELDS', message: `Too many lines in one restore (max ${MAX_LINES})` });
      }
      where = 'id = ANY($1::bigint[])';
      params = [list];
    }

    const result = await withTransaction(async (client) => {
      // Lock the archive rows for the length of the transaction, so a second operator pressing Restore on the same batch waits here
      // rather than racing us to the same ids. Ordered by id purely so two concurrent calls take the rows in the same order and
      // cannot deadlock against each other.
      const picked = await client.query(
        `SELECT id, code, ordernum, batch_id FROM birktracker_archive WHERE ${where} ORDER BY id FOR UPDATE`,
        params
      );
      if (picked.rows.length === 0) return { notFound: true };
      if (picked.rows.length > MAX_LINES) {
        // Only reachable on a batch scope, where the count is the database's rather than the client's.
        throw new Error(`batch too large to restore: ${picked.rows.length} rows`);
      }

      // The guard is counted against what CAN go back, not against everything in scope — that is the number the panel shows on the
      // button, so it is the number the client is confirming.
      const free = await client.query(
        `SELECT count(*)::int AS n
           FROM birktracker_archive a
          WHERE ${where}
            AND NOT EXISTS (SELECT 1 FROM birktracker b WHERE b.code = a.code AND b.ordernum = a.ordernum)`,
        params
      );
      const actual = free.rows[0].n;
      if (actual !== expected) return { changed: true, actual };

      let restored = 0;
      const skipped = [];

      for (const row of picked.rows) {
        // One line at a time, addressed by archive id — see the header for why this is not a single bulk statement. The column list
        // is the shared constant, so the SELECT and the INSERT cannot be given different lists.
        const back = await client.query(
          `INSERT INTO birktracker (${BOOK_COLUMNS_SQL})
                SELECT ${BOOK_COLUMNS_SQL} FROM birktracker_archive WHERE id = $1
           ON CONFLICT (code, ordernum) DO NOTHING`,
          [row.id]
        );

        if (back.rowCount === 0) {
          // The pair is live in the book again. Keep the archive row — it is still the record of a clear that happened, and the
          // current line is somebody's real order.
          skipped.push({ ordernum: String(row.ordernum || '').trim(), code: String(row.code || '').trim() });
          continue;
        }

        await client.query('DELETE FROM birktracker_archive WHERE id = $1', [row.id]);
        restored += 1;
      }

      const label = scope === 'batch' ? `batch ${String(batchId).slice(0, 8)}` : `${picked.rows.length} selected line(s)`;
      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Birk Tracker',
        log: `Restored ${restored} archived line(s) from ${label}${skipped.length ? `, ${skipped.length} skipped (already live)` : ''}`,
      });

      return { restored, skipped };
    });

    if (result.notFound) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Those lines are no longer in the archive' });
    }
    if (result.changed) {
      return res.json({
        return_code: 'CHANGED',
        message: `The archive changed — ${result.actual} lines can go back, not ${expected}. Reload and try again.`,
        actual: result.actual,
      });
    }
    return res.json({ return_code: 'SUCCESS', restored: result.restored, skipped: result.skipped });
  } catch (err) {
    logger.error('[birk-tracker-restore] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not restore those lines' });
  }
});

module.exports = router;
