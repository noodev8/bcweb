/*
=======================================================================================================================================
Module: utils/priceWrite.js
=======================================================================================================================================
Purpose: The DATABASE half of the two price writes, in one place, so every screen that sets a price writes it the same way:
           writeShopifyPrice(client, …)  — W1   (routes/pricing-apply.js, and the Pricing Slider's reset / steps)
           writeAmzPrice(client, …)      — W-A1 (routes/amz-apply.js, and the Pricing Slider's reset / steps)

WHY IT WAS PULLED OUT OF THE ROUTES (2026-10-17): the Pricing Slider moves prices too, and its own bookkeeping (slider_member)
has to land in the SAME transaction as the price — a slider that believes it set £52.65 when the price never changed, or
the reverse, is the drift this platform keeps paying for (see the order-sync banner for the worst case). Copying W1 into the slider
routes would have been a second set of rules for the same write. So the routes keep what is theirs — reading and validating the request,
pushing to Shopify after the commit, shaping the response — and call this for the write itself.

Both functions:
  - run on the CALLER'S transaction client (utils/transaction.js → withTransaction) so the caller can add its own rows to the same unit;
  - take a price that is already validated and rounded to 2dp (the caller owns request validation);
  - return { error, message } for a refusal (NOT_FOUND, MATCH_LOCKED) having written nothing, otherwise the outcome;
  - never push anywhere. Shopify's live push happens AFTER the commit (utils/shopify.js → pushIfLive) so a Shopify hiccup can't undo a
    committed price; Amazon has no push at all (the upload basket is built from amz_price_log).
=======================================================================================================================================
*/

const { safeNumeric } = require('./sql');

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/*
 * writeShopifyPrice(client, { groupid, price, reviewDays, note, changedBy })
 *   price       number, > 0, already rounded to 2dp
 *   reviewDays  integer >= 1, or null = leave next_shopify_price_review untouched ("None")
 * Returns { error, message } or { oldPrice, newPrice (the 2dp string written), isHold, warnings, nextReview (pg DATE or null), logId }.
 *
 * Rules (CLAUDE.md W1):
 *   - shopifyprice is a VARCHAR — written as a 2dp STRING ('36.95').
 *   - shopifychange is deliberately NOT set: the caller pushes to Shopify directly after the commit, so the nightly-sync flag would
 *     double-push.
 *   - ALLOW+FLAG below cost (BELOW_COST — a hard block until 2026-10-11, owner: "I need to apply any price I want") and above RRP
 *     (ABOVE_RRP). A bound that reads back NULL (junk VARCHAR) is simply not checked — can't check what we can't read.
 *   - A same-price write is a HOLD (docs/hold-logging-spec.md): logged, born with google_pushed_at stamped so the Google sweep has
 *     nothing to send. The caller pushes it to Shopify only if the live price differs (utils/shopify.js → pushIfStale) — that is
 *     what makes re-Applying after a failed push a real retry.
 *   - Auto-matched styles (the retired amz-match autopilot, CLAUDE.md) are refused with MATCH_LOCKED — a manual price would just be
 *     overwritten at the next sync. Every row is false since 2026-09-15; the guard stays so the feature revives intact.
 * The row is read FOR UPDATE so the old price in the audit row is the one this write replaced, even with two operators on one style.
 */
async function writeShopifyPrice(client, { groupid, price, reviewDays, note, changedBy }) {
  const cur = await client.query(`
    SELECT ${safeNumeric('shopifyprice')} AS now,
           ${safeNumeric('cost')}         AS cost,
           ${safeNumeric('rrp')}          AS rrp,
           match_amazon_price             AS match_amazon
    FROM skusummary WHERE groupid = $1
    FOR UPDATE
  `, [groupid]);
  if (cur.rows.length === 0) return { error: 'NOT_FOUND', message: 'Style not found' };

  const row = cur.rows[0];
  if (row.match_amazon === true) {
    return { error: 'MATCH_LOCKED', message: 'This style auto-matches its Amazon price. Turn off Amazon matching to set the price manually.' };
  }

  const oldPrice = num(row.now);
  const cost = num(row.cost);
  const rrp = num(row.rrp);
  const priceString = price.toFixed(2);

  const warnings = [];
  if (cost !== null && price < cost) warnings.push('BELOW_COST');
  if (rrp !== null && price > rrp) warnings.push('ABOVE_RRP');

  const isHold = oldPrice !== null && oldPrice === price;   // same price as now = a hold (Shopify only if its live price differs)

  // The review cooldown is set only when a period was supplied — with "None" next_shopify_price_review is left completely untouched.
  const setReview = reviewDays !== null ? `, next_shopify_price_review = CURRENT_DATE + $3::int` : '';
  const updParams = reviewDays !== null ? [groupid, priceString, reviewDays] : [groupid, priceString];
  const upd = await client.query(`
    UPDATE skusummary
       SET shopifyprice = $2${setReview}
     WHERE groupid = $1
     RETURNING next_shopify_price_review
  `, updParams);

  // Audit row: (groupid, 'SHP', old, new, reason_code NULL, reason_notes = the note, changed_by). change_date and changed_at default.
  const ins = await client.query(`
    INSERT INTO price_change_log
       (groupid, channel, old_price, new_price, reason_code, reason_notes, changed_by, google_pushed_at)
    VALUES ($1, 'SHP', $2, $3, NULL, $4, $5, CASE WHEN $6::boolean THEN now() END)
    RETURNING id
  `, [groupid, oldPrice, price, note, changedBy, isHold]);

  return {
    oldPrice, newPrice: priceString, isHold, warnings,
    nextReview: upd.rows[0].next_shopify_price_review, logId: ins.rows[0].id,
  };
}

/*
 * writeAmzPrice(client, { code, price, reviewDays, note, changedBy })
 *   price       number, > 0, already rounded to 2dp
 *   reviewDays  integer >= 1, or null = leave skumap.next_amz_price_review untouched ("None")
 * Returns { error, message } or { logId, oldPrice, amzSku, rrp, warnings, nextReview (pg DATE or null) }.
 *
 * Rules (CLAUDE.md W-A1):
 *   - Writes ONE amz_price_log row (the audit trail AND the upload basket's source). NEVER writes amzfeed — it is refreshed from Amazon
 *     and any write would be clobbered. The price only reaches Amazon when someone uploads the basket file.
 *   - ALLOW+FLAG below break-even cost + FBA fee (BELOW_FLOOR — a hard block until 2026-10-11) and above RRP (ABOVE_RRP).
 *   - old_price is NOT NULL on amz_price_log, but the live amzprice can read back NULL (junk VARCHAR). Then the new price is logged as
 *     old_price (a zero-delta row) rather than violate the constraint; the returned oldPrice stays the truth (null = unknown).
 *   - The optional park stamps skumap.next_amz_price_review in the same transaction, so a park never lands without its log row.
 */
async function writeAmzPrice(client, { code, price, reviewDays, note, changedBy }) {
  // amzfeed is Amazon's truth (live price, FBA fee, Amazon SKU); cost / RRP live on skusummary. No FOR UPDATE: amzfeed is read-only to
  // this platform, so there is no row of ours to lock.
  const cur = await client.query(`
    SELECT a.sku AS amz_sku,
           ${safeNumeric('a.amzprice')} AS live_price,
           ${safeNumeric('a.fbafee')}   AS fbafee,
           ${safeNumeric('sk.cost')}    AS cost,
           ${safeNumeric('sk.rrp')}     AS rrp
    FROM amzfeed a
    LEFT JOIN skusummary sk ON sk.groupid = a.groupid
    WHERE a.code = $1
  `, [code]);
  if (cur.rows.length === 0) return { error: 'NOT_FOUND', message: 'SKU not found in amzfeed' };

  const row = cur.rows[0];
  const oldPrice = num(row.live_price);
  const cost = num(row.cost);
  const fbafee = num(row.fbafee);
  const rrp = num(row.rrp);

  const warnings = [];
  if (cost !== null && fbafee !== null) {
    const hardFloor = Math.round((cost + fbafee) * 100) / 100;
    if (price < hardFloor) warnings.push('BELOW_FLOOR');
  }
  if (rrp !== null && price > rrp) warnings.push('ABOVE_RRP');

  const oldForLog = oldPrice !== null ? oldPrice : price;

  // RETURNING id — the upload basket item carries it, so a later "I've uploaded" (POST /amz-mark-uploaded) can name exactly which rows
  // the downloaded file covered.
  const ins = await client.query(
    `INSERT INTO amz_price_log (code, old_price, new_price, notes, changed_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [code, oldForLog, price, note, changedBy]
  );
  const logId = ins.rows[0].id;

  let nextReview = null;
  if (reviewDays !== null) {
    const upd = await client.query(
      `UPDATE skumap SET next_amz_price_review = CURRENT_DATE + $2::int WHERE code = $1 RETURNING next_amz_price_review`,
      [code, reviewDays]
    );
    nextReview = upd.rows[0] ? upd.rows[0].next_amz_price_review : null;
  }

  return { logId, oldPrice, amzSku: row.amz_sku, rrp, warnings, nextReview };
}

/*
 * amzBasketItem(db, { code, written, price }) -> the upload-basket item for a W-A1 write, in the shape GET /amz-basket returns, so a
 * screen can drop it straight into the team basket (contexts/AmzBasketContext) without re-reading. `db` = a pool query or a client.
 */
async function amzBasketItem(db, { code, written, price }) {
  const d = await db.query(`
    SELECT t.shopifytitle AS title, sk.segment
    FROM amzfeed a LEFT JOIN skusummary sk ON sk.groupid = a.groupid LEFT JOIN title t ON t.groupid = a.groupid
    WHERE a.code = $1
  `, [code]);
  return {
    id: written.logId,
    code,
    amz_sku: written.amzSku,
    size: code.split('-').pop(),
    title: d.rows[0] ? d.rows[0].title : null,
    segment: d.rows[0] ? d.rows[0].segment : null,
    old_price: written.oldPrice,
    new_price: price,
    rrp: written.rrp,
  };
}

module.exports = { writeShopifyPrice, writeAmzPrice, amzBasketItem };
