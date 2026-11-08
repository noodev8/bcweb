/*
=======================================================================================================================================
Script: scripts/birk-twin-images.js   (WRITES — product_images + a Shopify push, only with --commit)
=======================================================================================================================================
Purpose: Birkenstock Narrow / Regular twins are the same shoe and use the same pictures, but often only one twin got its gallery.
         This copies the bigger gallery onto the other twin (owner, 2026-11-08: "Same files. Include partial pairs too, to match the one
         with the bigger number of images").

PAIRING — by TITLE, never the handle (handles often omit the width): Birkenstock styles live on Shopify whose title.shopifytitle says
         "Narrow" / "Regular", paired when the title is identical once the width words are taken out.

WHAT IT DOES per pair where one twin holds MORE images than the other:
  - The target keeps its OWN main (position 1) — untouched.
  - The target's other images (2..N), if any, are removed and replaced by the donor's 2..N, in the donor's order.
  - SAME FILES (owner's choice): the new rows point at the donor's one.com files (no copies; the 10 twin mains already share files —
    utils/productGallery.fileInUseElsewhere protects every delete). Alt text is built from the TARGET's own title, so it says the
    right width. shopify_media_id starts NULL, so the push sends the one.com URL and Shopify makes the target its own media
    (upsertProduct records the new ids).
  - One transaction per pair, then shopify.pushIfLive (dropMediaIds = the target's removed media), then the removed files are
    KEPT on one.com (not deleted) so a run can be put back by hand — they are the target's earlier uploads, small and harmless.
  Pairs with equal counts are left alone.

Usage (from bcweb-server/):
    node scripts/birk-twin-images.js --by "Andreas"                           dry run — lists every pair and what would change
    node scripts/birk-twin-images.js --by "Andreas" --only 0151183-ARIZONA    dry run, one pair (comma-separate for several)
    node scripts/birk-twin-images.js --by "Andreas" [--only <groupid>] --commit
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../database');
const { withTransaction } = require('../utils/transaction');
const { imageAlt } = require('../utils/productImage');
const shopify = require('../utils/shopify');

function args(argv) {
  const o = { by: null, only: [], commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--by') o.by = argv[(i += 1)];
    else if (a === '--only') o.only.push(...String(argv[(i += 1)] || '').split(',').map((g) => g.trim().toUpperCase()).filter(Boolean));
    else if (a === '--commit') o.commit = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!o.by || !o.by.trim()) throw new Error('--by "<name>" is required');
  o.by = o.by.trim();
  return o;
}

// Every live Birkenstock style with its width and its image count (a product with a main file but no rows yet counts 1).
async function loadPairs() {
  const r = await db.query(`
    WITH b AS (
      SELECT ss.groupid, ss.imagename, t.shopifytitle AS title,
             CASE WHEN t.shopifytitle ILIKE '%narrow%' THEN 'N' WHEN t.shopifytitle ILIKE '%regular%' THEN 'R' END AS w,
             lower(regexp_replace(TRIM(REGEXP_REPLACE(t.shopifytitle, '(narrow|regular)( fit)?', '', 'gi')), '\\s+', ' ', 'g')) AS base,
             GREATEST(COALESCE(pi.n, 0), CASE WHEN ss.imagename IS NOT NULL AND ss.imagename <> '' THEN 1 ELSE 0 END)::int AS n
      FROM skusummary ss
      JOIN title t ON t.groupid = ss.groupid
      LEFT JOIN (SELECT groupid, COUNT(*) AS n FROM product_images GROUP BY groupid) pi ON pi.groupid = ss.groupid
      WHERE ss.brand ILIKE 'birk%' AND ss.shopify = 1
    )
    SELECT r.base, r.groupid AS r_gid, r.title AS r_title, r.n AS r_n, r.imagename AS r_img,
                   n.groupid AS n_gid, n.title AS n_title, n.n AS n_n, n.imagename AS n_img
    FROM b r JOIN b n ON n.base = r.base AND r.w = 'R' AND n.w = 'N'
    ORDER BY r.base
  `);
  const out = [];
  for (const p of r.rows) {
    if (p.r_n === p.n_n) continue;
    const rBigger = p.r_n > p.n_n;
    out.push({
      base: p.base,
      donor: rBigger ? p.r_gid : p.n_gid, donorN: rBigger ? p.r_n : p.n_n,
      target: rBigger ? p.n_gid : p.r_gid, targetN: rBigger ? p.n_n : p.r_n,
      targetTitle: rBigger ? p.n_title : p.r_title, targetImg: rBigger ? p.n_img : p.r_img
    });
  }
  return out;
}

async function gallery(groupid) {
  const r = await db.query(`
    SELECT id, position, filename, view, width, height, shopify_media_id FROM product_images WHERE groupid = $1 ORDER BY position
  `, [groupid]);
  return r.rows;
}

async function copyPair(p, by) {
  const donorRows = (await gallery(p.donor)).filter((r) => r.position > 1);
  const targetRows = await gallery(p.target);
  const removed = targetRows.filter((r) => r.position > 1);

  await withTransaction(async (client) => {
    // A target whose main predates product_images gets its main row first, as product-images-add does.
    if (!targetRows.some((r) => r.position === 1)) {
      if (!p.targetImg) throw new Error(`${p.target} has no main image`);
      await client.query(`
        INSERT INTO product_images (groupid, position, filename, alt, source_name, created_by) VALUES ($1, 1, $2, $3, $2, $4)
      `, [p.target, p.targetImg, imageAlt(p.targetTitle), by]);
    }
    await client.query(`DELETE FROM product_images WHERE groupid = $1 AND position > 1`, [p.target]);
    let pos = 2;
    for (const d of donorRows) {
      await client.query(`
        INSERT INTO product_images (groupid, position, filename, view, alt, width, height, source_name, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [p.target, pos, d.filename, d.view, imageAlt(p.targetTitle, d.view), d.width, d.height, `twin ${p.donor}`, by]);
      pos += 1;
    }
  });

  const push = await shopify.pushIfLive(p.target, { dropMediaIds: removed.map((r) => r.shopify_media_id).filter(Boolean) });
  if (removed.length) console.log(`    replaced on ${p.target} (files kept on one.com): ${removed.map((r) => r.filename).join(', ')}`);
  return { copied: donorRows.length, removed: removed.length, push };
}

async function main() {
  const o = args(process.argv.slice(2));
  let pairs = await loadPairs();
  if (o.only.length) pairs = pairs.filter((p) => o.only.includes(p.target) || o.only.includes(p.donor));
  if (!pairs.length) { console.log('No pairs to change.'); return; }

  console.log(`${pairs.length} pair(s)${o.commit ? '' : ' — DRY RUN (add --commit to write)'}`);
  for (const p of pairs) {
    const line = `${p.target} (${p.targetN}) <- ${p.donor} (${p.donorN})  ${p.base}`;
    if (!o.commit) { console.log(`  would copy  ${line}`); continue; }
    try {
      const r = await copyPair(p, o.by);
      const shop = r.push === null ? 'not live' : r.push.pushed ? 'Shopify OK' : `SHOPIFY FAILED: ${r.push.message}`;
      console.log(`  done  ${line}  — ${r.copied} copied, ${r.removed} replaced, ${shop}`);
    } catch (e) {
      console.log(`  FAILED  ${line}  — ${e.message}`);
    }
  }
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
