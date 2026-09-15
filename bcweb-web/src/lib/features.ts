/*
=======================================================================================================================================
Module: lib/features.ts  —  front-end feature switches
=======================================================================================================================================
Switches for features that are OFF but deliberately NOT deleted, so reviving one is a single edit here rather than an archaeology
exercise in git history. A switch lives here only while the feature behind it is intact and could plausibly come back.
=======================================================================================================================================
*/

/*
 * Shopify "match Amazon price" autopilot — RETIRED 2026-09-15 (owner).
 *
 * It pinned a flagged style's Shopify price to Amazon's cheapest in-stock size, via a cron job (C:\scripts\amz-match) that is now
 * rem'd out; migrations/20260915_amz_match_disable.sql cleared skusummary.match_amazon_price on every row. Shopify is priced
 * independently now, with Amazon shown as CONTEXT on the drill (per-size price and stock in the size curve, the spread on the setter)
 * and never acted on — the same price nets roughly twice as much on Shopify with no referral fee, and matching down removed the
 * headroom that funds Google Shopping ads.
 *
 * With this false, MatchAmazonPanel is never rendered: no way to switch a style onto autopilot, and any style still carrying the flag
 * gets the normal manual setter instead of a dead autopilot card. The panel, its API route and the list badges are all kept.
 * Set true to bring the whole thing back (and un-rem the cron — this flag only controls the UI).
 */
export const AMZ_MATCH_UI = false;
