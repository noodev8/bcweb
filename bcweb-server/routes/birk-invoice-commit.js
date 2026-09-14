/*
=======================================================================================================================================
API Route: birk_invoice_commit
=======================================================================================================================================
Method: POST
Purpose: Birk Tracker module — WRITE. Applies the invoice the operator just reviewed in /birk-invoice-preview: adds each line's
         quantity to `invoiced` on the order book and stamps the invoice number and date across every row it touched.

ONE TRANSACTION FOR THE WHOLE INVOICE (withTransaction). An invoice is one document and one act; half of it landing would leave the
book claiming a delivery was billed in part, with no way to tell which part was real.

THE CLIENT SENDS ACTIONS, NOT THE PDF. The preview did the parsing and the matching; this route takes the RESOLVED list — the
operator has already answered the ambiguous ones, accepted or edited the suggested codes, and dropped what they chose to skip. Two
consequences, both deliberate:
  It does not re-parse, so what is applied is exactly what was on screen when they pressed the button. Re-reading the PDF here could
  quietly produce a different plan from the one they approved.
  It therefore validates SHAPE, not intent: the codes and quantities are the operator's choices and are applied as given, exactly as
  the Python tool applies whatever its prompts collected.

WHAT EACH ACTION DOES (both ported from birk-tracker.py's apply_plan):
  update   invoiced = COALESCE(invoiced,0) + qty, and stamp invoicedate/invoicenum. ADDITIVE, not a set — an order line can be
           invoiced across two documents, and the second must not erase the first.
  insert   a row the book has never had: code, ordernum, bksize, invoiced, invoicedate, invoicenum.
           ⚠ `requested` IS LEFT NULL, exactly as the Python leaves it. Such a row therefore reads as "ordered –, invoiced n", which
           is correct and is the point: it was NOT on the order, and the screen should keep saying so until someone decides what the
           order really was. Do not "fix" this by defaulting requested to the invoiced quantity — that would quietly rewrite the
           order to match the bill, which is the one thing this module exists to catch.

A ROW THAT NO LONGER EXISTS is reported, not fatal: the legacy PowerBuilder screen writes this table too and may have deleted a line
while the preview sat on screen. Taking the whole invoice down over one stale row would be the wrong trade — the response names what
it missed so the operator can re-run the file.
=======================================================================================================================================
Request Payload:
{
  "invoice_num": "5290104364",             // string, required — stamped on every row touched
  "invoice_date": "04.09.2026",            // string, required — dd.MM.yyyy, Birkenstock's own format, stored verbatim
  "actions": [
    { "op": "update", "code": "1029470-ARIZONA-37", "ordernum": "0001927328", "qty": 1 },
    { "op": "insert", "code": "0001234-ARIZONA-38", "ordernum": "0001946634", "qty": 2, "size": "245/5" }
  ]
}

Success Response:
{
  "return_code": "SUCCESS",
  "updated": 5,                            // rows whose invoiced went up
  "inserted": 1,                           // rows created
  "pairs": 6,                              // pairs applied in total
  "missing": [ "0034703-MILANO-38" ]       // update targets that no longer exist — reported, not an error
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_ACTIONS"
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

// Birkenstock's own date format, as printed. Shape-checked only — it is a label copied off a supplier document, not a date this
// system ever computes with (CLAUDE.md: the legacy date columns are display strings and stay that way).
const INVOICE_DATE = /^\d{2}\.\d{2}\.\d{4}$/;

router.post('/', async (req, res) => {
  try {
    const { invoice_num: invoiceNum, invoice_date: invoiceDate, actions } = req.body || {};

    const num = typeof invoiceNum === 'string' ? invoiceNum.trim() : '';
    const date = typeof invoiceDate === 'string' ? invoiceDate.trim() : '';
    if (!num) return res.json({ return_code: 'MISSING_FIELDS', message: 'The invoice number is required' });
    if (!date || !INVOICE_DATE.test(date)) {
      return res.json({ return_code: 'INVALID_INVOICE_DATE', message: 'Invoice date must look like 04.09.2026' });
    }
    if (!Array.isArray(actions) || actions.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Nothing to apply' });
    }
    // An invoice is tens of lines; an order of magnitude past that is a bug or a paste, not a document.
    if (actions.length > 1000) {
      return res.json({ return_code: 'INVALID_ACTIONS', message: 'Too many lines in one invoice (max 1000)' });
    }

    // Validate the whole batch before writing any of it, so a refusal can name what is wrong instead of just failing.
    const clean = [];
    for (const a of actions) {
      const op = a?.op;
      const code = typeof a?.code === 'string' ? a.code.trim() : '';
      const ordernum = typeof a?.ordernum === 'string' ? a.ordernum.trim() : '';
      const qty = a?.qty;
      if ((op !== 'update' && op !== 'insert') || !code || !ordernum || !Number.isInteger(qty) || qty <= 0 || qty > 99999) {
        return res.json({ return_code: 'INVALID_ACTIONS', message: `Bad line: ${code || '(no code)'}` });
      }
      const size = typeof a?.size === 'string' ? a.size.trim() : '';
      // An inserted row carries the invoice's own size label; without it the row could never be matched again by a later invoice,
      // which finds rows on (ordernum, bksize, article).
      if (op === 'insert' && !size) {
        return res.json({ return_code: 'INVALID_ACTIONS', message: `New line ${code} has no size` });
      }
      clean.push({ op, code, ordernum, qty, size });
    }

    const result = await withTransaction(async (client) => {
      let updated = 0;
      let inserted = 0;
      let pairs = 0;
      const missing = [];

      for (const a of clean) {
        if (a.op === 'update') {
          // ADDITIVE — see the header. Two invoices can bill against one order line.
          const out = await client.query(
            `UPDATE birktracker
                SET invoiced = COALESCE(invoiced, 0) + $3, invoicedate = $4, invoicenum = $5
              WHERE code = $1 AND ordernum = $2`,
            [a.code, a.ordernum, a.qty, date, num]
          );
          if (out.rowCount === 0) {
            missing.push(a.code);
            continue;
          }
          updated += 1;
          pairs += a.qty;
        } else {
          // `requested` is deliberately not written — see the header. The row reads "ordered –, invoiced n" until someone says what
          // was actually ordered.
          await client.query(
            `INSERT INTO birktracker (code, ordernum, bksize, invoiced, invoicedate, invoicenum)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [a.code, a.ordernum, a.size, a.qty, date, num]
          );
          inserted += 1;
          pairs += a.qty;
        }
      }

      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Birk Tracker',
        log: `Loaded invoice ${num} (${date}) — ${pairs} pair(s), ${updated} line(s) updated, ${inserted} added`
          + `${missing.length ? `, ${missing.length} missing` : ''}`,
      });

      return { updated, inserted, pairs, missing };
    });

    return res.json({ return_code: 'SUCCESS', ...result });
  } catch (err) {
    logger.error('[birk-invoice-commit] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'That invoice could not be applied' });
  }
});

module.exports = router;
