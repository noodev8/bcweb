/*
=======================================================================================================================================
API Route: google_ads_campaign_create
=======================================================================================================================================
Method: POST
Purpose: Google Ads module — add a campaign bucket name to the controlled list (`google_campaign`). Requires auth.

         Creates the NAME only. It puts no styles in it; that is /google-ads-assign. A new bucket is empty and appears in the
         campaign panel with 0 styles, which is deliberate — you have to be able to see an empty bucket to move things into it.

WHY A CONTROLLED LIST AT ALL
This name is written to `skusummary.googlecampaign` and shipped as Google's `custom_label_0`. A typo goes into the feed, reaches
Google, matches nothing in the Ads UI, and never announces itself. Nothing downstream validates it — not the feed script, not
Merchant Center, not Google Ads. This route is the only place a bad name can be stopped, so validation here is the whole safety net.

THE 20-CHARACTER LIMIT IS REAL AND IS THE COLUMN'S, NOT A STYLE CHOICE
`skusummary.googlecampaign` is `varchar(20)`. `google_campaign.name` is `varchar(20)` to match exactly, so a name that fits here is
guaranteed to fit there. The decision NOT to widen the column is recorded in spec §2.2: 20 is genuinely enough
(`BIRK-SUM-HARVEST` = 16, `ZERMATT-WINTER` = 14) and widening touches a column other PowerBuilder screens may still display. The
client shows a live counter so the limit is never discovered by finding a truncated label in the Ads UI.

WHY THE CHARACTER SET IS RESTRICTED
Letters, digits, space, hyphen, underscore and dot. Spaces are allowed because Google itself has used them — `RIEKER AW25` is a real
historical label found in the 13-month backfill. Commas are NOT allowed: the label travels through a tab-separated feed file and
comes back through a comma-separated report, and a comma in a label is an invitation for one of those to be misread. Leading and
trailing spaces are stripped rather than rejected, because they are invisible and nobody types one on purpose.

NAMES ARE CASE-INSENSITIVELY UNIQUE
'Zermatt' and 'ZERMATT' would be two buckets on this screen and one label in Google's eyes, since the comparison that matters is done
against a feed Google lower-cases anyway. Stored with the casing the operator typed, matched without regard to it.
=======================================================================================================================================
Request Payload:
{
  "name": "BIRK-HARVEST",
  "notes": "Summer Birkenstock being priced up while stock lasts"   // optional
}

Success Response:
{ "return_code": "SUCCESS", "campaign": { "name": "BIRK-HARVEST", "notes": "...", "archived": false } }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NAME_TOO_LONG"
"INVALID_NAME"
"DUPLICATE_NAME"
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

// Matches skusummary.googlecampaign's varchar(20). See the header — this is the column's limit, not a preference.
const MAX_NAME = 20;

// Letters, digits, space, hyphen, underscore, dot. No commas (feed/report round-trip), no other punctuation.
const NAME_OK = /^[A-Za-z0-9 ._-]+$/;

router.post('/', async (req, res) => {
  try {
    // Trim rather than reject on surrounding whitespace: it is invisible, nobody means it, and a rejection for it reads as a bug.
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : null;

    if (!name) return res.json({ return_code: 'MISSING_FIELDS', message: 'A campaign name is required' });
    if (name.length > MAX_NAME) {
      return res.json({
        return_code: 'NAME_TOO_LONG',
        message: `Campaign names are limited to ${MAX_NAME} characters (this one is ${name.length}). Google reads this from a database column that size.`,
      });
    }
    if (!NAME_OK.test(name)) {
      return res.json({
        return_code: 'INVALID_NAME',
        message: 'Use letters, numbers, spaces, hyphens, underscores or dots only. Commas in particular break the feed and the report.',
      });
    }

    const who = req.user.display_name || 'unknown';

    const created = await withTransaction(async (client) => {
      // Case-insensitive uniqueness, checked inside the transaction. The table's PK enforces exact uniqueness; this catches the
      // 'Zermatt' vs 'ZERMATT' case that would be two rows here and one label to Google.
      const clash = await client.query('SELECT name FROM google_campaign WHERE UPPER(name) = UPPER($1)', [name]);
      if (clash.rows.length > 0) {
        const e = new Error('DUPLICATE_NAME'); e.code = 'DUPLICATE_NAME'; e.existing = clash.rows[0].name; throw e;
      }

      const ins = await client.query(
        'INSERT INTO google_campaign (name, notes, created_by) VALUES ($1, $2, $3) RETURNING name, notes, archived',
        [name, notes, who]
      );

      await writeBcLog(client, { who, section: 'Google Ads', log: `Campaign created: ${name}` });
      return ins.rows[0];
    });

    return res.json({ return_code: 'SUCCESS', campaign: created });
  } catch (err) {
    if (err.code === 'DUPLICATE_NAME') {
      return res.json({
        return_code: 'DUPLICATE_NAME',
        message: `A campaign called "${err.existing}" already exists.`,
      });
    }
    logger.error('[google-ads-campaign-create] failed:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'The campaign was not created' });
  }
});

module.exports = router;
