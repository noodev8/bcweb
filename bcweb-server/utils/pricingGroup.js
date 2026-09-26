/*
=======================================================================================================================================
Module: utils/pricingGroup.js
=======================================================================================================================================
Purpose: Which GROUP of styles a pricing list is scoped to. The WINNERS / LOSERS lists used to be "for a segment" only; since
         2026-09-23 (owner) they can equally be "for a Google campaign", and since 2026-09-24 "for a portfolio status". Everything
         downstream of the list (drill, apply, park, bulk) is keyed by groupid / code and never knew about segments.

The three groupings:
  segment      skusummary.segment         — the category grouping (EVA-SEG, IVES-WHITE …). Shopify AND Amazon.
  campaign     skusummary.googlecampaign  — OUR Google Ads bucket (shipped as custom_label_0; written by google-ads-assign). TRIMmed,
                                            because that is how the Google Ads screen groups it (google-ads-campaigns: members CTE).
                                            SHOPIFY ONLY (owner): Google Shopping advertises the Shopify site, so there is no Amazon
                                            list by campaign.
  status       skusummary.portfolio_status — the STORED portfolio status (WINNERS | STEADY | NEW | LOSERS, set by the Winners
               screen's "Update now"; utils/portfolioStatus.js). Shopify AND Amazon (an Amazon SKU takes its style's status). The name
               must be one of the four — anything else is refused rather than matching nothing. Its lists are NOT the Selling / Stuck
               bars: routes/pricing-status-list.js and routes/amz-status-list.js return every style / SKU with the status, unsplit and
               out-of-stock included (owner, 2026-09-24).

"Top earners" (a per-channel reading of the Winners bar) was a fourth grouping from 2026-09-23 until 2026-09-24, when the Status tab
replaced it and the owner had it removed. It is in git history if it is ever wanted back.

The column is written against a skusummary ALIAS, because the Shopify routes call it `ss` and the Amazon routes `sk`.

SAFETY: the returned `column` is interpolated into SQL (a column can't be a bind parameter). It only ever comes from the fixed
builders below — never from the request — so it cannot carry user input. The group NAME is always a bind parameter.
=======================================================================================================================================
*/

const { STATUSES } = require('./portfolioStatus');

const ALIASES = new Set(['ss', 'sk']);

// by -> builder(alias) of a SQL expression over the skusummary alias. Keys are the only values accepted from the request.
const BUILDERS = {
  segment: (a) => `${a}.segment`,
  campaign: (a) => `TRIM(${a}.googlecampaign)`,
  status: (a) => `${a}.portfolio_status`,
};

// Which groupings exist on which channel.
const CHANNEL_GROUPINGS = {
  SHP: ['segment', 'campaign', 'status'],
  AMZ: ['segment', 'status'],
};

/*
 * groupColumn(by, { alias = 'ss', channel = 'SHP' }) — the SQL expression naming a style's group. For the heatmap counts
 * (utils/shopifyActionable.js, utils/amazonActionable.js), which GROUP BY it. Throws on anything outside the fixed maps.
 */
function groupColumn(by, { alias = 'ss', channel = 'SHP' } = {}) {
  if (!ALIASES.has(alias)) throw new Error(`groupColumn: unknown alias ${alias}`);
  if (!(CHANNEL_GROUPINGS[channel] || []).includes(by)) throw new Error(`groupColumn: ${by} is not a ${channel} grouping`);
  return BUILDERS[by](alias);
}

// Kept for the callers that group whole tables by segment / campaign on Shopify (routes/segments.js, routes/pricing-campaigns.js).
const GROUP_COLUMNS = {
  segment: groupColumn('segment'),
  campaign: groupColumn('campaign'),
};

/*
 * parseGroup(query, { alias, channel }) — read the group from a list route's query string.
 *   ?segment=X      -> { by: 'segment',  name: 'X',       column: '<alias>.segment' }  (the original form, unchanged)
 *   ?campaign=Y     -> { by: 'campaign', name: 'Y',       column: 'TRIM(<alias>.googlecampaign)' }        (Shopify only)
 *   ?status=WINNERS -> { by: 'status',   name: 'WINNERS', column: '<alias>.portfolio_status' }            (one of the four,
 *                      case-insensitive)
 * Exactly one must be given, and it must exist on this channel; returns null otherwise (the route answers MISSING_FIELDS).
 */
function parseGroup(q, { alias = 'ss', channel = 'SHP' } = {}) {
  const val = (k) => (typeof q[k] === 'string' ? q[k].trim() : '');
  const given = ['segment', 'campaign', 'status'].filter((k) => val(k));
  if (given.length !== 1) return null;
  const by = given[0];
  if (!CHANNEL_GROUPINGS[channel].includes(by)) return null;
  const name = by === 'status' ? val(by).toUpperCase() : val(by);
  if (by === 'status' && !STATUSES.includes(name)) return null;
  return { by, name, column: groupColumn(by, { alias, channel }) };
}

module.exports = { parseGroup, groupColumn, GROUP_COLUMNS };
