/*
=======================================================================================================================================
Module: utils/seo.js
=======================================================================================================================================
Purpose: The helpers every SEO report in scripts/seo/ shares, so they classify pages, fold URLs into handles, weight positions and
         keep their review cooldowns the same way. Moved from the Python scripts in C:\scripts\seo (2026-11-07) — the rules are
         unchanged, only the language. The why behind them is docs/seo/README.md; how we operate is docs/seo/PLAN.md.

What lives here:
  - classify(url)            page type: collections / products / homepage / pages / blogs / misc
  - handleOf(url, kind)      '/collections/x?page=2' → 'x' (pagination folds into its page)
  - toUrl(arg)               a path or full URL from the command line → a full URL (survives Git Bash's path mangling)
  - totals(rows)             clicks, impressions, CTR and IMPRESSION-WEIGHTED position for a set of GSC rows
  - shopifyCollections()     every Shopify collection with its product count, type (smart/manual), SEO fields and text length
  - reviews (load/save)      the --review cooldown state for the two priority lists, a JSON file in docs/seo/ (git keeps it in step
                             across both PCs)
  - text helpers             num / pct / pad for the fixed-width console tables

Position is always impression-weighted: a plain mean lets a page with 3 impressions at position 90 drag the whole number around.
=======================================================================================================================================
*/

const fs = require('fs');
const path = require('path');
const { SITE_URL } = require('./searchConsole');
const { shopifyGraphQL } = require('./shopify');

const SITE_ROOT = SITE_URL.replace(/\/$/, '');

// docs/seo/ at the repo root — where the plan, change log, review state and generated priority lists live. Scripts are run on the
// dev PC (the VPS holds bcweb-server only, so these reports aren't run there).
const SEO_DOCS = path.join(__dirname, '..', '..', 'docs', 'seo');

// Page type from a full URL or a path. Order matters: /collections/ before the rest (a product URL can sit under a collection).
function classify(url) {
  const u = String(url || '');
  if (u.includes('/collections/')) return 'collections';
  if (u.includes('/products/')) return 'products';
  const p = u.replace(SITE_ROOT, '').replace(/[?#].*$/, '').replace(/\/$/, '');
  if (p === '') return 'homepage';
  if (u.includes('/pages/')) return 'pages';
  if (u.includes('/blogs/')) return 'blogs';
  return 'misc';
}

// The handle after /collections/ or /products/, with query strings and trailing paths stripped so ?page=2 folds into its page.
function handleOf(url, kind = 'collections') {
  const marker = `/${kind}/`;
  const u = String(url || '');
  if (!u.includes(marker)) return null;
  return u.split(marker)[1].split(/[?#]/)[0].split('/')[0].toLowerCase();
}

// A path or URL from the command line → a full URL. Git Bash (MSYS) rewrites a leading-slash argument into a Windows path, so
// "--page /collections/x" arrives as "C:/Program Files/Git/collections/x"; every Shopify URL carries one of these markers, so we
// recover from the marker onward instead of silently querying a nonsense URL and reporting zero rows.
function toUrl(s) {
  if (/^https?:/.test(s)) return s;
  for (const marker of ['/collections/', '/pages/', '/products/', '/blogs/']) {
    const i = s.indexOf(marker);
    if (i >= 0) return SITE_ROOT + s.slice(i);
  }
  return SITE_ROOT + (s.startsWith('/') ? s : `/${s}`);
}

// URL → the short path printed in tables.
function short(url, width = 52) {
  return (String(url).replace(SITE_ROOT, '') || '/').slice(0, width);
}

// { clicks, impr, ctr (%), pos } for a set of GSC rows — position weighted by impressions.
function totals(rows) {
  let clicks = 0; let impr = 0; let pw = 0;
  for (const r of rows) { clicks += r.clicks; impr += r.impressions; pw += r.position * r.impressions; }
  return { clicks, impr, ctr: impr ? (clicks / impr) * 100 : 0, pos: impr ? pw / impr : 0 };
}

// Every Shopify collection: handle, title, products, smart (rule-based) or manual, custom SEO title/description set, and the
// number of words in its on-page description (the text we can change). Read-only GraphQL through the shared product token.
async function shopifyCollections() {
  const q = `query($cursor: String) {
    collections(first: 100, after: $cursor) {
      nodes { handle title productsCount { count } ruleSet { appliedDisjunctively } seo { title description } description }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const out = [];
  let cursor = null;
  for (;;) {
    const data = await shopifyGraphQL(q, { cursor });
    for (const c of data.collections.nodes) {
      out.push({
        handle: c.handle,
        title: c.title,
        products: c.productsCount ? c.productsCount.count : 0,
        smart: c.ruleSet != null,
        seoTitle: Boolean(c.seo && c.seo.title),
        seoDescription: Boolean(c.seo && c.seo.description),
        words: (c.description || '').split(/\s+/).filter(Boolean).length,
      });
    }
    if (!data.collections.pageInfo.hasNextPage) return out;
    cursor = data.collections.pageInfo.endCursor;
  }
}

// ---- styles (the SEO work list, routes/seo-styles.js) ---------------------------------------------------------------------------
// A Birkenstock style is the word after the last '-' of the groupid ('0040793-MADRID' → 'MADRID'). The groupid, not the handle:
// handles can carry the wrong name (a Florida product's handle ends '-arizona'). A groupid with no word suffix ('51701') takes the
// first known style word found in its handle, else 'OTHER'.
function styleFromGroupid(groupid) {
  const m = String(groupid || '').match(/-([A-Za-z]+)$/);
  return m ? m[1].toUpperCase() : null;
}
function styleOf(groupid, handle, known) {
  const s = styleFromGroupid(groupid);
  if (s) return s;
  const words = String(handle || '').toUpperCase().split('-');
  return words.find((w) => known.has(w)) || 'OTHER';
}

// Words in a description, as a reader sees it: <style>/<script> blocks dropped (some descriptions carry the theme's CSS), tags
// stripped, entities turned to spaces.
function wordCount(html) {
  const text = String(html || '')
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

// ---- review cooldowns (the two priority lists) ----------------------------------------------------------------------------------
// { handle: { reviewed, until, note } }. A row whose `until` is in the future is hidden unless --all.
function reviewFile(name) { return path.join(SEO_DOCS, `${name}-reviews.json`); }
function loadReviews(name) {
  const f = reviewFile(name);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
function saveReviews(name, data) {
  fs.mkdirSync(SEO_DOCS, { recursive: true });
  const sorted = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]));
  fs.writeFileSync(reviewFile(name), `${JSON.stringify(sorted, null, 2)}\n`);
}

// ---- text helpers for fixed-width tables ----------------------------------------------------------------------------------------
const num = (n, dp = 0) => Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (n, dp = 2) => `${Number(n || 0).toFixed(dp)}%`;
const signed = (n) => (n > 0 ? `+${num(n)}` : n < 0 ? `-${num(-n)}` : '0');
const L = (s, w) => String(s).slice(0, w).padEnd(w);   // left-aligned, truncated
const R = (s, w) => String(s).padStart(w);              // right-aligned
const rule = (w = 78) => '='.repeat(w);

module.exports = {
  SITE_ROOT, SEO_DOCS, classify, handleOf, toUrl, short, totals, shopifyCollections, styleFromGroupid, styleOf, wordCount,
  loadReviews, saveReviews, num, pct, signed, L, R, rule,
};
