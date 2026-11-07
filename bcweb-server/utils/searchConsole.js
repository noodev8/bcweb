/*
=======================================================================================================================================
Module: utils/searchConsole.js
=======================================================================================================================================
Purpose: Read Google Search Console (Search Analytics) for brookfieldcomfort.com — the source of every SEO report in scripts/seo/.
         READ ONLY: the scope is webmasters.readonly, so nothing here can change anything in Search Console.

Auth: the SAME service account as the Merchant API push (GOOGLE_MERCHANT_CREDENTIALS_JSON → utils/googleAuth.js), which was granted
      Search Console access on 2026-07-16 for the Python scripts this replaces (C:\scripts\seo, moved here 2026-11-07). No new key.

Paging: the API returns at most 25,000 rows per call. A 28-day query × page pull is close to that on this site, so gscQuery() pages
        with startRow until a short page comes back — the Python version took the first 25,000 and silently dropped the rest.

Dates: GSC is complete only up to ~3 days ago (GSC_LAG_DAYS); every report ends there so the last days don't read as a fall.
       Dates are built from LOCAL calendar parts (ymd), never toISOString(), which would shift a day across midnight in BST.
=======================================================================================================================================
*/

const { getAccessToken } = require('./googleAuth');

const SITE_URL = 'https://brookfieldcomfort.com/';     // the verified property in Search Console
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const PAGE_SIZE = 25000;                               // the API's maximum rowLimit
const GSC_LAG_DAYS = 3;                                // Search Console data is not complete for the last ~3 days

// 'YYYY-MM-DD' from a Date's LOCAL calendar parts.
function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A Date `n` days from `d` (negative = back). Local midnight arithmetic, so DST changes don't move the calendar day.
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

// The last complete day of GSC data.
function gscEnd() {
  return addDays(new Date(), -GSC_LAG_DAYS);
}

/*
 * gscQuery({ start, end, dimensions, filters, type })
 * One Search Analytics query, every row (paged). start/end are Dates or 'YYYY-MM-DD'. filters = [{ dimension, operator, expression }]
 * (ANDed). Returns the API's rows: { keys: [...], clicks, impressions, ctr, position }. Throws with Google's message on failure.
 */
async function gscQuery({ start, end, dimensions, filters, type } = {}) {
  const token = await getAccessToken(SCOPE);
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;
  const body = {
    startDate: typeof start === 'string' ? start : ymd(start),
    endDate: typeof end === 'string' ? end : ymd(end),
    rowLimit: PAGE_SIZE,
  };
  if (dimensions && dimensions.length) body.dimensions = dimensions;
  if (filters && filters.length) body.dimensionFilterGroups = [{ filters }];
  if (type) body.type = type;

  const rows = [];
  for (let startRow = 0; ; startRow += PAGE_SIZE) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, startRow }),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Search Console ${resp.status}: ${text.slice(0, 300)}`);
    const page = (JSON.parse(text).rows) || [];
    rows.push(...page);
    // No dimensions = one total row; a short page = the last one.
    if (!body.dimensions || page.length < PAGE_SIZE) return rows;
  }
}

module.exports = { gscQuery, gscEnd, addDays, ymd, SITE_URL, GSC_LAG_DAYS };
