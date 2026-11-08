/*
=======================================================================================================================================
Module: utils/shopifyStockSync.js
=======================================================================================================================================
Purpose: THE rule for how many pairs Shopify shows for each size, and the push that keeps Shopify there. Replaces the scripts repo's
         shopify-sync/update_shopify_inventory.py (nightly at 3am) — owner, 2026-11-08.

WHY IT MOVED. BCWEB never told Shopify about stock; the Python did, once a night. Shopify counts down its OWN sales, but every other
move — an eBay or Amazon sale, a shop sale, Goods In, a move to FBA — reached Shopify only at 3am, so a pair sold elsewhere in the
day could still be bought on Shopify (2026-11-08: M014A-08 sold on eBay, its last pair allocated, still "1 in stock" on Shopify).
Run at the end of Update Orders (button + cron, utils/orderSync.js), Shopify hears within the next sync instead.

THE RULE (same as the Python, minus its dead UK-distributor source — owner, 2026-11-08: ukdstock is empty, "dont use UKD"):
    shows = max( min(local free stock + Amazon FBA live, 5)  −  pairs on Shopify orders BCWEB hasn't imported yet , 0 )
  - local free = localstock '#FREE', not deleted, qty > 0 (a pair allocated to any order is NOT free);
  - FBA live counts because Shopify can sell an FBA pair (Amazon ships it for us — MCF);
  - capped at 5, as the Python did: Shopify shows "plenty" the same either way, and it keeps the changes (and API calls) down;
  - every size of a style flagged live in BCWEB (skusummary.shopify = 1), matched to Shopify by SKU = our code.

ORDER OF WORK closes the race the Python had (it could set a count straight back up over an order Shopify took mid-run):
  1. read Shopify's "available" for every variant at our location;
  2. THEN read Shopify's unfulfilled orders and keep the ones BCWEB hasn't imported (not in orderstatus) — their pairs aren't in our
     stock figures yet, but Shopify has already taken them off its count;
  3. THEN work out what each size should show;
  4. send only the sizes that differ, each with compareQuantity = the count read in step 1. If Shopify's count moved since (an order
     landed), Shopify refuses that size and the next run picks it up with the order imported. Nothing is ever forced.
If the orders in step 2 can't be read, only DECREASES are sent that run (never raise a count without knowing what's on order).

Never throws into Update Orders' result: the caller wraps it (orders are already saved). The location is SHOPIFY_LOCATION_ID (the one
the Python used); the token is SHOPIFY_ACCESS_TOKEN (has write_inventory).
=======================================================================================================================================
*/

const { query } = require('../database');
const config = require('../config/config');
const logger = require('./logger');
const shopify = require('./shopify');
const shopifyOrders = require('./shopifyOrders');

const CAP = 5;                 // the most Shopify ever shows for one size (the Python's cap)
const BATCH = 100;             // sizes per inventorySetQuantities call

const locationGid = () => `gid://shopify/Location/${config.shopify.locationId}`;

// Every variant on the store with its inventory item and "available" count at our location (null = no stock record there).
const VARIANTS_QUERY = `
  query stock($after: String, $loc: ID!) {
    productVariants(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        sku
        inventoryItem { id inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { quantity } } }
      }
    }
  }
`;

async function readShopifyStock() {
  const bySku = new Map();
  let after = null;
  do {
    const data = await shopify.shopifyGraphQL(VARIANTS_QUERY, { after, loc: locationGid() });
    for (const v of data.productVariants.nodes) {
      if (!v.sku) continue;                                                      // the gift card — not a stock item
      const level = v.inventoryItem && v.inventoryItem.inventoryLevel;
      bySku.set(v.sku, {
        inventoryItemId: v.inventoryItem ? v.inventoryItem.id : null,
        available: level && level.quantities.length ? level.quantities[0].quantity : null,
      });
    }
    after = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
  } while (after);
  return bySku;
}

// Pairs per SKU on open, unfulfilled Shopify orders that BCWEB hasn't imported yet. null = couldn't read (the caller then only lowers).
async function readPendingOrders() {
  if (!shopifyOrders.isConfigured()) return null;
  try {
    const { orders, truncated } = await shopifyOrders.fetchUnfulfilledOrders();
    if (truncated) return null;                                                  // a partial list could under-count — treat as unread
    const names = [...new Set(orders.map((o) => o.name).filter(Boolean))];
    if (!names.length) return new Map();
    const seen = await query(`SELECT DISTINCT ordernum FROM orderstatus WHERE ordernum = ANY($1::text[])`, [names]);
    const imported = new Set(seen.rows.map((r) => r.ordernum));
    const pending = new Map();
    for (const o of orders) {
      if (imported.has(o.name)) continue;
      for (const li of o.line_items || []) {
        if (!li.sku) continue;
        pending.set(li.sku, (pending.get(li.sku) || 0) + (Number(li.quantity) || 0));
      }
    }
    return pending;
  } catch (err) {
    logger.error(`[shopifyStock] couldn't read unfulfilled orders — only decreases will be sent: ${err.message}`);
    return null;
  }
}

// Local free + FBA live for every size of a style flagged live in BCWEB.
async function readOurStock() {
  const r = await query(`
    SELECT m.code,
           COALESCE((SELECT SUM(ls.qty) FROM localstock ls
                      WHERE ls.code = m.code AND ls.ordernum = '#FREE' AND COALESCE(ls.deleted, 0) = 0 AND ls.qty > 0), 0)::int AS local,
           COALESCE((SELECT MAX(af.amzlive) FROM amzfeed af WHERE af.code = m.code AND af.amzlive > 0), 0)::int        AS fba
    FROM skumap m
    JOIN skusummary ss ON ss.groupid = m.groupid AND ss.shopify = 1
  `);
  return r.rows;
}

/*
 * planShopifyStock() -> { changes, checked, notOnShopify, noLevel, ordersRead, pendingOrders }
 * READ ONLY. changes = [{ code, inventoryItemId, shopify, want, local, fba, pending }] — only sizes whose Shopify count differs, and
 * with ordersRead false, only the ones that go DOWN.
 */
async function planShopifyStock() {
  const shop = await readShopifyStock();          // 1. Shopify's counts first …
  const pending = await readPendingOrders();      // 2. … then what's on order but not imported …
  const ours = await readOurStock();              // 3. … then ours.
  const ordersRead = pending !== null;
  const changes = [];
  let checked = 0, notOnShopify = 0, noLevel = 0;
  for (const r of ours) {
    const s = shop.get(r.code);
    if (!s) { notOnShopify += 1; continue; }
    if (s.available === null || !s.inventoryItemId) { noLevel += 1; continue; }
    checked += 1;
    const onOrder = ordersRead ? (pending.get(r.code) || 0) : 0;
    const want = Math.max(Math.min(r.local + r.fba, CAP) - onOrder, 0);
    if (want === s.available) continue;
    if (!ordersRead && want > s.available) continue;                             // don't raise blind
    changes.push({ code: r.code, inventoryItemId: s.inventoryItemId, shopify: s.available, want, local: r.local, fba: r.fba, pending: onOrder });
  }
  const pendingOrders = ordersRead ? [...pending.values()].reduce((a, b) => a + b, 0) : null;
  return { changes, checked, notOnShopify, noLevel, ordersRead, pendingOrders };
}

const SET_MUTATION = `
  mutation set($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { id }
      userErrors { field message code }
    }
  }
`;

// Send one group of sizes. Returns the userErrors (empty = all set).
async function send(items) {
  const data = await shopify.shopifyGraphQL(SET_MUTATION, {
    input: {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: false,
      quantities: items.map((c) => ({ inventoryItemId: c.inventoryItemId, locationId: locationGid(), quantity: c.want, compareQuantity: c.shopify })),
    },
  });
  return data.inventorySetQuantities.userErrors || [];
}

/*
 * syncShopifyStock({ commit }) -> plan + { sent, stale, failed }
 *   commit false = plan only (nothing sent). Sends in groups; if a group is refused (one size's count moved — Shopify may refuse the
 *   whole call), its sizes are sent one by one so only the moved ones wait for the next run.
 */
async function syncShopifyStock({ commit = true } = {}) {
  if (!shopify.isConfigured()) throw new Error('Shopify is not configured');
  if (!config.shopify.locationId) throw new Error('SHOPIFY_LOCATION_ID is not set');
  const plan = await planShopifyStock();
  const out = { ...plan, sent: [], stale: [], failed: [] };
  if (!commit) return out;

  for (let i = 0; i < plan.changes.length; i += BATCH) {
    const group = plan.changes.slice(i, i + BATCH);
    try {
      const errs = await send(group);
      if (!errs.length) { out.sent.push(...group); continue; }
    } catch (err) {
      logger.error(`[shopifyStock] group send failed, retrying one by one: ${err.message}`);
    }
    for (const c of group) {
      try {
        const errs = await send([c]);
        if (!errs.length) out.sent.push(c);
        else if (errs.some((e) => /STALE|compare/i.test(`${e.code} ${e.message}`))) out.stale.push(c);
        else out.failed.push({ ...c, error: errs.map((e) => e.message).join('; ') });
      } catch (err) {
        out.failed.push({ ...c, error: err.message });
      }
    }
  }
  return out;
}

module.exports = { CAP, planShopifyStock, syncShopifyStock };
