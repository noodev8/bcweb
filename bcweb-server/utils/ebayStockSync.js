/*
=======================================================================================================================================
Module: utils/ebayStockSync.js
=======================================================================================================================================
Purpose: Keep BCWEB's eBay listings in step with our stock — step 3 of the eBay Add build (owner, 2026-11-01), plus new sizes added
         automatically (owner, 2026-11-01: "A, add them automatically"). The last step of every Update Orders run (utils/orderSync.js →
         runOrderSync, so the button AND the cron), AFTER the order transaction has committed: by then this run's Shopify and eBay orders
         have taken their pairs off free stock. WRITES TO EBAY and to ebay_listing_size. Two parts, in this order:

1. NEW SIZES (addNewSizes) — a size of a listed style that has STOCK but isn't on its listing (a delivery brought in a size the style
   didn't have when it was listed) is added to the SAME listing, at ITS OWN default price (its Amazon price, else Shopify + £4.50 —
   since 2026-11-02) and the Style / material the listing was made with, through the
   same build as the List button (utils/ebayPublish.js → addSizes: the size's item and offer, the style's group with ALL its sizes, the
   group re-published — eBay keeps the listing number). Recorded in ebay_listing_size with the quantity it went on with.
   A size eBay would refuse is SKIPPED, not sent: no UK size (skumap.uksize), no barcode, or a UK size the listing already has. It stays
   flagged on the Checking screen (amber "Size in stock not on eBay" — utils/ebayStockSync.js → unlistedSizes) until it's fixed in BCWEB.
   An eBay error on a style leaves nothing recorded, so the next run tries that style again.

2. QUANTITIES (syncQuantities) — for every size on a LIVE BCWEB listing (ebay_listing.ended_at IS NULL), our Stock — sellable local
   (localstock #FREE, CLAUDE.md, unallocated and not on C3-Amazon — ebayListingRules → localStockWhere) + FBA live (amzfeed.amzlive), the agreed figure (owner: FBA included as it is) — but ONLY where it
   differs from the quantity last sent (qty_sent). Why compare with what we last SENT and not with eBay's current count: eBay lowers its
   own count when it sells, before our stock moves for an FBA pair (MCF — the pair stays in amzlive until the next Update Amazon import).
   Re-sending an unchanged Stock would put that sold pair back on eBay. Quantity 0 is sent as 0: the account has eBay's out-of-stock
   control, so the size stays on the listing, hidden, until stock returns. Inventory API bulkUpdatePriceQuantity, 25 SKUs a call; a SKU
   eBay refuses keeps its old qty_sent and is retried next run.

LOGGING: one bclog row (section 'eBay', workstation = who ran Update Orders, or 'cron') when a size was added or a quantity changed.
Failures go to the server log only (runOrderSync logs them) — a failure retried every few minutes must not flood the activity log.

NEVER HOLDS UP ORDERS: runOrderSync calls this outside its transaction and catches anything it throws — the orders are already saved.
Two runs at once (a press during the cron) are harmless: absolute quantities, and adding a size is idempotent (the record's primary key
refuses a second row).
KNOWN GAPS the owner chose to live with (memory: ebay-listings-plan): a sale between two runs, and FBA stock as old as the last Update
Amazon import. The Checking screen's red "More on eBay than in stock" is the backstop. Ended listings are left alone.
=======================================================================================================================================
*/

const { query } = require('../database');
const { ebayRest } = require('./ebayRest');
const { isUserConfigured } = require('./ebayAuth');
const { logActivity } = require('./bclog');
const { resolveSetup } = require('./ebayPolicies');
const { loadCandidates } = require('./ebayCandidates');
const { addSizes } = require('./ebayPublish');
const { ukSizeFor, localStockWhere } = require('./ebayListingRules');

const BATCH = 25;   // eBay's maximum per bulkUpdatePriceQuantity call

// Our Stock for a code — the one expression both parts (and the Checking flag) use.
const STOCK_SQL = (codeExpr) => `
  COALESCE((SELECT SUM(qty) FROM localstock l
            WHERE l.code = ${codeExpr} AND ${localStockWhere('l')}), 0)
+ COALESCE((SELECT SUM(amzlive) FROM amzfeed a WHERE a.code = ${codeExpr} AND COALESCE(a.amzlive, 0) > 0), 0)`;

/*
 * unlistedSizes(itemIds?) -> [{ listing_id, item_id, groupid, codes: [code] }]
 *   Every LIVE BCWEB listing with a size of its style in stock that isn't on it. itemIds narrows to those eBay listings (the Checking
 *   screen); omitted = all (the sync).
 */
async function unlistedSizes(itemIds = null) {
  const { rows } = await query(`
    WITH live AS (
      SELECT id, item_id, groupid FROM ebay_listing
      WHERE ended_at IS NULL AND ($1::text[] IS NULL OR item_id = ANY($1::text[]))
    ),
    codes AS (
      SELECT DISTINCT live.id, live.item_id, live.groupid, m.code
      FROM live JOIN skumap m ON m.groupid = live.groupid AND COALESCE(m.deleted, 0) = 0
    )
    SELECT c.id AS listing_id, c.item_id, c.groupid, array_agg(c.code ORDER BY c.code) AS codes
    FROM codes c
    WHERE NOT EXISTS (SELECT 1 FROM ebay_listing_size s WHERE s.ebay_listing_id = c.id AND s.code = c.code)
      AND (${STOCK_SQL('c.code')}) > 0
    GROUP BY c.id, c.item_id, c.groupid
  `, [itemIds]);
  return rows;
}

// 1. NEW SIZES -> { added: [{ groupid, code, uk_size, qty }], skipped: [{ groupid, code, reason }], failed: [{ groupid, error }] }
async function addNewSizes() {
  const added = [];
  const skipped = [];
  const failed = [];
  const todo = await unlistedSizes();
  if (!todo.length) return { added, skipped, failed };

  const setup = await resolveSetup();
  for (const t of todo) {
    try {
      const listing = (await query('SELECT * FROM ebay_listing WHERE id = $1', [t.listing_id])).rows[0];
      // The style as it stands — onEbayCodes [] so a listed style isn't filtered out; full = description, photos.
      const cand = (await loadCandidates({ onEbayCodes: [], groupid: t.groupid, full: true })).rows[0];
      if (!listing || !cand) continue;

      // The sizes already on the listing, with their UK size (kept in the group whatever their stock).
      const listedCodes = (await query('SELECT code FROM ebay_listing_size WHERE ebay_listing_id = $1', [t.listing_id])).rows.map((r) => r.code);
      const uk = await query(`
        SELECT DISTINCT ON (code) code, uksize FROM skumap
        WHERE code = ANY($1::text[]) AND COALESCE(deleted, 0) = 0
        ORDER BY code, (NULLIF(TRIM(uksize), '') IS NULL)`, [listedCodes]);
      const ukOf = new Map(uk.rows.map((r) => [r.code, ukSizeFor(r.uksize, listing.category_id)]));
      const listedSizes = listedCodes.map((code) => ({ code, uk_size: ukOf.get(code) || null }));
      if (listedSizes.some((z) => !z.uk_size)) {
        for (const code of t.codes) skipped.push({ groupid: t.groupid, code, reason: 'a size already on the listing has no UK size' });
        continue;
      }

      const taken = new Set(listedSizes.map((z) => z.uk_size));
      const newSizes = [];
      for (const z of cand.sizes.filter((s) => t.codes.includes(s.code))) {
        if (!z.uk_size) { skipped.push({ groupid: t.groupid, code: z.code, reason: 'no UK size' }); continue; }
        if (!z.ean) { skipped.push({ groupid: t.groupid, code: z.code, reason: 'no barcode' }); continue; }
        if (taken.has(z.uk_size)) { skipped.push({ groupid: t.groupid, code: z.code, reason: `UK ${z.uk_size} is on the listing already` }); continue; }
        // z.price is THE default (its Amazon price, else Shopify + £4.50 — utils/ebayListingRules.js → sizePriceFor); none = can't price.
        if (z.price === null) { skipped.push({ groupid: t.groupid, code: z.code, reason: 'no Amazon or Shopify price' }); continue; }
        taken.add(z.uk_size);
        newSizes.push(z);
      }
      if (!newSizes.length) continue;

      const res = await addSizes({ cand, listing, listedSizes, newSizes, setup });
      for (const s of res.sizes) {
        await query(
          `INSERT INTO ebay_listing_size (ebay_listing_id, code, offer_id, qty_sent, price) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (ebay_listing_id, code) DO NOTHING`,
          [t.listing_id, s.code, s.offerId, s.qty, s.price]
        );
        const z = newSizes.find((n) => n.code === s.code);
        added.push({ groupid: t.groupid, code: s.code, uk_size: z ? z.uk_size : null, qty: s.qty, price: s.price });
      }
    } catch (err) {
      failed.push({ groupid: t.groupid, error: err.message });
    }
  }
  return { added, skipped, failed };
}

// 2. QUANTITIES -> { checked, updated: [{ code, from, to }], failed: [{ code, error }] }
async function syncQuantities() {
  const { rows } = await query(`
    SELECT s.ebay_listing_id, s.code, s.offer_id, s.qty_sent, ${STOCK_SQL('s.code')} AS stock
    FROM ebay_listing_size s
    JOIN ebay_listing e ON e.id = s.ebay_listing_id AND e.ended_at IS NULL
  `);

  const changed = rows
    .map((r) => ({ ...r, stock: Math.max(0, Number(r.stock) || 0), qty_sent: Number(r.qty_sent) }))
    .filter((r) => r.stock !== r.qty_sent);
  const updated = [];
  const failed = [];

  for (let i = 0; i < changed.length; i += BATCH) {
    const batch = changed.slice(i, i + BATCH);
    let responses;
    try {
      const res = await ebayRest('POST', '/sell/inventory/v1/bulk_update_price_quantity', {
        requests: batch.map((r) => ({
          sku: r.code,
          shipToLocationAvailability: { quantity: r.stock },
          offers: [{ offerId: r.offer_id, availableQuantity: r.stock }],
        })),
      });
      responses = (res.body && res.body.responses) || [];
    } catch (err) {
      for (const r of batch) failed.push({ code: r.code, error: err.message });
      continue;
    }
    // One response per SKU (and per offer) — a SKU counts as sent only if none of its responses failed.
    for (const r of batch) {
      const mine = responses.filter((x) => x.sku === r.code || x.offerId === r.offer_id);
      const bad = mine.find((x) => Number(x.statusCode) >= 300);
      if (!mine.length || bad) {
        const msg = bad && Array.isArray(bad.errors) && bad.errors[0] ? (bad.errors[0].longMessage || bad.errors[0].message) : 'no answer from eBay';
        failed.push({ code: r.code, error: msg });
        continue;
      }
      await query(
        'UPDATE ebay_listing_size SET qty_sent = $1, qty_sent_at = now() WHERE ebay_listing_id = $2 AND code = $3',
        [r.stock, r.ebay_listing_id, r.code]
      );
      updated.push({ code: r.code, from: r.qty_sent, to: r.stock });
    }
  }
  return { checked: rows.length, updated, failed };
}

/*
 * syncEbayStock({ by }) -> { checked, added, skipped, updated, failed, skipped_reason? }
 *   failed = quantity failures + new-size failures ({ code } or { groupid }, with error)
 */
async function syncEbayStock({ by }) {
  if (!isUserConfigured()) return { checked: 0, added: [], skipped: [], updated: [], failed: [], skipped_reason: 'eBay not set up' };

  const sizes = await addNewSizes();
  const qty = await syncQuantities();

  if (sizes.added.length || qty.updated.length) {
    const parts = [];
    if (sizes.added.length) {
      parts.push(`added ${sizes.added.map((a) => `${a.code} (UK ${a.uk_size}, ${a.qty})`).join(', ')}`);
    }
    if (qty.updated.length) {
      parts.push(`${qty.updated.length} size${qty.updated.length === 1 ? '' : 's'} updated (${qty.updated.map((u) => `${u.code} ${u.from}→${u.to}`).join(', ')})`);
    }
    await logActivity({ who: by || 'unknown', section: 'eBay', log: `Stock sync: ${parts.join('; ')}` });
  }
  return {
    checked: qty.checked,
    added: sizes.added,
    skipped: sizes.skipped,
    updated: qty.updated,
    failed: [...sizes.failed.map((f) => ({ code: f.groupid, error: f.error })), ...qty.failed],
  };
}

module.exports = { syncEbayStock, unlistedSizes };
