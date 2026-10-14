/*
=======================================================================================================================================
Script: collection-import-clearance
=======================================================================================================================================
Purpose: ONE-OFF. Copy today's Shopify `clearance` tags into collection_member, the day the database became the record of who is in
         which collection (owner, 2026-10-14 — "Store in database and I will manage tags from here only"). Until then Shopify was the
         only store of the clearance collection (utils/clearanceTag.js read it live), so without this the switch-over would show the
         collection as empty.

         Run AFTER migrations/20261014_collections.sql and BEFORE the server code that reads the tables goes live:
             node scripts/collection-import-clearance.js            # dry run — reads Shopify and the DB, writes nothing
             node scripts/collection-import-clearance.js --apply    # writes the rows

         Matches each tagged Shopify product to a style by handle (skusummary.handle, trimmed) WHATEVER ITS SHOPIFY FLAG — a style
         switched OFF still carries the tag on the store and must come in, so the owner can see it and take it off. A tagged product
         that matches no style is LISTED, not guessed at: it stays tagged on Shopify and BCWEB doesn't know it, so it has to be untagged
         by hand in Shopify admin (or the style fixed and this run again). Safe to run twice (ON CONFLICT DO NOTHING). Doesn't apply the
         3-tag cap: on the day, clearance is the only collection, so no style can have more than one tag.

         Writes only collection_member. Never touches Shopify.
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, pool } = require('../database');
const { loadTagged } = require('../utils/collectionTags');

const TAG = 'clearance';

(async () => {
  const apply = process.argv.includes('--apply');

  const tagged = await loadTagged(TAG);
  console.log(`Shopify: ${tagged.length} products carry the tag ${TAG}`);

  const r = await query(
    `SELECT groupid, TRIM(handle) AS handle, COALESCE(shopify, 0) AS shopify FROM skusummary WHERE TRIM(handle) = ANY($1::text[])`,
    [tagged.map((p) => p.handle)]
  );
  const byHandle = new Map(r.rows.map((x) => [x.handle, x]));

  const matched = [];
  const unmatched = [];
  for (const p of tagged) {
    const s = byHandle.get(p.handle);
    if (s) matched.push(s); else unmatched.push(p);
  }

  const off = matched.filter((s) => Number(s.shopify) !== 1);
  console.log(`Matched to a style: ${matched.length}` + (off.length ? ` (${off.length} with Shopify OFF: ${off.map((s) => s.groupid).join(', ')})` : ''));
  if (unmatched.length) {
    console.log(`NOT matched — left tagged on Shopify, unknown to BCWEB (${unmatched.length}):`);
    for (const p of unmatched) console.log(`  ${p.handle}  ${p.title}`);
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Run again with --apply to write the rows.');
  } else {
    const ins = await query(
      `INSERT INTO collection_member (groupid, tag)
       SELECT g, $2 FROM unnest($1::text[]) AS g
       ON CONFLICT (groupid, tag) DO NOTHING`,
      [matched.map((s) => s.groupid), TAG]
    );
    console.log(`\nWritten: ${ins.rowCount} new rows in collection_member (tag ${TAG}).`);
  }
  await pool.end();
})().catch(async (err) => {
  console.error('Import failed:', err.message);
  try { await pool.end(); } catch { /* already closed */ }
  process.exit(1);
});
