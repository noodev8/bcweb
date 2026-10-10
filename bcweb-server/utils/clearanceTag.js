/*
=======================================================================================================================================
Util: clearanceTag
=======================================================================================================================================
Purpose: Keep the Shopify `clearance` TAG in step with the SITTING list (Reports → Stock vs Sales). Owner, 2026-10-10: "Back comes the
         collection functionality. We need to set a tag on these. But be able to remove tags for items that drop out of here." The tag
         is what a Shopify smart collection keys on (rule "Product tag is equal to clearance"); the OWNER creates and names that
         collection in Shopify admin — this util only manages the tag. At build time no collection used the tag yet.

THE LIST OWNS THE TAG (owner's choice, 2026-10-10). After a sync, the products tagged `clearance` are EXACTLY the sitting styles that
         are live on Shopify — no more, no less:
           ADD    = sitting (utils/stockSitting.js), skusummary.shopify = 1, found on Shopify by handle, NOT already tagged
           REMOVE = tagged `clearance` on Shopify, NOT in that sitting set — INCLUDING anything tagged by hand in Shopify admin (the
                    owner accepted that: hand-tagging `clearance` doesn't survive the next sync). At build time 30 of the 50 tagged
                    products were leftovers from the retired excess list and came off on the first sync.
         Only the `clearance` tag is touched: tagsAdd / tagsRemove change just that tag, every other tag on a product is left alone.

ONE CLICK (owner, 2026-10-10). First built as a preview panel then confirm; the owner found it "too much text. Leads to confusion. Just
         do the update", so "Update collection" on Stock vs Sales runs applySync() straight away and the screen shows only +added
         -removed. planSync() is still the single place the plan is worked out (applySync calls it first), and it is read-only if you
         ever want a dry run from a script.

NO DATABASE WRITES apart from one bclog line per apply (section 'Clearance Tags'). Shopify is the only store of "who is tagged": reading
         it back each time is what makes the remove side correct even after a hand edit. Each product is its own Shopify call and a
         failure on one doesn't stop the rest — the result lists failures, and re-running the sync retries exactly those (idempotent).

ONE STYLE = ONE SHOPIFY PRODUCT, matched on skusummary.handle (the same key utils/shopify.js upserts on).
=======================================================================================================================================
Exports:
  CLEARANCE_TAG
  planSync()                 -> {   // read-only; used by applySync tag, add: Item[], remove: Item[], missing: Item[], tagged_now, sitting_on_shopify }
  applySync(operator)        -> { tag, added: Item[], removed: Item[], failed: (Item & {action, error})[], missing: Item[] }
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

/** What a sync would do right now. Read-only (Shopify reads + DB reads). */
async function planSync() {
  const { styles } = await loadStockSplit();
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
  const wantedHandles = new Set();
  for (const g of wanted) {
    const handle = byGroup.get(g);
    const item = { groupid: g, handle: handle || '', title: titleOf.get(g) || null };
    if (!handle) { missing.push(item); continue; }
    wantedHandles.add(handle);
    if (taggedByHandle.has(handle)) continue;                                // already tagged — nothing to do
    if (!ids.has(handle)) { missing.push(item); continue; }                  // flagged live, but Shopify has no such product
    add.push({ ...item, product_id: ids.get(handle) });
  }

  // Tagged but no longer sitting (sold, or never was) — come off. groupid from our DB where the handle is ours, else null.
  const leaving = tagged.filter((p) => !wantedHandles.has(p.handle));
  const g = await query(`SELECT groupid, handle FROM skusummary WHERE handle = ANY($1::text[])`, [leaving.map((p) => p.handle)]);
  const groupByHandle = new Map(g.rows.map((x) => [x.handle, x.groupid]));
  const remove = leaving.map((p) => ({ groupid: groupByHandle.get(p.handle) || null, handle: p.handle, title: p.title, product_id: p.id }));

  return { tag: CLEARANCE_TAG, add, remove, missing, tagged_now: tagged.length, sitting_on_shopify: wanted.length };
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

/** Re-plan, then tag / untag on Shopify. One bclog line. `operator` = the logged-in display name. */
async function applySync(operator) {
  const plan = await planSync();
  const added = [], removed = [], failed = [];

  // One at a time: a few dozen calls, well inside Shopify's rate limit, and shopifyGraphQL already backs off on a 429.
  for (const item of plan.add) {
    const err = await runOne(TAGS_ADD, 'tagsAdd', item);
    if (err) failed.push({ ...item, action: 'add', error: err }); else added.push(item);
  }
  for (const item of plan.remove) {
    const err = await runOne(TAGS_REMOVE, 'tagsRemove', item);
    if (err) failed.push({ ...item, action: 'remove', error: err }); else removed.push(item);
  }

  const msg = `Clearance tags: +${added.length} -${removed.length}` + (failed.length ? ` (${failed.length} failed)` : '');
  try {
    await query(
      `INSERT INTO bclog (workstation, section, log, date, time, created_at)
       VALUES ($1, 'Clearance Tags', $2, (now() AT TIME ZONE 'Europe/London')::date,
               to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
      [operator, msg]
    );
  } catch (err) {
    // The Shopify side has already happened and can't be rolled back; a missing log line is not worth failing the response over.
    logger.error('[clearanceTag] bclog write failed:', err.message);
  }
  logger.info(`[clearanceTag] ${operator}: ${msg}`);

  return { tag: CLEARANCE_TAG, added, removed, failed, missing: plan.missing };
}

module.exports = { CLEARANCE_TAG, planSync, applySync };
