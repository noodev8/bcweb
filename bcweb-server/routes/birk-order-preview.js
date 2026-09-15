/*
=======================================================================================================================================
API Route: birk_order_preview
=======================================================================================================================================
Method: POST (multipart/form-data)
Purpose: Birk Tracker module — read a Birkenstock order export (.xlsx) and say what loading it WOULD do to the order book. READ ONLY:
         not one row is written here. The operator reviews the plan, corrects any style the system had to guess, and only then calls
         /birk-order-commit.

The port of the legacy PowerBuilder "Bulk Upload" button. That button filled the grid from orders.csv and the operator pressed Save;
this is the same two beats, with the grid replaced by a review dialog. The transforms (code, bksize, due month, 10-digit order number)
live in utils/birkOrder.js with their reasons.

WHAT COMES BACK PER LINE (`kind`):
  new      the book has no row for (ordernum, code) — loading inserts it. The ordinary case: a fresh confirmation.
  changed  a row exists and the file restates its ORDER fields differently (Birkenstock revised the confirmation: a quantity, a
           price, a month). Loading updates those fields only — invoiced / arrived / the invoice stamp are never touched.
  same     a row exists and the file agrees with it. Nothing to do; almost always the same file loaded twice.
Plus, per order, `not_in_file`: rows the book holds for that order that this file does not mention. Reported, never deleted — a line
Birkenstock dropped from a revision is something to go and ask about, and rows here may already carry invoices.

THE FILE NEVER TOUCHES DISK. multer keeps it in memory, it is parsed, and the buffer is dropped when the request ends.
=======================================================================================================================================
Request: multipart/form-data with one field `file` — the order export .xlsx.

Success Response:
{
  "return_code": "SUCCESS",
  "orders": ["0002268001"],            // distinct order numbers in the file
  "lines_read": 80,                    // size lines with a confirmed quantity
  "skipped_unconfirmed": 0,            // size lines confirming 0 — dropped, as the legacy did
  "pairs": 235,                        // confirmed pairs across lines_read
  "currencies": ["GBP"],               // anything other than GBP is worth a second look before loading
  "styles": [
    { "ordernum": "0002268001", "article": "0943871", "material": "Gizeh Birko-Flor Women", "colour": "Graceful Pearl White",
      "width": "Regular", "style": "GIZEH", "style_source": "skumap",      // skumap | book | rule | guess — see utils/birkOrder.js
      "cost": "37.50", "rrp": "90.00", "currency": "GBP", "due": "MAR", "placedate": "15/09/2026",
      "lines": [ { "code": "0943871-GIZEH-38", "size": "38", "bksize": "245/5", "requested": 4, "cost": "37.50", "rrp": "90.00",
                   "due": "MAR", "placedate": "15/09/2026", "ean": "4040714894232", "in_skumap": true, "kind": "new" } ] }
  ],
  "not_in_file": [ { "ordernum": "0002268001", "code": "0034701-MILANO-44", "requested": 2, "invoiced": 0, "arrived": 0 } ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"NO_FILE"
"NOT_AN_XLSX"         not a zip / not a spreadsheet (a .csv or .xls renamed, or the wrong file entirely)
"NOT_AN_ORDER_FILE"   a spreadsheet, but without the portal's column headings — the message names the missing ones
"NO_ORDER_LINES"      the right headings, but no line confirms a quantity
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { parseOrderFile, buildOrderPlan } = require('../utils/birkOrder');
const logger = require('../utils/logger');

router.use(verifyToken);

// One spreadsheet, in memory. The sample is 17KB for 80 lines; 15MB is a whole season many times over and still cannot tie up the box.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

router.post('/', (req, res) => {
  // multer is run by hand so its own failures come back as our JSON envelope rather than a raw 4xx (docs/API-RULES.md).
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      logger.error('[birk-order-preview] upload error:', uploadErr.message);
      return res.json({ return_code: 'NO_FILE', message: 'That file could not be read — is it under 15MB?' });
    }
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.json({ return_code: 'NO_FILE', message: 'No file was attached' });
    }
    // Magic bytes, not the extension: an .xlsx is a zip ("PK\x03\x04"). The old PowerBuilder flow took a CSV, so a CSV is the most
    // likely wrong file, and it deserves a message that says what to do rather than a parse error.
    if (req.file.buffer.slice(0, 4).toString('latin1') !== 'PK') {
      return res.json({
        return_code: 'NOT_AN_XLSX',
        message: 'That is not an .xlsx file — Load order expects the Excel export from the Birkenstock portal, as downloaded',
      });
    }

    try {
      let parsed;
      try {
        parsed = parseOrderFile(req.file.buffer);
      } catch (parseErr) {
        logger.error('[birk-order-preview] parse error:', parseErr.message);
        return res.json({ return_code: 'NOT_AN_XLSX', message: 'That spreadsheet could not be read' });
      }

      if (parsed.missing_columns.length) {
        return res.json({
          return_code: 'NOT_AN_ORDER_FILE',
          message: `That does not look like a Birkenstock order export — missing column(s): ${parsed.missing_columns.join(', ')}`,
        });
      }
      if (!parsed.lines.length) {
        return res.json({
          return_code: 'NO_ORDER_LINES',
          message: parsed.skipped_unconfirmed
            ? `Nothing to load — none of the ${parsed.skipped_unconfirmed} line(s) has a confirmed quantity yet`
            : 'Nothing to load — the file has no order lines',
        });
      }
      // A line with no order number or article cannot be keyed into the book at all. Refuse the file rather than load it partly:
      // a hole in an order confirmation means the file is not what it seems.
      const broken = parsed.lines.filter((l) => !l.ordernum || !l.article || !l.size);
      if (broken.length) {
        return res.json({
          return_code: 'NOT_AN_ORDER_FILE',
          message: `${broken.length} line(s) have no order number, product ID or size — check the file`,
        });
      }

      const plan = await buildOrderPlan(pool, parsed);

      return res.json({
        return_code: 'SUCCESS',
        orders: [...new Set(parsed.lines.map((l) => l.ordernum))].sort(),
        lines_read: parsed.lines.length,
        skipped_unconfirmed: parsed.skipped_unconfirmed,
        pairs: parsed.lines.reduce((n, l) => n + l.requested, 0),
        currencies: [...new Set(parsed.lines.map((l) => l.currency).filter(Boolean))],
        styles: plan.styles,
        not_in_file: plan.not_in_file,
      });
    } catch (err) {
      logger.error('[birk-order-preview] error:', err.message);
      return res.json({ return_code: 'SERVER_ERROR', message: 'That order file could not be read' });
    }
  });
});

module.exports = router;
