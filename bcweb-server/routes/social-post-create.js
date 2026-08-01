/*
=======================================================================================================================================
API Route: social_post_create
=======================================================================================================================================
Method: POST
Purpose: Social module — compose one post. Inserts the `social_post` row plus one `social_post_target` row per selected platform, in a
         single transaction. Nothing is sent to Meta here; the post simply becomes due, and scripts/social-publish-sweep.js picks it up
         at its scheduled minute.

WHY WE SCHEDULE OURSELVES RATHER THAN HANDING IT TO FACEBOOK
         Facebook CAN hold a scheduled post for us (published=false + scheduled_publish_time) and Instagram cannot. Leaning on FB's
         native scheduling in v1 would mean unpicking it in Phase 3 and would make Meta, not bcweb, the truth about what is queued.
         So every platform goes through one code path: we store it, the sweep fires it at the due minute.

WHY link_url IS STORED BARE
         No UTM. The tracked link is built at publish time per platform (utils/socialMeta.js -> buildTrackedLink), because one stored
         post can go to both FB and IG and the two must be distinguishable in GA4. A stored UTM could only describe one of them.

         `created_by` is resolved server-side from the JWT, never trusted from the client. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "caption": "New season Arizona ...",          // required, non-blank
  "asset_id": 7,                                // required, must exist
  "scheduled_at": "2026-08-02T09:00:00.000Z",   // required, must be in the future
  "platforms": ["FB"],                          // required, non-empty; v1 accepts FB only
  "link_url": "https://.../collections/birkenstock",  // optional, bare URL (no UTM)
  "campaign": "birkenstock",                    // optional -> utm_campaign
  "angle": "comfort"                            // optional, from the rotation
}

Success Response:
{
  "return_code": "SUCCESS",
  "post": { "id": 12, "scheduled_at": "...", "targets": [ { "id": 30, "platform": "FB", "status": "SCHEDULED" } ] }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"      // blank caption, no asset_id, no scheduled_at, no platforms
"ASSET_NOT_FOUND"     // asset_id doesn't exist
"BAD_SCHEDULE"        // scheduled_at unparseable or not in the future
"BAD_PLATFORM"        // a platform outside the supported set
"BAD_LINK"            // link_url present but not a valid URL
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { buildTrackedLink } = require('../utils/socialMeta');
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

// v1 is Facebook-only. IG is accepted by the SCHEMA from day one (that is the point of social_post_target), but the publisher branch
// does not exist until Phase 3 — so accepting an IG target here would queue something that can never fire.
const SUPPORTED = new Set(['FB']);
const KNOWN = new Set(['FB', 'IG']);
const MAX_CAPTION = 5000;

router.post('/', async (req, res) => {
  try {
    const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim() : '';
    const assetId = parseInt(req.body?.asset_id, 10);
    const platforms = Array.isArray(req.body?.platforms) ? [...new Set(req.body.platforms)] : [];
    const linkUrl = typeof req.body?.link_url === 'string' ? req.body.link_url.trim() : '';
    const campaign = typeof req.body?.campaign === 'string' ? req.body.campaign.trim() : '';
    const angle = typeof req.body?.angle === 'string' ? req.body.angle.trim() : '';

    if (!caption || !Number.isInteger(assetId) || !req.body?.scheduled_at || platforms.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'caption, asset_id, scheduled_at and at least one platform are required' });
    }
    if (caption.length > MAX_CAPTION) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `Caption is too long (${caption.length}; max ${MAX_CAPTION})` });
    }

    for (const p of platforms) {
      if (!KNOWN.has(p)) return res.json({ return_code: 'BAD_PLATFORM', message: `Unknown platform: ${p}` });
      if (!SUPPORTED.has(p)) return res.json({ return_code: 'BAD_PLATFORM', message: `${p} is not supported yet (Phase 3)` });
    }

    // Parse the schedule. We store timestamptz, so an ISO string with a zone is unambiguous; a bare local string would be read as UTC
    // and silently shift the post by an hour during BST.
    const when = new Date(req.body.scheduled_at);
    if (Number.isNaN(when.getTime())) {
      return res.json({ return_code: 'BAD_SCHEDULE', message: 'scheduled_at is not a valid date' });
    }
    if (when.getTime() <= Date.now()) {
      return res.json({ return_code: 'BAD_SCHEDULE', message: 'scheduled_at must be in the future' });
    }

    // Validate the link NOW rather than letting the sweep discover it at the due minute — a post that fails at 9am because of a typo
    // caught at compose time is the worst possible place to find out.
    if (linkUrl) {
      try {
        buildTrackedLink({ linkUrl, campaign, platform: 'FB' });
      } catch {
        return res.json({ return_code: 'BAD_LINK', message: 'link_url is not a valid URL' });
      }
    }

    const asset = await query('SELECT id FROM social_asset WHERE id = $1', [assetId]);
    if (asset.rows.length === 0) {
      return res.json({ return_code: 'ASSET_NOT_FOUND', message: 'That image no longer exists' });
    }

    const created = await withTransaction(async (client) => {
      const post = await client.query(
        `INSERT INTO social_post (caption, link_url, campaign, angle, asset_id, scheduled_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, caption, link_url, campaign, angle, asset_id, scheduled_at, created_by, created_at`,
        [caption, linkUrl || null, campaign || null, angle || null, assetId, when.toISOString(), req.user.display_name]
      );

      const targets = [];
      for (const platform of platforms) {
        const t = await client.query(
          `INSERT INTO social_post_target (post_id, platform) VALUES ($1,$2)
           RETURNING id, platform, status, attempts`,
          [post.rows[0].id, platform]
        );
        targets.push(t.rows[0]);
      }

      // Audit alongside Inventory / Order Sync / Amazon import, in the same log the owner already reads.
      const flat = caption.replace(/\s+/g, ' ').trim();
      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Social',
        log: `Social Queue: ${platforms.join('+')} ${when.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' })} "${flat.length > 50 ? `${flat.slice(0, 47)}...` : flat}"`
      });

      return { ...post.rows[0], targets };
    });

    logger.info(`[social-post-create] post ${created.id} for ${platforms.join('+')} at ${when.toISOString()} by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', post: created });
  } catch (err) {
    logger.error('[social-post-create] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to create post' });
  }
});

module.exports = router;
