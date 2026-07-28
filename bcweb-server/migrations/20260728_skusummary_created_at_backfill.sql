-- =====================================================================================================================================
-- Migration: backfill skusummary.created_at from the legacy `created` text
-- Date: 2026-07-28
-- =====================================================================================================================================
-- WHY
--   The Inventory browse now opens on the whole catalogue sorted NEWEST ADDED FIRST, and the sort key is created_at — the proper
--   timestamptz column, the one to build on.
--
--   But created_at has only been written since 15 July 2026: 19 of 291 styles carry it, and the other 272 are NULL. Sorting on it as
--   things stand would put 19 styles at the top and dump the rest of the catalogue in an undifferentiated heap at the bottom — the
--   real "added" order for those 272 exists, it just lives in the legacy `created` varchar ('YYYYMMDD HH24:MI:SS', Europe/London).
--
--   So rather than lose that ordering, this fills created_at from the legacy column. Verified before writing: on all 19 rows where
--   BOTH columns exist they agree exactly (created = created_at rendered as Europe/London), and converting back the other way
--   reproduces created_at to the second — the only difference is sub-second fractions, which the legacy text does not carry.
--
-- WHAT IT TOUCHES
--   skusummary.created_at, on NULL rows only. It can never modify a row that already has a stamp, so it is safe to re-run and cannot
--   disturb the 19 rows written by the app.
--     - 271 rows are filled from the legacy text.
--     -   1 row has neither stamp; it gets 2000-01-01 so it sorts to the bottom of "newest first" instead of vanishing (owner:
--         "if there are nulls just fill them with an old date so they appear at the bottom").
--
--   NOTE it does NOT touch the legacy `created` column, which other systems still read and the app still writes.
--
-- HOW TO RUN (psql, against brookfield_prod). Wrapped in a transaction so the counts can be eyeballed before COMMIT.
-- =====================================================================================================================================

BEGIN;

-- 1. Fill from the legacy text where it is present and parseable.
UPDATE skusummary
   SET created_at = (to_timestamp(created, 'YYYYMMDD HH24:MI:SS')::timestamp AT TIME ZONE 'Europe/London')
 WHERE created_at IS NULL
   AND COALESCE(created, '') <> ''
   AND created ~ '^\d{8} \d{2}:\d{2}:\d{2}$';   -- only well-formed stamps; anything odd falls through to step 2

-- 2. Anything still NULL has no usable source at all: date it to the bottom of the list rather than leave it unsortable.
UPDATE skusummary
   SET created_at = TIMESTAMPTZ '2000-01-01 00:00:00 Europe/London'
 WHERE created_at IS NULL;

-- 3. Verify before committing: expect remaining_nulls = 0 and total = with_created_at.
SELECT count(*) AS total,
       count(created_at) AS with_created_at,
       count(*) FILTER (WHERE created_at IS NULL) AS remaining_nulls,
       min(created_at) AS oldest,
       max(created_at) AS newest
  FROM skusummary;

COMMIT;
