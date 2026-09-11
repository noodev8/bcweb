/*
=======================================================================================================================================
API Route: finance_quickfile
=======================================================================================================================================
Method: POST  (multipart/form-data)
Purpose: Finance / Month End, stage 2 — turn the month's figures into the files. Returns the QuickFile sales and purchase invoice
         CSVs, plus kidsvatcharged.csv for the year-end pack. WRITES NOTHING, to the database or to disk.

         Spec: docs/finance-month-end-spec.md §4. Replaces the PowerBuilder QUICKFILE Invoice button.

WHY THE CSV COMES BACK AS TEXT IN THE ENVELOPE
Every response in this API is HTTP 200 plus a return_code (docs/API-RULES.md), and streaming a file body breaks that for the one case
that matters most — a failure. Returning the CSV as a string keeps the envelope intact, lets a failure say why in the normal way, and
means the browser builds the download from something it has already received rather than from a second authenticated request. The
files are a few hundred bytes.

WHY THE FIGURES COME FROM THE CLIENT AND THE FILE DOES NOT
The figures include what the operator typed (SumUp, cash, car), which only the screen has — so they are sent back here. What is NOT
trusted to a round trip is the Amazon file: kidsvatcharged.csv is a verbatim subset of the original rows, so the file itself is
re-uploaded and re-read rather than shipping several hundred rows of raw CSV cells to the browser and back. That also means the kids
file can never disagree with the Amazon export it came from.

THE MONTH IS PASSED IN, NOT DERIVED
This is the fix for the PowerBuilder January bug (spec §9.1): PB computed `month(today) - 1` and decremented the year only when that
came out as "12", which in January it never does — so January produced 28/00/2026 in both files, with the wrong year. Here the month
is the one chosen on the screen and there is no derivation left to get wrong.
=======================================================================================================================================
Request: multipart/form-data
  files     optional — the Amazon Monthly Transaction CSV again, ONLY needed for kidsvatcharged.csv
  month     'YYYY-MM', required
  figures   JSON string, required: { amazon:{gross,vatDeclared,fees,reimbursements}, shopify:{sales,salesVat,refund,refundVat,fees},
                                     paypal:{fees}, manual:{sumupSales,sumupFees,cashSales,car} }

Success Response:
{
  "return_code": "SUCCESS",
  "month": "2026-08",
  "files": [
    { "name": "QuickFile-Sales-Invoice.csv",    "csv": "...", "rows": [ { "client": "Amazon UK", ... } ] },
    { "name": "QuickFile-Purchase-Invoice.csv", "csv": "...", "rows": [ { "supplier": "Amazon", ... } ] },
    { "name": "kidsvatcharged.csv",             "csv": "...", "rows": [] }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_MONTH"     no month, or not YYYY-MM
"MISSING_FIGURES"   no figures, or nothing in them worth writing a row for
"FILE_TOO_LARGE"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { buildSalesCsv, buildPurchaseCsv } = require('../utils/financeQuickFile');
const { computeAmazon, identify: identifyAmazon, buildKidsVatCsv } = require('../utils/financeAmazon');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_FILES = 2;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: MAX_FILES },
});

router.post('/', (req, res) => {
  upload.array('files', MAX_FILES)(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          return res.json({ return_code: 'FILE_TOO_LARGE', message: 'One of the files is larger than 25MB' });
        }
        return res.json({ return_code: 'SERVER_ERROR', message: uploadErr.message || 'Upload failed' });
      }

      const month = String(req.body.month || '').trim();
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.json({ return_code: 'MISSING_MONTH', message: 'A month is required, as YYYY-MM' });
      }

      let figures;
      try {
        figures = JSON.parse(req.body.figures || '{}');
      } catch {
        figures = null;
      }
      if (!figures || typeof figures !== 'object') {
        return res.json({ return_code: 'MISSING_FIGURES', message: 'No figures were supplied' });
      }

      const sales = buildSalesCsv(figures, month);
      const purchase = buildPurchaseCsv(figures, month);

      // Both files being empty means every figure was zero or absent, which is never a real month — almost always the screen was
      // never calculated. Say so rather than handing over two files containing nothing but headers.
      if (sales.rows.length === 0 && purchase.rows.length === 0) {
        return res.json({
          return_code: 'MISSING_FIGURES',
          message: 'Every figure is zero — nothing to write. Calculate the month first.',
        });
      }

      // --- kidsvatcharged.csv ------------------------------------------------------------------------------------------------
      // Only produced when the Amazon file is sent up with this call. Absent, the entry is still returned (empty) rather than
      // silently dropped, so the screen can say WHY there is no kids file instead of leaving a gap in the year-end pack.
      let kidsCsv = buildKidsVatCsv([]);
      let kidsRows = 0;
      let kidsNote = 'The Amazon file was not re-sent, so the kids-VAT file is empty.';

      const amazonFile = (req.files || []).find((f) => identifyAmazon(f.buffer.toString('utf8')).ok);
      if (amazonFile) {
        const result = await computeAmazon(pool, amazonFile.buffer.toString('utf8'));
        if (result.ok) {
          kidsCsv = buildKidsVatCsv(result._zeroRatedRows);
          kidsRows = result._zeroRatedRows.length;
          kidsNote = kidsRows === 0
            // The normal case, and worth spelling out: an empty file here is evidence, not a failure. August 2026 had no zero-rated
            // Amazon sales at all, so PowerBuilder's Kids VAT box read 0.00 and its kidsvatcharged.csv was header-only too.
            ? 'No zero-rated (kids) items sold on Amazon this month — the file is header-only, which is correct.'
            : `${kidsRows} zero-rated row${kidsRows > 1 ? 's' : ''} where Amazon charged VAT.`;
        }
      }

      logger.info(`[finance-quickfile] ${req.user.display_name}: ${month} — ${sales.rows.length} sales rows, ${purchase.rows.length} purchase rows, ${kidsRows} kids rows`);

      return res.json({
        return_code: 'SUCCESS',
        month,
        files: [
          { name: 'QuickFile-Sales-Invoice.csv', csv: sales.csv, rows: sales.rows },
          { name: 'QuickFile-Purchase-Invoice.csv', csv: purchase.csv, rows: purchase.rows },
          { name: 'kidsvatcharged.csv', csv: kidsCsv, rows: [], note: kidsNote, rowCount: kidsRows },
        ],
      });
    } catch (err) {
      logger.error('[finance-quickfile] error:', err.message);
      return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to build the QuickFile files' });
    }
  });
});

module.exports = router;
