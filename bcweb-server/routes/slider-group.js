/*
=======================================================================================================================================
API Route: slider_group
=======================================================================================================================================
Method: GET
Purpose: One Pricing Slider group's page — the group's rules, EVERY member it has ever had (live ones first: sliding, found, at floor;
         then the ones that left, with how they left) with their live numbers from utils/sliderMembers.js. The member numbers are the same ones the step acts on: current price on the
         channel, floor, the next move and its date, units sold since joining, `off_track` (priced by hand since the slider last
         set it), and `action` — what the next press of "Move prices" (POST /slider-step) does to it. Read-only. Requires auth.
=======================================================================================================================================
Request Query Params:
  id (integer, required) - the group

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-10-17",
  "group": { "id": 3, "name": "Caprice NEW", "channel": "SHP", "state": "active", "step_pct": 2.3, "every_days": 2, "floor_pct": 50,
             "floor_breakeven": false, "stop_after_sales": 1, "due_date": "2026-11-30", "notes": null,
             "created_by": "Andreas", "created_at": "…", "updated_by": null, "updated_at": null, "ended_at": null,
             "priced": false },          // true once the slider has written any price (then the group can be ended, not deleted)
  "members": [
    { "id": 11, "channel": "SHP", "key": "22152-42-019", "groupid": "22152-42-019", "size": null, "amz_sku": null,
      "title": "Caprice …", "brand": "Caprice", "rrp": 65, "start_from": "current", "start_price": 65, "last_price": 65, "now": 65,
      "now_pct_rrp": 100, "cost": 23.5, "breakeven": 35.11, "floor": 32.5, "floor_by_breakeven": false, "step": 1.5, "steps": 0,
      "stock": 9, "sold": 0, "sold_since": 0, "sold_last_at": null, "state": "sliding", "live": true, "off_track": false,
      "action": "step",          // utils/slider.js → decide(): repriced|found|hold|floor|lift|step (the next press), no_stock|no_price (waits), null
      "next_due": "2026-10-17", "next_price": 63.5, "lift": false, "moves_left": 22, "floor_by": "2026-11-28",
      "found_price": null, "found_at": null, "last_move_at": null,
      "joined_by": "Andreas", "joined_at": "…", "ended_by": null, "ended_at": null }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { loadMembers } = require('../utils/sliderMembers');
const { londonDate } = require('../utils/slider');
const logger = require('../utils/logger');

router.use(verifyToken);

const iso = (v) => (v ? new Date(v).toISOString() : null);

router.get('/', async (req, res) => {
  try {
    const id = Number(req.query.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'id is required' });
    }

    // `priced`: has the slider ever written a price for this group? Every price it writes (a step, the lift, a reset that changed the
    // price) stamps the member's last_log_id, which is NULL until then. Either way price_change_log / amz_price_log rows point at this
    // group's work, so it must stay as history.
    const g = await query(`
      SELECT g.id, g.name, g.channel, g.state, g.step_pct, g.every_days, g.floor_pct, g.floor_breakeven, g.stop_after_sales,
             g.due_date::text AS due_date, g.notes, g.created_by, g.created_at, g.updated_by, g.updated_at, g.ended_at,
             EXISTS (SELECT 1 FROM slider_member m WHERE m.group_id = g.id AND m.last_log_id IS NOT NULL) AS priced
      FROM slider_group g WHERE g.id = $1
    `, [id]);
    if (g.rows.length === 0) return res.json({ return_code: 'NOT_FOUND', message: 'Slider not found' });
    const r = g.rows[0];

    const members = await loadMembers({ groupIds: [id] });

    return res.json({
      return_code: 'SUCCESS',
      today: londonDate(),
      group: {
        id: r.id,
        name: r.name,
        channel: r.channel,
        state: r.state,
        step_pct: Number(r.step_pct),
        every_days: Number(r.every_days),
        floor_pct: Number(r.floor_pct),
        floor_breakeven: r.floor_breakeven,
        stop_after_sales: Number(r.stop_after_sales),
        due_date: r.due_date,
        notes: r.notes,
        created_by: r.created_by,
        created_at: iso(r.created_at),
        updated_by: r.updated_by,
        updated_at: iso(r.updated_at),
        ended_at: iso(r.ended_at),
        priced: r.priced,
      },
      members,
    });
  } catch (err) {
    logger.error('[slider-group] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the slider' });
  }
});

module.exports = router;
