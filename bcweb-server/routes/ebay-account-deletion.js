/*
=======================================================================================================================================
API Route: ebay_account_deletion
=======================================================================================================================================
Method: GET (eBay's endpoint check) · POST (a deletion notice)
Purpose: eBay's Marketplace Account Deletion endpoint. eBay won't enable a production keyset until the app either answers these
         notices or opts out; we can't honestly opt out, because EB orders keep the buyer's name and address (owner, 2026-10-31: build
         the endpoint). When an eBay user closes their account, eBay POSTs their username here and we blank what we hold about them.

PUBLIC — NO verifyToken. eBay is the caller and has no BCWEB login. What keeps it safe:
  * GET only answers eBay's challenge (a hash; reveals nothing).
  * POST does nothing unless X-EBAY-SIGNATURE verifies against eBay's public key (utils/ebayNotification.js). A forged POST is answered
    and ignored, so nobody can blank our addresses by guessing the URL.

WHAT A VERIFIED NOTICE DOES (one transaction):
  1. finds that buyer's EB orders in ebay_order_buyer (written by the eBay order import; migrations/20261031_ebay_order_buyer.sql);
  2. blanks shippingname, company, address1/2, city, county, postcode, phone, email and shippingnotes on those orders in orderstatus
     AND orderstatus_archive — country, codes, qty, dates and the sales rows stay (sales holds no personal data, and the sale itself is
     a business record we must keep);
  3. deletes the buyer's ebay_order_buyer rows, so the username itself is gone;
  4. writes a bclog line with the COUNT only — never the username.
  An order still open when its buyer closes the account loses its address too; eBay cancels those orders itself.
  A notice for a buyer we hold nothing on (most of them — eBay sends every closure to every app) does nothing and is still answered.

HTTP 200 ALWAYS (API-RULES), including when we couldn't process a genuine notice (key fetch or DB failed). eBay only RETRIES on a non-2xx
answer, so such a notice is logged as an error and NOT retried — acceptable while we hold little eBay data. Answering 500 there would
get the retry but breaks API-RULES; that's the owner's call, not a quiet fix.

THE CHALLENGE ANSWER IS eBay's SHAPE, not our envelope: exactly { "challengeResponse": "<hex>" } with no return_code, because that is
what eBay checks for. apiLogger records it as NO_RETURN_CODE, which is expected.
=======================================================================================================================================
GET ?challenge_code=abc
  -> { "challengeResponse": "52161ff4651cb71888801b47bae62f44d7f6d0aab17e70d00f64fc84368ca38f" }
  -> { "return_code": "NOT_CONFIGURED" | "MISSING_CHALLENGE_CODE", "message": "…" }

POST (eBay's notification JSON)
  { "metadata": { "topic": "MARKETPLACE_ACCOUNT_DELETION", ... },
    "notification": { "notificationId": "...", "data": { "username": "...", "userId": "...", "eiasToken": "..." } } }
  -> { "return_code": "SUCCESS", "orders_cleared": 0 }
=======================================================================================================================================
Return Codes:
"SUCCESS"                  notice verified and handled (orders_cleared may be 0)
"NOT_CONFIGURED"           EBAY_VERIFICATION_TOKEN / EBAY_DELETION_ENDPOINT (GET) or EBAY_CLIENT_ID / _SECRET (POST) missing
"MISSING_CHALLENGE_CODE"   GET without ?challenge_code
"SIGNATURE_INVALID"        POST not signed by eBay — ignored
"IGNORED"                  verified, but not an account-deletion notice or no username in it
"SERVER_ERROR"             couldn't verify or couldn't write — nothing changed
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { withTransaction } = require('../utils/transaction');
const { challengeResponse, verifySignature } = require('../utils/ebayNotification');
const logger = require('../utils/logger');

const TOPIC = 'MARKETPLACE_ACCOUNT_DELETION';

router.get('/', (req, res) => {
  try {
    const { verificationToken, deletionEndpoint } = config.ebay;
    if (!verificationToken || !deletionEndpoint) {
      return res.json({ return_code: 'NOT_CONFIGURED', message: 'Needs EBAY_VERIFICATION_TOKEN and EBAY_DELETION_ENDPOINT in bcweb-server/.env' });
    }
    const code = req.query.challenge_code;
    if (!code || typeof code !== 'string') {
      return res.json({ return_code: 'MISSING_CHALLENGE_CODE', message: 'eBay sends ?challenge_code=' });
    }
    return res.json({ challengeResponse: challengeResponse(code) });
  } catch (err) {
    logger.error('[ebay-account-deletion] challenge error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not answer the challenge' });
  }
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const notificationId = body.notification && body.notification.notificationId;
  try {
    let genuine;
    try {
      genuine = await verifySignature(body, req.get('x-ebay-signature'));
    } catch (err) {
      // Couldn't check at all (keys missing, eBay unreachable). Not the same as a bad signature — a genuine notice may be lost here.
      logger.error(`[ebay-account-deletion] could not verify notice ${notificationId || '?'}: ${err.message}`);
      return res.json({
        return_code: err.code === 'EBAY_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'SERVER_ERROR',
        message: 'Could not verify the notice'
      });
    }
    if (!genuine) {
      // error, not info: production runs LOG_LEVEL=error and someone probing this URL is worth seeing.
      logger.error('[ebay-account-deletion] POST with a missing or invalid eBay signature — ignored');
      return res.json({ return_code: 'SIGNATURE_INVALID', message: 'Not signed by eBay' });
    }

    const topic = body.metadata && body.metadata.topic;
    const data = (body.notification && body.notification.data) || {};
    const username = typeof data.username === 'string' ? data.username.trim() : '';
    if (topic !== TOPIC || !username) {
      return res.json({ return_code: 'IGNORED', message: 'Not an account deletion notice with a username' });
    }

    const cleared = await withTransaction(async (client) => {
      const owned = await client.query(
        `SELECT ordernum FROM ebay_order_buyer WHERE LOWER(buyer_username) = LOWER($1)`,
        [username]
      );
      if (owned.rows.length === 0) return 0;
      const ordernums = owned.rows.map((r) => r.ordernum);

      for (const table of ['orderstatus', 'orderstatus_archive']) {
        await client.query(
          `UPDATE ${table}
              SET shippingname = '', company = '', address1 = '', address2 = '', city = '', county = '',
                  postcode = '', phone = '', email = '', shippingnotes = ''
            WHERE ordernum = ANY($1::text[])`,
          [ordernums]
        );
      }
      await client.query(`DELETE FROM ebay_order_buyer WHERE LOWER(buyer_username) = LOWER($1)`, [username]);

      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ('eBay', 'eBay', $1,
                 (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [`eBay account deletion: buyer details cleared on ${ordernums.length} order${ordernums.length === 1 ? '' : 's'}`]
      );
      return ordernums.length;
    });

    if (cleared) logger.info(`[ebay-account-deletion] notice ${notificationId || '?'}: cleared ${cleared} order(s)`);
    return res.json({ return_code: 'SUCCESS', orders_cleared: cleared });
  } catch (err) {
    logger.error(`[ebay-account-deletion] notice ${notificationId || '?'} failed: ${err.message}`);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not process the notice — nothing changed' });
  }
});

module.exports = router;
