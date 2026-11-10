/*
=======================================================================================================================================
Script: scripts/amz-listing-probe.js   — READ ONLY probe for "List on Amazon (FBA)" (2026-11-10)
=======================================================================================================================================
Purpose: Before building the button that lists a style on Amazon as FBA through the SP-API (instead of the AMZ-Upload.xlsm file), see
         Amazon's REAL replies (memory: build against a real response, not the spec). Owner decisions for the button: price = RRP, every
         size on Add / Modify that has a barcode (and isn't on Amazon yet), one style per press, amzfeed left to the stock sync, the
         .xlsm button kept as a fallback beside a NEW button.

What it does — nothing is written, to the DB or to Amazon:
  1. The style's sizes (skumap, deleted = 0) with barcode, and which are already in amzfeed.
  2. Catalog Items searchCatalogItems by EAN → the ASIN + Amazon's product type for each size (no ASIN = not on Amazon's catalogue).
  3. Whether the FBA inventory read (what amzStockSync uses) returns SKUs holding 0 — the button relies on the stock sync adding the
     new SKU to amzfeed before any stock arrives.
  4. With AMZ_SP_SELLER_ID set: getListingsItem on one of our live FBA SKUs (the real shape of fulfillment_availability / fnSku), and
     putListingsItem in mode=VALIDATION_PREVIEW for the FIRST listable size — Amazon checks the offer-only FBA listing, creates nothing.

Usage (from bcweb-server/):
  node scripts/amz-listing-probe.js <GROUPID> [--raw]      --raw prints Amazon's full JSON replies
=======================================================================================================================================
*/

require('dotenv').config();
const { query, pool } = require('../database');
const sp = require('../utils/amzSpApi');

const raw = process.argv.includes('--raw');
const groupid = (process.argv.slice(2).find((a) => !a.startsWith('--')) || '').trim().toUpperCase();
const show = (label, obj) => { if (raw) console.log(`\n--- ${label} ---\n${JSON.stringify(obj, null, 2)}`); };

async function main() {
  if (!groupid) throw new Error('Usage: node scripts/amz-listing-probe.js <GROUPID> [--raw]');
  const mkt = sp.marketplaceId();

  // 1. The style and its sizes
  const ss = await query(`SELECT brand, rrp FROM skusummary WHERE groupid = $1`, [groupid]);
  if (!ss.rows.length) throw new Error(`${groupid} not in skusummary`);
  const { brand, rrp } = ss.rows[0];
  const sizes = (await query(
    `SELECT m.code, m.sku, RTRIM(m.ean, 'B') AS ean, (f.code IS NOT NULL) AS on_amz
       FROM skumap m LEFT JOIN amzfeed f ON f.code = m.code
      WHERE m.groupid = $1 AND COALESCE(m.deleted, 0) = 0
      ORDER BY m.code`, [groupid])).rows;
  console.log(`${groupid} · brand ${brand} · RRP ${rrp} · ${sizes.length} sizes`);

  // 2. ASIN by barcode — searchCatalogItems takes up to 20 identifiers a call (~2 calls a second)
  const eans = sizes.filter((s) => s.ean && !s.on_amz).map((s) => s.ean);
  const byEan = new Map();
  for (let i = 0; i < eans.length; i += 20) {
    const res = await sp.spGet('/catalog/2022-04-01/items', {
      identifiers: eans.slice(i, i + 20), identifiersType: 'EAN', marketplaceIds: mkt,
      includedData: 'summaries,productTypes,identifiers', pageSize: 20,
    });
    show(`searchCatalogItems ${i}`, res);
    for (const item of res.items || []) {
      const ids = (item.identifiers || []).flatMap((g) => g.identifiers || []);
      const pt = ((item.productTypes || [])[0] || {}).productType;
      const title = ((item.summaries || [])[0] || {}).itemName;
      for (const id of ids) if (['EAN', 'GTIN', 'UPC'].includes(id.identifierType)) byEan.set(id.identifier.replace(/^0+/, ''), { asin: item.asin, pt, title });
    }
    await sp.sleep(600);
  }
  console.log('\nSize                 Barcode         State');
  for (const s of sizes) {
    const hit = s.ean && byEan.get(s.ean.replace(/^0+/, ''));
    const state = s.on_amz ? 'already on Amazon (amzfeed)'
      : !s.ean ? 'no barcode'
      : hit ? `ASIN ${hit.asin} · ${hit.pt} · ${(hit.title || '').slice(0, 50)}`
      : 'NOT on Amazon catalogue';
    console.log(`${s.code.padEnd(20)} ${(s.ean || '-').padEnd(15)} ${state}`);
  }

  // 3. Does the FBA inventory read return SKUs holding 0?
  const zero = (await query(`SELECT sku FROM amzfeed WHERE COALESCE(amztotal,0) = 0 AND sku IS NOT NULL AND sku <> '' LIMIT 20`)).rows.map((r) => r.sku);
  if (zero.length) {
    const inv = await sp.spGet('/fba/inventory/v1/summaries', {
      details: 'true', granularityType: 'Marketplace', granularityId: mkt, marketplaceIds: mkt, sellerSkus: zero,
    });
    show('getInventorySummaries (0-stock SKUs)', inv);
    const got = (inv.payload && inv.payload.inventorySummaries) || [];
    console.log(`\nFBA inventory read: asked for ${zero.length} SKUs holding 0 in amzfeed, Amazon returned ${got.length}` +
      (got.length ? ` (e.g. ${got[0].sellerSku} total ${got[0].totalQuantity}, fnSku ${got[0].fnSku})` : ''));
  }

  // 4. Listings API — needs the seller id
  let seller;
  try { seller = sp.sellerId(); } catch (e) { console.log(`\nListings checks skipped: ${e.message}`); return; }

  const live = (await query(`SELECT sku FROM amzfeed WHERE amzlive > 0 AND sku IS NOT NULL AND sku <> '' LIMIT 1`)).rows[0];
  if (live) {
    const item = await sp.spGet(`/listings/2021-08-01/items/${encodeURIComponent(seller)}/${encodeURIComponent(live.sku)}`, {
      marketplaceIds: mkt, includedData: 'summaries,attributes,fulfillmentAvailability,offers,issues',
    });
    console.log(`\nOne of our live FBA SKUs (${live.sku}): fulfillmentAvailability ${JSON.stringify(item.fulfillmentAvailability)}` +
      ` · fnSku ${((item.summaries || [])[0] || {}).fnSku}`);
    show('getListingsItem (live FBA SKU)', item);
  }

  const first = sizes.find((s) => !s.on_amz && s.ean && byEan.get(s.ean.replace(/^0+/, '')));
  if (!first) { console.log('\nNo listable size to validate.'); return; }
  const hit = byEan.get(first.ean.replace(/^0+/, ''));
  const yymm = new Date().toISOString().slice(2, 4) + new Date().toISOString().slice(5, 7);
  const sku = (first.sku && first.sku.trim()) || `${first.code}-${yymm}`;
  const price = Number(rrp);
  const body = {
    productType: hit.pt || 'SHOES',
    requirements: 'LISTING_OFFER_ONLY',
    attributes: {
      condition_type: [{ value: 'new_new', marketplace_id: mkt }],
      merchant_suggested_asin: [{ value: hit.asin, marketplace_id: mkt }],
      purchasable_offer: [{ currency: 'GBP', marketplace_id: mkt, our_price: [{ schedule: [{ value_with_tax: price }] }] }],
      supplier_declared_dg_hz_regulation: [{ value: 'not_applicable', marketplace_id: mkt }],
      fulfillment_availability: [{ fulfillment_channel_code: 'AMAZON_EU' }],
      batteries_required: [{ value: false, marketplace_id: mkt }],
    },
  };
  show('putListingsItem body', body);
  const res = await sp.spPut(`/listings/2021-08-01/items/${encodeURIComponent(seller)}/${encodeURIComponent(sku)}`, body, {
    marketplaceIds: mkt, mode: 'VALIDATION_PREVIEW', includedData: 'issues',
  });
  console.log(`\nVALIDATION_PREVIEW ${first.code} as SKU ${sku} on ${hit.asin}: ${res.status}`);
  for (const i of res.issues || []) console.log(`  ${i.severity} ${i.code}: ${i.message}${i.attributeNames ? ` [${i.attributeNames.join(', ')}]` : ''}`);
  show('putListingsItem reply', res);
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => pool.end && pool.end());
