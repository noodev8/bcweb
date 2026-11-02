/*
=======================================================================================================================================
Module: utils/ebaySignature.js
=======================================================================================================================================
Purpose: The DIGITAL SIGNATURE headers eBay requires on every Finances API call made for a UK (or EU) seller — RFC 9421 HTTP message
         signatures, as described on developer.ebay.com "Digital Signatures for APIs". Without them eBay refuses the call. Used by
         utils/financeEbay.js (Month End's eBay block). The other eBay calls we make don't need it (eBay ignores a signature it doesn't
         need, but we only sign where it's required).

THE KEY: an Ed25519 pair made once by scripts/ebay-signing-key.js (eBay's Key Management API) — EBAY_SIGNING_JWE (the public key as
JWE, sent as-is) and EBAY_SIGNING_PRIVATE_KEY (base64 PKCS8, never sent). Keys last three years (EBAY_SIGNING_KEY_EXPIRES).

WHAT IS SIGNED — a GET has no body, so no Content-Digest:
    "x-ebay-signature-key": <jwe>
    "@method": GET
    "@path": /sell/finances/v1/transaction        ← the path only; the query string is NOT part of @path (RFC 9421 §2.2.6)
    "@authority": apiz.ebay.com
    "@signature-params": ("x-ebay-signature-key" "@method" "@path" "@authority");created=<unix seconds>
  joined with "\n", signed Ed25519, and sent as
    Signature-Input: sig1=("x-ebay-signature-key" "@method" "@path" "@authority");created=<unix seconds>
    Signature:       sig1=:<base64 signature>:
=======================================================================================================================================
*/

const crypto = require('crypto');
const config = require('../config/config');

function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function isSigningConfigured() {
  return Boolean(config.ebay.signingJwe && config.ebay.signingPrivateKey);
}

let keyObject = null;
function privateKey() {
  if (!keyObject) {
    try {
      keyObject = crypto.createPrivateKey({ key: Buffer.from(config.ebay.signingPrivateKey, 'base64'), format: 'der', type: 'pkcs8' });
    } catch (err) {
      throw coded('EBAY_NOT_CONFIGURED', `EBAY_SIGNING_PRIVATE_KEY won't load (${err.message}) — run node scripts/ebay-signing-key.js --force`);
    }
  }
  return keyObject;
}

/*
 * signatureHeaders(method, url) -> { 'x-ebay-signature-key', 'Signature-Input', 'Signature' }
 *   For a request WITHOUT a body (all the Finances reads are GETs).
 */
function signatureHeaders(method, url) {
  if (!isSigningConfigured()) {
    throw coded('EBAY_NOT_CONFIGURED', 'eBay finance calls need a signing key — run node scripts/ebay-signing-key.js (EBAY_SIGNING_JWE / EBAY_SIGNING_PRIVATE_KEY)');
  }
  const u = new URL(url);
  const jwe = config.ebay.signingJwe;
  const created = Math.floor(Date.now() / 1000);
  const params = `("x-ebay-signature-key" "@method" "@path" "@authority");created=${created}`;
  const base = [
    `"x-ebay-signature-key": ${jwe}`,
    `"@method": ${method.toUpperCase()}`,
    `"@path": ${u.pathname}`,
    `"@authority": ${u.host}`,
    `"@signature-params": ${params}`
  ].join('\n');
  const signature = crypto.sign(null, Buffer.from(base, 'utf8'), privateKey()).toString('base64');
  return {
    'x-ebay-signature-key': jwe,
    'Signature-Input': `sig1=${params}`,
    Signature: `sig1=:${signature}:`
  };
}

module.exports = { isSigningConfigured, signatureHeaders };
