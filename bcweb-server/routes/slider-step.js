/*
=======================================================================================================================================
API Route: slider_step
=======================================================================================================================================
Method: POST
Purpose: Pricing Slider "Move prices" — carry out the next press for ONE product (owner, 2026-10-17: no cron, "every move is a button
         press, like normal pricing"). One product per call, like bulk Apply loops W1 per row: the group page loops this over the products
         that are due, so each Shopify push fires and reports on its own row, with progress.

         WHAT IT DOES is utils/slider.js → decide(), RE-READ HERE INSIDE THE TRANSACTION (utils/sliderMembers.js with this client, after
         locking the member and the style's price row) — never what the screen showed, which may be minutes old or from before a colleague
         pressed the same button:
           repriced  priced by hand outside the slider → leaves the slider (state 'repriced'), price untouched
           found     sold stop_after_sales since joining → holds at its price (state 'found')
           hold      due, sold since its last move but fewer than stop_after_sales → holds another interval (clock restarts)
           floor     due, already at the floor → holds there (state 'floor')
           lift      due, Start from RRP → W1 to RRP
           step      due → W1 one step down (step_pct % of the RRP it joined with), never below the floor; landing on it = 'floor'
         Anything else (not due, waiting for stock, unreadable price, already done by someone else) writes nothing and comes back with
         action null and `wait` saying why — so a double click or two operators pressing at once can't move a price twice.

         PRICES GO THROUGH W1 (utils/priceWrite.js → writeShopifyPrice): skusummary.shopifyprice + a price_change_log row with the note
         "Slider · <group> · step n" (or "· back to RRP"), REVIEW DATE UNTOUCHED (owner — the slider badge is the indicator). The member
         update and its slider_event are in the SAME transaction. After the commit the price is pushed live to Shopify
         (utils/shopify.js → pushIfLive, best-effort: a failed push leaves the DB price standing and says so); Google follows on its sweep.
         No bclog line — price_change_log is the audit of a price, as for Apply and Reset.

         SHOPIFY ONLY for now: an Amazon slider's moves go into the team upload basket and count from upload — phase 3 of the build.
         Requires auth.
=======================================================================================================================================
Request Payload:
{ "memberId": 11 }

Success Response:
{ "return_code": "SUCCESS", "member_id": 11, "key": "22152-42-019",
  "action": "step",              // repriced | found | hold | floor | lift | step — or null when nothing was due
  "wait": null,                  // when action is null: no_stock | no_price | null (not due / already done)
  "old_price": 65, "new_price": 63.7,              // new_price = old_price unless lift / step
  "state": "sliding",            // the member's state after the press
  "warnings": [],                // W1's flags on a price write (BELOW_COST / ABOVE_RRP)
  "shopify": { "pushed": true, … } }               // a price write only; null = nothing sent
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"NOT_SUPPORTED"     // an Amazon slider (phase 3)
"MATCH_LOCKED"      // W1's retired Amazon-match lock (no style is flagged since 2026-09-15)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { writeShopifyPrice } = require('../utils/priceWrite');
const { loadMembers } = require('../utils/sliderMembers');
const { DUE_ACTIONS, WAITS, round2 } = require('../utils/slider');
const shopify = require('../utils/shopify');
const logger = require('../utils/logger');

router.use(verifyToken);

const money = (n) => `£${Number(n).toFixed(2)}`;

router.post('/', async (req, res) => {
  try {
    const memberId = Number((req.body || {}).memberId);
    if (!Number.isInteger(memberId) || memberId < 1) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'memberId is required' });
    }
    const who = req.user.display_name;

    const out = await withTransaction(async (client) => {
      // Lock the member first (a second press waits here, then finds nothing due), then the style's price row, so the price the
      // decision reads is the one the write replaces.
      const h = await client.query(`
        SELECT m.id, m.group_id, m.channel, m.groupid, m.steps, g.name AS group_name, g.every_days, g.stop_after_sales
        FROM slider_member m JOIN slider_group g ON g.id = m.group_id
        WHERE m.id = $1
        FOR UPDATE OF m
      `, [memberId]);
      if (h.rows.length === 0) return { error: 'NOT_FOUND', message: 'Not in a slider' };
      const head = h.rows[0];
      if (head.channel !== 'SHP') {
        return { error: 'NOT_SUPPORTED', message: 'Amazon sliders move from the upload basket — the next step of the build' };
      }
      await client.query(`SELECT 1 FROM skusummary WHERE groupid = $1 FOR UPDATE`, [head.groupid]);

      const [mb] = await loadMembers({ groupIds: [head.group_id], memberIds: [memberId], client });
      if (!mb) return { error: 'NOT_FOUND', message: 'Not in a slider' };
      const action = mb.action;
      if (!DUE_ACTIONS.includes(action)) {
        return { mb, action: null, wait: WAITS.includes(action) ? action : null, newPrice: mb.now, state: mb.state, written: null };
      }

      const event = async (name, oldPrice, newPrice, detail) => client.query(`
        INSERT INTO slider_event (group_id, member_id, event, old_price, new_price, detail, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [head.group_id, memberId, name, oldPrice, newPrice, detail.slice(0, 250), who]);

      // ---- the four that write no price ---------------------------------------------------------------------------------------------
      if (action === 'repriced') {
        await client.query(`UPDATE slider_member SET state = 'repriced', ended_by = $2, ended_at = now() WHERE id = $1`, [memberId, who]);
        await event('repriced', mb.last_price, mb.now, 'Priced outside the slider — left at that price');
        return { mb, action, newPrice: mb.now, state: 'repriced', written: null };
      }
      if (action === 'found') {
        await client.query(`UPDATE slider_member SET state = 'found', found_price = last_price, found_at = now() WHERE id = $1`, [memberId]);
        await event('found', mb.last_price, mb.last_price, `${mb.sold} sold since it joined — holds at this price`);
        return { mb, action, newPrice: mb.last_price, state: 'found', written: null };
      }
      if (action === 'hold') {
        // The clock restarts — from the sale if that reads later than now: a sale with no time reads as the END of its day
        // (utils/slider.js → soldAtSql), and restarting before it would count the same sale again at the next press.
        await client.query(`
          UPDATE slider_member SET last_move_at = GREATEST(now(), $2::timestamptz) WHERE id = $1
        `, [memberId, mb.sold_last_at]);
        await event('hold', mb.last_price, mb.last_price,
          `Sold ${mb.sold_since} since its last move (${mb.sold} of ${head.stop_after_sales}) — holds ${head.every_days} more day${Number(head.every_days) === 1 ? '' : 's'}`);
        return { mb, action, newPrice: mb.last_price, state: 'sliding', written: null };
      }
      if (action === 'floor') {
        await client.query(`UPDATE slider_member SET state = 'floor' WHERE id = $1`, [memberId]);
        await event('floor', mb.last_price, mb.last_price, `At the floor (${money(mb.floor)}) — holds here`);
        return { mb, action, newPrice: mb.last_price, state: 'floor', written: null };
      }

      // ---- lift / step: a price, through W1 ----------------------------------------------------------------------------------------
      const newPrice = round2(mb.next_price);
      const stepNo = Number(head.steps) + 1;
      const note = (action === 'lift'
        ? `Slider · ${head.group_name} · back to RRP`
        : `Slider · ${head.group_name} · step ${stepNo}`).slice(0, 500);
      const written = await writeShopifyPrice(client, { groupid: head.groupid, price: newPrice, reviewDays: null, note, changedBy: who });
      if (written.error) return { error: written.error, message: written.message };

      const atFloor = action === 'step' && newPrice <= round2(mb.floor);
      const state = atFloor ? 'floor' : 'sliding';
      await client.query(`
        UPDATE slider_member
           SET last_price = $2, last_log_id = $3, last_move_at = now(), steps = steps + 1, state = $4
         WHERE id = $1
      `, [memberId, newPrice, written.logId, state]);
      await event(action, mb.now, newPrice, action === 'lift'
        ? 'Back to RRP'
        : `Step ${stepNo} · −${money(round2(mb.now - newPrice))}${atFloor ? ' · reached the floor' : ''}`);

      return { mb, action, newPrice, state, written };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    const { mb, action, newPrice, state, written } = out;

    // AFTER the commit, as W1 does: a Shopify hiccup must never undo the committed price. A hold (same price) sends nothing.
    let shopifyResult = null;
    if (written && !written.isHold) shopifyResult = await shopify.pushIfLive(mb.groupid);

    return res.json({
      return_code: 'SUCCESS',
      member_id: memberId,
      key: mb.key,
      action,
      wait: out.wait ?? null,
      old_price: mb.now,
      new_price: newPrice,
      state,
      warnings: written ? written.warnings : [],
      shopify: shopifyResult,
    });
  } catch (err) {
    logger.error('[slider-step] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to move the price' });
  }
});

module.exports = router;
