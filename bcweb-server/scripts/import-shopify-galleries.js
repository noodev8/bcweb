/*
=======================================================================================================================================
Script: scripts/import-shopify-galleries.js   (one-off seed of product_images, safe to re-run)
=======================================================================================================================================
Purpose: Copy every product gallery that exists on Shopify into OUR store — files to one.com, rows to product_images — so our DB holds
         the whole gallery before any push is switched to "send the gallery from our DB" (which would otherwise wipe what we don't hold).
         Plan: docs/product-images-plan.md (step 1). Staff images added in the Shopify UI are picked up by re-running it.

Per product (Shopify handle -> skusummary.handle):
  - MAIN (position 1): the file we already hold (skusummary.imagename). If it has no row yet, insert one, measuring the one.com file.
    Its Shopify media is found by FILENAME (Shopify keeps the source name, sometimes adding a _<uuid>) and linked via shopify_media_id.
  - GALLERY: every Shopify IMAGE not already held (by shopify_media_id) and not the main is downloaded at the size Shopify kept it,
    processed by utils/productImage.processImage (2048 max, never enlarged), uploaded with an SEO name
    (utils/imageName: <title>-<groupid>-brookfield-comfort-<view|position>-<version>.jpg) and inserted after the existing positions,
    in Shopify order. Video / 3D media are counted and left alone.
  - An image we hold whose media is no longer on Shopify is left as it is (owner: BCWEB wins; remove images in BCWEB).

DRY RUN BY DEFAULT — reads Shopify, the DB and the one.com mains (to measure them), writes nothing, prints what it would do and the
projected Missing Images picture ("done" = >= 2 images; low-res main counted separately). Works before the migration is applied (no table = nothing held).

Usage:
    node scripts/import-shopify-galleries.js                    # dry run, all products
    node scripts/import-shopify-galleries.js --handle <handle>  # dry run, one product
    node scripts/import-shopify-galleries.js --apply [--handle <handle>]
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../database');
const { shopifyGraphQL } = require('../utils/shopify');
const { putImage } = require('../utils/sftp');
const { imageFilename } = require('../utils/imageName');
const { processImage, measureImage, viewFromName, imageAlt, isDone, isLowResMain, MAX_SIDE } = require('../utils/productImage');

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY_HANDLE = args.includes('--handle') ? args[args.indexOf('--handle') + 1] : null;

// 25 products x 30 media keeps the query cost well under Shopify's 1000-point ceiling; a product with more media pages separately.
const PRODUCTS_QUERY = `
  query($after: String, $q: String) {
    products(first: 25, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes { id handle media(first: 30) { pageInfo { hasNextPage endCursor } nodes { ...M } } }
    }
  }
  fragment M on Media { id mediaContentType alt ... on MediaImage { image { url width height } } }
`;
const MORE_MEDIA_QUERY = `
  query($id: ID!, $after: String) {
    product(id: $id) { media(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { ...M } } }
  }
  fragment M on Media { id mediaContentType alt ... on MediaImage { image { url width height } } }
`;

async function fetchShopifyProducts() {
  const out = [];
  let after = null;
  do {
    const d = await shopifyGraphQL(PRODUCTS_QUERY, { after, q: ONLY_HANDLE ? `handle:${ONLY_HANDLE}` : null });
    for (const p of d.products.nodes) {
      const media = [...p.media.nodes];
      let page = p.media.pageInfo;
      while (page.hasNextPage) {
        const m = await shopifyGraphQL(MORE_MEDIA_QUERY, { id: p.id, after: page.endCursor });
        media.push(...m.product.media.nodes);
        page = m.product.media.pageInfo;
      }
      if (!ONLY_HANDLE || p.handle === ONLY_HANDLE) out.push({ handle: p.handle, media });
    }
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after);
  return out;
}

// A filename reduced for matching: lower-case, no query/extension, no Shopify "_<uuid>" de-dupe suffix.
function matchKey(name) {
  return String(name || '').split('?')[0].split('/').pop().toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, '')
    .replace(/_[0-9]+$/, '');                                    // Shopify's other de-dupe suffix ("…-comfort_1")
}

async function tableExists() {
  const r = await query(`SELECT to_regclass('public.product_images') AS t`);
  return Boolean(r.rows[0].t);
}

// one.com rate-limits bursts (HTTP 429) — back off and retry rather than fail the file.
async function fetchBuffer(url, tries = 6) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429 || attempt >= tries) throw new Error(`HTTP ${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

// Small worker pool — the one.com measure step is ~300 HTTP GETs and one.com rate-limits bursts, so keep it narrow.
async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const item = items[i++]; await fn(item); } }));
}

async function main() {
  const hasTable = await tableExists();
  if (APPLY && !hasTable) throw new Error('product_images does not exist — apply migrations/20261013_product_images.sql first');
  console.log(`[import] ${APPLY ? 'APPLY' : 'DRY RUN'}${ONLY_HANDLE ? ` — handle ${ONLY_HANDLE}` : ''}${hasTable ? '' : ' — product_images not created yet (nothing held)'}`);

  const shopProducts = await fetchShopifyProducts();

  const db = await query(`
    SELECT ss.groupid, ss.handle, ss.imagename, ss.shopify, t.shopifytitle AS title,
           (SELECT COALESCE(SUM(l.qty), 0) FROM localstock l
             WHERE l.groupid = ss.groupid AND l.ordernum = '#FREE' AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0)::int AS stock
    FROM skusummary ss LEFT JOIN title t ON t.groupid = ss.groupid
    WHERE COALESCE(ss.handle, '') <> ''
  `);
  const byHandle = new Map(db.rows.map((r) => [r.handle, r]));

  const held = new Map(); // groupid -> rows
  if (hasTable) {
    const h = await query(`SELECT groupid, position, filename, width, height, shopify_media_id FROM product_images ORDER BY groupid, position`);
    for (const r of h.rows) { if (!held.has(r.groupid)) held.set(r.groupid, []); held.get(r.groupid).push(r); }
  }

  // ---- Plan ---------------------------------------------------------------------------------------------------------------------
  const plans = [];
  const totals = { products: 0, unknownHandle: [], noMainFile: [], mainRows: 0, mainLinks: 0, mainUnmatched: [], gallery: 0, otherMedia: 0, views: {} };

  for (const sp of shopProducts) {
    const p = byHandle.get(sp.handle);
    if (!p) { totals.unknownHandle.push(sp.handle); continue; }
    totals.products++;
    const rows = held.get(p.groupid) || [];
    const heldIds = new Set(rows.map((r) => r.shopify_media_id).filter(Boolean));
    const mainRow = rows.find((r) => r.position === 1) || null;
    const mainFile = mainRow ? mainRow.filename : p.imagename;
    if (!mainFile) totals.noMainFile.push(p.groupid);

    const images = sp.media.filter((m) => m.mediaContentType === 'IMAGE' && m.image);
    totals.otherMedia += sp.media.length - images.length;

    // The Shopify copy of our main, by filename.
    const mainKey = mainFile ? matchKey(mainFile) : null;
    // Fallback: no filename match -> Shopify's FIRST image is taken as the main's copy (every push has put the main first; the misses
    // seen on 2026-10-13 were an older version of the main under a different name). Linking it beats importing it as a duplicate.
    let mainMedia = mainKey ? images.find((m) => matchKey(m.image.url) === mainKey) : null;
    if (mainFile && !mainMedia && images.length) {
      totals.mainUnmatched.push(`${p.groupid} (ours: ${mainKey} / Shopify first: ${matchKey(images[0].image.url)})`);
      mainMedia = images[0];
    }

    const plan = { p, mainRow, mainFile, mainMedia, createMain: !mainRow && Boolean(mainFile), linkMain: false, gallery: [], nextPos: 1 };
    if (plan.createMain) totals.mainRows++;
    if (mainMedia && !heldIds.has(mainMedia.id) && (!mainRow || !mainRow.shopify_media_id)) { plan.linkMain = true; totals.mainLinks++; }

    plan.nextPos = Math.max(1, ...rows.map((r) => r.position)) + 1;
    for (const m of images) {
      if (heldIds.has(m.id) || (mainMedia && m.id === mainMedia.id)) continue;
      const view = viewFromName(m.image.url);
      totals.views[view || '(position)'] = (totals.views[view || '(position)'] || 0) + 1;
      plan.gallery.push({ media: m, view, side: Math.min(MAX_SIDE, Math.max(m.image.width || 0, m.image.height || 0)) });
      totals.gallery++;
    }
    plans.push(plan);
  }

  // Measure the mains we'd create a row for (read-only GET of the public file).
  const toMeasure = plans.filter((pl) => pl.createMain);
  await pool(toMeasure, 2, async (pl) => {
    try { pl.mainDims = await measureImage(await fetchBuffer(IMAGE_BASE + pl.mainFile)); }
    catch (e) { pl.mainDims = null; pl.mainError = e.message; }
  });

  // ---- Report -------------------------------------------------------------------------------------------------------------------
  const side = (pl) => {
    const d = pl.mainRow ? pl.mainRow : pl.mainDims;
    return d ? Math.max(d.width || 0, d.height || 0) : 0;
  };
  const count = (pl) => (pl.mainFile ? 1 : 0) + (held.get(pl.p.groupid) || []).filter((r) => r.position > 1).length + pl.gallery.length;
  const proj = { done: 0, notDone: 0, lowResMain: 0 };
  const projStock = { done: 0, notDone: 0 };
  const byCount = {};
  const mainSizes = {};
  for (const pl of plans) {
    const s = side(pl), c = count(pl);
    const bucket = s >= 2048 ? '2048' : s >= 1500 ? '1500-2047' : s >= 800 ? '800-1499' : s ? '<800' : 'unknown';
    mainSizes[bucket] = (mainSizes[bucket] || 0) + 1;
    const k = c >= 4 ? '4+' : String(c);
    byCount[k] = (byCount[k] || 0) + 1;
    if (isDone(c)) proj.done++; else proj.notDone++;
    if (isLowResMain(s)) proj.lowResMain++;
    if (pl.p.stock > 0) { if (isDone(c)) projStock.done++; else projStock.notDone++; }
  }

  console.log(`\nShopify products matched: ${totals.products}   unknown handles: ${totals.unknownHandle.length}${totals.unknownHandle.length ? ` (${totals.unknownHandle.join(', ')})` : ''}`);
  console.log(`Main rows to create: ${totals.mainRows}   main media to link: ${totals.mainLinks}   no main file: ${totals.noMainFile.length}`);
  console.log(`Main not found on Shopify by filename (Shopify's first image linked as the main instead): ${totals.mainUnmatched.length}`);
  totals.mainUnmatched.slice(0, 15).forEach((x) => console.log(`   ${x}`));
  if (totals.mainUnmatched.length > 15) console.log(`   … ${totals.mainUnmatched.length - 15} more`);
  console.log(`Gallery images to import: ${totals.gallery}   video/3D media left alone: ${totals.otherMedia}`);
  console.log(`View words: ${JSON.stringify(totals.views)}`);
  const measureErrors = toMeasure.filter((pl) => pl.mainError);
  if (measureErrors.length) console.log(`Main files that failed to measure: ${measureErrors.length} (e.g. ${measureErrors[0].mainFile}: ${measureErrors[0].mainError})`);
  console.log(`Main image sizes: ${JSON.stringify(mainSizes)}`);
  console.log(`Projected after import — images per product: ${JSON.stringify(byCount)}`);
  console.log(`  done (>= 2 images): ${proj.done}, single image: ${proj.notDone}, low-res main flag: ${proj.lowResMain}`);
  console.log(`In stock — done: ${projStock.done}, not done: ${projStock.notDone}`);

  if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply to import.'); return; }

  // ---- Apply --------------------------------------------------------------------------------------------------------------------
  let imported = 0, failed = 0;
  for (const pl of plans) {
    const { p } = pl;
    try {
      if (pl.createMain && pl.mainDims) {
        await query(`
          INSERT INTO product_images (groupid, position, filename, alt, width, height, shopify_media_id, source_name, created_by)
          VALUES ($1, 1, $2, $3, $4, $5, $6, $2, 'import')
          ON CONFLICT (groupid, position) DO NOTHING
        `, [p.groupid, pl.mainFile, imageAlt(p.title), pl.mainDims.width, pl.mainDims.height, pl.mainMedia ? pl.mainMedia.id : null]);
      } else if (pl.linkMain && pl.mainRow) {
        await query(`UPDATE product_images SET shopify_media_id = $2 WHERE groupid = $1 AND position = 1 AND shopify_media_id IS NULL`, [p.groupid, pl.mainMedia.id]);
      }
    } catch (e) {
      console.error(`[import] ${p.groupid} main: ${e.message}`);
    }

    let pos = pl.nextPos;
    for (const g of pl.gallery) {
      try {
        const out = await processImage(await fetchBuffer(g.media.image.url));
        const version = `${Date.now().toString(36)}${pos}`;
        const filename = imageFilename(p.title, p.groupid, version, g.view || String(pos));
        const alt = (g.media.alt || '').trim() || imageAlt(p.title, g.view);
        await putImage(filename, out.buffer);
        await query(`
          INSERT INTO product_images (groupid, position, filename, view, alt, width, height, shopify_media_id, source_name, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'import')
        `, [p.groupid, pos, filename, g.view, alt, out.width, out.height, g.media.id, g.media.image.url.split('?')[0].split('/').pop()]);
        imported++;
        pos++;
      } catch (e) {
        failed++;
        console.error(`[import] ${p.groupid} ${g.media.id}: ${e.message}`);
      }
    }
  }
  console.log(`\n[import] gallery images imported: ${imported}, failed: ${failed}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[import] fatal:', e.message); process.exit(1); });
