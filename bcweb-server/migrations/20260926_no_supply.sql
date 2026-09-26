-- =====================================================================================================================
-- 20260926_no_supply.sql — "Can't get it": a style the supplier can't supply, parked off the order screens (owner, 2026-09-26)
-- =====================================================================================================================
-- WHAT THIS ADDS
--
--   skusummary.no_supply_since   date         — the London day the operator marked it. Kept after the park expires, so the style can
--                                               come back saying WHY ("Couldn't get it — 26 Sep") until it is cleared.
--   skusummary.no_supply_until   date         — the style stays off the order screens while this is in the future (London date).
--                                               Always three months out (utils/noSupply.js).
--   skusummary.no_supply_by      varchar(100) — who marked it (req.user.display_name, resolved server-side — never sent by the client).
--
--   All three NULL = never marked, or cleared.
--
--   WHY A FLAG AND NOT THE SEASON: the owner's first instinct was to change a style's season when the supplier had none — season
--   already hid it from the order screen and brought it back on its own. But season decides WINNERS vs HARVEST and is what the
--   Seasons screen reads to show what sells when; using it for supply would move the status and blur that screen. This is its own
--   fact, with its own expiry, so nothing has to be remembered and switched back: the date lapses and the style returns.
--
--   A style fact, not a channel one — read by Shopify Order now and Amazon Order later; rules in utils/noSupply.js, written by
--   routes/no-supply-set.js and routes/no-supply-clear.js.
--   NOT a product edit — nothing else on skusummary (no legacy `updated` stamp, no shopifychange) is touched when these are set.
-- =====================================================================================================================

ALTER TABLE skusummary
  ADD COLUMN IF NOT EXISTS no_supply_since date,
  ADD COLUMN IF NOT EXISTS no_supply_until date,
  ADD COLUMN IF NOT EXISTS no_supply_by varchar(100);
