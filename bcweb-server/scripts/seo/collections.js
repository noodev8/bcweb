/*
=======================================================================================================================================
Script: scripts/seo/collections.js   (every Shopify collection with its Search Console standing — READ ONLY)
=======================================================================================================================================
Purpose: Shopify knows what collections exist; GSC knows which ones Google shows anyone. Neither alone answers "which collections are
         invisible" — GSC only returns pages that earned an impression, so a collection missing from GSC is an ABSENCE, not a zero.
         This joins the two, so collections earning nothing appear as rows.

         Columns: products, clicks, impressions, CTR, impression-weighted position (28d), `words` = words in the on-page collection
         description (the text we can change — added 2026-11-07 for the collection-text question), `seo` = a custom SEO title is set.

         --thin is the hygiene view (was thin_collections.py): thinnest first, with smart/manual. An empty MANUAL collection is a real
         dead page; an empty SMART one may refill in season. Deleting still needs link-check.js first (and a 301 only where there is
         traffic or links to keep — a dead page with neither is a clean 404; see docs/seo/CHANGELOG.md 2026-07-17).

Moved from C:\scripts\seo\collections_seo.py + thin_collections.py (2026-11-07).

Usage:
    node scripts/seo/collections.js                    (all, most clicks first)
    node scripts/seo/collections.js --match birkenstock (handles containing a word)
    node scripts/seo/collections.js --unranked         (only collections earning no clicks)
    node scripts/seo/collections.js --thin [--max 3]   (thinnest first; only <= max products)
    --top N   rows (default all)
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { parseArgs } = require('util');
const { gscQuery, gscEnd, addDays, ymd } = require('../../utils/searchConsole');
const { handleOf, shopifyCollections, num, pct, L, R, rule } = require('../../utils/seo');

const WINDOW_DAYS = 28;  // a single collection does ~6 clicks/week; 7d is pure noise

// GSC rows for /collections/ pages folded by handle (pagination into its page).
async function gscByHandle(end) {
  const rows = await gscQuery({ start: addDays(end, -(WINDOW_DAYS - 1)), end, dimensions: ['page'] });
  const out = new Map();
  for (const r of rows) {
    const h = handleOf(r.keys[0], 'collections');
    if (!h) continue;
    const g = out.get(h) || { clicks: 0, impr: 0, pw: 0 };
    g.clicks += r.clicks; g.impr += r.impressions; g.pw += r.position * r.impressions;
    out.set(h, g);
  }
  return out;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      unranked: { type: 'boolean', default: false }, thin: { type: 'boolean', default: false },
      max: { type: 'string' }, match: { type: 'string' }, top: { type: 'string' },
    },
  });

  const cols = await shopifyCollections();

  if (args.thin) {
    let rows = [...cols].sort((a, b) => a.products - b.products || a.handle.localeCompare(b.handle));
    if (args.max != null) rows = rows.filter((c) => c.products <= Number(args.max));
    if (args.match) rows = rows.filter((c) => c.handle.includes(args.match.toLowerCase()));
    console.log(`\nTHIN COLLECTIONS - ${cols.length} in Shopify, thinnest first\n`);
    console.log(`  ${L('collection', 42)} ${R('prods', 5)} ${R('type', 7)} ${R('words', 5)} ${R('seo', 4)}`);
    console.log(`  ${'-'.repeat(68)}`);
    for (const c of rows) {
      console.log(`  ${L(c.handle, 42)} ${R(c.products, 5)} ${R(c.smart ? 'smart' : 'manual', 7)} ${R(c.words, 5)} ${R(c.seoTitle ? 'y' : '-', 4)}`);
    }
    const empty = rows.filter((c) => c.products === 0).length;
    const thin = rows.filter((c) => c.products >= 1 && c.products <= 3).length;
    console.log(`\n  ${empty} empty (0 products), ${thin} thin (1-3). Manual + empty = real dead page; smart + empty may be off-season.`);
    console.log('  Before deleting: node scripts/seo/link-check.js <handle>\n');
    return;
  }

  const end = gscEnd();
  const gsc = await gscByHandle(end);
  let rows = cols.map((c) => {
    const g = gsc.get(c.handle) || { clicks: 0, impr: 0, pw: 0 };
    return { ...c, clicks: g.clicks, impr: g.impr, ctr: g.impr ? (g.clicks / g.impr) * 100 : 0, pos: g.impr ? g.pw / g.impr : 0 };
  });
  if (args.match) rows = rows.filter((r) => r.handle.includes(args.match.toLowerCase()));
  if (args.unranked) rows = rows.filter((r) => r.clicks === 0);
  rows.sort((a, b) => b.clicks - a.clicks || b.impr - a.impr);
  const shown = args.top ? rows.slice(0, Number(args.top)) : rows;

  console.log(`\nCOLLECTIONS - ${WINDOW_DAYS}d to ${ymd(end)} - ${cols.length} in Shopify, ${gsc.size} seen by Google\n`);
  console.log(rule(84));
  console.log(`  ${L('collection', 38)} ${R('prods', 5)} ${R('clicks', 6)} ${R('impr', 8)} ${R('CTR', 6)} ${R('pos', 5)} ${R('words', 5)} ${R('seo', 4)}`);
  console.log(rule(84));
  for (const r of shown) {
    console.log(`  ${L(r.handle, 38)} ${R(r.products, 5)} ${R(num(r.clicks), 6)} ${R(num(r.impr), 8)} ${R(pct(r.ctr), 6)} `
      + `${R(r.pos ? r.pos.toFixed(1) : '-', 5)} ${R(r.words, 5)} ${R(r.seoTitle ? 'y' : '-', 4)}`);
  }
  const dead = rows.filter((r) => r.clicks === 0).length;
  console.log(`\n  ${shown.length} shown, ${num(rows.reduce((a, r) => a + r.clicks, 0))} clicks. ${dead} collections earn nothing.`);
  console.log("  'words' = on-page description text. 'seo' = a custom SEO title is set. 'pos' - = no impressions.\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[seo/collections] failed:', err.message); process.exit(1); });
