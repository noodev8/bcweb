/*
=======================================================================================================================================
API Route: slider_group_save
=======================================================================================================================================
Method: POST
Purpose: Create a Pricing Slider group, or change an existing group's rules. Rules (utils/slider.js → validateRules):
           step       stepPct  % of each product's RRP per move (0.1–50)
           every      everyDays a move is due this many days after the last (1–60)
           floor      floorPct  never below this % of RRP (1–99) — the human's choice, deliberately not restricted (owner: "they might
                                just want to clear some rubbish too")
           break-even floorBreakeven — opt-in protection: also never below break-even
           stop after stopAfterSales 1 | 2 | 3 sales since joining
           due date   dueDate  optional; the screen suggests one from the rules
         The CHANNEL is set once, at creation — the members of a Shopify group are styles and of an Amazon group SKUs, so it can't change.
         Edited rules apply from the next move (nothing already set is re-priced). An ended group can't be edited.

         WRITES slider_group + one slider_event ('created' / 'edited', the change in its detail) in one transaction, and one bclog line,
         section 'Slider' (who did what, the platform-wide activity log). Requires auth.
=======================================================================================================================================
Request Payload:
{
  "id": 3,                       // omit to CREATE
  "name": "Caprice NEW",
  "channel": "SHP",              // 'SHP' | 'AMZ' — create only (ignored on edit)
  "stepPct": 2.3, "everyDays": 2, "floorPct": 50, "floorBreakeven": false, "stopAfterSales": 1,
  "dueDate": "2026-11-30",       // or null / omitted
  "notes": "NEW winter styles"    // optional
}

Success Response:
{ "return_code": "SUCCESS", "id": 3, "created": true }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"INVALID_RULES"     // message says which rule
"NOT_FOUND"
"GROUP_ENDED"       // an ended group's rules are history
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { validateRules } = require('../utils/slider');
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

// "step 2% → 2.5%, every 2 → 3 days" — the edit event's detail, so the log says what changed, not just that something did.
function describeChanges(before, r) {
  const parts = [];
  const pct = (v) => `${Number(v)}%`;
  if (before.name !== r.name) parts.push(`name ${before.name} → ${r.name}`);
  if (Number(before.step_pct) !== r.stepPct) parts.push(`step ${pct(before.step_pct)} → ${pct(r.stepPct)}`);
  if (Number(before.every_days) !== r.everyDays) parts.push(`every ${before.every_days} → ${r.everyDays} days`);
  if (Number(before.floor_pct) !== r.floorPct) parts.push(`floor ${pct(before.floor_pct)} → ${pct(r.floorPct)}`);
  if (before.floor_breakeven !== r.floorBreakeven) parts.push(`break-even ${r.floorBreakeven ? 'on' : 'off'}`);
  if (Number(before.stop_after_sales) !== r.stopAfterSales) parts.push(`stop after ${before.stop_after_sales} → ${r.stopAfterSales} sales`);
  if ((before.due_date || null) !== r.dueDate) parts.push(`due ${before.due_date || 'none'} → ${r.dueDate || 'none'}`);
  if ((before.notes || null) !== r.notes) parts.push('notes');
  return parts.join(', ');
}

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const hasId = body.id !== undefined && body.id !== null && body.id !== '';
    const id = hasId ? Number(body.id) : null;
    if (hasId && (!Number.isInteger(id) || id < 1)) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Slider not found' });
    }

    const v = validateRules(body, { creating: !hasId });
    if (v.error) return res.json({ return_code: v.error, message: v.message });
    const r = v.rules;
    const who = req.user.display_name;

    const out = await withTransaction(async (client) => {
      if (!hasId) {
        const ins = await client.query(`
          INSERT INTO slider_group (name, channel, step_pct, every_days, floor_pct, floor_breakeven, stop_after_sales, due_date, notes,
                                    created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10)
          RETURNING id
        `, [r.name, r.channel, r.stepPct, r.everyDays, r.floorPct, r.floorBreakeven, r.stopAfterSales, r.dueDate, r.notes, who]);
        const newId = ins.rows[0].id;
        await client.query(
          `INSERT INTO slider_event (group_id, event, detail, created_by) VALUES ($1, 'created', $2, $3)`,
          [newId, `${r.channel} · step ${r.stepPct}% every ${r.everyDays} days · floor ${r.floorPct}%${r.floorBreakeven ? ' + break-even' : ''} · stop after ${r.stopAfterSales}`, who]
        );
        await writeBcLog(client, { who, section: 'Slider', log: `Created slider "${r.name}" (${r.channel})` });
        return { id: newId, created: true };
      }

      const cur = await client.query(
        `SELECT name, state, step_pct, every_days, floor_pct, floor_breakeven, stop_after_sales, due_date::text AS due_date, notes
         FROM slider_group WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (cur.rows.length === 0) return { error: 'NOT_FOUND', message: 'Slider not found' };
      const before = cur.rows[0];
      if (before.state === 'ended') return { error: 'GROUP_ENDED', message: 'This slider has ended — its rules are history' };

      const changes = describeChanges(before, r);
      if (!changes) return { id, created: false };   // nothing changed: no write, no log line

      await client.query(`
        UPDATE slider_group
           SET name = $2, step_pct = $3, every_days = $4, floor_pct = $5, floor_breakeven = $6, stop_after_sales = $7,
               due_date = $8::date, notes = $9, updated_by = $10, updated_at = now()
         WHERE id = $1
      `, [id, r.name, r.stepPct, r.everyDays, r.floorPct, r.floorBreakeven, r.stopAfterSales, r.dueDate, r.notes, who]);
      await client.query(
        `INSERT INTO slider_event (group_id, event, detail, created_by) VALUES ($1, 'edited', $2, $3)`,
        [id, changes.slice(0, 250), who]
      );
      await writeBcLog(client, { who, section: 'Slider', log: `Edited slider "${r.name}": ${changes}` });
      return { id, created: false };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    return res.json({ return_code: 'SUCCESS', id: out.id, created: out.created });
  } catch (err) {
    logger.error('[slider-group-save] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save the slider' });
  }
});

module.exports = router;
