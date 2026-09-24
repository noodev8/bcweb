-- =====================================================================================================================
-- 20260925_portfolio_channel.sql — which channel a style's status belongs to (owner, 2026-09-25)
-- =====================================================================================================================
-- WHAT THIS ADDS
--
--   skusummary.portfolio_channel   SHP | AMZ | BOTH — stamped by "Update now" beside portfolio_status (utils/portfolioStatus.js):
--       SHP / AMZ  >= 80% of the style's 12m gross revenue came from that channel
--       BOTH       mixed (neither reaches 80%), OR no sales in 12m but listed on Amazon (amzfeed) — needs pricing on both
--       SHP        no sales in 12m and not on Amazon
--     NULL = not assessed yet (created since the last Update) and is read as BOTH, so a new product is never hidden from a list.
--
--   WHY: the WINNERS tag is an all-channel test (the style is one asset), but pricing is per channel. On 2026-09-25, 23 of the 73
--   winners were Amazon winners earning ~2.5% of their money on Shopify — a third of the Shopify WINNERS list was work with nothing
--   to gain ("I'm working on Shopify when I have nothing to gain from it"). The status stays ONE tag and ONE count; the channel
--   decides which channel's list a style appears on, and splits the Winners screen's boxes. No winner was mixed on the day
--   (50 Shopify-led / 23 Amazon-led / 0 mixed), so the lead channel gives exactly what a per-channel status test would, without
--   giving a style two statuses.
--
--   portfolio_status_snapshot.channel_counts   jsonb — the day's counts per channel, { "SHP": { "WINNERS": 50, ... }, "AMZ": {...} },
--     each channel counting SHP|AMZ + BOTH (+ NULL) — i.e. "on that channel's list". Drives the Winners graph in its Shopify /
--     Amazon views. NULL on rows written before this column (the channel graph starts from the first Update after it) — never
--     backfilled, for the reason the table header gives.
-- =====================================================================================================================

ALTER TABLE skusummary
  ADD COLUMN IF NOT EXISTS portfolio_channel varchar(4);

ALTER TABLE skusummary
  ADD CONSTRAINT skusummary_portfolio_channel_chk
  CHECK (portfolio_channel IS NULL OR portfolio_channel IN ('SHP', 'AMZ', 'BOTH'));

ALTER TABLE portfolio_status_snapshot
  ADD COLUMN IF NOT EXISTS channel_counts jsonb;
