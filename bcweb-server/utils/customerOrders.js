/*
=======================================================================================================================================
Module: utils/customerOrders.js
=======================================================================================================================================
Purpose: Shared predicates and state derivation for the CUSTOMER ORDERS stage of the Order Status module — `orderstatus` rows with
         ordertype = 1, i.e. Shopify customer orders being fulfilled, as opposed to supplier orders we are placing (ordertype 2/3,
         which utils/orderStatus.js owns).

  !! DO NOT REUSE utils/orderStatus.js HERE, AND DO NOT REUSE THIS THERE. !!

  The two modules read the SAME COLUMN to mean DIFFERENT THINGS, and nothing in the schema records which meaning applies:

    ordertype 2/3  (utils/orderStatus.js)   orderdate <> ''  ==  "bought from the supplier"    — stamped by POST /order-status-place
    ordertype 1    (this file)              orderdate <> ''  ==  "allocated off the shelf"     — stamped by orderSync.js phase E,
                                                                                                 which sets `orderdate = created`

  So on this screen the "Order Date" column is simultaneously the customer's Shopify order timestamp AND the "phase E has allocated
  this line" flag. Crossing the two files would silently mislabel every row on one screen or the other. One file per meaning is the
  guard.

STATE — phase E (utils/orderSync.js, mirrored in C:\scripts\orders\update_orders.py) writes exactly one of four sourcing flags per
line, so they are effectively an enum spread across four integer columns. Legacy PowerBuilder derived "out of stock" as all four being
zero (of_refreshdisplaydb.txt: li_ukd = 0 AND li_othersupplier = 0 AND li_localstock = 0 AND li_amz = 0); rowState() below is that
same derivation plus the two flags that sit on top of it.

  no_stock   all four sourcing flags 0            nothing anywhere — phase E swept it and found nothing. The urgent one.
  waiting    customerwaiting = 1                  known unfulfillable, customer has been told. The legacy yellow row.
  sourcing   ukd > 0 OR othersupplier > 0         flagged to a supplier
  fba        amz > 0                              coming from Amazon FBA
  pending    localstock > 0                       ALLOCATED against a shelf row, awaiting pick — see the warning below
  parked     orderdate ~ 'do not order'           phase E skips it (see CANDIDATE_SKIP below)

  PRECEDENCE within rowState(), when a row satisfies more than one test: parked first (the 'Do Not Order' string overrides
  everything — phase E won't touch the line at all), then no_stock, then waiting. no_stock outranks waiting deliberately: "waiting"
  is an acknowledged problem, "no stock" is one nobody has looked at yet, and the screen should surface the unnoticed one.

  NOT TO BE CONFUSED WITH the order-level roll-up (worstCustomerState in src/lib/orderStatusUi.ts), which answers a DIFFERENT
  question — "which line's state should colour the whole order" — and deliberately ranks `parked` LAST. A line taken deliberately out
  of play must not mask a sibling line that nobody has dealt with. This module used to export its own roll-up helper with the
  rowState precedence baked in; it was unused, it contradicted the client's, and it was removed rather than left as a trap.

  !! pending DOES NOT MEAN PICKED, AND THIS SCREEN CANNOT KNOW WHETHER SOMETHING HAS BEEN PICKED. !!

  `localstock > 0` means phase E found a free unit on a shelf and reserved it against this order line. Nobody has walked to the
  shelf. Three facts make that unambiguous:
    - `pickedqty` is 0 on ALL 3,177 archived customer rows and every live one. It is REDUNDANT LEGACY (owner, confirmed): picking is
      tracked through `localstock` now, not through this column. Nothing writes it, and there is no "has been picked" signal anywhere
      in `orderstatus`. It is still written as 0 by the FBA route only because PowerBuilder is live in parallel.
    - 3,065 of those 3,177 (96%) ended their life at localstock = 1. It is the ordinary resting state of a customer order line, not
      a milestone reached by a few.
    - This screen only ever shows UNFULFILLED Shopify orders. The instant one is genuinely picked and posted it leaves Shopify's
      unfulfilled list, and orderSync phase C archives it off this screen. A picked order is not here to be labelled.

  The state has been named twice, and both earlier names were wrong in the same direction — they claimed progress the data doesn't
  record. `picked` read as "done, ready to pack". `in_stock` was true but described the STOCK when the column describes the ORDER
  LINE. `pending` (owner's word) is what the line actually is: everything needed is reserved, and it is waiting on us.

PARKED is display-only in bcweb: the action that sets it was dropped from this module (owner's call), but the string is still honoured
by phase E's candidate filter and BOTH PowerBuilder and the cron are still live and can still write it. So we render the state without
being able to create it. Do not "tidy up" the parked branch on the grounds that nothing here writes it.
=======================================================================================================================================
*/

// Customer orders only. Everything in this module is scoped by this, so a stray query can't reach a supplier order.
const CUSTOMER_ORDERTYPE = 1;

// The legacy "discard this line" marker. orderSync.js phase F deletes these outright, so they are noise on a work screen.
function notDiscarded(alias = 'o') { return `COALESCE(${alias}.batch, '') <> '-1'`; }

// The magic string phase E tests with `LOWER(orderdate) NOT LIKE '%do not order%'`. Matched the same loose way here so the screen
// agrees with the sync about which lines it is skipping — an exact-match test would disagree on any row with stray whitespace.
function parked(alias = 'o') { return `LOWER(COALESCE(${alias}.orderdate, '')) LIKE '%do not order%'`; }

/*
 * rowState(row) -> 'parked' | 'no_stock' | 'waiting' | 'sourcing' | 'fba' | 'pending'
 *
 * Takes a row already selected with the flag columns. Kept in JS rather than a SQL CASE so the list route and any future consumer
 * can't derive it two different ways, and so the priority order is readable in one place.
 */
function rowState(row) {
  const local = Number(row.localstock) || 0;
  const amz = Number(row.amz) || 0;
  const ukd = Number(row.ukd) || 0;
  const other = Number(row.othersupplier) || 0;

  if (String(row.orderdate || '').toLowerCase().includes('do not order')) return 'parked';
  // The legacy li_outofstock derivation, unchanged.
  if (local === 0 && amz === 0 && ukd === 0 && other === 0) return 'no_stock';
  if (Number(row.customerwaiting) === 1) return 'waiting';
  if (ukd > 0 || other > 0) return 'sourcing';
  if (amz > 0) return 'fba';
  return 'pending';   // localstock > 0: reserved on a shelf, awaiting pick — NOT picked; see the warning in the header
}

/*
 * COURIERS — the codes update_orders.py:531 writes (`courier = str(4 if shipping_cost == 5.95 else 5)`) plus pack-only, which is
 * only ever set by hand.
 *
 * Only these three appear in 3,177 archived customer rows: '5' Royal Mail 48 (2,811), '4' Royal Mail 24 (356), '0' pack only (20).
 * The legacy screen also offered '2' DHL and '3' DPD; neither has ever been used, and both were dropped from this module (owner's
 * call). Codes stay STRINGS — the column is character varying and '0' is a real, meaningful value that would be lost to a falsy test.
 */
const COURIERS = [
  { code: '0', label: 'Pack only' },
  { code: '4', label: 'Royal Mail 24' },
  { code: '5', label: 'Royal Mail 48' },
];
const COURIER_CODES = COURIERS.map((c) => c.code);

module.exports = {
  CUSTOMER_ORDERTYPE, notDiscarded, parked, rowState, COURIERS, COURIER_CODES,
};
