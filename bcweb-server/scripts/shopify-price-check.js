/*
=======================================================================================================================================
Script: scripts/shopify-price-check.js   (READ ONLY — writes to Shopify only with --fix)   prices AND titles
=======================================================================================================================================
Purpose: Check that every live Shopify price — and title — matches BCWEB. Run by hand as part of the owner's MONTHLY tasks ("check
         Shopify prices"), no cron (owner, 2026-11-08).

WHY IT EXISTS. It replaces the Python shopify-sync/price_update.py (retired 2026-11-08, now in the scripts repo's archive/). That script
pushed prices flagged `shopifychange = 1` nightly and ran a FULL resync every Saturday. BCWEB never sets that flag — every BCWEB price
change goes to Shopify at once (W1 / Add-Modify → utils/shopify.js → pushIfLive) and a failed push is shown so the operator re-Applies —
so the nightly run did nothing and the Saturday run was only a drift safety net. It was also about to become a hazard: it set every
variant of a style to ONE price, which would wipe per-size Shopify prices every week. On 2026-11-08 this check found 0 of 2,097 live
sizes out of step. A check run monthly keeps the safety net without a job that writes behind BCWEB's back.

TITLES TOO (2026-11-08): the Python shopify-sync/update_shopify_titles.py was retired the same day for the same reason — every BCWEB
push sends the whole product, title included, so an Add / Modify title edit is live at once; the script only ever picked up brand-new
products (title.last_shopify_sync NULL, never re-set on an edit), whose titles BCWEB had already pushed. That day all 301 live styles
matched.

What it compares, for every ACTIVE Shopify variant whose SKU is one of our codes on a style flagged live (skusummary.shopify = 1):
  - price and compareAtPrice against utils/shopify.js → variantPrice — THE rule the push itself uses, so the two can't disagree;
  - skumap.variantlink against the live variant id (the Google feed builds its ?variant= links from it);
  - the product title against title.shopifytitle, once per style (both trimmed — the retired Python compared them that way).
It also lists live Shopify products with SKUs we don't know, and ACTIVE products whose style is flagged OFF in BCWEB — reported only.

--fix re-pushes each style that differs through shopify.pushIfLive (the normal whole-product push, which also re-caches variant links).
Nothing else is ever written.

Usage (from bcweb-server/):
    node scripts/shopify-price-check.js          report only
    node scripts/shopify-price-check.js --fix    re-push the styles that differ
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool, query } = require('../database');
const shopify = require('../utils/shopify');
const { safeNumeric } = require('../utils/sql');

// Every variant on the store, 250 a page. Product status + handle ride along so draft/archived products are skipped and named.
const VARIANTS_QUERY = `
  query variants($after: String) {
    productVariants(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id sku price compareAtPrice product { status handle title } }
    }
  }
`;

async function readShopifyVariants() {
  const all = [];
  let after = null;
  do {
    const data = await shopify.shopifyGraphQL(VARIANTS_QUERY, { after });
    all.push(...data.productVariants.nodes);
    after = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
  } while (after);
  return all;
}

const money = (v) => (v === null || v === undefined ? null : Number(v).toFixed(2));

async function main() {
  const fix = process.argv.includes('--fix');
  if (!shopify.isConfigured()) throw new Error('Shopify is not configured (SHOPIFY_* in .env)');

  const live = await readShopifyVariants();
  const ours = await query(`
    SELECT m.code, m.variantlink, sm.groupid, sm.shopify, t.shopifytitle,
           ${safeNumeric('sm.shopifyprice')} AS price,
           ${safeNumeric('sm.rrp')}          AS rrp
    FROM skumap m
    JOIN skusummary sm ON sm.groupid = m.groupid
    LEFT JOIN title t  ON t.groupid = m.groupid
    WHERE COALESCE(m.deleted, 0) = 0
  `);
  const byCode = new Map(ours.rows.map((r) => [r.code, r]));

  const styles = new Map();        // groupid -> [lines describing what differs]
  const unknown = [];              // live SKUs with no skumap row
  const flaggedOff = new Set();    // ACTIVE on Shopify, shopify flag off in BCWEB
  const unpriced = new Set();      // BCWEB price unreadable — can't check
  const titleChecked = new Set();  // one title comparison per style, not per size
  let checked = 0;
  const note = (groupid, line) => { if (!styles.has(groupid)) styles.set(groupid, []); styles.get(groupid).push(line); };

  for (const v of live) {
    if (v.product.status !== 'ACTIVE') continue;
    const r = byCode.get(v.sku);
    if (!v.sku) continue;                                   // no SKU = not a stock item (the gift card)
    if (!r) { unknown.push(`${v.sku} on ${v.product.handle}`); continue; }
    if (r.shopify !== 1) { flaggedOff.add(r.groupid); continue; }
    if (r.price === null || Number(r.price) <= 0) { unpriced.add(r.groupid); continue; }
    checked += 1;

    const want = shopify.variantPrice({ price: Number(r.price), rrp: r.rrp === null ? null : Number(r.rrp) });
    if (money(v.price) !== want.price) note(r.groupid, `${v.sku}: price ${money(v.price)} on Shopify, ${want.price} in BCWEB`);
    if (money(v.compareAtPrice) !== want.compareAtPrice) {
      note(r.groupid, `${v.sku}: "was" price ${money(v.compareAtPrice) || 'none'} on Shopify, ${want.compareAtPrice || 'none'} in BCWEB`);
    }
    if (!titleChecked.has(r.groupid)) {
      titleChecked.add(r.groupid);
      const want = (r.shopifytitle || '').trim();
      if (want && (v.product.title || '').trim() !== want) note(r.groupid, `title "${(v.product.title || '').trim()}" on Shopify, "${want}" in BCWEB`);
    }
    const liveId = `${String(v.id).split('/').pop()}V`;
    if ((r.variantlink || '').trim() !== liveId) note(r.groupid, `${v.sku}: variant link ${r.variantlink || 'blank'} in BCWEB, ${liveId} on Shopify`);
  }

  console.log(`${live.length} variants on Shopify — ${checked} live sizes and ${titleChecked.size} titles checked`);
  console.log(`${styles.size} style(s) out of step with BCWEB`);
  for (const [groupid, lines] of styles) {
    console.log(`  ${groupid}`);
    for (const l of lines.slice(0, 6)) console.log(`      ${l}`);
    if (lines.length > 6) console.log(`      … ${lines.length - 6} more`);
  }
  if (unpriced.size) console.log(`Not checked — no readable BCWEB price: ${[...unpriced].join(', ')}`);
  if (flaggedOff.size) console.log(`Active on Shopify but switched OFF in BCWEB (not checked): ${[...flaggedOff].join(', ')}`);
  if (unknown.length) console.log(`Active on Shopify with a SKU BCWEB doesn't know: ${unknown.join(' · ')}`);

  if (!fix) {
    if (styles.size) console.log('Report only — run with --fix to re-push these styles.');
    return;
  }
  let ok = 0, failed = 0;
  for (const groupid of styles.keys()) {
    const res = await shopify.pushIfLive(groupid);
    if (res && res.pushed) { ok += 1; console.log(`  re-pushed ${groupid}`); }
    else { failed += 1; console.log(`  FAILED ${groupid}: ${res ? res.message : 'not live / Shopify not configured'}`); }
  }
  console.log(`--fix: ${ok} re-pushed, ${failed} failed`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
