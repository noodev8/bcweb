/*
=======================================================================================================================================
Script: scripts/amz-buybox-probe.js   — READ-ONLY look at the Buy Box on our Amazon sizes (2026-11-12, docs/amz-buybox/PLAN.md step 1)
=======================================================================================================================================
Purpose: Answer the question the whole Buy Box plan hangs on — HOW MANY OF OUR SIZES HAVE A RIVAL AT ALL? — and see Amazon's REAL
         replies before designing anything (build against a real response, not the spec). For each size it prints: who holds the
         Buy Box (us / another FBA seller / a self-posting seller / Amazon Retail / nobody), its price, how many other offers there
         are, the price Amazon expects would win the Buy Box for OUR offer (featured offer expected price), our profit a pair at that
         price, and the £3 walk-away price — then the group the plan would put it in. It also checks two open questions from the plan:
         does Amazon Retail ever sell our sizes, and does a per-SKU "average selling price" come back in the reference prices?

READ ONLY: nothing is written to the DB and nothing is sent to Amazon except reads.

Three Product Pricing calls (role "Pricing", already on the app), batched, paced for Amazon's limits (~1 batch per 30 s for the two
2022-05-01 calls, ~1 per 10 s for itemOffers — a 429 is retried inside amzSpApi):
  - getFeaturedOfferExpectedPriceBatch  by SKU, up to 40 a batch — the winning price for OUR offer
  - getItemOffersBatch (v0)             by ASIN, up to 20 a batch — every offer (seller id, FBA?, price, Buy Box winner)
  - getCompetitiveSummaryBatch          by ASIN, up to 20 a batch — featured offer, lowest offers, reference prices

Which sizes (default --top 30):
  --top N            the N in-stock Amazon sizes (FBA live + inbound) with the most net pairs sold in 30 days
  <GROUPID|CODE>...  every Amazon size of those styles / those sizes (e.g. IVES-WHITE  X9165-00-38)

Usage (from bcweb-server/):
  node scripts/amz-buybox-probe.js                   top 30 sellers
  node scripts/amz-buybox-probe.js IVES-WHITE        one style
  node scripts/amz-buybox-probe.js --top 40 --raw    + Amazon's raw replies (first batch of each call)
=======================================================================================================================================
*/

require('dotenv').config();
const { query, pool } = require('../database');
const sp = require('../utils/amzSpApi');
const { amzProfit, priceForProfit } = require('../utils/amzProfit');
const { SETTINGS } = require('../utils/amzPricingStandard');
const { safeNumeric } = require('../utils/sql');

const AMAZON_RETAIL_UK = 'A3P5ROKL5A1OLE'; // Amazon's own seller id on amazon.co.uk

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const topN = (() => { const i = args.indexOf('--top'); return i >= 0 ? Number(args[i + 1]) : null; })();
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--top');
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const money = (m) => (m && m.amount !== undefined ? Number(m.amount) : (m && m.Amount !== undefined ? Number(m.Amount) : null));
const fmt = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(2));
let printed = new Set();
const show = (label, obj) => { if (raw && !printed.has(label)) { printed.add(label); console.log(`\n--- ${label} (raw) ---\n${JSON.stringify(obj, null, 2)}`); } };

async function pickSizes() {
  const base = `SELECT a.code, a.sku, a.asin, a.fbafee, ${safeNumeric('a.amzprice')} AS price,
                       COALESCE(a.amzlive,0)::int AS live, COALESCE(a.amztotal,0)::int AS total,
                       sk.cost, sk.tax, ${safeNumeric('sk.rrp')} AS rrp,
                       COALESCE((SELECT SUM(s.qty) FROM sales s WHERE s.channel = 'AMZ' AND s.code = a.code
                                  AND s.solddate >= CURRENT_DATE - 30), 0)::int AS sold30
                FROM amzfeed a JOIN skumap m ON m.code = a.code LEFT JOIN skusummary sk ON sk.groupid = m.groupid
                WHERE a.sku IS NOT NULL AND a.asin IS NOT NULL`;
  if (names.length) {
    const r = await query(`${base} AND (a.code = ANY($1) OR m.groupid = ANY($1)) ORDER BY a.code`, [names]);
    return [...new Map(r.rows.map((x) => [x.code, x])).values()];
  }
  const r = await query(`${base} AND COALESCE(a.amztotal,0) > 0 ORDER BY sold30 DESC, a.code LIMIT $1`, [topN || 30]);
  return r.rows;
}

// One batch call, with the wait Amazon's rate wants before the next.
async function batch(path, requests, waitMs) {
  const res = await sp.spPost(path, { requests });
  await sp.sleep(waitMs);
  return res.responses || [];
}

async function main() {
  const mkt = sp.marketplaceId();
  let me = (process.env.AMZ_SP_SELLER_ID || '').trim() || null; // else learnt from the expected-price replies (our offer's seller id)
  const sizes = await pickSizes();
  if (!sizes.length) throw new Error('No Amazon sizes found for that choice');
  const asins = [...new Set(sizes.map((s) => s.asin))];
  console.log(`${sizes.length} sizes, ${asins.length} ASINs. Reading Amazon (about ${Math.ceil(sizes.length / 40) * 30 + Math.ceil(asins.length / 20) * 40}s)…`);

  // 1. Featured offer expected price — by SKU, for our own offer.
  const foep = new Map();
  for (const part of chunk(sizes, 40)) {
    const resp = await batch('/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice',
      part.map((s) => ({ uri: '/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice', method: 'GET', marketplaceId: mkt, sku: s.sku })),
      31000);
    show('featuredOfferExpectedPrice', resp[0]);
    resp.forEach((r, i) => foep.set(part[i].sku, r));
  }
  if (!me) {
    for (const r of foep.values()) {
      const sid = r && r.body && r.body.offerIdentifier && r.body.offerIdentifier.sellerId;
      if (sid) { me = sid; break; }
    }
  }
  console.log(`Our seller id: ${me ? 'found' : 'NOT FOUND — "US" cannot be told apart'}`);

  // 2. Every offer on each ASIN.
  const offers = new Map();
  for (const part of chunk(asins, 20)) {
    const resp = await batch('/batches/products/pricing/v0/itemOffers',
      part.map((asin) => ({ uri: `/products/pricing/v0/items/${asin}/offers`, method: 'GET', MarketplaceId: mkt, ItemCondition: 'New', CustomerType: 'Consumer' })),
      11000);
    show('itemOffers', resp[0]);
    resp.forEach((r, i) => offers.set(part[i], r));
  }

  // 3. Competitive summary — mainly for the reference prices (is there a per-ASIN average selling price?).
  const summary = new Map();
  for (const part of chunk(asins, 20)) {
    const resp = await batch('/batches/products/pricing/2022-05-01/items/competitiveSummary',
      part.map((asin) => ({
        uri: '/products/pricing/2022-05-01/items/competitiveSummary', method: 'GET', asin, marketplaceId: mkt,
        includedData: ['featuredBuyingOptions', 'referencePrices', 'lowestPricedOffers'],
        lowestPricedOffersInputs: [{ itemCondition: 'New', offerType: 'Consumer' }],
      })),
      31000);
    show('competitiveSummary', resp[0]);
    resp.forEach((r, i) => summary.set(part[i], r));
  }

  const refNames = new Set();
  const counts = {};
  const rows = sizes.map((s) => {
    const f = foep.get(s.sku);
    const fb = f && f.body ? f.body : {};
    const fr = (fb.featuredOfferExpectedPriceResults || [])[0] || {};
    // Amazon's "featured offer expected price". SHOWN, NOT USED AS A TARGET (found 2026-11-12): it came back £34.19 on IVES-WHITE-03
    // where we already held the Buy Box at £39.79, and the same figure on several sizes with different rivals — a "sure to win"
    // price well under what actually wins. The match target is the real Buy Box price below.
    const foepPrice = money(fr.featuredOfferExpectedPrice && fr.featuredOfferExpectedPrice.listingPrice);
    const foepStatus = fr.resultStatus || (f && f.status && f.status.statusCode !== 200 ? `HTTP ${f.status.statusCode}` : '—');

    const o = offers.get(s.asin);
    const payload = o && o.body && o.body.payload ? o.body.payload : {};
    const list = payload.Offers || [];
    const landed = (x) => (money(x.ListingPrice) || 0) + (money(x.Shipping) || 0);
    // More than one offer can be a Buy Box winner at once: Amazon splits the featured offer by customer (Prime / non-Prime /
    // postcode — competitiveSummary's featuredOfferSegments). Seen on IVES-WHITE-06: a self-poster at £31.44 + £4.95 AND another at
    // our price, both winners.
    const winners = list.filter((x) => x.IsBuyBoxWinner);
    const ours = list.find((x) => x.SellerId === me);
    const others = list.filter((x) => x.SellerId !== me);
    const usWin = winners.some((x) => x.SellerId === me);
    const rivalWinners = winners.filter((x) => x.SellerId !== me);
    const ourPrice = ours ? landed(ours) : s.price;
    let holder = 'nobody';
    if (usWin) holder = rivalWinners.length ? 'US + shared' : 'US';
    else if (rivalWinners.length) {
      const w = rivalWinners.reduce((a, b) => (landed(a) <= landed(b) ? a : b));
      holder = w.SellerId === AMAZON_RETAIL_UK ? 'AMAZON' : w.IsFulfilledByAmazon ? 'other FBA' : 'other self-post';
    }
    // The price to match when losing = the cheapest rival Buy Box winner, postage included. When holding: the cheapest rival above us.
    const rivalBB = rivalWinners.length ? Math.min(...rivalWinners.map(landed)) : null;
    const above = others.map(landed).filter((p) => ourPrice !== null && p > ourPrice + 0.005);
    const nextUp = above.length ? Math.min(...above) : null;
    const amazonRetail = list.some((x) => x.SellerId === AMAZON_RETAIL_UK);
    const atOurPrice = ourPrice !== null && others.some((x) => Math.abs(landed(x) - ourPrice) < 0.005);

    const cs = summary.get(s.asin);
    const refs = {};
    for (const ref of (cs && cs.body && cs.body.referencePrices) || []) { refNames.add(ref.name); refs[ref.name] = money(ref.price); }

    const walk = priceForProfit({ cost: s.cost, fbafee: s.fbafee, tax: s.tax }, SETTINGS.WALK_AWAY_PROFIT);
    const target = usWin ? null : rivalBB;
    const keptAtTarget = target === null ? null : amzProfit({ price: target, cost: s.cost, fbafee: s.fbafee, tax: s.tax }).profit;

    let group;
    if (!others.length) group = 'Alone';
    else if (usWin) group = nextUp !== null && nextUp > ourPrice * 1.02 ? 'Winning, room to go up' : 'Winning, at the top';
    else if (holder === 'nobody') group = 'Not eligible / no Buy Box';
    else if (target === null || walk === null) group = 'Losing, no price to match';
    else group = target >= walk ? 'Losing, can match' : "Losing, can't match";
    counts[group] = (counts[group] || 0) + 1;

    const tags = [];
    if (amazonRetail) tags.push('Amazon Retail on it');
    if (atOurPrice) tags.push('a rival at our exact price');
    if (usWin && nextUp !== null) tags.push(`next rival £${fmt(nextUp)}`);
    return { code: s.code, stock: `${s.live}${s.total > s.live ? ` +${s.total - s.live}` : ''}`, sold30: s.sold30, ourPrice, holder,
      bb: usWin ? ourPrice : rivalBB, otherOffers: others.length, target, keptAtTarget, walk, foepPrice, foepStatus, refs, tags, group };
  });

  console.log(`\n${'code'.padEnd(22)} ${'stock'.padEnd(7)} 30d  ${'ours'.padStart(6)}  ${'holder'.padEnd(15)} ${'BB £'.padStart(6)} oth ${'kept'.padStart(5)} ${'walk'.padStart(6)} ${'AmzExp'.padStart(6)} ${'CompP'.padStart(6)}  group`);
  for (const r of rows) {
    console.log(`${r.code.padEnd(22)} ${r.stock.padEnd(7)} ${String(r.sold30).padStart(3)}  ${fmt(r.ourPrice).padStart(6)}  ${r.holder.padEnd(15)} ${fmt(r.bb).padStart(6)} ${String(r.otherOffers).padStart(3)} ${fmt(r.keptAtTarget).padStart(5)} ${fmt(r.walk).padStart(6)} ${fmt(r.foepPrice).padStart(6)} ${fmt(r.refs.CompetitivePrice).padStart(6)}  ${r.group}${r.tags.length ? `  [${r.tags.join(' · ')}]` : ''}${r.foepPrice === null ? `  (expected price: ${r.foepStatus})` : ''}`);
  }
  console.log('\n  BB £ = the Buy Box price incl. postage (ours if we hold it, else the cheapest rival holding it) · kept = our profit a pair if we');
  console.log('  matched it · walk = the £3-a-pair walk-away · AmzExp = Amazon\'s expected winning price (shown only) · CompP = its CompetitivePrice');

  console.log('\nGroups:');
  for (const [g, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${g}`);
  const contested = rows.filter((r) => r.otherOffers > 0).length;
  console.log(`\nSizes with a rival: ${contested} of ${rows.length}`);
  console.log(`Amazon Retail on any of them: ${rows.some((r) => r.tags.includes('Amazon Retail on it')) ? 'YES' : 'no'}`);
  console.log(`A rival at our exact price (a repricer following us?): ${rows.filter((r) => r.tags.includes('a rival at our exact price')).length}`);
  console.log(`Reference prices Amazon returned: ${refNames.size ? [...refNames].join(', ') : 'none'}`);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
