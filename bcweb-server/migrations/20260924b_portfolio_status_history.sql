-- =====================================================================================================================
-- 20260924b_portfolio_status_history.sql — the status trend, and the figures the dial reads (owner, 2026-09-24)
-- =====================================================================================================================
-- WHAT THIS ADDS
--
--   skusummary.portfolio_revenue_12m / portfolio_units_12m
--     The 12-month gross revenue and units the style had AT THE LAST UPDATE — stamped alongside portfolio_status by the same
--     press. The Winners screen's £1,500 / £2,500 / £5,000 / £10,000 dial reads THESE, filtering within the tagged WINNERS,
--     so at £1,500 it shows exactly the tag count and at higher bars a subset of it. Reading live sales instead would let
--     the dial disagree with the tag the moment a sale landed after the Update ("instead of determining the WINNERS all
--     the time, lets tag it"). Also the sort key for the winners list the screen will grow later. NULL = never assessed.
--
--   portfolio_status_snapshot — one row per day an Update was pressed: how many styles held each status. The screen's
--     trend graph draws all five lines from it ("have the graph include all our status to track progress").
--
-- WHY A NEW TABLE AND NOT MORE COLUMNS ON portfolio_snapshot
--   portfolio_snapshot is the OLD hero series (the live winner count incl. deleted styles, stamped with bar_metric /
--   bar_value). These counts are a different ruler — the stored tags over the current catalogue — and putting them on the
--   same row would invite exactly the mixed-ruler line that table's bar stamp exists to prevent. Its history is kept, not
--   touched; the Update button still writes it.
--
-- SAME GROWTH RULES AS portfolio_snapshot: snapshot_date is the PK and is UPSERTed (pressing twice a day overwrites), and the
-- writer prunes past 2 years in the same transaction. NEVER BACKFILLED — past statuses were never recorded, and a
-- reconstruction from today's rules would be what the rules say now about then, not what we said on the day.
-- =====================================================================================================================

ALTER TABLE skusummary
  ADD COLUMN IF NOT EXISTS portfolio_revenue_12m numeric(12, 2),
  ADD COLUMN IF NOT EXISTS portfolio_units_12m   integer;

CREATE TABLE IF NOT EXISTS portfolio_status_snapshot (
  snapshot_date  date        PRIMARY KEY,
  winners_count  integer     NOT NULL,
  steady_count   integer     NOT NULL,
  new_count      integer     NOT NULL,
  harvest_count  integer     NOT NULL,
  losers_count   integer     NOT NULL,
  total_count    integer     NOT NULL,   -- every style in skusummary at the press; the five sum to it
  created_at     timestamptz NOT NULL DEFAULT now()
);
