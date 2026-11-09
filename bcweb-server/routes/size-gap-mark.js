/*
=======================================================================================================================================
API Route: size_gap_mark
=======================================================================================================================================
Method: POST
Purpose: Mark one or more GAP SIZES on Size gaps (owner, 2026-11-08): Park 14 · 30 · 90 days · Not made · Ordered. Rules in
         utils/sizeGaps.js (THE copy). Per size only — a whole style is dealt with by sending all its gap sizes.
           park14/30/90    until = today + 14 / 30 / 90 days, back on the list on that day (owner 2026-11-09: all in days)
           notmade         never ends; released by hand (POST /size-gap-release)
           ordered         until = today + 90 days
         Every mark also ends when the size ARRIVES (a Goods In since the mark) — utils/sizeGaps.js.
         Each size is checked against the LIVE list here: only a size that is a gap right now can be marked (a held, on-order or
         selling size has nothing to mark) — others are skipped and named. Marking a marked size again overwrites its mark.
         WRITES size_gap_mark only, plus one bclog row (section 'Size gaps'), in ONE transaction. Never a price, never a review date,
         never Can't get. Requires auth. marked_by = the signed-in user (server-side, never sent).
=======================================================================================================================================
Request Payload:
{
  "mark": "park14" | "park30" | "park90" | "notmade" | "ordered",
  "sizes": [ { "groupid": "JLH950-BLAZE-BLACK", "uk": 9 }, ... ]     // 1–500
}

Success Response:
{ "return_code": "SUCCESS", "saved": 6, "until": "2027-02-08" | null, "skipped": ["JLH950-BLAZE-BLACK 4"] }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BAD_MARK"
"NO_SIZES"
"NOTHING_TO_MARK"            // none of the sizes is a gap right now
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog } = require('../utils/bclog');
const { LONDON_TODAY_SQL } = require('../utils/sql');
const { MARKS, readSizeGaps } = require('../utils/sizeGaps');
const logger = require('../utils/logger');

router.use(verifyToken);

// The bclog wording per choice.
const LOG_WORD = { park14: 'Parked 14 days', park30: 'Parked 30 days', park90: 'Parked 90 days', notmade: 'Not made', ordered: 'Ordered' };

router.post('/', async (req, res) => {
  const choice = req.body?.mark;
  const cfg = MARKS[choice];
  if (!cfg) return res.json({ return_code: 'BAD_MARK', message: 'Pick Park 14, 30 or 90 days, Not made or Ordered' });
  const seen = new Set();
  const sizes = (Array.isArray(req.body?.sizes) ? req.body.sizes : [])
    .filter((s) => s && typeof s.groupid === 'string' && s.groupid.trim() && Number.isInteger(s.uk))
    .map((s) => ({ groupid: s.groupid.trim(), uk: s.uk }))
    .filter((s) => { const k = `${s.groupid}|${s.uk}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!sizes.length || sizes.length > 500) return res.json({ return_code: 'NO_SIZES', message: 'Pick 1–500 sizes' });

  try {
    const who = req.user.display_name;
    // Only a size that is a GAP on the live list can be marked.
    const { styles } = await readSizeGaps();
    const gap = new Set();
    for (const st of styles) for (const z of st.sizes) if (z.state === 'gap') gap.add(`${st.groupid}|${z.uk}`);
    const ok = sizes.filter((s) => gap.has(`${s.groupid}|${s.uk}`));
    const skipped = sizes.filter((s) => !gap.has(`${s.groupid}|${s.uk}`)).map((s) => `${s.groupid} ${s.uk}`);
    if (!ok.length) return res.json({ return_code: 'NOTHING_TO_MARK', message: 'None of these sizes is a gap right now', skipped });

    // until as text in SQL (CLAUDE.md: never hand a pg DATE to the JS Date parser). Whole days from London today.
    let until = null;
    if (cfg.days) {
      const r = await query(`SELECT to_char(${LONDON_TODAY_SQL} + $1::int, 'YYYY-MM-DD') AS d`, [cfg.days]);
      until = r.rows[0].d;
    }

    await withTransaction(async (client) => {
      // One statement for every size (no N+1): unnest the two arrays side by side.
      await client.query(
        `INSERT INTO size_gap_mark (groupid, uk, mark, until, marked_at, marked_by)
         SELECT g, u, $3, $4::date, now(), $5 FROM unnest($1::text[], $2::int[]) AS t(g, u)
         ON CONFLICT (groupid, uk) DO UPDATE
           SET mark = EXCLUDED.mark, until = EXCLUDED.until, marked_at = EXCLUDED.marked_at, marked_by = EXCLUDED.marked_by`,
        [ok.map((s) => s.groupid), ok.map((s) => s.uk), cfg.mark, until, who]);
      await writeBcLog(client, {
        who,
        section: 'Size gaps',
        log: `${LOG_WORD[choice]}${until ? ` until ${until}` : ''}: ${ok.map((s) => `${s.groupid} ${s.uk} UK`).join(', ')}`,
      });
    });
    return res.json({ return_code: 'SUCCESS', saved: ok.length, until, skipped });
  } catch (err) {
    logger.error('[size-gap-mark] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save the mark' });
  }
});

module.exports = router;
