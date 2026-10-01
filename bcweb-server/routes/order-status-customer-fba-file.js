/*
=======================================================================================================================================
API Route: order_status_customer_fba_file
=======================================================================================================================================
Method: POST
Purpose: Build the Amazon Multi-Channel Fulfilment (MCF) order file for one FBA customer order — the tab-separated flat file uploaded to
         Seller Central so Amazon ships the order from FBA stock. Replaces making it in the legacy app ("AMZ-Order.txt").

WHY IT EXISTS: a customer order whose stock is at Amazon (`amz > 0`, the `fba` state on the Customer Orders screen) is never boxed here.
Nothing happens until somebody hands Amazon the order, and this file is how that's done.

MAKING THE FILE MARKS THE ORDER DONE (owner): once the file exists the order is with Amazon, so there is nothing left for us to do.
The mark is the LEGACY one — the PowerBuilder app stamps `orderdate` with the time the file was made (seen on BC19249 and BC19259:
orderdate = the moment of the file, not `created`). Nothing else ever puts a stamp on an amz line: the sync's FBA fallback leaves
orderdate blank and /order-status-customer-fba blanks it. So "amz > 0 AND orderdate set" means "file made", whichever app made it, and
utils/customerOrders.js rowState() reads it as `packed`.

The stamp is written only where orderdate is still blank, so downloading the file a second time (lost it, upload failed) keeps the
time of the FIRST file. Same transaction as the read, FOR UPDATE, so the file and the stamp describe the same rows.

(`fbaordered` is NOT the marker, despite the name: it is NULL on every archived row bar one blank, including the FBA ones.)

THE FORMAT is copied column-for-column from a file the legacy app produced (BC19259, 2026-10-01). Where each value comes from:

  MerchantFulfillmentOrderID / DisplayableOrderID   ordernum
  DisplayableOrderDate        `created` (when the customer ordered, London wall clock) as YYYY-MM-DDTHH:MM:SS — no zone, as legacy
  MerchantSKU                 amzfeed.sku for the line's code — the Amazon SKU (e.g. …-07-2501), NOT the Shopify code
  Quantity                    units of that code on the order (orderstatus is one row per unit, so COUNT(*))
  MerchantFulfillmentOrderItemID   the Shopify code — unique within an order because lines are grouped by it
  PerUnitDeclaredValue        amzfeed.amzprice (the Amazon price, not what the customer paid) — matched the legacy file exactly
  DisplayableOrderComment     fixed thank-you text below, double space and all, as legacy
  DeliverySLA                 from the order's `courier` — i.e. the delivery the CUSTOMER PAID FOR. The sync sets courier '4' when the
                              next-day postage was paid (utils/orderSync.js NEXT_DAY_POSTAGE), and that customer must get next-day
                              from Amazon too, so '4' -> 'Expedited' (Amazon UK MCF: Expedited = next day, Standard = 2-3 days).
                              Anything else -> 'Standard'. See DELIVERY_SLA below. An operator's courier override on the screen is
                              therefore honoured, which is what you'd want.
  AddressFieldThree           `county` — and AddressStateOrRegion is `city` again. Both look odd and both are exactly what the legacy
                              file holds (ENG / Thetford). Kept as legacy so Amazon gets what it has always been given.
  FulfillmentAction           'Ship'
  GiftMessage, DisplayableComment, MarketplaceID   blank

ONLY THE FBA LINES go in the file (`amz > 0`). Today FBA can only be set on a single-line order, so that is the whole order, but a line
coming off our shelf must never be in a file that tells Amazon to ship it.

Text is returned in the envelope and the browser turns it into the download. CRLF line endings, a trailing CRLF, no BOM — byte-for-byte
the legacy layout. Tabs/newlines inside a field (a pasted address) are flattened to spaces so they can't break the columns.
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC19259" }

Success Response:
{ "return_code": "SUCCESS", "ordernum": "BC19259", "filename": "AMZ-Order-BC19259.txt", "lines": 1, "stamped": 1, "content": "MerchantFulfillment…" }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"          — no customer order with that number
"NOT_FBA"            — the order has no line flagged to come from FBA
"NO_AMAZON_SKU"      — a line's code isn't in amzfeed, so there's no Amazon SKU / price to send
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { CUSTOMER_ORDERTYPE, notDiscarded } = require('../utils/customerOrders');
// Shared date-format constant only — see the note in order-status-customer-note.js.
const { LEGACY_STAMP } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

const HEADER = [
  'MerchantFulfillmentOrderID', 'DisplayableOrderID', 'DisplayableOrderDate', 'MerchantSKU', 'Quantity',
  'MerchantFulfillmentOrderItemID', 'GiftMessage', 'DisplayableComment', 'PerUnitDeclaredValue', 'DisplayableOrderComment',
  'DeliverySLA', 'AddressName', 'AddressFieldOne', 'AddressFieldTwo', 'AddressFieldThree', 'AddressCity', 'AddressCountryCode',
  'AddressStateOrRegion', 'AddressPostalCode', 'AddressPhoneNumber', 'NotificationEmail', 'FulfillmentAction', 'MarketplaceID',
];

// Verbatim from the legacy file, including the two spaces after "order." — this is what the customer sees on Amazon's packing slip.
const ORDER_COMMENT = 'Thank you for ordering from BrookfieldComfort.com.  We appreciate your order.  For customer returns, please visit https://brookfieldcomfort.com/policies/refund-policy.';

// A tab or line break inside a value would shift every column after it; Amazon would then reject the row, or worse, accept it wrong.
// Amazon MCF shipping speed per courier code (utils/customerOrders.js COURIERS). Only next-day needs a mapping; every other code —
// '5' RM48, '0' pack only, a blank or unknown value — falls through to Standard, matching the sync's own "anything else is 48h" rule.
const DELIVERY_SLA = { '4': 'Expedited' };
const deliverySla = (courier) => DELIVERY_SLA[String(courier ?? '').trim()] || 'Standard';

const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

// '20260930 17:33:08' -> '2026-09-30T17:33:08'. Pure string surgery: `created` is London wall-clock text and the file wants it as-is,
// so going through a JS Date would only add a timezone to get wrong.
function isoStamp(created) {
  const m = /^(\d{4})(\d{2})(\d{2}) (\d{2}:\d{2}:\d{2})/.exec(String(created || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : '';
}

router.post('/', async (req, res) => {
  try {
    const { ordernum } = req.body || {};
    const num = typeof ordernum === 'string' ? ordernum.trim() : '';
    if (!num) return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernum is required' });

    const outcome = await withTransaction(async (client) => {
      // Lock the order's lines first: the aggregate below can't take FOR UPDATE itself (GROUP BY), and the stamp at the end must land
      // on exactly the rows the file was built from.
      await client.query(
        `SELECT 1 FROM orderstatus WHERE ordernum = $1 AND ordertype = $2 FOR UPDATE`,
        [num, CUSTOMER_ORDERTYPE]
      );

      // One row per CODE, not per unit: the per-order fields (address etc.) are identical across an order's lines, so MAX() just
      // picks the value. The `fba` flag lets NOT_FOUND and NOT_FBA be told apart in one query.
      const result = await client.query(`
        SELECT o.shopifysku                         AS code,
               COUNT(*)                             AS units,
               BOOL_OR(COALESCE(o.amz, 0) > 0)      AS fba,
               MAX(o.created)      AS created,
               MAX(o.shippingname) AS name,
               MAX(o.address1)     AS address1,
               MAX(o.address2)     AS address2,
               MAX(o.county)       AS county,
               MAX(o.city)         AS city,
               MAX(o.country)      AS country,
               MAX(o.postcode)     AS postcode,
               MAX(o.phone)        AS phone,
               MAX(o.email)        AS email,
               MAX(o.courier)      AS courier,
               MAX(a.sku)          AS amz_sku,
               MAX(a.amzprice)     AS amz_price
          FROM orderstatus o
          LEFT JOIN amzfeed a ON a.code = o.shopifysku
         WHERE o.ordernum = $1 AND o.ordertype = $2 AND ${notDiscarded('o')}
         GROUP BY o.shopifysku
         ORDER BY o.shopifysku
      `, [num, CUSTOMER_ORDERTYPE]);

      if (result.rows.length === 0) return { code: 'NOT_FOUND' };
      const rows = result.rows.filter((r) => r.fba);
      if (rows.length === 0) return { code: 'NOT_FBA' };
      const missing = rows.filter((r) => !cell(r.amz_sku)).map((r) => r.code);
      if (missing.length) return { code: 'NO_AMAZON_SKU', missing };

      // The "file made" mark — see the header. FBA lines only, and only where not already stamped, so a re-download keeps the time of
      // the first file. `updated` gets the legacy text stamp like every other write to this table.
      const stamped = await client.query(
        `UPDATE orderstatus
            SET orderdate = ${LEGACY_STAMP}, updated = ${LEGACY_STAMP}
          WHERE ordernum = $1 AND ordertype = $2 AND COALESCE(amz, 0) > 0 AND COALESCE(orderdate, '') = ''`,
        [num, CUSTOMER_ORDERTYPE]
      );

      return { code: 'SUCCESS', rows, stamped: stamped.rowCount || 0 };
    });

    if (outcome.code === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'No customer order lines found for that order' });
    }
    if (outcome.code === 'NOT_FBA') {
      return res.json({ return_code: 'NOT_FBA', message: 'This order has no lines set to come from FBA' });
    }
    if (outcome.code === 'NO_AMAZON_SKU') {
      return res.json({ return_code: 'NO_AMAZON_SKU', message: `Not on Amazon (no amzfeed row): ${outcome.missing.join(', ')}` });
    }

    const body = outcome.rows.map((r) => [
      num, num, isoStamp(r.created), r.amz_sku, Number(r.units) || 1, r.code, '', '', r.amz_price, ORDER_COMMENT,
      deliverySla(r.courier), r.name, r.address1, r.address2, r.county, r.city, r.country,
      r.city, r.postcode, r.phone, r.email, 'Ship', '',
    ].map(cell).join('\t'));

    const content = [HEADER.join('\t'), ...body].join('\r\n') + '\r\n';

    return res.json({
      return_code: 'SUCCESS',
      ordernum: num,
      filename: `AMZ-Order-${num}.txt`,
      lines: outcome.rows.length,
      stamped: outcome.stamped,
      content,
    });
  } catch (err) {
    logger.error('[order-status-customer-fba-file] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to build the Amazon order file' });
  }
});

module.exports = router;
