// Shared by the AMZ Shipment write routes (amz-shipment-line, amz-shipment-dims) and by Goods In, which boxes the Amazon units it books
// in (goods-in-book / goods-in-cancel). The +1 / −1 on an amzshipment line lives here so a box is written the same way from both screens.

// A box's measurements as the screen sends them → the strings amzshipment stores (its weight/length/width/height are character
// varying). Anything that isn't a plain positive number becomes '' (stored as NULL), so junk never reaches the table.
function cleanDims(raw) {
  const out = { length: '', width: '', height: '', weight: '' };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(out)) {
    const v = String(raw[k] ?? '').trim();
    if (/^\d{1,4}([.]\d{1,3})?$/.test(v) && Number(v) > 0) out[k] = v;
  }
  return out;
}

// Put ONE unit of `code` into `box`. One amzshipment row per box + Amazon SKU (the table's key is (box, sku)), so this upserts it.
// sku / fnsku come from amzfeed on CODE (not amzfeed.sku — see amz-shipment-scan), supplier = skusummary.supplier (what the legacy app
// writes). A code with no Amazon SKU/FNSKU can't be stored (sku is NOT NULL): returns { noSku: true } and writes nothing.
// MEASUREMENTS on a new row are copied from the box's existing rows when it has any, so every row of a box agrees; otherwise `dims`
// (cleanDims output, or nothing). Returns { qty, sku, fnsku } — the line's qty after the add.
async function addUnitToBox(client, box, code, dims) {
  const product = (await client.query(
    `SELECT COALESCE(af.sku, '') AS sku, COALESCE(af.fnsku, '') AS fnsku, ss.supplier
       FROM skumap m
       LEFT JOIN skusummary ss ON ss.groupid = m.groupid
       LEFT JOIN LATERAL (SELECT a.sku, a.fnsku FROM amzfeed a WHERE a.code = m.code AND COALESCE(a.fnsku, '') <> '' LIMIT 1) af ON true
      WHERE m.code = $1
      ORDER BY COALESCE(m.deleted, 0) ASC
      LIMIT 1`,
    [code]
  )).rows[0];
  if (!product || !product.sku || !product.fnsku) return { noSku: true };

  const stored = (await client.query(
    `SELECT MAX(length) AS length, MAX(width) AS width, MAX(height) AS height, MAX(weight) AS weight FROM amzshipment WHERE box = $1`,
    [box]
  )).rows[0];
  const d = stored.length || stored.width || stored.height || stored.weight ? stored : (dims || {});

  const row = (await client.query(
    `INSERT INTO amzshipment (box, supplier, code, sku, fnsku, qty, weight, length, height, width)
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9)
     ON CONFLICT (box, sku) DO UPDATE SET qty = COALESCE(amzshipment.qty, 0) + 1
     RETURNING qty`,
    [box, product.supplier, code, product.sku, product.fnsku, d.weight || null, d.length || null, d.height || null, d.width || null]
  )).rows[0];
  return { qty: row.qty, sku: product.sku, fnsku: product.fnsku };
}

// Take ONE unit of `code` out of `box`; the row is deleted at 0. Returns the line's qty after (0 = gone), or null when the box holds
// no such line.
async function removeUnitFromBox(client, box, code) {
  const row = (await client.query(
    `UPDATE amzshipment SET qty = COALESCE(qty, 0) - 1 WHERE box = $1 AND code = $2 RETURNING sku, qty`,
    [box, code]
  )).rows[0];
  if (!row) return null;
  if (row.qty <= 0) await client.query(`DELETE FROM amzshipment WHERE box = $1 AND sku = $2`, [box, row.sku]);
  return Math.max(0, row.qty);
}

module.exports = { cleanDims, addUnitToBox, removeUnitFromBox };
