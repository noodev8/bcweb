/*
=======================================================================================================================================
API Route: slider_add
=======================================================================================================================================
Method: POST
Purpose: Put chosen products into a Pricing Slider group (the add screen's ticked rows). Nothing is re-priced here — joining records the
         product's current price as its start and the slider's last price; the first MOVE is due straight away (owner, 2026-10-17) and is
         made from the group page like every other move (POST /slider-step).

         START FROM
           current  the first move is the first step down from today's price.
           rrp      the first move lifts it back to RRP (e.g. off an old clearance price), which then gets a full interval before the
                    first cut. A product already AT its RRP is simply recorded as 'current' — there is nothing to lift.

         EACH PRODUCT IS CHECKED ON ITS OWN; a refused one doesn't stop the rest, and `failed` says why:
           Not found / Not live on Shopify   SHP needs skusummary.shopify = 1 — an off-Shopify style can't sell, so sliding it tests nothing
           No RRP / No price                 steps and floor are % of RRP; the start is today's price — both must be readable
           Floor is at or above RRP          only possible with break-even ticked: the product can't be sold at a profit even at RRP
           Already at or below the floor     (start from current) there's no room to slide
           Already in this slider
           In slider "<name>"                it's live in ANOTHER group on this channel — refused unless `move` is true, in which case it
                                             leaves that group (state 'moved') and joins this one, starting from its price now
         The checks use the same floor rule the slider steps with (utils/slider.js → floorFor).

         WRITES slider_member (+ the moved-from row) and slider_event rows in one transaction, and one bclog line, section 'Slider'.
         A paused group accepts products (they wait with it); an ended group doesn't. Requires auth.
=======================================================================================================================================
Request Payload:
{ "groupId": 3,
  "keys": ["22152-42-019", "…"],      // groupids (SHP group) or codes (AMZ group), 1-500
  "startFrom": "current",             // 'current' | 'rrp'
  "move": false }                     // true = take products out of another slider on this channel

Success Response:
{ "return_code": "SUCCESS",
  "done":   ["22152-42-019"],
  "moved":  ["…"],                    // the subset of done that came from another slider
  "failed": [ { "key": "…", "error": "No RRP" } ] }
SUCCESS even when some products failed — failed says which.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"GROUP_ENDED"
"CONFLICT"          // someone added one of these products to a slider at the same moment — nothing was added; reload and try again
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { AMZ_NOW_CTES, LIVE_STATES, breakevenFor, floorFor } = require('../utils/slider');
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_KEYS = 500;   // the platform's bulk cap (collection-tag-set, pricing-park-bulk)
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const money = (n) => `£${Number(n).toFixed(2)}`;

// The product facts the checks need, for every requested key in one query (no N+1). NB: no backticks inside — JS template literals.
const SHP_FACTS = `
  SELECT ss.groupid AS key, ss.groupid, COALESCE(ss.shopify, 0) = 1 AS sellable,
         ${safeNumeric('ss.shopifyprice')} AS price, ${safeNumeric('ss.rrp')} AS rrp, ${safeNumeric('ss.cost')} AS cost,
         NULL::text AS fbafee, ss.tax
  FROM skusummary ss WHERE ss.groupid = ANY($1::text[])
`;
const AMZ_FACTS = `
  WITH ${AMZ_NOW_CTES}
  SELECT a.code AS key, a.groupid, true AS sellable,
         COALESCE(an.price, ${safeNumeric('a.amzprice')}) AS price, ${safeNumeric('ss.rrp')} AS rrp, ${safeNumeric('ss.cost')} AS cost,
         ${safeNumeric('a.fbafee')} AS fbafee, ss.tax
  FROM amzfeed a
  LEFT JOIN skusummary ss ON ss.groupid = a.groupid
  LEFT JOIN amz_now an    ON an.code = a.code
  WHERE a.code = ANY($1::text[])
`;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const groupId = Number(body.groupId);
    const startFrom = body.startFrom;
    const move = body.move === true;
    if (!Number.isInteger(groupId) || groupId < 1 || !Array.isArray(body.keys) || !['current', 'rrp'].includes(startFrom)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `groupId, keys (1-${MAX_KEYS}) and startFrom (current or rrp) are required` });
    }
    const keys = Array.from(new Set(body.keys.filter((k) => typeof k === 'string' && k.trim() !== '').map((k) => k.trim())));
    if (keys.length === 0 || keys.length > MAX_KEYS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `keys must hold 1-${MAX_KEYS} products` });
    }
    const who = req.user.display_name;

    const out = await withTransaction(async (client) => {
      // Lock the group so its rules (the floor) can't change under the checks, and an end can't interleave with the add.
      const g = await client.query(
        `SELECT id, name, channel, state, floor_pct, floor_breakeven FROM slider_group WHERE id = $1 FOR UPDATE`,
        [groupId]
      );
      if (g.rows.length === 0) return { error: 'NOT_FOUND', message: 'Slider not found' };
      const group = g.rows[0];
      if (group.state === 'ended') return { error: 'GROUP_ENDED', message: 'This slider has ended — make a new one' };

      // One after the other, not Promise.all: both run on the one transaction client, which takes a single query at a time.
      const facts = await client.query(group.channel === 'SHP' ? SHP_FACTS : AMZ_FACTS, [keys]);
      const live = await client.query(`
        SELECT m.id, m.item_key, m.group_id, g.name
        FROM slider_member m JOIN slider_group g ON g.id = m.group_id
        WHERE m.channel = $1 AND m.item_key = ANY($2::text[]) AND m.state = ANY($3::text[])
        FOR UPDATE OF m
      `, [group.channel, keys, LIVE_STATES]);
      const factByKey = new Map(facts.rows.map((r) => [r.key, r]));
      const liveByKey = new Map(live.rows.map((r) => [r.item_key, r]));

      const done = [];
      const moved = [];
      const failed = [];

      for (const key of keys) {
        const f = factByKey.get(key);
        const fail = (error) => failed.push({ key, error });
        if (!f) { fail('Not found'); continue; }
        if (!f.sellable) { fail('Not live on Shopify'); continue; }
        const rrp = num(f.rrp);
        const price = num(f.price);
        if (rrp === null || rrp <= 0) { fail('No RRP'); continue; }
        if (price === null || price <= 0) { fail('No price'); continue; }

        const breakeven = breakevenFor(group.channel, { cost: f.cost, fbafee: f.fbafee, tax: f.tax });
        const { floor, byBreakeven } = floorFor(group, { rrp, breakeven });
        if (floor >= rrp) { fail(`Floor is at or above RRP (break-even ${money(floor)})`); continue; }

        // Already at RRP: nothing to lift, so it starts like any other product.
        const from = startFrom === 'rrp' && price !== rrp ? 'rrp' : 'current';
        if (from === 'current' && price <= floor) {
          fail(`Already at or below the floor (${money(floor)}${byBreakeven ? ', break-even' : ''})`);
          continue;
        }

        const current = liveByKey.get(key);
        if (current && current.group_id === groupId) { fail('Already in this slider'); continue; }
        if (current && !move) { fail(`In slider "${current.name}"`); continue; }

        if (current) {
          await client.query(
            `UPDATE slider_member SET state = 'moved', ended_by = $2, ended_at = now() WHERE id = $1`,
            [current.id, who]
          );
          await client.query(
            `INSERT INTO slider_event (group_id, member_id, event, old_price, new_price, detail, created_by)
             VALUES ($1, $2, 'moved', $3, $3, $4, $5)`,
            [current.group_id, current.id, price, `Moved to "${group.name}"`.slice(0, 250), who]
          );
        }

        const ins = await client.query(`
          INSERT INTO slider_member (group_id, channel, item_key, groupid, rrp, start_from, start_price, last_price, joined_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
          RETURNING id
        `, [groupId, group.channel, key, f.groupid, rrp, from, price, who]);
        const detail = [
          from === 'rrp' ? `Start from RRP ${money(rrp)}` : 'Start from current price',
          current ? `moved from "${current.name}"` : null,
        ].filter(Boolean).join(', ');
        await client.query(
          `INSERT INTO slider_event (group_id, member_id, event, new_price, detail, created_by) VALUES ($1, $2, 'joined', $3, $4, $5)`,
          [groupId, ins.rows[0].id, price, detail.slice(0, 250), who]
        );
        done.push(key);
        if (current) moved.push(key);
      }

      if (done.length > 0) {
        await writeBcLog(client, {
          who, section: 'Slider',
          log: `Added ${done.length} to slider "${group.name}"${moved.length ? ` (${moved.length} moved)` : ''}`,
        });
      }
      return { done, moved, failed };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    return res.json({ return_code: 'SUCCESS', done: out.done, moved: out.moved, failed: out.failed });
  } catch (err) {
    // 23505 = the live-membership unique index: another add put one of these products in a slider between our read and our insert.
    // The whole batch rolled back, so nothing half-happened.
    if (err.code === '23505') {
      return res.json({ return_code: 'CONFLICT', message: 'One of these products was just added to a slider by someone else — reload and try again' });
    }
    logger.error('[slider-add] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to add products to the slider' });
  }
});

module.exports = router;
