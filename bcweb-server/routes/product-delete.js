/*
=======================================================================================================================================
API Route: product_delete
=======================================================================================================================================
Method: POST
Purpose: PERMANENTLY delete a product (one groupid) — the legacy "Delete" button. This is irreversible and there is NO archive (owner
         decision: keen on a clean database). It's used once a style is finished with and confirmed clear, so it removes the product
         EVERYWHERE our "add a product" flow put it, and nowhere else:

           REMOVED:
             - Shopify listing  — deleted via the Admin API (utils/shopify.deleteByHandle) so a removed product is never left live on the
                                  store. Done FIRST; if it fails we ABORT and touch nothing in our DB (never orphan a live listing).
             - skusummary, title, attributes, skumap — the four tables product-create / product-sizes write. One transaction.
             - the image file on one.com (best-effort cleanup, like a re-image).
           KEPT (owner rule — "keep all sales and report data"):
             - sales / offlinesold / shopifysold / performance* / snapshots / price_change_log / amz_price_log / price_track / shopprices…
             - live-stock & operational tables (localstock, incoming_stock, orderstatus, amzfeed, …) — owned by the owner's Python + nightly
               jobs, not this app; by the time a product is deleted it's expected to be clear of stock.

         SAFETY: a product is easy to nuke by mistake, so the client makes the operator TYPE the Group ID to confirm. We re-check that
         typed value here server-side too (`confirm` must equal the groupid) — the type-to-confirm is a real guard, not just UI theatre.

         ORDER (deliberate): Shopify delete -> DB transaction -> image delete. Shopify is the one step that can fail in a way that would
         orphan a live listing, so it goes first and blocks the rest. The DB delete is a small, near-certain transaction. The image is
         pure cleanup (an orphaned file is harmless), so it's last and best-effort. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid": "1031465-ARIZONA",   // string, required — the product to delete
  "confirm": "1031465-ARIZONA"    // string, required — must equal groupid (the operator re-typed it)
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "1031465-ARIZONA",
  "shopifyDeleted": true,     // true if a live Shopify listing was removed; false if there was none / Shopify not configured
  "imageDeleted": true        // true if an image file was removed
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"          // groupid or confirm missing
"CONFIRM_MISMATCH"        // confirm != groupid (the typed value didn't match)
"HAS_STOCK"               // still has sellable stock — clear it physically first (carries `units`)
"NOT_FOUND"               // no such product
"SHOPIFY_DELETE_FAILED"   // the Shopify listing couldn't be removed — DB left intact, operator can retry
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { deleteImage } = require('../utils/sftp');
const shopify = require('../utils/shopify');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const groupid = (body.groupid || '').trim();
    const confirm = (body.confirm || '').trim();

    if (!groupid || !confirm) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and confirm are required' });
    }
    // Server-side re-check of the type-to-confirm: the operator must have typed the exact key.
    if (confirm !== groupid) {
      return res.json({ return_code: 'CONFIRM_MISMATCH', message: 'The typed Group ID does not match' });
    }

    // Load the product (existence + handle for the Shopify delete + image name for cleanup).
    const prod = await query(`SELECT groupid, handle, imagename FROM skusummary WHERE groupid = $1`, [groupid]);
    if (prod.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Product not found' });
    }
    const handle = prod.rows[0].handle || '';
    const imagename = prod.rows[0].imagename || '';

    // STOCK GUARD (owner): never delete a product that still has sellable stock — the operator must clear it physically first. Sellable
    // stock = localstock rows with ordernum='#FREE', not deleted, qty>0 (the CLAUDE.md definition of current stock). Block on >0 units,
    // BEFORE any Shopify/DB change so a stocked product is left completely intact.
    const stockRes = await query(`
      SELECT COALESCE(SUM(qty), 0)::int AS units
      FROM localstock WHERE groupid = $1 AND ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
    `, [groupid]);
    const units = stockRes.rows[0].units;
    if (units > 0) {
      return res.json({ return_code: 'HAS_STOCK', units, message: `This product still has ${units} in stock — clear the local stock before deleting.` });
    }

    // 1) SHOPIFY FIRST — remove the live listing so deleting our rows can never orphan it. Skip if Shopify isn't configured (nothing we
    //    can do; the DB delete still proceeds). A real API failure aborts the whole delete with the DB untouched, so the operator retries.
    let shopifyDeleted = false;
    if (shopify.isConfigured()) {
      try {
        const r = await shopify.deleteByHandle(handle);
        shopifyDeleted = r.deleted;
      } catch (err) {
        logger.error(`[product-delete] shopify delete failed for ${groupid}: ${err.code || ''} ${err.message}`);
        return res.json({ return_code: 'SHOPIFY_DELETE_FAILED', message: `Couldn’t remove the Shopify listing — nothing was deleted. ${err.message}` });
      }
    } else {
      logger.info(`[product-delete] Shopify not configured — skipping listing delete for ${groupid}`);
    }

    // 2) DB — delete the four definition tables in one transaction. Order doesn't matter (no FKs), but skumap (N rows) first reads well.
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM skumap     WHERE groupid = $1`, [groupid]);
      await client.query(`DELETE FROM attributes WHERE groupid = $1`, [groupid]);
      await client.query(`DELETE FROM title      WHERE groupid = $1`, [groupid]);
      await client.query(`DELETE FROM skusummary WHERE groupid = $1`, [groupid]);
    });

    // 3) IMAGE — best-effort cleanup (an orphaned file is harmless; never fail the delete over it).
    let imageDeleted = false;
    if (imagename) {
      try { await deleteImage(imagename); imageDeleted = true; }
      catch (delErr) { logger.error(`[product-delete] could not delete image ${imagename} for ${groupid}:`, delErr.message); }
    }

    logger.info(`[product-delete] deleted ${groupid} (shopify=${shopifyDeleted}, image=${imageDeleted})`);
    return res.json({ return_code: 'SUCCESS', groupid, shopifyDeleted, imageDeleted });
  } catch (err) {
    logger.error('[product-delete] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to delete product' });
  }
});

module.exports = router;
