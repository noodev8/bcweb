/*
=======================================================================================================================================
Script: scripts/amz-sp-test.js   (READ ONLY — reads Amazon and the DB, writes NOTHING anywhere)
=======================================================================================================================================
Purpose: Prove the SP-API connection (2026-11-09) before anything is built on it: log in with the LWA keys in .env, pull today's FBA
inventory for the UK marketplace (FBA Inventory API v1, getInventorySummaries), and compare it with our `amzfeed` — the table the
manual Update Amazon import fills from Seller Central's FBA Inventory report.

What it prints: counts only, plus a handful of example SKUs where Amazon and amzfeed differ. Never a key or token.
  live     = fulfillableQuantity                        (amzfeed.amzlive)
  total    = Amazon's totalQuantity                     (amzfeed.amztotal — includes inbound + reserved)
Differences are EXPECTED if Update Amazon hasn't run today (amzfeed is as of the last import); the point is that the numbers line up.

Usage (from bcweb-server/):
    node scripts/amz-sp-test.js                 full inventory vs amzfeed (~2.5 min: 10,604 SKUs at 50 a page)
    node scripts/amz-sp-test.js --speed=24      TIMING ONLY: inventory CHANGED in the last 24h (startDateTime) + orders updated in 24h
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool, query } = require('../database');
const sp = require('../utils/amzSpApi');

async function fetchInventory(startDateTime) {
  const rows = [];
  let nextToken;
  let page = 0;
  do {
    const q = {
      details: 'true',
      granularityType: 'Marketplace',
      granularityId: sp.marketplaceId(),
      marketplaceIds: sp.marketplaceId(),
    };
    if (startDateTime) q.startDateTime = startDateTime; // only SKUs whose inventory changed since then
    if (nextToken) q.nextToken = nextToken;
    const res = await sp.spGet('/fba/inventory/v1/summaries', q);
    const list = (res && res.payload && res.payload.inventorySummaries) || [];
    rows.push(...list);
    nextToken = res && res.pagination && res.pagination.nextToken;
    page += 1;
    process.stdout.write(`\r  page ${page}: ${rows.length} SKUs`);
    if (nextToken) await sp.sleep(600); // rate limit ~2 requests/second
  } while (nextToken);
  process.stdout.write('\n');
  return rows;
}

async function speedTest(hours) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  let t = Date.now();
  await sp.accessToken();
  console.log(`login: ${((Date.now() - t) / 1000).toFixed(1)}s`);

  t = Date.now();
  const inv = await fetchInventory(since);
  const changed = inv.filter((r) => Number(r.totalQuantity || 0) > 0).length;
  console.log(`inventory changed in ${hours}h: ${inv.length} SKUs (${changed} with stock) in ${((Date.now() - t) / 1000).toFixed(1)}s`);

  t = Date.now();
  let orders = [];
  let next;
  let pages = 0;
  do {
    const q = next ? { MarketplaceIds: sp.marketplaceId(), NextToken: next } : { MarketplaceIds: sp.marketplaceId(), LastUpdatedAfter: since };
    const res = await sp.spGet('/orders/v0/orders', q);
    const p = (res && res.payload) || {};
    orders = orders.concat(p.Orders || []);
    next = p.NextToken;
    pages += 1;
    if (next) await sp.sleep(1100);
  } while (next);
  const byStatus = {};
  for (const o of orders) byStatus[o.OrderStatus] = (byStatus[o.OrderStatus] || 0) + 1;
  console.log(`orders updated in ${hours}h: ${orders.length} (${JSON.stringify(byStatus)}) in ${((Date.now() - t) / 1000).toFixed(1)}s, ${pages} page(s)`);
}

(async () => {
  const speedArg = process.argv.find((a) => a.startsWith('--speed'));
  if (speedArg) {
    try { await speedTest(Number(speedArg.split('=')[1] || 24)); }
    catch (err) { console.error('FAILED:', err.message); process.exitCode = 1; }
    finally { await pool.end(); }
    return;
  }
  try {
    console.log('1. Logging in to Amazon (LWA)…');
    await sp.accessToken();
    console.log('   OK — access token received.');

    console.log('2. Reading FBA inventory (UK)…');
    const inv = await fetchInventory();
    const amz = new Map();
    for (const r of inv) {
      const d = r.inventoryDetails || {};
      amz.set(String(r.sellerSku).trim(), {
        asin: r.asin,
        live: Number(d.fulfillableQuantity || 0),
        total: Number(r.totalQuantity || 0),
      });
    }
    const withStock = [...amz.values()].filter((v) => v.total > 0).length;
    console.log(`   ${amz.size} SKUs from Amazon, ${withStock} with stock (live or on the way).`);

    console.log('3. Comparing with amzfeed…');
    const { rows: feed } = await query(
      `SELECT TRIM(sku) AS sku, code, COALESCE(amzlive,0)::int AS live, COALESCE(amztotal,0)::int AS total FROM amzfeed`
    );
    let matched = 0, sameLive = 0, sameTotal = 0;
    const diffs = [];
    const feedSkus = new Set();
    for (const f of feed) {
      feedSkus.add(f.sku);
      const a = amz.get(f.sku);
      if (!a) continue;
      matched += 1;
      if (a.live === f.live) sameLive += 1;
      if (a.total === f.total) sameTotal += 1;
      if (a.live !== f.live || a.total !== f.total) diffs.push({ code: f.code, feed: `${f.live}/${f.total}`, amazon: `${a.live}/${a.total}` });
    }
    const onlyAmazon = [...amz.keys()].filter((s) => !feedSkus.has(s));
    console.log(`   amzfeed rows: ${feed.length} · matched by SKU: ${matched}`);
    console.log(`   same live: ${sameLive} · same total: ${sameTotal} · differ: ${diffs.length}`);
    console.log(`   on Amazon but not in amzfeed: ${onlyAmazon.length}`);
    if (diffs.length) {
      console.log('   examples (live/total — amzfeed vs Amazon now):');
      for (const d of diffs.slice(0, 10)) console.log(`     ${d.code.padEnd(28)} ${d.feed.padStart(7)}  →  ${d.amazon}`);
    }
    console.log('\nConnection works. Nothing was written.');
  } catch (err) {
    console.error('\nFAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
