/*
=======================================================================================================================================
API Route: birk_invoice_preview
=======================================================================================================================================
Method: POST (multipart/form-data)
Purpose: Birk Tracker module — read a Birkenstock invoice PDF and say what applying it WOULD do to the order book. READ ONLY: not one
         row is written here. The operator reads the plan, answers whatever it could not decide alone, and only then calls
         /birk-invoice-commit.

WHY IT IS SPLIT IN TWO. The Python tool this ports (C:\projects\birk-tracker\birk-tracker.py — see utils/birkInvoice.js) stops at a
terminal prompt for every line it cannot resolve, then asks "Proceed? [y/N]" before committing. A web request cannot block on a
question, so the whole plan is computed and returned at once, the screen asks everything in one go, and the answers come back with
the commit. Same four questions, same order, one round trip each way.

WHAT COMES BACK PER LINE (`kind`), and what the screen must do with it:
  update            one row matched — add this quantity to it. Nothing to ask.
  already_invoiced  the matched row already carries THIS invoice number with a quantity against it. Almost always the same PDF being
                    loaded twice. Defaults to SKIP; the operator can insist.
  ambiguous         several rows matched the (order, size, article) — the operator picks one. Never guessed: crediting the wrong row
                    puts two lines wrong at once and nothing records which.
  missing           no row matched. A code is SUGGESTED from any existing row for the same article (that is where the style text
                    comes from); the operator accepts it, types another, or skips the line.

THE PDF NEVER TOUCHES DISK. multer keeps it in memory, it is parsed, and the buffer is dropped when the request ends — there is no
upload directory to fill up, and an invoice is a supplier document we have no reason to keep a second copy of.
=======================================================================================================================================
Request: multipart/form-data with one field `file` — the invoice PDF.

Success Response:
{
  "return_code": "SUCCESS",
  "invoice": { "invoice_number": "5290104364", "invoice_date": "04.09.2026", "order_number": "1927328",
               "total_invoiced": 6, "items": [ ... ] },
  "parsed_pairs": 6,          // pairs the parse actually found, summed over every line
  "totals_agree": true,       // parsed_pairs === invoice.total_invoiced (the invoice's own "Sum of pos." line)
  "entries": [
    { "kind": "update", "article": "01029470", "ordernum": "0001927328", "size": "240/4.5", "eu": "37", "qty": 1,
      "row": { "code": "1029470-ARIZONA-37", "ordernum": "0001927328", "invoiced": 0, "invoicenum": "", ... } },
    { "kind": "missing", "suggested_code": "0001234-ARIZONA-38", ... },
    { "kind": "ambiguous", "candidates": [ ...rows... ], ... }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"NO_FILE"
"NOT_A_PDF"
"UNREADABLE_PDF"      the file opened but no invoice lines could be read out of it
"NO_INVOICE_NUMBER"   parsed, but the header is missing — refuses rather than stamping rows with a blank invoice number
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { parseInvoice, buildPlan, flatten } = require('../utils/birkInvoice');
const logger = require('../utils/logger');

router.use(verifyToken);

// One PDF, in memory. 15MB is far above any invoice seen (the sample is 33KB) and low enough that a wrong file cannot tie up the box.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

router.post('/', (req, res) => {
  // multer is run by hand so its own failures come back as our JSON envelope rather than a raw 4xx (docs/API-RULES.md).
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      logger.error('[birk-invoice-preview] upload error:', uploadErr.message);
      return res.json({ return_code: 'NO_FILE', message: 'That file could not be read — is it under 15MB?' });
    }
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.json({ return_code: 'NO_FILE', message: 'No file was attached' });
    }
    // Check the magic bytes, not the extension: a renamed file would otherwise reach the parser and fail with something unhelpful.
    if (req.file.buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
      return res.json({ return_code: 'NOT_A_PDF', message: 'That is not a PDF — Load invoice expects the invoice PDF itself' });
    }

    const client = await pool.connect();
    try {
      const invoice = await parseInvoice(req.file.buffer);

      if (!invoice.items.length) {
        return res.json({
          return_code: 'UNREADABLE_PDF',
          message: 'No invoice lines could be read from that PDF. Is it a Birkenstock invoice?',
        });
      }
      // Without an invoice number the commit would stamp rows with a blank one, which is worse than not loading the file at all:
      // the invoice column is how a delivery is traced back to its paperwork.
      if (!invoice.invoice_number) {
        return res.json({
          return_code: 'NO_INVOICE_NUMBER',
          message: 'The invoice number could not be read from that PDF, so it cannot be applied',
        });
      }

      const entries = await buildPlan(client, invoice);

      // The invoice prints its own total ("Sum of pos. 6 Pair"). If the lines we read do not add up to it, the parse missed
      // something — the screen says so and lets the operator decide, rather than this route deciding for them.
      const parsedPairs = flatten(invoice).reduce((n, l) => n + l.qty, 0);

      return res.json({
        return_code: 'SUCCESS',
        invoice,
        parsed_pairs: parsedPairs,
        totals_agree: invoice.total_invoiced == null ? false : parsedPairs === invoice.total_invoiced,
        entries,
      });
    } catch (err) {
      logger.error('[birk-invoice-preview] error:', err.message);
      return res.json({ return_code: 'SERVER_ERROR', message: 'That invoice could not be read' });
    } finally {
      client.release();
    }
  });
});

module.exports = router;
