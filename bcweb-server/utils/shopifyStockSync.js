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

CHANGED SIZES ONLY (2026-11-10, owner: "narrow the Shopify step to changed sizes"). Every run works out the figure for every live size
(local SQL, cheap), but only checks Shopify for a size whose figure differs from the count Shopify was last CONFIRMED to show
(`shopify_stock_sent`, one row per size, kept to the live sizes). A size changes when stock moves here — an order, Goods In, a move to
FBA, an Amazon read — or when a Shopify order not yet imported changes its pending count. Shopify's own count is read per SKU for
the changed sizes only, not the whole store (~10,000 sizes). Sizes not checked keep their last confirmed count. Drift from a hand edit
in Shopify admin is NOT seen by the everyday run — the by-hand full check does that (`scripts/shopify-stock-sync.js --full --commit`).

ORDER OF WORK closes the race the Python had (it could set a count straight back up over an order Shopify took mid-run):
  1. read Shopify's "available" for the changed sizes (per SKU), and the orders on hand (provisional, to choose those sizes);
  2. THEN read Shopify's unfulfilled orders and keep the ones BCWEB hasn't imported (not in orderstatus) — their pairs aren't in our
     stock figures yet, but Shopify has already taken them off its count;
  3. THEN work out what each changed size should show;
  4. send only the sizes that differ, each with compareQuantity = the count read in step 1. If Shopify's count moved since (an order
     landed), Shopify refuses that size and the next run picks it up with the order imported. Nothing is ever forced.
If the orders in step 2 can't be read, only DECREASES are sent that run (never raise a count without knowing what's on order).

Runs as step 3 of Update Orders (utils/orderSync.js), FIRST after the commit — the run's orders and picks are saved by then, so a
pair just sold on eBay is already out of free stock. Never throws into Update Orders' result: the caller wraps it (orders are already
saved). One bclog row (section 'Shopify Stock', workstation = who ran Update Orders, or 'cron') only when a size was sent, refused or
failed — a run with nothing to change writes nothing (it runs 5+ times a day). The location is SHOPIFY_LOCATION_ID (the one
the Python used); the token is SHOPIFY_ACCESS_TOKEN (has write_inventory).
=======================================================================================================================================
*/

const { query } = require('../database');
const config = require('../config/config');
const logger = require('./logger');
const shopify = require('./shopify');
const shopifyOrders = require('./shopifyOrders');
const { logActivity } = require('./bclog');

const CAP = 5;                 // the most Shopify ever shows for one size (the Python's cap)
const BATCH = 100;             // sizes per inventorySetQuantities call

const locationGid = () => `gid://shopify/Location/${config.shopify.locationId}`;

// Variants matching a list of SKUs, with inventory item and "available" count at our location (null = no stock record there).
// Read in chunks by SKU search — NOT the whole store (about 10,000 sizes), which was the cost of every run before 2026-11-10.
const VARIANTS_BY_SKU_QUERY = `
  query stockBySku($q: String!, $after: String, $loc: ID!) {
    productVariants(first: 100, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        sku
        inventoryItem { id inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { quantity } } }
      }
    }
  }
`;
const SKU_CHUNK = 40;          // SKUs per search query

const skuClause = (codes) => codes.map((c) => `sku:"${String(c).replace(/["\\]/g, '')}"`).join(' OR ');

async function readShopifyFor(codes) {
  const bySku = new Map();
  for (let i = 0; i < codes.length; i += SKU_CHUNK) {
    const q = skuClause(codes.slice(i, i + SKU_CHUNK));
    let after = null;
    do {
      const data = await shopify.shopifyGraphQL(VARIANTS_BY_SKU_QUERY, { q, after, loc: locationGid() });
      for (const v of data.productVariants.nodes) {
        if (!v.sku) continue;
        const level = v.inventoryItem && v.inventoryItem.inventoryLevel;
        bySku.set(v.sku, {
          inventoryItemId: v.inventoryItem ? v.inventoryItem.id : null,
          available: level && level.quantities.length ? level.quantities[0].quantity : null,
        });
      }
      after = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
    } while (after);
  }
  return bySku;
}

// The count Shopify was last confirmed to show per size (shopify_stock_sent). Map code -> want.
async function readConfirmed() {
  const r = await query(`SELECT code, want FROM shopify_stock_sent`);
  return new Map(r.rows.map((x) => [x.code, Number(x.want)]));
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

// What a size should show: the cap, less pairs on orders Shopify has taken but BCWEB hasn't imported.
const wantFor = (r, onOrder) => Math.max(Math.min(r.local + r.fba, CAP) - onOrder, 0);

/*
 * planShopifyStock({ full }) -> { changes, confirmedNow, checked, unchanged, notOnShopify, noLevel, ordersRead, pendingOrders, liveCodes }
 * READ ONLY. Only the CHANGED sizes are read from Shopify: a size whose figure equals the count Shopify was last confirmed to show
 * (shopify_stock_sent) is skipped — `unchanged`. full = true checks every live size (the by-hand full check).
 *   changes      = [{ code, inventoryItemId, shopify, want, local, fba, pending }] — sizes whose Shopify count differs (with ordersRead
 *                  false, only the ones that go DOWN)
 *   confirmedNow = [{ code, want }] — checked and already equal on Shopify
 */
async function planShopifyStock({ full = false } = {}) {
  // Provisional read of what's on order — only to pick which sizes changed. The decision below uses a second read taken AFTER Shopify.
  const pendingA = await readPendingOrders();
  const ours = await readOurStock();
  const confirmed = full ? new Map() : await readConfirmed();
  const candidates = ours.filter((r) => {
    const onOrder = pendingA ? (pendingA.get(r.code) || 0) : 0;
    return !(confirmed.has(r.code) && confirmed.get(r.code) === wantFor(r, onOrder));
  });

  // Order matters (as before 2026-11-10): Shopify's count is read BEFORE the orders on hand used for the decision. An order that
  // lands between the two is then either in the count we read (and so lower) or not yet in the pending list — never a raise over it.
  const shop = await readShopifyFor(candidates.map((r) => r.code));
  const pending = await readPendingOrders();
  const ordersRead = pending !== null;

  const changes = [];
  const confirmedNow = [];
  let notOnShopify = 0, noLevel = 0;
  for (const r of candidates) {
    const s = shop.get(r.code);
    if (!s) { notOnShopify += 1; continue; }
    if (s.available === null || !s.inventoryItemId) { noLevel += 1; continue; }
    const onOrder = ordersRead ? (pending.get(r.code) || 0) : 0;
    const want = wantFor(r, onOrder);
    if (want === s.available) { confirmedNow.push({ code: r.code, want }); continue; }
    if (!ordersRead && want > s.available) continue;                             // don't raise blind
    changes.push({ code: r.code, inventoryItemId: s.inventoryItemId, shopify: s.available, want, local: r.local, fba: r.fba, pending: onOrder });
  }
  const pendingOrders = ordersRead ? [...pending.values()].reduce((a, b) => a + b, 0) : null;
  return {
    changes, confirmedNow, checked: candidates.length, unchanged: ours.length - candidates.length,
    notOnShopify, noLevel, ordersRead, pendingOrders, liveCodes: ours.map((r) => r.code),
  };
}

// Keep shopify_stock_sent to the live sizes and record what Shopify is now confirmed to show for the rest.
async function recordConfirmed(liveCodes, rows) {
  await query(`DELETE FROM shopify_stock_sent WHERE NOT (code = ANY($1::text[]))`, [liveCodes]);
  if (!rows.length) return;
  await query(
    `INSERT INTO shopify_stock_sent (code, want, confirmed_at)
     SELECT u.code, u.want, now() FROM UNNEST($1::text[], $2::int[]) AS u(code, want)
     ON CONFLICT (code) DO UPDATE SET want = EXCLUDED.want, confirmed_at = now()`,
    [rows.map((r) => r.code), rows.map((r) => r.want)]
  );
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
 * syncShopifyStock({ commit, by }) -> plan + { sent, stale, failed }
 *   commit false = plan only (nothing sent). Sends in groups; if a group is refused (one size's count moved — Shopify may refuse the
 *   whole call), its sizes are sent one by one so only the moved ones wait for the next run.
 */
async function syncShopifyStock({ commit = true, by = null, full = false } = {}) {
  if (!shopify.isConfigured()) throw new Error('Shopify is not configured');
  if (!config.shopify.locationId) throw new Error('SHOPIFY_LOCATION_ID is not set');
  const plan = await planShopifyStock({ full });
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
  // Record what Shopify now shows: sizes already equal, and the ones accepted just now. Stale or failed sizes stay unrecorded, so the
  // next run checks them again. Never fails the run — at worst the next run re-checks sizes already correct.
  try {
    await recordConfirmed(plan.liveCodes, [...plan.confirmedNow, ...out.sent]);
  } catch (err) {
    logger.error(`[shopifyStock] couldn't record confirmed counts (next run re-checks): ${err.message}`);
  }
  if (by && (out.sent.length || out.stale.length || out.failed.length)) {
    const parts = [];
    if (out.sent.length) parts.push(`${out.sent.length} sizes set (${out.sent.slice(0, 8).map((c) => `${c.code} ${c.shopify}→${c.want}`).join(', ')}${out.sent.length > 8 ? ' …' : ''})`);
    if (out.stale.length) parts.push(`${out.stale.length} moved on Shopify meanwhile (next run)`);
    if (out.failed.length) parts.push(`${out.failed.length} failed`);
    await logActivity({ who: by, section: 'Shopify Stock', log: `Stock sync: ${parts.join('; ')}` });
  }
  return out;
}

module.exports = { CAP, planShopifyStock, syncShopifyStock, wantFor };
