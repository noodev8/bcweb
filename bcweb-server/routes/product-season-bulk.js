/*
=======================================================================================================================================
API Route: product_season_bulk   (Back Office → Seasons)
=======================================================================================================================================
Method: POST
Purpose: Set skusummary.season on a batch of styles in one go — the Seasons screen's bulk bar. The owner reviews the year picture
         (GET /product-seasons) and moves styles between Summer | Winter | Any; see that route for why season matters (it decides
         whether a high earner is a WINNER or HARVEST out of season).

         Writes EXACTLY what Add/Modify's product-update writes for season: the column, plus the legacy `updated` text stamp and
         `updated_date`. Nothing is pushed anywhere — season is not on the Shopify listing. Rows already on the target season are
         skipped (not re-stamped), so `updated` only moves on a real change.

         Does NOT re-tag the portfolio status. The screen offers that as a separate step (POST /portfolio-snapshot-update), so a run of
         several bulk changes costs one re-tag, and "Update now" stays the single deliberate act that writes the tags.

         One bclog row per call (section 'Seasons', who = the operator) in the same transaction — the activity Log shows it, and the
         Seasons screen reads the latest one back as "last changed".

         Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupids": ["0034701-MILANO", "JLH950-BLAZE-NAVY"],   // 1..MAX_BATCH
  "season": "Any"                                        // Summer | Winter | Any
}

Success Response:
{
  "return_code": "SUCCESS",
  "season": "Any",
  "changed": ["0034701-MILANO"],     // the rows actually moved
  "unchanged": 1                     // already on that season, or not found
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_SEASON"
"TOO_MANY"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

const SEASONS = ['Summer', 'Winter', 'Any'];
// The whole catalogue is ~300 styles; this only stops a runaway client.
const MAX_BATCH = 500;

// Legacy `updated` stamp: 'YYYYMMDD HH24:MI:SS', UK wall-clock — same expression as routes/product-update.js.
const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const season = String(body.season || '').trim();
    const groupids = Array.isArray(body.groupids)
      ? [...new Set(body.groupids.map((g) => String(g || '').trim()).filter(Boolean))]
      : [];

    if (!season || groupids.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'season and groupids are required' });
    }
    if (!SEASONS.includes(season)) {
      return res.json({ return_code: 'INVALID_SEASON', message: `season must be one of ${SEASONS.join(', ')}` });
    }
    if (groupids.length > MAX_BATCH) {
      return res.json({ return_code: 'TOO_MANY', message: `At most ${MAX_BATCH} styles at a time` });
    }

    const changed = await withTransaction(async (client) => {
      // Case-insensitive "already there" test: the column is legacy free text.
      const u = await client.query(
        `UPDATE skusummary
            SET season = $1, updated = ${UPDATED_EXPR}, updated_date = now()
          WHERE groupid = ANY($2::text[])
            AND LOWER(TRIM(COALESCE(season, ''))) <> LOWER($1)
          RETURNING groupid`,
        [season, groupids]
      );
      const ids = u.rows.map((x) => x.groupid);
      if (ids.length > 0) {
        await writeBcLog(client, {
          who: req.user.display_name,
          section: 'Seasons',
          log: `Season → ${season}: ${ids.length} style${ids.length === 1 ? '' : 's'} (${ids.join(', ')})`,
        });
      }
      return ids;
    });

    return res.json({ return_code: 'SUCCESS', season, changed, unchanged: groupids.length - changed.length });
  } catch (err) {
    logger.error('[product-season-bulk] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update seasons' });
  }
});

module.exports = router;
