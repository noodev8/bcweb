/*
=======================================================================================================================================
Module: utils/ebayTraffic.js
=======================================================================================================================================
Purpose: VIEWS for the eBay listings screen (owner, 2026-11-04: "It will tell us if we are getting any kind of traction ... I need more
         data to decide what ebay is for us"). READ ONLY — nothing is written to eBay or the DB, nothing is stored.

THE READ — Analytics API getTrafficReport, dimension LISTING, for the listings the screen shows, over the last WINDOW_DAYS days:
  LISTING_VIEWS_TOTAL        page views of the listing (the "Views" column)
  LISTING_IMPRESSION_TOTAL   times it was SHOWN to a buyer (search results, store, eBay's own pages) — "seen"
  CLICK_THROUGH_RATE         views from search ÷ search impressions, as eBay reports it (a %)
  TRANSACTION                sales eBay counted in the window
Why not GetSellerList: it leaves HitCount blank. The traffic report needs the sell.analytics.readonly scope, minted by
scripts/ebay-token.js since 2026-11-04 (utils/ebayAuth.js → ANALYTICS_SCOPES, kept apart so an old token only blanks this column).

GRAIN: per LISTING, never per size — eBay doesn't split traffic by variation.
LATENCY: eBay's traffic figures run a day or two behind; the report's own lastUpdatedDate is passed on so the screen can say so.
FAILS SOFT: the caller catches any error and shows the listings without views (the message says why).
=======================================================================================================================================
*/

const { analyticsToken, dropAnalyticsToken } = require('./ebayAuth');

const API = 'https://api.ebay.com/sell/analytics/v1/traffic_report';
const WINDOW_DAYS = 30;
const MAX_IDS = 200;          // eBay's cap on listing_ids per call
const TIMEOUT_MS = 30000;
const METRICS = ['LISTING_VIEWS_TOTAL', 'LISTING_IMPRESSION_TOTAL', 'CLICK_THROUGH_RATE', 'TRANSACTION'];

function coded(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// 'YYYYMMDD' for a London calendar day, `back` days before today.
function londonDay(back) {
  const d = new Date(Date.now() - back * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d).replace(/-/g, '');
}

async function trafficGet(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${await analyticsToken()}`,
          Accept: 'application/json',
          'Accept-Language': 'en-GB',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (err) {
      if (err.code) throw err;   // token problems arrive already coded (invalid_scope = re-mint the token)
      throw coded('EBAY_ERROR', `eBay request failed: ${err.message}`);
    }
    if (res.status === 401 && attempt === 1) { dropAnalyticsToken(); continue; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const first = Array.isArray(body.errors) && body.errors[0] ? ` — ${body.errors[0].message}` : '';
      throw coded('EBAY_ERROR', `eBay Analytics answered HTTP ${res.status}${first}`);
    }
    return body;
  }
  throw coded('EBAY_ERROR', 'eBay rejected the analytics token twice — run scripts/ebay-token.js again');
}

const metricNum = (m) => (m && m.applicable !== false && m.value !== undefined && m.value !== null ? Number(m.value) : null);

/**
 * Views etc. for these listing ids over the last WINDOW_DAYS days.
 * Returns { days, from, to, updated, byItem: Map(itemId -> { views, impressions, ctr, sold }) }.
 * A listing eBay has no row for (no traffic yet) is left out of the map — the caller shows 0.
 */
async function fetchTraffic(itemIds) {
  const ids = [...new Set(itemIds.filter(Boolean).map(String))];
  const from = londonDay(WINDOW_DAYS - 1);
  const to = londonDay(0);
  const byItem = new Map();
  let updated = null;

  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const chunk = ids.slice(i, i + MAX_IDS);
    const filter = `marketplace_ids:{EBAY_GB},date_range:[${from}..${to}],listing_ids:{${chunk.join('|')}}`;
    const url = `${API}?dimension=LISTING&metric=${METRICS.join(',')}&filter=${encodeURIComponent(filter)}`;
    const body = await trafficGet(url);

    // The header names the metric order; records carry values in that order.
    const keys = ((body.header && body.header.metrics) || []).map((m) => m.key);
    const at = (k) => keys.indexOf(k);
    for (const r of body.records || []) {
      const id = r.dimensionValues && r.dimensionValues[0] ? String(r.dimensionValues[0].value) : null;
      if (!id) continue;
      const v = r.metricValues || [];
      byItem.set(id, {
        views: metricNum(v[at('LISTING_VIEWS_TOTAL')]),
        impressions: metricNum(v[at('LISTING_IMPRESSION_TOTAL')]),
        ctr: metricNum(v[at('CLICK_THROUGH_RATE')]),
        sold: metricNum(v[at('TRANSACTION')])
      });
    }
    if (body.lastUpdatedDate) updated = body.lastUpdatedDate;
  }
  return { days: WINDOW_DAYS, from, to, updated, byItem };
}

module.exports = { fetchTraffic, WINDOW_DAYS };
