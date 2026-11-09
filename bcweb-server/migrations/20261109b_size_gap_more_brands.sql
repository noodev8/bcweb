-- =====================================================================================================================================
-- SIZE GAPS — five more ranges (owner, 2026-11-09). Rules in utils/sizeGaps.js (THE copy). A size = the number at the end of the code.
-- =====================================================================================================================================
-- Picked after a read-only survey of every brand by code ending + a rolled-back dry run of each range:
--   Free Spirit Womens UK 3–8   yes  (4 styles / 6 gap sizes on the dry run)
--   Rieker Mens        EU 40–46 yes  (3 / 8 — high profit a pair, 14621-00 £24.60 at 44)
--   Roamers Mens       UK 6–14  yes  ("clean and easy" — 4 / 28, mostly sold-out sizes)
--   Goor Mens          UK 6–14  yes  (6 / 30, mostly sold-out sizes)
--   Lazy Dogz Womens   UK 3–8   yes  ("we may be extending the range in future"; first set 4–8, widened the same day — owner: "Lake does
--                                     come in a size 3, so suspecting other lazy dogz do too")
-- Left out (owner): Mod Comfys (barely any profit), R21 / Dek / Grafters / Scimitar (no point). Don't fit the code-ending rule:
-- Caprice (EU half sizes), Skechers (US sizes in the code), Goor Boys (child 8–13 then UK 1–5).
-- =====================================================================================================================================

INSERT INTO size_gap_range (brand, who, uk_from, uk_to, sizing) VALUES
  ('Free Spirit', 'Womens',  3,  8, 'UK'),
  ('Rieker',      'Mens',   40, 46, 'EU'),
  ('Roamers',     'Mens',    6, 14, 'UK'),
  ('Goor',        'Mens',    6, 14, 'UK'),
  ('Lazy Dogz',   'Womens',  3,  8, 'UK')
ON CONFLICT (brand, who) DO NOTHING;
