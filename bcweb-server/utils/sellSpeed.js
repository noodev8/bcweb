/*
=======================================================================================================================================
Module: utils/sellSpeed.js
=======================================================================================================================================
Purpose: HOW FAST an Amazon size sold — two day counts per SKU (owner, 2026-10-22), in one place so every screen that shows them gives
         the same answer. Read first by routes/amz-fast-sellers.js (the Fast sellers pricing screen).

           priced_to_sold   days from the price the last sale went at going LIVE, to that sale
           shipped_to_sold  days from the last FBA shipment carrying the size, to that sale

         Why: a 30-day sale says a size sold recently, not that it sold QUICKLY — it could have sat for four months at a thin price and
         gone last week. The case that asked for it: Rieker X9165-00-38, priced to match the Buy Box and sold at £1.91 a unit the same
         day, 4 days after it was shipped — a size that sells that fast at that price has room to go up.

COMPUTED LIVE, NOTHING STORED. Every input changes with each sale, upload and shipment, so a stored figure would need a cron and would
be wrong in between. The three tables are small (sales ~20k, amz_price_log ~2k — a year kept, amzshipment_archive ~300 — 60 days kept;
both purges in the scripts repo's db-maint/clean_sales.sql) and amz_price_log is indexed on (code, id DESC)
(migrations/20261022_price_log_indexes.sql).

THE RULES (agreed with the owner 2026-10-22 — change them here and nowhere else):
  - THE SALE is the size's last Amazon sale with qty > 0 (sales, channel 'AMZ'); id breaks a same-day tie towards the later booking.
    A sale later returned still counts as the sale — the callers' own "sold in 30 days" test is NET of returns, which is what keeps a
    sold-and-returned size off their lists.
  - THE PRICE is the last REAL change (new <> old) that went live on or before the sale day. Holds — a row re-logging the same price,
    ~30% of the log — are skipped: they re-confirm a price, they don't set one, and counting them would restart the clock on a price
    that had been sitting for weeks. LIVE = uploaded_at when stamped (the price reaches Amazon through the upload file — the Pricing
    Slider counts an Amazon move from the same moment), else changed_at (a row nobody marked uploaded; the nightly cron's "Claude" rows
    for prices changed straight in Seller Central are live when logged), else log_date (old rows with no timestamps). London days.
    A change live ON the sale day counts only if the sale went at its new price rather than its old one — a log row has no time
    against the sale, and on 2026-10-22 2 of 8 same-day changes had come after the sale (sold at the old price).
    Known softness, accepted: a price set while the size was out of stock starts the clock before there was anything to sell, so it
    reads slower than it was; and a change logged but never uploaded counts as live.
  - THE SHIPMENT is the latest amzshipment_archive row for the code on or before the sale day. Includes the few days Amazon takes to
    check stock in. The archive keeps 60 days, so a size shipped earlier than that has NO shipment — null, which on a recent sale itself
    says "sat a long while". created_at is a timestamp without time zone, read as its own date (an hour's zone drift can't move a day
    count that matters).
  - Either count is null when there is nothing to measure from; never 0 by default.

lastPriced (separate from the speed counts): the newest real change on ANY date — when, who, where (the note: "Amazon Order", "Fast
sellers", a slider step...) and to what — so a screen can say "already priced" whichever screen did it.

Usage: interpolate SELL_SPEED_CTES into a WITH (it defines ss_sale, ss_priced, ss_shipped, ss_last_priced — all one row per code), LEFT
JOIN them on code, and select sellSpeedSelectSql(); shape a row with sellSpeedFields(r).
=======================================================================================================================================
*/

// A log row's LIVE day — see THE PRICE above. AT TIME ZONE turns the timestamptz into London wall time before the date is taken.
const LIVE_DAY = `COALESCE((COALESCE(l.uploaded_at, l.changed_at) AT TIME ZONE 'Europe/London')::date, l.log_date)`;

// A real change, not a hold. ROUND both sides so 37.9 and 37.90 are the same price; IS DISTINCT FROM so a first row with no old
// price (NULL) counts as a change.
const REAL_CHANGE = `ROUND(l.new_price, 2) IS DISTINCT FROM ROUND(l.old_price, 2)`;

const SELL_SPEED_CTES = `
  ss_sale AS (
    SELECT DISTINCT ON (code) code, solddate AS sold_on, soldprice AS sold_price
    FROM sales
    WHERE channel = 'AMZ' AND qty > 0
    ORDER BY code, solddate DESC, id DESC
  ),
  ss_priced AS (
    SELECT DISTINCT ON (l.code) l.code, ${LIVE_DAY} AS priced_on
    FROM amz_price_log l
    JOIN ss_sale s ON s.code = l.code
    WHERE ${REAL_CHANGE} AND ${LIVE_DAY} <= s.sold_on
      -- SAME-DAY GUARD: a change live on the sale day itself may have come AFTER the sale. It counts only when the sale went at
      -- (nearer) its new price than its old one; otherwise the previous change is the one the sale was made at.
      AND (${LIVE_DAY} < s.sold_on OR l.old_price IS NULL
           OR ABS(s.sold_price - l.new_price) <= ABS(s.sold_price - l.old_price))
    ORDER BY l.code, ${LIVE_DAY} DESC, l.id DESC
  ),
  ss_shipped AS (
    SELECT a.code, MAX(a.created_at::date) AS shipped_on
    FROM amzshipment_archive a
    JOIN ss_sale s ON s.code = a.code
    WHERE a.created_at::date <= s.sold_on
    GROUP BY a.code
  ),
  ss_last_priced AS (
    SELECT DISTINCT ON (l.code) l.code, l.new_price, l.changed_by, l.notes,
           ${LIVE_DAY} AS live_on, (l.changed_at AT TIME ZONE 'Europe/London')::date AS set_on, l.uploaded_at IS NOT NULL AS uploaded
    FROM amz_price_log l
    WHERE ${REAL_CHANGE}
    ORDER BY l.code, l.id DESC
  )
`;

// Dates as text (never a pg DATE to the client — CLAUDE.md: toISOString shifts it a day in BST); day counts as integers.
function sellSpeedSelectSql() {
  return `
    to_char(ss_sale.sold_on, 'YYYY-MM-DD') AS ss_sold_on,
    ss_sale.sold_price AS ss_sold_price,
    to_char(ss_priced.priced_on, 'YYYY-MM-DD') AS ss_priced_on,
    (ss_sale.sold_on - ss_priced.priced_on) AS ss_priced_to_sold,
    to_char(ss_shipped.shipped_on, 'YYYY-MM-DD') AS ss_shipped_on,
    (ss_sale.sold_on - ss_shipped.shipped_on) AS ss_shipped_to_sold,
    to_char(COALESCE(ss_last_priced.set_on, ss_last_priced.live_on), 'YYYY-MM-DD') AS ss_last_priced_on,
    ss_last_priced.changed_by AS ss_last_priced_by,
    ss_last_priced.notes AS ss_last_priced_note,
    ss_last_priced.new_price AS ss_last_priced_price,
    ss_last_priced.uploaded AS ss_last_priced_uploaded
  `;
}

// The joins, for a FROM whose code column is `codeCol` (e.g. 'a.code').
function sellSpeedJoinSql(codeCol) {
  return `
    LEFT JOIN ss_sale ON ss_sale.code = ${codeCol}
    LEFT JOIN ss_priced ON ss_priced.code = ${codeCol}
    LEFT JOIN ss_shipped ON ss_shipped.code = ${codeCol}
    LEFT JOIN ss_last_priced ON ss_last_priced.code = ${codeCol}
  `;
}

const n = (v) => (v === null || v === undefined ? null : Number(v));

function sellSpeedFields(r) {
  return {
    last_sold: r.ss_sold_on || null,
    last_sold_price: n(r.ss_sold_price),
    priced_on: r.ss_priced_on || null,
    priced_to_sold: n(r.ss_priced_to_sold),
    shipped_on: r.ss_shipped_on || null,
    shipped_to_sold: n(r.ss_shipped_to_sold),
    last_priced: r.ss_last_priced_on
      ? {
        on: r.ss_last_priced_on,
        by: r.ss_last_priced_by || null,
        note: r.ss_last_priced_note || null,
        price: n(r.ss_last_priced_price),
        uploaded: !!r.ss_last_priced_uploaded,
      }
      : null,
  };
}

module.exports = { SELL_SPEED_CTES, sellSpeedSelectSql, sellSpeedJoinSql, sellSpeedFields };
