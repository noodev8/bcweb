/*
=======================================================================================================================================
Module: utils/orderSource.js
=======================================================================================================================================
Purpose: Where each Shopify order's buyer came from — read from Shopify, judged by OUR rule, kept in bcweb (shopify_order_source).
         Step 1 of measuring "more Shopify sales we didn't pay Google for" (owner, 2026-11-07; docs/seo/PLAN.md): our own data first,
         Google's second. THE copy of the rule — anything that reports sales by source reads came_from, never re-derives it.

THE RULE — cameFrom(order), first match wins:
  1. Not a web order (POS, draft …)                                  → 'Not online'
  2. Landing URL carries a paid-click marker — gclid / gbraid / wbraid / gad_source / dclid, or utm_medium cpc|ppc|paid… :
       from Google → 'Google paid'; anyone else → 'Other paid'
  3. AI assistant — utm_source or referrer ChatGPT / OpenAI / Perplexity / Gemini / Copilot / Claude  → 'AI'
  4. Email — utm_medium email|newsletter, or Shopify's journey says NEWSLETTER / email                 → 'Email'
  5. Landing URL carries srsltid (Google's free product listings / organic product results)           → 'Google free'
  6. Referrer is Google (any google.* host, or the Android Google app)                               → 'Google free'
       (a paid click carries gclid — rule 2 — so a Google referrer WITHOUT a marker is a free one)
  7. Referrer is another search engine (Bing, DuckDuckGo, Yahoo, Ecosia …)                            → 'Other search'
  8. Referrer is social (Facebook, Instagram, TikTok, Pinterest, X …)                                 → 'Social'
  9. Any other outside referrer, or a utm_source we don't know                                        → 'Other site'
 10. A landing URL with no referrer (typed, bookmarked, our own site)                                 → 'Direct'
 11. NO landing URL (the shopper declined tracking — about half the web orders): fall back to Shopify's journey label —
       Google → 'Google (paid or free?)' (the journey strips the markers, so it can't say which) · ChatGPT etc → 'AI' ·
       Bing etc → 'Other search' · email → 'Email' · direct → 'Direct' · nothing → 'Unknown'

Why REST *and* the journey: REST's landing_site keeps the FULL first landing URL with its markers — the only way to tell a paid Google
Shopping click from a free Google visit (Shopify's own journey / Analytics call both "Google / SEO"). The GraphQL journey fills some of
the orders where landing_site is missing. Checked 2026-11-07 on 60 days: 57 paid-marked, 9 srsltid, 92 with no landing_site (33 of
those labelled by the journey, 59 nothing at all — roughly a third of web orders will always be Unknown).

recordOrderSources({ since, until }) reads every Shopify order created in the window (all statuses), works out came_from and the landing
page, and UPSERTS shopify_order_source (one row per order id). Called by Update Orders after its commit (last 3 days, so a journey that
arrives late is picked up) and by scripts/shopify-order-source-backfill.js. READ ONLY on Shopify (the read_orders token).
=======================================================================================================================================
*/

const config = require('../config/config');
const { query } = require('../database');
const { shopifyRestGet, requireConfig, parseNextLink } = require('./shopifyOrders');
const logger = require('./logger');

const PAGE_SIZE = 250;
const JOURNEY_BATCH = 50;

const AI_RE = /chatgpt|openai|perplexity|gemini\.google|bard\.google|copilot|claude\.ai|you\.com/i;
const SEARCH_RE = /(^|\.)(bing|duckduckgo|yahoo|ecosia|yandex|baidu|search\.brave|startpage|qwant)\./i;
const SOCIAL_RE = /(^|\.)(facebook|fb|instagram|tiktok|pinterest|twitter|x|t|linkedin|reddit|youtube|threads)\.(com|co|net)$/i;
const OWN_RE = /brookfieldcomfort|myshopify\.com|shopify\.com|shop\.app|paypal\.com/i;
const GOOGLE_RE = /(^|\.)google\.[a-z.]+$|googlequicksearchbox/i;

// Query params of a landing URL ('/products/x?variant=1&gclid=…' or a full URL).
function paramsOf(landing) {
  if (!landing) return new URLSearchParams();
  try { return new URL(landing, 'https://brookfieldcomfort.com').searchParams; } catch { return new URLSearchParams(); }
}
// Host of a referrer URL ('https://www.google.com/' → 'www.google.com'; an Android app id passes through).
function hostOf(ref) {
  if (!ref) return '';
  try { return new URL(ref).hostname.toLowerCase(); } catch { return String(ref).toLowerCase(); }
}

/*
 * cameFrom({ source_name, landing_site, referring_site, journey_source, journey_source_type }) -> label (see THE RULE above)
 */
function cameFrom(o) {
  if (o.source_name !== 'web') return 'Not online';

  const p = paramsOf(o.landing_site);
  const utmSource = (p.get('utm_source') || '').toLowerCase();
  const utmMedium = (p.get('utm_medium') || '').toLowerCase();
  const ref = hostOf(o.referring_site);
  const external = ref && !OWN_RE.test(ref);

  if (['gclid', 'gbraid', 'wbraid', 'gad_source', 'dclid'].some((k) => p.has(k))
      || /^(cpc|ppc|paid|paidsearch|paid_search|shopping_ads)$/.test(utmMedium)) {
    return (/google/.test(utmSource) || GOOGLE_RE.test(ref) || !utmSource) ? 'Google paid' : 'Other paid';
  }
  if (AI_RE.test(utmSource) || (external && AI_RE.test(ref))) return 'AI';
  if (/email|newsletter/.test(utmMedium)) return 'Email';
  if (p.has('srsltid')) return 'Google free';
  if (external && GOOGLE_RE.test(ref)) return 'Google free';
  if (external && SEARCH_RE.test(ref)) return 'Other search';
  if (external && SOCIAL_RE.test(ref)) return 'Social';
  if (external || utmSource) return 'Other site';
  if (o.landing_site) return 'Direct';

  // No landing URL — Shopify's journey label is all there is.
  const js = String(o.journey_source || '').toLowerCase();
  const jt = String(o.journey_source_type || '').toLowerCase();
  if (!js && !jt) return 'Unknown';
  if (/google/.test(js)) return 'Google (paid or free?)';
  if (AI_RE.test(js)) return 'AI';
  if (/bing|duckduckgo|yahoo|ecosia/.test(js)) return 'Other search';
  if (/newsletter|email/.test(jt) || /email/.test(js)) return 'Email';
  if (/facebook|instagram|tiktok|pinterest/.test(js)) return 'Social';
  if (js === 'direct') return 'Direct';
  return 'Other site';
}

// The page landed on: { type, handle } from a landing URL or path.
function landingOf(url) {
  if (!url) return { type: null, handle: null };
  let path;
  try { path = new URL(url, 'https://brookfieldcomfort.com').pathname.toLowerCase(); } catch { return { type: 'other', handle: null }; }
  const m = path.match(/\/(products|collections)\/([^/]+)/);
  if (m) {
    // /collections/x/products/y is a product page reached through a collection.
    const prod = path.match(/\/products\/([^/]+)/);
    return prod ? { type: 'product', handle: prod[1] } : { type: 'collection', handle: m[2] };
  }
  if (path === '/' || path === '') return { type: 'home', handle: null };
  if (path.startsWith('/blogs/')) return { type: 'blog', handle: path.split('/').filter(Boolean).pop() };
  if (path.startsWith('/pages/')) return { type: 'page', handle: path.split('/').filter(Boolean).pop() };
  return { type: 'other', handle: null };
}

// Shopify's journey (lastVisit) for a batch of order ids, through GraphQL on the same read_orders token. { id: { source, type, landing } }
async function journeys(ids) {
  const { shop, accessToken } = requireConfig();
  const out = {};
  const q = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { legacyResourceId
    customerJourneySummary { lastVisit { source sourceType landingPage } } } } }`;
  for (let i = 0; i < ids.length; i += JOURNEY_BATCH) {
    const batch = ids.slice(i, i + JOURNEY_BATCH).map((id) => `gid://shopify/Order/${id}`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(`https://${shop}.myshopify.com/admin/api/${config.shopify.apiVersion}/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, variables: { ids: batch } }),
      });
      const j = await res.json().catch(() => ({}));
      const throttled = res.status === 429 || (j.errors && JSON.stringify(j.errors).includes('THROTTLED'));
      if (throttled && attempt < 3) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
      if (!res.ok || j.errors) throw new Error(`Shopify journey read failed: ${res.status} ${JSON.stringify(j.errors || '').slice(0, 200)}`);
      for (const n of j.data.nodes) {
        const v = n && n.customerJourneySummary && n.customerJourneySummary.lastVisit;
        if (n) out[n.legacyResourceId] = v ? { source: v.source || null, type: v.sourceType || null, landing: v.landingPage || null } : {};
      }
      break;
    }
  }
  return out;
}

/*
 * recordOrderSources({ since, until, write }) -> { read, recorded, tally }
 * since / until: ISO dates or timestamps (until optional). Reads every Shopify order created in the window and upserts its row.
 * write: false = DRY RUN — nothing touches the database; `tally` ({ came_from: { orders, total } }) shows what would be recorded.
 */
async function recordOrderSources({ since, until, write = true } = {}) {
  const { shop, apiVersion } = requireConfig();
  const fields = 'id,name,created_at,source_name,total_price,landing_site,referring_site';
  let url = `https://${shop}.myshopify.com/admin/api/${apiVersion}/orders.json?status=any&limit=${PAGE_SIZE}&fields=${fields}`
    + `&created_at_min=${encodeURIComponent(since)}${until ? `&created_at_max=${encodeURIComponent(until)}` : ''}`;

  let read = 0; let recorded = 0;
  const tally = {};
  while (url) {
    const { body, linkHeader } = await shopifyRestGet(url);
    const orders = (body && body.orders) || [];
    read += orders.length;
    const j = orders.length ? await journeys(orders.map((o) => o.id)) : {};

    for (const o of orders) {
      const jv = j[String(o.id)] || {};
      const row = {
        source_name: o.source_name || null,
        landing_site: o.landing_site || null,
        referring_site: o.referring_site || null,
        journey_source: jv.source || null,
        journey_source_type: jv.type || null,
      };
      const land = landingOf(row.landing_site || jv.landing);
      const came = cameFrom(row);
      const t = tally[came] || (tally[came] = { orders: 0, total: 0 });
      t.orders++; t.total += Number(o.total_price) || 0;
      if (!write) continue;
      await query(
        `INSERT INTO shopify_order_source (shopify_order_id, ordernum, created_at, source_name, total, landing_site, referring_site,
                                           journey_source, journey_source_type, journey_landing, came_from, landing_type, landing_handle, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
         ON CONFLICT (shopify_order_id) DO UPDATE SET
           ordernum = EXCLUDED.ordernum, created_at = EXCLUDED.created_at, source_name = EXCLUDED.source_name, total = EXCLUDED.total,
           landing_site = EXCLUDED.landing_site, referring_site = EXCLUDED.referring_site, journey_source = EXCLUDED.journey_source,
           journey_source_type = EXCLUDED.journey_source_type, journey_landing = EXCLUDED.journey_landing, came_from = EXCLUDED.came_from,
           landing_type = EXCLUDED.landing_type, landing_handle = EXCLUDED.landing_handle, recorded_at = now()`,
        [o.id, o.name, o.created_at, row.source_name, Number(o.total_price) || 0, row.landing_site, row.referring_site,
          row.journey_source, row.journey_source_type, jv.landing || null, came, land.type, land.handle],
      );
      recorded++;
    }
    url = parseNextLink(linkHeader);
  }
  if (recorded) logger.info(`[orderSource] ${recorded} Shopify order sources recorded (${read} read since ${since})`);
  return { read, recorded, tally };
}

/*
 * purgeOldSources() -> rows deleted
 * KEEP 2 YEARS (owner, 2026-11-07: "keep 2 years" — "lets make sure we dont overfill data"). Two years is the least that still
 * compares a month with the same month last year, which the sessions / free-sales target needs. Run by Update Orders after it records
 * (so no cron); a backfill further back than 2 years is trimmed on the next run.
 */
const KEEP_YEARS = 2;
async function purgeOldSources() {
  const r = await query(`DELETE FROM shopify_order_source WHERE created_at < now() - make_interval(years => $1)`, [KEEP_YEARS]);
  if (r.rowCount) logger.info(`[orderSource] purged ${r.rowCount} order sources older than ${KEEP_YEARS} years`);
  return r.rowCount;
}

module.exports = { cameFrom, landingOf, recordOrderSources, purgeOldSources, KEEP_YEARS };
