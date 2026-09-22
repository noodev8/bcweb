/*
=======================================================================================================================================
Module: utils/productEvents.js
=======================================================================================================================================
Purpose: The single writer for `product_event_log` — the append-only record of product CREATION and DELETION that feeds the throughput
         reporting. Three routes log an event (product-create, product-copy, product-delete) and they all go through here so the three
         inserts can't drift apart in column list, casing or intent.

Why the log exists at all (the short version — migrations/20260922c_product_event_log.sql has the long one):
  skusummary.created_at only knows what SURVIVED. product-delete hard-deletes the row, so a style built in March and killed in June
  reads as though it was never made. For "how much new product did we make, how fast", that is the wrong denominator — the killed line
  was still the work. This table records the work; skusummary records the catalogue.

Rules the callers depend on:
  - ALWAYS called with the route's transaction client, never the bare pool. The event must land in the SAME transaction as the
    create/delete it describes: a create that rolls back must log nothing, and a committed create must not be able to fail to log.
  - `actionedBy` is the operator's display_name from req.user (resolved server-side from the JWT — never sent by the client, same rule
    as price_change_log.changed_by). Backfilled rows carry NULL because nobody did them.
  - title/brand are SNAPSHOTS passed in by the caller, not joins. A report that had to join skusummary to name a product would lose
    every deleted one all over again, which is the exact problem this table exists to fix.
=======================================================================================================================================
*/

// Event names and sources, named so a typo is a crash here rather than a row that quietly never appears in a report.
const EVENT = { CREATED: 'CREATED', DELETED: 'DELETED' };
const SOURCE = { NEW: 'NEW', COPY: 'COPY', UI: 'UI' };

/*
Insert one product event.

  client            pg client from withTransaction (required — see the rules above)
  groupid           the product key
  event             EVENT.CREATED | EVENT.DELETED
  source            SOURCE.NEW (built from scratch) | SOURCE.COPY (cloned) | SOURCE.UI (deleted through the app)
  title, brand      snapshot of the product at event time (either may be blank/null)
  actionedBy        operator display_name
  productCreatedAt  the product's birth date. Pass null on a CREATED row (it IS the birth) and skusummary.created_at on a DELETED row,
                    which is what makes lifespan readable without the matching CREATED row existing — it won't, for anything born
                    before this table did.
*/
async function logProductEvent(client, { groupid, event, source, title, brand, actionedBy, productCreatedAt = null }) {
  await client.query(`
    INSERT INTO product_event_log (groupid, event, source, title, brand, actioned_by, product_created_at, event_at)
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), now())
  `, [groupid, event, source, title || null, brand || null, actionedBy || null, productCreatedAt]);
}

module.exports = { logProductEvent, EVENT, SOURCE };
