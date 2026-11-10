/*
=======================================================================================================================================
Util: utils/amzListing.js   — "List on Amazon (FBA)": our offer on Amazon's existing listing, Fulfilled by Amazon (2026-11-10)
=======================================================================================================================================
Purpose: THE copy of the rules for listing a style's sizes on Amazon through the SP-API Listings Items API, replacing (for now beside)
         the AMZ-Upload.xlsm file, which listed every size as Fulfilled by MERCHANT and left the switch to FBA to be done by hand in
         Seller Central. Owner decisions (2026-11-10): price = RRP; every size of the style on Add / Modify that has a barcode and isn't
         on Amazon yet; ONE style per press; the .xlsm button stays as a fallback; amzfeed is NOT written here — the FBA stock read in
         Update Orders (utils/amzStockSync.js) adds the new SKU with its ASIN + FNSKU (checked 2026-11-10: Amazon's FBA inventory read
         returns SKUs holding 0, with their FNSKU), so amzfeed keeps one writer.

THE LISTING (built against Amazon's real replies — scripts/amz-listing-probe.js, 2026-11-10):
  - The ASIN comes from the size's BARCODE (skumap.ean, trailing 'B' stripped) via Catalog Items searchCatalogItems. No ASIN = the
    product isn't on Amazon's catalogue: we don't create catalogue pages here (a much bigger job) — "list by hand".
  - putListingsItem, requirements LISTING_OFFER_ONLY (our offer on the existing ASIN), productType = AMAZON'S type for that ASIN (BOOT,
    SANDAL, SHOES… — the old file forced SHOES on everything), condition new_new, merchant_suggested_asin, our_price = RRP,
    fulfillment_availability AMAZON_EU (= FBA from the start, no FBM step), batteries_required false, and the Dangerous Goods
    declaration 'not_applicable' (as our live FBA listings carry it — BOOT requires it; SHOES ignores it with a harmless warning).
    list_price is NOT sent: Amazon ignores it for these types.
  - SKU = skumap.sku when set, else <code>-<yymm> (London) — the same as the file and our live SKUs (e.g. …-2512). The stock sync
    matches Amazon's SKU back to us through skumap.sku, which is why the stamp below matters.
  - CHECK first (mode=VALIDATION_PREVIEW: Amazon validates, creates nothing), then LIST for real. Amazon can refuse a size (seen: a
    "restricted generic ASIN" on Free Spirit Frisco) — its own message is shown, nothing else is done for that size.
  - Only sizes Amazon ACCEPTED are stamped in skumap (sku, status '1', updated — what the file's helper stamps), in one transaction
    with a bclog row (section 'Amazon Listing'). The file stamps every size it writes even if Seller Central later rejects it.
  - ACCEPTED means Amazon took it in; the listing goes live / gets its FNSKU within minutes, on Amazon's side.

Rate limits: searchCatalogItems ~2 a second (20 barcodes a call), putListingsItem ~5 a second — a style is a handful of calls.
=======================================================================================================================================
*/

const { query } = require('../database');
const { withTransaction } = require('./transaction');
const { writeBcLog } = require('./bclog');
const { safeNumeric } = require('./sql');
const sp = require('./amzSpApi');

const SECTION = 'Amazon Listing';

// A size's state, shown on screen one line each:
//   on_amazon        already in amzfeed — left alone
//   no_barcode       skumap.ean blank — nothing to find it by
//   not_in_catalogue no Amazon listing has this barcode — list by hand in Seller Central
//   ready            (check) Amazon validated the FBA offer
//   refused          Amazon said no — `message` is Amazon's reason
//   listed           (list) Amazon accepted it
const LISTABLE = 'ready';

const digits = (ean) => String(ean || '').replace(/^0+/, '');

function londonYymm(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: '2-digit', month: '2-digit' }).formatToParts(d);
  return p.find((x) => x.type === 'year').value + p.find((x) => x.type === 'month').value;
}
function londonDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d); // YYYY-MM-DD
}

class ListingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** The style, its RRP and every live size, each with its barcode, SKU-to-be and whether it's already in amzfeed. */
async function loadStyle(groupid) {
  const ss = await query(`SELECT brand, rrp, ${safeNumeric('rrp')} AS rrp_num FROM skusummary WHERE groupid = $1`, [groupid]);
  if (!ss.rows.length) throw new ListingError('NOT_FOUND', `${groupid} isn't a product`);
  const { rrp, rrp_num: rrpNum } = ss.rows[0];
  if (rrpNum === null || Number(rrpNum) <= 0) throw new ListingError('INVALID_RRP', `The RRP (${rrp || 'blank'}) isn't a price — Amazon is listed at the RRP`);

  const sizes = (await query(
    `SELECT m.code, NULLIF(TRIM(m.sku), '') AS sku, NULLIF(RTRIM(TRIM(m.ean), 'B'), '') AS ean, (f.code IS NOT NULL) AS on_amz
       FROM skumap m
       LEFT JOIN amzfeed f ON f.code = m.code
      WHERE m.groupid = $1 AND COALESCE(m.deleted, 0) = 0
      ORDER BY m.code`,
    [groupid]
  )).rows;
  if (!sizes.length) throw new ListingError('NO_SIZES', `${groupid} has no sizes`);

  const yymm = londonYymm();
  return {
    price: Math.round(Number(rrpNum) * 100) / 100,
    sizes: sizes.map((s) => ({
      code: s.code,
      ean: s.ean,
      sku: s.sku || `${s.code}-${yymm}`,
      state: s.on_amz ? 'on_amazon' : !s.ean ? 'no_barcode' : null,
      asin: null, productType: null, title: null, message: null,
    })),
  };
}

/** Fill asin / productType / title for every size still open, from Amazon's catalogue by barcode. */
async function findAsins(sizes) {
  const open = sizes.filter((s) => !s.state);
  const mkt = sp.marketplaceId();
  const byEan = new Map();
  for (let i = 0; i < open.length; i += 20) {
    if (i) await sp.sleep(600);
    const res = await sp.spGet('/catalog/2022-04-01/items', {
      identifiers: open.slice(i, i + 20).map((s) => s.ean), identifiersType: 'EAN', marketplaceIds: mkt,
      includedData: 'summaries,productTypes,identifiers', pageSize: 20,
    });
    for (const item of res.items || []) {
      const pt = ((item.productTypes || [])[0] || {}).productType;
      const title = ((item.summaries || [])[0] || {}).itemName || null;
      for (const g of item.identifiers || []) {
        for (const id of g.identifiers || []) {
          const key = digits(id.identifier);
          if (!byEan.has(key)) byEan.set(key, { asin: item.asin, productType: pt, title });
        }
      }
    }
  }
  for (const s of open) {
    const hit = byEan.get(digits(s.ean));
    if (!hit) { s.state = 'not_in_catalogue'; continue; }
    Object.assign(s, hit);
    if (!s.productType) { s.state = 'refused'; s.message = 'Amazon gives this listing no product type'; }
  }
}

function listingBody({ productType, asin, price }) {
  const mkt = sp.marketplaceId();
  return {
    productType,
    requirements: 'LISTING_OFFER_ONLY',
    attributes: {
      condition_type: [{ value: 'new_new', marketplace_id: mkt }],
      merchant_suggested_asin: [{ value: asin, marketplace_id: mkt }],
      purchasable_offer: [{ currency: 'GBP', marketplace_id: mkt, our_price: [{ schedule: [{ value_with_tax: price }] }] }],
      fulfillment_availability: [{ fulfillment_channel_code: 'AMAZON_EU' }],
      batteries_required: [{ value: false, marketplace_id: mkt }],
      supplier_declared_dg_hz_regulation: [{ value: 'not_applicable', marketplace_id: mkt }],
    },
  };
}

/** One putListingsItem. preview = Amazon validates only. Returns { ok, message }. */
async function putSize(s, price, preview) {
  const path = `/listings/2021-08-01/items/${encodeURIComponent(sp.sellerId())}/${encodeURIComponent(s.sku)}`;
  try {
    const res = await sp.spPut(path, listingBody({ productType: s.productType, asin: s.asin, price }), {
      marketplaceIds: sp.marketplaceId(), includedData: 'issues', ...(preview ? { mode: 'VALIDATION_PREVIEW' } : {}),
    });
    const errors = (res.issues || []).filter((i) => i.severity === 'ERROR');
    const ok = preview ? res.status === 'VALID' : res.status === 'ACCEPTED';
    return { ok, message: ok ? null : (errors.map((e) => e.message).join(' · ') || `Amazon answered ${res.status}`) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

async function run(groupid, { commit, who }) {
  sp.sellerId(); // throws "not configured" before anything is sent
  const { price, sizes } = await loadStyle(groupid);
  await findAsins(sizes);

  // In batches of 5 at once (putListingsItem allows ~5 a second): one at a time took ~3 s a size, past the screen's wait (2026-11-10).
  const open = sizes.filter((x) => !x.state);
  for (let i = 0; i < open.length; i += 5) {
    if (i) await sp.sleep(1000);
    await Promise.all(open.slice(i, i + 5).map(async (s) => {
      const r = await putSize(s, price, !commit);
      s.state = r.ok ? (commit ? 'listed' : LISTABLE) : 'refused';
      s.message = r.message;
    }));
  }

  const listed = sizes.filter((s) => s.state === 'listed');
  if (commit && listed.length) {
    const today = londonDate();
    await withTransaction(async (client) => {
      for (const s of listed) {
        await client.query(`UPDATE skumap SET sku = $1, status = '1', updated = $2 WHERE code = $3`, [s.sku, today, s.code]);
      }
      await writeBcLog(client, {
        who, section: SECTION,
        log: `Listed ${groupid} on Amazon as FBA at £${price.toFixed(2)}: ${listed.map((s) => s.code.slice(groupid.length + 1) || s.code).join(', ')}`,
      });
    });
  }

  const counts = {};
  for (const s of sizes) counts[s.state] = (counts[s.state] || 0) + 1;
  return { groupid, committed: Boolean(commit), price, sizes, counts };
}

/** Check: Amazon validates each size, nothing is created or written. */
const checkStyle = (groupid) => run(groupid, { commit: false });
/** List: real listings, then skumap stamped for the accepted sizes + a bclog row. */
const listStyle = (groupid, who) => run(groupid, { commit: true, who });

module.exports = { checkStyle, listStyle, ListingError };
