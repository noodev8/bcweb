/*
=======================================================================================================================================
Module: utils/productGallery.js
=======================================================================================================================================
Purpose: The DB side of a product's gallery (product_images), shared by the product-images* routes so they return one shape and
         renumber the same way. Image processing/naming lives in utils/productImage.js; the Shopify push in utils/shopify.js.

         loadGallery(db, groupid)        -> rows in position order, as the API returns them (position 1 = main).
         closeGap(db, groupid, removed)  -> shift positions above `removed` down by one, so they stay 1..N.
         swapPositions(db, groupid, a, b)-> swap two positions.
         Both writers take a transaction client. UNIQUE (groupid, position) is checked row by row, so a plain "position = position - 1"
         could collide mid-statement; both go via a temporary +10000 offset (smallint, so well clear of the cap).
         fileInUseElsewhere(db, filename, groupid) -> true if ANOTHER product still uses the file. Width twins (Regular/Narrow) share one
                                  main file, and Shopify media can be shared across products too — which is why neither filename nor
                                  shopify_media_id is UNIQUE (constraints dropped 2026-10-13, after the first import hit 10 twins). Every
                                  one.com delete checks this first, or removing one twin's image would break the other's.
=======================================================================================================================================
*/

const OFFSET = 10000;

async function loadGallery(db, groupid) {
  const r = await db.query(`
    SELECT id, position, filename, view, alt, width, height, (shopify_media_id IS NOT NULL) AS on_shopify, created_at
    FROM product_images WHERE groupid = $1 ORDER BY position
  `, [groupid]);
  return r.rows;
}

async function closeGap(client, groupid, removed) {
  await client.query(`UPDATE product_images SET position = position + ${OFFSET} WHERE groupid = $1 AND position > $2`, [groupid, removed]);
  await client.query(`UPDATE product_images SET position = position - ${OFFSET + 1} WHERE groupid = $1 AND position > ${OFFSET}`, [groupid]);
}

async function swapPositions(client, groupid, a, b) {
  await client.query(`UPDATE product_images SET position = $3 WHERE groupid = $1 AND position = $2`, [groupid, a, a + OFFSET]);
  await client.query(`UPDATE product_images SET position = $3 WHERE groupid = $1 AND position = $2`, [groupid, b, a]);
  await client.query(`UPDATE product_images SET position = $3 WHERE groupid = $1 AND position = $2`, [groupid, a + OFFSET, b]);
}

async function fileInUseElsewhere(db, filename, groupid) {
  const r = await db.query(`
    SELECT 1 FROM product_images WHERE filename = $1 AND groupid <> $2
    UNION ALL
    SELECT 1 FROM skusummary WHERE imagename = $1 AND groupid <> $2
    LIMIT 1
  `, [filename, groupid]);
  return r.rows.length > 0;
}

module.exports = { loadGallery, closeGap, swapPositions, fileInUseElsewhere };
