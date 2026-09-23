/*
=======================================================================================================================================
Module: utils/pricingGroup.js
=======================================================================================================================================
Purpose: Which GROUP of styles a Shopify pricing list is scoped to. The WINNERS / LOSERS lists used to be "for a segment" only; since
         2026-09-23 (owner) they can equally be "for a Google campaign". Same styles, same bars, same drill and writes — only the slice
         differs. Everything downstream of the list (drill, apply, park, bulk) is keyed by groupid and never knew about segments.

The two groupings, both one value per style on skusummary:
  segment   skusummary.segment         — the category grouping (EVA-SEG, IVES-WHITE …)
  campaign  skusummary.googlecampaign  — OUR Google Ads bucket (shipped as custom_label_0; written by google-ads-assign). TRIMmed,
                                         because that is how the Google Ads screen groups it (google-ads-campaigns: members CTE).

Campaigns are SHOPIFY ONLY (owner): Google Shopping advertises the Shopify site, so there is no Amazon list by campaign. The Amazon
routes don't use this helper.

SAFETY: the returned `column` is interpolated into SQL (a column can't be a bind parameter). It only ever comes from the fixed map
below — never from the request — so it cannot carry user input. The group NAME is always a bind parameter.
=======================================================================================================================================
*/

// by -> SQL expression over the skusummary alias `ss`. Keys are the only values accepted from the request.
const GROUP_COLUMNS = {
  segment: 'ss.segment',
  campaign: 'TRIM(ss.googlecampaign)',
};

/*
 * parseGroup(query) — read the group from a list route's query string.
 *   ?segment=X      -> { by: 'segment',  name: 'X', column: 'ss.segment' }             (the original form, unchanged for old clients)
 *   ?campaign=Y     -> { by: 'campaign', name: 'Y', column: 'TRIM(ss.googlecampaign)' }
 * Exactly one must be given; returns null otherwise (the route answers MISSING_FIELDS).
 */
function parseGroup(q) {
  const segment = typeof q.segment === 'string' ? q.segment.trim() : '';
  const campaign = typeof q.campaign === 'string' ? q.campaign.trim() : '';
  if (segment && campaign) return null;
  if (segment) return { by: 'segment', name: segment, column: GROUP_COLUMNS.segment };
  if (campaign) return { by: 'campaign', name: campaign, column: GROUP_COLUMNS.campaign };
  return null;
}

module.exports = { parseGroup, GROUP_COLUMNS };
