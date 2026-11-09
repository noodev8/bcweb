-- =====================================================================================================================================
-- SIZE GAPS — EU brands + Womens / Mens (owner, 2026-11-09). Rules in utils/sizeGaps.js (THE copy — read its header).
-- =====================================================================================================================================
-- Rieker, Remonte and Strive join Lunar, in THEIR OWN EU sizing (owner: "these 3 in EU fit well for our next work"). Their codes end
-- in a whole EU size (…-38), always one-to-one with skumap.uksize — but in UK their core sizes are halves (Rieker / Remonte EU 40 =
-- 6.5, 41 = 7.5, and no UK 7), and the brands convert differently (Strive EU 41 = UK 7). So from today A SIZE IS THE NUMBER AT THE
-- END OF THE CODE for every brand — Lunar's codes end 03…09, the same as its UK 3–9, so its range and existing marks stand unchanged.
--
-- THE COLUMNS KEEP THEIR OLD NAMES: size_gap_range.uk_from / uk_to and size_gap_mark.uk now hold THE SIZE OFF THE CODE (UK for Lunar,
-- EU for the EU brands). Renaming them was not worth breaking a server that may already be running the 2026-11-08 code.
--   sizing  'UK' | 'EU' — a LABEL ONLY ("38 EU" on the tiles / Best size); it changes no rule.
--   who     the first word of title.shopifytitle ('Womens', 'Mens', …). A range covers ONE brand + who, because Rieker sells Mens
--           styles in EU 40–46 that a women's EU 36–42 range would flag as gaps. Rieker Mens is a later decision (owner), so it has
--           no range and its styles are not checked. Every existing range (Lunar) is Womens — all 47 Lunar titles start "Womens".
-- Ranges stay set BY HAND here (no settings screen). A style that doesn't come in a size is marked Not made on the screen.
-- =====================================================================================================================================

BEGIN;

ALTER TABLE size_gap_range ADD COLUMN IF NOT EXISTS who    text NOT NULL DEFAULT 'Womens';
ALTER TABLE size_gap_range ADD COLUMN IF NOT EXISTS sizing text NOT NULL DEFAULT 'UK';

ALTER TABLE size_gap_range DROP CONSTRAINT IF EXISTS size_gap_range_sizing_check;
ALTER TABLE size_gap_range ADD  CONSTRAINT size_gap_range_sizing_check CHECK (sizing IN ('UK', 'EU'));

-- EU sizes run past 20.
ALTER TABLE size_gap_range DROP CONSTRAINT IF EXISTS size_gap_range_uk_from_check;
ALTER TABLE size_gap_range DROP CONSTRAINT IF EXISTS size_gap_range_uk_to_check;
ALTER TABLE size_gap_range ADD  CONSTRAINT size_gap_range_uk_from_check CHECK (uk_from BETWEEN 0 AND 60);
ALTER TABLE size_gap_range ADD  CONSTRAINT size_gap_range_uk_to_check   CHECK (uk_to   BETWEEN 0 AND 60);

-- One range per brand + who.
ALTER TABLE size_gap_range DROP CONSTRAINT IF EXISTS size_gap_range_pkey;
ALTER TABLE size_gap_range ADD  CONSTRAINT size_gap_range_pkey PRIMARY KEY (brand, who);

-- Women's EU 36–42 for the three (36 = Rieker / Remonte UK 3.5, Strive UK 3; 42 = UK 8). Styles that stop short are marked Not made.
INSERT INTO size_gap_range (brand, who, uk_from, uk_to, sizing) VALUES
  ('Rieker',  'Womens', 36, 42, 'EU'),
  ('Remonte', 'Womens', 36, 42, 'EU'),
  ('Strive',  'Womens', 36, 42, 'EU')
ON CONFLICT (brand, who) DO NOTHING;

COMMIT;
