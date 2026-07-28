/*
=======================================================================================================================================
Util: amzImportApply
=======================================================================================================================================
Purpose: The WRITE half of the Update Amazon import — the three phases that actually change the database. Every function here takes
         a transaction client and is called only from routes/amz-import-commit.js, inside one withTransaction.

Split out of the route deliberately: the route owns HTTP concerns (multipart, envelopes, return codes) and these own the data work,
so the write logic can be exercised directly against a `BEGIN ... ROLLBACK` client without going through an HTTP layer. That matters
here more than usual — this is a live production database, and being able to rehearse a full import and roll it back is the only
honest way to know what a run will do.

PHASE 1  INGEST   orders + returns -> sales | fee report -> skumap.fbafee | inventory -> amzfeed stock columns
PHASE 2  DERIVE   two grouped queries over sales — a FIXED 30-day window, plus 7 days
PHASE 3  PROJECT  write those derived values onto amzfeed, for PowerBuilder ONLY

Phase 3 has no BCWEB reader. `of_filteramzdisplay:220-230` reads those five columns and nothing here does; they are maintained only
because PowerBuilder is still in service (decision D1). When PB is retired, delete projectDerivedToAmzfeed() and its call site.
=======================================================================================================================================
*/

const { SOLD_WINDOW_DAYS, SOLD_RECENT_DAYS } = require('./amzImport');

// Rows per multi-row INSERT. A 12-month backfill can be tens of thousands of lines, and one statement per row would be an N+1 in
// all but name; one giant statement would blow past Postgres' parameter ceiling. 500 rows x 11 params keeps both in hand.
const CHUNK = 500;

// ---------------------------------------------------------------------------------------------------------------------------------
// PHASE 1 — ingest
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Insert planned `sales` rows — both sales and return reversals, which share a shape (qty carries the sign).
 *
 * ON CONFLICT (source_key) DO NOTHING is the real idempotency guarantee. The plan has already filtered out the duplicates it could
 * see, but that read and this write are separated by the rest of the transaction, and two operators (or one double-click) could
 * interleave. The unique index is what makes re-uploading SAFE rather than merely unlikely to hurt.
 */
async function insertSales(client, rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((r, n) => {
      const b = n * 12;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},'AMZ')`);
      params.push(
        r.code, r.solddate, r.groupid, r.ordernum, r.ordertime, r.qty,
        r.soldprice, r.productname, r.brand, r.profit, r.discount, r.sourceKey
      );
    });
    const res = await client.query(`
      INSERT INTO sales (code, solddate, groupid, ordernum, ordertime, qty, soldprice, productname, brand, profit, discount, source_key, channel)
      VALUES ${values.join(',')}
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`, params);
    inserted += res.rowCount;
  }
  return inserted;
}

/**
 * Retract sales for orders Amazon reports as Cancelled.
 *
 * A Pending order is inserted as a sale; when it later cancels, the legacy dedupe key meant the row was never revisited and the
 * sale stayed on the books permanently (design doc 2.7.1). A cancellation is not a return — the sale never happened — so the row is
 * DELETED rather than reversed. Scoped to channel='AMZ' and to positive-qty rows for the order ids in the uploaded file.
 */
async function retractCancelled(client, cancelPlan) {
  if (cancelPlan.rows === 0) return 0;
  const ids = cancelPlan.orders.map((o) => o.id);
  const res = await client.query(`DELETE FROM sales WHERE id = ANY($1::int[])`, [ids]);
  return res.rowCount;
}

/**
 * Fee report -> skumap.fbafee. A SKU absent from the file keeps its last known fee (decision D3) — absence means "not in FBA", not
 * "fee withdrawn", so there is deliberately no clearing pass here.
 */
async function applyFees(client, feePlan) {
  if (feePlan.update.length === 0) return 0;
  let updated = 0;
  for (let i = 0; i < feePlan.update.length; i += CHUNK) {
    const chunk = feePlan.update.slice(i, i + CHUNK);
    const codes = chunk.map((u) => u.code);
    const fees = chunk.map((u) => u.to);
    const res = await client.query(
      `UPDATE skumap AS s SET fbafee = v.fee
       FROM (SELECT UNNEST($1::text[]) AS code, UNNEST($2::numeric[]) AS fee) v
       WHERE s.code = v.code`,
      [codes, fees]
    );
    updated += res.rowCount;
  }
  return updated;
}

/**
 * Inventory report -> the `amzfeed` STOCK columns.
 *
 * The legacy code deleted the whole table and rebuilt it. That was only safe because it rebuilt every column in the same pass; here
 * the sales columns are derived separately, so a blanket wipe would blank them for any SKU the inventory file happens not to cover.
 * Instead this upserts the rows the report carries and zeroes the stock of rows it doesn't — which is the same end state for stock,
 * without collateral damage to anything else.
 *
 * Writes sku/fnsku/asin/amzprice/amzlive/amztotal only. `fnsku` in particular must keep flowing: the barcode module (still running
 * in PowerBuilder, decision D5) reads it.
 */
async function applyStock(client, stockRows, ref) {
  const rows = [];
  for (const r of stockRows) {
    if (r.isVirtual) continue;                       // Amazon's own generated bundle SKUs — never ours to store
    const m = ref.bySku.get(r.sku);
    if (!m) continue;                                // unknown to skumap — surfaced in the reconciliation panel, not written
    rows.push({ code: m.code, groupid: m.groupid, sku: r.sku, fnsku: r.fnsku, asin: r.asin, price: r.price, live: r.live, total: r.total });
  }
  if (rows.length === 0) return { upserted: 0, zeroed: 0 };

  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((r, n) => {
      const b = n * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
      // amzprice is a legacy VARCHAR — write it as a 2dp string, same convention as skusummary.shopifyprice (CLAUDE.md).
      params.push(r.code, r.groupid, r.sku, r.fnsku, r.asin, r.price === null ? null : r.price.toFixed(2), r.live, r.total);
    });
    const res = await client.query(`
      INSERT INTO amzfeed (code, groupid, sku, fnsku, asin, amzprice, amzlive, amztotal)
      VALUES ${values.join(',')}
      ON CONFLICT (code) DO UPDATE SET
        groupid  = EXCLUDED.groupid,
        sku      = EXCLUDED.sku,
        fnsku    = EXCLUDED.fnsku,
        asin     = EXCLUDED.asin,
        amzprice = EXCLUDED.amzprice,
        amzlive  = EXCLUDED.amzlive,
        amztotal = EXCLUDED.amztotal`, params);
    upserted += res.rowCount;
  }

  // Anything in amzfeed the report didn't mention no longer has FBA stock. Zero the stock columns but keep the row — the SKU still
  // exists, and blanking its identity would break the barcode module and lose the price history the pricing module reads.
  const seen = rows.map((r) => r.code);
  const zero = await client.query(
    `UPDATE amzfeed SET amzlive = 0, amztotal = 0 WHERE NOT (code = ANY($1::text[])) AND (COALESCE(amzlive,0) <> 0 OR COALESCE(amztotal,0) <> 0)`,
    [seen]
  );
  return { upserted, zeroed: zero.rowCount };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PHASE 2 + 3 — derive from sales, project onto amzfeed  (POWERBUILDER ONLY — delete both when PB is retired)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Recompute amzfeed's five sales columns from the `sales` table and write them back.
 *
 * These are read by of_filteramzdisplay:220-230 and by nothing in BCWEB. They exist purely to keep the PowerBuilder Amazon screen
 * working while the two systems run in parallel (decision D1).
 *
 * The window is FIXED at 30 days (decision O2), never derived from the uploaded file. The owner compares `amzsold` across SKUs by
 * eye, so it has to mean the same thing on every run — the legacy behaviour of counting "whatever window happened to be downloaded"
 * made the number quietly incomparable, with nothing recording which window it was.
 *
 * One statement, set-based, replacing the legacy per-SKU nested scan.
 */
async function projectDerivedToAmzfeed(client) {
  const res = await client.query(`
    WITH windowed AS (
      SELECT code,
             SUM(qty) FILTER (WHERE qty > 0)                                              AS sold,
             SUM(qty) FILTER (WHERE qty > 0 AND solddate >= CURRENT_DATE - $2::int)       AS sold7,
             -COALESCE(SUM(qty) FILTER (WHERE qty < 0), 0)                                AS returned
      FROM sales
      WHERE channel = 'AMZ' AND solddate >= CURRENT_DATE - $1::int
      GROUP BY code
    ),
    latest AS (
      -- Most recent SALE (not a return) per code, for amzsoldprice/amzsolddate. DISTINCT ON is the cheap way to do a per-group
      -- top-1 in Postgres. Deliberately NOT limited to the 30-day window: "last sold" must keep working for a SKU that hasn't sold
      -- in months, which is exactly when the operator most wants to see the date.
      SELECT DISTINCT ON (code) code, soldprice, solddate
      FROM sales
      WHERE channel = 'AMZ' AND qty > 0
      ORDER BY code, solddate DESC, id DESC
    )
    UPDATE amzfeed a SET
      amzsold      = COALESCE(w.sold, 0),
      amzsold7     = COALESCE(w.sold7, 0),
      amzreturn    = COALESCE(w.returned, 0),
      -- Legacy VARCHAR columns: amzsoldprice is a 2dp string, amzsolddate is 'YYYYMMDD'. Formatted in SQL so no JS Date ever touches
      -- a pg DATE (CLAUDE.md: that path shifts the day back one under BST).
      amzsoldprice = COALESCE(to_char(l.soldprice, 'FM999999990.00'), '0.00'),
      amzsolddate  = COALESCE(to_char(l.solddate, 'YYYYMMDD'), '20010101')
    -- Self-join so every amzfeed row is updated, including SKUs with no sales at all (which must read 0, not keep a stale count).
    FROM amzfeed t
    LEFT JOIN windowed w ON w.code = t.code
    LEFT JOIN latest   l ON l.code = t.code
    WHERE a.code = t.code`,
    [SOLD_WINDOW_DAYS, SOLD_RECENT_DAYS]
  );
  return res.rowCount;
}

/**
 * The two `skumap` columns the legacy import maintained (decision O1: keep writing them).
 *
 *   amzorderdate2 — the last sold date        (of_updateamzdatadb:490)
 *   amzprofit     — the last per-unit profit  (of_updateamzdatadb:555)
 *
 * Nothing in BCWEB reads either, and `of_filteramzdisplay` recomputes profit locally rather than reading `amzprofit` — but only four
 * PowerBuilder functions have been examined, so "nothing reads them" is unproven. They cost one statement, so they are maintained
 * rather than risked. This matters most if the operator stops running the PowerBuilder import: without this, both would go stale.
 *
 * `amzprofit` is STICKY, matching the legacy behaviour at :550-556 — a SKU with no sale in the window keeps its previous value rather
 * than being zeroed, so the column always holds the last profit actually seen. That is why this is a JOIN and not a LEFT JOIN.
 */
async function projectDerivedToSkumap(client) {
  const res = await client.query(`
    WITH latest AS (
      SELECT DISTINCT ON (code) code, solddate, profit, qty
      FROM sales
      WHERE channel = 'AMZ' AND qty > 0
      ORDER BY code, solddate DESC, id DESC
    )
    UPDATE skumap s SET
      amzorderdate2 = l.solddate,
      -- Legacy VARCHAR, 2dp string. Per UNIT: sales.profit is stored for the whole line, and the legacy column held a unit figure.
      -- Left untouched when the line has no profit, so a NULL can never overwrite a good stored value.
      amzprofit = CASE WHEN l.profit IS NOT NULL AND l.qty > 0
                       THEN to_char(l.profit / l.qty, 'FM999999990.00')
                       ELSE s.amzprofit END
    FROM latest l
    WHERE s.code = l.code`);
  return res.rowCount;
}

module.exports = {
  CHUNK,
  insertSales,
  retractCancelled,
  applyFees,
  applyStock,
  projectDerivedToAmzfeed,
  projectDerivedToSkumap,
};
