-- =====================================================================================================================================
-- PROSPECTS — a shared notepad of possible NEW products found on Amazon (owner, 2026-10-21).
-- =====================================================================================================================================
-- Why: research ("Rieker boots for women" → check rank, price, sellers) lived on paper and in emails, so each day started again from
-- nothing. This is one shared list the team logs finds on and comes back to — to order (manually, outside BCWEB) or to drop.
--
-- Deliberately light (owner: "an extended Google Docs specific for us"):
--   prospect        one line = one style found on Amazon. owner = whoever added it. rating is a gut call, nothing more.
--   prospect_check  each time someone looks: rank / price / sellers, typed by hand (no scraping, no API — owner's call). size is
--                   optional because rank differs by size on the same listing. asin optional: a size is usually its own child ASIN.
--   prospect_note   a short thread of notes with names — about any size, or anything.
--
-- DELETE IS A REAL DELETE (owner: "like deleting a line from google docs"): ON DELETE CASCADE takes a line's checks and notes with
-- it. No soft-delete, no "dropped" state, no history. No link to skusummary / ordering on purpose — this is mining for NEW products.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS prospect (
  id          serial PRIMARY KEY,
  name        varchar(200) NOT NULL,
  asin        varchar(10),                                                       -- optional; upper-cased, 10 chars
  rating      varchar(7)   CHECK (rating IN ('diamond', 'good', 'sketchy')),     -- NULL = not rated yet
  owner       text         NOT NULL,                                             -- display_name of who added it
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz
);

CREATE TABLE IF NOT EXISTS prospect_check (
  id           serial PRIMARY KEY,
  prospect_id  integer       NOT NULL REFERENCES prospect(id) ON DELETE CASCADE,
  size         varchar(10),
  asin         varchar(10),
  rank         integer       CHECK (rank > 0),
  price        numeric(10,2) CHECK (price >= 0),
  sellers      smallint      CHECK (sellers >= 0),
  checked_by   text          NOT NULL,
  checked_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospect_check_prospect_idx ON prospect_check (prospect_id, checked_at);

CREATE TABLE IF NOT EXISTS prospect_note (
  id           serial PRIMARY KEY,
  prospect_id  integer       NOT NULL REFERENCES prospect(id) ON DELETE CASCADE,
  body         varchar(2000) NOT NULL,
  created_by   text          NOT NULL,
  created_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospect_note_prospect_idx ON prospect_note (prospect_id, created_at);

-- Free-text notes on a line (owner, 2026-10-21: "I will need some free text notes area for a find") — one editable block, like a
-- paragraph in a doc. The prospect_note thread stays for quick back-and-forth (labelled Comments on screen).
ALTER TABLE prospect ADD COLUMN IF NOT EXISTS details text;

-- Rank / price / sellers are FREE TEXT (owner, 2026-10-21: "All should be optional free text. Rank is 58k for example") — kept as typed.
-- The screen reads "58k" / "1.2m" / "2,140" as a number only to say whether rank went up or down.
ALTER TABLE prospect_check DROP CONSTRAINT IF EXISTS prospect_check_rank_check;
ALTER TABLE prospect_check DROP CONSTRAINT IF EXISTS prospect_check_price_check;
ALTER TABLE prospect_check DROP CONSTRAINT IF EXISTS prospect_check_sellers_check;
ALTER TABLE prospect_check ALTER COLUMN rank TYPE varchar(30), ALTER COLUMN price TYPE varchar(30), ALTER COLUMN sellers TYPE varchar(30);
-- RRP of a find, typed by hand, to guess the profit (owner, 2026-10-21). Free text too.
ALTER TABLE prospect ADD COLUMN IF NOT EXISTS rrp varchar(30);

-- JUST COMMENTS (owner, 2026-10-21: "Im confused by the main comment and the others. Should we just have comments?"). The free-text
-- block is folded into the comment thread: comments take long text now, and any notes already written become a comment by the
-- line's owner, then the column goes.
ALTER TABLE prospect_note ALTER COLUMN body TYPE varchar(10000);
INSERT INTO prospect_note (prospect_id, body, created_by, created_at)
  SELECT id, LEFT(details, 10000), owner, COALESCE(updated_at, created_at) FROM prospect WHERE NULLIF(TRIM(details), '') IS NOT NULL;
ALTER TABLE prospect DROP COLUMN IF EXISTS details;
