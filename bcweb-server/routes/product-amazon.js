/*
=======================================================================================================================================
API Route: product_amazon
=======================================================================================================================================
Method: POST
Purpose: Produce the Amazon Seller Central product-upload file (AMZ-Upload.xlsm) for ONE groupid — the "Amazon upload file" button on
         the Add / Modify screen. This is the on-demand, single-product equivalent of the operator's standalone C:\scripts\amz-product\
         amz_upload.py batch flow.

         Why a Python child process (and not Node): the upload file is a macro-enabled .xlsm built by injecting rows into the SHOES.xlsm
         category template. Amazon only accepts the file because of that embedded VBA/settings payload, and no Node Excel library
         preserves it. openpyxl (keep_vba=True) does. So we shell out to scripts/amz-product/amz_upload_single.py, which is a faithful
         port of the tested standalone script for a single groupid. It writes the .xlsm to a temp path and prints a JSON summary.

         Side effects (owner-confirmed "mirror the script exactly"): the helper stamps skumap (sku, status='1', updated) for the variants
         written and skips any variant already present in the amzfeed table. These are REAL writes to the live prod DB — clicking the
         button both builds the file AND records that those SKUs went to Amazon, exactly as the batch script does.

         Delivery: we keep the standard API envelope (HTTP 200 + return_code). The .xlsm bytes come back base64-encoded in `file` (a single
         manual click, ~0.5 MB — fine inline) so the client can trigger a browser download; errors flow through return_code as usual.
         Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid": "CASSIS-GOLD"   // string, required
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "CASSIS-GOLD",
  "filename": "AMZ-Upload-CASSIS-GOLD.xlsm",
  "variants": 5,            // rows written to the file
  "skipped": 0,            // variants skipped (already in amzfeed, or no EAN)
  "skumapUpdated": 5,      // skumap rows stamped (sku/status/updated)
  "file": "<base64 .xlsm>"
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    // no groupid
"NOT_FOUND"         // groupid not in skusummary
"NO_BRAND"          // product has no brand (Amazon needs it)
"INVALID_RRP"       // rrp is non-numeric junk
"NO_SIZES"          // product has no active variants
"NO_ROWS"           // nothing to write (all variants already on Amazon, or missing EANs)
"GENERATE_FAILED"   // the Python helper failed unexpectedly (missing deps/template, DB error, crash)
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

// The Python interpreter and helper script. PYTHON_BIN overrides the default (e.g. a venv path on the VPS).
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const HELPER = path.join(__dirname, '..', 'scripts', 'amz-product', 'amz_upload_single.py');

// Error codes the helper emits that map straight through to a return_code (anything else -> GENERATE_FAILED).
const PASS_THROUGH = new Set(['NOT_FOUND', 'NO_BRAND', 'INVALID_RRP', 'NO_SIZES', 'NO_ROWS']);

// Run the helper, resolving with its parsed JSON stdout. Rejects with { code, message } on failure so the caller can map it.
function runHelper(groupid, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [HELPER, groupid, outPath], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => reject({ code: 'GENERATE_FAILED', message: `Could not run Python helper: ${err.message}` }));
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
  const outPath = path.join(os.tmpdir(), `amz-upload-${crypto.randomBytes(6).toString('hex')}.xlsm`);
  try {
    const groupid = ((req.body || {}).groupid || '').trim().toUpperCase();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    let summary;
    try {
      summary = await runHelper(groupid, outPath);
    } catch (e) {
      if (PASS_THROUGH.has(e.code)) {
        return res.json({ return_code: e.code, message: e.message });
      }
      logger.error('[product-amazon] generator failed:', e.message);
      return res.json({ return_code: 'GENERATE_FAILED', message: 'Failed to build the Amazon upload file' });
    }

    const buf = await fs.readFile(outPath);
    return res.json({
      return_code: 'SUCCESS',
      groupid,
      filename: `AMZ-Upload-${groupid}.xlsm`,
      variants: summary.variants,
      skipped: summary.skipped,
      skumapUpdated: summary.skumapUpdated,
      file: buf.toString('base64'),
    });
  } catch (err) {
    logger.error('[product-amazon] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to produce the Amazon upload file' });
  } finally {
    // Best-effort cleanup of the temp file (ignore if it was never created).
    fs.unlink(outPath).catch(() => {});
  }
});

module.exports = router;
