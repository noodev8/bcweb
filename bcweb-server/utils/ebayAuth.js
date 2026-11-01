/*
=======================================================================================================================================
Module: utils/ebayAuth.js
=======================================================================================================================================
Purpose: eBay OAuth tokens for the production keyset "BCWEB" (developer.ebay.com). One place, so every eBay caller shares the cache.

TWO KINDS OF TOKEN:
  APPLICATION token  client_credentials grant on the keyset's App ID + Cert ID (EBAY_CLIENT_ID / _SECRET). Acts as the app, not as the
                     seller, so it can't read orders — it's what eBay wants for the Notification API's public keys
                     (utils/ebayNotification.js). Lasts 2 hours (expires_in 7200); cached in-process, refetched 5 minutes early or at once
                     on a 401.
  USER token         the SELLER's token (brookfield.comfort), swapped from EBAY_REFRESH_TOKEN (minted by scripts/ebay-token.js, ~18
                     months — EBAY_REFRESH_TOKEN_EXPIRES) for USER_SCOPES: orders (utils/ebayOrders.js), and later listings + stock.
                     Also 2 hours, cached the same way. The scopes asked for here must be ones the refresh token was granted, or eBay
                     refuses — keep USER_SCOPES in step with scripts/ebay-token.js.

Production endpoint only — there is no sandbox switch: the sandbox can't see real orders, and the reads we make are harmless.
=======================================================================================================================================
*/

const config = require('../config/config');

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const APP_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const TIMEOUT_MS = 30000;

function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function isConfigured() {
  const { clientId, clientSecret } = config.ebay;
  return Boolean(clientId && clientSecret);
}

// The cached 2h application token. One fetch in flight at a time.
let cached = null;   // { token, expiresAt }
let fetching = null;

async function appToken() {
  if (!isConfigured()) {
    throw coded('EBAY_NOT_CONFIGURED', 'eBay needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in bcweb-server/.env');
  }
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (!fetching) {
    fetching = (async () => {
      const { clientId, clientSecret } = config.ebay;
      let res;
      try {
        res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
          },
          body: new URLSearchParams({ grant_type: 'client_credentials', scope: APP_SCOPE }),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
      } catch (err) {
        throw coded('EBAY_ERROR', `eBay token request failed: ${err.message}`);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.access_token) {
        throw coded('EBAY_ERROR', `eBay wouldn't issue an application token (HTTP ${res.status}${body.error ? `, ${body.error}` : ''}) — check EBAY_CLIENT_ID / _SECRET and that the production keyset is enabled`);
      }
      const life = (Number(body.expires_in) || 7200) * 1000;
      cached = { token: body.access_token, expiresAt: Date.now() + life - 5 * 60 * 1000 };
      return cached.token;
    })().finally(() => { fetching = null; });
  }
  return fetching;
}

// Forget the cached token — called by a caller that got a 401 with it, so the next appToken() fetches a fresh one.
function dropAppToken() {
  cached = null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// USER token — the seller's own, from the refresh token.
// ---------------------------------------------------------------------------------------------------------------------------------
const USER_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account'
].join(' ');

function isUserConfigured() {
  return isConfigured() && Boolean(config.ebay.refreshToken);
}

let userCached = null;   // { token, expiresAt }
let userFetching = null;

async function userToken() {
  if (!isUserConfigured()) {
    throw coded('EBAY_NOT_CONFIGURED', 'eBay orders need EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_REFRESH_TOKEN in bcweb-server/.env');
  }
  if (userCached && Date.now() < userCached.expiresAt) return userCached.token;
  if (!userFetching) {
    userFetching = (async () => {
      const { clientId, clientSecret, refreshToken } = config.ebay;
      let res;
      try {
        res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
          },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: USER_SCOPES }),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
      } catch (err) {
        throw coded('EBAY_ERROR', `eBay token request failed: ${err.message}`);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.access_token) {
        // invalid_grant here = the refresh token expired, was revoked, or got cut short (it must be QUOTED in .env — it contains '#').
        throw coded('EBAY_ERROR', `eBay refused the refresh token (HTTP ${res.status}${body.error ? `, ${body.error}` : ''}) — run scripts/ebay-token.js again`);
      }
      const life = (Number(body.expires_in) || 7200) * 1000;
      userCached = { token: body.access_token, expiresAt: Date.now() + life - 5 * 60 * 1000 };
      return userCached.token;
    })().finally(() => { userFetching = null; });
  }
  return userFetching;
}

function dropUserToken() {
  userCached = null;
}

module.exports = { isConfigured, appToken, dropAppToken, isUserConfigured, userToken, dropUserToken };
