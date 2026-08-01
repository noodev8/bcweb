/*
=======================================================================================================================================
API Route: social_posts
=======================================================================================================================================
Method: GET
Purpose: Social module — the Queue. Every composed post with its per-platform targets, newest scheduled first. Also powers the
         Marketing tile badge (the FAILED count) and the Results screen (status=POSTED carries the metrics blob).

WHY ONE QUERY
         A post has 1-2 target rows, so the obvious "select posts, then select targets per post" is a textbook N+1. We aggregate the
         targets into a jsonb array in the same statement instead (docs/API-RULES.md forbids N+1). At a few posts a day the cost is
         irrelevant either way, but the pattern is what gets copied.

WHY status FILTERS ON THE TARGET, NOT THE POST
         There is no status on `social_post` — status is per platform, because a post can succeed on Facebook and fail on Instagram.
         `?status=FAILED` therefore means "has at least one target in that state", which is what the Queue's grouping needs.

         Read-only. Requires auth.
=======================================================================================================================================
Query Parameters:
  status  (optional)  - SCHEDULED | PUBLISHING | POSTED | FAILED | CANCELLED. Omitted = all.
  limit   (optional)  - default 100, max 500.

Success Response:
{
  "return_code": "SUCCESS",
  "counts": { "SCHEDULED": 3, "POSTED": 12, "FAILED": 1, "CANCELLED": 0, "PUBLISHING": 0 },
  "posts": [
    {
      "id": 12, "caption": "...", "link_url": "...", "campaign": "birkenstock", "angle": null,
      "scheduled_at": "...", "created_by": "Andreas", "created_at": "...",
      "asset": { "id": 7, "public_url": "https://social.brookfieldcomfort.com/....jpg", "width": 1200, "height": 628 },
      "targets": [ { "id": 30, "platform": "FB", "status": "POSTED", "remote_id": "...", "published_at": "...",
                     "error": null, "attempts": 1, "metrics": null, "metrics_at": null } ]
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
const logger = require('../utils/logger');

router.use(verifyToken);

const STATUSES = new Set(['SCHEDULED', 'PUBLISHING', 'POSTED', 'FAILED', 'CANCELLED']);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

router.get('/', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : '';
    if (status && !STATUSES.has(status)) {
      return res.json({ return_code: 'SUCCESS', counts: {}, posts: [] });   // unknown filter = empty, not an error
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);

    // The tile badge and the Queue's group headings both need these, and they must count the WHOLE table, not the filtered page.
    const counts = await query(`SELECT status, COUNT(*)::int AS n FROM social_post_target GROUP BY status`);

    const { rows } = await query(
      `SELECT p.id, p.caption, p.link_url, p.campaign, p.angle,
              p.scheduled_at, p.created_by, p.created_at, p.updated_at,
              jsonb_build_object(
                'id', a.id, 'public_url', a.public_url, 'width', a.width, 'height', a.height, 'bytes', a.bytes
              ) AS asset,
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object(
                          'id', t.id, 'platform', t.platform, 'status', t.status, 'remote_id', t.remote_id,
                          'published_at', t.published_at, 'error', t.error, 'attempts', t.attempts,
                          'metrics', t.metrics, 'metrics_at', t.metrics_at
                        ) ORDER BY t.platform)
                   FROM social_post_target t WHERE t.post_id = p.id),
                '[]'::jsonb
              ) AS targets
         FROM social_post p
         JOIN social_asset a ON a.id = p.asset_id
        WHERE ($1 = '' OR EXISTS (SELECT 1 FROM social_post_target t2 WHERE t2.post_id = p.id AND t2.status = $1))
        ORDER BY p.scheduled_at DESC
        LIMIT $2`,
      [status, limit]
    );

    return res.json({
      return_code: 'SUCCESS',
      counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
      posts: rows
    });
  } catch (err) {
    logger.error('[social-posts] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load posts' });
  }
});

module.exports = router;
