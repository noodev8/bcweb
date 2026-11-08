/*
=======================================================================================================================================
Module: utils/orderSync.js   — the Update Orders run (every channel, one transaction)
=======================================================================================================================================
Purpose: runOrderSync() is THE order run. Two callers, one copy of the logic:
           * the Update Orders button  -> POST /order-sync          (routes/order-sync.js)
           * the cron                  -> scripts/order-sync.js      (schedule: docs/crontab.txt)
         Both take the same advisory lock, so a press landing on a cron run just waits a few seconds for it — no timing gaps needed.

THE RUN
    1  READ      every channel in utils/orderChannels.js (Shopify, eBay, …), in parallel, OUTSIDE any transaction — a slow or failed
                 API must never hold a database transaction open. A channel that isn't set up or can't be read is "not checked": it
                 writes nothing this run and the others carry on (logged, not shown on the button — owner, 2026-11-01: the screen
                 shows the total only). No channel readable at all -> NO_CHANNEL_READ, nothing written.
    2  WRITE     one transaction, under pg_advisory_xact_lock('bcweb_order_sync'):
                   each channel's write()  — its new orders, sales, refreshed addresses, posted / cancelled orders archived
                   E  ALLOCATE  pick allocation against free local stock, then AMZ / UKD / other-supplier fallbacks — ONCE, for every
                                channel's orders, so two channels can never take the same shelf row
                   F  CLEANUP   six housekeeping statements over orderstatus + localstock
                   one bclog row (section 'Order Sync', workstation = who pressed, or 'cron') — /order-sync-last reads it
         A run lands completely or not at all; a failure is "nothing written, safe to run again".
    3  SHOPIFY STOCK  FIRST after the commit: Shopify's count for every live size set to our free local + FBA live stock (cap 5),
                 less Shopify orders not yet imported — only sizes that differ, refused if Shopify's count moved mid-run
                 (utils/shopifyStockSync.js; replaced the Python update_shopify_inventory.py at 3am, owner 2026-11-08). First, because
                 overselling is what it prevents: a pair just sold on eBay comes off Shopify now. Never fails the run; own bclog row.
    3b SIZE PRICES  right after: a size's own Shopify price (utils/sizePrice.js, 2026-11-08) ends when the size has sold out
                 (local free + FBA live = 0), so a later delivery or a return sells at the style price; those styles are re-pushed.
                 Never fails the run; a bclog row (section 'Shopify Pricing') only when one ended.
    4  EBAY STOCK  AFTER the commit: new in-stock sizes added to their listings, then eBay's quantities brought in step with our
                 stock (utils/ebayStockSync.js — eBay Add step 3,
                 2026-11-01). Outside the transaction and never allowed to fail the run: the orders are already saved; a size eBay
                 didn't take is retried next run. Not on the button's line (owner: the total of new orders only) — its own bclog row.
    5  ORDER SOURCES  AFTER the commit: where each Shopify order of the last 3 days came from (Google paid / Google free / AI /
                 Email / Direct …) into shopify_order_source (utils/orderSource.js, 2026-11-07 — measuring sales we didn't pay Google
                 for). Read-only on Shopify, never fails the run, no bclog row (it runs every few minutes). Rows older than
                 2 years are deleted as it goes (owner, 2026-11-07).
    6  VISITS    AFTER the commit: Shopify's sessions per day by source for the last 3 days into shopify_sessions_daily
                 (utils/shopifySessions.js — the 20 → 30 visits target), each run replacing those days; 2 years kept. Never fails the run.

HISTORY: until 2026-11-01 the Shopify half also ran from cron as C:\scripts\orders\update_orders.py (a Python twin of these rules)
and eBay had its own cron script, timed 5 minutes apart because the Python took no lock. Both retired: this is the only copy.
Phases A–D (Shopify's own write) now live in utils/shopifyOrderSync.js. docs/order-sync.md has the full picture.

SCOPE NOTE — phases E and F reach outside customer orders:
    * E considers `ordertype NOT IN (3,5)`, which includes the Order Status module's local rows (ordertype 2). They are excluded in
      practice only because routes/order-status-add.js always sets ukd=1 or othersupplier=1, and the candidate filter requires both to
      be 0. That is load-bearing: if a route ever inserts an ordertype-2 row with both flags at 0, this phase would allocate local
      stock to a supplier order and stamp its orderdate — flipping it from TO PLACE to ON ORDER behind the operator's back.
    * F deletes orderstatus rows with `ordertype <> 1` older than 30 days WITHOUT archiving them. That silently removes Order Status
      ON ORDER cards at 30 days; it is long-standing behaviour.
=======================================================================================================================================
*/

const { withTransaction } = require('./transaction');
const { CHANNELS } = require('./orderChannels');
const { syncEbayStock } = require('./ebayStockSync');
const { syncShopifyStock } = require('./shopifyStockSync');
const { endSoldOut } = require('./sizePrice');
const { pushIfLive: shopifyPushIfLive } = require('./shopify');
const { logActivity } = require('./bclog');
const { recordOrderSources, purgeOldSources } = require('./orderSource');
const { recordSessions, purgeOldSessions } = require('./shopifySessions');
const logger = require('./logger');

// ---------------------------------------------------------------------------------------------------------------------------------
// PHASE E — pick allocation.
// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * newFreeRowId(client, ordernum) -> string
 *
 * When a shelf row holds more than one unit, one unit is taken for the order and the remainder becomes a NEW '#FREE' row, which needs
 * an id, minted as digits(ordernum) + a random 100-999 — so order BC18624 produces ids like '18624325'. The live table is
 * full of them ('18624325', '18620407', '18618629') — keep the shape.
 *
 * localstock.id is a VARCHAR primary key with no sequence, so a collision is possible — and an unguarded clash would raise a unique
 * violation that unwinds the ENTIRE run (every channel, every order). So: retry on a taken id, and widen the random suffix if the
 * 900-value space is somehow exhausted. Same id shape, no run-ending failure.
 */
async function newFreeRowId(client, ordernum) {
  const digits = String(ordernum).replace(/\D/g, '') || '0';
  for (let attempt = 0; attempt < 40; attempt++) {
    // First 30 attempts keep the exact legacy shape (3 random digits); after that widen to 5, which stays numeric and unique-ish.
    const width = attempt < 30 ? 3 : 5;
    const min = Math.pow(10, width - 1);
    const rand = Math.floor(Math.random() * (Math.pow(10, width) - min)) + min;
    const id = String(Number(`${digits}${rand}`));
    const clash = await client.query(`SELECT 1 FROM localstock WHERE id = $1`, [id]);
    if (clash.rows.length === 0) return id;
  }
  throw new Error(`could not mint a free localstock id for ${ordernum} after 40 attempts`);
}

/*
 * allocatePicks(client) — PHASE E.
 *
 * Candidates are order lines that still need picking: not Amazon (3) or type 5, not marked "do not order", and with none of the four
 * allocation flags set yet.
 *
 * `batch` is legacy text: a plain `batch::int != -1` would THROW on a blank or non-numeric batch and take the whole run down. Here a batch that isn't a plain integer is simply treated as "not -1" (i.e. included, which is what every
 * real value except '-1' resolves to anyway). Fail-soft instead of run-ending. Phase F deletes batch='-1' rows regardless.
 */
async function allocatePicks(client) {
  const stats = { considered: 0, fullyAllocated: 0, partiallyAllocated: 0, alreadyAllocated: 0,
                  picksTaken: 0, splits: 0, amzMarked: 0, ukdMarked: 0, ukdToOrder: 0, otherMarked: 0, unfulfillable: 0 };
  const notes = [];

  const candidates = await client.query(`
    SELECT ordernum, shopifysku, qty
      FROM orderstatus
     WHERE ordertype NOT IN (3, 5)
       AND (batch IS NULL OR TRIM(batch) !~ '^-0*1$')
       AND COALESCE(amz, 0) = 0
       AND COALESCE(localstock, 0) = 0
       AND COALESCE(ukd, 0) = 0
       AND COALESCE(othersupplier, 0) = 0
       AND (orderdate IS NULL OR LOWER(orderdate) NOT LIKE '%do not order%')
  `);

  for (const row of candidates.rows) {
    const { ordernum, shopifysku } = row;
    const orderQty = Number(row.qty) || 0;
    if (orderQty <= 0) {
      notes.push(`${ordernum} / ${shopifysku}: skipped — quantity is ${row.qty}`);
      continue;
    }
    stats.considered += 1;

    // Picks already sitting against this order (a previous run that only got part way, or a hand-allocated pick).
    const already = Number((await client.query(
      `SELECT COUNT(*) AS n FROM localstock WHERE code = $1 AND ordernum = $2 AND deleted = 0`,
      [shopifysku, ordernum]
    )).rows[0].n);

    if (already >= orderQty) {
      // Nothing to do but record it, so the row drops out of the candidate set next run and can't be picked twice.
      await client.query(
        `UPDATE orderstatus SET orderdate = created, localstock = $1 WHERE ordernum = $2 AND shopifysku = $3`,
        [already, ordernum, shopifysku]
      );
      stats.alreadyAllocated += 1;
      continue;
    }

    const needed = orderQty - already;

    // Free shelf stock for this exact SKU. ORDER BY location, id — id is a VARCHAR so this sorts lexicographically; every live id is
    // 8 digits, so that happens to equal numeric order. Kept as-is because which row gets picked determines which SHELF gets picked.
    const freeSql = `
      SELECT id, qty, location, groupid, supplier, brand
        FROM localstock
       WHERE code = $1 AND ordernum = '#FREE' AND (deleted = 0 OR deleted IS NULL) AND allocated = 'unallocated'
       ORDER BY location, id`;

    let available = (await client.query(freeSql, [shopifysku])).rows;

    if (available.length === 0) {
      // ---- No shelf stock. Three fallbacks, in this order: Amazon FBA, then UKD, then "some other supplier". ----
      // None of these stamp orderdate: the line is flagged for sourcing, not picked.
      const amz = await client.query(`SELECT SUM(amzlive) AS n FROM amzfeed WHERE code = $1 AND amzlive > 0`, [shopifysku]);
      const amzAvailable = Number(amz.rows[0].n) || 0;

      if (amzAvailable > 0) {
        const take = Math.min(needed, amzAvailable);
        await client.query(`UPDATE orderstatus SET amz = $1 WHERE ordernum = $2 AND shopifysku = $3`, [take, ordernum, shopifysku]);
        stats.amzMarked += 1;
        continue;
      }

      const sup = await client.query(
        `SELECT ss.supplier
           FROM skumap sm
           JOIN skusummary ss ON ss.groupid = sm.groupid
          WHERE sm.code = $1 AND ss.supplier IS NOT NULL AND TRIM(ss.supplier) <> ''
          LIMIT 1`,
        [shopifysku]
      );
      const supplier = sup.rows[0] ? sup.rows[0].supplier : null;

      if (supplier && supplier.toLowerCase() === 'ukd') {
        const ukd = await client.query(`SELECT SUM(stock) AS n FROM ukdstock WHERE code = $1 AND stock > 0`, [shopifysku]);
        const ukdAvailable = Number(ukd.rows[0].n) || 0;
        if (ukdAvailable > 0) {
          const take = Math.min(needed, ukdAvailable);
          await client.query(`UPDATE orderstatus SET ukd = $1 WHERE ordernum = $2 AND shopifysku = $3`, [take, ordernum, shopifysku]);
          stats.ukdMarked += 1;
        } else {
          // No UKD stock either — still flag the full quantity so it lands on the order-from-UKD list rather than disappearing.
          await client.query(`UPDATE orderstatus SET ukd = $1 WHERE ordernum = $2 AND shopifysku = $3`, [needed, ordernum, shopifysku]);
          stats.ukdToOrder += 1;
          notes.push(`${ordernum} / ${shopifysku}: nothing on the shelf and none at UKD — flagged to order (${needed})`);
        }
      } else {
        await client.query(`UPDATE orderstatus SET othersupplier = $1 WHERE ordernum = $2 AND shopifysku = $3`, [needed, ordernum, shopifysku]);
        stats.otherMarked += 1;
        notes.push(`${ordernum} / ${shopifysku}: no stock anywhere — flagged to ${supplier || 'an unknown supplier'} (${needed})`);
      }
      continue;
    }

    // ---- Shelf stock exists. Take one unit at a time. ----
    let taken = 0;
    while (taken < needed) {
      // Re-read every iteration: splitting a multi-unit row CREATES a new '#FREE' row that this loop may need to see.
      available = (await client.query(freeSql, [shopifysku])).rows;
      if (available.length === 0) break;

      const pick = available[0];
      const pickQty = Number(pick.qty) || 0;

      if (pickQty > 1) {
        // Split: this row becomes the single allocated unit, and the remainder moves to a brand-new free row on the same shelf.
        await client.query(`UPDATE localstock SET qty = 1, ordernum = $1 WHERE id = $2`, [ordernum, pick.id]);
        const remainderId = await newFreeRowId(client, ordernum);
        await client.query(
          `INSERT INTO localstock (id, updated, ordernum, location, groupid, code, supplier, qty, brand, allocated, deleted)
           VALUES ($1, CURRENT_TIMESTAMP, '#FREE', $2, $3, $4, $5, $6, $7, 'unallocated', 0)`,
          [remainderId, pick.location, pick.groupid, shopifysku, pick.supplier, pickQty - 1, pick.brand]
        );
        stats.splits += 1;
      } else {
        await client.query(`UPDATE localstock SET ordernum = $1 WHERE id = $2`, [ordernum, pick.id]);
      }
      taken += 1;
      stats.picksTaken += 1;
    }

    const total = already + taken;
    if (taken > 0) {
      // Stamped even on a PARTIAL allocation — deliberate in the original: the stamp is what stops the line being picked again, and a
      // half-picked line must not be re-swept next run. The warning below is the only signal that it went out short.
      await client.query(
        `UPDATE orderstatus SET orderdate = created, localstock = $1 WHERE ordernum = $2 AND shopifysku = $3`,
        [total, ordernum, shopifysku]
      );
      if (total === orderQty) stats.fullyAllocated += 1;
      else {
        stats.partiallyAllocated += 1;
        notes.push(`${ordernum} / ${shopifysku}: PARTIALLY picked — ${total} of ${orderQty}`);
      }
    } else {
      stats.unfulfillable += 1;
      notes.push(`${ordernum} / ${shopifysku}: no picks allocated`);
    }
  }

  return { ...stats, notes };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PHASE F — housekeeping. Six statements, always run, whatever the earlier phases did.
// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * cleanup(client) -> counts
 *
 * Two of these deliberately reach beyond customer orders — see the SCOPE NOTE at the top of the file. The comments on the 30-day
 * and 7-day deletes are the original author's reasoning, carried over rather than re-derived.
 */
async function cleanup(client) {
  const out = {};

  // Soft-deleted stock rows are cleared once per run; nothing reads deleted=1 after this point.
  out.localstockDeleted = (await client.query(`DELETE FROM localstock WHERE deleted = 1`)).rowCount || 0;

  // batch '-1' is the legacy "discard this line" marker.
  out.batchMinusOne = (await client.query(`DELETE FROM orderstatus WHERE batch = '-1'`)).rowCount || 0;

  // 30-day window. Real supplier lead time is ~10 days typical, 20 days the longest legitimate arrival observed — 30d is the ceiling
  // plus buffer. This ignores `arrived` on purpose, so it also clears arrived=1 rows with a NULL arriveddate that the 7-day purge
  // below would miss. NOTE it takes Order Status rows (ordertype 2 and 3) with it, unarchived.
  out.oldOrderStatus = (await client.query(
    `DELETE FROM orderstatus WHERE ordertype <> 1 AND createddate < NOW() - INTERVAL '30 days'`
  )).rowCount || 0;

  // Received Amazon rows are purged after a 7-day reconciliation window. This replaced an INSTANT arrived=1 delete that erased the
  // order trail the moment stock was received — the root cause of the '#FREE-leak' incident.
  out.arrivedAmazon = (await client.query(
    `DELETE FROM orderstatus WHERE ordertype = 3 AND arrived = 1 AND arriveddate < CURRENT_DATE - INTERVAL '7 days'`
  )).rowCount || 0;

  // Empty free rows serve no purpose and clutter the pick query's ORDER BY.
  out.emptyFree = (await client.query(`DELETE FROM localstock WHERE qty = 0 AND ordernum = '#FREE'`)).rowCount || 0;

  // Anything sitting on the C3-Amazon shelf belongs to FBA, not to the pick pool — re-flag it so phase E can never allocate it.
  out.amzShelf = (await client.query(
    `UPDATE localstock SET allocated = 'amz' WHERE location = 'C3-Amazon' AND allocated = 'unallocated'`
  )).rowCount || 0;

  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// THE RUN
// ---------------------------------------------------------------------------------------------------------------------------------

// The one line the button shows (owner, 2026-11-01: "Just the total number of orders"). Distinct ORDERS new to our database, every
// channel together — a 3-item order is "1 new order". Which channel each came from is on the Sales screen and in the bclog row.
function headlineOf(newOrders) {
  return newOrders ? `${newOrders} new order${newOrders === 1 ? '' : 's'}` : 'No new orders';
}

/*
 * runOrderSync({ by }) -> { newOrders, headline, channels, picks, housekeeping, notes, log }
 *   by: who ran it — the user's display name (button) or 'cron'. Written as the bclog workstation.
 * Throws (nothing written) when no channel could be read (err.code 'NO_CHANNEL_READ') or a write failed and rolled back.
 */
async function runOrderSync({ by }) {
  // ---- 1. READ (no transaction held) ------------------------------------------------------------------------------------------
  const reads = await Promise.all(CHANNELS.map(async (ch) => {
    if (!ch.isConfigured()) return { ch, error: `not set up (${ch.setupHint})` };
    try {
      return { ch, fetched: await ch.fetch() };
    } catch (err) {
      return { ch, error: err.message || String(err) };
    }
  }));
  for (const r of reads) if (r.error) logger.error(`[orderSync] ${r.ch.name} not checked: ${r.error}`);

  if (!reads.some((r) => r.fetched)) {
    const err = new Error(`No sales channel could be read — nothing was written (${reads.map((r) => `${r.ch.name}: ${r.error}`).join('; ')})`);
    err.code = 'NO_CHANNEL_READ';
    throw err;
  }

  // ---- 2. WRITE (one transaction) -----------------------------------------------------------------------------------------------
  const result = await withTransaction(async (client) => {
    // Serialises every run — two operators, a double-click, a press during the cron. Transaction-scoped: released on COMMIT/ROLLBACK.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bcweb_order_sync'))`);

    const channels = [];
    for (const r of reads) {
      if (!r.fetched) {
        channels.push({ name: r.ch.name, checked: false, error: r.error, newOrders: 0, notes: [], log: 'not checked', detail: null });
        continue;
      }
      const out = await r.ch.write(client, r.fetched);
      channels.push({ name: r.ch.name, checked: true, error: null, ...out });
    }

    const { notes: pickNotes, ...picks } = await allocatePicks(client);
    const housekeeping = await cleanup(client);

    const newOrders = channels.reduce((n, c) => n + (c.newOrders || 0), 0);
    const headline = headlineOf(newOrders);

    // Audit row — the channel detail lives HERE (and in the server log), not on the button. created_at is UTC; the date/time text
    // stamps are Europe/London for the legacy PowerBuilder log view. varchar(500).
    const log = `Order Sync: ${headline} — ${channels.map((c) => `${c.name} ${c.log}`).join(' · ')} · ${picks.picksTaken} picks`;
    await client.query(
      `INSERT INTO bclog (workstation, section, log, date, time, created_at)
       VALUES ($1, 'Order Sync', $2,
               (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
      [String(by || 'unknown'), log.slice(0, 500)]
    );

    // Every per-line warning, channel-labelled, capped so a pathological run can't return a novel.
    const notes = [...channels.flatMap((c) => c.notes.map((n) => `${c.name}: ${n}`)), ...pickNotes].slice(0, 50);
    return { newOrders, headline, channels: channels.map(({ notes: _n, ...c }) => c), picks, housekeeping, notes, log };
  });

  logger.info(`[orderSync] ${by}: ${result.log}`);
  if (result.notes.length) logger.error(`[orderSync] notes: ${result.notes.join(' | ')}`);

  // ---- 3. SHOPIFY STOCK (first after the commit — never fails the run) --------------------------------------------------------
  // Shopify's counts brought in step with our free local + FBA live stock (utils/shopifyStockSync.js). First of the post-commit steps
  // because it is the one that stops overselling — this run's orders and picks are already saved, so it sees them.
  try {
    const s = await syncShopifyStock({ by });
    result.shopifyStock = { checked: s.checked, sent: s.sent.length, stale: s.stale.length, failed: s.failed.length, ordersRead: s.ordersRead };
    if (s.sent.length || s.stale.length || s.failed.length) {
      logger.info(`[orderSync] Shopify stock: ${s.sent.length} set, ${s.stale.length} moved meanwhile, ${s.failed.length} failed of ${s.checked}`);
    }
    if (s.failed.length) logger.error(`[orderSync] Shopify stock failures: ${s.failed.map((f) => `${f.code}: ${f.error}`).join(' | ')}`);
  } catch (err) {
    result.shopifyStock = { error: err.message };
    logger.error(`[orderSync] Shopify stock sync failed (orders are saved): ${err.message}`);
  }

  // ---- 3b. SIZE PRICES THAT HAVE SOLD OUT (after the commit — never fails the run) -------------------------------------------
  // A size's own Shopify price ends when the size sells out (utils/sizePrice.js, owner 2026-11-08), so a later delivery or a return
  // sells at the style price. Its own small transaction (rows deleted + logged — the log rows send the change to Google via the sweep),
  // then each style touched is re-pushed to Shopify. Right after the stock step: this run's sales are saved, so a last pair just sold
  // is already out of free stock.
  try {
    const ended = await withTransaction((client) => endSoldOut(client, { by: String(by || 'cron') }));
    result.sizePrices = { ended: ended.ended.length, pushed: 0, failed: 0 };
    for (const groupid of ended.groupids) {
      const p = await shopifyPushIfLive(groupid);
      if (p && p.pushed === false) { result.sizePrices.failed += 1; logger.error(`[orderSync] size price push failed for ${groupid}: ${p.message}`); }
      else if (p) result.sizePrices.pushed += 1;
    }
    if (ended.ended.length) {
      const line = `Size prices ended: ${ended.ended.map((e) => `${e.code} £${e.price.toFixed(2)} (${e.reason === 'soldout' ? 'sold out' : 'tidy'})`).join(', ')}`;
      logger.info(`[orderSync] ${line}`);
      await logActivity({ who: String(by || 'cron'), section: 'Shopify Pricing', log: line });
    }
  } catch (err) {
    result.sizePrices = { error: err.message };
    logger.error(`[orderSync] size price tidy failed (orders are saved): ${err.message}`);
  }

  // ---- 4. EBAY STOCK (after the commit — never fails the run) -----------------------------------------------------------------
  try {
    result.ebayStock = await syncEbayStock({ by });
    const s = result.ebayStock;
    if (s.added.length || s.updated.length || s.failed.length) {
      logger.info(`[orderSync] eBay stock: ${s.added.length} sizes added, ${s.updated.length} updated, ${s.failed.length} failed of ${s.checked}`);
    }
    if (s.failed.length) logger.error(`[orderSync] eBay stock failures: ${s.failed.map((f) => `${f.code}: ${f.error}`).join(' | ')}`);
  } catch (err) {
    result.ebayStock = { error: err.message };
    logger.error(`[orderSync] eBay stock sync failed (orders are saved): ${err.message}`);
  }

  // ---- 5. WHERE SHOPIFY BUYERS CAME FROM (after the commit — never fails the run) ---------------------------------------------
  // shopify_order_source (utils/orderSource.js, owner 2026-11-07): every Shopify order of the last 3 days, re-read each run so a
  // customer journey Shopify fills in late is picked up. Read-only on Shopify; writes only that table. Not on the button's line.
  try {
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const s = await recordOrderSources({ since });
    const purged = await purgeOldSources();   // keeps 2 years (owner, 2026-11-07)
    result.orderSources = { read: s.read, recorded: s.recorded, purged };
  } catch (err) {
    result.orderSources = { error: err.message };
    logger.error(`[orderSync] order sources not recorded (orders are saved): ${err.message}`);
  }

  // ---- 6. SHOPIFY VISITS PER DAY (after the commit — never fails the run) -----------------------------------------------------
  // shopify_sessions_daily (utils/shopifySessions.js, owner 2026-11-07 — the 20 → 30 visits a day target): the last 3 days re-read
  // each run (Shopify revises recent days; today is partial until it's over), then anything over 2 years purged. Read-only on Shopify.
  try {
    const d = new Date(Date.now() - 2 * 864e5);
    const since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const s = await recordSessions({ since });
    result.sessions = { days: s.days, sessions: s.sessions, purged: await purgeOldSessions() };
  } catch (err) {
    result.sessions = { error: err.message };
    logger.error(`[orderSync] Shopify visits not recorded (orders are saved): ${err.message}`);
  }
  return result;
}

module.exports = { runOrderSync, allocatePicks, cleanup, headlineOf };
