-- =====================================================================================================================================
-- skusummary.sitting_cut_at / sitting_cut_by — a style CUT from the Sitting list's working set (Reports -> Selling vs Sitting).
-- =====================================================================================================================================
-- Why (owner, 2026-10-11): "can I cut some items from the rows so that I update collection and price to a set few?" The sitting list
-- is a fact (no sale in 60 days); not every sitting style is one the owner wants on the clearance collection or repriced. A cut style
-- stays ON the list (greyed, with Release) and in the Sitting box — it is still sitting — but "Update collection" (the Shopify
-- `clearance` tag), "Reprice" and the Google Ads Sitting chip skip it.
--
-- SAVED, TEAM-WIDE, UNTIL RELEASED (owner's choice over "this visit only"): Update collection makes the tag match the list exactly, so a
-- cut that wasn't remembered would be re-tagged by the next press. No expiry. A cut style that sells drops off the list and the mark
-- sits harmlessly; if it ever sits again it comes back already cut, in the greyed section, where it can be seen and released.
--
-- WRITER: POST /stock-sitting-cut only. NULL = not cut.
-- =====================================================================================================================================

ALTER TABLE skusummary ADD COLUMN sitting_cut_at timestamptz;
ALTER TABLE skusummary ADD COLUMN sitting_cut_by text;
