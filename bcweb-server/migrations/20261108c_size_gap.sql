-- =====================================================================================================================================
-- SIZE GAPS — sizes missing from styles we already sell, as SKU-level prospects (owner, 2026-11-08).
-- =====================================================================================================================================
-- The problem (owner): "We buy products and get the core sizes to test, but then forget what is there and just keep ordering the same
-- sizes." Rules in utils/sizeGaps.js (THE copy — read its header). Screen /prospects/size-gaps, reached from a link on Prospects.
--
-- size_gap_range — THE BRAND'S SIZE RANGE, set BY HAND here (owner: no settings screen until a second brand). UK whole sizes only for
--   now; a brand on EU sizes / half sizes will need thought before it goes in. Every style of the brand is checked against it.
--
-- size_gap_mark — ONE MARK PER SIZE (owner: per size only; a style is dealt with by marking all its gap sizes). Keyed by groupid + UK
--   size, NOT by code: a size that isn't on our system yet has no code. Its OWN table — never the pricing review dates, never Can't
--   get (style-wide), never shopify_dont_order (ends when the size sells on Shopify).
--     park      until = +14, +30, +90 or +180 days, back by itself (was 3 / 6 months until 2026-11-09; 180 added back the same day — comment only, no schema change)
--     notmade   until = NULL — never ends (owner chose it over a 12-month recheck); off until released by hand
--     ordered   until = +90 days
--   EVERY mark also ends when the size ARRIVES (Goods In on or after the mark day) — a decision about a size we don't have is spent
--   once one turns up (added on review 2026-11-09, utils/sizeGaps.js).
--   Release deletes the row. Each mark / release writes a bclog row (section 'Size gaps').
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS size_gap_range (
  brand      text        PRIMARY KEY,                 -- matched to skusummary.brand, trimmed, case-insensitive
  uk_from    integer     NOT NULL CHECK (uk_from BETWEEN 0 AND 20),
  uk_to      integer     NOT NULL CHECK (uk_to BETWEEN 0 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (uk_from <= uk_to)
);

-- Lunar supplies UK 3 to 9 (owner, 2026-11-08); styles that stop at 8 (Blaze) are marked Not made.
INSERT INTO size_gap_range (brand, uk_from, uk_to) VALUES ('Lunar', 3, 9) ON CONFLICT (brand) DO NOTHING;

CREATE TABLE IF NOT EXISTS size_gap_mark (
  groupid    text        NOT NULL,
  uk         integer     NOT NULL,
  mark       text        NOT NULL CHECK (mark IN ('park', 'notmade', 'ordered')),
  until      date,                                    -- NULL only for notmade
  marked_at  timestamptz NOT NULL DEFAULT now(),
  marked_by  text,
  PRIMARY KEY (groupid, uk),
  CHECK ((mark = 'notmade') = (until IS NULL))
);
