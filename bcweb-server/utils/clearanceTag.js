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
         add new products to collection" and, on what takes a style out, "Leave it to me only". Then the one-click add went too (below),
         so now only the owner's chosen styles go in (addToCollection) or out (removeFromCollection — Slow's Remove, one style with an
         optional price, or ticked rows in bulk) — "its up to me to choose what is in or out the collection".
         In the collection and sitting are now two separate facts: a tagged style that sells stays tagged (Slow lists it as in the
         collection but no longer sitting). (The sitting "cut", which kept styles out of
         the add, was removed the same day — owner: "Cut is mixing the logic".)
         Only the `clearance` tag is touched: tagsAdd / tagsRemove change just that tag, every other tag on a product is left alone.

NO ONE-CLICK ADD ANY MORE (owner, 2026-10-14: "yes remove it"). Slow's "Update collection" (applySync / planSync, POST
         /shopify-clearance-apply, 2026-10-10) tagged every sitting style not yet in, with no preview. The Collections screen does the
         same with the list in view first, so nothing reaches the shop unseen; the button, the route and both functions were removed.

THE DATABASE IS THE RECORD SINCE 2026-10-14 (the Collections screen). Membership lives in collection_member (tag 'clearance'), and
         every add / remove goes through utils/collectionTags.js — the row and the Shopify tag together, the same rules the Collections
         screen uses (an OFF style can't be added but can always be removed; at most 3 tags per style). Until that day Shopify was the
         only store (no column) and this file read the tag live; the owner then chose to manage tags from BCWEB only, so a hand edit in
         Shopify admin is no longer seen. Today's tags were copied in by scripts/collection-import-clearance.js.

ONE STYLE = ONE SHOPIFY PRODUCT, matched on skusummary.handle (the same key utils/shopify.js upserts on).
=======================================================================================================================================
Exports:
  CLEARANCE_TAG
  loadCollection()           -> { groupid, handle, title, price|null, units|null, sitting }[]        // read-only: everything in it now
  addToCollection(groupids, operator)      -> { done: string[], failed: {groupid, error}[] }   // the owner's chosen styles in
  removeFromCollection(groupids, operator) -> { done: string[], failed: {groupid, error}[] }   // the owner's chosen styles out
=======================================================================================================================================
*/

const { query } = require('../database');
const { loadStockSplit } = require('./stockSitting');
const { setTag } = require('./collectionTags');

const CLEARANCE_TAG = 'clearance';

// Price is VARCHAR and can hold junk (CLAUDE.md) — a number or null, never a throw.
const toPrice = (v) => (v != null && /^[0-9]+([.][0-9]+)?$/.test(String(v).trim()) ? Number(v) : null);

/**
 * Everything in the collection right now, with our price, live pairs (the stockSitting definition — local #FREE + Amazon, one number)
 * and whether it is still sitting. Read-only, database only. A member no longer in skusummary still comes back (handle '', no price)
 * so it can be taken out.
 */
async function loadCollection() {
  const sitting = new Set((await loadStockSplit()).styles.map((s) => s.groupid));
  const r = await query(
    `SELECT m.groupid, COALESCE(TRIM(ss.handle), '') AS handle, COALESCE(t.shopifytitle, m.groupid) AS title,
            ss.shopifyprice AS price,
            CASE WHEN ss.groupid IS NULL THEN NULL ELSE COALESCE(lf.qty, 0) + COALESCE(a.qty, 0) END AS units
     FROM collection_member m
     LEFT JOIN skusummary ss ON ss.groupid = m.groupid
     LEFT JOIN title t       ON t.groupid  = m.groupid
     LEFT JOIN (SELECT groupid, SUM(qty) AS qty FROM localstock
                WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 GROUP BY groupid) lf ON lf.groupid = m.groupid
     LEFT JOIN (SELECT groupid, SUM(amztotal) AS qty FROM amzfeed GROUP BY groupid) a ON a.groupid = m.groupid
     WHERE m.tag = $1
     ORDER BY m.groupid`,
    [CLEARANCE_TAG]
  );
  return r.rows.map((x) => ({
    groupid: x.groupid,
    handle: x.handle,
    title: x.title,
    price: toPrice(x.price),
    units: x.units === null ? null : Number(x.units),
    sitting: sitting.has(x.groupid),
  }));
}

// The owner's CHOSEN styles in / out — the Collections screen's rules (utils/collectionTags.js). A new price on Remove is a separate
// W1 the screen sends after.
const addToCollection = async (groupids, operator) => {
  const r = await setTag(groupids, CLEARANCE_TAG, true, operator);
  return { done: r.done, failed: r.failed };
};
const removeFromCollection = async (groupids, operator) => {
  const r = await setTag(groupids, CLEARANCE_TAG, false, operator);
  return { done: r.done, failed: r.failed };
};

module.exports = { CLEARANCE_TAG, loadCollection, addToCollection, removeFromCollection };
