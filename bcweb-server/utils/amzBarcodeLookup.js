/*
=======================================================================================================================================
Util: amzBarcodeLookup  (look a size up in Amazon's catalogue by its BARCODE — owner 2026-11-15, the Clearance screen)
=======================================================================================================================================
Purpose: For a Clearance size that isn't selling on Amazon, find out if Amazon has the product at all and how it ranks — so the owner
         can judge whether it's worth sending to FBA (owner: "I'm wondering why they are not on Amazon and I will check ranking").
         We don't need our own ASIN: Amazon's catalogue holds a product if ANYONE sells it, and the barcode finds it (the same search
         List on Amazon uses — utils/amzListing.js → findAsins). The ASIN is the answer, not the input.

AT THE OWNER'S REQUEST ONLY (owner: "at my request rather than slowing the screen down"): a button, never on page load.
         STORES NOTHING — the answer is shown for the visit.

RANK = THE Buy Box's reading (utils/amzBuyBox.js → fashionRank): the Fashion Best Sellers Rank; 0 = Amazon gave no rank (usually not
         selling); null = not found / the call failed.

Rate limit: searchCatalogItems ~2 a second, 20 barcodes a call — a 600ms gap, as the Buy Box and List on Amazon.
=======================================================================================================================================
Exports:
  lookupCodes(codes) -> { results: [{ code, ean, found, asin, title, rank }], failed: number }   // failed = batches Amazon refused
=======================================================================================================================================
*/

const { query } = require('../database');
const sp = require('./amzSpApi');
const { fashionRank } = require('./amzBuyBox');
const logger = require('./logger');

const BATCH = 20;
const WAIT_MS = 600;
const digits = (ean) => String(ean || '').replace(/^0+/, '');

async function lookupCodes(codes) {
  const r = await query(
    `SELECT code, MAX(NULLIF(regexp_replace(TRIM(COALESCE(ean, '')), 'B$', ''), '')) AS ean
       FROM skumap WHERE code = ANY($1::text[]) GROUP BY code`, [codes]);
  const sizes = r.rows.map((x) => ({ code: x.code, ean: x.ean || null }));
  const withEan = sizes.filter((s) => s.ean);
  const mkt = sp.marketplaceId();
  const byEan = new Map();
  const failedEans = new Set();
  let failed = 0;

  for (let i = 0; i < withEan.length; i += BATCH) {
    if (i) await sp.sleep(WAIT_MS);
    const part = withEan.slice(i, i + BATCH);
    try {
      const res = await sp.spGet('/catalog/2022-04-01/items', {
        identifiers: part.map((s) => s.ean), identifiersType: 'EAN', marketplaceIds: mkt,
        includedData: 'summaries,identifiers,salesRanks', pageSize: BATCH,
      });
      for (const item of res.items || []) {
        const hit = { asin: item.asin, title: ((item.summaries || [])[0] || {}).itemName || null, rank: fashionRank(item, mkt) ?? 0 };
        for (const g of item.identifiers || []) {
          for (const id of g.identifiers || []) {
            const key = digits(id.identifier);
            if (!byEan.has(key)) byEan.set(key, hit);
          }
        }
      }
    } catch (e) {
      failed += 1;
      part.forEach((s) => failedEans.add(s.ean));
      logger.error(`amzBarcodeLookup: batch failed: ${e.message}`);
    }
  }

  const results = sizes.map((s) => {
    const hit = s.ean ? byEan.get(digits(s.ean)) : null;
    if (hit) return { code: s.code, ean: s.ean, found: true, asin: hit.asin, title: hit.title, rank: hit.rank };
    // found: false = Amazon has no product with this barcode; null = we couldn't ask (no barcode, or the call failed).
    const unknown = !s.ean || failedEans.has(s.ean);
    return { code: s.code, ean: s.ean, found: unknown ? null : false, asin: null, title: null, rank: null };
  });
  return { results, failed };
}

module.exports = { lookupCodes };
