/*
=======================================================================================================================================
Module: utils/ebayCandidates.js
=======================================================================================================================================
Purpose: THE "could this style go on eBay, and is it ready?" read — one copy, used by the Not on eBay view (routes/ebay-candidates.js,
         every style) and by the List button (routes/ebay-list.js, one style, re-checked at the moment of listing). So what the screen
         calls ready is exactly what the button will list. READ ONLY.

MEMBERSHIP: a style (skusummary groupid) that
  - has STOCK: a size with sellable local stock (localstock #FREE — CLAUDE.md, never stockvariants) or FBA live (amzfeed.amzlive) —
    the same Stock figure as the On eBay view and the stock sync
  - is not Birkenstock (brand ILIKE 'birk%') — never on eBay
  - has NO size on eBay now (onEbayCodes — read live by the caller, fixed price and auction alike) — a style that has one is counted
    (onEbayStyles), not returned

PER STYLE: title (Shopify), brand, the category / department / Style / material / Type the rules give (utils/ebayListingRules.js),
the Shopify price, stock (local + FBA), photos (product_images), whether a Shopify description exists, and its IN-STOCK sizes — code,
UK size (skumap.uksize, never the code suffix), barcode (skumap.ean, trailing B stripped), local, FBA, and the size's eBay PRICE
(owner, 2026-11-02 — utils/ebayListingRules.js → sizePriceFor: its Amazon price, amzfeed.amzprice, else the Shopify price + £4.50;
free postage) with `price_from` and the eBay profit at it (THE EBY formula, no postage). The style carries the low–high of those. skumap can hold two rows for one code: the one with a UK size, then a barcode, wins.
With { full: true } (the List button) also: the description text, the photo filenames in order, and the cost.

READINESS:
  missing (blocks listing)  category · photos · description · price (a size with neither an Amazon nor a Shopify price) · uk_size (an in-stock size has none) · uk_size_dup (two sizes
                            share a UK size — eBay refuses duplicate variations) · barcode · title / title_long (over eBay's 80)
  todo (the form asks)      material — saved back to skusummary.material when the style is listed (owner, option A)
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');
const { ebayProfit } = require('./ebayProfit');
const rules = require('./ebayListingRules');

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

/*
 * loadCandidates({ onEbayCodes, groupid?, full? }) -> { rows, onEbayStyles }
 *   onEbayCodes  every SKU live on eBay now (fixed price + auction)
 *   groupid      only this style (the List button)
 *   full         add description, images and cost (the List button)
 */
async function loadCandidates({ onEbayCodes, groupid = null, full = false }) {
  const result = await query(`
    WITH sz AS (
      SELECT DISTINCT ON (m.code) m.code, m.groupid, NULLIF(TRIM(m.uksize), '') AS uksize,
             NULLIF(regexp_replace(TRIM(COALESCE(m.ean, '')), 'B$', ''), '') AS ean
      FROM skumap m
      WHERE COALESCE(m.deleted, 0) = 0 AND ($2::text IS NULL OR m.groupid = $2)
      ORDER BY m.code, (NULLIF(TRIM(m.uksize), '') IS NULL), (NULLIF(TRIM(m.ean), '') IS NULL), m.sku
    ),
    loc AS (
      SELECT code, SUM(qty) AS qty FROM localstock
      WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0 AND ($2::text IS NULL OR groupid = $2)
      GROUP BY code
    ),
    fba AS (
      SELECT code, SUM(amzlive) AS qty FROM amzfeed WHERE COALESCE(amzlive, 0) > 0 AND ($2::text IS NULL OR groupid = $2) GROUP BY code
    ),
    amz AS (
      -- The size's Amazon price — one amzfeed row per code (READ ONLY; the price as live on Amazon, not a basket price waiting upload).
      SELECT code, ${safeNumeric('amzprice')} AS price FROM amzfeed WHERE ($2::text IS NULL OR groupid = $2)
    ),
    lines AS (
      SELECT sz.groupid, sz.code, sz.uksize, sz.ean, COALESCE(loc.qty, 0) AS local, COALESCE(fba.qty, 0) AS fba, amz.price AS amz_price
      FROM sz
      LEFT JOIN loc ON loc.code = sz.code
      LEFT JOIN fba ON fba.code = sz.code
      LEFT JOIN amz ON amz.code = sz.code
      WHERE COALESCE(loc.qty, 0) + COALESCE(fba.qty, 0) > 0
    ),
    per AS (
      SELECT groupid, SUM(local) AS local, SUM(fba) AS fba,
             json_agg(json_build_object('code', code, 'uksize', uksize, 'ean', ean, 'local', local, 'fba', fba, 'amz_price', amz_price)
               ORDER BY CASE WHEN SUBSTRING(code FROM '[^-]*$') ~ '^[0-9]+([.][0-9]+)?$' THEN SUBSTRING(code FROM '[^-]*$')::numeric END NULLS LAST,
                        code) AS sizes
      FROM lines GROUP BY groupid
    )
    SELECT ss.groupid,
           t.shopifytitle AS title,
           NULLIF(TRIM(ss.brand), '') AS brand,
           a.gender, a.producttype,
           ss.material, NULLIF(TRIM(ss.colourmap), '') AS colour,
           ${safeNumeric('ss.shopifyprice')} AS price,
           ${safeNumeric('ss.rrp')} AS rrp,
           ${safeNumeric('ss.cost')} AS cost,
           (SELECT COUNT(*) FROM product_images pi WHERE pi.groupid = ss.groupid) AS photos,
           d.description,
           EXISTS (SELECT 1 FROM skumap x WHERE x.groupid = ss.groupid AND x.code = ANY($1::text[])) AS on_ebay,
           ${full ? `(SELECT json_agg(pi.filename ORDER BY pi.position, pi.id) FROM product_images pi WHERE pi.groupid = ss.groupid) AS images,` : ''}
           per.local, per.fba, per.sizes
    FROM per
    JOIN skusummary ss ON ss.groupid = per.groupid
    LEFT JOIN title t  ON t.groupid  = ss.groupid
    LEFT JOIN LATERAL (SELECT gender, producttype FROM attributes WHERE groupid = ss.groupid LIMIT 1) a ON true
    LEFT JOIN LATERAL (SELECT NULLIF(TRIM(description), '') AS description FROM shopify_description WHERE handle = ss.handle LIMIT 1) d ON true
    WHERE COALESCE(ss.brand, '') NOT ILIKE 'birk%'
    ORDER BY per.local + per.fba DESC, ss.groupid
  `, [onEbayCodes, groupid]);

  let onEbayStyles = 0;
  const rows = [];
  for (const r of result.rows) {
    if (r.on_ebay) { onEbayStyles += 1; continue; }
    const title = r.title || '';
    const price = num(r.price);
    const cost = num(r.cost);
    const sizes = (r.sizes || []).map((z) => {
      const def = rules.sizePriceFor(z.amz_price, price);
      return {
        code: z.code, uk_size: rules.ukSizeFor(z.uksize), ean: z.ean || null, local: Number(z.local) || 0, fba: Number(z.fba) || 0,
        amz_price: num(z.amz_price) !== null && num(z.amz_price) > 0 ? num(z.amz_price) : null,
        price: def ? def.price : null,
        price_from: def ? def.from : null,
        profit: def && cost !== null ? round2(sizeProfit(def.price, cost)) : null,
      };
    });
    const priced = sizes.filter((z) => z.price !== null);
    const profits = sizes.map((z) => z.profit).filter((v) => v !== null);
    const category = rules.categoryFor(r.gender, r.producttype, title);
    const material = rules.materialFor(r.material, title);
    const ukSizes = sizes.map((z) => z.uk_size).filter(Boolean);

    const missing = [];
    if (!category) missing.push('category');
    if (Number(r.photos) === 0) missing.push('photos');
    if (!r.description) missing.push('description');
    if (sizes.length === 0 || priced.length < sizes.length) missing.push('price');
    if (sizes.some((z) => !z.uk_size)) missing.push('uk_size');
    else if (new Set(ukSizes).size !== ukSizes.length) missing.push('uk_size_dup');
    if (sizes.some((z) => !z.ean)) missing.push('barcode');
    if (!title) missing.push('title');
    else if (title.length > rules.TITLE_MAX) missing.push('title_long');
    const todo = material ? [] : ['material'];

    const row = {
      groupid: r.groupid,
      title: r.title || null,
      brand: r.brand,
      gender: r.gender || null,
      producttype: r.producttype || null,
      category,
      department: rules.departmentFor(r.gender),
      style: rules.styleFor(r.gender, r.producttype, title),
      material,
      type: rules.typeFor(r.gender, r.producttype, title),
      colour: r.colour,
      price,              // the SHOPIFY price (for reference — the eBay prices are per size)
      rrp: num(r.rrp),
      price_low: priced.length ? Math.min(...priced.map((z) => z.price)) : null,
      price_high: priced.length ? Math.max(...priced.map((z) => z.price)) : null,
      profit_low: profits.length ? Math.min(...profits) : null,
      profit_high: profits.length ? Math.max(...profits) : null,
      photos: Number(r.photos),
      has_description: Boolean(r.description),
      title_length: title.length,
      local: Number(r.local), fba: Number(r.fba), stock: Number(r.local) + Number(r.fba),
      sizes,
      missing,
      todo,
      status: missing.length ? 'missing' : todo.length ? 'todo' : 'ready',
    };
    if (full) {
      row.description = r.description || null;
      row.images = r.images || [];
      row.cost = cost;
      row.stored_material = String(r.material || '').trim() || null;
    }
    rows.push(row);
  }
  return { rows, onEbayStyles };
}

// One eBay sale of one pair at `price`, free postage (rules.POSTAGE) — THE EBY formula. Also used by the stock sync's added sizes.
function sizeProfit(price, cost) {
  return ebayProfit({ price, postage: rules.POSTAGE, cost, orderTotal: price + rules.POSTAGE, orderUnits: 1 });
}

// Every SKU live on eBay now — fixed price and auction alike — from a fetchActiveListings() read.
function codesOnEbay(read) {
  return [...new Set([...read.listings.flatMap((l) => l.lines.map((x) => x.sku)), ...read.skippedSkus].filter(Boolean))];
}

module.exports = { loadCandidates, codesOnEbay, sizeProfit };
