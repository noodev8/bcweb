-- =================================================================================================================================
-- 20260922d_portfolio_snapshot_metric.sql
-- =================================================================================================================================
-- WHY: the Winners bar changed from "£200 PROFIT in 12 months" to "£1,500 GROSS REVENUE in 12 months" (owner, 2026-09-22 — the
--      screen's job is PRODUCT FIND > REVENUE > PROFIT > KEEP/DROP, and profit here is contribution before advertising, so it was
--      never the right test for the FIND step). See WINNER_BAR in bcweb-server/utils/portfolio.js for the full argument.
--
--      portfolio_snapshot never recorded WHICH ruler a row was measured with, which is exactly the failure the route headers warned
--      about: plot the old rows next to the new ones and the chart shows a step that looks like the business moved when only the
--      definition did. So the ruler now travels with the row, and routes/portfolio-winners.js filters the trend to the ruler in
--      force. Old rows are stamped PROFIT/200 (what they truthfully were) and simply stop being drawn — they are NOT deleted: a
--      snapshot is a record of what we said on the day, and that remains true whatever we now measure.
--
-- Safe to re-run.
-- =================================================================================================================================

ALTER TABLE portfolio_snapshot
  ADD COLUMN IF NOT EXISTS bar_metric text,
  ADD COLUMN IF NOT EXISTS bar_value  numeric;

-- Every row that predates this migration was taken against the £200 profit bar. Stamp it rather than leaving it NULL, so "which
-- ruler was this?" is never an unanswerable question about the history.
UPDATE portfolio_snapshot
   SET bar_metric = 'PROFIT', bar_value = 200
 WHERE bar_metric IS NULL;

ALTER TABLE portfolio_snapshot
  ALTER COLUMN bar_metric SET NOT NULL,
  ALTER COLUMN bar_value  SET NOT NULL;
