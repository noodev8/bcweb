/*
=======================================================================================================================================
API Route: seo_styles
=======================================================================================================================================
Method: GET
Purpose: The SEO work list (owner, 2026-11-07: a screen "to help communicate my questions to you and to help me understand what to
         work on" — the WORK LIST first, ONE ROW PER STYLE). The idea being tested (docs/seo/PLAN.md): Birkenstock product pages carry
         Birkenstock's own marketing copy, shared word-for-word with other retailers, ~87 words; the one page that climbed to #1 (the
         size-6 blog) had a clear, specific answer of our own. So the work is written once per STYLE and applies to all its colours —
         a row here is one piece of work.

         Membership: every Birkenstock style live on Shopify (skusummary brand ILIKE 'birk%', shopify = 1, a handle). Style = the word
         after the last '-' of the groupid (utils/seo.js → styleOf; the handle can carry the wrong name).

         Per style:
           pages        live product pages (one per colour / width)
           words        MEDIAN words in their Shopify description (shopify_description, fetched by /descriptions-review — `fetched`
                        says when; the HTML as Shopify holds it, CSS dropped)
           impressions  Google searches that showed one of its pages, 28 days (Search Console)
           clicks       those that clicked, 28 days
           position     impression-weighted average position, 28 days (a diagnostic, never the score — docs/seo/README.md)
           profit       12-month Shopify profit, net of returns (sales.profit, channel SHP) — what the style is worth to us
         and for the drop-down: its pages (handle, words, impressions, clicks, position) and its top searches (query, impressions,
         clicks, position) across all its pages.

         Search Console is read live (READ ONLY, the merchant-feed service account — utils/searchConsole.js) and held in memory for
         an hour: the numbers change daily at most, and a page×query pull is a few seconds. `?refresh=1` re-reads it.

         Order: profit first (the screen re-sorts by any column). READ ONLY — nothing is written anywhere.

Requires auth.
=======================================================================================================================================
Request: GET /seo-styles[?refresh=1]

Success Response:
{
  "return_code": "SUCCESS",
  "data_to": "2026-11-04", "window_days": 28, "descriptions_fetched": "2026-11-02",
  "rows": [ { "style": "ARIZONA", "pages": 66, "words": 89, "impressions": 1900, "clicks": 12, "position": 12.0, "profit": 4800,
              "page_list": [ { "handle": "…", "groupid": "…", "words": 86, "impressions": 40, "clicks": 1, "position": 9.2 } ],
              "queries": [ { "query": "birkenstock arizona", "impressions": 300, "clicks": 2, "position": 8.1 } ] } ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { gscQuery, gscEnd, addDays, ymd } = require('../utils/searchConsole');
const { handleOf, styleFromGroupid, styleOf, wordCount } = require('../utils/seo');
const logger = require('../utils/logger');

router.use(verifyToken);

const WINDOW_DAYS = 28;          // page level: a product page does a few clicks a week, 7d is noise
const TOP_QUERIES = 12;          // searches shown per style in the drop-down
const GSC_TTL_MS = 60 * 60 * 1000;

// { at, end, pages, queries } — product-page rows, 28 days. TWO reads on purpose: page totals come from the page-only pull, because
// Search Console hides rare searches from page × query rows (the size guide names only a third of its impressions), so summing named
// queries would undercount a page several times over. The page × query pull is used only for the "what people search" list.
let gscCache = null;

async function productSearchRows(refresh) {
  if (!refresh && gscCache && Date.now() - gscCache.at < GSC_TTL_MS) return gscCache;
  const end = gscEnd();
  const start = addDays(end, -(WINDOW_DAYS - 1));
  const isProduct = (r) => r.keys[0].includes('/products/');
  const [pages, queries] = await Promise.all([
    gscQuery({ start, end, dimensions: ['page'] }),
    gscQuery({ start, end, dimensions: ['page', 'query'] }),
  ]);
  gscCache = { at: Date.now(), end: ymd(end), pages: pages.filter(isProduct), queries: queries.filter(isProduct) };
  return gscCache;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const round1 = (n) => Math.round(n * 10) / 10;

router.get('/', async (req, res) => {
  try {
    const [cat, gsc] = await Promise.all([
      query(`
        SELECT ss.groupid, LOWER(ss.handle) AS handle, sd.description_html, sd.fetched_at::date::text AS fetched,
               COALESCE(p.profit, 0)::float AS profit
        FROM skusummary ss
        LEFT JOIN shopify_description sd ON LOWER(sd.handle) = LOWER(ss.handle)
        LEFT JOIN (
          SELECT groupid, SUM(profit) AS profit FROM sales
          WHERE channel = 'SHP' AND solddate >= CURRENT_DATE - INTERVAL '12 months'
          GROUP BY groupid
        ) p ON p.groupid = ss.groupid
        WHERE ss.brand ILIKE 'birk%' AND ss.shopify = 1 AND COALESCE(ss.handle, '') <> ''
      `),
      productSearchRows(req.query.refresh === '1'),
    ]);

    // Search Console page totals per handle (?variant= URLs fold into their page), and the named searches per handle.
    const pageTotals = new Map();
    for (const r of gsc.pages) {
      const h = handleOf(r.keys[0], 'products');
      if (!h) continue;
      const t = pageTotals.get(h) || { impressions: 0, clicks: 0, pw: 0 };
      t.impressions += r.impressions; t.clicks += r.clicks; t.pw += r.position * r.impressions;
      pageTotals.set(h, t);
    }
    const byHandle = new Map();
    for (const r of gsc.queries) {
      const h = handleOf(r.keys[0], 'products');
      if (!h) continue;
      const list = byHandle.get(h) || [];
      list.push({ query: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: r.position });
      byHandle.set(h, list);
    }

    const known = new Set(cat.rows.map((r) => styleFromGroupid(r.groupid)).filter(Boolean));
    const styles = new Map();
    let fetched = null;
    for (const r of cat.rows) {
      if (r.fetched && (!fetched || r.fetched > fetched)) fetched = r.fetched;
      const s = styleOf(r.groupid, r.handle, known);
      const st = styles.get(s) || { style: s, profit: 0, pages: [], q: new Map() };
      const t = pageTotals.get(r.handle) || { impressions: 0, clicks: 0, pw: 0 };
      const impr = t.impressions; const { clicks, pw } = t;
      for (const x of byHandle.get(r.handle) || []) {
        const a = st.q.get(x.query) || { query: x.query, impressions: 0, clicks: 0, pw: 0 };
        a.impressions += x.impressions; a.clicks += x.clicks; a.pw += x.position * x.impressions;
        st.q.set(x.query, a);
      }
      st.profit += r.profit;
      st.pages.push({
        handle: r.handle, groupid: r.groupid,
        words: r.description_html == null ? null : wordCount(r.description_html),
        impressions: impr, clicks, position: impr ? round1(pw / impr) : null, profit: Math.round(r.profit),
      });
      styles.set(s, st);
    }

    const rows = [...styles.values()].map((st) => {
      const impr = st.pages.reduce((a, p) => a + p.impressions, 0);
      const pw = st.pages.reduce((a, p) => a + (p.position || 0) * p.impressions, 0);
      return {
        style: st.style,
        pages: st.pages.length,
        words: median(st.pages.map((p) => p.words).filter((w) => w != null)),
        impressions: impr,
        clicks: st.pages.reduce((a, p) => a + p.clicks, 0),
        position: impr ? round1(pw / impr) : null,
        profit: Math.round(st.profit),
        page_list: st.pages.sort((a, b) => b.impressions - a.impressions || b.profit - a.profit),
        queries: [...st.q.values()].sort((a, b) => b.impressions - a.impressions).slice(0, TOP_QUERIES)
          .map((a) => ({ query: a.query, impressions: a.impressions, clicks: a.clicks, position: a.impressions ? round1(a.pw / a.impressions) : null })),
      };
    }).sort((a, b) => b.profit - a.profit || b.impressions - a.impressions);

    return res.json({ return_code: 'SUCCESS', data_to: gsc.end, window_days: WINDOW_DAYS, descriptions_fetched: fetched, rows });
  } catch (err) {
    logger.error('[seo-styles] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the SEO work list' });
  }
});

module.exports = router;
