-- =====================================================================================================================================
-- PROSPECTS — what a find would COST us, to show its return on cost (owner, 2026-10-27).
-- =====================================================================================================================================
-- Cash flow means choosing between finds, and the figure that compares them is RETURN ON COST: what a pair keeps ÷ what it costs
-- (owner: "£100 on Fly London keeps ~£10, £100 on Lunar keeps ~£27"). The line already has the Amazon price (on its checks) and RRP;
-- this is the cost, typed by hand, free text like RRP. prospect-list works the keep out with THE Amazon formula (utils/amzProfit.js)
-- and ships "£x a pair · y% on cost". NULL = not typed.
-- =====================================================================================================================================

ALTER TABLE prospect ADD COLUMN IF NOT EXISTS cost varchar(30);
