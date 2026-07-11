/*
=======================================================================================================================================
Module: utils/googleMerchant.js
=======================================================================================================================================
Purpose: Keep Google Merchant Center's price in step with a Shopify Pricing apply (W1), the same way utils/shopify.js keeps Shopify in
         step. Without this, Google Shopping/ads would keep showing the OLD price after an Apply until the next nightly
         C:\scripts\merchant-feed\merchant_feed.py --upload cron run (3:30am BST) — that script is the only thing that regenerates and
         re-uploads the feed to Google.

         The actual Content API call lives in Python (scripts/google-price-push/push_google_price.py) — it mirrors
         update_google_price() from C:\scripts\price_update.py, which already talks to Google with a service-account credential.
         Reusing that proven auth path (rather than reimplementing OAuth2/JWT signing in Node) mirrors the amz_upload_single.py
         precedent: shell out to Python where a working, tested implementation already exists.

         Best-effort by design, exactly like shopify.pushIfLive: NEVER throws, so a Google hiccup can't fail or roll back a DB write
         that already committed. A groupid can map to MANY googleids (one per skumap size/variant) — the helper pushes all of them in
         a single Content API custombatch call (one HTTP round-trip, not one per size).
=======================================================================================================================================
*/

const path = require('path');
const { spawn } = require('child_process');
const { query } = require('../database');
const config = require('../config/config');
const logger = require('./logger');

// The Python interpreter and helper script. PYTHON_BIN overrides the default (e.g. a venv path on the VPS) — same var product-amazon.js uses.
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const HELPER = path.join(__dirname, '..', 'scripts', 'google-price-push', 'push_google_price.py');

// True when the Content API creds are present. pushIfLive uses this to short-circuit (mirrors shopify.isConfigured).
function isConfigured() {
  const { merchantId, credentialsJson } = config.google;
  return Boolean(merchantId && credentialsJson);
}

// Run the helper, resolving with its parsed JSON stdout. Rejects with an Error on failure so the caller can log/report it.
function runHelper(groupid) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [HELPER, groupid], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => reject(new Error(`Could not run Python helper: ${err.message}`)));
    proc.on('close', (exitCode) => {
      // The helper always prints a JSON line (summary on success, {error,message} on failure). Parse the last non-empty line.
      let parsed = null;
      const line = stdout.trim().split('\n').filter(Boolean).pop();
      if (line) { try { parsed = JSON.parse(line); } catch { /* fall through to the generic error below */ } }

      if (exitCode === 0 && parsed && !parsed.error) return resolve(parsed);
      if (parsed && parsed.error) return reject(new Error(`${parsed.error}: ${parsed.message || ''}`));
      return reject(new Error((stderr || stdout || 'Unknown error').trim()));
    });
  });
}

/*
 * pushIfLive(groupid)
 * If the product is live on Google (skusummary.googlestatus=1 AND shopify=1) and Content API creds are configured, push the current
 * shopifyprice to every size's googleid. Returns:
 *    null                                       -> legitimately nothing to push: the style is NOT live on Google (googlestatus/shopify
 *                                                  != 1) or has no googleid mapped yet. A genuine no-op — stays silent in the UI.
 *    { pushed: false, error: 'GOOGLE_NOT_CONFIGURED', ... } -> the style IS live on Google but the server has no Content API creds, so
 *                                                  the push was SKIPPED. This is a misconfiguration, deliberately NOT folded into null
 *                                                  (which would hide it as a success) — the UI surfaces it so it isn't silently dropped.
 *    { pushed: true, updated, failed, total }   -> ran (failed/total may be > 0 if some sizes' individual pushes errored)
 *    { pushed: false, error: 'GOOGLE_PUSH_FAILED', ... }    -> the whole run failed before/during the API calls (DB write still stands)
 * Call it AFTER the DB write has committed (same timing as shopify.pushIfLive) — best-effort, never throws.
 */
async function pushIfLive(groupid) {
  // Is the style even live on Google? Check this FIRST so a style that isn't on Google stays a silent null regardless of creds — we
  // only want the "not configured" warning to fire for styles that genuinely SHOULD have pushed.
  const r = await query(`SELECT googlestatus, shopify FROM skusummary WHERE groupid = $1`, [groupid]);
  if (!r.rows.length || r.rows[0].googlestatus !== 1 || r.rows[0].shopify !== 1) return null;
  // The style is live on Google but the server has no Content API creds -> surface it instead of silently skipping (was a null before,
  // indistinguishable from "not on Google"). Owner needs to know the instant push was a no-op so they can add the env vars.
  if (!isConfigured()) {
    logger.error(`[googleMerchant] pushIfLive skipped for ${groupid}: GOOGLE_MERCHANT_ID / GOOGLE_MERCHANT_CREDENTIALS_JSON not configured`);
    return { pushed: false, error: 'GOOGLE_NOT_CONFIGURED', message: 'Google Merchant credentials are not configured on the server' };
  }
  try {
    const summary = await runHelper(groupid);
    if (summary.total === 0) return null; // nothing eligible (e.g. no googleid assigned yet) — nothing to report
    return { pushed: true, updated: summary.updated, failed: summary.failed, total: summary.total };
  } catch (err) {
    logger.error(`[googleMerchant] pushIfLive failed for ${groupid}: ${err.message}`);
    return { pushed: false, error: 'GOOGLE_PUSH_FAILED', message: err.message };
  }
}

module.exports = { isConfigured, pushIfLive };
