-- =====================================================================================================================================
-- Migration: scratchpad_note  (Analytics module — New Additions "Scratchpad")
-- =====================================================================================================================================
-- Purpose: A tiny, free-form notepad shown on the New Additions screen. While the owner is in RESEARCH mode (deciding what to order),
--          they jot loose product notes here; when the product arrives and they move into set-up mode, the notes are waiting. Replaces
--          a shared Google Sheet / notepad. Deliberately unstructured: one text blob per note, no fields, no rules. Shared across all
--          logged-in users (small internal team). Add + delete only — to change a note, delete and re-add.
--
--          `created_by` = the app user's display_name resolved server-side (never trusted from the client), so a note shows who wrote
--          it. `created_at timestamptz` for ordering (newest first) and a human "when". No update path by design.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS scratchpad_note (
  id         BIGSERIAL   PRIMARY KEY,
  body       TEXT        NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first listing is the only read pattern.
CREATE INDEX IF NOT EXISTS scratchpad_note_created_at_idx ON scratchpad_note (created_at DESC);
