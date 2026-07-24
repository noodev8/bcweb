/*
=======================================================================================================================================
Module: utils/googleAuth.js
=======================================================================================================================================
Purpose: Mint (and cache) a Google service-account OAuth2 access token for the Merchant API, in-process and dependency-free — so
         utils/googleMerchant.js can push prices with a plain fetch() instead of shelling out to Python. This is the piece that removes
         the per-apply cold-start: the old path spawned a fresh Python interpreter every call (re-importing the Google client libs and
         rebuilding creds); here the token is minted once and REUSED across calls until it's about to expire.

How: the standard two-legged service-account flow (JWT bearer grant, RFC 7523 / Google's "server to server" OAuth). We build a JWT
     asserting the service account, sign it RS256 with Node's built-in `crypto` (the private key from GOOGLE_MERCHANT_CREDENTIALS_JSON),
     and exchange it at the token endpoint for an access token. No google-auth-library / googleapis dependency — the server has none and
     uses native fetch throughout (see utils/shopify.js), so this stays self-contained and matches that convention.

Scope: https://www.googleapis.com/auth/content — the same scope the Python helper used; it carries over to the Merchant API unchanged.

Caching: the token (valid ~1h) is held in-module with its expiry; getAccessToken() returns the cached one until ~60s before expiry,
         then refreshes. Concurrent callers share ONE in-flight refresh (we cache the promise) so a burst of applies can't stampede the
         token endpoint. A process restart (PM2) just starts cold and re-mints on the first call.
=======================================================================================================================================
*/

const crypto = require('crypto');
const config = require('../config/config');

const SCOPE = 'https://www.googleapis.com/auth/content';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
// Refresh this many seconds before the token actually expires, so an in-flight request never rides an about-to-die token.
const EXPIRY_SKEW_SECONDS = 60;

// In-module cache. token/expiresAt hold the current live token; inFlight holds a refresh promise so concurrent callers dedupe onto it.
let cached = { token: null, expiresAt: 0 };
let inFlight = null;

// base64url without padding (JWT + signature encoding).
function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Parse the service-account JSON once per refresh. Throws a clear Error if it's missing/invalid so the caller can report it (never a raw
// JSON.parse throw). Returns { client_email, private_key, token_uri }.
function loadServiceAccount() {
  const raw = config.google.credentialsJson;
  if (!raw) throw new Error('GOOGLE_MERCHANT_CREDENTIALS_JSON is not set');
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (e) {
    throw new Error(`GOOGLE_MERCHANT_CREDENTIALS_JSON is not valid JSON: ${e.message}`);
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('GOOGLE_MERCHANT_CREDENTIALS_JSON is missing client_email / private_key');
  }
  return sa;
}

// Build + sign the assertion JWT and exchange it for an access token. Returns { token, expiresAt(ms) }.
async function mintToken() {
  const sa = loadServiceAccount();
  const tokenUri = sa.token_uri || DEFAULT_TOKEN_URI;
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;

  // RS256 = RSA signature over SHA-256. crypto.sign with a PEM private key does exactly this.
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key);
  const assertion = `${signingInput}.${b64url(signature)}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const resp = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) {
    // Google returns a JSON {error, error_description} on failure — surface it verbatim (helps diagnose a bad key / disabled account).
    throw new Error(`Token endpoint ${resp.status}: ${text.slice(0, 300)}`);
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Token endpoint returned non-JSON: ${text.slice(0, 200)}`); }
  if (!json.access_token) throw new Error('Token endpoint response had no access_token');

  const ttl = Number(json.expires_in) || 3600;
  return { token: json.access_token, expiresAt: Date.now() + ttl * 1000 };
}

/*
 * getAccessToken()
 * Resolve with a valid access token string, reusing the cached one until ~60s before expiry. Concurrent callers share one refresh.
 * Rejects (throws to the caller) if the token can't be minted — googleMerchant catches this and reports GOOGLE_PUSH_FAILED.
 */
async function getAccessToken() {
  if (cached.token && Date.now() < cached.expiresAt - EXPIRY_SKEW_SECONDS * 1000) {
    return cached.token;
  }
  if (!inFlight) {
    inFlight = mintToken()
      .then((fresh) => { cached = fresh; return fresh.token; })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

// Test/diagnostic hook — drop the cached token so the next call re-mints (not used in normal flow).
function _clearCache() { cached = { token: null, expiresAt: 0 }; inFlight = null; }

module.exports = { getAccessToken, _clearCache };
