-- =====================================================================================================================
-- 20260922b_portfolio_snapshot_total.sql — store the denominator too (owner, 2026-09-22)
-- =====================================================================================================================
-- WHAT THIS ADDS
--   `portfolio_snapshot.total_styles` — how many styles traded at all in the 12 months that snapshot covers.
--
-- WHY IT HAS TO BE STORED AND CANNOT BE DERIVED LATER
--   The screen's second headline is the winners' SHARE of the range ("80 of 303 — 26% earn their keep"). A share has a
--   moving denominator: the range itself grows and shrinks. To chart that share over time, each point needs the
--   denominator AS IT WAS ON THE DAY — recomputing today's total against an old winner count would produce a line that
--   is part history and part fiction, and the join would look perfectly reasonable in the code.
--
--   It is the same principle the table was built on (see the original migration in git history, 20260922_portfolio_
--   snapshot.sql): a snapshot is WHAT WE SAID ON THE DAY, not what the books say now about then.
--
--   Storing the count and the share separately would be the alternative, and is worse: two stored numbers that must
--   agree, with nothing enforcing it. The denominator is the raw fact — the percentage is derived from it at read time.
--
-- WHY THE DEFAULT IS 0 AND NOT SOMETHING CLEVERER
--   Rows written before this column existed genuinely do not know their denominator, and 0 is the honest answer. The
--   read side treats 0 as "no share available" and shows a dash rather than dividing by it. Backfilling those rows with
--   today's total is exactly the fiction described above — do not do it.
--
-- NO OTHER CHANGE. Retention, the UPSERT on snapshot_date and the ~730-row ceiling are all unaffected.
-- =====================================================================================================================

ALTER TABLE portfolio_snapshot
  ADD COLUMN IF NOT EXISTS total_styles integer NOT NULL DEFAULT 0;
