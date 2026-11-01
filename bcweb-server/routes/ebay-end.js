/*
=======================================================================================================================================
API Route: ebay_end
=======================================================================================================================================
Method: POST
Purpose: END a BCWEB eBay listing — the Remove build (owner, 2026-11-01), the End listing button in a listing's sizes panel on the eBay
         listings screen. WRITES TO EBAY, then records it. Ends the whole listing (the style); a single dud size is priced down instead
         (POST /ebay-size-price), and a size at 0 stays on the listing hidden — nothing ends by itself.

THE ORDER:
  1. The listing must be a LIVE BCWEB listing (ebay_listing, ended_at IS NULL) — the trial / hand-made ones are ended in Seller Hub.
  2. eBay: Inventory API withdrawOfferByInventoryItemGroup — takes the whole variation listing off eBay. The inventory items, group and
     offers stay (unpublished), so listing the style again (POST /ebay-list) re-uses them and gets a NEW listing number. If eBay refuses
     because the listing has already ended (ended in Seller Hub), GetItem confirms it isn't Active and we just record it.
  3. Record: ebay_listing.ended_at / ended_by + a bclog row (section 'eBay'). From then on the stock sync leaves it alone (it only
     touches live listings) and the style shows on Not on eBay again. An ended row is kept — a style can be listed again.
     If eBay ended it but the record fails, RECORD_FAILED says so.
No stock moves: ending a listing doesn't touch our stock or any order already placed on it.

Requires auth.
=======================================================================================================================================
Request: POST /ebay-end   { "item_id": "287697687654" }

Success Response: { "return_code": "SUCCESS", "item_id": "…", "groupid": "…", "already_ended": false }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BAD_REQUEST"
"NOT_BCWEB_LISTING"     not a live BCWEB listing (end it in Seller Hub)
"EBAY_ERROR"            eBay refused and the listing is still live (eBay's words in message) — nothing recorded
"RECORD_FAILED"         ended on eBay, but BCWEB couldn't record it
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
const { ebayRest } = require('../utils/ebayRest');
const { MARKET } = require('../utils/ebayPolicies');
const { tradingCall, xmlBlock, xmlTag } = require('../utils/ebayTrading');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  const who = req.user.display_name;
  const itemId = String((req.body && req.body.item_id) || '').trim();
  if (!/^\d+$/.test(itemId)) return res.json({ return_code: 'BAD_REQUEST', message: 'No eBay listing given' });

  let listing;
  try {
    listing = (await query('SELECT id, groupid, group_key FROM ebay_listing WHERE item_id = $1 AND ended_at IS NULL', [itemId])).rows[0];
  } catch (err) {
    logger.error('[ebay-end] read error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not read the listing' });
  }
  if (!listing) return res.json({ return_code: 'NOT_BCWEB_LISTING', message: `eBay item ${itemId} isn't a live BCWEB listing — end it in Seller Hub` });

  // eBay — take the whole variation listing off.
  let alreadyEnded = false;
  try {
    await ebayRest('POST', '/sell/inventory/v1/offer/withdraw_by_inventory_item_group', {
      inventoryItemGroupKey: listing.group_key,
      marketplaceId: MARKET,
    });
  } catch (err) {
    // Refused — is it simply over already (ended in Seller Hub)? Then record it; otherwise it's still live and nothing is recorded.
    let status = '';
    try {
      status = xmlTag(xmlBlock(xmlBlock(await tradingCall('GetItem', `<ItemID>${itemId}</ItemID>`), 'Item'), 'SellingStatus'), 'ListingStatus');
    } catch { /* GetItem failed too — treat as still live */ }
    if (status && status !== 'Active') {
      alreadyEnded = true;
    } else {
      logger.error(`[ebay-end] ${itemId} withdraw failed:`, err.message);
      return res.json({ return_code: 'EBAY_ERROR', message: err.message });
    }
  }

  try {
    await withTransaction(async (client) => {
      await client.query('UPDATE ebay_listing SET ended_at = now(), ended_by = $1 WHERE id = $2', [who, listing.id]);
      await writeBcLog(client, {
        who,
        section: 'eBay',
        log: `Ended ${listing.groupid} on eBay (item ${itemId})${alreadyEnded ? ' — it had already ended on eBay' : ''}`,
      });
    });
  } catch (err) {
    logger.error(`[ebay-end] ${itemId} ended on eBay but the record failed:`, err.message);
    return res.json({ return_code: 'RECORD_FAILED', message: `${listing.groupid} is off eBay, but BCWEB couldn't record it` });
  }
  return res.json({ return_code: 'SUCCESS', item_id: itemId, groupid: listing.groupid, already_ended: alreadyEnded });
});

module.exports = router;
