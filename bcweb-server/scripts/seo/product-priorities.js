/*
=======================================================================================================================================
Script: scripts/seo/product-priorities.js   (SEO priority list B — PRODUCTS, the value play — READ ONLY except --review)
=======================================================================================================================================
Purpose: Which Birkenstock product pages are worth SEO work. Product-intent search is uniformly LOW per page, so volume can't be the
         ranker — a page improved once earns for years, so rank by VALUE:
           - proven:    organic revenue + conversion % from organic landings (GA4, 90 days)
           - potential: 12-month Shopify PROFIT (sales.profit, net of returns)
         Shown only where there is product-intent search to capture (the page's top query names a colour / material) and room to
         rank (position > 5).

         Birkenstock only — Shopify is where it wins (it is Amazon-banned, so its search demand has nowhere else online to go).

         Change from the Python version (2026-11-07): "potential" was units × (shopifyprice − cost) — a gross margin with no fees.
         It is now SUM(sales.profit), the realised net profit the rest of BCWEB uses. Same ranking idea, a truer pound.

Review cooldown: mark a product worked / dismissed and it drops off for a period. State: docs/seo/products-reviews.json (in git, so
                 both PCs share it). The list is also written to docs/seo/product-priorities.md so it can just be opened.

Moved from C:\scripts\seo\product_priorities.py (2026-11-07).

Usage:
    node scripts/seo/product-priorities.js                                   (list, hides reviewed; writes the .md)
    node scripts/seo/product-priorities.js --all                             (include reviewed)
    node scripts/seo/product-priorities.js --review <handle> --days 90 --note "why"
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { query } = require('../../database');
const { gscQuery, gscEnd, addDays, ymd } = require('../../utils/searchConsole');
const { runReport } = require('../../utils/ga4');
const { handleOf, loadReviews, saveReviews, SEO_DOCS, num, L, R } = require('../../utils/seo');

const REVIEWS = 'products';
const MD_FILE = path.join(SEO_DOCS, 'product-priorities.md');

// A query is product intent if it names a colour / material; a category word with no colour is browse intent.
const COLOUR = new Set(['brown', 'black', 'white', 'blue', 'navy', 'khaki', 'tan', 'pink', 'green', 'grey', 'gray', 'red', 'patent',
  'nubuck', 'suede', 'oiled', 'dark', 'taupe', 'stone', 'mocha', 'sand', 'beige', 'gold', 'silver', 'rose', 'cream', 'olive',
  'anthracite', 'eva', 'graphite']);
const BROWSE = new Set(['trainers', 'sandals', 'sliders', 'sneakers', 'clogs', 'shoes', 'slippers', 'sandal']);
function intent(q) {
  const t = new Set(String(q || '').toLowerCase().replace(/'/g, '').split(/\s+/));
  const has = (set) => [...t].some((w) => set.has(w));
  if (has(BROWSE) && !has(COLOUR)) return 'browse';
  return has(COLOUR) ? 'product' : 'browse';
}

async function buildRows() {
  // 12 months of Shopify sales for Birkenstock styles with a live handle. Net units and net profit (returns are negative rows).
  const prod = new Map();
  const r = await query(`
    SELECT LOWER(ss.handle) AS handle, SUM(s.qty)::int AS units, COALESCE(SUM(s.profit), 0)::float AS profit
    FROM sales s JOIN skusummary ss ON ss.groupid = s.groupid
    WHERE s.channel = 'SHP' AND s.solddate >= CURRENT_DATE - INTERVAL '365 days'
      AND ss.brand ILIKE 'birk%' AND COALESCE(ss.handle, '') <> ''
    GROUP BY LOWER(ss.handle)`);
  for (const x of r.rows) prod.set(x.handle, x);

  // GSC 28d per product page, with its top query (by impressions) to judge intent.
  const end = gscEnd();
  const gsc = new Map();
  for (const row of await gscQuery({ start: addDays(end, -27), end, dimensions: ['page', 'query'] })) {
    const h = handleOf(row.keys[0], 'products');
    if (!h) continue;
    const g = gsc.get(h) || { impr: 0, clicks: 0, pw: 0, topImpr: 0, topQ: '' };
    g.impr += row.impressions; g.clicks += row.clicks; g.pw += row.position * row.impressions;
    if (row.impressions > g.topImpr) { g.topImpr = row.impressions; g.topQ = row.keys[1]; }
    gsc.set(h, g);
  }

  // GA4 90d organic-search landings on product pages.
  const ga = new Map();
  const report = await runReport({
    dimensions: ['landingPage'], metrics: ['sessions', 'ecommercePurchases', 'totalRevenue'],
    start: '90daysAgo', end: 'yesterday', filter: { dimension: 'sessionDefaultChannelGroup', value: 'Organic Search' },
  });
  for (const x of report) {
    const h = handleOf(x.landingPage, 'products');
    if (!h) continue;
    const a = ga.get(h) || { s: 0, b: 0, r: 0 };
    a.s += x.sessions; a.b += x.ecommercePurchases; a.r += x.totalRevenue;
    ga.set(h, a);
  }

  const rows = [];
  for (const [h, p] of prod) {
    const g = gsc.get(h);
    if (!g || g.impr < 10) continue;
    const pos = g.pw / g.impr;
    if (intent(g.topQ) !== 'product' || pos <= 5) continue;
    const a = ga.get(h) || { s: 0, b: 0, r: 0 };
    rows.push({ handle: h, units: p.units, profit: p.profit, conv: a.s ? (a.b / a.s) * 100 : 0, orgRev: a.r, impr: g.impr, pos, topQ: g.topQ });
  }
  rows.sort((a, b) => b.orgRev - a.orgRev || b.profit - a.profit);
  return rows;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      all: { type: 'boolean', default: false }, review: { type: 'string' },
      days: { type: 'string', default: '90' }, note: { type: 'string', default: '' },
    },
  });
  const today = ymd(new Date());
  const reviews = loadReviews(REVIEWS);

  if (args.review) {
    const until = ymd(addDays(new Date(), Number(args.days) || 90));
    reviews[args.review.toLowerCase()] = { reviewed: today, until, note: args.note };
    saveReviews(REVIEWS, reviews);
    console.log(`Marked '${args.review}' reviewed — hidden until ${until}. Note: ${args.note || '-'}`);
    return;
  }

  const rows = await buildRows();
  const shown = []; let snoozed = 0;
  for (const r of rows) {
    const rv = reviews[r.handle];
    if (rv && rv.until > today && !args.all) { snoozed++; continue; }
    shown.push({ r, rv });
  }

  console.log('\nPRODUCT PRIORITIES — Birkenstock, ranked by value (Shopify profit 12m, GSC 28d, GA4 90d)\n');
  console.log(`  ${L('product', 46)} ${R('units', 5)} ${R('profit', 7)} ${R('conv%', 6)} ${R('org£', 5)} ${R('impr', 5)} ${R('pos', 5)}  reviewed`);
  console.log(`  ${'-'.repeat(100)}`);
  const md = [`# Product priorities — ${today}`, '', 'Generated by `node scripts/seo/product-priorities.js`. Ranked by value: proven organic £ (GA4 90d), then Shopify profit (12m).', '',
    '| product | units | profit | conv% | org£ | impr | pos | top query | reviewed |', '|---|--:|--:|--:|--:|--:|--:|---|---|'];
  for (const { r, rv } of shown.slice(0, 30)) {
    const rvs = rv ? `til ${rv.until}${rv.note ? ` (${rv.note})` : ''}` : '-';
    console.log(`  ${L(r.handle, 46)} ${R(r.units, 5)} ${R(`£${num(r.profit)}`, 7)} ${R(`${r.conv.toFixed(0)}%`, 6)} ${R(num(r.orgRev), 5)} ${R(num(r.impr), 5)} ${R(r.pos.toFixed(1), 5)}  ${rvs}`);
    md.push(`| ${r.handle} | ${r.units} | £${num(r.profit)} | ${r.conv.toFixed(0)}% | £${num(r.orgRev)} | ${num(r.impr)} | ${r.pos.toFixed(1)} | ${r.topQ} | ${rvs} |`);
  }
  fs.mkdirSync(SEO_DOCS, { recursive: true });
  fs.writeFileSync(MD_FILE, `${md.join('\n')}\n`);
  console.log(`\n  ${snoozed} reviewed hidden — use --all to see. List saved to docs/seo/product-priorities.md`);
  console.log('  Mark one done:  node scripts/seo/product-priorities.js --review <handle> --days 90 --note "..."\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[seo/product-priorities] failed:', err.message); process.exit(1); });
