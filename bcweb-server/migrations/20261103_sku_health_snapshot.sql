-- =====================================================================================================================================
-- SKU HEALTH — one saved row per WEEK, 52 rows a year (owner, 2026-11-03: "Shall we go by week? Always 52 rows?").
-- =====================================================================================================================================
-- The Admin screen /sku-health shows three live numbers (routes/sku-health-overview.js). This table keeps them once a week so the
-- list can show whether sellers and in-stock are going up and not-sold-in-12-months is going down.
--   - snapshot_date is the week's MONDAY (London), and the PRIMARY KEY. Pressing Save twice in a week UPDATES that week's row,
--     never adds one. The list keeps the last 52 rows.
--   - in_stock is NULL for backfilled weeks: stock on hand for past dates cannot be rebuilt from the history we keep.
--   - sellers90 and not_sold_12m ARE rebuilt for the last 52 weeks from `sales` and `skumap`, so the first screen already has a trend.
--     Those backfilled rows are marked saved_by 'backfill'. Rebuilt figures use today's size map, so they are close, not exact.
--   - The current week's row is written only by the Save button (routes/sku-health-save.js).
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS sku_health_snapshot (
  snapshot_date  date        PRIMARY KEY,   -- Monday of the week, London
  sellers90      integer     NOT NULL,
  in_stock       integer,
  not_sold_12m   integer     NOT NULL,
  saved_by       text,
  saved_at       timestamptz NOT NULL DEFAULT now()
);

-- Backfill the 52 weeks BEFORE the current week (this week is saved by the button). Each week is figured as of its Monday, with
-- the same windows as the live screen:
--   sellers90    = a sale in the 90 days ending on that Monday (inclusive)
--   not_sold_12m = a skumap size with NO sale in the 365 days ending on that Monday (inclusive)
INSERT INTO sku_health_snapshot (snapshot_date, sellers90, in_stock, not_sold_12m, saved_by)
SELECT wk,
       (SELECT COUNT(DISTINCT s.code) FROM sales s WHERE s.solddate BETWEEN wk - 89 AND wk)::int,
       NULL,
       (SELECT COUNT(*) FROM skumap m
         WHERE NOT EXISTS (SELECT 1 FROM sales s WHERE s.code = m.code AND s.solddate BETWEEN wk - 364 AND wk))::int,
       'backfill'
FROM (
  SELECT dd::date AS wk
  FROM generate_series(
         date_trunc('week', (now() AT TIME ZONE 'Europe/London'))::date - 52 * 7,
         date_trunc('week', (now() AT TIME ZONE 'Europe/London'))::date - 7,
         interval '7 days') AS dd
) weeks
ON CONFLICT (snapshot_date) DO NOTHING;
