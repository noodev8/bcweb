/*
=======================================================================================================================================
Util: googleAdsApi   (THE copy — the one place BCWEB calls the Google Ads API)
=======================================================================================================================================
Purpose: Read the two Google Ads reports straight from the Google Ads API, so nobody has to download them from the Report editor.
         Hands back EXACTLY the shape utils/googleAdsReports.js → parseReport() gives for an uploaded CSV, so the same plan and the
         same writes (utils/googleAdsImport.js → buildPlan / applyProduct / applyCampaign) serve both the file upload and the nightly
         sweep (scripts/google-jobs.js (ads)). One set of rules for what lands in google_product_daily / google_campaign_daily.

AUTH — NO NEW CREDENTIAL
The merchant-feed service account (GOOGLE_MERCHANT_CREDENTIALS_JSON, utils/googleAuth.js) asks for the `adwords` scope. It works
because the service account's email is added as a READ-ONLY USER inside the Google Ads account (Admin → Access and security) — Google's
"direct access" service-account flow, no Workspace domain-wide delegation needed. Connected 2026-11-15.

There is NO developer-token header. Google retired developer tokens on 2026-09-09: API access now belongs to the Google Cloud project
that owns the service account (merchant-feed-api-462809, Explorer access, 2,880 operations a day — a sweep is two or three).

THE TWO QUERIES = THE TWO SAVED REPORTS
  PRODUCT   shopping_performance_view: day × custom attribute 1 (style) × custom attribute 0 (label) × campaign. = bcweb_product_30.
  CAMPAIGN  campaign: day × campaign with search impression share + lost-IS. = adcost_summary_30. Impression share does not exist at
            product grain, which is why there are two.

WHAT THE API DOES DIFFERENTLY FROM THE CSV (and how each is made to match, so the stored rows cannot depend on which route they took)
  1. Cost is in MICROS (cost_micros 430000 = £0.43). Divided by 1,000,000 and rounded to 2dp like the export.
  2. Shares are FRACTIONS (0.7481), the stored figure is a PERCENT (74.81, what the CSV carries). × 100, 2dp.
  3. Google censors shares in the API too, but as numbers, not text: below 10% comes back as 0.0999 and above 90% as 0.9001. The CSV
     says '< 10%' / '> 90%' and parsePercent stores NULL ("we are not telling you" is not a measurement); those two exact values are
     NULLed here for the same reason. A share Google has not finished counting is simply absent → NULL.
  4. Custom attributes come back lower-case (`0043693-gizeh`), same as the export → upper-cased by parseLabel, same function.
  5. Campaign names upper-cased for the same reason as the CSV parser (they are in both tables' PRIMARY KEY — googleAdsReports.js).
  6. Zero-metric rows are left out by the API. The upsert never deletes, so nothing already stored is lost by their absence.

VERSION
API_VERSION is pinned. Google retires each version roughly a year after release; when this one goes, every call fails with a 404 /
UNSUPPORTED_VERSION, the sweep writes that into bclog as a failure, and the screen's freshness line starts ageing. Bump the constant
(the two queries are plain GAQL and rarely change between versions).
=======================================================================================================================================
Exports:
  isConfigured()                    -> boolean (GOOGLE_ADS_CUSTOMER_ID + the service-account JSON present)
  search(gaql)                      -> rows (all pages)
  fetchReports({ from, to })        -> { PRODUCT, CAMPAIGN }  each in parseReport()'s shape: { type, label, rows, skipped,
                                       extraColumns, window, rowCount, filename }
  shareOf(fraction)                 exported for tests
=======================================================================================================================================
*/

const config = require('../config/config');
const { getAccessToken } = require('./googleAuth');
const { REPORTS, parseLabel, addSkip } = require('./googleAdsReports');

const API_VERSION = 'v25';
const SCOPE = 'https://www.googleapis.com/auth/adwords';

// Google's censoring sentinels for the share metrics (see header note 3).
const CENSORED_LOW = 0.0999;
const CENSORED_HIGH = 0.9001;

function customerId() {
  // Accept it as typed in the Google Ads header ("331-341-8382") or bare.
  return String(config.googleAds.customerId || '').replace(/[^0-9]/g, '');
}

function isConfigured() {
  return Boolean(customerId() && config.google.credentialsJson);
}

/**
 * Run one GAQL query and return every row, following nextPageToken. An API error throws with Google's own message — the sweep writes
 * it to bclog, where "PERMISSION_DENIED" or "UNSUPPORTED_VERSION" says exactly what to fix.
 */
async function search(gaql) {
  const token = await getAccessToken(SCOPE);
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId()}/googleAds:search`;
  const rows = [];
  let pageToken;

  do {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pageToken ? { query: gaql, pageToken } : { query: gaql }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body?.error?.details?.[0]?.errors?.[0];
      const msg = detail ? `${Object.values(detail.errorCode || {}).join('/')}: ${detail.message}` : (body?.error?.message || res.statusText);
      throw new Error(`Google Ads API ${res.status} — ${msg}`);
    }
    rows.push(...(body.results || []));
    pageToken = body.nextPageToken;
  } while (pageToken);

  return rows;
}

const money = (micros) => Math.round(Number(micros || 0) / 10000) / 100;              // micros → pounds, 2dp
const twoDp = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

/** A share fraction → the stored percent, or NULL when Google withheld it (header note 3). */
function shareOf(fraction) {
  if (fraction === null || fraction === undefined) return null;
  const f = Number(fraction);
  if (!Number.isFinite(f) || f === CENSORED_LOW || f === CENSORED_HIGH) return null;
  return Math.round(f * 10000) / 100;
}

/** The window the rows actually cover — derived from the data, as parseReport does for a file. */
function windowOf(rows) {
  const dates = rows.map((r) => r.date).sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1], days: new Set(dates).size } : null;
}

/** An API row as the CSV parser's raw cells, for a skip example the preview/log can show. */
const exampleCells = (...vals) => vals.map((v) => (v === undefined || v === null ? '' : String(v)));

async function fetchProduct(from, to) {
  const results = await search(`
    SELECT segments.date, segments.product_custom_attribute1, segments.product_custom_attribute0, campaign.name,
           metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
      FROM shopping_performance_view
     WHERE segments.date BETWEEN '${from}' AND '${to}'`);

  const rows = [];
  const skipped = [];
  for (const r of results) {
    const seg = r.segments || {};
    const m = r.metrics || {};
    const campaign = String(r.campaign?.name || '').trim().toUpperCase();
    const groupid = parseLabel(seg.productCustomAttribute1);
    const cells = exampleCells(seg.date, seg.productCustomAttribute1, seg.productCustomAttribute0, r.campaign?.name, m.impressions, m.clicks);

    if (!campaign) { addSkip(skipped, 'NO_CAMPAIGN', 'No campaign name on the row', cells); continue; }
    if (!groupid) { addSkip(skipped, 'NO_STYLE', 'Custom label 1 (the style id) was empty', cells); continue; }

    rows.push({
      date: seg.date,
      groupid,
      googleLabel: parseLabel(seg.productCustomAttribute0),
      campaign,
      impressions: Number(m.impressions || 0),
      clicks: Number(m.clicks || 0),
      cost: money(m.costMicros),
      conversions: twoDp(m.conversions ?? 0),
      convValue: twoDp(m.conversionsValue ?? 0),
    });
  }

  return {
    type: 'PRODUCT', label: REPORTS.PRODUCT.label, filename: 'Google Ads API',
    rows, skipped, extraColumns: [], window: windowOf(rows), rowCount: results.length,
  };
}

async function fetchCampaign(from, to) {
  // impressions > 0: a campaign row with no impressions carries no share and no spend, and the CSV export never listed them either.
  const results = await search(`
    SELECT segments.date, campaign.name,
           metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions, metrics.conversions_value,
           metrics.search_impression_share, metrics.search_rank_lost_impression_share, metrics.search_budget_lost_impression_share
      FROM campaign
     WHERE segments.date BETWEEN '${from}' AND '${to}' AND metrics.impressions > 0`);

  const rows = [];
  const skipped = [];
  for (const r of results) {
    const seg = r.segments || {};
    const m = r.metrics || {};
    const campaign = String(r.campaign?.name || '').trim().toUpperCase();
    if (!campaign) { addSkip(skipped, 'NO_CAMPAIGN', 'No campaign name on the row', exampleCells(seg.date, r.campaign?.name)); continue; }

    rows.push({
      date: seg.date,
      campaign,
      clicks: Number(m.clicks || 0),
      impressions: Number(m.impressions || 0),
      cost: money(m.costMicros),
      searchImpShare: shareOf(m.searchImpressionShare),
      lostIsRank: shareOf(m.searchRankLostImpressionShare),
      lostIsBudget: shareOf(m.searchBudgetLostImpressionShare),
      conversions: twoDp(m.conversions ?? 0),
      convValue: twoDp(m.conversionsValue ?? 0),
    });
  }

  return {
    type: 'CAMPAIGN', label: REPORTS.CAMPAIGN.label, filename: 'Google Ads API',
    rows, skipped, extraColumns: [], window: windowOf(rows), rowCount: results.length,
  };
}

/**
 * Both reports for a date window (inclusive, 'YYYY-MM-DD'). The dates are validated here because they are put into the GAQL string.
 */
async function fetchReports({ from, to }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(from) || !iso.test(to)) throw new Error(`Bad date window ${from}..${to}`);
  if (!isConfigured()) throw new Error('Google Ads API not configured — GOOGLE_ADS_CUSTOMER_ID or GOOGLE_MERCHANT_CREDENTIALS_JSON missing');

  const [PRODUCT, CAMPAIGN] = await Promise.all([fetchProduct(from, to), fetchCampaign(from, to)]);
  return { PRODUCT, CAMPAIGN };
}

module.exports = { isConfigured, search, fetchReports, shareOf };
