/*
=======================================================================================================================================
API Route: amz_import_commit
=======================================================================================================================================
Method: POST  (multipart/form-data)
Purpose: Update Amazon module, stage 2 — THE WRITE. Ingest the uploaded Amazon reports, then bring `amzfeed` back in step with
         `sales` for PowerBuilder. Everything happens in ONE transaction: a run either lands completely or not at all.

         This replaces the legacy of_updateamzdatadb + of_amzsalesload pair. It is not a transliteration of them — see the design
         doc — but the two behaviours worth restating here are the ones that look like omissions if you don't know:

         * `amzfeed` is NOT rebuilt from a five-file join any more. Its stock columns come from the inventory report, and its five
           SALES columns are DERIVED from the `sales` table (phase 2/3 below). The legacy code computed those by re-scanning the
           whole orders file once per SKU (of_updateamzdatadb:330-374) — an O(n^2) walk that produced numbers already available in
           `sales`. That scan is what made the button slow, and it is gone.

         * PHASE 3 EXISTS ONLY FOR POWERBUILDER. BCWEB reads none of those five columns; `of_filteramzdisplay:220-230` does.
           PowerBuilder is still in service (decision D1), so they stay populated. When PB is retired, delete phase 3 and its call
           site — nothing else in this file depends on it.

THE THREE PHASES (design doc §3.2). Order matters and is enforced here regardless of the order files were dropped:
    PHASE 1  INGEST   orders + returns -> sales | fee report -> skumap.fbafee | inventory -> amzfeed stock columns
    PHASE 2  DERIVE   two grouped queries over sales — a FIXED 30-day window, plus 7 days
    PHASE 3  PROJECT  write those derived values onto amzfeed, for PowerBuilder

Sales must be inserted before phase 2 or the derived columns would lag a run behind. Returns are inserted after sales for the same
reason within phase 1: a return in this upload may reverse a sale that is only just arriving, and the reversal reads the original
row's profit.

PARTIAL RUNS ARE FIRST CLASS. Upload any subset. A phase whose file is absent does not run, and phases 2-3 always run because they
read `sales` rather than any file — so the derived columns stay correct no matter which combination was uploaded.

IDEMPOTENCY. Sales/returns carry a `source_key` (see migrations/2026-07-28-amz-import-source-key.sql) so re-uploading the same file
is a genuine no-op and an overlapping or 12-month backfill window converges instead of duplicating (decision D7).
=======================================================================================================================================
Request: multipart/form-data with 1-4 files under the field name `files`.

Success Response:
{ "return_code": "SUCCESS", "rejected": [...], "summary": { ...same shape as the preview, with "committed": true... },
  "derived": { "skusTouched": 522, "windowDays": 30 } }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NO_FILES" · "TOO_MANY_FILES" · "FILE_TOO_LARGE" · "DUPLICATE_REPORT" · "NO_VALID_FILES" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { buildPlan, readUploads, SOLD_WINDOW_DAYS } = require('../utils/amzImport');
// The three write phases live in a util so they can be rehearsed directly against a BEGIN...ROLLBACK client, without an HTTP layer.
const { insertSales, retractCancelled, applyFees, applyStock, projectDerivedToAmzfeed, projectDerivedToSkumap } = require('../utils/amzImportApply');
const { shapePlan } = require('../utils/amzImportShape');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_FILES = 4;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: MAX_FILES },
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------------------------------------------------------------

router.post('/', (req, res) => {
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
      if (files.length === 0) return res.json({ return_code: 'NO_FILES', message: 'No files were uploaded' });

      const { parsed, cancellations, rejected, duplicate } = readUploads(files);
      if (duplicate) {
        return res.json({
          return_code: 'DUPLICATE_REPORT',
          message: `Two of the uploaded files are both the ${duplicate} report. Upload one of each report type.`,
        });
      }
      if (Object.keys(parsed).length === 0) {
        return res.json({ return_code: 'NO_VALID_FILES', message: 'None of the uploaded files could be identified as an Amazon report', rejected });
      }

      const result = await withTransaction(async (client) => {
        // Rebuild the plan INSIDE the transaction rather than trusting anything the preview computed. The client re-sends the files,
        // never a stale plan, so what gets written is always derived from the database as it is right now.
        const plan = await buildPlan(client, parsed, cancellations);

        // --- PHASE 1: ingest -------------------------------------------------------------------------------------------------
        // Cancellations first: retracting a sale before re-reading the same order keeps the two from fighting when an order appears
        // as Cancelled in this file but was Pending in a previous upload.
        const retracted = await retractCancelled(client, plan.cancellations);

        // Sales before returns — a return in this same upload may reverse a sale that is only just arriving.
        const salesInserted = await insertSales(client, plan.sales.insert);
        const returnsInserted = await insertSales(client, plan.returns.insert);

        const feesUpdated = await applyFees(client, plan.fees);

        let stockResult = { upserted: 0, zeroed: 0 };
        if (parsed.INVENTORY) stockResult = await applyStock(client, parsed.INVENTORY.rows, plan.ref);

        // --- PHASES 2 + 3: derive from sales, project onto amzfeed (PowerBuilder only) ---------------------------------------
        // Always runs, whatever was uploaded: it reads `sales`, not any file, so the derived columns stay correct after a partial
        // run. This is the piece to delete when PowerBuilder is retired.
        const skusTouched = await projectDerivedToAmzfeed(client);
        // The two legacy skumap columns (decision O1). Kept current so the PowerBuilder import can be stood down without them going
        // stale — which is the whole point of being able to run one system instead of two.
        const skumapTouched = await projectDerivedToSkumap(client);

        return { plan, retracted, salesInserted, returnsInserted, feesUpdated, stockResult, skusTouched, skumapTouched };
      });

      const summary = shapePlan(parsed, result.plan, { committed: true });

      logger.info(
        `[amz-import-commit] ${req.user.display_name}: +${result.salesInserted} sales, +${result.returnsInserted} returns, ` +
        `-${result.retracted} retracted, ${result.feesUpdated} fees, ${result.stockResult.upserted} stock rows ` +
        `(${result.stockResult.zeroed} zeroed), ${result.skusTouched} amzfeed rows re-derived`
      );

      return res.json({
        return_code: 'SUCCESS',
        rejected,
        summary,
        applied: {
          salesInserted: result.salesInserted,
          returnsInserted: result.returnsInserted,
          salesRetracted: result.retracted,
          feesUpdated: result.feesUpdated,
          stockRowsWritten: result.stockResult.upserted,
          stockRowsZeroed: result.stockResult.zeroed,
        },
        derived: { skusTouched: result.skusTouched, skumapTouched: result.skumapTouched, windowDays: SOLD_WINDOW_DAYS },
      });
    } catch (err) {
      logger.error('[amz-import-commit] error:', err.message);
      if (/source_key/.test(err.message)) {
        return res.json({
          return_code: 'SERVER_ERROR',
          message: 'The sales.source_key column is missing — apply migrations/2026-07-28-amz-import-source-key.sql first.',
        });
      }
      return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to import the Amazon files — nothing was written' });
    }
  });
});

module.exports = router;
