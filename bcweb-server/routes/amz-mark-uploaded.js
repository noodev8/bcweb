/*
=======================================================================================================================================
API Route: amz_mark_uploaded
=======================================================================================================================================
Method: POST
Purpose: Confirm that a downloaded Seller Central file has ACTUALLY been uploaded to Amazon, so its price changes leave the upload basket
         (GET /amz-basket, which shows only uploaded_at IS NULL rows). Amazon has no live push: an Apply just logs the price
         (POST /amz-apply) and it reaches Amazon when someone downloads ONE file and uploads it by hand. Without this step the basket was
         a pure rolling-window VIEW with no notion of "done", so the operator could never tell whether a colleague — or last-night-they —
         had already uploaded. This is the explicit "I've uploaded — clear these" confirmation the operator presses AFTER the file is in
         Seller Central (deliberately not auto-on-download: a download can be a preview, and a Seller Central upload can fail after the file
         has already been fetched — so nothing clears until a human confirms it went live).

         TEAM-WIDE: uploaded_by records who confirmed (resolved server-side from the token, never sent by the client), and the stamp is
         visible to everyone via GET /amz-basket's lastUpload summary — so the whole team sees one shared "done" state.

WHICH ROWS GET STAMPED (the subtle bit): the client sends the log-row `ids` its downloaded file covered (the latest PENDING row per SKU,
which is exactly what the file's one-line-per-SKU price set contains). For each of those, we stamp that row AND every OLDER still-pending
row for the SAME code (id <= the passed id). Two failure modes this defends against:
  - Supersede-before-download: a SKU changed twice while still pending -> the file carries only the latest price, but the earlier pending
    row must also be retired, else the basket's DISTINCT-ON would resurface that older price after the newest row is stamped. Stamping all
    same-code rows up to the downloaded id fixes that (the earlier intended price was overwritten by the later one, which IS in the file).
  - Change-AFTER-download: a new price applied after the file was built has a HIGHER id than anything downloaded, so id <= max excludes it
    — it stays pending and still needs uploading. This is the SAFE direction: we never mark-as-uploaded a change the file didn't contain
    (which would silently strand a real price change), we only ever risk leaving something pending (a harmless idempotent re-upload later).

uploaded_at = now() (all rows in one call share the instant, forming a "batch" the basket's lastUpload summary can group). Wrapped in
withTransaction. Never writes amzfeed (READ ONLY). Requires auth.
=======================================================================================================================================
Request Payload:
{ "ids": [4821, 4822, 4830] }   // the amz_price_log row ids in the downloaded file (latest pending row per SKU)

Success Response:
{ "return_code": "SUCCESS", "updated": 4 }   // updated = rows actually stamped (>= ids.length, since older same-code pending rows fold in)
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Cap the batch so a malformed request can't sweep the whole log in one call. A basket is at most a few hundred SKUs in practice.
const MAX_IDS = 2000;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { ids } = body;

    // ids must be a non-empty array of positive integers, within the cap. Normalise + dedupe defensively.
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `ids must be a non-empty array of at most ${MAX_IDS} log-row ids` });
    }
    const cleanIds = Array.from(new Set(
      ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    ));
    if (cleanIds.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ids must contain at least one positive integer log-row id' });
    }

    // uploaded_by = the confirming operator, resolved server-side from the token — never sent by the client (CLAUDE.md convention).
    const uploadedBy = req.user.display_name;

    // Derive, from the passed ids, the max id per code (the downloaded row for each SKU), then stamp that row and every OLDER still-pending
    // row for the same code. Set-based, parameterised (no interpolation of the id array). Only pending rows (uploaded_at IS NULL) are
    // touched — re-confirming an already-stamped batch is a no-op. RETURNING counts what actually changed.
    const result = await withTransaction((client) =>
      client.query(
        `UPDATE amz_price_log u
            SET uploaded_at = now(), uploaded_by = $2
           FROM (
             SELECT code, MAX(id) AS max_id
               FROM amz_price_log
              WHERE id = ANY($1::int[])
              GROUP BY code
           ) f
          WHERE u.code = f.code
            AND u.id <= f.max_id
            AND u.uploaded_at IS NULL
         RETURNING u.id`,
        [cleanIds, uploadedBy]
      )
    );

    return res.json({ return_code: 'SUCCESS', updated: result.rowCount });
  } catch (err) {
    logger.error('[amz-mark-uploaded] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark the upload as done' });
  }
});

module.exports = router;
