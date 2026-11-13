-- =====================================================================================================================================
-- "CAN'T GET IT" PER SIZE (owner, 2026-11-13) — rules in utils/noSupply.js (THE copy). APPLIED 2026-11-13.
-- =====================================================================================================================================
-- THE one store of Can't get: one row per size. Amazon Order lists by size, and pressing Can't get on one size marked the whole style
-- when the owner meant "we can't get THAT size". A whole style (Shopify Order's style view, Seasons) is a row on every size of it.
-- The old style flag (skusummary.no_supply_*) is moved in and emptied by 20261113c_no_supply_to_sizes.sql.
--
--   Off BOTH order screens (Amazon and Shopify — one supplier), three months from the London day it was set, then lapses by itself.
--   A lapsed row is kept so the size comes back saying "Couldn't get it — <date>"; Release deletes the row. Lapsed rows are purged
--   six months after they lapse by the mark write itself (no cron, no table that grows for ever).
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS no_supply_size (
  code        varchar      PRIMARY KEY,               -- skumap.code (the size)
  groupid     varchar      NOT NULL,                  -- its style, for whole-style marks / releases and the per-style summary
  since       date         NOT NULL,                  -- London day it was marked
  until       date         NOT NULL,                  -- off the order screens while this is in the future
  marked_by   text,                                   -- verifyToken display_name
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS no_supply_size_groupid ON no_supply_size (groupid);
