-- =====================================================================================================================================
-- "CAN'T GET IT" — DROP THE OLD STYLE FLAG (owner, 2026-11-13). APPLIED 2026-11-13.
-- =====================================================================================================================================
-- Can't get lives only in no_supply_size, per size (utils/noSupply.js, THE copy). 20261113c moved the 37 style marks there and emptied
-- these columns; checked before dropping: all NULL, no view / function / index / dependent object referenced them, and no code in the
-- repo read them (the API's no_supply_since / _until / _by fields come from no_supply_size).
-- =====================================================================================================================================

ALTER TABLE skusummary
  DROP COLUMN IF EXISTS no_supply_since,
  DROP COLUMN IF EXISTS no_supply_until,
  DROP COLUMN IF EXISTS no_supply_by;
