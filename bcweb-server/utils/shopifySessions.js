/*
=======================================================================================================================================
Module: utils/shopifySessions.js
=======================================================================================================================================
Purpose: Shopify's visits per day, by where they came from, kept in bcweb (shopify_sessions_daily) — step 3 of measuring "more Shopify
         sales we didn't pay Google for" (owner, 2026-11-07; docs/seo/PLAN.md). The target is Shopify SESSIONS, ~20 a day → 30, in
         Shopify's own count (owner chose Shopify over GA4, which counts ~2×).

Source: Shopify's sessions report through ShopifyQL (GraphQL shopifyqlQuery), on the "bcweb-fulfill" Dev Dashboard app's token
        (utils/shopifyFulfil.js → accessToken; read_reports added 2026-11-07). READ ONLY on Shopify. One query returns every
        (day × referrer_source × referrer_name × utm_source × utm_medium × traffic_type) with its sessions — a few rows a day.

HUMAN VISITS ONLY (WHERE human_or_bot_session = 'human'): that is what Shopify's Home "Sessions" shows (checked 2026-11-07: Home 6
        today = human 6; the report's total was 22 with 16 bots). The first version counted bots too and ran ~⅓ high — the owner's
        "about 20 a day" was the human count.

PAID vs FREE from Shopify's own traffic_type (paid / organic / direct …), which it sets from the ad click itself — so the split holds
        for the PAST too (Oct 2025 human Google visits: 1,254 paid, 467 organic), not only from the Google Ads final URL suffix
        (2026-11-08, PAID_SPLIT_FROM, now only the fallback when traffic_type is missing).

THE RULE — sessionCameFrom(row), the same labels as an order's came_from (utils/orderSource.js), first match wins:
  utm_medium cpc|ppc|paid… → 'Google paid' (Google, or no other source named) / 'Other paid'
  AI (utm_source or referrer chatgpt / perplexity / gemini / copilot / claude …) → 'AI'
  utm_medium email|newsletter, or referrer_source email → 'Email'   (before the next line: Shopify labels newsletter visits 'paid')
  traffic_type 'paid' → 'Google paid' (Google, or no other source named — Google Ads is the only ad account; a paid visit with its
                                    referrer hidden arrives as "direct + paid") / 'Other paid'
  referrer_source search + google → 'Google free' (traffic_type organic; or no traffic_type from PAID_SPLIT_FROM on) — with no
                                    traffic_type before then → 'Google (paid or free?)'
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
  const tt = (r.traffic_type || '').toLowerCase();
  const google = (!us || /google/.test(us)) && (!rn || /google/.test(rn));
  if (/^(cpc|ppc|paid|paidsearch|paid_search|shopping_ads)$/.test(um)) return google ? 'Google paid' : 'Other paid';
  if (AI_RE.test(us) || AI_RE.test(rn)) return 'AI';
  // Email BEFORE Shopify's paid label: Shopify marks newsletter visits (utm_medium=email) traffic_type 'paid' too — checked
  // 2026-11-07, Email fell from ~1,900 to 28 when the paid label came first.
  if (/email|newsletter/.test(um) || rs === 'email') return 'Email';
  if (tt === 'paid') return google ? 'Google paid' : 'Other paid';
  if (rs === 'search') {
    if (/google/.test(rn)) return (tt === 'organic' || r.day >= PAID_SPLIT_FROM) ? 'Google free' : 'Google (paid or free?)';
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
  // Human visits only — what Shopify's Home "Sessions" shows (see the header).
  const rows = await shopifyql(`FROM sessions SHOW sessions WHERE human_or_bot_session = 'human' `
    + `GROUP BY day, referrer_source, referrer_name, utm_source, utm_medium, traffic_type `
    + `SINCE ${since} UNTIL ${until || 'today'} ORDER BY day LIMIT 10000`);
  const clean = rows.map((r) => {
    const x = {
      day: String(r.day).slice(0, 10),
      referrer_source: r.referrer_source || '', referrer_name: r.referrer_name || '',
      utm_source: r.utm_source || '', utm_medium: r.utm_medium || '', traffic_type: r.traffic_type || '',
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
      `INSERT INTO shopify_sessions_daily (day, referrer_source, referrer_name, utm_source, utm_medium, traffic_type, sessions, came_from)
       SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[])`,
      ['day', 'referrer_source', 'referrer_name', 'utm_source', 'utm_medium', 'traffic_type', 'sessions', 'came_from'].map((k) => clean.map((r) => r[k])),
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
