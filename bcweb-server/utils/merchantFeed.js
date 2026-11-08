/*
=======================================================================================================================================
Module: utils/merchantFeed.js
=======================================================================================================================================
Purpose: THE rules for the Google Merchant Center product feed — which sizes go in, and what each line says. scripts/merchant-feed.js
         builds the file from these; nothing else should build feed lines.

MOVED FROM PYTHON (2026-11-08, owner: move the Python into BCWEB, one script at a time). This is a FAITHFUL copy of the scripts repo's
merchant-feed/merchant_feed.py — same query, same per-line rules, same TSV — so the first Node run can be compared line by line with the
Python file before the cron is switched. Behaviour changes (per-size prices, leaving clearance sizes out of paid ads) come AFTER the
switch, as their own steps — the first of them, 2026-11-08: a size with its own Shopify price (utils/sizePrice.js) goes out at that
price as its sale_price and with excluded_destination = Shopping_ads (a new last column; blank on every other line). Quirks copied on purpose, so the comparison is clean (each is a candidate for a later, deliberate fix):
  - Stock: ANY non-deleted localstock row counts as local stock, whatever its ordernum (a pair allocated to a customer order included),
    then Amazon FBA live, then UK distributor stock (ukdstock).
  - A line is dropped silently when its GTIN isn't 12/13 digits (googleMerchant.fetchTargets mirrors that), and when the RRP, Shopify
    price or cost holds text that isn't a number (Python's float() raised and the line was skipped).
  - A missing variant link / handle / image prints as the word "None" (Python's str(None)).
  - "colour" is the column name Python used, kept as is.
Column order, the header and the quoting are pandas' to_csv(sep="\t") defaults: a field is quoted only when it holds a tab, a double
quote or a line break, with " doubled inside; lines end in \n (the VPS is Linux).
=======================================================================================================================================
*/

const { ACTIVE_SQL } = require('./sizePrice');

// Same query as merchant_feed.py (GROUP BY included), so the two read exactly the same rows — plus, since 2026-11-08, each size's own
// Shopify price when one is in force (utils/sizePrice.js → ACTIVE_SQL: below the style price, in stock). One code per row, so the join
// can't fan the rows out.
const FEED_SQL = `
  SELECT
      sm.groupid, sm.shopifyprice, sm.imagename, sm.brand, sm.colour,
      sm.material, sm.cost, sm.rrp, sm.handle, sm.googlecampaign,
      a.gender, t.shopifytitle AS title,
      m.code, m.variantlink, m.uksize, m.ean, m.googleid,
      COALESCE(SUM(CASE WHEN ls.deleted = 0 THEN ls.qty ELSE 0 END), 0) as localstock_qty,
      CASE WHEN COUNT(CASE WHEN ls.deleted = 0 THEN 1 END) > 0 THEN 0 ELSE 1 END as localstock_deleted,
      af.amzlive, uk.stock as ukdstock, sd.description,
      mpt.product_type, mpt.google_category,
      asp.price AS size_price
  FROM skusummary sm
  JOIN skumap m ON sm.groupid = m.groupid
  LEFT JOIN attributes a ON a.groupid = sm.groupid
  LEFT JOIN title t ON t.groupid = sm.groupid
  LEFT JOIN localstock ls ON ls.code = m.code
  LEFT JOIN amzfeed af ON af.code = m.code
  LEFT JOIN ukdstock uk ON uk.code = m.code
  LEFT JOIN shopify_description sd ON sd.handle = sm.handle
  LEFT JOIN merchant_product_type mpt ON mpt.groupid = sm.groupid
  LEFT JOIN (${ACTIVE_SQL}) asp ON asp.code = m.code
  WHERE sm.googlestatus = 1 AND sm.shopify = 1 AND m.googlestatus = 1
  GROUP BY sm.groupid, sm.shopifyprice, sm.imagename, sm.brand, sm.colour,
           sm.material, sm.cost, sm.rrp, sm.handle, sm.googlecampaign,
           a.gender, t.shopifytitle, m.code, m.variantlink, m.uksize, m.ean, m.googleid,
           af.amzlive, uk.stock, sd.description, mpt.product_type, mpt.google_category, asp.price
`;

const COLUMNS = [
  'id', 'title', 'description', 'link', 'image_link', 'availability', 'cost_of_goods_sold', 'price', 'sale_price',
  'google_product_category', 'product_type', 'brand', 'gtin', 'condition', 'age_group', 'colour', 'gender', 'material', 'size',
  'size_system', 'item_group_id', 'custom_label_0', 'custom_label_1', 'excluded_destination',
];

// The feed spec's value for "not in paid Shopping ads" (free listings untouched). googleMerchant.js sends the Merchant API's spelling.
const EXCLUDE_ADS = 'Shopping_ads';

const DEFAULT_CATEGORY = 187;   // Google's "Shoes" — what an unreviewed product goes out as (merchant_product_type not approved yet)

// Python's float() on a VARCHAR price: surrounding whitespace allowed, digits with an optional point and exponent, nan / inf.
// Anything else threw, and merchant_feed.py skipped the whole line — so this throws too and buildItems skips it.
const FLOAT_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
function pyFloat(v) {
  const s = String(v).trim();
  if (FLOAT_RE.test(s)) return Number(s);
  const special = s.toLowerCase().replace(/^[+-]/, '');
  if (special === 'nan') return NaN;
  if (special === 'inf' || special === 'infinity') return s.startsWith('-') ? -Infinity : Infinity;
  throw new Error(`not a number: ${JSON.stringify(v)}`);
}

// Python's f"{x:.2f}": the exact binary value rounded, ties to EVEN. JS toFixed ties away from zero, which differs only on exact halves
// (12.125 → Python 12.12, toFixed 12.13), so those are handled here. nan / inf print as Python prints them.
function pyFixed2(x) {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const cents = x * 100;
  if (Number.isInteger(x * 8) && Math.abs(cents - Math.trunc(cents)) === 0.5) {
    const down = Math.trunc(cents);
    const even = down % 2 === 0 ? down : down + Math.sign(cents);
    return (even / 100).toFixed(2);
  }
  return x.toFixed(2);
}

const money = (v) => `${pyFixed2(pyFloat(v))} GBP`;
const notNull = (v) => v !== null && v !== undefined;
const pyStr = (v) => (notNull(v) ? String(v) : 'None');                     // f-string / str() of a value, None included

// attributes.gender → Google gender + age_group (merchant_feed.py determine_gender_and_age).
function genderAndAge(gender) {
  if (!gender) return ['', 'adult'];
  switch (gender.trim().toUpperCase()) {
    case 'WOMENS': return ['female', 'adult'];
    case 'GIRLS': return ['female', 'kids'];
    case 'MENS': return ['male', 'adult'];
    case 'BOYS': return ['male', 'kids'];
    default: return ['unisex', 'adult'];
  }
}

// In stock = local stock first, then Amazon FBA live, then the UK distributor (merchant_feed.py determine_stock_availability).
function inStock(r) {
  const local = Number(r.localstock_qty);                                   // SUM() → bigint, which node-pg returns as a string
  if (local && Number(r.localstock_deleted) === 0 && local > 0) return true;
  if (r.amzlive && r.amzlive > 0) return true;
  if (r.ukdstock && r.ukdstock > 0) return true;
  return false;
}

/*
 * buildItem(row) -> the feed line as { column: value }, or null when the line is left out (bad GTIN — or a price that isn't a number,
 * which throws, as Python's float() did; buildItems counts those).
 */
function buildItem(r) {
  const gtin = (r.ean ? String(r.ean) : '').replace(/B+$/, '');
  if (!(gtin && (gtin.length === 12 || gtin.length === 13) && /^\d+$/.test(gtin))) return null;

  const [gender, ageGroup] = genderAndAge(r.gender);
  const size = r.uksize ? String(r.uksize).split(' UK').join('') : '';
  const price = notNull(r.rrp) ? money(r.rrp) : '';
  // A size with its own Shopify price (utils/sizePrice.js, owner 2026-11-08): its REAL price is the sale price — Google rejects a feed
  // price that doesn't match the page — while `price` stays the RRP like every other size (owner). And it is left OUT of paid Shopping
  // ads (owner: no ad spend on clearance stock); free listings keep it.
  const ownPrice = notNull(r.size_price);
  const salePrice = ownPrice ? money(r.size_price) : notNull(r.shopifyprice) ? money(r.shopifyprice) : '';
  const cost = notNull(r.cost) ? money(r.cost) : '';

  return {
    id: r.googleid,
    title: r.title,
    description: notNull(r.description) ? r.description : r.title,       // approved Shopify text (descriptions review), else the title
    link: `https://brookfieldcomfort.com/products/${pyStr(r.handle)}?variant=${pyStr(r.variantlink).replace(/V+$/, '')}`,
    image_link: `https://images.brookfieldcomfort.com/${pyStr(r.imagename)}`,
    availability: inStock(r) ? 'in stock' : 'out of stock',
    cost_of_goods_sold: cost,
    price,                                                                  // RRP — Google shows the sale price struck against it
    sale_price: salePrice,                                                  // the Shopify selling price (the size's own, if it has one)
    google_product_category: notNull(r.google_category) ? Math.trunc(Number(r.google_category)) : DEFAULT_CATEGORY,
    product_type: notNull(r.product_type) ? r.product_type : '',
    brand: r.brand,
    gtin,
    condition: 'new',
    age_group: ageGroup,
    colour: r.colour,
    gender,
    material: notNull(r.material) ? r.material : '',
    size,
    size_system: 'UK',
    item_group_id: r.groupid,
    custom_label_0: r.googlecampaign,                                       // the Google Ads campaign bucket (skusummary.googlecampaign)
    custom_label_1: r.groupid,                                              // our style id, so Google's reports come back keyed on it
    excluded_destination: ownPrice ? EXCLUDE_ADS : '',                      // a size-priced (clearance) size: free listings only
  };
}

// buildItems(rows) -> { items, noGtin, badNumber } — every line that goes in, plus counts of the two kinds left out.
function buildItems(rows) {
  const items = [];
  let noGtin = 0, badNumber = 0;
  for (const r of rows) {
    let item;
    try { item = buildItem(r); } catch { badNumber += 1; continue; }
    if (item === null) { noGtin += 1; continue; }
    items.push(item);
  }
  return { items, noGtin, badNumber };
}

// One TSV field as pandas / Python's csv module writes it (QUOTE_MINIMAL): null → empty; quoted only if it holds a tab, " or a line break.
function tsvField(v) {
  if (!notNull(v)) return '';
  const s = String(v);
  return /[\t"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// toTsv(items) -> the whole file: header line, then one line per item, each ending in \n.
function toTsv(items) {
  const lines = [COLUMNS.join('\t')];
  for (const it of items) lines.push(COLUMNS.map((c) => tsvField(it[c])).join('\t'));
  return `${lines.join('\n')}\n`;
}

module.exports = { FEED_SQL, COLUMNS, buildItem, buildItems, toTsv, pyFloat, pyFixed2 };
