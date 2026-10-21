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
