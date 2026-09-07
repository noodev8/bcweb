/*
=======================================================================================================================================
API Route: google_ads_campaign_delete
=======================================================================================================================================
Method: POST
Purpose: Google Ads module — permanently remove a campaign bucket's definition. Requires auth.

DELETING A NAME GOOGLE HAS REPORTED IS ALLOWED, AND THE OPERATOR DECIDES (owner, 2026-09-07)
This route first refused to delete a bucket whose name appeared in `google_product_daily` or `google_campaign_daily`, on the theory
that removing the definition would leave those report rows unexplained, and told the operator to archive instead. That guard was
wrong on the facts and has been removed. It was also the only thing in the module quietly overriding a decision the owner had
already made.

What actually happens is milder than the guard assumed. `google_label` is TEXT with no foreign key, so the rows keep reading; the
name simply becomes a historical label with no definition row behind it. THE MODULE ALREADY CONTAINS EXACTLY THAT STATE and has
since before this route existed: 'birk-winner' sits in `google_product_daily` on 23 styles from an experiment that ended 13 May 2026,
has never had a `google_campaign` row, and nothing about it is broken — the drill's "Google says" column reads it fine. Deleting a
bucket with report history lands it in the same place. That is a housekeeping consequence, not a data hazard, and it is the owner's
call to make.

The counts are still gathered and returned on success (`reportRowsKept`) so the operator can SEE what the name still touches. The
difference is that it is now information after the fact rather than a veto before it.

NO NAME IS PROTECTED (owner, 2026-09-07)
'standard' and 'pause' were refused here and in the update route on the grounds that other code depended on the literal strings.
CHECKED, AND IT DOES NOT. `routes/product-create.js` seeds `'new'`, not `'standard'` — the protection was written when it seeded
`standard` and was never revisited when that changed, so it had been guarding a dependency that no longer existed. 'pause' is not
hard-coded anywhere in either app; it is an ordinary bucket the operator happens to use for pulling styles out of Google.

There is one live hard-coded name left and it is 'new': product-create writes it on every new style. Renaming or deleting THAT would
land new products on a bucket with no definition row — visible in the panel as an unmanaged name, not silent, but still untidy. It is
deliberately not protected here either; it is recorded so the consequence is known rather than discovered.

THE ONE REMAINING REFUSAL is a bucket that still HOLDS styles: those styles would keep shipping the label to Google with nothing in
the app defining it, and unlike report history that is a LIVE state rather than a finished one. Move them first; the error says how
many.

THE ASSIGNMENT LOG IS DELIBERATELY LEFT ALONE
`google_campaign_assignment_log` keeps every row that mentions the deleted name — 180 of them for 'thin'. That is not an oversight
and it is not an orphan: the column is plain varchar with no foreign key (see migrations/20260905_google_ads_module.sql, which chose
that on purpose), so the rows keep reading `standard -> thin -> pause` exactly as before.

They must survive. That log is the ONLY record of what a style's bucket was on a given day — Google cannot be asked retrospectively —
and deleting a bucket's definition is not a claim that the moves never happened. A style that went standard -> thin -> pause over two
days looks like it never moved if the middle step is erased, and the next person to ask "why did this style's spend stop?" would have
no answer. History is not the same thing as configuration.

=======================================================================================================================================
Request Payload:
{
  "name": "thin"                 // REQUIRED — the campaign bucket to delete
}

Success Response:
{
  "return_code": "SUCCESS",
  "deleted": "thin",
  "logRowsKept": 180,            // assignment-log rows that still mention it, left in place on purpose (see above)
  "reportRowsKept": 0            // rows in Google's own report tables still carrying the name — reported, never a blocker
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"CAMPAIGN_IN_USE"          styles still carry the label — move them first
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

const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

router.post('/', async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.json({ return_code: 'MISSING_FIELDS', message: 'name is required' });

    const who = req.user.display_name || 'unknown';

    const out = await withTransaction(async (client) => {
      const found = await client.query('SELECT name FROM google_campaign WHERE name = $1', [name]);
      if (found.rows.length === 0) throw fail('NOT_FOUND');
      const row = found.rows[0];

      // 1. Nothing may still be wearing the label. Identical guard to archive's, and for a stronger reason: an archived bucket at
      //    least still has a row explaining what the label means, and a deleted one does not.
      const members = await client.query(
        'SELECT COUNT(*)::int AS n FROM skusummary WHERE googlecampaign = $1',
        [row.name]
      );
      if (members.rows[0].n > 0) throw fail('CAMPAIGN_IN_USE', { count: members.rows[0].n });

      // 2. How much of Google's own reporting still carries this name. COUNTED, NOT ENFORCED — see the header for why this stopped
      //    being a refusal. Both tables are checked because the import populates them from different files and one can land without
      //    the other. Case-insensitive because Google lowercases labels, so a bucket named 'Thin' comes back as 'thin' and a
      //    case-sensitive count here would report 0 for a name with real history behind it.
      const history = await client.query(`
        SELECT (SELECT COUNT(*) FROM google_product_daily  WHERE UPPER(google_label) = UPPER($1))::int AS product_rows,
               (SELECT COUNT(*) FROM google_campaign_daily WHERE UPPER(campaign)     = UPPER($1))::int AS campaign_rows
      `, [row.name]);
      const reportRowsKept = history.rows[0].product_rows + history.rows[0].campaign_rows;

      // Counted, not deleted — reported back so the response is explicit about what was kept rather than leaving the operator to
      // wonder whether their history went with it. See the header.
      const kept = await client.query(
        'SELECT COUNT(*)::int AS n FROM google_campaign_assignment_log WHERE to_campaign = $1 OR from_campaign = $1',
        [row.name]
      );

      await client.query('DELETE FROM google_campaign WHERE name = $1', [row.name]);

      await writeBcLog(client, { who, section: 'Google Ads', log: `Campaign ${row.name}: deleted` });

      return { deleted: row.name, logRowsKept: kept.rows[0].n, reportRowsKept };
    });

    return res.json({ return_code: 'SUCCESS', ...out });
  } catch (err) {
    switch (err.code) {
      case 'NOT_FOUND':
        return res.json({ return_code: 'NOT_FOUND', message: 'That campaign no longer exists.' });
      case 'CAMPAIGN_IN_USE':
        return res.json({
          return_code: 'CAMPAIGN_IN_USE',
          message: `${err.count} style${err.count === 1 ? ' is' : 's are'} still in this campaign. Move ${err.count === 1 ? 'it' : 'them'} to another campaign first.`,
        });
      default:
        logger.error('[google-ads-campaign-delete] failed:', err.message);
        return res.json({ return_code: 'SERVER_ERROR', message: 'Could not delete the campaign' });
    }
  }
});

module.exports = router;
