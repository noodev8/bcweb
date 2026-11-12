-- =====================================================================================================================================
-- AMAZON PENDING ORDERS — shown on the Sales screen before Amazon confirms them (owner, 2026-11-12: "I just want an indication of how
-- we are doing today even if not yet confirmed").
-- =====================================================================================================================================
-- Amazon's API gives a Pending order no price, so utils/amzOrderSync.js books it into `sales` only once confirmed (Unshipped /
-- Shipped). Until then its lines sit HERE, at an ESTIMATED price (the size's current amzfeed.amzprice) and estimated profit
-- (utils/amzProfit.js). DISPLAY ONLY: read by routes/analytics-sales.js alone (in the totals, tagged Pending) — never by any
-- other screen, so profit / Range / New stuff etc. only ever see confirmed sales.
-- The whole table is REPLACED by every Update Orders that reads Amazon: a line leaves when its order confirms (then it is a real
-- sale) or is cancelled. No history kept.
-- =====================================================================================================================================
CREATE TABLE IF NOT EXISTS amz_pending_order (
  ordernum      text        NOT NULL,          -- AmazonOrderId
  order_item_id text        NOT NULL,
  sku           text        NOT NULL,
  code          text,                          -- NULL = SKU not in BCWEB (shown, no estimate)
  groupid       text,
  productname   text,
  brand         text,
  qty           integer     NOT NULL,
  est_price     numeric(10,2),                 -- per unit, VAT inc — the size's amzfeed price when read
  est_profit    numeric(10,2),                 -- whole line
  solddate      date        NOT NULL,          -- Europe/London purchase date
  ordertime     text,
  read_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ordernum, order_item_id)
);
