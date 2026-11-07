/*
=======================================================================================================================================
Module: utils/ga4.js
=======================================================================================================================================
Purpose: Run a Google Analytics 4 Data API report for the store's GA4 property — the attribution layer Search Console lacks (sessions,
         purchases and revenue by channel or landing page). Used by scripts/seo/organic-pages.js and product-priorities.js.
         READ ONLY (analytics.readonly).

Auth: the same service account as utils/searchConsole.js (GOOGLE_MERCHANT_CREDENTIALS_JSON via utils/googleAuth.js), granted Viewer
      on the GA4 property on 2026-07-17. No new key.

How it is read (docs/seo/README.md): GA4 undercounts absolute revenue (~60% of the sales table — consent, ad-blockers,
cross-device), so trust the SPLIT between channels / page types, never the pounds. "Organic Search" includes brand searches SEO did
not earn.
=======================================================================================================================================
*/

const { getAccessToken } = require('./googleAuth');

// GA4 property "brookfieldcomfort - GA4" (account Brookfield Comfort, 84449502). An id, not a secret.
const PROPERTY_ID = '312199890';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/*
 * runReport({ dimensions, metrics, start, end, filter, orderMetric, limit })
 * dimensions / metrics = GA4 API names. start/end accept GA4's own forms ('90daysAgo', 'yesterday', 'YYYY-MM-DD').
 * filter = { dimension, value } — an exact-match server-side filter (e.g. sessionDefaultChannelGroup = 'Organic Search').
 * orderMetric sorts descending by that metric. Returns plain objects keyed by dimension and metric name, metrics as numbers.
 */
async function runReport({ dimensions, metrics, start, end, filter, orderMetric, limit = 25000 }) {
  const token = await getAccessToken(SCOPE);
  const body = {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    limit,
  };
  if (filter) body.dimensionFilter = { filter: { fieldName: filter.dimension, stringFilter: { value: filter.value } } };
  if (orderMetric) body.orderBys = [{ metric: { metricName: orderMetric }, desc: true }];

  const resp = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`GA4 ${resp.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text).rows || []).map((row) => {
    const rec = {};
    dimensions.forEach((d, i) => { rec[d] = row.dimensionValues[i].value; });
    metrics.forEach((m, i) => { rec[m] = Number(row.metricValues[i].value) || 0; });
    return rec;
  });
}

module.exports = { runReport, PROPERTY_ID };
