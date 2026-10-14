/*
=======================================================================================================================================
Util: collectionTags
=======================================================================================================================================
Purpose: THE COLLECTION TAGS — which styles are in which Shopify collection. Owner, 2026-10-14: "A simple screen where I can tag/untag
         based on a set of criteria or filters. Allow up to 3 tags per style so I can put them in multiple collections. Store in
         database and I will manage tags from here only." Used by the Collections screen (routes/collection-*.js) and by Slow's clearance
         buttons (utils/clearanceTag.js), so both screens write through ONE set of rules.

THE DATABASE IS THE RECORD, SHOPIFY CARRIES A COPY. collection (the tags the owner has made) and collection_member (one row per style per
         tag) — migrations/20261014_collections.sql. Each add / remove changes the row AND sends tagsAdd / tagsRemove for that ONE tag,
         so every other tag on the product is left alone. The owner builds the smart collection in Shopify admin ("Product tag is equal
         to <tag>"); nothing here creates or edits a Shopify collection. A tag put on in Shopify admin is not seen here — the owner manages
         tags from this app only.

ONE STYLE AT A TIME, ROW AND SHOPIFY TOGETHER. Each style is its own small transaction: the row is written, Shopify is called, and a
         Shopify failure rolls the row back — so the database never claims a tag Shopify hasn't got. One style failing doesn't stop the
         rest; `failed` says which and why, and sending them again is safe (adding a tag twice / removing an absent one is a no-op on
         both sides). Sequential on purpose: a batch is at most a few hundred calls, well inside Shopify's rate limit, and
         shopifyGraphQL already backs off on a 429.

THE RULES (owner, 2026-10-14):
  ADD     needs a style that is LIVE ON SHOPIFY (skusummary.shopify = 1) with a handle Shopify knows, and fewer than MAX_TAGS tags.
          Tagging a style that is switched off is almost certainly a mistake, so it is refused for that row ("Shopify is off").
  REMOVE  ALWAYS WORKS, whatever the flag. Switching Shopify OFF only clears our flag (components/ShopifyToggle.tsx — it does not
          unpublish), so an OFF style keeps its tag on the store and keeps showing in the collection; the owner must be able to take it
          off. If Shopify no longer has the product (deleted in admin) there is nothing to untag — the row is removed anyway and the
          result says so, the one case where the database moves without Shopify. Otherwise a deleted product would leave a tag here that
          could never be removed.
  MAX 3   tags per style (owner: "Allow up to 3 tags per style"). Checked under a per-style advisory lock, so two people tagging the
          same style at once can't take it to 4.
  TAGS    lower-case a-z, 0-9 and '-', 2-40 characters, starting with a letter or digit (TAG_RE). Shopify tags are case-insensitive, so
          one spelling is kept. A new tag already used by products on Shopify is refused (TAG_IN_USE): those products were tagged
          outside this app and the database would not know them.

LOGGING: one bclog line per batch, section 'Collections', under the operator's login name. The Shopify side can't be rolled back once
         done, so a failed log write is logged and swallowed rather than failing the response.
=======================================================================================================================================
Exports:
  MAX_TAGS, TAG_RE
  normaliseTag(raw)                          -> string | null   // trimmed lower-case, or null if it breaks TAG_RE
  listCollections()                          -> { tag, styles, off }[]        // off = members not live on Shopify (or not in skusummary)
  createCollection(tag, operator)            -> { tag }                       // throws err.code TAG_INVALID | TAG_EXISTS | TAG_IN_USE
  setTag(groupids, tag, add, operator)       -> { done: string[], failed: { groupid, error }[], notes: { groupid, note }[] }
                                                // throws err.code UNKNOWN_COLLECTION
  memberIds(tag)                             -> string[]                      // groupids carrying the tag
  tagsByStyle()                              -> Map<groupid, string[]>        // every style's tags, alphabetical
  loadTagged(tag)                            -> { id, handle, title }[]       // Shopify products carrying the tag (read-only)
  idsByHandle(handles)                       -> Map<handle, productId>        // exact handle matches on Shopify (read-only)
=======================================================================================================================================
*/

const { query } = require('../database');
const { withTransaction } = require('./transaction');
const { shopifyGraphQL } = require('./shopify');
const logger = require('./logger');

const MAX_TAGS = 3;
const TAG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

const normaliseTag = (raw) => {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return TAG_RE.test(t) ? t : null;
};

// A typed error the routes turn into a return_code.
const fail = (code, message) => Object.assign(new Error(message), { code });

// -------------------------------------------------------------------------------------------------------------------------------------
// SHOPIFY READS
// -------------------------------------------------------------------------------------------------------------------------------------

// Products matching a search, paged (Shopify caps a page at 250). `tag:x` in the search syntax is an exact tag match.
const PRODUCTS_QUERY = `
  query($after: String, $q: String!) {
    products(first: 250, after: $after, query: $q) {
      nodes { id handle title }
      pageInfo { hasNextPage endCursor }
    }
  }`;

async function loadTagged(tag) {
  const out = [];
  let after = null;
  do {
    const d = await shopifyGraphQL(PRODUCTS_QUERY, { after, q: `tag:${tag}` });
    out.push(...d.products.nodes);
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after);
  return out;
}

// Product ids for a set of handles, in batches of 50 (a search of `handle:a OR handle:b …`). Search is fuzzy-ish, so only an EXACT
// handle match is kept — the same caution as utils/shopify.js findProductIdByHandle.
async function idsByHandle(handles) {
  const map = new Map();
  const uniq = Array.from(new Set(handles.filter(Boolean)));
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50);
    const d = await shopifyGraphQL(PRODUCTS_QUERY, { after: null, q: batch.map((h) => `handle:${h}`).join(' OR ') });
    const want = new Set(batch);
    for (const n of d.products.nodes) if (want.has(n.handle)) map.set(n.handle, n.id);
  }
  return map;
}

const TAGS_ADD = `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`;
const TAGS_REMOVE = `mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`;

// One tag on / off one product. Throws with Shopify's message on any failure, so the caller's transaction rolls the row back.
async function pushTag(productId, tag, add) {
  const field = add ? 'tagsAdd' : 'tagsRemove';
  const d = await shopifyGraphQL(add ? TAGS_ADD : TAGS_REMOVE, { id: productId, tags: [tag] });
  const errs = d[field].userErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
}

// -------------------------------------------------------------------------------------------------------------------------------------
// READS
// -------------------------------------------------------------------------------------------------------------------------------------

/** Every collection with its style count and how many of those are not live on Shopify. Alphabetical. */
async function listCollections() {
  const r = await query(
    `SELECT c.tag,
            COUNT(m.groupid)::int AS styles,
            COUNT(m.groupid) FILTER (WHERE COALESCE(ss.shopify, 0) <> 1)::int AS off
     FROM collection c
     LEFT JOIN collection_member m ON m.tag = c.tag
     LEFT JOIN skusummary ss      ON ss.groupid = m.groupid
     GROUP BY c.tag
     ORDER BY c.tag`
  );
  return r.rows;
}

async function memberIds(tag) {
  const r = await query(`SELECT groupid FROM collection_member WHERE tag = $1 ORDER BY groupid`, [tag]);
  return r.rows.map((x) => x.groupid);
}

async function tagsByStyle() {
  const r = await query(`SELECT groupid, array_agg(tag ORDER BY tag) AS tags FROM collection_member GROUP BY groupid`);
  return new Map(r.rows.map((x) => [x.groupid, x.tags]));
}

// -------------------------------------------------------------------------------------------------------------------------------------
// WRITES
// -------------------------------------------------------------------------------------------------------------------------------------

async function logLine(operator, msg) {
  try {
    await query(
      `INSERT INTO bclog (workstation, section, log, date, time, created_at)
       VALUES ($1, 'Collections', $2, (now() AT TIME ZONE 'Europe/London')::date,
               to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
      [operator, msg.slice(0, 1000)]
    );
  } catch (err) {
    logger.error('[collectionTags] bclog write failed:', err.message);
  }
  logger.info(`[collectionTags] ${operator}: ${msg}`);
}

/** A new collection (tag). See TAGS in the header. */
async function createCollection(rawTag, operator) {
  const tag = normaliseTag(rawTag);
  if (!tag) throw fail('TAG_INVALID', 'Use 2-40 characters: lower-case letters, numbers and -');
  const exists = await query(`SELECT 1 FROM collection WHERE tag = $1`, [tag]);
  if (exists.rows.length) throw fail('TAG_EXISTS', `There is already a collection called ${tag}`);

  // Already on Shopify products? Then someone tagged them outside this app, and the database would not know who is in it.
  const onShopify = await loadTagged(tag);
  if (onShopify.length) {
    throw fail('TAG_IN_USE', `${onShopify.length} product${onShopify.length === 1 ? ' already carries' : 's already carry'} the tag ${tag} on Shopify — pick another name`);
  }

  await query(`INSERT INTO collection (tag, created_by) VALUES ($1, $2)`, [tag, operator]);
  await logLine(operator, `${tag}: collection created`);
  return { tag };
}

/**
 * Put `tag` on (add = true) or take it off (add = false) each of `groupids`. See THE RULES in the header. `notes` carries the
 * "not on Shopify — removed here" case, which succeeded but didn't touch Shopify.
 */
async function setTag(groupids, rawTag, add, operator) {
  const tag = normaliseTag(rawTag);
  const known = tag ? await query(`SELECT 1 FROM collection WHERE tag = $1`, [tag]) : { rows: [] };
  if (!known.rows.length) throw fail('UNKNOWN_COLLECTION', `No collection called ${rawTag}`);

  // Everything about the styles in one read: the Shopify flag and handle, and how many tags each already has.
  const r = await query(
    `SELECT ss.groupid, NULLIF(TRIM(ss.handle), '') AS handle, COALESCE(ss.shopify, 0) AS shopify,
            (SELECT COUNT(*)::int FROM collection_member m WHERE m.groupid = ss.groupid) AS tag_count,
            EXISTS (SELECT 1 FROM collection_member m WHERE m.groupid = ss.groupid AND m.tag = $2) AS has_tag
     FROM skusummary ss WHERE ss.groupid = ANY($1::text[])`,
    [groupids, tag]
  );
  const style = new Map(r.rows.map((x) => [x.groupid, x]));
  // One batched Shopify read for every product id we'll need (a failure here is a transport problem: nothing has been changed).
  const ids = await idsByHandle(r.rows.map((x) => x.handle));

  const done = [], failed = [], notes = [];
  for (const g of groupids) {
    const s = style.get(g);
    const productId = s && s.handle ? ids.get(s.handle) : undefined;

    if (add) {
      if (!s) { failed.push({ groupid: g, error: 'Not a style in BCWEB' }); continue; }
      if (Number(s.shopify) !== 1) { failed.push({ groupid: g, error: 'Shopify is off' }); continue; }
      if (!s.has_tag && s.tag_count >= MAX_TAGS) { failed.push({ groupid: g, error: `Already has ${MAX_TAGS} tags` }); continue; }
      if (!s.handle) { failed.push({ groupid: g, error: 'No Shopify handle' }); continue; }
      if (!productId) { failed.push({ groupid: g, error: 'Not found on Shopify' }); continue; }
    }

    try {
      await withTransaction(async (client) => {
        // Serialise writes per style so the MAX_TAGS count can't race (released at COMMIT / ROLLBACK).
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('collection_member:' || $1::text))`, [g]);
        if (add) {
          const ins = await client.query(
            `INSERT INTO collection_member (groupid, tag)
             SELECT $1::varchar, $2::varchar
             WHERE (SELECT COUNT(*) FROM collection_member WHERE groupid = $1::varchar AND tag <> $2::varchar) < $3::int
             ON CONFLICT (groupid, tag) DO NOTHING
             RETURNING 1`,
            [g, tag, MAX_TAGS]
          );
          // No row = already a member (fine — Shopify is re-sent below, which heals a missing tag) or the cap was hit since the read.
          if (!ins.rows.length) {
            const c = await client.query(`SELECT 1 FROM collection_member WHERE groupid = $1 AND tag = $2`, [g, tag]);
            if (!c.rows.length) throw new Error(`Already has ${MAX_TAGS} tags`);
          }
          await pushTag(productId, tag, true);
        } else {
          await client.query(`DELETE FROM collection_member WHERE groupid = $1 AND tag = $2`, [g, tag]);
          if (productId) await pushTag(productId, tag, false);
        }
      });
      done.push(g);
      if (!add && !productId) notes.push({ groupid: g, note: 'Not on Shopify — removed here only' });
    } catch (err) {
      failed.push({ groupid: g, error: err.message });
    }
  }

  if (done.length) await logLine(operator, `${tag}: ${add ? 'added' : 'removed'} ${done.join(', ')}`);
  return { done, failed, notes };
}

module.exports = {
  MAX_TAGS, TAG_RE, normaliseTag,
  listCollections, createCollection, setTag, memberIds, tagsByStyle,
  loadTagged, idsByHandle,
};
