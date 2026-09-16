/*
=======================================================================================================================================
API Route: birk_tracker_archive
=======================================================================================================================================
Method: GET
Purpose: Birk Tracker module — READ ONLY. The lines that have been cleared off the order book, newest press first, so the operator can
         see what went and put any of it back. This is the read behind the Archive panel on /birk-tracker; the restore itself is
         routes/birk-tracker-restore.js.

ORGANISED BY BATCH, NOT BY LINE. One press of "Archive arrived" is one act — usually one delivery's worth of sizes — and the question
asked of this screen is almost always "what did that press take?", not "where is this one line?". So the rows come back grouped under
the batch that wrote them, each batch carrying who pressed it, when, and the scope they had filtered to at the time. A flat list of
600 lines would answer the rare question and bury the common one.
  A batch's `scope` is stored as the operator saw it ('all', or 'order 0001927328'). "59 lines" on its own does not say whether that
  was one delivery or the whole book, which is exactly what someone deciding whether to undo it needs to know.

`restorable` SAYS WHETHER THE LINE CAN ACTUALLY GO BACK, and it is computed here rather than left for the restore to discover. The
book has a unique index on (code, ordernum) and the archive deliberately does not (see the migration): a style cleared this season and
ordered again next season is a legitimate, expected collision. When the pair is live in the book again, that line cannot be restored
without overwriting the current one, which restore refuses to do — and a Restore button that fails when pressed is worse than one that
was never offered. The batch header carries the count so the panel can say "12 of 14 can go back" before anything is pressed.

WHY IT IS ITS OWN ROUTE AND NOT A FLAG ON /birk-tracker-lines: the archive is not part of the book. The lines route's totals, its two
filter rails and its `complete` flag all describe what is outstanding, and folding archived rows into any of them would corrupt the
numbers the screen exists to show. Separate question, separate read, loaded only when the panel is opened.

LEGACY COLUMN FORMATS (CLAUDE.md) pass through VERBATIM, exactly as on the lines route: `placed` is dd/MM/yyyy, `invoice_date` is
dd.MM.yyyy, `due` is a month NAME. Nothing here parses them. `archived_at` is a real timestamptz and is the one date in this module
that IS a date — it is returned as an ISO string, which is safe because it is a timestamp rather than a pg DATE (handing a DATE to
toISOString() is the BST day-shift landmine in CLAUDE.md).
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  cap    optional integer >= 1 — max ROWS to return (default 2000, max 20000). A safety bound only, same as the lines route.

Success Response:
{
  "return_code": "SUCCESS",
  "total": 118,                    // archived rows in all (before the cap)
  "truncated": false,
  "batches": [
    { "batch_id": "0f1c9a3e-…", "archived_at": "2026-09-16T10:42:07.113Z", "archived_by": "Andreas",
      "scope": "order 0001927328", "lines": 14, "pairs": 14, "restorable": 12,
      "rows": [
        { "id": 412, "ordernum": "0001927328", "code": "0034703-MILANO-38", "placed": "07/09/2026", "bksize": "225/2.5",
          "requested": 1, "invoiced": 1, "arrived": 1, "invoice_date": "26.08.2026", "invoice_num": "5290103870",
          "due": "", "ean": "4066651234567", "cost": 37.5, "rrp": 90, "restorable": true }
      ] }
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
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

// Same two coercions as the lines route: legacy text columns are '' as often as NULL and the difference means nothing, and the count
// columns are nullable even though the screens only write numbers into them.
function text(v) {
  return v == null ? '' : String(v).trim();
}
function int(v) {
  return Number(v) || 0;
}

router.get('/', async (req, res) => {
  try {
    let cap = parseInt(req.query.cap, 10);
    if (!Number.isInteger(cap) || cap < 1) cap = 2000;
    if (cap > 20000) cap = 20000;

    // One trip for the rows. The NOT EXISTS is `restorable`: is this line's (code, ordernum) free in the book right now? See the
    // header — the pair coming back into use is expected, not an error, and the panel needs to know before it offers a button.
    // Ordered newest batch first, then the way the book itself reads (ordernum, code) inside a batch.
    const rowsQ = query(
      `SELECT a.id, a.batch_id, a.archived_at, a.archived_by, a.scope,
              a.ordernum, a.code, a.placedate, a.bksize, a.requested, a.invoiced, a.arrived,
              a.invoicedate, a.invoicenum, a.due, a.ean,
              ${safeNumeric('a.cost')} AS cost,
              ${safeNumeric('a.rrp')}  AS rrp,
              NOT EXISTS (
                SELECT 1 FROM birktracker b WHERE b.code = a.code AND b.ordernum = a.ordernum
              ) AS restorable
         FROM birktracker_archive a
        ORDER BY a.archived_at DESC, a.batch_id, a.ordernum ASC, a.code ASC
        LIMIT $1`,
      [cap]
    );

    // The one figure that must describe the WHOLE archive rather than the returned slice, so `truncated` can be honest.
    const totalQ = query(`SELECT count(*)::int AS total FROM birktracker_archive`);

    const [rowsRes, totalRes] = await Promise.all([rowsQ, totalQ]);
    const total = int(totalRes.rows[0]?.total);

    // Fold the flat result into batches. The SQL ordering already puts each batch's rows together, so this is one pass with no
    // sorting of its own — the order the database gave them is the order they are shown in.
    const batches = [];
    let current = null;
    for (const r of rowsRes.rows) {
      if (!current || current.batch_id !== r.batch_id) {
        current = {
          batch_id: r.batch_id,
          archived_at: r.archived_at ? r.archived_at.toISOString() : null,
          archived_by: text(r.archived_by),
          scope: text(r.scope),
          lines: 0,
          pairs: 0,
          restorable: 0,
          rows: [],
        };
        batches.push(current);
      }
      const requested = int(r.requested);
      const restorable = r.restorable === true;
      current.lines += 1;
      // Every archived line is fully arrived by definition, so `requested` IS the pairs that landed on it.
      current.pairs += requested;
      if (restorable) current.restorable += 1;
      current.rows.push({
        id: Number(r.id),
        ordernum: text(r.ordernum),
        code: text(r.code),
        placed: text(r.placedate),
        bksize: text(r.bksize),
        requested,
        invoiced: int(r.invoiced),
        arrived: int(r.arrived),
        invoice_date: text(r.invoicedate),
        invoice_num: text(r.invoicenum),
        due: text(r.due),
        ean: text(r.ean),
        cost: r.cost == null ? null : Number(r.cost),
        rrp: r.rrp == null ? null : Number(r.rrp),
        restorable,
      });
    }

    return res.json({
      return_code: 'SUCCESS',
      total,
      truncated: rowsRes.rows.length < total,
      batches,
    });
  } catch (err) {
    logger.error('[birk-tracker-archive] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the archive' });
  }
});

module.exports = router;
