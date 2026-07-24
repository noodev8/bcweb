/*
=======================================================================================================================================
Module: utils/googleMerchant.js
=======================================================================================================================================
Purpose: Keep Google Merchant Center's price in step with a Shopify Pricing apply (W1), the same way utils/shopify.js keeps Shopify in
         step. Without this, Google Shopping/ads would keep showing the OLD price after an Apply until the next nightly
         C:\scripts\merchant-feed\merchant_feed.py --upload cron run (3:30am BST) — that script is the only thing that regenerates and
         re-uploads the full feed to Google.

         DONE IN NODE (2026-07-24): the price push now runs in-process with the built-in fetch + a service-account token from
         utils/googleAuth.js (cached ~1h). It replaces the old shell-out to scripts/google-price-push/push_google_price.py, which spawned
         a fresh Python interpreter on EVERY apply — a multi-second cold-start (re-importing the Google client libs, rebuilding creds).
         In-process + cached auth removes that cost entirely. The public surface (isConfigured, pushIfLive) is UNCHANGED so callers
         (routes/pricing-apply.js, routes/product-price.js) don't change.

         Merchant API, SUPPLEMENTAL price override: the Merchant API splits products into read-only processed products and writable
         productInputs, and every productInput belongs to a data source. Our primary product data lands via the nightly SFTP feed, which
         the API can't write to — so we write a price-only override into a dedicated API-type SUPPLEMENTAL data source
         (config.google.supplementalDatasource). The supplemental value overlays the primary feed's price until the next nightly feed
         re-asserts it. The override is matched to the right product on (offerId, contentLanguage, feedLabel).

         Best-effort by design, exactly like shopify.pushIfLive: NEVER throws, so a Google hiccup can't fail or roll back a DB write that
         already committed. A groupid maps to MANY googleids (one per skumap size/variant); the Merchant API has no custombatch, so we fire
         the per-offer productInputs.insert calls CONCURRENTLY (Promise.allSettled) and collect per-offer failures rather than failing the
         whole style.
=======================================================================================================================================
*/

const { query } = require('../database');
const config = require('../config/config');
const logger = require('./logger');
const { getAccessToken } = require('./googleAuth');

// Merchant API (products bundle) base. productInputs.insert writes a productInput into a data source.
// NOTE: the products sub-API is GA at v1 — v1beta was discontinued on 2026-02-28 (returns 409 "upgrade to v1"). Keep this on v1.
const MERCHANT_API_BASE = 'https://merchantapi.googleapis.com/products/v1';

// True when everything the push needs is configured: creds + merchant id + the supplemental data source to write the override into.
// pushIfLive uses this to short-circuit (mirrors shopify.isConfigured).
function isConfigured() {
  const { merchantId, credentialsJson, supplementalDatasource } = config.google;
  return Boolean(merchantId && credentialsJson && supplementalDatasource);
}

// The account resource ("accounts/<merchantId>") and the fully-qualified data source name. supplementalDatasource may be a bare id or an
// already-qualified "accounts/.../dataSources/..." — accept either (mirrors the Python helper).
function resourceNames() {
  const { merchantId, supplementalDatasource } = config.google;
  const parent = `accounts/${merchantId}`;
  const dataSource = supplementalDatasource.startsWith('accounts/')
    ? supplementalDatasource
    : `${parent}/dataSources/${supplementalDatasource}`;
  return { parent, dataSource };
}

// googleid + current shopifyprice for every active, google-eligible size under groupid. Mirrors merchant_feed.py / the old Python helper's
// WHERE clause (sm.googlestatus=1 AND sm.shopify=1 AND m.googlestatus=1) so we only ever push products meant to be in the Google feed.
async function fetchTargets(groupid) {
  const r = await query(`
    SELECT m.googleid, sm.shopifyprice
    FROM skusummary sm
    JOIN skumap m ON m.groupid = sm.groupid
    WHERE sm.groupid = $1
      AND sm.googlestatus = 1 AND sm.shopify = 1 AND m.googlestatus = 1
      AND COALESCE(m.deleted, 0) = 0
      AND m.googleid IS NOT NULL AND m.googleid <> ''
  `, [groupid]);
  return r.rows;
}

// Insert a supplemental override for one offer_id. Sets ONLY salePrice (the current SELLING price) — deliberately NOT `price`, so the
// primary feed's `price` (the RRP / regular price) is left intact; Google then shows salePrice struck against the RRP. A supplemental
// input overlays just the attributes it carries, so title/availability/RRP/etc. all still come from the primary feed. Throws on failure
// so the caller can count it. (An `insert` replaces the whole productInput for this key in the supplemental source, so a later
// salePrice-only insert cleanly drops any `price` we might have written before.)
async function insertPriceOverride(token, parent, dataSource, offerId, amountMicros) {
  const { contentLanguage, feedLabel } = config.google;
  const salePrice = { amountMicros: String(amountMicros), currencyCode: 'GBP' }; // int64 -> string per Google JSON convention
  const url = `${MERCHANT_API_BASE}/${parent}/productInputs:insert?dataSource=${encodeURIComponent(dataSource)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offerId,
      contentLanguage,
      feedLabel,
      productAttributes: { salePrice },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${offerId}: ${resp.status} ${body.slice(0, 200)}`);
  }
}

/*
 * pushIfLive(groupid)
 * If the product is live on Google (skusummary.googlestatus=1 AND shopify=1) and creds are configured, push the current shopifyprice to
 * every size's googleid. Returns:
 *    null                                       -> legitimately nothing to push: the style is NOT live on Google (googlestatus/shopify
 *                                                  != 1) or has no googleid mapped yet. A genuine no-op — stays silent in the UI.
 *    { pushed: false, error: 'GOOGLE_NOT_CONFIGURED', ... } -> the style IS live on Google but the server isn't configured, so the push
 *                                                  was SKIPPED. Deliberately NOT folded into null (which would hide it) — the UI surfaces it.
 *    { pushed: true, updated, failed, total }   -> ran (failed/total may be > 0 if some sizes' individual pushes errored)
 *    { pushed: false, error: 'GOOGLE_PUSH_FAILED', ... }    -> the whole run failed before/during the API calls (DB write still stands)
 * Call it AFTER the DB write has committed (same timing as shopify.pushIfLive) — best-effort, never throws.
 */
async function pushIfLive(groupid) {
  // Is the style even live on Google? Check this FIRST so a style that isn't on Google stays a silent null regardless of config — we only
  // want the "not configured" warning to fire for styles that genuinely SHOULD have pushed.
  const r = await query(`SELECT googlestatus, shopify FROM skusummary WHERE groupid = $1`, [groupid]);
  if (!r.rows.length || r.rows[0].googlestatus !== 1 || r.rows[0].shopify !== 1) return null;

  if (!isConfigured()) {
    logger.error(`[googleMerchant] pushIfLive skipped for ${groupid}: GOOGLE_MERCHANT_ID / GOOGLE_MERCHANT_CREDENTIALS_JSON / GOOGLE_SUPPLEMENTAL_DATASOURCE not configured`);
    return { pushed: false, error: 'GOOGLE_NOT_CONFIGURED', message: 'Google Merchant credentials are not configured on the server' };
  }

  try {
    const targets = await fetchTargets(groupid);
    if (targets.length === 0) return null; // nothing eligible (e.g. no googleid assigned yet) — nothing to report

    // All rows share the same skusummary.shopifyprice (per-groupid, not per-size) — take the first numeric one. shopifyprice is a
    // junk-prone VARCHAR, so guard against a non-numeric value rather than trusting it (pricing-apply writes a clean 2dp string, but
    // pushIfLive is also called from Add/Modify save).
    let price = NaN;
    for (const t of targets) {
      const p = Number(t.shopifyprice);
      if (Number.isFinite(p)) { price = p; break; }
    }
    if (!Number.isFinite(price)) {
      logger.error(`[googleMerchant] pushIfLive: shopifyprice for ${groupid} is not numeric`);
      return { pushed: false, error: 'GOOGLE_PUSH_FAILED', message: 'shopifyprice is not numeric' };
    }
    const amountMicros = Math.round(price * 1_000_000);

    const token = await getAccessToken(); // cached ~1h — this is what removes the per-apply cold-start
    const { parent, dataSource } = resourceNames();

    // No custombatch in the Merchant API — fire every size's insert concurrently. Per-offer failures are collected, not fatal.
    const results = await Promise.allSettled(
      targets.map((t) => insertPriceOverride(token, parent, dataSource, t.googleid, amountMicros))
    );
    let updated = 0;
    const errors = [];
    for (const res of results) {
      if (res.status === 'fulfilled') updated += 1;
      else errors.push(res.reason && res.reason.message ? res.reason.message : String(res.reason));
    }
    if (errors.length) logger.error(`[googleMerchant] ${groupid}: ${errors.length}/${targets.length} offer push(es) failed: ${errors.slice(0, 5).join(' | ')}`);

    return { pushed: true, updated, failed: errors.length, total: targets.length };
  } catch (err) {
    // Wholesale failure (token mint / DB read) — the DB write still stands; nightly merchant_feed.py --upload is the backstop.
    logger.error(`[googleMerchant] pushIfLive failed for ${groupid}: ${err.message}`);
    return { pushed: false, error: 'GOOGLE_PUSH_FAILED', message: err.message };
  }
}

module.exports = { isConfigured, pushIfLive };
