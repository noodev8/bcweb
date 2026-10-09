-- =====================================================================================================================================
-- stock_daily — one row per day: the units we own (and their value at cost) at the END of that day.
-- =====================================================================================================================================
-- Why: stock is a "right now" fact. Sales history lives forever in `sales`, but nobody can say what stock we held on a past day unless
-- it was written down that night — miss a night and that day is gone. This is that record, feeding Reports -> Stock vs Sales.
--
-- Replaces google_stock_track (written by C:\scripts\google-ads\update_google_stock_track.py, retired 2026-10-09). That table mixed
-- four unrelated things — stock, Shopify sales, Google ad totals, Birk ad-readiness — and nothing read it. Its stock history is the
-- only part worth keeping, and it is copied in below. Sales are NOT stored here: the screen reads them live from `sales`.
--
-- WRITER: bcweb-server/scripts/stock-daily.js, nightly from C:\scripts\crontab.txt. Stamps CURRENT_DATE - 1 (the day just ended).
--
-- DEFINITION (from the first nightly row on): exactly the Month End stock figure, utils/financeStock.js —
--   local  = localstock #FREE, deleted = 0              (C3-Amazon staged units are still here, counted ONCE, on the local side)
--   amazon = amzfeed.amztotal                            (everything Amazon holds: sellable + in transit + reserved + unsellable)
--   value  = units x skusummary.cost
--
-- BACKFILLED ROWS (14 Oct 2025 -> the cutover) carry local_units / amz_units = NULL. They came from google_stock_track, whose total
-- was all localstock (not just #FREE) + amzfeed.amzlive (Amazon SELLABLE only — no in-transit/reserved). So at the cutover the line
-- steps up by roughly the Amazon in-transit/reserved units (~89 on 2026-10-09, ~3%). Not a real stock movement — NULL split = old basis.
-- =====================================================================================================================================

CREATE TABLE stock_daily (
  snapshot_date date          PRIMARY KEY,           -- the day the reading closes (stock at the END of this day)
  units         integer       NOT NULL,              -- local_units + amz_units
  value         numeric(12,2) NOT NULL,              -- units at cost, GBP
  local_units   integer,                             -- NULL on backfilled (old-basis) rows
  amz_units     integer,                             -- NULL on backfilled (old-basis) rows
  created_at    timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE stock_daily IS
  'Units owned (local #FREE + Amazon amztotal) and value at cost at the end of each day. Written nightly by bcweb-server/scripts/stock-daily.js. Rows with NULL local_units/amz_units were backfilled from google_stock_track (old basis: Amazon sellable only).';

-- Backfill. google_stock_track.snapshot_date is a timestamptz written as midnight UTC of the day it describes, so the UTC date IS
-- that day. Its value used a bare cost::numeric — it never threw on this data, and it is history now, so it is copied as it stands.
INSERT INTO stock_daily (snapshot_date, units, value)
SELECT (g.snapshot_date AT TIME ZONE 'UTC')::date,
       g.total_stock_units,
       ROUND(COALESCE(g.total_stock_value, 0), 2)
FROM google_stock_track g
WHERE g.total_stock_units IS NOT NULL
ON CONFLICT (snapshot_date) DO NOTHING;

-- Check after running: one row per day, 14 Oct 2025 to the latest night the old cron ran.
--   SELECT MIN(snapshot_date), MAX(snapshot_date), COUNT(*) FROM stock_daily;
