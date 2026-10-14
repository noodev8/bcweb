/*
=======================================================================================================================================
Util: clearanceTag
=======================================================================================================================================
Purpose: Keep the Shopify `clearance` TAG in step with the SITTING list (Winners → Slow). Owner, 2026-10-10: "Back comes the
         collection functionality. We need to set a tag on these. But be able to remove tags for items that drop out of here." The tag
         is what a Shopify smart collection keys on (rule "Product tag is equal to clearance"); the OWNER creates and names that
         collection in Shopify admin — this util only manages the tag. At build time no collection used the tag yet.

ADD-ONLY — THE OWNER DECIDES WHAT LEAVES (2026-10-14). Until then the list owned the tag: every sync made the tagged set EXACTLY the
         sitting styles, so a style that sold ONE pair came off on the next press. On 2026-10-13 that pulled 9 styles out mid-campaign
         (1019051-ARIZONA sold 2 at 50% off on the 12th) — the email campaign stopped showing them and the 50% price stayed, leaving
         price and collection out of step (the 9 were re-tagged by hand the next day). Owner: "Update Collection should specifically be
         add new products to collection" and, on what takes a style out, "Leave it to me only". So now:
           ADD ALL = sitting (utils/stockSitting.js), skusummary.shopify = 1, found on Shopify by handle, NOT already tagged
           REMOVE  = never by the sync. Only removeFromCollection() — the owner's Remove on Slow (one style with an optional price, or
                     ticked rows in bulk).
         The owner can also add chosen styles (addToCollection) — "its up to me to choose what is in or out the collection".
         In the collection and sitting are now two separate facts: a tagged style that sells stays tagged (Slow lists it as in the
         collection but no longer sitting). A hand-tag in Shopify admin now survives too. (The sitting "cut", which kept styles out of
         the add, was removed the same day — owner: "Cut is mixing the logic".)
         Only the `clearance` tag is touched: tagsAdd / tagsRemove change just that tag, every other tag on a product is left alone.

ONE CLICK (owner, 2026-10-10). "Update collection" on Slow runs applySync() straight away and the screen shows only +added.
         planSync() is still the single place the plan is worked out (applySync calls it first), and it is read-only if you ever want
         a dry run from a script.

NO DATABASE WRITES apart from one bclog line per add run / remove (section 'Clearance Tags'). SHOPIFY IS THE ONLY STORE OF WHO IS IN
         THE COLLECTION — no skusummary column, so a hand edit in Shopify admin is simply the truth and nothing can drift. Each product is
         its own Shopify call and a failure on one doesn't stop the rest — re-running the sync retries exactly those (idempotent).

ONE STYLE = ONE SHOPIFY PRODUCT, matched on skusummary.handle (the same key utils/shopify.js upserts on).
=======================================================================================================================================
Exports:
  CLEARANCE_TAG
  planSync()                 -> { tag, add: Item[], missing: Item[], tagged_now, sitting_on_shopify }   // read-only; used by applySync
  applySync(operator)        -> { tag, added: Item[], failed: (Item & {error})[], missing: Item[] }    // ADD ONLY
  loadCollection()           -> { groupid|null, handle, title, price|null, units|null, sitting }[]   // read-only: everything tagged now
  addToCollection(groupids, operator)      -> { done: string[], failed: {groupid, error}[] }   // the owner's chosen styles in
  removeFromCollection(groupids, operator) -> { done: string[], failed: {groupid, error}[] }   // the owner's chosen styles out
  Item = { groupid: string|null, handle: string, title: string|null, product_id?: string }
=======================================================================================================================================
*/

const { query } = require('../database');
const { shopifyGraphQL } = require('./shopify');
const { loadStockSplit } = require('./stockSitting');
const logger = require('./logger');

const CLEARANCE_TAG = 'clearance';

// Every product carrying the tag, paged (Shopify caps a page at 250). `tag:` in the search syntax is an exact tag match.
const TAGGED_QUERY = `
  query($after: String, $q: String!) {
    products(first: 250, after: $after, query: $q) {
      nodes { id handle title }
      pageInfo { hasNextPage endCursor }
    }
  }`;

async function loadTagged() {
  const out = [];
  let after = null;
  do {
    const d = await shopifyGraphQL(TAGGED_QUERY, { after, q: `tag:${CLEARANCE_TAG}` });
    out.push(...d.products.nodes);
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after);
  return out;
}

// Product ids for a set of handles, in batches of 50 (a search of `handle:a OR handle:b …`). Search is fuzzy-ish, so only an EXACT
// handle match is kept — the same caution as utils/shopify.js findProductIdByHandle.
async function idsByHandle(handles) {
  const map = new Map();
  for (let i = 0; i < handles.length; i += 50) {
    const batch = handles.slice(i, i + 50);
    const d = await shopifyGraphQL(TAGGED_QUERY, { after: null, q: batch.map((h) => `handle:${h}`).join(' OR ') });
    const want = new Set(batch);
    for (const n of d.products.nodes) if (want.has(n.handle)) map.set(n.handle, n.id);
  }
  return map;
}


/** What a sync would do right now. ADD ONLY (see header). Read-only (Shopify reads + DB reads). */
async function planSync() {
  const styles = (await loadStockSplit()).styles;
  const sittingIds = styles.map((s) => s.groupid);

  // Sitting styles that are live on Shopify, with their handle (no handle = can't be on Shopify, reported as missing).
  const r = await query(
    `SELECT groupid, NULLIF(TRIM(handle), '') AS handle FROM skusummary WHERE groupid = ANY($1::text[]) AND shopify = 1`,
    [sittingIds]
  );
  const byGroup = new Map(r.rows.map((x) => [x.groupid, x.handle]));
  const titleOf = new Map(styles.map((s) => [s.groupid, s.title]));
  const wanted = sittingIds.filter((g) => byGroup.has(g));   // keep the sitting order (most pairs first)

  const tagged = await loadTagged();
  const taggedByHandle = new Map(tagged.map((p) => [p.handle, p]));

  // Handles we want tagged that aren't yet — look up their product ids in one batched pass.
  const toFind = wanted.map((g) => byGroup.get(g)).filter((h) => h && !taggedByHandle.has(h));
  const ids = await idsByHandle(toFind);

  const add = [];
  const missing = [];
  for (const g of wanted) {
    const handle = byGroup.get(g);
    const item = { groupid: g, handle: handle || '', title: titleOf.get(g) || null };
    if (!handle) { missing.push(item); continue; }
    if (taggedByHandle.has(handle)) continue;                                // already in the collection — nothing to do
    if (!ids.has(handle)) { missing.push(item); continue; }                  // flagged live, but Shopify has no such product
    add.push({ ...item, product_id: ids.get(handle) });
  }

  return { tag: CLEARANCE_TAG, add, missing, tagged_now: tagged.length, sitting_on_shopify: wanted.length };
}

const TAGS_ADD = `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`;
const TAGS_REMOVE = `mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`;

async function runOne(mutation, field, item) {
  try {
    const d = await shopifyGraphQL(mutation, { id: item.product_id, tags: [CLEARANCE_TAG] });
    const errs = d[field].userErrors || [];
    return errs.length ? errs.map((e) => e.message).join('; ') : null;
  } catch (err) {
    return err.message;
  }
}

// One bclog line, section 'Clearance Tags'. The Shopify side has already happened and can't be rolled back; a missing log line is not
// worth failing the response over.
async function logLine(operator, msg) {
  try {
    await query(
      `INSERT INTO bclog (workstation, section, log, date, time, created_at)
       VALUES ($1, 'Clearance Tags', $2, (now() AT TIME ZONE 'Europe/London')::date,
               to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
      [operator, msg]
    );
  } catch (err) {
    logger.error('[clearanceTag] bclog write failed:', err.message);
  }
  logger.info(`[clearanceTag] ${operator}: ${msg}`);
}

/** Re-plan, then tag on Shopify. ADD ONLY — nothing is ever untagged here. One bclog line. `operator` = the logged-in display name. */
async function applySync(operator) {
  const plan = await planSync();
  const added = [], failed = [];

  // One at a time: a few dozen calls, well inside Shopify's rate limit, and shopifyGraphQL already backs off on a 429.
  for (const item of plan.add) {
    const err = await runOne(TAGS_ADD, 'tagsAdd', item);
    if (err) failed.push({ ...item, error: err }); else added.push(item);
  }

  await logLine(operator, `Clearance tags: +${added.length}` + (failed.length ? ` (${failed.length} failed)` : ''));
  return { tag: CLEARANCE_TAG, added, failed, missing: plan.missing };
}

// Price is VARCHAR and can hold junk (CLAUDE.md) — a number or null, never a throw.
const toPrice = (v) => (v != null && /^[0-9]+([.][0-9]+)?$/.test(String(v).trim()) ? Number(v) : null);

/**
 * Everything in the collection right now (tagged on Shopify), joined to our style by handle: Shopify price, live pairs (the
 * stockSitting definition — local #FREE + Amazon, one number) and whether it is still sitting. groupid null = a tagged product we
 * don't know (hand-tagged in admin). Read-only: one paged Shopify read, the sitting split, one DB read.
 */
async function loadCollection() {
  const tagged = await loadTagged();
  if (tagged.length === 0) return [];
  const sitting = new Set((await loadStockSplit()).styles.map((s) => s.groupid));
  const r = await query(
    `SELECT ss.groupid, TRIM(ss.handle) AS handle, ss.shopifyprice AS price,
            COALESCE(lf.qty, 0) + COALESCE(a.qty, 0) AS units
     FROM skusummary ss
     LEFT JOIN (SELECT groupid, SUM(qty) AS qty FROM localstock
                WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 GROUP BY groupid) lf ON lf.groupid = ss.groupid
     LEFT JOIN (SELECT groupid, SUM(amztotal) AS qty FROM amzfeed GROUP BY groupid) a ON a.groupid = ss.groupid
     WHERE TRIM(ss.handle) = ANY($1::text[])`,
    [tagged.map((p) => p.handle)]
  );
  const byHandle = new Map(r.rows.map((x) => [x.handle, x]));
  return tagged.map((p) => {
    const x = byHandle.get(p.handle);
    return {
      groupid: x ? x.groupid : null,
      handle: p.handle,
      title: p.title,
      price: x ? toPrice(x.price) : null,
      units: x ? Number(x.units) : null,
      sitting: x ? sitting.has(x.groupid) : false,
    };
  });
}

// Tag / untag the owner's CHOSEN styles (ticked rows, or one row). Any style can go in — sitting or not, the owner decides. A new price
// on Remove is a separate W1 the screen sends after. Each style is its own Shopify call; one failing doesn't stop the rest.
async function setChosen(groupids, mutation, field, verb, operator) {
  const r = await query(`SELECT groupid, NULLIF(TRIM(handle), '') AS handle FROM skusummary WHERE groupid = ANY($1::text[])`, [groupids]);
  const handleOf = new Map(r.rows.map((x) => [x.groupid, x.handle]));
  const ids = await idsByHandle(r.rows.map((x) => x.handle).filter(Boolean));
  const done = [], failed = [];
  for (const g of groupids) {
    const handle = handleOf.get(g);
    if (!handle) { failed.push({ groupid: g, error: 'No Shopify handle' }); continue; }
    if (!ids.has(handle)) { failed.push({ groupid: g, error: 'Not found on Shopify' }); continue; }
    const err = await runOne(mutation, field, { product_id: ids.get(handle) });
    if (err) failed.push({ groupid: g, error: err }); else done.push(g);
  }
  if (done.length) await logLine(operator, `Clearance tags: ${verb} ${done.join(', ')}`.slice(0, 1000));
  return { done, failed };
}

const addToCollection = (groupids, operator) => setChosen(groupids, TAGS_ADD, 'tagsAdd', 'added', operator);
const removeFromCollection = (groupids, operator) => setChosen(groupids, TAGS_REMOVE, 'tagsRemove', 'removed', operator);

module.exports = { CLEARANCE_TAG, planSync, applySync, loadCollection, addToCollection, removeFromCollection };
