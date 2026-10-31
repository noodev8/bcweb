/*
=======================================================================================================================================
Module: utils/ebayNotification.js
=======================================================================================================================================
Purpose: The two checks eBay's notification push needs (developer.ebay.com → Alerts & Notifications). Only caller so far is
         routes/ebay-account-deletion.js.

  challengeResponse(code)   eBay proves the endpoint is ours before it will enable the production keyset: it GETs the endpoint with
                            ?challenge_code=… and expects back hex SHA-256 of  challengeCode + verificationToken + endpoint , in THAT
                            order, where endpoint is the exact URL typed on eBay's page (EBAY_DELETION_ENDPOINT — behind nginx the
                            request can't be trusted to rebuild it byte for byte).

  verifySignature(body, header)   every POST carries X-EBAY-SIGNATURE: base64 of JSON { alg, kid, signature, digest }. The public key for
                            `kid` comes from the Notification API (application token), and the signature is ECDSA over the message.
                            Without this check anyone who found the URL could POST a username and blank that buyer's addresses.

THE SIGNED MESSAGE IS JSON.stringify(parsed body), not the raw bytes — that is exactly what eBay's own Node SDK verifies
(event-notification-nodejs-sdk, lib/validator.js), so it's what eBay signs; it also means express.json() upstream needs no raw-body hook.

Public keys are cached per kid for an hour (eBay's guidance: cache, don't fetch per notification).
=======================================================================================================================================
*/

const crypto = require('crypto');
const config = require('../config/config');
const { appToken, dropAppToken } = require('./ebayAuth');

const PUBLIC_KEY_URL = 'https://api.ebay.com/commerce/notification/v1/public_key/';
const KEY_CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 30000;

function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function challengeResponse(challengeCode) {
  const { verificationToken, deletionEndpoint } = config.ebay;
  return crypto.createHash('sha256').update(String(challengeCode)).update(verificationToken).update(deletionEndpoint).digest('hex');
}

// eBay returns the key as one line ("-----BEGIN PUBLIC KEY-----MFkw…-----END PUBLIC KEY-----"); Node wants proper PEM line breaks.
function toPem(key) {
  const b64 = String(key).replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  return `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
}

const keyCache = new Map();   // kid -> { pem, digest, expiresAt }

async function publicKey(kid) {
  const hit = keyCache.get(kid);
  if (hit && Date.now() < hit.expiresAt) return hit;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(PUBLIC_KEY_URL + encodeURIComponent(kid), {
        headers: { Authorization: `Bearer ${await appToken()}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (err) {
      throw coded('EBAY_ERROR', `eBay public key request failed: ${err.message}`);
    }
    if (res.status === 401 && attempt === 1) { dropAppToken(); continue; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.key) throw coded('EBAY_ERROR', `eBay wouldn't return public key ${kid} (HTTP ${res.status})`);
    const entry = { pem: toPem(body.key), digest: String(body.digest || 'SHA1').toLowerCase(), expiresAt: Date.now() + KEY_CACHE_MS };
    keyCache.set(kid, entry);
    return entry;
  }
  throw coded('EBAY_ERROR', `eBay rejected the application token twice fetching public key ${kid}`);
}

/*
 * verifySignature(body, signatureHeader) -> true | false
 * false = the header is missing/garbled or the signature doesn't match (treat the POST as not from eBay).
 * THROWS (code EBAY_ERROR / EBAY_NOT_CONFIGURED) when we couldn't check at all — the key fetch failed — which is a different outcome.
 */
async function verifySignature(body, signatureHeader) {
  let sig;
  try {
    sig = JSON.parse(Buffer.from(String(signatureHeader || ''), 'base64').toString('utf8'));
  } catch {
    return false;
  }
  if (!sig || !sig.kid || !sig.signature) return false;

  const key = await publicKey(sig.kid);
  try {
    return crypto.verify(key.digest, Buffer.from(JSON.stringify(body)), key.pem, Buffer.from(sig.signature, 'base64'));
  } catch {
    return false;
  }
}

module.exports = { challengeResponse, verifySignature };
