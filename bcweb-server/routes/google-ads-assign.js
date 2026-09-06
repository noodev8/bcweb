/*
=======================================================================================================================================
API Route: google_ads_assign
=======================================================================================================================================
Method: POST
Purpose: Google Ads module — put one or more styles into a campaign bucket. THE ONLY WRITE THIS MODULE MAKES TO PRODUCT DATA.

         Sets `skusummary.googlecampaign`, which merchant_feed.py ships as Google's `custom_label_0`, which is what scopes a Shopping
         campaign. Writes the assignment log in the same transaction. Requires auth.

         It writes NOTHING else. Not `googlestatus`, not `shopify`, not price. Pulling a style out of Google is done by assigning it
         the `pause` bucket (owner's call, spec §1) — reversible, one lever, and it leaves the product itself alone.

WHAT ACTUALLY REACHES GOOGLE, AND WHEN — SAY THIS ON SCREEN
Nothing here touches Google. The chain is: this write -> merchant_feed.py at 3:30am -> SFTP to Merchant Center -> Google recrawls ->
`custom_label_0` updates -> only then can the Ads UI scope a campaign to it. **Tomorrow at the earliest.** The Merchant API
supplemental datasource used for instant price pushes is declared salePrice-only and cannot carry a label, so there is no fast path.
The screen shows "pending" until an import comes back agreeing.

A NO-OP IS NOT A CHANGE
A style already in the requested bucket is counted as `unchanged` and gets NO log row. The log has to mean "somebody moved this",
because it is the only record of historical membership decisions and a run of no-op rows from a careless bulk select would bury the
real ones.

THE BUCKET MUST EXIST AND MUST NOT BE ARCHIVED
Names come from `google_campaign`, never free text. A typo ('Zermat') would be written to skusummary, shipped in the feed, reach
Google, match nothing in the Ads UI, and never announce itself — the same class of silent failure that left 23 styles stranded on a
dead 'birk-winner' label for four months. Rejecting an unknown name here is the only place that can be caught cheaply.

BULK IS ONE TRANSACTION, NOT A LOOP
Unlike a bulk price move (which loops W1 client-side so each live Shopify push fires per row), there is no external push here and no
per-row bound to check. So the whole batch is one atomic statement pair: either every style moves or none does. A half-applied bulk
assign would leave the feed in a state nobody chose.
=======================================================================================================================================
Request Payload:
{
  "groupids": ["0034701-MILANO", "0034791-MILANO"],   // 1..MAX_STYLES styles
  "campaign": "BIRK-HARVEST"                          // must exist in google_campaign and not be archived
}

Success Response:
{
  "return_code": "SUCCESS",
  "campaign": "BIRK-HARVEST",
  "moved": 2,          // styles whose bucket actually changed (these got log rows)
  "unchanged": 0,      // already in this bucket — no log row written
  "notFound": [],      // groupids that are not in skusummary
  "movedFrom": { "standard": 2 }   // what they came from, for the confirmation message
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"TOO_MANY_STYLES"
"UNKNOWN_CAMPAIGN"
"CAMPAIGN_ARCHIVED"
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

// The whole catalogue is ~284 styles, so a "select all and move" is a legitimate action. The cap is a guard against a malformed
// client sending something enormous, not a limit on real work.
const MAX_STYLES = 1000;

// Legacy TEXT stamp, Europe/London (CLAUDE.md). Written alongside the real timestamptz because PowerBuilder still reads it.
const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

router.post('/', async (req, res) => {
  try {
    const campaign = typeof req.body.campaign === 'string' ? req.body.campaign.trim() : '';
    const groupids = Array.isArray(req.body.groupids)
      ? [...new Set(req.body.groupids.map((g) => String(g || '').trim().toUpperCase()).filter(Boolean))]
      : [];

    if (!campaign || groupids.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'campaign and at least one groupid are required' });
    }
    if (groupids.length > MAX_STYLES) {
      return res.json({ return_code: 'TOO_MANY_STYLES', message: `Assign at most ${MAX_STYLES} styles at once` });
    }

    // `changed_by` is resolved server-side from the JWT and never sent by the client (CLAUDE.md).
    const who = req.user.display_name || 'unknown';

    const result = await withTransaction(async (client) => {
      // The bucket must be a real, live name. Checked INSIDE the transaction so a campaign archived a moment ago cannot slip through
      // between validation and write.
      const camp = await client.query('SELECT name, archived FROM google_campaign WHERE name = $1', [campaign]);
      if (camp.rows.length === 0) {
        const e = new Error('UNKNOWN_CAMPAIGN'); e.code = 'UNKNOWN_CAMPAIGN'; throw e;
      }
      if (camp.rows[0].archived) {
        const e = new Error('CAMPAIGN_ARCHIVED'); e.code = 'CAMPAIGN_ARCHIVED'; throw e;
      }
      const name = camp.rows[0].name;   // use the stored casing, not whatever the client typed

      // What each style is in NOW. Needed for three things: the log's from_campaign, telling `unchanged` from `moved`, and telling
      // "not in skusummary" from "already correct" in the response.
      const before = await client.query(
        'SELECT groupid, COALESCE(googlecampaign, \'\') AS campaign FROM skusummary WHERE groupid = ANY($1::text[])',
        [groupids]
      );
      const current = new Map(before.rows.map((r) => [r.groupid, r.campaign]));
      const notFound = groupids.filter((g) => !current.has(g));

      // Only the styles that genuinely change. A no-op gets no UPDATE and no log row — see the header.
      const toMove = groupids.filter((g) => current.has(g) && current.get(g) !== name);
      const unchanged = groupids.length - notFound.length - toMove.length;

      if (toMove.length === 0) {
        return { name, moved: 0, unchanged, notFound, movedFrom: {} };
      }

      // One statement for the whole batch. `updated` (legacy TEXT) and `updated_date` are both written, matching product-update.js —
      // PowerBuilder still reads the text stamp (CLAUDE.md).
      await client.query(`
        UPDATE skusummary
           SET googlecampaign = $2, updated = ${UPDATED_EXPR}, updated_date = now()
         WHERE groupid = ANY($1::text[])
      `, [toMove, name]);

      // The audit log, same transaction. UNNEST turns the parallel arrays into rows so this is one INSERT however many styles moved.
      // It cannot be backfilled later, and it is the only record of WHO decided WHAT (Google records the label, never the decision).
      await client.query(`
        INSERT INTO google_campaign_assignment_log (groupid, from_campaign, to_campaign, changed_by)
        SELECT g, NULLIF(f, ''), $3, $4
          FROM unnest($1::text[], $2::text[]) AS t(g, f)
      `, [toMove, toMove.map((g) => current.get(g)), name, who]);

      // Tally of what they came from, for a confirmation the operator can actually check ("12 moved from standard").
      const movedFrom = {};
      for (const g of toMove) {
        const from = current.get(g) || '(none)';
        movedFrom[from] = (movedFrom[from] || 0) + 1;
      }

      await writeBcLog(client, {
        who,
        section: 'Google Ads',
        log: `Assign: ${toMove.length} style${toMove.length === 1 ? '' : 's'} -> ${name}`,
      });

      return { name, moved: toMove.length, unchanged, notFound, movedFrom };
    });

    return res.json({
      return_code: 'SUCCESS',
      campaign: result.name,
      moved: result.moved,
      unchanged: result.unchanged,
      notFound: result.notFound,
      movedFrom: result.movedFrom,
    });
  } catch (err) {
    if (err.code === 'UNKNOWN_CAMPAIGN') {
      return res.json({ return_code: 'UNKNOWN_CAMPAIGN', message: 'That campaign name does not exist. Create it first.' });
    }
    if (err.code === 'CAMPAIGN_ARCHIVED') {
      return res.json({ return_code: 'CAMPAIGN_ARCHIVED', message: 'That campaign is archived. Un-archive it before assigning styles to it.' });
    }
    logger.error('[google-ads-assign] failed:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Nothing was changed' });
  }
});

module.exports = router;
