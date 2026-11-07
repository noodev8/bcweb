/*
=======================================================================================================================================
Module: utils/shopifySessions.js
=======================================================================================================================================
Purpose: Shopify's visits per day, by where they came from, kept in bcweb (shopify_sessions_daily) — step 3 of measuring "more Shopify
         sales we didn't pay Google for" (owner, 2026-11-07; docs/seo/PLAN.md). The target is Shopify SESSIONS, ~20 a day → 30, in
         Shopify's own count (owner chose Shopify over GA4, which counts ~2×).

Source: Shopify's sessions report through ShopifyQL (GraphQL shopifyqlQuery), on the "bcweb-fulfill" Dev Dashboard app's token
        (utils/shopifyFulfil.js → accessToken; read_reports added 2026-11-07). READ ONLY on Shopify. One query returns every
        (day × referrer_source × referrer_name × utm_source × utm_medium) with its sessions — ~5 rows a day.

THE RULE — sessionCameFrom(row), the same labels as an order's came_from (utils/orderSource.js), first match wins:
  utm_medium cpc|ppc|paid… → 'Google paid' (utm_source google or none) / 'Other paid'
  AI (utm_source or referrer chatgpt / perplexity / gemini / copilot / claude …) → 'AI'
  utm_medium email|newsletter, or referrer_source email → 'Email'
  referrer_source search + google → 'Google free' from PAID_SPLIT_FROM on (the Google Ads final URL suffix marks paid clicks cpc);
                                    before it, paid and free are mixed → 'Google (paid or free?)'
  referrer_source search (anyone else) → 'Other search' · social → 'Social' · direct → 'Direct' (a utm_source we don't know → 'Other site')
  anything else (unknown / blank) → 'Unknown'

recordSessions({ since, until, write }) REPLACES the days in the window (delete + insert in one transaction), because Shopify revises
recent days and a source combination can disappear. Update Orders calls it for the last 3 days each run (today is partial and is
re-read until it's over); scripts/shopify-sessions-backfill.js fills history month by month. purgeOldSessions() keeps 2 years.
=======================================================================================================================================
*/

const config = require('../config/config');
const { query } = require('../database');
const { withTransaction } = require('./transaction');
const { accessToken, isConfigured } = require('./shopifyFulfil');
const { AI_RE, KEEP_YEARS } = require('./orderSource');
const logger = require('./logger');

// The day the Google Ads final URL suffix (utm_source=google&utm_medium=cpc) was set — owner, 2026-11-07, during the day — so from the
// next whole day a paid click arrives tagged cpc and an untagged Google search visit is a free one.
const PAID_SPLIT_FROM = '2026-11-08';
// ShopifyQL runs on a newer API version than the rest of the app pins (shopifyqlQuery returned to the Admin API in 2025-10).
const SHOPIFYQL_VERSION = '2025-10';

function sessionCameFrom(r) {
  const rs = (r.referrer_source || '').toLowerCase();
  const rn = (r.referrer_name || '').toLowerCase();
  const us = (r.utm_source || '').toLowerCase();
  const um = (r.utm_medium || '').toLowerCase();
  if (/^(cpc|ppc|paid|paidsearch|paid_search|shopping_ads)$/.test(um)) return (!us || /google/.test(us)) ? 'Google paid' : 'Other paid';
  if (AI_RE.test(us) || AI_RE.test(rn)) return 'AI';
  if (/email|newsletter/.test(um) || rs === 'email') return 'Email';
  if (rs === 'search') {
    if (/google/.test(rn)) return r.day >= PAID_SPLIT_FROM ? 'Google free' : 'Google (paid or free?)';
    return 'Other search';
  }
  if (rs === 'social') return 'Social';
  if (rs === 'direct') return us && !/shop_app|shopify/.test(us) ? 'Other site' : 'Direct';
  if (us) return 'Other site';
  return 'Unknown';
}

// One ShopifyQL query → its rows. Throws on access / parse errors.
async function shopifyql(q) {
  const { shop } = config.shopify;
  const res = await fetch(`https://${shop}.myshopify.com/admin/api/${SHOPIFYQL_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': await accessToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query($q: String!) { shopifyqlQuery(query: $q) { tableData { rows } parseErrors } }', variables: { q } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.errors) throw new Error(`Shopify sessions read failed: ${res.status} ${JSON.stringify(j.errors || '').slice(0, 250)}`);
  const d = j.data.shopifyqlQuery;
  if (d.parseErrors && d.parseErrors.length) throw new Error(`ShopifyQL: ${JSON.stringify(d.parseErrors).slice(0, 250)}`);
  return d.tableData.rows || [];
}

/*
 * recordSessions({ since, until, write }) -> { days, rows, sessions, tally }
 * since / until: 'YYYY-MM-DD' (until defaults to today). write false = DRY RUN (nothing touches the DB; tally = { came_from: sessions }).
 */
async function recordSessions({ since, until, write = true }) {
  if (!isConfigured()) throw new Error('Shopify sessions need SHOPIFY_FULFIL_CLIENT_ID / _SECRET (the bcweb-fulfill app) in bcweb-server/.env');
  const rows = await shopifyql(`FROM sessions SHOW sessions GROUP BY day, referrer_source, referrer_name, utm_source, utm_medium `
    + `SINCE ${since} UNTIL ${until || 'today'} ORDER BY day LIMIT 10000`);
  const clean = rows.map((r) => {
    const x = {
      day: String(r.day).slice(0, 10),
      referrer_source: r.referrer_source || '', referrer_name: r.referrer_name || '',
      utm_source: r.utm_source || '', utm_medium: r.utm_medium || '',
      sessions: Number(r.sessions) || 0,
    };
    return { ...x, came_from: sessionCameFrom(x) };
  });
  const tally = {};
  for (const r of clean) tally[r.came_from] = (tally[r.came_from] || 0) + r.sessions;
  const out = { days: new Set(clean.map((r) => r.day)).size, rows: clean.length, sessions: clean.reduce((a, r) => a + r.sessions, 0), tally };
  if (!write) return out;

  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM shopify_sessions_daily WHERE day >= $1::date AND ($2::date IS NULL OR day <= $2::date)`,
      [since, until || null],
    );
    if (!clean.length) return;
    // One insert for the window (unnest of parallel arrays) — a 2-year backfill month is a few hundred rows.
    await client.query(
      `INSERT INTO shopify_sessions_daily (day, referrer_source, referrer_name, utm_source, utm_medium, sessions, came_from)
       SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[])`,
      ['day', 'referrer_source', 'referrer_name', 'utm_source', 'utm_medium', 'sessions', 'came_from'].map((k) => clean.map((r) => r[k])),
    );
  });
  return out;
}

// KEEP 2 YEARS (owner, 2026-11-07) — the same window as shopify_order_source.
async function purgeOldSessions() {
  const r = await query(`DELETE FROM shopify_sessions_daily WHERE day < (CURRENT_DATE - make_interval(years => $1))`, [KEEP_YEARS]);
  if (r.rowCount) logger.info(`[shopifySessions] purged ${r.rowCount} session rows older than ${KEEP_YEARS} years`);
  return r.rowCount;
}

module.exports = { sessionCameFrom, recordSessions, purgeOldSessions, PAID_SPLIT_FROM };
