/*
=======================================================================================================================================
Module: utils/pricingGroup.js
=======================================================================================================================================
Purpose: Which GROUP of styles a pricing list is scoped to. The WINNERS / LOSERS lists used to be "for a segment" only; since
         2026-09-23 (owner) they can equally be "for a Google campaign" or "Top earners". Same styles, same bars, same drill and
         writes — only the slice differs. Everything downstream of the list (drill, apply, park, bulk) is keyed by groupid / code and
         never knew about segments.

The three groupings:
  segment      skusummary.segment         — the category grouping (EVA-SEG, IVES-WHITE …). Shopify AND Amazon.
  campaign     skusummary.googlecampaign  — OUR Google Ads bucket (shipped as custom_label_0; written by google-ads-assign). TRIMmed,
                                            because that is how the Google Ads screen groups it (google-ads-campaigns: members CTE).
                                            SHOPIFY ONLY (owner): Google Shopping advertises the Shopify site, so there is no Amazon
                                            list by campaign.
  topearners   styles whose revenue ON THIS CHANNEL cleared the portfolio winner bar over 12 months (utils/portfolio.js →
               topEarnerGroupidsSql). Shopify AND Amazon, each channel judged on its own sales (owner chose the per-channel test so an
               Amazon-made style doesn't turn up on the Shopify list). ONE group, not many: every top earner gets the same name
               (TOP_EARNERS_NAME), so a list route's `${group.column} = $1` works unchanged — the column is a CASE that yields the name
               for a member and NULL for everything else.

The column is written against a skusummary ALIAS, because the Shopify routes call it `ss` and the Amazon routes `sk`.

SAFETY: the returned `column` is interpolated into SQL (a column can't be a bind parameter). It only ever comes from the fixed
builders below — never from the request — so it cannot carry user input. The group NAME is always a bind parameter.
=======================================================================================================================================
*/

const { topEarnerGroupidsSql } = require('./portfolio');

// The name every top-earner style groups under — the value `column` yields and the list routes bind as $1. It is also what the
// Segments screen shows and what the web app puts in the URL path, so the label lives here once.
const TOP_EARNERS_NAME = 'Top earners';

const ALIASES = new Set(['ss', 'sk']);

// by -> builder(alias, channel) of a SQL expression over the skusummary alias. Keys are the only values accepted from the request.
const BUILDERS = {
  segment: (a) => `${a}.segment`,
  campaign: (a) => `TRIM(${a}.googlecampaign)`,
  topearners: (a, channel) => `(CASE WHEN ${a}.groupid IN (${topEarnerGroupidsSql(channel)}) THEN '${TOP_EARNERS_NAME}' END)`,
};

// Which groupings exist on which channel.
const CHANNEL_GROUPINGS = {
  SHP: ['segment', 'campaign', 'topearners'],
  AMZ: ['segment', 'topearners'],
};

/*
 * groupColumn(by, { alias = 'ss', channel = 'SHP' }) — the SQL expression naming a style's group. For the heatmap counts
 * (utils/shopifyActionable.js, utils/amazonActionable.js), which GROUP BY it. Throws on anything outside the fixed maps.
 */
function groupColumn(by, { alias = 'ss', channel = 'SHP' } = {}) {
  if (!ALIASES.has(alias)) throw new Error(`groupColumn: unknown alias ${alias}`);
  if (!(CHANNEL_GROUPINGS[channel] || []).includes(by)) throw new Error(`groupColumn: ${by} is not a ${channel} grouping`);
  return BUILDERS[by](alias, channel);
}

// Kept for the callers that group whole tables by segment / campaign on Shopify (routes/segments.js, routes/pricing-campaigns.js).
const GROUP_COLUMNS = {
  segment: groupColumn('segment'),
  campaign: groupColumn('campaign'),
};

/*
 * parseGroup(query, { alias, channel }) — read the group from a list route's query string.
 *   ?segment=X      -> { by: 'segment',    name: 'X',           column: '<alias>.segment' }  (the original form, unchanged)
 *   ?campaign=Y     -> { by: 'campaign',   name: 'Y',           column: 'TRIM(<alias>.googlecampaign)' }        (Shopify only)
 *   ?topearners=…   -> { by: 'topearners', name: 'Top earners', column: '(CASE WHEN <alias>.groupid IN (…) …)' }
 *                      Any non-empty value switches it on; the web client sends the group name.
 * Exactly one must be given, and it must exist on this channel; returns null otherwise (the route answers MISSING_FIELDS).
 */
function parseGroup(q, { alias = 'ss', channel = 'SHP' } = {}) {
  const val = (k) => (typeof q[k] === 'string' ? q[k].trim() : '');
  const given = ['segment', 'campaign', 'topearners'].filter((k) => val(k));
  if (given.length !== 1) return null;
  const by = given[0];
  if (!CHANNEL_GROUPINGS[channel].includes(by)) return null;
  const name = by === 'topearners' ? TOP_EARNERS_NAME : val(by);
  return { by, name, column: groupColumn(by, { alias, channel }) };
}

module.exports = { parseGroup, groupColumn, GROUP_COLUMNS, TOP_EARNERS_NAME };
