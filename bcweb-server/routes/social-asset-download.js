/*
=======================================================================================================================================
API Route: social_asset_download
=======================================================================================================================================
Method: GET
Purpose: Social module — let an operator save a queued/posted graphic to their machine from the Queue screen.

WHY THIS EXISTS RATHER THAN LINKING STRAIGHT AT THE IMAGE
         Assets live on one.com (social.brookfieldcomfort.com) or the inventory CDN (images.brookfieldcomfort.com) — neither sends
         CORS headers, and neither sends Content-Disposition: attachment. A plain <a href download> is ignored cross-origin, so the
         browser just navigates to the image instead of saving it. This route fetches the bytes server-side (no CORS involved — it's
         a normal server-to-server request) and re-serves them with Content-Disposition: attachment, which forces a real save
         regardless of what the origin host sends.

WHY THE URL IS VALIDATED AGAINST A FIXED PREFIX LIST
         `url` is caller-supplied. Fetching an arbitrary caller-given URL server-side is an SSRF hole, so only the two hosts assets
         are ever actually stored on are allowed — same pattern as social-asset-upload.js's source_url check.

         Requires auth.
=======================================================================================================================================
Request: GET /social-asset-download?url=<public_url of a social_asset>
Success Response: the raw image bytes, Content-Disposition: attachment
=======================================================================================================================================
Return Codes (JSON envelope, only on failure — success returns the file directly):
"MISSING_FIELDS"     // no url
"INVALID_SOURCE"     // url isn't on an allowed image host
"FETCH_FAILED"       // upstream didn't come back
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const config = require('../config/config');
const logger = require('../utils/logger');

// The only hosts a social_asset's public_url can ever point at (one.com marketing webroot + the inventory CDN). Fixed, not derived
// from any request input, so `url` can't be used to make the server fetch something arbitrary (SSRF).
//
// BOTH HOSTS ARE LITERAL ON PURPOSE. The social host used to be read from config.social.assetBaseUrl (SOCIAL_ASSET_BASE_URL), which
// meant downloads of uploaded marketing graphics failed with INVALID_SOURCE on any environment where that var isn't set (the local
// dev .env doesn't have it — only the VPS does). These are public CDN hostnames, not secrets, and read-only here: nothing in this
// route uploads, so there is no reason for the allow-list to move with deployment config. SOCIAL_ASSET_BASE_URL is still honoured on
// top, so a future webroot change keeps working without a code change.
const KNOWN_IMAGE_HOSTS = [
  'https://images.brookfieldcomfort.com/',   // inventory CDN — product photos (Send to Social path)
  'https://social.brookfieldcomfort.com/'    // one.com marketing webroot — uploaded graphics
];

function allowedPrefixes() {
  const prefixes = [...KNOWN_IMAGE_HOSTS];
  if (config.social.assetBaseUrl) {
    const extra = config.social.assetBaseUrl.replace(/\/+$/, '') + '/';
    if (!prefixes.includes(extra)) prefixes.push(extra);
  }
  return prefixes;
}

router.get('/', verifyToken, async (req, res) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!url) return res.json({ return_code: 'MISSING_FIELDS', message: 'url is required' });

    if (!allowedPrefixes().some((p) => url.startsWith(p))) {
      return res.json({ return_code: 'INVALID_SOURCE', message: 'url must be on a known image host' });
    }

    let upstream;
    try {
      upstream = await fetch(url);
    } catch (fetchErr) {
      logger.error('[social-asset-download] fetch failed:', fetchErr.message);
      return res.json({ return_code: 'FETCH_FAILED', message: 'Could not fetch that image' });
    }
    if (!upstream.ok) {
      return res.json({ return_code: 'FETCH_FAILED', message: `Could not fetch that image (${upstream.status})` });
    }

    const filename = url.split('/').pop() || 'image.jpg';
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    logger.error('[social-asset-download] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to download image' });
  }
});

module.exports = router;
