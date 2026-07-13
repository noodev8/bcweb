-- =====================================================================================================================================
-- Migration: amz_price_log_changed_at  (Amazon Pricing — durable "today's" upload basket)
-- =====================================================================================================================================
-- Purpose: Give amz_price_log a real timestamp so the Amazon upload basket (GET /amz-basket) can select "the operator's changes in the
--          last 12 hours" — a rolling window. The table stored only a bare DATE (log_date), which has no time-of-day, so no sub-day window
--          is possible from it. A precise timestamptz enables the rolling span.
--
--          Mirrors the Shopify-side precedent exactly: price_change_log gained `changed_at timestamptz DEFAULT now()` (2026-07-10). As
--          there, the default is set as a SEPARATE step AFTER adding the column, so existing rows stay NULL rather than all being
--          back-filled to the migration instant (a volatile now() default on ADD COLUMN would rewrite every row to the same timestamp —
--          which would make the entire history briefly look "recent" to the rolling window). Only NEW inserts get now(); older NULL rows
--          are never inside the window, which is correct — they're history, not this sitting's basket.
-- =====================================================================================================================================

-- 1) Add the column WITHOUT a default first -> existing rows get NULL (not a single back-filled timestamp). IF NOT EXISTS = idempotent.
ALTER TABLE amz_price_log ADD COLUMN IF NOT EXISTS changed_at timestamptz;

-- 2) Now set the going-forward default. Every future amz-apply INSERT (which does not list changed_at) is stamped with now() automatically.
ALTER TABLE amz_price_log ALTER COLUMN changed_at SET DEFAULT now();

-- The basket reads recent rows by changed_at; a small index keeps that cheap as the log grows. (log_date already carries the legacy date.)
CREATE INDEX IF NOT EXISTS amz_price_log_changed_at_idx ON amz_price_log (changed_at DESC);
