/*
=======================================================================================================================================
Module: utils/sizePrice.js   — THE rules for Shopify SIZE prices (owner, 2026-11-08)
=======================================================================================================================================
WHY. Shopify is priced per STYLE (skusummary.shopifyprice). A selling style often has one size that never sells — Milano 35: 5 pairs,
     never sells, while the style sold 101 pairs in a year — and cutting the style price to clear it gives the margin away on every
     other size (memory check-price-grain). Birkenstock can't be re-ordered on demand, so a dead size just sits. A size can therefore
     carry its OWN price on the SAME Shopify product (not a split product, not a basket discount — both rejected).

THE RULES (owner decisions, 2026-11-08):
  - Set BY HAND per size on the Shopify pricing drill, 50% of RRP filled in as the starting figure. Not an automatic rule.
  - On Shopify that size shows its own price with the STYLE price crossed out (compareAtPrice = the style price — utils/shopify.js →
    variantPrice). The other sizes keep the usual rule (compareAt = RRP when above the price).
  - A size price is USED only while it is BELOW the style price AND the size has STOCK (local free + FBA live — what Shopify shows,
    utils/shopifyStockSync.js). Every reader goes through ACTIVE_SQL below, so a path that forgets a rule can't leave a "clearance"
    size dearer than the rest, or carry its price onto a later delivery.
  - It ENDS (row deleted, logged):
      'back'    — by hand, "Back to style price", any time;
      'style'   — the style price goes TO OR BELOW it (styleDrop — W1 utils/priceWrite.js and Add / Modify routes/product-price.js,
                  in the SAME transaction as the style price, and the screen says so);
      'soldout' — the size sells out (endSoldOut — Update Orders, after its Shopify stock step), so a later delivery or a return sells
                  at the normal price (Birkenstock orders ~6 months ahead; a size 35 may already be on order);
      'tidy'    — a stale row the sold-out pass also clears (the size was deleted, or the style price can't be read).
  - No review date: a size price ends when the size sells out, and the style's review date would hide a selling style.
  - Google: the real size price is sent as the size's sale_price (Google rejects a feed price that doesn't match the page); `price`
    stays the RRP like every other size (owner). A size with its own price is left OUT of paid Shopping ads (owner: no ad spend on
    clearance stock) but stays in free listings. utils/merchantFeed.js (nightly) and utils/googleMerchant.js (the 2-hourly sweep).
  - ITS OWN LOG (shopify_size_price_log), never price_change_log — ~10 screens read that as the STYLE's price history. Every row is
    born with google_pushed_at NULL and the sweep re-sends that style: an ENDED size price must reach Google too, or the supplemental
    sale-price override would keep the clearance price there.
Tables: migrations/20261108b_shopify_size_price.sql.
=======================================================================================================================================
*/

const { safeNumeric } = require('./sql');

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// A size's stock as Shopify sees it: local free + FBA live (the Shopify stock sync's rule, without its cap). `codeExpr` is a hard-coded
// column expression only — never user input.
function stockSql(codeExpr) {
  return `(COALESCE((SELECT SUM(ls.qty) FROM localstock ls
                      WHERE ls.code = ${codeExpr} AND ls.ordernum = '#FREE' AND COALESCE(ls.deleted, 0) = 0 AND ls.qty > 0), 0)
         + COALESCE((SELECT MAX(af.amzlive) FROM amzfeed af WHERE af.code = ${codeExpr} AND af.amzlive > 0), 0))::int`;
}

// THE ACTIVE SET — every size price that is in force right now: below its style price, size not deleted, size in stock. Columns:
// code, groupid, price (numeric). Filter it by groupid / join it by code; never re-derive the predicate elsewhere.
const ACTIVE_SQL = `
  SELECT sp.code, sp.groupid, sp.price
  FROM shopify_size_price sp
  JOIN skusummary ss ON ss.groupid = sp.groupid
  JOIN skumap m      ON m.code = sp.code AND COALESCE(m.deleted, 0) = 0
  WHERE sp.price < ${safeNumeric('ss.shopifyprice')}
    AND ${stockSql('sp.code')} > 0
`;

// activeSizePrices(db, groupid) -> Map(code -> price number). `db` = a pool query wrapper or a transaction client.
async function activeSizePrices(db, groupid) {
  const r = await db.query(`SELECT code, price FROM (${ACTIVE_SQL}) a WHERE a.groupid = $1`, [groupid]);
  return new Map(r.rows.map((x) => [x.code, Number(x.price)]));
}

// The default the drill fills in: 50% of RRP, to the penny (owner). null when the RRP can't be read.
function suggestedPrice(rrp) {
  const n = num(rrp);
  return n !== null && n > 0 ? Math.round(n * 50) / 100 : null;
}

async function log(client, { code, groupid, oldPrice, newPrice, stylePrice, reason, note = null, by }) {
  await client.query(`
    INSERT INTO shopify_size_price_log (code, groupid, old_price, new_price, style_price, reason, note, changed_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [code, groupid, oldPrice, newPrice, stylePrice, reason, note, by]);
}

/*
 * setSizePrice(client, { code, price, note, by }) -> { error, message } | { groupid, size, oldPrice, newPrice, stylePrice, warnings }
 *   price: number > 0, already rounded to 2dp. Run inside the caller's transaction.
 * Refuses (writes nothing): NOT_FOUND (no such live size), NO_STYLE_PRICE (style price unreadable), NOT_BELOW_STYLE (price must be under
 * the style price — a size price is a clearance price), NO_STOCK (a size with nothing to sell would be ended at the next Update Orders).
 * Flags, never blocks: BELOW_COST (as W1).
 * The style row is read FOR UPDATE so a style-price write can't slip in between the check and the write (it takes the same lock).
 */
async function setSizePrice(client, { code, price, note = null, by }) {
  const cur = await client.query(`
    SELECT m.groupid,
           SUBSTRING(m.code FROM '[^-]*$')   AS size,
           ${safeNumeric('ss.shopifyprice')} AS style_price,
           ${safeNumeric('ss.cost')}         AS cost,
           ${stockSql('m.code')}             AS stock,
           sp.price                          AS own
    FROM skumap m
    JOIN skusummary ss ON ss.groupid = m.groupid
    LEFT JOIN shopify_size_price sp ON sp.code = m.code
    WHERE m.code = $1 AND COALESCE(m.deleted, 0) = 0
    FOR UPDATE OF ss
  `, [code]);
  if (!cur.rows.length) return { error: 'NOT_FOUND', message: 'Size not found' };
  const r = cur.rows[0];
  const stylePrice = num(r.style_price);
  if (stylePrice === null) return { error: 'NO_STYLE_PRICE', message: 'The style has no readable Shopify price' };
  if (price >= stylePrice) {
    return { error: 'NOT_BELOW_STYLE', message: `A size price must be below the style price (£${stylePrice.toFixed(2)})` };
  }
  if (Number(r.stock) <= 0) return { error: 'NO_STOCK', message: 'This size has no stock — nothing to sell at its own price' };

  const oldPrice = num(r.own);
  const warnings = [];
  const cost = num(r.cost);
  if (cost !== null && price < cost) warnings.push('BELOW_COST');

  await client.query(`
    INSERT INTO shopify_size_price (code, groupid, price, set_at, set_by, note)
    VALUES ($1, $2, $3, now(), $4, $5)
    ON CONFLICT (code) DO UPDATE SET price = EXCLUDED.price, set_at = now(), set_by = EXCLUDED.set_by, note = EXCLUDED.note
  `, [code, r.groupid, price, by, note]);
  await log(client, { code, groupid: r.groupid, oldPrice, newPrice: price, stylePrice, reason: 'set', note, by });
  return { groupid: r.groupid, size: r.size, oldPrice, newPrice: price, stylePrice, warnings };
}

/*
 * clearSizePrice(client, { code, by }) -> { error, message } | { groupid, size, oldPrice }
 * "Back to style price" by hand. NOT_SET when the size has no price of its own (nothing written).
 */
async function clearSizePrice(client, { code, by }) {
  const cur = await client.query(`
    SELECT sp.groupid, sp.price, SUBSTRING(sp.code FROM '[^-]*$') AS size, ${safeNumeric('ss.shopifyprice')} AS style_price
    FROM shopify_size_price sp
    LEFT JOIN skusummary ss ON ss.groupid = sp.groupid
    WHERE sp.code = $1
  `, [code]);
  if (!cur.rows.length) return { error: 'NOT_SET', message: 'This size has no price of its own' };
  const r = cur.rows[0];
  await client.query(`DELETE FROM shopify_size_price WHERE code = $1`, [code]);
  await log(client, { code, groupid: r.groupid, oldPrice: Number(r.price), newPrice: null, stylePrice: num(r.style_price), reason: 'back', by });
  return { groupid: r.groupid, size: r.size, oldPrice: Number(r.price) };
}

/*
 * styleDrop(client, { groupid, stylePrice, by }) -> [{ code, size, price }] — the size prices this style price ended.
 * THE style-price rule: a size keeps its own price, UNLESS the style price goes to or below it — then it goes back to the style price.
 * Call it in the SAME transaction as every style-price write (W1 writeShopifyPrice, Add / Modify product-price), after the UPDATE.
 */
async function styleDrop(client, { groupid, stylePrice, by }) {
  const del = await client.query(`
    DELETE FROM shopify_size_price
     WHERE groupid = $1 AND price >= $2
    RETURNING code, price, SUBSTRING(code FROM '[^-]*$') AS size
  `, [groupid, stylePrice]);
  for (const r of del.rows) {
    await log(client, { code: r.code, groupid, oldPrice: Number(r.price), newPrice: null, stylePrice, reason: 'style', by });
  }
  return del.rows.map((r) => ({ code: r.code, size: r.size, price: Number(r.price) }));
}

/*
 * endSoldOut(client, { by }) -> { ended: [{ code, groupid, price, reason }], groupids: [..] }
 * The tidy run by Update Orders (utils/orderSync.js) after its Shopify stock step: every size price whose size has sold out ('soldout'),
 * plus stale rows — size deleted, style price unreadable or no longer above it ('tidy'). The caller re-pushes `groupids` to Shopify
 * after the commit, so a later delivery or return sells at the style price.
 */
async function endSoldOut(client, { by }) {
  const stale = await client.query(`
    SELECT sp.code, sp.groupid, sp.price,
           ${safeNumeric('ss.shopifyprice')} AS style_price,
           CASE WHEN m.code IS NULL OR ss.groupid IS NULL OR ${safeNumeric('ss.shopifyprice')} IS NULL
                     OR sp.price >= ${safeNumeric('ss.shopifyprice')} THEN 'tidy'
                ELSE 'soldout' END AS reason
    FROM shopify_size_price sp
    LEFT JOIN skusummary ss ON ss.groupid = sp.groupid
    LEFT JOIN skumap m      ON m.code = sp.code AND COALESCE(m.deleted, 0) = 0
    WHERE m.code IS NULL OR ss.groupid IS NULL OR ${safeNumeric('ss.shopifyprice')} IS NULL
       OR sp.price >= ${safeNumeric('ss.shopifyprice')}
       OR ${stockSql('sp.code')} <= 0
    FOR UPDATE OF sp
  `);
  if (!stale.rows.length) return { ended: [], groupids: [] };
  await client.query(`DELETE FROM shopify_size_price WHERE code = ANY($1::varchar[])`, [stale.rows.map((r) => r.code)]);
  for (const r of stale.rows) {
    await log(client, { code: r.code, groupid: r.groupid, oldPrice: Number(r.price), newPrice: null, stylePrice: num(r.style_price), reason: r.reason, by });
  }
  return {
    ended: stale.rows.map((r) => ({ code: r.code, groupid: r.groupid, price: Number(r.price), reason: r.reason })),
    groupids: [...new Set(stale.rows.map((r) => r.groupid))],
  };
}

module.exports = { ACTIVE_SQL, stockSql, activeSizePrices, suggestedPrice, setSizePrice, clearSizePrice, styleDrop, endSoldOut };
