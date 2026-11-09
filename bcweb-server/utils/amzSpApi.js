/*
=======================================================================================================================================
Util: utils/amzSpApi.js   — Amazon Selling Partner API (SP-API) client: login + signed-in GET/POST
=======================================================================================================================================
Purpose: The ONE place BCWEB talks to SP-API. Started 2026-11-09 with a read-only connection test (scripts/amz-sp-test.js).

HOW THE LOGIN WORKS (and why there is no AWS here). Since October 2023 SP-API needs NO AWS account, IAM user/role or Signature V4
request signing — the owner's 2025 attempt stalled on exactly that, following out-of-date guides. A call needs only a Login with Amazon
(LWA) access token: the long-lived REFRESH token (from "Authorise app" on the Solution Provider Portal app "BCWEB" — a private app,
Draft status for good, our own seller account only) is swapped for a 1-hour access token, sent as the x-amz-access-token header.

.env (bcweb-server/.env, never committed; refresh token QUOTED — it contains a "|"):
    AMZ_SP_CLIENT_ID        the app's LWA "Client identifier" (amzn1.application-oa2-client.…) — NOT the App ID (amzn1.sp.solution.…)
    AMZ_SP_CLIENT_SECRET    the app's LWA client secret — Amazon makes us ROTATE it before it expires (SPP shows a warning; ~180 days)
    AMZ_SP_REFRESH_TOKEN    Atzr|…  — re-authorise the app to get a new one if lost
    AMZ_SP_ENDPOINT         https://sellingpartnerapi-eu.amazon.com   (EU region, UK store)
    AMZ_SP_MARKETPLACE_ID   A1F83G8C2ARO7P                             (amazon.co.uk)

Roles granted 2026-11-09: Product Listing, Pricing, Amazon Fulfillment, Selling Partner Insights, Finance and Accounting, Inventory and
Order Tracking. No restricted (buyer PII) roles — so no Restricted Data Tokens anywhere. Brand Analytics was left off by the owner; add
it to the app if a report needs it.

Errors: spGet/spPost THROW on a non-2xx (with Amazon's error code + message), because callers are scripts / cron steps that report and
stop — a route using this must catch and turn it into a return_code (API-RULES: never a 4xx/5xx to the client).
Secrets are never logged.
=======================================================================================================================================
*/

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

let cached = null; // { token, expiresAt } — one access token reused until a minute before it expires

function config() {
  // Trimmed: a token copied from the portal can carry a trailing line break, which dotenv keeps inside quotes (2026-11-09 — Amazon
  // then answers invalid_grant).
  const env = (k) => (process.env[k] || '').trim() || undefined;
  const cfg = {
    clientId: env('AMZ_SP_CLIENT_ID'),
    clientSecret: env('AMZ_SP_CLIENT_SECRET'),
    refreshToken: env('AMZ_SP_REFRESH_TOKEN'),
    endpoint: (process.env.AMZ_SP_ENDPOINT || 'https://sellingpartnerapi-eu.amazon.com').replace(/\/+$/, ''),
    marketplaceId: process.env.AMZ_SP_MARKETPLACE_ID || 'A1F83G8C2ARO7P',
  };
  const missing = ['clientId', 'clientSecret', 'refreshToken'].filter((k) => !cfg[k]);
  if (missing.length) {
    const names = { clientId: 'AMZ_SP_CLIENT_ID', clientSecret: 'AMZ_SP_CLIENT_SECRET', refreshToken: 'AMZ_SP_REFRESH_TOKEN' };
    throw new Error(`SP-API not configured — missing ${missing.map((k) => names[k]).join(', ')} in bcweb-server/.env`);
  }
  return cfg;
}

/** Swap the refresh token for an access token (cached ~1 hour). */
async function accessToken() {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const cfg = config();
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // e.g. invalid_client (wrong id/secret, or secret rotated), invalid_grant (refresh token wrong / app de-authorised)
    throw new Error(`LWA login failed (${res.status}): ${body.error || '?'} — ${body.error_description || 'no description'}`);
  }
  cached = { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in || 3600) - 60) * 1000 };
  return cached.token;
}

async function call(method, path, { query, body } = {}) {
  const cfg = config();
  const url = new URL(cfg.endpoint + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  // 429 = Amazon's rate limit for that operation (getOrders refills ~1 a minute after a burst of 20). Wait and retry a few times
  // rather than failing the run — a button press straight after the cron is the usual cause.
  let res;
  for (let attempt = 0; ; attempt += 1) {
    res = await fetch(url, {
      method,
      headers: {
        'x-amz-access-token': await accessToken(),
        'Content-Type': 'application/json',
        'User-Agent': 'BCWEB/1.0 (Language=JavaScript)',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 429 || attempt >= 3) break;
    await sleep(2000 * (attempt + 1));
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const e = json && json.errors && json.errors[0];
    const err = new Error(`SP-API ${method} ${path} failed (${res.status}): ${e ? `${e.code} — ${e.message}` : text.slice(0, 300)}`);
    err.status = res.status;
    err.code = e && e.code;
    throw err;
  }
  return json;
}

const spGet = (path, query) => call('GET', path, { query });
const spPost = (path, body, query) => call('POST', path, { body, query });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { accessToken, spGet, spPost, sleep, marketplaceId: () => config().marketplaceId };
