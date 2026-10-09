-- =====================================================================================================================================
-- Drop the two retired stock tables. RUN THIS SECOND — only after 20261009_stock_daily.sql has run and Stock vs Sales shows the history.
-- =====================================================================================================================================
-- stock_position_snapshot  — the old Reports -> Stock Position screen's "Update now" readings (42 rows, Jul–Oct 2026). Screen, routes
--                            and util deleted 2026-10-09. Counted products alive per channel, not units; nothing else reads it.
-- google_stock_track       — written only by C:\scripts\google-ads\update_google_stock_track.py (deleted 2026-10-09, cron line
--                            removed). Its stock history is now in stock_daily. Its other columns were already elsewhere or unread:
--                            Shopify sales -> `sales`; ad spend/clicks/impressions -> google_campaign_daily (BCWEB's Google Ads
--                            import); tROAS + Birk ad-readiness -> read by nothing.
--
-- The guard refuses to drop google_stock_track if its stock history has not been copied, so running the files out of order fails
-- loudly instead of losing a year of stock readings.
-- =====================================================================================================================================

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM stock_daily WHERE local_units IS NULL) < 300 THEN
    RAISE EXCEPTION 'stock_daily backfill not found — run 20261009_stock_daily.sql first';
  END IF;
END $$;

DROP TABLE stock_position_snapshot;
DROP TABLE google_stock_track;
