-- =====================================================================================================================================
-- AMAZON SIZE HISTORY — price and FBA stock for every Amazon size, over time (owner, 2026-11-03).
-- =====================================================================================================================================
-- Why: amzfeed only holds TODAY. Without a past, pricing can't tell "didn't sell because it was out of stock" from "didn't sell at
-- that price" (FLE030-IVES-WHITE-06 sold nothing Dec 2025 - Mar 2026: it looked like the season, but nothing was booked to C3-Amazon
-- Nov - Mar, so it was almost certainly out — and nothing could prove it).
--
-- Owner decisions (2026-11-03):
--   - Written INSIDE the Update Amazon import (only when the FBA Inventory report is in the files), not by a cron: amzfeed changes
--     only on an import, so a nightly copy would record stale numbers as that day's reading. utils/amzSizeHistory.js.
--   - CHANGE-ONLY rows: a size gets a row only when its price / live / inbound / total differs from its previous row. A size's value
--     on any day = its latest row on or before that day. Reserved is LEFT OUT on purpose — it moves almost daily with picks and
--     warehouse transfers and would defeat change-only; total already includes it.
--   - At most ONE row per size per day: a later import that day replaces the day's rows; re-importing the same file changes nothing;
--     a later import that puts a size back to its previous row's values removes that day's row.
--   - Kept 3 YEARS, purged by the import itself as it writes (no cron to forget). The row in force at the cut-off is kept, so every
--     day inside the 3 years can still be read.
--   - amz_size_history_run: one line per import DAY (not per import), so "nothing changed" and "no import that day" can be told
--     apart. Read by GET /amz-import-last for the Update Amazon status line and the dashboard's stale warning.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS amz_size_history (
  code     varchar      NOT NULL,           -- our code (amzfeed.code / skumap.code)
  day      date         NOT NULL,           -- the import's day, Europe/London
  price    numeric(8,2),                    -- your-price from the report (NULL if Amazon gave none)
  live     integer      NOT NULL,           -- afn-fulfillable-quantity: sellable now
  inbound  integer      NOT NULL,           -- afn-inbound-working + shipped + receiving: on its way in
  total    integer      NOT NULL,           -- afn-total-quantity: everything Amazon holds or is receiving
  PRIMARY KEY (code, day)
);

CREATE TABLE IF NOT EXISTS amz_size_history_run (
  day      date         PRIMARY KEY,        -- Europe/London
  imports  integer      NOT NULL,           -- inventory imports that day
  sizes    integer      NOT NULL,           -- sizes read (amzfeed rows) at the day's last import
  changed  integer      NOT NULL,           -- rows the day holds after its last import
  last_at  timestamptz  NOT NULL,
  last_by  text
);
