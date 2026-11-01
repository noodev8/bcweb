/*
=======================================================================================================================================
Module: utils/ebayStockSync.js
=======================================================================================================================================
Purpose: Keep eBay's quantities in step with our stock — step 3 of the eBay Add build (owner, 2026-11-01). The last step of every Update
         Orders run (utils/orderSync.js → runOrderSync, so the button AND the cron), AFTER the order transaction has committed: by then
         this run's Shopify and eBay orders have taken their pairs off free stock. WRITES TO EBAY (quantities only) and to
         ebay_listing_size.qty_sent.

WHAT IT SENDS: for every size on a LIVE BCWEB listing (ebay_listing.ended_at IS NULL — the rows POST /ebay-list recorded), our Stock —
sellable local (localstock #FREE, CLAUDE.md) + FBA live (amzfeed.amzlive), the agreed figure (owner: FBA included as it is) — but ONLY
where it differs from the quantity last sent (qty_sent). Why compare with what we last SENT and not with eBay's current count: eBay
lowers its own count when it sells, before our stock moves for an FBA pair (MCF — the pair stays in amzlive until the next Update Amazon
import). Re-sending an unchanged Stock would put that sold pair back on eBay. Sending only when OUR number moves avoids it.
Quantity 0 is sent as 0: the account has eBay's out-of-stock control, so the listing stays alive and hidden until stock returns.

HOW: Inventory API bulkUpdatePriceQuantity, 25 SKUs a call — each request sets the SKU's ship-to-location quantity and its offer's
available quantity. Each SKU that eBay accepts gets qty_sent / qty_sent_at updated; one that fails keeps its old qty_sent, so the next
run tries again. One bclog row (section 'eBay', workstation = who ran Update Orders, or 'cron') when anything changed or failed.

NEVER HOLDS UP ORDERS: runOrderSync calls this outside its transaction and catches anything it throws — the orders are already saved.
Two runs at once (a press during the cron) are harmless: both send the same absolute numbers.

NOT DONE HERE (later steps): a size that comes into stock but isn't on the listing yet is NOT added; ended listings are left alone.
KNOWN GAPS the owner chose to live with (memory: ebay-listings-plan): a sale between two runs, and FBA stock as old as the last Update
Amazon import. The Checking screen's red "More on eBay than in stock" is the backstop.
=======================================================================================================================================
*/

const { query } = require('../database');
const { ebayRest } = require('./ebayRest');
const { isUserConfigured } = require('./ebayAuth');
const { logActivity } = require('./bclog');

const BATCH = 25;   // eBay's maximum per bulkUpdatePriceQuantity call

/*
 * syncEbayStock({ by }) -> { checked, updated: [{ code, from, to }], failed: [{ code, error }], skipped? }
 */
async function syncEbayStock({ by }) {
  if (!isUserConfigured()) return { checked: 0, updated: [], failed: [], skipped: 'eBay not set up' };

  const { rows } = await query(`
    SELECT s.ebay_listing_id, s.code, s.offer_id, s.qty_sent,
           COALESCE((SELECT SUM(qty) FROM localstock l
                     WHERE l.code = s.code AND l.ordernum = '#FREE' AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0), 0)
         + COALESCE((SELECT SUM(amzlive) FROM amzfeed a WHERE a.code = s.code AND COALESCE(a.amzlive, 0) > 0), 0) AS stock
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

  if (updated.length || failed.length) {
    const parts = [];
    if (updated.length) parts.push(`${updated.length} size${updated.length === 1 ? '' : 's'} updated (${updated.map((u) => `${u.code} ${u.from}→${u.to}`).join(', ')})`);
    if (failed.length) parts.push(`${failed.length} failed (${failed.map((f) => f.code).join(', ')}) — retried next run`);
    await logActivity({ who: by || 'unknown', section: 'eBay', log: `Stock sync: ${parts.join('; ')}` });
  }
  return { checked: rows.length, updated, failed };
}

module.exports = { syncEbayStock };
