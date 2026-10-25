-- =====================================================================================================================================
-- PROCESS — the Google allowance behind the Shopify thin/good line (owner, 2026-10-25).
-- =====================================================================================================================================
-- Why: the Process page (bcweb-web/src/app/process) sorts every NEW size into thin vs good per channel. On Amazon and the shop counter
-- the line is £3 a unit. On Shopify the profit booked on a sale (utils/shopifyProfit.js) is BEFORE Google ad spend, and ad spend is
-- recorded per STYLE, so it can't be shared out to sizes — the owner's call was "£3 after a FIXED Google allowance": the average ad
-- cost per Shopify unit, measured over 90 days, added on top of the £3.
--
-- FIXED, not live (owner): it is re-measured QUARTERLY BY BUTTON on the Process page, which shows the new figure BEFORE it is
-- accepted. Measured 2026-10-25 the 90-day figure ran £2.91 (Apr 2026) → £7.75 (Oct 2026): pennies week to week, a lot across the
-- year — a live figure would have moved sizes between thin and good with nothing about them changing.
--
-- One row per ACCEPTED measurement; the newest row is the allowance in force. Rows are never edited, so the history of what the line
-- was, and when, stays readable. The first row is the owner's agreed £8 (the measured £7.69-7.75 rounded, "£3 + £8").
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS google_allowance (
  id           serial PRIMARY KEY,
  per_unit     numeric(8,2) NOT NULL CHECK (per_unit >= 0),   -- £ of Google spend per Shopify unit sold — the figure in force
  spend        numeric(12,2),                                  -- what it was measured from (NULL on the seeded row)
  units        integer,
  window_from  date,
  window_to    date,
  accepted_by  text         NOT NULL,
  accepted_at  timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO google_allowance (per_unit, spend, units, window_from, window_to, accepted_by)
SELECT 8.00, NULL, NULL, DATE '2026-07-28', DATE '2026-10-25', 'Andreas (agreed 2026-10-25)'
WHERE NOT EXISTS (SELECT 1 FROM google_allowance);
