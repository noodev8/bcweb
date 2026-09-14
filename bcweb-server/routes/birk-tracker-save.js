/*
=======================================================================================================================================
API Route: birk_tracker_save
=======================================================================================================================================
Method: POST
Purpose: Birk Tracker module — WRITE. Keys what an invoice says and what physically turned up, against lines of the Birkenstock order
         book (`birktracker`). This is the screen's data entry: an invoice lands, you key invoiced + arrived per size and stamp the
         invoice number and date across the lines you touched.

ONE TRANSACTION FOR THE WHOLE BATCH (withTransaction). A batch is one invoice being keyed in; half of it landing would leave the book
saying something that was never true of any piece of paper, and the operator with no way to tell which half.

ROWS ARE ADDRESSED BY (ordernum, code) — the natural key, verified unique on the live table. There is no surrogate id. A row in the
payload that matches nothing is REPORTED, not failed: the legacy PowerBuilder screen writes this table too and may have deleted the
line while it was on someone's screen, and taking the whole invoice down over one stale row would be the wrong trade. The response
names the missing ones so the screen can say so and reload.

OVER-INVOICING IS ALLOWED AND FLAGGED, NEVER BLOCKED. `invoiced > requested` means Birkenstock has billed for more than we ordered —
which is the single most valuable thing this screen can tell you, and the owner's reason for keeping the invoiced column. Refusing the
write would be exactly backwards: you must be able to key what the invoice ACTUALLY says in order to see that it is wrong and go and
argue it. So the write goes through and the response returns `over` for every line where it happened, which the screen shows in red.
(Same shape as the pricing rule in CLAUDE.md: block the impossible, flag the suspicious.)
  `arrived > invoiced` is NOT flagged: goods routinely land before the invoice is keyed, so it is an ordinary in-between state.
  `arrived > requested` IS flagged, for the same reason as over-invoicing — more turned up than was asked for.

NOT WRITTEN HERE: `requested`, `cost`, `rrp`, `due`, `bksize`, `ean`. Those are the ORDER — what we asked Birkenstock for and what they
quoted — and they arrive with the order confirmation, not with a delivery. Keying a delivery must never quietly restate the order, or
the book loses the very baseline the over-invoice check is measured against.

LEGACY COLUMN FORMATS (CLAUDE.md): `invoicedate` is a dd.MM.yyyy display STRING (Birkenstock's own format, off their invoice), not a
date. It is validated to that shape and stored verbatim — no parsing, no reformatting, nothing handed to a Date. The counts are
`integer` columns and are written as integers.
=======================================================================================================================================
Request Payload:
{
  "rows": [                                  // 1..500 lines, each one size of one style on one order
    { "ordernum": "0001927328",              // string, required
      "code": "0034703-MILANO-38",           // string, required
      "invoiced": 3,                         // integer >= 0, required
      "arrived": 3 }                         // integer >= 0, required
  ],
  "invoice_num": "5290103870",               // string, optional — stamped on EVERY row in the batch when present
  "invoice_date": "26.08.2026"               // string, optional — dd.MM.yyyy; only accepted alongside invoice_num
}

Success Response:
{
  "return_code": "SUCCESS",
  "saved": 7,                                            // rows actually updated
  "missing": [ "0034703-MILANO-41" ],                    // codes that matched no row (the other screen deleted them) — not an error
  "over": [ { "code": "0043661-GIZEH-38", "requested": 1, "invoiced": 2, "arrived": 1 } ]  // billed/arrived above what was ordered
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_ROWS"
"INVALID_INVOICE_DATE"
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

// Birkenstock's invoice date format. Validated for SHAPE only — the day/month are not range-checked because this is a label copied
// off a supplier's paperwork, not a date this system ever computes with.
const INVOICE_DATE = /^\d{2}\.\d{2}\.\d{4}$/;

// A count keyed by a person. Must be a whole number and cannot be negative; everything else (including an over-invoice) is a fact
// about the paperwork rather than a bad input, and belongs in the flags rather than in a rejection.
function validCount(v) {
  return Number.isInteger(v) && v >= 0 && v <= 99999;
}

router.post('/', async (req, res) => {
  try {
    const { rows, invoice_num: invoiceNum, invoice_date: invoiceDate } = req.body || {};

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'No rows to save' });
    }
    // 500 is the batch ceiling: one invoice is tens of lines, and anything an order of magnitude past that is a bug or a paste, not a
    // delivery being keyed.
    if (rows.length > 500) {
      return res.json({ return_code: 'INVALID_ROWS', message: 'Too many rows in one save (max 500)' });
    }

    // Validate the WHOLE batch before writing any of it — a transaction would roll back anyway, but failing up front means the
    // response can name what is wrong instead of just refusing.
    const clean = [];
    for (const r of rows) {
      const ordernum = typeof r?.ordernum === 'string' ? r.ordernum.trim() : '';
      const code = typeof r?.code === 'string' ? r.code.trim() : '';
      if (!ordernum || !code || !validCount(r?.invoiced) || !validCount(r?.arrived)) {
        return res.json({ return_code: 'INVALID_ROWS', message: `Bad line: ${code || '(no code)'}` });
      }
      clean.push({ ordernum, code, invoiced: r.invoiced, arrived: r.arrived });
    }

    // The invoice stamp is optional and all-or-nothing: a date with no number would attach a date to whatever number the row already
    // had, which is how a line ends up carrying two different invoices' details.
    const stamp = typeof invoiceNum === 'string' && invoiceNum.trim() !== '';
    const stampNum = stamp ? invoiceNum.trim().slice(0, 40) : null;
    let stampDate = null;
    if (stamp && typeof invoiceDate === 'string' && invoiceDate.trim() !== '') {
      stampDate = invoiceDate.trim();
      if (!INVOICE_DATE.test(stampDate)) {
        return res.json({ return_code: 'INVALID_INVOICE_DATE', message: 'Invoice date must look like 26.08.2026' });
      }
    }

    const result = await withTransaction(async (client) => {
      const saved = [];
      const missing = [];
      const over = [];

      for (const r of clean) {
        // RETURNING gives back `requested` so the over-invoice check is made against what the DATABASE holds, not against whatever the
        // browser was showing — the whole point of the check is that it must be trustworthy.
        const sql = stamp
          ? `UPDATE birktracker
                SET invoiced = $3, arrived = $4, invoicenum = $5, invoicedate = COALESCE($6, invoicedate)
              WHERE ordernum = $1 AND code = $2
              RETURNING code, requested, invoiced, arrived`
          : `UPDATE birktracker
                SET invoiced = $3, arrived = $4
              WHERE ordernum = $1 AND code = $2
              RETURNING code, requested, invoiced, arrived`;
        const params = stamp
          ? [r.ordernum, r.code, r.invoiced, r.arrived, stampNum, stampDate]
          : [r.ordernum, r.code, r.invoiced, r.arrived];

        const out = await client.query(sql, params);
        if (out.rowCount === 0) {
          missing.push(r.code);
          continue;
        }
        const row = out.rows[0];
        const requested = Number(row.requested) || 0;
        saved.push(row.code);
        if (row.invoiced > requested || row.arrived > requested) {
          over.push({ code: row.code, requested, invoiced: row.invoiced, arrived: row.arrived });
        }
      }

      // One audit line per save, naming the invoice when there was one — "who keyed this invoice, and when" is the question the log
      // gets asked. It shares the transaction, so a log row can never describe a write that rolled back.
      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Birk Tracker',
        log: `Saved ${saved.length} line(s)${stampNum ? ` against invoice ${stampNum}` : ''}` +
             `${missing.length ? `, ${missing.length} missing` : ''}${over.length ? `, ${over.length} over-invoiced` : ''}`,
      });

      return { saved: saved.length, missing, over };
    });

    return res.json({ return_code: 'SUCCESS', ...result });
  } catch (err) {
    logger.error('[birk-tracker-save] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not save those lines' });
  }
});

module.exports = router;
