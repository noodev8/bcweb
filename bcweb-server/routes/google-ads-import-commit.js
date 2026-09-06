/*
=======================================================================================================================================
API Route: google_ads_import_commit
=======================================================================================================================================
Method: POST  (multipart/form-data)
Purpose: Google Ads module, import stage 2 — write the uploaded report(s) into the database. One transaction, all or nothing.

         Requires auth.

THE PLAN IS REBUILT HERE, NOT TRUSTED FROM THE PREVIEW
The client re-sends the FILES, never a plan. This route parses them again and rebuilds the plan inside its own transaction, so what
gets written is always derived from the database as it is right now. A preview taken ten minutes ago cannot be committed blind, and
there is no server-side temp state to expire or leak.

UPSERT, NOT REPLACE
Rows land with `ON CONFLICT DO UPDATE` on the natural key — (snapshot_date, groupid, campaign) for products, (snapshot_date,
campaign) for campaigns. Re-importing an overlapping window is the NORMAL case: Google revises conversions upward for weeks after
the click, so the same 30 days will be downloaded repeatedly and the later figure is the better one. Nothing duplicates and nothing
double-counts. The full reasoning, including why this is not delete-then-insert, is in utils/googleAdsImport.js's header.

THE WINDOW COMES FROM THE FILE
Nothing here assumes 30 days. Change the saved report to Last 7, Last 90 or a custom range and this imports whatever days are in it —
which is what makes "download it whenever I feel like it" work, and what let the 12 Jul - 2 Aug 2026 hole be filled after the fact.

⚠ google_campaign_daily CURRENTLY HAS A SECOND WRITER
C:\scripts\google-ads\update_google_stock_track.py also upserts this table from the same CSV, nightly. Both do the identical
idempotent upsert from the identical source so they cannot produce conflicting rows — but that script's CSV half is being retired
(docs/google-ads-spec.md §6.6) precisely so only one route into the table remains. Until it is, a window the Python already took
shows up here as `unchanged`, which is correct. Do not "fix" that by making this route replace rows instead.

google_product_daily has only ever had one writer: this route.
=======================================================================================================================================
Request: multipart/form-data with 1-2 files under the field name `files`.

Success Response:
{
  "return_code": "SUCCESS",
  "rejected": [],
  "product":  { "written": 5855, "unchanged": 0, "skipped": 0, "window": { "from": "2026-08-06", "to": "2026-09-04", "days": 30 } },
  "campaign": { "written": 0,    "unchanged": 181, "skipped": 0, "window": { "from": "2026-04-04", "to": "2026-09-04", "days": 154 } }
}
  - `product` / `campaign` are null when that report was not uploaded.
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
const { readUploads, buildPlan, applyProduct, applyCampaign } = require('../utils/googleAdsImport');
const { writeBcLog } = require('../utils/bclog');
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
        if (uploadErr.code === 'LIMIT_FILE_COUNT' || uploadErr.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.json({ return_code: 'TOO_MANY_FILES', message: `Upload up to ${MAX_FILES} files at once` });
        }
        return res.json({ return_code: 'SERVER_ERROR', message: uploadErr.message || 'Upload failed' });
      }

      const files = req.files || [];
      if (files.length === 0) return res.json({ return_code: 'NO_FILES', message: 'No files were uploaded' });

      const { parsed, rejected, duplicate } = readUploads(files);

      if (duplicate) {
        return res.json({
          return_code: 'DUPLICATE_REPORT',
          message: `Two of the uploaded files are both the ${duplicate} export. Upload one of each report, or one at a time.`,
        });
      }
      if (Object.keys(parsed).length === 0) {
        return res.json({
          return_code: 'NO_VALID_FILES',
          message: 'None of the uploaded files could be identified as a Google Ads report',
          rejected,
        });
      }

      // `changed_by` is resolved server-side from the JWT and never sent by the client (CLAUDE.md).
      const who = req.user.display_name || 'unknown';

      const result = await withTransaction(async (client) => {
        // Rebuilt inside the transaction — see the header. Not the preview's plan.
        const plan = await buildPlan(client, parsed);

        const out = { product: null, campaign: null };

        if (plan.product) {
          const { written } = await applyProduct(client, plan.product.write, who);
          out.product = {
            written,
            unchanged: plan.product.counts.unchanged,
            skipped: plan.product.counts.skipped,
            window: plan.product.window,
          };
        }

        if (plan.campaign) {
          const { written } = await applyCampaign(client, plan.campaign.write);
          out.campaign = {
            written,
            unchanged: plan.campaign.counts.unchanged,
            skipped: plan.campaign.counts.skipped,
            window: plan.campaign.window,
          };
        }

        // Audit row, inside the transaction so it lands or rolls back WITH the import it describes. Read back by
        // /google-ads-import-last to drive the screen's freshness banner.
        const parts = [];
        if (out.product) parts.push(`product ${out.product.written}/${plan.product.rowsInFile} rows ${plan.product.window ? `${plan.product.window.from}..${plan.product.window.to}` : ''}`);
        if (out.campaign) parts.push(`campaign ${out.campaign.written}/${plan.campaign.rowsInFile} rows ${plan.campaign.window ? `${plan.campaign.window.from}..${plan.campaign.window.to}` : ''}`);
        await writeBcLog(client, { who, section: 'Google Ads', log: `Import: ${parts.join('; ')}` });

        return out;
      });

      return res.json({ return_code: 'SUCCESS', rejected, ...result });
    } catch (err) {
      logger.error('[google-ads-import-commit] failed:', err.message);
      return res.json({ return_code: 'SERVER_ERROR', message: 'The import failed and nothing was written' });
    }
  });
});

module.exports = router;
