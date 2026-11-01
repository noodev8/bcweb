/*
=======================================================================================================================================
Module: utils/orderRows.js
=======================================================================================================================================
Purpose: The small helpers every order CHANNEL shares when it writes customer orders into orderstatus / orderstatus_archive
         (utils/shopifyOrderSync.js, utils/ebayOrderSync.js, and whatever channel comes next). Kept out of utils/orderSync.js so a channel
         file can use them without a require cycle (orderSync.js loads the channel list, the channels load this).
=======================================================================================================================================
*/

/*
 * safe(value, maxLength) -> trimmed string, '' for anything that isn't a non-empty string.
 *
 * QUIRK, KEPT ON PURPOSE: ANY non-string — a number, null, undefined — comes back as '', not as its text form. That is why every
 * Shopify orderstatus row ever written has `shippingcost = ''`: the shipping charge is a number and never survives the type test. The
 * legacy order sync (Python, retired 2026-11-01) did exactly this, and every row in the table follows it; changing it now would make new
 * rows differ from old ones for no benefit.
 */
function safe(value, maxLength = null) {
  let result = (value && typeof value === 'string') ? value.trim() : '';
  if (maxLength && result.length > maxLength) result = result.slice(0, maxLength);
  return result;
}

// The 44 columns an orderstatus row carries and the 44 copied into orderstatus_archive (plus archivedate, which the caller adds).
// Written out rather than `SELECT *`, so adding a column to either table can never silently shift the mapping.
const ARCHIVE_COLS = [
  'ordernum', 'shopifysku', 'qty', 'updated', 'created', 'batch', 'supplier', 'title', 'shippingname',
  'postcode', 'address1', 'address2', 'company', 'city', 'county', 'country', 'phone', 'shippingnotes',
  'orderdate', 'ukd', 'localstock', 'amz', 'othersupplier', 'fnsku', 'weight', 'pickedqty', 'email',
  'courier', 'courierfixed', 'customerwaiting', 'notorderamz', 'alloworder', 'searchalt', 'channel',
  'picknotfound', 'fbaordered', 'notes', 'shopcustomer', 'shippingcost', 'ordertype', 'ponumber',
  'createddate', 'arrived', 'arriveddate'
].join(', ');

module.exports = { safe, ARCHIVE_COLS };
