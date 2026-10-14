-- =====================================================================================================================================
-- DROP skusummary.sitting_cut_at / sitting_cut_by — the stored "cut" on Winners -> Slow is gone (added 2026-10-11, git 09b1c14).
-- =====================================================================================================================================
-- Why (owner, 2026-10-14): "Cut is mixing the logic. Remove ALL cut functionality including dropping the table column." The stored cut
-- kept a sitting style out of Update collection / Reprice / the Google Ads chip; a cut style that sold vanished from the screen with its
-- mark left behind. Slow now shows only what is slow and whether it is in the clearance collection; the owner adds / removes by hand.
-- Cut on Slow is now a display-only hide (no storage), like Inventory's Cut.
--
-- At drop time 16 styles were cut: 1002443-SOCK, 1002445-SOCK, 1008060-SOCK, 1008061-SOCK, 1009262-SOCK, 40535-FRISCO-BLACK,
-- 41565-CLEVELAND-GREEN, B710AP, M014A, M113BT, M113DB, M404A, M710AP, M968BC, NICE-TAN, XM620A.
--
-- ORDER: run AFTER the server code that no longer reads these columns is live (utils/stockSitting.js selected sitting_cut_at until
-- 2026-10-14) — dropping first breaks Slow, the Repricing sitting list and Update collection.
-- =====================================================================================================================================

ALTER TABLE skusummary DROP COLUMN IF EXISTS sitting_cut_at;
ALTER TABLE skusummary DROP COLUMN IF EXISTS sitting_cut_by;
