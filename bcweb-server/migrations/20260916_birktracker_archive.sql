-- =====================================================================================================================
-- 20260916_birktracker_archive.sql — give Birk Tracker's "Clear arrived" an undo (owner, 2026-09-16)
-- =====================================================================================================================
-- WHAT THIS ADDS
--   `birktracker_archive`, where the fully-arrived lines go when the operator clears them, instead of being deleted
--   outright. routes/birk-tracker-clear-arrived.js copies into it and deletes in ONE transaction;
--   routes/birk-tracker-restore.js puts rows back. Nothing else in the platform reads it.
--
-- WHY AN ARCHIVE TABLE AND NOT A STATUS COLUMN ON `birktracker`  (the whole reason this file exists)
--   `birktracker` is a LEGACY SHARED table: the PowerBuilder screen writes it too, and that is not hypothetical — it is
--   why routes/birk-tracker-clear-arrived.js carries a count guard in the first place. A soft-delete column only works
--   if EVERY reader filters on it, and we do not own every reader. PowerBuilder knows nothing about such a column, so
--   it would keep showing cleared lines as live, and its own "Delete Green" would then delete them for real — the exact
--   thing this change exists to prevent. Our own readers would each need the filter too, silently wrong wherever it was
--   missed: birk-planner, birk-stock, inv-styles, inv-stock, product-get.
--   A separate table changes nothing for anyone who does not know about it. The live book keeps exactly the shape,
--   size and meaning the legacy app expects.
--
-- `LIKE birktracker INCLUDING DEFAULTS` rather than a hand-typed column list: it copies all 15 legacy columns with
--   their types verbatim — including `justarrived` and `colouralt`, which the read route ignores but which are part of
--   the row and must come back unchanged on a restore. A restore is then lossless, and the archive cannot drift out of
--   step with the book's shape.
--   (The legacy varchar-for-everything landmines in CLAUDE.md therefore apply here identically. Nothing is parsed on
--   the way in or the way out — the point of an archive is to hand back the row that was taken.)
--
-- NO UNIQUE KEY ON (code, ordernum) — deliberate, and the one place the archive's shape differs from the book's.
--   The book has a unique index on that pair (birktracker_primary), which routes/birk-order-commit.js relies on for its
--   ON CONFLICT. The archive must NOT have it: a style cleared this season and ordered again next season would collide,
--   and the clear would fail on a line that is entirely legitimate. The archive is a log of clearing EVENTS, not a set
--   of lines, so the same (code, ordernum) may appear in it many times over the years.
--   That is also why restore cannot assume the pair is free — see routes/birk-tracker-restore.js, which skips a line
--   whose pair is live again rather than overwriting it.
--
-- RETENTION: none. Nothing purges this table. It grows by a few hundred rows a season, which is nothing, and the whole
--   value of the thing is that a line from two seasons ago is still there when someone asks what happened to it.
--
-- WHAT THIS DOES NOT COVER: the legacy PowerBuilder "Delete Green" button still DELETES OUTRIGHT. Anything cleared on
--   that screen is still gone. This is the net under the bcweb screen only.
-- =====================================================================================================================

CREATE TABLE IF NOT EXISTS birktracker_archive (
  LIKE birktracker INCLUDING DEFAULTS
);

-- The archive's own columns. A surrogate id because the legacy pair is not unique here (see above) and the restore
-- screen needs to address ONE line; a batch id because one press of "Archive arrived" is one act and undoing it should
-- be one act too.
ALTER TABLE birktracker_archive
  ADD COLUMN IF NOT EXISTS id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ADD COLUMN IF NOT EXISTS batch_id    uuid        NOT NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_by text        NOT NULL DEFAULT 'unknown',
  -- What the operator had filtered to when they pressed it, stored as it was sent ('all', or 'order 0001927328').
  -- The batch is meaningless without it: "59 lines" does not say whether that was one delivery or the whole book.
  ADD COLUMN IF NOT EXISTS scope       text        NOT NULL DEFAULT 'all';

-- The two questions actually asked of this table: list the batches newest first, and find what happened to one line.
CREATE INDEX IF NOT EXISTS birktracker_archive_batch_idx ON birktracker_archive (archived_at DESC, batch_id);
CREATE INDEX IF NOT EXISTS birktracker_archive_code_idx  ON birktracker_archive (code, ordernum);
