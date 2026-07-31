/*
=======================================================================================================================================
API Route: amz_delete_file
=======================================================================================================================================
Method: POST
Purpose: Build the Amazon Seller Central .xlsm that DE-LISTS a set of SKUs — the "Delete file" button on the Update Amazon screen's
         reconciliation panel. It is the counterpart to POST /product-amazon, which builds the file that CREATES listings.

         The job it answers: the import's "on Amazon, unknown to us" bucket (utils/amzImport.js -> planStock, summary.stock.unknownSku)
         is SKUs the FBA inventory report shows Amazon still listing, for which we hold no skumap record. The zero-stock ones are dead
         listings cluttering the catalogue, and the only way to clear them is a Listings feed with the record action set to delete. That
         used to mean hand-editing a legacy Inventory Loader flat file per SKU.

         WHO CHOOSES THE SKUs: the client, not us. The unknown-SKU list only exists inside a just-parsed import summary — nothing is
         stashed server-side between the check and the download (see the header of the update-amazon page: an import is an action, not a
         view). So the caller posts the SKUs it is looking at. That is safe here in a way it would not be for a write route, because this
         route WRITES NOTHING: no DB connection, no amzfeed, no skumap. It is a pure formatter, and the delete only takes effect when the
         operator uploads the file to Seller Central themselves.

         ZERO-STOCK IS THE CALLER'S BAR: the client filters to afn-total-quantity = 0 before posting. Amazon will not remove a listing
         while any units — fulfillable, reserved, unsellable or inbound — sit in a fulfilment centre; the delete either bounces or leaves
         the inventory stranded. This route does not re-check that, because it has no stock data of its own: amzfeed only covers SKUs we
         know, and these are by definition the ones we do not. The bar lives with the data that can enforce it.

         Why a Python child process (identical reasoning to /product-amazon): the file is a macro-enabled .xlsm and Amazon accepts it only
         because of the settings payload embedded in the template. No Node Excel library round-trips that intact; openpyxl (keep_vba=True)
         does. The helper reuses the same in-repo SHOES.xlsm template — a delete row needs three of its 348 columns.

         SKUs go to the helper on STDIN, not argv: the list can run to hundreds and Windows caps a command line at ~32k characters.

         Delivery: standard API envelope (HTTP 200 + return_code), with the .xlsm bytes base64-encoded in `file` so the client can trigger
         a browser download — the same shape /product-amazon uses. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "skus": ["AD-0XF8D-48L", "BK-7712-40"]   // string[], required, 1..1000 entries
}

Success Response:
{
  "return_code": "SUCCESS",
  "filename": "AMZ-Delete-2026-07-31.xlsm",
  "skus": 12,                // rows written (after de-duplication)
  "file": "<base64 .xlsm>"
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    // skus absent, not an array, or empty once trimmed
"NO_ROWS"           // nothing left to write after de-duplication
"TOO_MANY"          // more SKUs than the helper's safety limit for one file
"GENERATE_FAILED"   // the Python helper failed unexpectedly (missing deps/template, crash)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// The Python interpreter and helper script. PYTHON_BIN overrides the default (e.g. a venv path on the VPS) — same var /product-amazon
// uses, so there is only ever one interpreter to configure.
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const HELPER = path.join(__dirname, '..', 'scripts', 'amz-product', 'amz_delete_file.py');

// Error codes the helper emits that map straight through to a return_code (anything else -> GENERATE_FAILED).
const PASS_THROUGH = new Set(['NO_ROWS', 'TOO_MANY']);

// Guard against a client posting something enormous before we even spawn Python. The helper enforces its own limit too — this one just
// keeps a nonsense payload from reaching a child process.
const MAX_SKUS = 1000;

/** Run the helper with the SKU list on stdin, resolving with its parsed JSON stdout. Rejects with { code, message }. */
function runHelper(skus, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [HELPER, outPath], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => reject({ code: 'GENERATE_FAILED', message: `Could not run Python helper: ${err.message}` }));

    // A write to a child that already died raises EPIPE; the 'error'/'close' handlers own the outcome, so swallow it here.
    proc.stdin.on('error', () => {});
    proc.stdin.end(JSON.stringify(skus));

    proc.on('close', (exitCode) => {
      // The helper always prints a JSON line (summary on success, {error,message} on failure). Parse the last non-empty line.
      let parsed = null;
      const line = stdout.trim().split('\n').filter(Boolean).pop();
      if (line) { try { parsed = JSON.parse(line); } catch { /* fall through to the generic error below */ } }

      if (exitCode === 0 && parsed && !parsed.error) return resolve(parsed);
      if (parsed && parsed.error) return reject({ code: parsed.error, message: parsed.message || 'Generation failed' });
      // No parseable JSON — surface stderr for the logs, generic error to the client.
      return reject({ code: 'GENERATE_FAILED', message: (stderr || stdout || 'Unknown generator error').trim() });
    });
  });
}

router.post('/', async (req, res) => {
  // Unique temp path per request so concurrent clicks never collide; cleaned up in finally.
  const outPath = path.join(os.tmpdir(), `amz-delete-${crypto.randomBytes(6).toString('hex')}.xlsm`);
  try {
    const raw = (req.body || {}).skus;
    if (!Array.isArray(raw)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'skus must be an array' });
    }
    const skus = raw.map((s) => String(s ?? '').trim()).filter(Boolean);
    if (skus.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'skus is empty' });
    }
    if (skus.length > MAX_SKUS) {
      return res.json({ return_code: 'TOO_MANY', message: `${skus.length} SKUs exceeds the ${MAX_SKUS} limit for one delete file` });
    }

    let summary;
    try {
      summary = await runHelper(skus, outPath);
    } catch (e) {
      if (PASS_THROUGH.has(e.code)) {
        return res.json({ return_code: e.code, message: e.message });
      }
      logger.error('[amz-delete-file] generator failed:', e.message);
      return res.json({ return_code: 'GENERATE_FAILED', message: 'Failed to build the Amazon delete file' });
    }

    const buf = await fs.readFile(outPath);
    // Dated filename: an operator may build one of these on several days running, and Downloads should not turn them into
    // "AMZ-Delete (3).xlsm". Built from the server's local date, which is the operator's day.
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return res.json({
      return_code: 'SUCCESS',
      filename: `AMZ-Delete-${stamp}.xlsm`,
      skus: summary.skus,
      file: buf.toString('base64'),
    });
  } catch (err) {
    logger.error('[amz-delete-file] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to produce the Amazon delete file' });
  } finally {
    // Best-effort cleanup of the temp file (ignore if it was never created).
    fs.unlink(outPath).catch(() => {});
  }
});

module.exports = router;
