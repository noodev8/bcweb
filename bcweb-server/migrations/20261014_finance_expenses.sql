-- =====================================================================================================================================
-- FINANCE EXPENSES — what comes off a channel's revenue on Reports → Revenue (owner, 2026-10-14: "start building the expenses for each
-- and see what we have left"). Shopify first.
-- =====================================================================================================================================
--   fee_daily        real payment fees, one row per day per source. 'SHOPIFY_PAYMENTS' comes from the Shopify balance-transactions API
--                    (utils/shopifyPaymentFees.js — the same endpoint and filter as Month End): backfilled once by
--                    scripts/shopify-fees-backfill.js, then topped up by "Update now" on Repricing's Status tab. 'PAYPAL' comes from a
--                    PayPal export loaded by scripts/paypal-fees-import.js. A day with no fees has no row; the route knows each
--                    source's covered range from a separate min/max, so a missing day inside it means "no fees", not "unknown".
--                    fees are POSITIVE pounds (a cost), unlike Month End's negative convention.
--   expense_figure   totals the owner gives by hand for a period — Royal Mail and packing bags, "I can give you 12 months and
--                    periodically give you new rolling 12 month". One row per figure; a newer row for the same name supersedes.
--
-- No foreign keys, no triggers (owner). Seed rows below are the owner's own figures, 2026-10-14.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS fee_daily (
  day         date        NOT NULL,
  source      varchar(30) NOT NULL,                  -- 'SHOPIFY_PAYMENTS' | 'PAYPAL'
  fees        numeric(10,2) NOT NULL,                -- positive pounds
  txns        integer     NOT NULL DEFAULT 0,        -- fee-bearing transactions that day
  loaded_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, source)
);

CREATE TABLE IF NOT EXISTS expense_figure (
  id           serial PRIMARY KEY,
  channel      varchar(10) NOT NULL,                 -- 'SHP' (Shopify) for now
  name         varchar(40) NOT NULL,                 -- 'Royal Mail' | 'Packing bags'
  amount       numeric(12,2) NOT NULL,               -- positive pounds, for the whole period
  period_from  date NOT NULL,
  period_to    date NOT NULL,                        -- inclusive
  note         text,
  created_by   varchar(50),
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO expense_figure (channel, name, amount, period_from, period_to, note, created_by)
SELECT 'SHP', 'Royal Mail', 16679.00, DATE '2025-10-14', DATE '2026-10-14', 'owner: last 12 months', 'Andreas'
WHERE NOT EXISTS (SELECT 1 FROM expense_figure WHERE name = 'Royal Mail' AND period_to = DATE '2026-10-14');

INSERT INTO expense_figure (channel, name, amount, period_from, period_to, note, created_by)
SELECT 'SHP', 'Packing bags', 604.00, DATE '2025-10-14', DATE '2026-10-14', 'owner: last 12 months', 'Andreas'
WHERE NOT EXISTS (SELECT 1 FROM expense_figure WHERE name = 'Packing bags' AND period_to = DATE '2026-10-14');
