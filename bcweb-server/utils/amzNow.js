/*
=======================================================================================================================================
Util: utils/amzNow.js — each Amazon SKU's CURRENT price (AMZ_NOW_CTES)
=======================================================================================================================================
Moved here unchanged from utils/slider.js when the Pricing Slider was removed (2026-11-06) — its other readers (the Amazon review
write, New Additions' bulk % via utils/processMap.js) still need it.

AMZ_NOW_CTES — two CTEs giving each Amazon SKU's CURRENT price (join amz_now ON code; COALESCE(amz_now.price, amzprice)).
amzfeed.amzprice is Amazon's price as of the last Update Amazon import, so a logged price is newer when it reached Amazon AFTER that
import — uploaded after it — or is still pending in the basket and was set after it. A pending change that aged out of the basket
(AMZ_PENDING_HOURS) never went live and is ignored. Prefix the query's WITH list with this (no trailing comma).
UPLOADED is judged by uploaded_at, not changed_at (fixed 2026-10-17): set Monday 10:00, Update Amazon 11:00, uploaded 12:00 — the
import still shows the OLD price, and comparing changed_at threw the uploaded price away.
=======================================================================================================================================
*/

// Same as routes/amz-basket.js WINDOW_HOURS: a pending (not uploaded) Amazon change older than this has dropped out of the upload basket,
// so it never went live and must not be read as the SKU's current price.
const AMZ_PENDING_HOURS = 72;

const AMZ_NOW_CTES = `
  amz_import AS (
    SELECT COALESCE(MAX(created_at), '-infinity'::timestamptz) AS at FROM bclog WHERE section = 'Amazon Update'
  ),
  amz_now AS (
    SELECT DISTINCT ON (l.code) l.code, l.new_price AS price
    FROM amz_price_log l CROSS JOIN amz_import i
    WHERE (l.uploaded_at IS NOT NULL AND l.uploaded_at > i.at)
       OR (l.uploaded_at IS NULL AND l.changed_at > i.at AND l.changed_at >= now() - make_interval(hours => ${AMZ_PENDING_HOURS}))
    ORDER BY l.code, l.id DESC
  )`;

module.exports = { AMZ_NOW_CTES, AMZ_PENDING_HOURS };
