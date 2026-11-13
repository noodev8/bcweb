-- =====================================================================================================================================
-- "CAN'T GET IT" — ONE SYSTEM, PER SIZE (owner, 2026-11-13: "single system"). Rules in utils/noSupply.js (THE copy).
-- APPLIED 2026-11-13 (37 style marks -> 194 size rows). Do not re-run: 20261113d dropped the skusummary columns it reads.
-- =====================================================================================================================================
-- Every style mark on skusummary.no_supply_* becomes one no_supply_size row per LIVE size of the style, with the same since / until /
-- by, live or lapsed alike (a lapsed one keeps its "Couldn't get it" note). A size that already has its own row keeps whichever mark
-- is newer. Then the skusummary columns are emptied: nothing in BCWEB reads them after this deploy. The columns themselves are left
-- for now — drop them once nothing outside BCWEB is found to read them.
--
-- RUN AT DEPLOY, AFTER the new server is live (the old server reads the style columns; running this first would hide every mark from
-- it until the restart). Safe to run twice: the second run finds no style marks left.
-- =====================================================================================================================================

BEGIN;

INSERT INTO no_supply_size (code, groupid, since, until, marked_by)
SELECT m.code, m.groupid, s.no_supply_since, s.no_supply_until, s.no_supply_by
  FROM skusummary s
  JOIN skumap m ON m.groupid = s.groupid AND COALESCE(m.deleted,0) = 0
 WHERE s.no_supply_since IS NOT NULL AND s.no_supply_until IS NOT NULL
ON CONFLICT (code) DO UPDATE
   SET since = EXCLUDED.since, until = EXCLUDED.until, marked_by = EXCLUDED.marked_by
 WHERE EXCLUDED.since > no_supply_size.since;

UPDATE skusummary
   SET no_supply_since = NULL, no_supply_until = NULL, no_supply_by = NULL
 WHERE no_supply_since IS NOT NULL OR no_supply_until IS NOT NULL OR no_supply_by IS NOT NULL;

COMMIT;
