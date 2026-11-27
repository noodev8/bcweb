/*
=======================================================================================================================================
Script: supplier-amazon-scan — look up every supplier style we CAN GET on Amazon (owner, 2026-11-27)
=======================================================================================================================================
Usage:  node scripts/supplier-amazon-scan.js rieker            (dry run — scans, prints, writes nothing)
        node scripts/supplier-amazon-scan.js rieker --apply    (scans and replaces supplier_amazon for that supplier)

PDF FIRST (owner, 2026-11-27: "Start with what we can get and then see if it is worth it … thats what I will be doing"): instead of
searching Amazon and then asking the supplier, start from the supplier's stock list. Every style on it WITH stock that we don't stock
(no skusummary row) is looked up on Amazon by its code, and its best-ranked size is kept — overall Fashion rank, Buy Box, sellers —
for Prospects → Rieker list (routes/supplier-prospects.js). Run straight after "load the Rieker list" (scripts/supplier-stock-load.js).

HOW: one catalog search per style CODE (the 5-character base — its colours come back together), Rieker / Remonte brands only. A listing
belongs to a style when utils/supplierStock.js → candidates reads that base from it AND a colour on the list (or the base has only one
colour on the list). Then one offers batch per 20 found styles. Rates (utils/amzSpApi.js): catalog search 2/s (600 ms apart), offers
batch ~1 per 10 s (11 s apart, shared with the hourly Buy Box read — the util retries a 429). ~400 codes ≈ 5–10 minutes.
A style not found is still written (asin NULL) so the screen can list it as "not on Amazon".
migrations/20261127b_supplier_amazon.sql.
=======================================================================================================================================
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool, query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const sp = require('../utils/amzSpApi');
const { CATALOG_DATA, readItem, readOffers } = require('../utils/amzProspectRead');
const { candidates, BRAND_SUPPLIER } = require('../utils/supplierStock');

const SEARCH_WAIT_MS = 600;
const OFFERS_BATCH = 20;
const OFFERS_WAIT_MS = 11000;

async function main() {
  const supplier = process.argv[2];
  const apply = process.argv.includes('--apply');
  const brands = Object.keys(BRAND_SUPPLIER).filter((b) => BRAND_SUPPLIER[b] === supplier);
  if (!brands.length) throw new Error(`usage: node scripts/supplier-amazon-scan.js <${[...new Set(Object.values(BRAND_SUPPLIER))].join('|')}> [--apply]`);

  // The styles to look for: on the list, with stock, not ours.
  const { rows: styles } = await query(`
    SELECT st.style, split_part(st.style, '-', 1) AS base, split_part(st.style, '-', 2) AS colour, st.list_date::text AS list_date
      FROM supplier_stock st
     WHERE st.supplier = $1 AND st.sizes <> '{}'::jsonb
       AND NOT EXISTS (SELECT 1 FROM skusummary s WHERE s.groupid = st.style)
     ORDER BY st.style`, [supplier]);
  if (!styles.length) throw new Error('Nothing to scan — load the list first');
  const listDate = styles[0].list_date;
  const byBase = new Map();
  for (const s of styles) {
    if (!byBase.has(s.base)) byBase.set(s.base, []);
    byBase.get(s.base).push(s);
  }
  console.log(`[supplier-amazon-scan] ${supplier}: ${styles.length} styles (${byBase.size} codes) to look up`);

  // ---- 1. One catalog search per code; each style keeps its best-ranked size --------------------------------------------------------
  const best = new Map();   // style -> readItem row
  const rankOf = (i) => i.group_rank?.rank ?? Number.MAX_SAFE_INTEGER;
  let n = 0;
  let failed = 0;
  for (const [base, group] of byBase) {
    if (n++) await sp.sleep(SEARCH_WAIT_MS);
    if (n % 50 === 0) console.log(`  … ${n} / ${byBase.size} codes`);
    let found;
    try {
      found = await sp.spGet('/catalog/2022-04-01/items', {
        marketplaceIds: sp.marketplaceId(), keywords: base, brandNames: brands.join(','), includedData: CATALOG_DATA, pageSize: 20,
      });
    } catch (err) {
      failed += 1;
      console.log(`  ${base}: search failed — ${err.message}`);
      continue;
    }
    const colours = group.map((s) => s.colour);
    for (const it of (found.items || []).map(readItem)) {
      const c = candidates(it).find((x) => x.base === base);
      if (!c) continue;
      const colour = c.colours.find((x) => colours.includes(x)) || (colours.length === 1 ? colours[0] : null);
      if (!colour) continue;   // the base has several colours on the list and this listing's can't be told — don't guess
      const style = `${base}-${colour}`;
      if (!best.has(style) || rankOf(it) < rankOf(best.get(style))) best.set(style, it);
    }
  }
  console.log(`  found on Amazon: ${best.size} of ${styles.length} styles${failed ? ` (${failed} searches failed)` : ''}`);

  // ---- 2. Offers for each style's kept size, 20 a batch -----------------------------------------------------------------------------
  const asins = [...best.values()].map((i) => i.asin);
  const offerBy = new Map();
  for (let i = 0; i < asins.length; i += OFFERS_BATCH) {
    if (i) await sp.sleep(OFFERS_WAIT_MS);
    const part = asins.slice(i, i + OFFERS_BATCH);
    try {
      const res = await sp.spPost('/batches/products/pricing/v0/itemOffers', {
        requests: part.map((asin) => ({ uri: `/products/pricing/v0/items/${asin}/offers`, method: 'GET', MarketplaceId: sp.marketplaceId(), ItemCondition: 'New' })),
      });
      for (const r of res?.responses || []) {
        const p = r.body?.payload;
        if (p?.ASIN) offerBy.set(p.ASIN, readOffers(p.Summary));
      }
    } catch (err) {
      console.log(`  offers batch ${i / OFFERS_BATCH + 1} failed — ${err.message} (those styles keep rank only)`);
    }
  }

  const out = styles.map((s) => {
    const it = best.get(s.style);
    const o = it ? offerBy.get(it.asin) || readOffers(null) : readOffers(null);
    return {
      style: s.style, asin: it?.asin ?? null, title: it?.title?.slice(0, 500) ?? null,
      group_rank: it?.group_rank?.rank ?? null, rank_category: it?.group_rank?.category ?? null, size: it?.size ?? null, ...o,
    };
  });
  const ranked = out.filter((r) => r.group_rank !== null).sort((a, b) => a.group_rank - b.group_rank);
  console.log(`  ranked: ${ranked.length}. Best 10:`);
  for (const r of ranked.slice(0, 10)) console.log(`    ${r.style}  #${r.group_rank.toLocaleString('en-GB')}  £${r.buybox ?? r.lowest ?? '-'}  ${r.fba ?? '-'} FBA · ${r.fbm ?? '-'} FBM  ${(r.title || '').slice(0, 60)}`);

  if (!apply) { console.log('  DRY RUN — add --apply to store it'); return; }
  await withTransaction(async (client) => {
    await client.query('DELETE FROM supplier_amazon WHERE supplier = $1', [supplier]);
    await client.query(`
      INSERT INTO supplier_amazon (supplier, style, asin, title, group_rank, rank_category, size, buybox, lowest, fba, fbm, list_date)
      SELECT $1, x.style, x.asin, x.title, x.group_rank, x.rank_category, x.size, x.buybox, x.lowest, x.fba, x.fbm, $12::date
        FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[], $8::numeric[], $9::numeric[], $10::int[], $11::int[])
             AS x(style, asin, title, group_rank, rank_category, size, buybox, lowest, fba, fbm)`,
    [supplier, out.map((r) => r.style), out.map((r) => r.asin), out.map((r) => r.title), out.map((r) => r.group_rank),
      out.map((r) => r.rank_category), out.map((r) => r.size), out.map((r) => r.buybox), out.map((r) => r.lowest),
      out.map((r) => r.fba), out.map((r) => r.fbm), listDate]);
  });
  console.log('  APPLIED');
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error('[supplier-amazon-scan] FAILED:', err.message); pool.end().finally(() => process.exit(1)); });
