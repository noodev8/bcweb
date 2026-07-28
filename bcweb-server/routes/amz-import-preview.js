/*
=======================================================================================================================================
API Route: amz_import_preview
=======================================================================================================================================
Method: POST  (multipart/form-data)
Purpose: Update Amazon module, stage 1 — READ-ONLY. Take the operator's uploaded Amazon reports, work out exactly what a commit
         would do, and hand back a full account of it. WRITES NOTHING.

         This route exists because of how the legacy PowerBuilder import failed. `FileOpen` on a missing file returns -1, the read
         loop exits immediately, and the datastore stays empty — silently. Two of its five inputs had been failing that way for a
         long time and there was no way to know: the button simply ran and said nothing. So the design rule here is that the operator
         sees what a run will do BEFORE it does it, with every row accounted for:

             rows in the file  =  written  +  already there  +  skipped (each with a reason)

         Uploads are matched to reports by HEADER CONTENT, never by filename — Seller Central hands these over as opaque numeric
         names (118981020662.txt) that carry no meaning and change every download. Any file that doesn't fingerprint as one of the
         four known reports is rejected by name with the reason, rather than being quietly ignored.

Partial runs are first-class (design doc §3.2): upload any subset of the four. Whatever is absent simply isn't touched — uploading
only the orders report cannot disturb stock, and uploading only the inventory report cannot disturb sales history.

Note the client sends the files again to /amz-import-commit. Nothing is stashed server-side between the two calls: there is no
temp-file lifecycle to leak or expire, and commit re-derives the plan from the database inside its own transaction, so a stale
preview can never be committed blind.
=======================================================================================================================================
Request: multipart/form-data with 1-4 files under the field name `files`.

Success Response:
{
  "return_code": "SUCCESS",
  "rejected": [ { "filename": "buybox.csv", "reason": "Header not recognised as any of the four Amazon reports..." } ],
  "summary": {
    "files": [ { "type":"ORDERS", "label":"Orders", "rowsInFile":774, "usable":747, "skipped":27,
                 "skipReasons":[{"reason":"CANCELLED","label":"...","count":16,"examples":[...]}],
                 "window":{"from":"2026-06-28","to":"2026-07-28"}, "newColumns":[], "droppedColumns":[] } ],
    "sales": { "written":744, "units":746, "value":30324.41, "alreadyImported":0, "alreadyInDbFromLegacy":744, ... },
    "returns": {...}, "cancellations": {...}, "fees": {...}, "stock": {...}, "reconciliation": {...}
  }
}
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NO_FILES" · "TOO_MANY_FILES" · "FILE_TOO_LARGE" · "DUPLICATE_REPORT" · "NO_VALID_FILES" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { buildPlan, readUploads } = require('../utils/amzImport');
const { shapePlan } = require('../utils/amzImportShape');
const logger = require('../utils/logger');

router.use(verifyToken);

// In memory — these are text reports (the largest sample is 230KB) and nothing needs to touch disk. 25MB each is far above any real
// report while still capping a runaway upload; decision D7 removed the window limit, so a 12-month orders backfill must fit.
const MAX_FILES = 4;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: MAX_FILES },
});

router.post('/', (req, res) => {
  // Run multer ourselves so its errors become our JSON envelope rather than a raw 4xx (docs/API-RULES.md: every response is HTTP 200
  // plus a return_code).
  upload.array('files', MAX_FILES)(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          return res.json({ return_code: 'FILE_TOO_LARGE', message: 'One of the files is larger than 25MB' });
        }
        if (uploadErr.code === 'LIMIT_FILE_COUNT' || uploadErr.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.json({ return_code: 'TOO_MANY_FILES', message: `Upload up to ${MAX_FILES} files at once` });
        }
        return res.json({ return_code: 'SERVER_ERROR', message: uploadErr.message || 'Upload failed' });
      }

      const files = req.files || [];
      if (files.length === 0) {
        return res.json({ return_code: 'NO_FILES', message: 'No files were uploaded' });
      }

      const { parsed, cancellations, rejected, duplicate } = readUploads(files);
      if (duplicate) {
        return res.json({
          return_code: 'DUPLICATE_REPORT',
          message: `Two of the uploaded files are both the ${duplicate} report. Upload one of each report type.`,
        });
      }

      if (Object.keys(parsed).length === 0) {
        // Every file was rejected. Hand back the per-file reasons — this is precisely the case the legacy code turned into silence.
        return res.json({
          return_code: 'NO_VALID_FILES',
          message: 'None of the uploaded files could be identified as an Amazon report',
          rejected,
        });
      }

      // Read-only: buildPlan only SELECTs. No transaction needed — a preview that reads slightly-moving data is fine, because the
      // commit re-derives everything inside its own transaction rather than trusting this.
      const plan = await buildPlan(pool, parsed, cancellations);
      const summary = shapePlan(parsed, plan, { committed: false });

      logger.info(`[amz-import-preview] ${req.user.display_name}: ${Object.keys(parsed).join('+')} -> ${summary.sales.written} sales, ${summary.returns.written} returns, ${summary.fees.updated} fees, ${summary.cancellations.rows} retractions`);

      return res.json({ return_code: 'SUCCESS', rejected, summary });
    } catch (err) {
      logger.error('[amz-import-preview] error:', err.message);
      // The migration adding sales.source_key must be applied before this module can run. Name it rather than leaving a bare 500,
      // because it is the one predictable setup failure.
      if (/source_key/.test(err.message)) {
        return res.json({
          return_code: 'SERVER_ERROR',
          message: 'The sales.source_key column is missing — apply migrations/2026-07-28-amz-import-source-key.sql first.',
        });
      }
      return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to preview the Amazon import' });
    }
  });
});

module.exports = router;
