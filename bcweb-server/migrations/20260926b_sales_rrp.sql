-- =====================================================================================================================
-- 20260926b_sales_rrp.sql — stamp the RRP onto every sale line (owner, 2026-09-26)
-- =====================================================================================================================
-- WHAT THIS ADDS
--
--   sales.rrp   numeric(10,2)   — the style's RRP AT THE TIME OF BOOKING, copied from skusummary.rrp by the writer. NULL when
--                                 skusummary.rrp was blank/junk (it is a legacy VARCHAR — 'RRP' and '' both occur) or the style
--                                 couldn't be found.
--
--   WHY STAMP IT: sales are kept ~2 years, but products get deleted and RRPs change. Read live off skusummary, a deleted style's
--   sales lose their RRP entirely and an old sale is measured against today's figure. Same reasoning as sales.brand, already stamped.
--
--   A real numeric, not skusummary's varchar — the junk stops at the door.
--
--   WRITTEN IN CODE, NOT BY A TRIGGER (owner: no triggers). Every writer of `sales` stamps it itself — keep this list complete:
--     bcweb-server/utils/orderSync.js         Shopify sales (Update orders button)
--     C:\scripts\orders\update_orders.py      the SAME Shopify logic, still in cron
--     bcweb-server/utils/amzImportApply.js    Amazon sales + returns (Update Amazon)
--     C:\scripts\returns\sync_returns.py      Shopify returns — copies the ORIGINAL sale's rrp, so a sale and its return match
--
-- BACKFILL (below): existing rows get the CURRENT skusummary.rrp. Knowingly lossy — historic RRPs were never recorded, so old rows
-- get today's figure frozen in, and sales of already-deleted styles stay NULL. No worse than reading live, and it stops drifting now.
-- =====================================================================================================================

BEGIN;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS rrp numeric(10,2);

UPDATE sales s
SET rrp = CASE WHEN btrim(sk.rrp::text) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(sk.rrp::text)::numeric ELSE NULL END
FROM skusummary sk
WHERE sk.groupid = s.groupid
  AND s.rrp IS NULL;

COMMIT;
