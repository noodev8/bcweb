// Shared by the AMZ Shipment routes (amz-shipment-pack, amz-shipment-box-delete) and by Goods In (goods-in-book), which looks up the Amazon
// units it books in so the screen can put them in the user's box.
//
// A BOX IS ONLY STORED ONCE IT'S PACKED (owner, 2026-10-16: "dont want the box saved until its locked"). The box being filled is the
// user's ACTIVE BOX, held in their browser (bcweb-web/src/lib/amzActiveBox.ts) and shared by Goods In and AMZ Shipment; Pack writes it
// here in one go, under its new number. So every box this screen stores is packed (`amzshipment.locked = true` — the column keeps its
// 2026-10-15 name; on screen it's "packed"). A box the legacy PowerBuilder app writes takes the column default (not packed).

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

// What a code is, for an Amazon box: sku / fnsku from amzfeed on CODE (not amzfeed.sku — see amz-shipment-scan), supplier =
// skusummary.supplier (what the legacy app writes), groupid + title so the packer can see which shoe it is. A deleted skumap row only
// wins when there is no live one. null when the code isn't in skumap; sku/fnsku are '' when amzfeed has no FNSKU for it.
async function lookupAmzProduct(client, code) {
  return (await client.query(
    `SELECT m.code, COALESCE(af.sku, '') AS sku, COALESCE(af.fnsku, '') AS fnsku, ss.supplier,
            COALESCE(m.groupid, '') AS groupid, COALESCE(t.shopifytitle, '') AS title
       FROM skumap m
       LEFT JOIN skusummary ss ON ss.groupid = m.groupid
       LEFT JOIN title t ON t.groupid = m.groupid
       LEFT JOIN LATERAL (SELECT a.sku, a.fnsku FROM amzfeed a WHERE a.code = m.code AND COALESCE(a.fnsku, '') <> '' LIMIT 1) af ON true
      WHERE m.code = $1
      ORDER BY COALESCE(m.deleted, 0) ASC
      LIMIT 1`,
    [code]
  )).rows[0] || null;
}

// Take box `box` out of amzshipment and close the gap (Delete box — the ONLY thing that changes numbers, owner 2026-10-16): the boxes after it move down one, so our numbers always run 1..n and match
// Amazon's B1..Bn in the Amazon upload file (owner, 2026-10-06: "if a box is deleted we renumber boxes"). The table's key is (box, sku)
// and checked row by row, so a plain `box = box - 1` can collide mid-update; the shift goes through negatives instead. Run inside the
// caller's transaction. Returns the rows deleted.
async function deleteBoxAndRenumber(client, box) {
  const del = await client.query(`DELETE FROM amzshipment WHERE box = $1`, [box]);
  await client.query(`UPDATE amzshipment SET box = -box WHERE box > $1`, [box]);
  await client.query(`UPDATE amzshipment SET box = -box - 1 WHERE box < 0`);
  return del.rowCount;
}

// STALE GUARD for anything that acts on a stored box by NUMBER (delete, a refill's pack). Numbers move when another bench
// deletes an earlier box, so the screen sends what it showed in the box — [{ code, qty }] — and the action only goes ahead
// if the stored box still holds exactly that. Locks the box's rows for the rest of the caller's transaction. Returns the rows (with
// sku / fnsku / groupid / title / measurements) or null when the box isn't what the screen showed (or doesn't exist).
async function lockBoxIfUnchanged(client, box, expect) {
  const rows = (await client.query(
    `SELECT s.code, s.sku, COALESCE(s.fnsku, '') AS fnsku, COALESCE(m.groupid, '') AS groupid,
            COALESCE(t.shopifytitle, '') AS title, COALESCE(s.qty, 0) AS qty,
            COALESCE(s.length, '') AS length, COALESCE(s.width, '') AS width,
            COALESCE(s.height, '') AS height, COALESCE(s.weight, '') AS weight
       FROM amzshipment s
       LEFT JOIN LATERAL (SELECT m.groupid FROM skumap m WHERE m.code = s.code LIMIT 1) m ON true
       LEFT JOIN title t ON t.groupid = m.groupid
      WHERE s.box = $1
      ORDER BY s.code
      FOR UPDATE OF s`,
    [box]
  )).rows;
  if (rows.length === 0) return null;
  const sig = (list) => list.map((l) => `${String(l.code).trim()}=${Number(l.qty)}`).sort().join('|');
  if (!Array.isArray(expect) || sig(rows) !== sig(expect)) return null;
  return rows;
}

module.exports = { cleanDims, lookupAmzProduct, deleteBoxAndRenumber, lockBoxIfUnchanged };
