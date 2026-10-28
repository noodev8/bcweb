-- =====================================================================================================================================
-- PROSPECTS — who last EDITED a line (owner, 2026-10-28).
-- =====================================================================================================================================
-- The list sorts by latest change (edit, check or comment) and shows who made it. Checks and comments already carry their author;
-- an edit only had updated_at. prospect-save stamps this beside it. NULL = never edited (or edited before this column).
-- =====================================================================================================================================

ALTER TABLE prospect ADD COLUMN IF NOT EXISTS updated_by varchar(100);
