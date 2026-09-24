-- =====================================================================================================================
-- 20260924_portfolio_status.sql — tag every style with its portfolio status (owner, 2026-09-24)
-- =====================================================================================================================
-- WHAT THIS ADDS
--   skusummary.portfolio_status     WINNERS | STEADY | NEW | HARVEST | LOSERS
--   skusummary.portfolio_status_at  when the Update button last ASSESSED this style. NO DEFAULT, deliberately: a product
--                                   created since the last Update is NEW with a NULL stamp, which keeps
--                                   MAX(portfolio_status_at) an honest "last updated" and lets the screen count
--                                   the styles added since.
--
-- WHY A STORED TAG AND NOT A LIVE CALCULATION
--   "Instead of determining the WINNERS all the time, lets tag it in the database." The Winners screen's Update button
--   re-runs the rules (utils/portfolioStatus.js) and writes the result here; everything else READS the tag. The
--   repricer is next: it will filter its lists by this column, so every screen agrees on what a style is because they
--   all read the same stamped value rather than each recomputing it.
--
-- THE DEFAULT IS 'NEW', SET SEPARATELY FROM THE ADD COLUMN ON PURPOSE
--   A product created anywhere — the bcweb Product screen, a copy, OR the legacy PowerBuilder screen, which knows nothing
--   of this column — starts life as NEW. That is the owner's rule, and a column default is the only place that catches
--   the legacy path too.
--
--   Adding the column WITH the default would stamp all ~305 existing rows 'NEW' — a confident lie until the first
--   Update. Adding it bare and then setting the default leaves existing rows NULL ("never assessed"), which is the truth;
--   the first press of Update fills them in.
--
-- THE CHECK CONSTRAINT keeps junk out of a legacy table that already has enough of it (see CLAUDE.md's schema notes).
-- NULL is allowed: it means "not assessed yet", not a sixth status.
-- =====================================================================================================================

ALTER TABLE skusummary
  ADD COLUMN IF NOT EXISTS portfolio_status    varchar(10),
  ADD COLUMN IF NOT EXISTS portfolio_status_at timestamptz;

ALTER TABLE skusummary
  ALTER COLUMN portfolio_status SET DEFAULT 'NEW';

ALTER TABLE skusummary
  ADD CONSTRAINT skusummary_portfolio_status_chk
  CHECK (portfolio_status IS NULL OR portfolio_status IN ('WINNERS', 'STEADY', 'NEW', 'HARVEST', 'LOSERS'));
