/*
=======================================================================================================================================
API Route: birk_order_commit
=======================================================================================================================================
Method: POST
Purpose: Birk Tracker module — WRITE. Loads the order the operator just reviewed in /birk-order-preview into the order book: inserts
         the lines the book has never had, and restates the ORDER fields of lines Birkenstock has revised.

ONE TRANSACTION FOR THE WHOLE FILE (withTransaction). An order confirmation is one document; half of it landing would leave the book
describing an order nobody placed.

THE CLIENT SENDS THE RESOLVED LINES, NOT THE FILE — same reasoning as birk-invoice-commit. The preview parsed and matched; the operator
may have corrected a guessed style (which changes the code) and unticked lines. Re-parsing here could apply something other than what
was on screen, so this route applies what it is sent and validates SHAPE only.

WHAT EACH OP DOES:
  insert   a new row: code, ordernum, placedate, bksize, requested, cost, rrp, due, ean. invoiced and arrived start at 0 — the legacy
           grid defaulted them the same way, and the book's counts treat NULL and 0 alike. ON CONFLICT DO NOTHING: if the row appeared
           since the preview (the legacy screen still writes this table, or the operator edited a style onto a code that exists) it
           is reported in `conflicts`, not allowed to fail the whole order.
  update   ONLY the order fields: placedate, bksize, requested, cost, rrp, due, ean. ⚠ NEVER invoiced, arrived, invoicenum,
           invoicedate — those record what happened after the order, and a revised confirmation must not rewind a delivery. If the
           new `requested` is below what is already invoiced, the write still goes through (the confirmation is the truth about the
           order) and the Birk Tracker screen turns the line red as over-invoiced, which is exactly the argument to go and have.
           A blank cost/rrp/ean in the payload leaves the stored value alone rather than blanking it.
=======================================================================================================================================
Request Payload:
{
  "lines": [                                                  // 1..2000
    { "op": "insert", "ordernum": "0002268001", "code": "0943871-GIZEH-38", "placedate": "15/09/2026", "bksize": "245/5",
      "requested": 4, "cost": "37.50", "rrp": "90.00", "due": "MAR", "ean": "4040714894232" }
  ]
}

Success Response:
{
  "return_code": "SUCCESS",
  "inserted": 78,
  "updated": 2,
  "pairs": 235,                               // requested pairs across the rows inserted or updated
  "conflicts": [ "0943871-GIZEH-38" ],        // inserts that found the row already there — left as it was
  "missing":   [ "0034701-MILANO-44" ]        // updates whose row no longer exists — nothing written
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_LINES"
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

// The book's own formats (see birk-tracker-lines.js): placedate dd/MM/yyyy, due a month name, prices 2dp strings. Shape-checked so a
// client bug cannot write something the legacy screen would then choke on.
const PLACEDATE = /^\d{2}\/\d{2}\/\d{4}$/;
const DUE = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/;
const MONEY = /^\d{1,6}\.\d{2}$/;
// <article>-<STYLE>-<size>, style non-blank. Deliberately NOT restricted to A-Z: the legacy upload put whole material names into codes
// when a model was off its keyword list, and the live book holds rows like "0044701-Ramses Birko-Flor Unisex-35". Re-loading such an
// order has to be able to address those rows as they are. New styles are cleaned up on the screen, not here.
const CODE = /^\d{7}-\S(.*\S)?-\d{2}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

router.post('/', async (req, res) => {
  try {
    const { lines } = req.body || {};
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Nothing to load' });
    }
    // A season's order is a few hundred lines; an order of magnitude past that is a bug or the wrong file.
    if (lines.length > 2000) {
      return res.json({ return_code: 'INVALID_LINES', message: 'Too many lines in one order (max 2000)' });
    }

    const clean = [];
    const keys = new Set();
    for (const l of lines) {
      const c = {
        op: l?.op,
        ordernum: str(l?.ordernum),
        code: str(l?.code),
        placedate: str(l?.placedate),
        bksize: str(l?.bksize),
        requested: l?.requested,
        cost: str(l?.cost),
        rrp: str(l?.rrp),
        due: str(l?.due),
        ean: str(l?.ean),
      };
      const bad = (c.op !== 'insert' && c.op !== 'update')
        || !/^\d{10}$/.test(c.ordernum)
        || !CODE.test(c.code) || c.code.length > 100
        || !Number.isInteger(c.requested) || c.requested < 1 || c.requested > 99999
        || (c.placedate && !PLACEDATE.test(c.placedate))
        || (c.due && !DUE.test(c.due))
        || (c.cost && !MONEY.test(c.cost))
        || (c.rrp && !MONEY.test(c.rrp))
        || c.bksize.length > 20 || c.ean.length > 20;
      if (bad) return res.json({ return_code: 'INVALID_LINES', message: `Bad line: ${c.code || '(no code)'}` });
      // Two lines for one (order, code) would be an insert racing its own twin — refuse, the preview never produces it.
      const k = `${c.ordernum}|${c.code}`;
      if (keys.has(k)) return res.json({ return_code: 'INVALID_LINES', message: `${c.code} appears twice on order ${c.ordernum}` });
      keys.add(k);
      clean.push(c);
    }

    const result = await withTransaction(async (client) => {
      let inserted = 0;
      let updated = 0;
      let pairs = 0;
      const conflicts = [];
      const missing = [];
      const blank = (v) => (v === '' ? null : v);

      for (const c of clean) {
        if (c.op === 'insert') {
          const out = await client.query(
            `INSERT INTO birktracker (code, ordernum, placedate, bksize, requested, invoiced, arrived, cost, rrp, due, ean)
             VALUES ($1, $2, $3, $4, $5, 0, 0, $6, $7, $8, $9)
             ON CONFLICT (code, ordernum) DO NOTHING`,
            [c.code, c.ordernum, blank(c.placedate), blank(c.bksize), c.requested, blank(c.cost), blank(c.rrp), blank(c.due), blank(c.ean)]
          );
          if (out.rowCount === 0) {
            conflicts.push(c.code);
            continue;
          }
          inserted += 1;
        } else {
          // Order fields only — see the header. COALESCE keeps a stored value when the file had nothing for it.
          const out = await client.query(
            `UPDATE birktracker
                SET requested = $3,
                    placedate = COALESCE($4, placedate),
                    bksize    = COALESCE($5, bksize),
                    cost      = COALESCE($6, cost),
                    rrp       = COALESCE($7, rrp),
                    due       = COALESCE($8, due),
                    ean       = COALESCE($9, ean)
              WHERE code = $1 AND ordernum = $2`,
            [c.code, c.ordernum, c.requested, blank(c.placedate), blank(c.bksize), blank(c.cost), blank(c.rrp), blank(c.due), blank(c.ean)]
          );
          if (out.rowCount === 0) {
            missing.push(c.code);
            continue;
          }
          updated += 1;
        }
        pairs += c.requested;
      }

      const orders = [...new Set(clean.map((c) => c.ordernum))].join(', ');
      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Birk Tracker',
        log: `Loaded order ${orders} — ${pairs} pair(s), ${inserted} line(s) added, ${updated} updated`
          + `${conflicts.length ? `, ${conflicts.length} already there` : ''}${missing.length ? `, ${missing.length} missing` : ''}`,
      });

      return { inserted, updated, pairs, conflicts, missing };
    });

    return res.json({ return_code: 'SUCCESS', ...result });
  } catch (err) {
    logger.error('[birk-order-commit] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'That order could not be loaded' });
  }
});

module.exports = router;
