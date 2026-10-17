/*
=======================================================================================================================================
API Route: slider_groups
=======================================================================================================================================
Method: GET
Purpose: Pricing Slider home — every slider group with its rules and where its products stand: how many are sliding, found (sold and
         holding), at the floor, how many moves are due today, and the date the last sliding product would reach its floor if every move
         is pressed on time and nothing sells (`floor_by`). Ended groups come back too (state 'ended'); the screen files them under their
         own tab. The numbers come from utils/sliderMembers.js, the same read the group page uses, so a tile and its page can't disagree.
         Read-only. Requires auth.
=======================================================================================================================================
Request Query Params: none

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-10-17",                        // Europe/London — what "due" is measured against
  "groups": [
    {
      "id": 3, "name": "Caprice NEW", "channel": "SHP", "state": "active",          // active | paused | ended
      "step_pct": 2.3, "every_days": 2, "floor_pct": 50, "floor_breakeven": false, "stop_after_sales": 1,
      "due_date": "2026-11-30",                  // or null
      "notes": null,
      "created_by": "Andreas", "created_at": "2026-10-17T09:12:00.000Z",
      "counts": { "sliding": 4, "found": 1, "floor": 0, "ended": 2 },
      "due_now": 3,                              // products the next press acts on (utils/slider.js → decide: a move, a sale, a hand price…)
      "no_stock": 1,                             // due, but waiting for stock (it can't sell, so it isn't cut)
      "off_track": 0,                            // live products priced by hand since the slider last set them
      "floor_by": "2026-11-28"                   // latest floor date among sliding products; null if none sliding
    }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { loadMembers } = require('../utils/sliderMembers');
const { DUE_ACTIONS, londonDate } = require('../utils/slider');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const g = await query(`
      SELECT id, name, channel, state, step_pct, every_days, floor_pct, floor_breakeven, stop_after_sales,
             due_date::text AS due_date, notes, created_by, created_at
      FROM slider_group
      ORDER BY (state = 'ended'), created_at DESC
    `);
    const members = await loadMembers({ groupIds: g.rows.map((r) => r.id) });
    const today = londonDate();

    const groups = g.rows.map((r) => {
      const mine = members.filter((m) => m.group_id === r.id);
      const sliding = mine.filter((m) => m.state === 'sliding');
      const floorDates = sliding.map((m) => m.floor_by).filter(Boolean).sort();
      return {
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
        created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
        counts: {
          sliding: sliding.length,
          found: mine.filter((m) => m.state === 'found').length,
          floor: mine.filter((m) => m.state === 'floor').length,
          ended: mine.filter((m) => !m.live).length,
        },
        // decide() already says nothing for a paused group — pausing is exactly "don't move these".
        due_now: mine.filter((m) => DUE_ACTIONS.includes(m.action)).length,
        no_stock: mine.filter((m) => m.action === 'no_stock').length,
        off_track: mine.filter((m) => m.off_track).length,
        floor_by: floorDates.length ? floorDates[floorDates.length - 1] : null,
      };
    });

    return res.json({ return_code: 'SUCCESS', today, groups });
  } catch (err) {
    logger.error('[slider-groups] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the sliders' });
  }
});

module.exports = router;
