-- =====================================================================================================================================
-- SHOPIFY DELIVERY — what customers paid for delivery, per order, for Reports → Revenue (owner, 2026-10-14).
-- =====================================================================================================================================
-- The sales table holds product lines only, so the delivery charge on a Shopify order never reached Revenue while the Royal Mail
-- cost of sending it did come off. Measured on the day: ~£16k charged this year, ~£17k the year before (inc. VAT) — about all of
-- the Royal Mail bill. The owner switched to FREE POSTAGE on 2026-10-14, so new orders carry £0; the line is kept so the year
-- before's delivery income stays visible and the cost of free postage shows on the page.
--
-- One row per order (not per day): a delivery refunded weeks later updates its own order's row when the top-up re-reads orders
-- changed since the last run (utils/shopifyDelivery.js). Money is VAT-INCLUSIVE; the page takes VAT off. Backfilled by
-- scripts/shopify-delivery-backfill.js, topped up by "Update now" on Repricing's Status tab. No FKs, no triggers.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS shopify_delivery (
  order_id    bigint PRIMARY KEY,                    -- Shopify order id
  order_day   date NOT NULL,                         -- the order's created day (shop-local), which window it counts in
  charged     numeric(10,2) NOT NULL,                -- shipping_lines price, inc. VAT; 0 for a cancelled order
  refunded    numeric(10,2) NOT NULL DEFAULT 0,      -- shipping refunds on it, positive
  loaded_at   timestamptz NOT NULL DEFAULT now()     -- when this row was last read from Shopify (the top-up restarts from here)
);

CREATE INDEX IF NOT EXISTS shopify_delivery_day ON shopify_delivery (order_day);
