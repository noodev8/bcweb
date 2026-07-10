/*
=======================================================================================================================================
Module: utils/amzPending.js
=======================================================================================================================================
Purpose: The "pending upload" set for Amazon — the price changes that have been logged but haven't reached Amazon yet. Shared by the
         basket count (/amz-pending) and the one-file download (/amz-upload-file) so they always agree.

How "pending" is derived (no extra column — see docs/amz-pricing-spec.md §3): amzfeed is refreshed every morning from real Amazon, so
a logged change is still outstanding exactly when the latest logged price for a SKU differs from the live amzfeed price. Once the
operator uploads the file and the overnight refresh runs, amzfeed.amzprice catches up and the row silently drops out of "pending". A
genuinely failed upload stays mismatched and re-appears in the next file. Same phantom-diff AMZ_FULL_REVIEW.md already uses.

  - "latest per code" via DISTINCT ON (code) ORDER BY id DESC — only the most recent intended price matters.
  - live price via safeNumeric (amzprice is a junk-prone VARCHAR). IS DISTINCT FROM handles a null live price (still counts as pending).
  - amz_sku (amzfeed.sku) is the Amazon SKU for the upload file (NOT our code). max price = the segment/style RRP (skusummary.rrp).
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');

async function getPending() {
  const r = await query(`
    WITH latest AS (
      SELECT DISTINCT ON (code) code, new_price, log_date
      FROM amz_price_log
      ORDER BY code, id DESC
    )
    SELECT l.code,
           a.sku AS amz_sku,
           l.new_price,
           ${safeNumeric('a.amzprice')} AS live_price,
           ${safeNumeric('sk.rrp')}     AS rrp,
           sk.segment,
           to_char(l.log_date, 'YYYY-MM-DD') AS log_date
    FROM latest l
    JOIN amzfeed a       ON a.code = l.code
    LEFT JOIN skusummary sk ON sk.groupid = a.groupid
    WHERE ${safeNumeric('a.amzprice')} IS DISTINCT FROM l.new_price
    ORDER BY l.log_date DESC, l.code
  `);
  return r.rows.map((row) => ({
    code: row.code,
    amz_sku: row.amz_sku,
    new_price: Number(row.new_price),
    live_price: row.live_price == null ? null : Number(row.live_price),
    rrp: row.rrp == null ? null : Number(row.rrp),
    segment: row.segment || null,
    log_date: row.log_date,
  }));
}

module.exports = { getPending };
