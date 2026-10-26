-- =====================================================================================================================================
-- PROSPECTS ARCHIVE — a decided line is kept for 6 months instead of deleted (owner, 2026-10-26).
-- =====================================================================================================================================
-- Why: Delete was the only way off the list, so the decision went with the line — a colleague finding the same style again had no way
-- to know it had been tested. Now a line is ARCHIVED with an outcome (Ordered / Dropped; the optional reason is the line's last
-- comment, so the thread reads in order) and keeps its checks and comments. Pasting an archived ASIN again says "tested before" and
-- offers Reopen — one line per style, the new checks next to the old ones.
--
-- 6 MONTHS, then gone for good (owner: "I dont want to keep them indefinitely"). No cron: every archive and every add removes lines
-- archived more than 6 months ago (utils/prospect.js → purgeOldArchive). Delete stays, for a line added by mistake.
--
-- archived_at NULL = on the list (active). Reopen sets the three back to NULL.
-- =====================================================================================================================================

ALTER TABLE prospect ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE prospect ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE prospect ADD COLUMN IF NOT EXISTS outcome     varchar(7) CHECK (outcome IN ('ordered', 'dropped'));
