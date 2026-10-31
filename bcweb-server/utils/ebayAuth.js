/*
=======================================================================================================================================
Module: utils/ebayAuth.js
=======================================================================================================================================
Purpose: eBay OAuth tokens for the production keyset "BCWEB" (developer.ebay.com). One place, so every eBay caller shares the cache.

TWO KINDS OF TOKEN, and only the first exists so far:
  APPLICATION token  client_credentials grant on the keyset's App ID + Cert ID (EBAY_CLIENT_ID / _SECRET). Acts as the app, not as the
                     seller, so it can't read orders — it's what eBay wants for the Notification API's public keys
                     (utils/ebayNotification.js). Lasts 2 hours (expires_in 7200); cached in-process, refetched 5 minutes early or at once
                     on a 401.
  USER token         (to come, with the order import) the seller's own token, minted from EBAY_REFRESH_TOKEN (~18 months) for
                     sell.fulfillment — getOrders and sending tracking back.

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

module.exports = { isConfigured, appToken, dropAppToken };
