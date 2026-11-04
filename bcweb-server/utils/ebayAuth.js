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
  FINANCE token      the same refresh token swapped for FINANCE_SCOPES (sell.finances) — Month End only, kept apart (see below).

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

// The FINANCE token — Month End's eBay block (utils/financeEbay.js). Its own scope set, asked for SEPARATELY on purpose: a refresh
// token can only be swapped for scopes it was granted, and sell.finances was added to scripts/ebay-token.js on 2026-11-01. Folding it
// into USER_SCOPES would break the order import, stock sync and listings on any machine still holding the older token; kept apart,
// only Month End's eBay block fails (with "run scripts/ebay-token.js") until the token is re-minted.
const FINANCE_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.finances'
].join(' ');

// The ANALYTICS token — the eBay listings screen's Views column (utils/ebayTraffic.js, 2026-11-04). Kept apart for the same reason as
// FINANCE_SCOPES: sell.analytics.readonly was added to scripts/ebay-token.js on 2026-11-04, and a token minted before then can't be
// swapped for it. Kept apart, only the Views column goes blank (with "run scripts/ebay-token.js") — the listings still load.
const ANALYTICS_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly'
].join(' ');

function isUserConfigured() {
  return isConfigured() && Boolean(config.ebay.refreshToken);
}

// One cached 2h access token per scope set, one fetch in flight per set.
const userCache = new Map();      // scopes -> { token, expiresAt }
const userFetching = new Map();   // scopes -> Promise

async function tokenFor(scopes) {
  if (!isUserConfigured()) {
    throw coded('EBAY_NOT_CONFIGURED', 'eBay needs EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_REFRESH_TOKEN in bcweb-server/.env');
  }
  const hit = userCache.get(scopes);
  if (hit && Date.now() < hit.expiresAt) return hit.token;
  if (!userFetching.has(scopes)) {
    userFetching.set(scopes, (async () => {
      const { clientId, clientSecret, refreshToken } = config.ebay;
      let res;
      try {
        res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
          },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: scopes }),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
      } catch (err) {
        throw coded('EBAY_ERROR', `eBay token request failed: ${err.message}`);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.access_token) {
        // invalid_grant = the refresh token expired, was revoked, or got cut short (it must be QUOTED in .env — it contains '#').
        // invalid_scope = the token predates a scope asked for here (e.g. sell.finances) — re-mint it.
        throw coded('EBAY_ERROR', `eBay refused the refresh token (HTTP ${res.status}${body.error ? `, ${body.error}` : ''}) — run scripts/ebay-token.js again`);
      }
      const life = (Number(body.expires_in) || 7200) * 1000;
      userCache.set(scopes, { token: body.access_token, expiresAt: Date.now() + life - 5 * 60 * 1000 });
      return body.access_token;
    })().finally(() => { userFetching.delete(scopes); }));
  }
  return userFetching.get(scopes);
}

const userToken = () => tokenFor(USER_SCOPES);
const financeToken = () => tokenFor(FINANCE_SCOPES);
const analyticsToken = () => tokenFor(ANALYTICS_SCOPES);

function dropUserToken() {
  userCache.delete(USER_SCOPES);
}

function dropFinanceToken() {
  userCache.delete(FINANCE_SCOPES);
}

function dropAnalyticsToken() {
  userCache.delete(ANALYTICS_SCOPES);
}

module.exports = { isConfigured, appToken, dropAppToken, isUserConfigured, userToken, dropUserToken, financeToken, dropFinanceToken, analyticsToken, dropAnalyticsToken };
