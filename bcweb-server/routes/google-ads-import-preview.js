/*
=======================================================================================================================================
API Route: google_ads_import_preview
=======================================================================================================================================
Method: POST  (multipart/form-data)
Purpose: Google Ads module, import stage 1 — READ-ONLY. Take the operator's uploaded Google Ads report(s), work out exactly what a
         commit would do, and hand back a full account of it. WRITES NOTHING.

         Requires auth.

WHY A PREVIEW AT ALL
Two reasons, both learned the hard way on this data:

  1. THE IMPORT IS THE ONLY THING STANDING BETWEEN A CSV AND THE NUMBERS THE OWNER REPRICES ON. A row misread as zero spend, or a
     date read a day out, changes a decision and leaves no trace. Every row this import does NOT write is therefore accounted for by
     reason, and the preview shows the arithmetic:

         rows in file  =  written  +  unchanged  +  skipped

  2. RE-IMPORTING AN OVERLAPPING WINDOW IS THE NORMAL CASE, not the exception. Google revises conversions upward for weeks, so the
     operator is expected to download the same 30 days again and again. `unchanged` is what tells them a re-import was a genuine
     no-op rather than something silently going wrong.

BOTH REPORTS, EITHER REPORT, ONE CALL
Upload the product report, the campaign report, or both. Whatever is absent is simply not touched. Files are matched to reports by
HEADER CONTENT, never by filename — the operator names these files whatever the browser gives them.

THE LABEL MISMATCH FIGURE IS NOT AN ERROR
`labelMismatch` counts styles where Google reported a different bucket than skusummary.googlecampaign says. That is EXPECTED on an
old window (the feed takes ~a day to propagate, and before the 2026-09-05 reset the label was not maintained at all). It matters on a
FRESH window: a mismatch there means the feed has stopped reaching Google, which is exactly the failure that stranded 23 styles on a
dead 'birk-winner' label for four months with nothing to announce it. The preview reports it; the operator judges it.

Note the client sends the files again to /google-ads-import-commit. Nothing is stashed server-side between the two calls: there is no
temp-file lifecycle to leak or expire, and commit re-derives the plan from the database inside its own transaction, so a stale
preview can never be committed blind.
=======================================================================================================================================
Request: multipart/form-data with 1-2 files under the field name `files`.

Success Response:
{
  "return_code": "SUCCESS",
  "rejected": [ { "filename": "keywords.csv", "reason": "Not recognised as either Google Ads export..." } ],
  "product": {
    "label": "Product performance (bcweb_product_30)",
    "filename": "bcweb_product_30.csv",
    "window": { "from": "2026-08-06", "to": "2026-09-04", "days": 30 },
    "rowsInFile": 5855,
    "counts": { "write": 5855, "unchanged": 0, "skipped": 0, "balances": true },
    "skipped": [],
    "extraColumns": [],
    "styles": { "inFile": 226, "unmatched": 0, "unmatchedExamples": [] },
    "labelMismatch": { "styles": 23, "ofStyles": 226,
                       "examples": [ { "groupid": "1005299-GIZEH", "googleSays": "BIRK-WINNER", "weSay": "standard" } ] },
    "campaigns": [ "STANDARD" ],
    "totals": { "impressions": 383557, "clicks": 8672, "cost": 3645.11, "conversions": 316.22, "convValue": 20436.98 },
    "emptyDays": []
  },
  "campaign": { ... same shape, plus "censoredShareDays"; no styles/labelMismatch ... }
}
  - `product` / `campaign` are null when that report was not uploaded.
  - `write` rows themselves are NOT returned — the counts and totals describe them. The client re-sends the files to commit.
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
const { readUploads, buildPlan } = require('../utils/googleAdsImport');
const logger = require('../utils/logger');

router.use(verifyToken);

// Two reports, and a 12-month product backfill is ~70k rows / ~5MB. 25MB matches the Amazon import's ceiling and leaves plenty of
// room for a multi-year pull without inviting someone to upload something that is not a report at all.
const MAX_FILES = 2;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: MAX_FILES },
});

/** Strip the plan down to what the preview reports. `write` holds the actual rows and would be megabytes over the wire. */
function shape(plan) {
  if (!plan) return null;
  const { write: _write, ...rest } = plan;
  return rest;
}

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

      // A plain pooled client, no transaction: the plan only READS. Using withTransaction here would open and hold a write
      // transaction for the length of a large preview for no benefit.
      const client = await pool.connect();
      let plan;
      try {
        plan = await buildPlan(client, parsed);
      } finally {
        client.release();
      }

      return res.json({
        return_code: 'SUCCESS',
        rejected,
        product: shape(plan.product),
        campaign: shape(plan.campaign),
      });
    } catch (err) {
      logger.error('[google-ads-import-preview] failed:', err.message);
      return res.json({ return_code: 'SERVER_ERROR', message: 'Could not read the report' });
    }
  });
});

module.exports = router;
