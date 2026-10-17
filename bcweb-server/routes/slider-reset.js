/*
=======================================================================================================================================
API Route: slider_reset
=======================================================================================================================================
Method: POST
Purpose: Pricing Slider "Reset to RRP" — put ONE product back to its RRP and take it out of the slider (state 'reset'). One product per
         call, like the bulk Apply loops W1 per row: the screen loops this over the ticked rows, so each Shopify push fires and is
         reported on its own row.

         THE PRICE GOES THROUGH THE NORMAL WRITES (utils/priceWrite.js), so nothing about a reset is special downstream:
           SHP  W1 — skusummary.shopifyprice + a price_change_log row (note "Slider reset to RRP · <group>"), pushed live to Shopify
                after the commit (utils/shopify.js → pushIfLive, best-effort: a failed push leaves the DB price standing and says so);
                Google follows on its own sweep. Review date untouched.
           AMZ  W-A1 — an amz_price_log row; it reaches Amazon in the team's upload basket, so the response carries the basket item.
         The member update and its slider_event land in the SAME transaction as the price.

         RRP = skusummary.rrp now (if a buyer has corrected it since the product joined, the correction wins), else the RRP it joined
         with. A product already at RRP just leaves the slider — no price row is written for nothing.
         Only a live member (sliding / found / at floor) can be reset; one that already left may be in another slider now. Requires auth.
=======================================================================================================================================
Request Payload:
{ "memberId": 11 }

Success Response:
{ "return_code": "SUCCESS", "member_id": 11, "channel": "SHP", "key": "22152-42-019",
  "old_price": 52.65, "new_price": 65, "changed": true,         // changed false = it was already at RRP (no price written)
  "warnings": [],                                               // the price write's flags (W1 / W-A1), normally none at RRP
  "shopify": { "pushed": true, … },                             // SHP only; null = not live / nothing sent
  "basket": { "id": 4821, "code": "…", "amz_sku": "…", "size": "38", "title": "…", "segment": "…",
              "old_price": 52.65, "new_price": 65, "rrp": 65 } }   // AMZ only (null when nothing was written)
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"NOT_LIVE"          // the product has already left this slider
"MATCH_LOCKED"      // W1's retired Amazon-match lock (no style is flagged since 2026-09-15)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { writeShopifyPrice, writeAmzPrice, amzBasketItem } = require('../utils/priceWrite');
const { AMZ_NOW_CTES, LIVE_STATES, round2 } = require('../utils/slider');
const shopify = require('../utils/shopify');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.post('/', async (req, res) => {
  try {
    const memberId = Number((req.body || {}).memberId);
    if (!Number.isInteger(memberId) || memberId < 1) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'memberId is required' });
    }
    const who = req.user.display_name;

    const out = await withTransaction(async (client) => {
      // Lock the member so two operators (or a double click) can't reset it twice. NB: no backticks inside — JS template literal.
      const m = await client.query(`
        WITH ${AMZ_NOW_CTES}
        SELECT m.id, m.channel, m.item_key, m.groupid, m.rrp AS joined_rrp, m.state, g.name AS group_name,
               ${safeNumeric('ss.rrp')} AS rrp_now,
               CASE WHEN m.channel = 'SHP' THEN ${safeNumeric('ss.shopifyprice')}
                    ELSE COALESCE(an.price, ${safeNumeric('a.amzprice')}) END AS now
        FROM slider_member m
        JOIN slider_group g     ON g.id = m.group_id
        LEFT JOIN skusummary ss ON ss.groupid = m.groupid
        LEFT JOIN amzfeed a     ON m.channel = 'AMZ' AND a.code = m.item_key
        LEFT JOIN amz_now an    ON m.channel = 'AMZ' AND an.code = m.item_key
        WHERE m.id = $1
        FOR UPDATE OF m
      `, [memberId]);
      if (m.rows.length === 0) return { error: 'NOT_FOUND', message: 'Not in a slider' };
      const r = m.rows[0];
      if (!LIVE_STATES.includes(r.state)) return { error: 'NOT_LIVE', message: 'This product has already left the slider' };

      const rrpNow = num(r.rrp_now);
      const rrp = round2(rrpNow !== null && rrpNow > 0 ? rrpNow : Number(r.joined_rrp));
      const now = num(r.now);
      const changed = now === null || round2(now) !== rrp;
      const note = `Slider reset to RRP · ${r.group_name}`.slice(0, 500);

      let written = null;
      if (changed) {
        written = r.channel === 'SHP'
          ? await writeShopifyPrice(client, { groupid: r.groupid, price: rrp, reviewDays: null, note, changedBy: who })
          : await writeAmzPrice(client, { code: r.item_key, price: rrp, reviewDays: null, note, changedBy: who });
        if (written.error) return { error: written.error, message: written.message };
      }

      await client.query(`
        UPDATE slider_member
           SET state = 'reset', last_price = $2, last_log_id = COALESCE($3, last_log_id), ended_by = $4, ended_at = now()
         WHERE id = $1
      `, [memberId, rrp, written ? written.logId : null, who]);
      await client.query(`
        INSERT INTO slider_event (group_id, member_id, event, old_price, new_price, detail, created_by)
        SELECT group_id, id, 'reset', $2, $3, $4, $5 FROM slider_member WHERE id = $1
      `, [memberId, now, rrp, changed ? 'Reset to RRP' : 'Already at RRP — left the slider', who]);

      return { r, rrp, now, changed, written };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    const { r, rrp, now, changed, written } = out;

    // AFTER the commit, as W1 does: a Shopify hiccup must never undo the committed price. A same-price write pushes only if Shopify's
    // live price differs — the pricing-apply rule.
    let shopifyResult = null;
    if (r.channel === 'SHP' && changed && written) {
      shopifyResult = written.isHold ? await shopify.pushIfStale(r.groupid, rrp) : await shopify.pushIfLive(r.groupid);
    }

    // The Amazon basket item — the shape GET /amz-basket returns, so the page can drop it straight into the upload basket.
    const basket = r.channel === 'AMZ' && changed && written
      ? await amzBasketItem({ query }, { code: r.item_key, written, price: rrp })
      : null;

    return res.json({
      return_code: 'SUCCESS',
      member_id: memberId,
      channel: r.channel,
      key: r.item_key,
      old_price: now,
      new_price: rrp,
      changed,
      warnings: written ? written.warnings : [],
      shopify: shopifyResult,
      basket,
    });
  } catch (err) {
    logger.error('[slider-reset] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to reset to RRP' });
  }
});

module.exports = router;
