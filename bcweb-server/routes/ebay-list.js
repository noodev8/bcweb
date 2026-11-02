/*
=======================================================================================================================================
API Route: ebay_list
=======================================================================================================================================
Method: POST
Purpose: List ONE style on eBay — the List button on the Not on eBay view (Add build, step 2 — owner, 2026-11-01). WRITES TO EBAY, then
         records what it listed. One fixed-price listing per style, its in-stock sizes as the variations, FREE postage, each size at
         ITS OWN price (owner, 2026-11-02: its Amazon price, else the Shopify price + £4.50 — utils/ebayListingRules.js → sizePriceFor;
         editable per size on the form), with the Style / material confirmed on the form (Style from the title, editable; material
         required and saved back to BCWEB). Everything else comes from the rules (utils/ebayListingRules.js) and the policies (utils/ebayPolicies.js).

THE ORDER:
  1. Validate the form (Style and material 1–65 characters; any price sent for a size must be > 0).
  2. Re-check at the moment of listing, never trusting the screen: eBay is read live (nothing of this style may be on eBay already,
     fixed price or auction) and the style is re-loaded through utils/ebayCandidates.js — the same rules as the view: it must have stock,
     not be Birkenstock, and not be blocked. A live ebay_listing row for the style also refuses (ALREADY_ON_EBAY) — unless eBay no
     longer has that listing live (ended in Seller Hub, not with the End button): then the row is marked ended ('eBay (ended outside
     BCWEB)') and the listing goes ahead. Only on a full eBay read; a truncated one can't prove it's gone.
  3. Publish (utils/ebayPublish.js — idempotent, so a failed press can be pressed again).
  4. ONE transaction: the ebay_listing row (price = the LOWEST size price, for the record) + an ebay_listing_size row per size (offer,
     quantity sent, the price it went on at — price_set_at stays NULL: that marks a price set later by hand), the material saved back to
     skusummary.material when it differs from what was stored, and a bclog row (section 'eBay'). If this fails after eBay published,
     the listing IS live — RECORD_FAILED says so (the On eBay view still shows it; the stock sync won't know it until it's recorded).

Requires auth. changed_by = the logged-in user (verifyToken).
=======================================================================================================================================
Request: POST /ebay-list   { "groupid": "FLE030-IVES-WHITE", "prices": { "FLE030-IVES-WHITE-06": 40.79, ... }, "style": "Trainer",
                             "material": "Leather" }
  prices   optional, code -> £: the form's figure for a size. A size not in it goes on at its default (sizePriceFor). A code that isn't
           an in-stock size of the style is ignored.

Success Response:
{ "return_code": "SUCCESS", "item_id": "2876…", "url": "https://www.ebay.co.uk/itm/2876…", "sizes": 7, "pairs": 177, "warnings": [] }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BAD_REQUEST"           a price / Style / material missing or out of range (message says which)
"ALREADY_ON_EBAY"       a size of the style is on eBay already, or BCWEB has a live listing for it
"NOT_A_CANDIDATE"       no stock, Birkenstock, or not a style
"NOT_READY"             blocked — `missing` lists why (utils/ebayCandidates.js codes)
"EBAY_SETUP_MISSING"    the BCWEB policies aren't on eBay — run scripts/ebay-setup.js
"EBAY_NOT_CONFIGURED"   the eBay keys / refresh token are missing from .env
"EBAY_ERROR"            eBay refused (message carries eBay's own words) — nothing recorded; fix and press again
"RECORD_FAILED"         eBay listed it (item_id, url returned) but BCWEB couldn't record it
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog } = require('../utils/bclog');
const { fetchActiveListings } = require('../utils/ebayListings');
const { loadCandidates, codesOnEbay } = require('../utils/ebayCandidates');
const { resolveSetup } = require('../utils/ebayPolicies');
const { publishStyle } = require('../utils/ebayPublish');
const logger = require('../utils/logger');

router.use(verifyToken);

const TEXT_MAX = 65;   // eBay's limit for an item specific's value

router.post('/', async (req, res) => {
  const who = req.user.display_name;
  const groupid = String((req.body && req.body.groupid) || '').trim();
  const pricesIn = (req.body && typeof req.body.prices === 'object' && req.body.prices) || {};
  const style = String((req.body && req.body.style) || '').trim();
  const material = String((req.body && req.body.material) || '').trim();

  // 1. The form.
  if (!groupid) return res.json({ return_code: 'BAD_REQUEST', message: 'No style given' });
  const prices = {};
  for (const [code, v] of Object.entries(pricesIn)) {
    const n = Math.round(Number(v) * 100) / 100;
    if (!Number.isFinite(n) || n <= 0) return res.json({ return_code: 'BAD_REQUEST', message: `Enter a price above £0 for ${code}` });
    prices[code] = n;
  }
  if (!style || style.length > TEXT_MAX) return res.json({ return_code: 'BAD_REQUEST', message: `Style is needed (up to ${TEXT_MAX} characters)` });
  if (!material || material.length > TEXT_MAX) return res.json({ return_code: 'BAD_REQUEST', message: `Material is needed (up to ${TEXT_MAX} characters)` });

  // 2. Re-check now: eBay live, our record, and the style through the same rules as the screen.
  let cand;
  let setup;
  try {
    const read = await fetchActiveListings();
    const live = await query('SELECT id, item_id FROM ebay_listing WHERE groupid = $1 AND ended_at IS NULL', [groupid]);
    if (live.rows.length) {
      const stillLive = read.listings.some((l) => l.item_id === live.rows[0].item_id);
      // Our record says live, but eBay no longer has it (ended in Seller Hub, not with the End button): record it as ended and carry
      // on — a full read only; a truncated one can't prove it's gone.
      if (stillLive || read.truncated) {
        return res.json({ return_code: 'ALREADY_ON_EBAY', message: `${groupid} is already listed (eBay item ${live.rows[0].item_id})` });
      }
      await query("UPDATE ebay_listing SET ended_at = now(), ended_by = 'eBay (ended outside BCWEB)' WHERE id = $1", [live.rows[0].id]);
    }
    const onEbayCodes = codesOnEbay(read);
    const { rows, onEbayStyles } = await loadCandidates({ onEbayCodes, groupid, full: true });
    if (onEbayStyles > 0) return res.json({ return_code: 'ALREADY_ON_EBAY', message: `A size of ${groupid} is on eBay already` });
    cand = rows[0];
    if (!cand) return res.json({ return_code: 'NOT_A_CANDIDATE', message: `${groupid} has no stock, or can't go on eBay` });
    if (cand.status === 'missing') return res.json({ return_code: 'NOT_READY', message: `${groupid} isn't ready for eBay`, missing: cand.missing });
    // The form's price for a size wins; otherwise the size's default (already on cand.sizes — never null here, else 'price' blocked).
    cand.sizes = cand.sizes.map((z) => (prices[z.code] !== undefined ? { ...z, price: prices[z.code], price_from: 'form' } : z));
    setup = await resolveSetup();
  } catch (err) {
    if (['EBAY_SETUP_MISSING', 'EBAY_NOT_CONFIGURED', 'EBAY_ERROR'].includes(err.code)) {
      logger.error('[ebay-list] check failed:', err.message);
      return res.json({ return_code: err.code, message: err.message });
    }
    logger.error('[ebay-list] check error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not check the style' });
  }

  // 3. Publish.
  let pub;
  try {
    pub = await publishStyle({ cand, style, material, setup });
  } catch (err) {
    logger.error(`[ebay-list] ${groupid} publish failed:`, err.message);
    return res.json({ return_code: err.code === 'EBAY_ERROR' ? 'EBAY_ERROR' : 'SERVER_ERROR', message: err.message });
  }
  const url = `https://www.ebay.co.uk/itm/${pub.itemId}`;
  const pairs = pub.sizes.reduce((a, z) => a + z.qty, 0);
  const low = Math.min(...pub.sizes.map((z) => z.price));
  const high = Math.max(...pub.sizes.map((z) => z.price));
  const range = low === high ? `£${low.toFixed(2)}` : `£${low.toFixed(2)}–£${high.toFixed(2)}`;

  // 4. Record it.
  try {
    await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO ebay_listing (groupid, item_id, group_key, category_id, price, style, material, listed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [groupid, pub.itemId, groupid, cand.category.id, low, style, material, who]
      );
      const id = ins.rows[0].id;
      for (const z of pub.sizes) {
        await client.query(
          'INSERT INTO ebay_listing_size (ebay_listing_id, code, offer_id, qty_sent, price) VALUES ($1, $2, $3, $4, $5)',
          [id, z.code, z.offerId, z.qty, z.price]
        );
      }
      if (material !== (cand.stored_material || '')) {
        await client.query('UPDATE skusummary SET material = $1 WHERE groupid = $2', [material, groupid]);
      }
      await writeBcLog(client, {
        who,
        section: 'eBay',
        log: `Listed ${groupid} on eBay at ${range}, free postage — ${pub.sizes.length} size${pub.sizes.length === 1 ? '' : 's'}, ${pairs} pair${pairs === 1 ? '' : 's'} (item ${pub.itemId})`,
      });
    });
  } catch (err) {
    logger.error(`[ebay-list] ${groupid} LISTED on eBay as ${pub.itemId} but the record failed:`, err.message);
    return res.json({
      return_code: 'RECORD_FAILED',
      message: `${groupid} is live on eBay (item ${pub.itemId}) but BCWEB couldn't record it — tell Claude/the developer before listing it again`,
      item_id: pub.itemId, url,
    });
  }

  return res.json({ return_code: 'SUCCESS', item_id: pub.itemId, url, sizes: pub.sizes.length, pairs, warnings: pub.warnings });
});

module.exports = router;
