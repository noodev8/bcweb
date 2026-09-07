/*
=======================================================================================================================================
API Route: google_ads_campaign_update
=======================================================================================================================================
Method: POST
Purpose: Google Ads module — rename a campaign bucket, edit its notes, or archive/un-archive it. Requires auth.

         Three operations on one route because they are all "change this bucket's definition", they are mutually compatible in one
         call, and splitting them would mean three near-identical routes with the same validation.

A RENAME IS A REAL CHANGE TO WHAT GOOGLE SEES
It is not cosmetic. The name IS the value in `skusummary.googlecampaign`, which is shipped as `custom_label_0`, so renaming a bucket
rewrites every member's label and Google will see them all move. Two consequences, both handled here:

  1. Members are rewritten IN THE SAME TRANSACTION. A rename that updated the list but not the members would leave every member
     pointing at a name that no longer exists — unmanaged, invisible in the picker, still going to Google.
  2. Every member gets an ASSIGNMENT LOG ROW. From the outside this is indistinguishable from moving those styles to a new bucket,
     because to Google it IS that. Recording it as a rename-shaped silence would leave a gap in the one history that cannot be
     rebuilt.

ARCHIVING IS BLOCKED WHILE A BUCKET STILL HOLDS STYLES
An archived bucket disappears from the assign picker but its label keeps going out in the feed, so a hidden bucket would quietly
keep scoping a live campaign. That is exactly the silent-state failure this module exists to end. Move the styles somewhere else
first; the error says how many are in the way.

NO NAME IS PROTECTED (owner, 2026-09-07)
'standard' and 'pause' were refused here on the grounds that other code depended on the literal strings. CHECKED, AND IT DOES NOT.
`routes/product-create.js` seeds `'new'`, not `'standard'` — this guard was written when it seeded `standard` and was never revisited
when that changed, so it had been protecting a dependency that no longer existed. 'pause' is not hard-coded anywhere in either app.

'new' IS the live hard-coded seed, and it is deliberately not protected either: renaming it would land new products on a bucket with
no definition row. That shows in the panel as an unmanaged name rather than failing silently, and it is the owner's call. Recorded
here so the consequence is known rather than discovered.
=======================================================================================================================================
Request Payload:
{
  "name": "BIRK-HARVEST",        // REQUIRED — the campaign to change
  "newName": "BIRK-SUMMER",      // optional — rename (same rules as create)
  "notes": "…",                  // optional — replace the notes (empty string clears them)
  "archived": true               // optional — archive / un-archive
}

Success Response:
{
  "return_code": "SUCCESS",
  "campaign": { "name": "BIRK-SUMMER", "notes": "…", "archived": false },
  "renamed": true,
  "membersRewritten": 12          // styles whose googlecampaign changed as a result (0 unless renamed)
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"NAME_TOO_LONG"
"INVALID_NAME"
"DUPLICATE_NAME"
"CAMPAIGN_IN_USE"
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

const MAX_NAME = 20;
const NAME_OK = /^[A-Za-z0-9 ._-]+$/;

const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

router.post('/', async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.json({ return_code: 'MISSING_FIELDS', message: 'name is required' });

    const newName = typeof req.body.newName === 'string' ? req.body.newName.trim() : null;
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : undefined;
    const archived = typeof req.body.archived === 'boolean' ? req.body.archived : undefined;

    if (newName === null && notes === undefined && archived === undefined) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Nothing to change — pass newName, notes or archived' });
    }

    if (newName !== null) {
      if (newName.length === 0) return res.json({ return_code: 'MISSING_FIELDS', message: 'newName cannot be blank' });
      if (newName.length > MAX_NAME) {
        return res.json({
          return_code: 'NAME_TOO_LONG',
          message: `Campaign names are limited to ${MAX_NAME} characters (this one is ${newName.length}).`,
        });
      }
      if (!NAME_OK.test(newName)) {
        return res.json({
          return_code: 'INVALID_NAME',
          message: 'Use letters, numbers, spaces, hyphens, underscores or dots only.',
        });
      }
    }

    const who = req.user.display_name || 'unknown';

    const out = await withTransaction(async (client) => {
      const found = await client.query('SELECT name, notes, archived FROM google_campaign WHERE name = $1', [name]);
      if (found.rows.length === 0) throw fail('NOT_FOUND');
      const row = found.rows[0];

      const renaming = newName !== null && newName !== row.name;
      const archiving = archived === true && !row.archived;

      // How many styles currently carry this label. Needed for the archive guard and for the rename's log rows.
      const membersRes = await client.query(
        'SELECT groupid FROM skusummary WHERE googlecampaign = $1',
        [row.name]
      );
      const members = membersRes.rows.map((r) => r.groupid);

      if (archiving && members.length > 0) {
        throw fail('CAMPAIGN_IN_USE', { count: members.length });
      }

      let membersRewritten = 0;

      if (renaming) {
        // Case-insensitive clash check, same rule as create: two casings here would be one label to Google.
        const clash = await client.query(
          'SELECT name FROM google_campaign WHERE UPPER(name) = UPPER($1) AND name <> $2',
          [newName, row.name]
        );
        if (clash.rows.length > 0) throw fail('DUPLICATE_NAME', { existing: clash.rows[0].name });

        // Order matters: insert the new name, move the members onto it, then drop the old one. Doing it this way means the members'
        // value is never pointing at a name that is absent from the list, even momentarily inside the transaction.
        await client.query(
          'INSERT INTO google_campaign (name, notes, archived, created_by) VALUES ($1, $2, $3, $4)',
          [newName, notes === undefined ? row.notes : (notes || null), row.archived, who]
        );

        if (members.length > 0) {
          await client.query(`
            UPDATE skusummary
               SET googlecampaign = $2, updated = ${UPDATED_EXPR}, updated_date = now()
             WHERE groupid = ANY($1::text[])
          `, [members, newName]);

          // Logged per style. To Google this is every one of these styles changing bucket, so the history must say so — see header.
          await client.query(`
            INSERT INTO google_campaign_assignment_log (groupid, from_campaign, to_campaign, changed_by)
            SELECT g, $2, $3, $4 FROM unnest($1::text[]) AS g
          `, [members, row.name, newName, who]);

          membersRewritten = members.length;
        }

        await client.query('DELETE FROM google_campaign WHERE name = $1', [row.name]);
      }

      // Notes / archived on whichever row now holds the definition.
      //
      // NOTES CANNOT USE COALESCE, AND DID, WHICH MADE CLEARING ONE IMPOSSIBLE (fixed 2026-09-07). The header has always promised
      // that an empty string clears the notes; the SQL did the opposite. `notes || null` turned '' into NULL, and
      // COALESCE(NULL, notes) then kept whatever was already there — so a note could be written and corrected but never removed,
      // silently, with the route reporting success. Nothing caught it because notes were display-only in the UI until now.
      //
      // The two states have to be distinguishable and COALESCE collapses them: NULL means both "leave it alone" (field absent) and
      // "set it to nothing" (field sent empty). So the flag is passed separately and the CASE decides, leaving NULL free to mean
      // only one thing. `archived` keeps COALESCE because it is a boolean that is never legitimately set to NULL.
      const target = renaming ? newName : row.name;
      if (notes !== undefined || archived !== undefined) {
        await client.query(`
          UPDATE google_campaign
             SET notes    = CASE WHEN $4::boolean THEN $2 ELSE notes END,
                 archived = COALESCE($3, archived)
           WHERE name = $1
        `, [
          target,
          notes === undefined ? null : (notes || null),   // '' -> NULL, which with the flag set means "clear it"
          archived === undefined ? null : archived,
          notes !== undefined,                            // was `notes` supplied at all?
        ]);
      }

      const finalRes = await client.query('SELECT name, notes, archived FROM google_campaign WHERE name = $1', [target]);

      const what = [];
      if (renaming) what.push(`renamed ${row.name} -> ${newName} (${membersRewritten} style${membersRewritten === 1 ? '' : 's'})`);
      if (archived !== undefined) what.push(archived ? 'archived' : 'un-archived');
      if (notes !== undefined && !renaming) what.push('notes edited');
      await writeBcLog(client, { who, section: 'Google Ads', log: `Campaign ${target}: ${what.join(', ')}` });

      return { campaign: finalRes.rows[0], renamed: renaming, membersRewritten };
    });

    return res.json({ return_code: 'SUCCESS', ...out });
  } catch (err) {
    switch (err.code) {
      case 'NOT_FOUND':
        return res.json({ return_code: 'NOT_FOUND', message: 'No campaign with that name' });
      case 'CAMPAIGN_IN_USE':
        return res.json({
          return_code: 'CAMPAIGN_IN_USE',
          message: `${err.count} style${err.count === 1 ? ' is' : 's are'} still in this campaign. Move ${err.count === 1 ? 'it' : 'them'} to another campaign before archiving — an archived campaign is hidden from the picker but its label keeps going out in the feed.`,
        });
      case 'DUPLICATE_NAME':
        return res.json({ return_code: 'DUPLICATE_NAME', message: `A campaign called "${err.existing}" already exists.` });
      default:
        logger.error('[google-ads-campaign-update] failed:', err.message);
        return res.json({ return_code: 'SERVER_ERROR', message: 'Nothing was changed' });
    }
  }
});

module.exports = router;
