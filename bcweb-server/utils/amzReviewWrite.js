/*
=======================================================================================================================================
Util: utils/amzReviewWrite.js — THE Amazon "mark reviewed" write (W-A2)
=======================================================================================================================================
Park a set of Amazon SKUs a person looked at and LEFT UNCHANGED: skumap.next_amz_price_review = CURRENT_DATE + reviewDays, plus one
HOLD row per SKU in amz_price_log (new_price = old_price) so the hold shows on Analytics -> Price Changes. Moved here from
routes/amz-review.js (2026-11-04) so the /amz-pricing skill's scripts/amz-review-set.js parks a size exactly as the Amazon screens
do — never a copy. The route header keeps the history (why holds are logged, why the held price is the CURRENT price, not the feed).

writeAmzReview(client, { codes, reviewDays, note, changedBy, keepLater })
  codes       non-empty array of exact SKU codes (caller validates / caps)
  reviewDays  integer >= 1
  keepLater   true = a review date already later than CURRENT_DATE + reviewDays is kept (the skill: a size parked for longer on
              purpose stays parked); false = set exactly (the screen's button, unchanged behaviour)
Returns { rows: [{ code, next_review 'YYYY-MM-DD' }], rowCount, logged }. Run inside withTransaction.
=======================================================================================================================================
*/

const { safeNumeric } = require('./sql');
const { AMZ_NOW_CTES } = require('./amzNow');   // each SKU's current price: a newer logged price, else the feed

async function writeAmzReview(client, { codes, reviewDays, note, changedBy, keepLater = false }) {
  // GREATEST ignores NULL in Postgres, so an un-reviewed SKU simply gets CURRENT_DATE + reviewDays.
  const target = keepLater ? 'GREATEST(next_amz_price_review, CURRENT_DATE + $2::int)' : 'CURRENT_DATE + $2::int';
  // Return the date as text — never a pg DATE through toISOString (CLAUDE.md: BST day-shift).
  const upd = await client.query(
    `UPDATE skumap SET next_amz_price_review = ${target}
     WHERE code = ANY($1::text[])
     RETURNING code, to_char(next_amz_price_review, 'YYYY-MM-DD') AS next_review`,
    [codes, reviewDays]
  );

  // HOLD rows at the CURRENT price (amz_now, else the feed) — see routes/amz-review.js header. amzprice is a junk-prone VARCHAR, so
  // safeNumeric; a SKU with no readable price is reviewed but logs no hold (never a 0.00 hold). Set-based, no N+1.
  const ins = await client.query(
    `WITH ${AMZ_NOW_CTES},
     held AS (
       SELECT a.code, COALESCE(n.price, ${safeNumeric('a.amzprice')}) AS price
         FROM amzfeed a
         LEFT JOIN amz_now n ON n.code = a.code
        WHERE a.code = ANY($1::text[])
     )
     INSERT INTO amz_price_log
        (log_date, code, old_price, new_price, notes, changed_by, changed_at)
     SELECT CURRENT_DATE, code, price, price, $2, $3, now()
       FROM held
      WHERE price IS NOT NULL`,
    [upd.rows.map((r) => r.code), note, changedBy]
  );

  return { rows: upd.rows, rowCount: upd.rowCount, logged: ins.rowCount };
}

module.exports = { writeAmzReview };
