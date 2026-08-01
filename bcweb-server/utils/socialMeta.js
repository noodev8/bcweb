/*
=======================================================================================================================================
Module: utils/socialMeta.js
=======================================================================================================================================
Purpose: Everything this codebase says to Meta. Used by the publish sweep (scripts/social-publish-sweep.js) and the manual
         publish-now route. Credentials come from config.social.meta (env only — no hard-coded secrets).

         getPageToken()                  — derive a PAGE access token from the system user token, cached in-process.
         publishFacebookPhoto(a)         — POST /{page-id}/photos; returns { remoteId }. The v1 publish path.
         deleteRemotePost(id)            — DELETE /{id}; used by the gate test and by nothing in normal operation.
         buildTrackedLink(a)             — the canonical UTM builder. Publish-time only; never stored.

WHY A PAGE TOKEN, NOT THE SYSTEM USER TOKEN
         META_SYSTEM_USER_TOKEN is the credential; the Page publishing edges want a Page access token derived from it. Calling
         /{page-id}/photos with the system user token directly is not the supported path. Deriving is one cheap call
         (GET /{page-id}?fields=access_token), the result is type PAGE and never expires, and — crucially — deriving rather than
         storing means regenerating the system user token in Business Settings needs no .env edit and no redeploy.
         Verified 2026-08-01: derivation works via both /{page-id}?fields=access_token and /me/accounts; the grant carries
         tasks=[ADVERTISE, ANALYZE, CREATE_CONTENT, MESSAGING, MODERATE, MANAGE, VIEW_MONETIZATION_INSIGHTS].

WHY /photos AND NOT /feed
         This module is built around "you bring the finished graphic". A /feed post with a `link` makes Facebook render the LINK
         TARGET's own OG image — the uploaded graphic never appears, which defeats the point. /photos puts the graphic front and
         centre and carries the tracked link in the caption text, where Facebook linkifies it. It also matches Instagram's
         image + caption shape, so Phase 3 is a branch rather than a rewrite. Both edges were gate-tested and both work; this is a
         product choice, not a capability limit.

FAILURE POSTURE
         Every function throws a plain Error with Meta's own message on failure. The sweep catches, records it on the target row and
         surfaces it in the Queue. A scheduler that fails silently is worse than no scheduler (spec), so nothing here swallows.
=======================================================================================================================================
*/

const config = require('../config/config');
const logger = require('./logger');

const META = config.social.meta;
const GRAPH = 'https://graph.facebook.com';

// Ensure we have what we need before calling out, so the caller gets a readable error rather than a confusing 400 from Meta.
function requireConfig() {
  const missing = ['pageId', 'systemUserToken'].filter((k) => !META[k]);
  if (missing.length) {
    throw new Error(`Meta not configured — missing ${missing.map((m) => (m === 'pageId' ? 'META_PAGE_ID' : 'META_SYSTEM_USER_TOKEN')).join(', ')} in .env`);
  }
}

// Single place that talks HTTP to the Graph API, so error shape is handled once. Meta answers 200-with-an-error-body as readily as a
// 4xx, so we key off `body.error` rather than the status code.
async function graph(path, params = {}, method = 'GET') {
  const url = `${GRAPH}/${META.graphVersion}/${path}`;
  const body = new URLSearchParams(params);
  const res = method === 'GET'
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method, body });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Meta returned a non-JSON response (HTTP ${res.status})`);
  }
  if (json.error) {
    const e = json.error;
    // Carry Meta's codes through — the sweep stores them verbatim and (#190)/(#10) are the ones worth recognising by eye.
    const err = new Error(`(#${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''}) ${e.message}`);
    err.metaCode = e.code;
    err.metaSubcode = e.error_subcode;
    throw err;
  }
  return json;
}

// ---- Page token ---------------------------------------------------------------------------------------------------------------
// Cached for the life of the process. The derived token never expires, so this is really a "derive once per sweep run" cache; the TTL
// exists only so a revoke-and-regenerate in Business Settings is picked up by a long-lived API process without a restart.
let cached = { token: null, at: 0 };
const TOKEN_TTL_MS = 30 * 60 * 1000;

async function getPageToken({ force = false } = {}) {
  requireConfig();
  if (!force && cached.token && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;

  const res = await graph(META.pageId, { access_token: META.systemUserToken, fields: 'access_token' });
  if (!res.access_token) {
    // Almost always means the system user lost its asset grant on the Page.
    throw new Error('Meta returned no Page access token — check the system user still has Full access to the Page asset');
  }
  cached = { token: res.access_token, at: Date.now() };
  logger.info('[socialMeta] derived Page access token');
  return cached.token;
}

// ---- The tracked link ---------------------------------------------------------------------------------------------------------
// Built at publish time, never stored: one saved post can go to FB and IG and must be distinguishable in GA4, which a stored UTM
// could not do. utm_medium is always 'social' — same rule as docs/social/README.md, now enforced by code rather than by remembering.
// Returns null when there is no link, so callers can post a graphic with no URL at all.
function buildTrackedLink({ linkUrl, campaign, platform }) {
  if (!linkUrl) return null;
  let u;
  try {
    u = new URL(linkUrl);
  } catch {
    throw new Error(`link_url is not a valid URL: ${linkUrl}`);
  }
  u.searchParams.set('utm_source', platform === 'IG' ? 'instagram' : 'facebook');
  u.searchParams.set('utm_medium', 'social');
  if (campaign) u.searchParams.set('utm_campaign', campaign);
  return u.toString();
}

// ---- Publish ------------------------------------------------------------------------------------------------------------------
/*
 * Publish one image post to the Facebook Page, live, now.
 *
 * `imageUrl` must be publicly fetchable — Meta fetches it server-side, it is never uploaded through us. That is why the asset lives on
 * one.com (social.brookfieldcomfort.com) rather than behind the API's auth.
 *
 * The tracked link is appended to the caption rather than passed as a `link` param: /photos has no link preview to attach it to, and
 * Facebook linkifies a bare URL in caption text.
 *
 * Returns { remoteId }. NOTE the id shape: a live published=true call returns both `post_id` (the Page-post id, the useful one) and
 * `id` (the photo id); an unpublished/scheduled call returns only `id`. We prefer post_id and fall back — do not assume either is
 * present.
 */
async function publishFacebookPhoto({ imageUrl, caption, linkUrl, campaign }) {
  requireConfig();
  if (!imageUrl) throw new Error('publishFacebookPhoto: imageUrl is required');

  const tracked = buildTrackedLink({ linkUrl, campaign, platform: 'FB' });
  const fullCaption = tracked ? `${caption || ''}\n\n${tracked}`.trim() : (caption || '');

  const token = await getPageToken();
  const res = await graph(`${META.pageId}/photos`, {
    access_token: token,
    url: imageUrl,
    caption: fullCaption,
    published: 'true'
  }, 'POST');

  const remoteId = res.post_id || res.id;
  logger.info(`[socialMeta] published FB photo post ${remoteId}`);
  return { remoteId, raw: res };
}

// Delete a post by remote id. Not part of normal operation — the Queue cancels BEFORE publishing and never deletes a posted row (spec).
// Kept because the publish gate test needs it and because a mis-fire is easier to undo from here than from the Meta UI.
async function deleteRemotePost(remoteId) {
  requireConfig();
  const token = await getPageToken();
  return graph(remoteId, { access_token: token }, 'DELETE');
}

module.exports = { getPageToken, publishFacebookPhoto, deleteRemotePost, buildTrackedLink };
