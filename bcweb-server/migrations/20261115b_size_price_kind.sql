-- 2026-11-15  Shopify size prices remember WHERE they were set (docs/overstock/PLAN.md decision 2).
--
-- 'clearance' = set for a dead size (the drill's Size prices panel, the Clearance screen) — kept OUT of paid Google Shopping, as since
--               2026-11-08 ("no ad spend on clearance stock").
-- 'overstock' = an overstock markdown from the overstock cards — a size that is still selling, so it STAYS in paid Shopping.
-- Every existing row is a clearance price (Milano 35 on the day), so the default keeps today's behaviour exactly.
-- The log carries it too, so the history says which kind each change was. Apply BEFORE the server deploy (utils/sizePrice.js reads it).

BEGIN;

ALTER TABLE shopify_size_price
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'clearance';
ALTER TABLE shopify_size_price
  DROP CONSTRAINT IF EXISTS shopify_size_price_kind_check;
ALTER TABLE shopify_size_price
  ADD CONSTRAINT shopify_size_price_kind_check CHECK (kind IN ('clearance', 'overstock'));

ALTER TABLE shopify_size_price_log
  ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE shopify_size_price_log
  DROP CONSTRAINT IF EXISTS shopify_size_price_log_kind_check;
ALTER TABLE shopify_size_price_log
  ADD CONSTRAINT shopify_size_price_log_kind_check CHECK (kind IS NULL OR kind IN ('clearance', 'overstock'));

COMMIT;
