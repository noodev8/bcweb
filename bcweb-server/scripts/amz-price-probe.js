/*
=======================================================================================================================================
Script: scripts/amz-price-probe.js   — probe for the LIVE Amazon price push (2026-11-11, step 0)
=======================================================================================================================================
Purpose: Before building "Apply sends the price to Amazon" (instead of the Seller Central upload file), see Amazon's REAL replies
         (memory: build against a real response, not the spec):
           - what a SKU's offer looks like (purchasable_offer: our_price, any Sale price / discounted_price, min/max seller price,
             a B2B entry) — so the push changes ONLY our_price and keeps everything else on the offer as it is;
           - the product type the PATCH must name;
           - Amazon's answer to the price change in VALIDATION_PREVIEW (checked, nothing changed).

Default = READ ONLY: nothing is written to the DB, and Amazon is only asked to CHECK the change.
--live sends the change for real (the one agreed test: a size the owner picks, then put back) — needs --price.

Usage (from bcweb-server/):
  node scripts/amz-price-probe.js <CODE> [--price 39.99] [--raw]          check only (price defaults to the current one)
  node scripts/amz-price-probe.js <CODE> --price 39.99 --live             REALLY changes the price on Amazon
=======================================================================================================================================
*/

require('dotenv').config();
const { query, pool } = require('../database');
const sp = require('../utils/amzSpApi');

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const live = args.includes('--live');
const priceArg = (() => { const i = args.indexOf('--price'); return i >= 0 ? Number(args[i + 1]) : null; })();
const code = (args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--price') || '').trim();
const show = (label, obj) => { if (raw) console.log(`\n--- ${label} ---\n${JSON.stringify(obj, null, 2)}`); };

async function main() {
  if (!code) throw new Error('Usage: node scripts/amz-price-probe.js <CODE> [--price 39.99] [--raw] [--live]');
  if (live && !(priceArg > 0)) throw new Error('--live needs --price');
  const mkt = sp.marketplaceId();

  const row = (await query(`SELECT code, sku, amzprice, amzlive, amztotal FROM amzfeed WHERE code = $1`, [code])).rows[0];
  if (!row || !row.sku) throw new Error(`${code} not in amzfeed (or no Amazon SKU)`);
  console.log(`${code} · Amazon SKU ${row.sku} · amzfeed price ${row.amzprice} · FBA live ${row.amzlive} / total ${row.amztotal}`);

  // 1. The listing as Amazon holds it
  const path = `/listings/2021-08-01/items/${encodeURIComponent(sp.sellerId())}/${encodeURIComponent(row.sku)}`;
  const item = await sp.spGet(path, { marketplaceIds: mkt, includedData: 'summaries,attributes,offers,issues' });
  show('getListingsItem', item);
  const summary = (item.summaries || [])[0] || {};
  const offers = (item.attributes && item.attributes.purchasable_offer) || [];
  console.log(`\nProduct type: ${summary.productType} · ASIN ${summary.asin} · status ${(summary.status || []).join(', ')}`);
  console.log(`purchasable_offer entries: ${offers.length}`);
  offers.forEach((o, i) => console.log(`  [${i}] ${JSON.stringify(o)}`));
  console.log(`offers (Amazon's view): ${JSON.stringify(item.offers || [])}`);
  if ((item.issues || []).length) console.log(`issues: ${JSON.stringify(item.issues)}`);

  // 2. The patch: the existing offer entries kept as they are, only our_price changed on the consumer (non-B2B) entry.
  const current = offers.find((o) => !o.audience || o.audience === 'ALL');
  const nowPrice = current && current.our_price && current.our_price[0] && current.our_price[0].schedule && current.our_price[0].schedule[0]
    ? current.our_price[0].schedule[0].value_with_tax : null;
  const price = priceArg > 0 ? Math.round(priceArg * 100) / 100 : nowPrice;
  if (!(price > 0)) throw new Error('No current our_price found — pass --price');
  const value = offers.length
    ? offers.map((o) => (o === current ? { ...o, our_price: [{ schedule: [{ value_with_tax: price }] }] } : o))
    : [{ marketplace_id: mkt, currency: 'GBP', our_price: [{ schedule: [{ value_with_tax: price }] }] }];
  const body = { productType: summary.productType, patches: [{ op: 'replace', path: '/attributes/purchasable_offer', value }] };
  show('patch body', body);

  console.log(`\n${live ? 'LIVE' : 'Check (VALIDATION_PREVIEW)'}: our_price ${nowPrice} -> ${price}`);
  const res = await sp.spPatch(path, body, live ? { marketplaceIds: mkt } : { marketplaceIds: mkt, mode: 'VALIDATION_PREVIEW' });
  show('patchListingsItem reply', res);
  console.log(`Amazon: ${res.status} · submission ${res.submissionId || '-'}`);
  (res.issues || []).forEach((x) => console.log(`  ${x.severity} ${x.code}: ${x.message}`));
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
