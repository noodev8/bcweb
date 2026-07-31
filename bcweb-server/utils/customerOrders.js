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
  packed     batch = '2'                          boxed and ready to go — see PACKED below
  picked     every held shelf row at qty = 0      off the shelf, not yet packed — see PICKED below
  pending    localstock > 0                       ALLOCATED against a shelf row, awaiting pick — see the warning below
  parked     orderdate ~ 'do not order'           phase E skips it (see CANDIDATE_SKIP below)

  PRECEDENCE within rowState(), when a row satisfies more than one test: parked first (the 'Do Not Order' string overrides
  everything — phase E won't touch the line at all), then no_stock, then waiting. no_stock outranks waiting deliberately: "waiting"
  is an acknowledged problem, "no stock" is one nobody has looked at yet, and the screen should surface the unnoticed one.

  NOT TO BE CONFUSED WITH the order-level roll-up (worstCustomerState in src/lib/orderStatusUi.ts), which answers a DIFFERENT
  question — "which line's state should colour the whole order" — and deliberately ranks `parked` LAST. A line taken deliberately out
  of play must not mask a sibling line that nobody has dealt with. This module used to export its own roll-up helper with the
  rowState precedence baked in; it was unused, it contradicted the client's, and it was removed rather than left as a trap.

  !! `orderstatus.localstock > 0` DOES NOT MEAN PICKED. THE PICK SIGNAL IS IN A DIFFERENT TABLE. !!

  `orderstatus.localstock > 0` means phase E found a free unit on a shelf and RESERVED it against this order line. Nobody has walked
  to the shelf. Two facts make that unambiguous, and both are still true:
    - `pickedqty` is 0 on ALL 3,177 archived customer rows and every live one. It is REDUNDANT LEGACY (owner, confirmed). Nothing
      writes it. There is no "has been picked" column anywhere in `orderstatus`. It is still written as 0 by the FBA route only
      because PowerBuilder is live in parallel.
    - 3,065 of those 3,177 (96%) ended their life at localstock = 1. It is the ordinary resting state of a customer order line, not
      a milestone reached by a few. The flag never comes back down.

  PICKED — where the signal actually is (verified against the live DB, 2026-07-31):

  Phase E reserves by stamping `localstock.ordernum` on a shelf row and leaving it at `qty = 1` (see orderSync.js ~line 534). When
  the unit is PHYSICALLY TAKEN off the shelf, that row goes to `qty = 0` while keeping its `ordernum` and `deleted = 0`. Confirmed on
  a real pick: of eleven live customer-order shelf rows, ten sat at qty 1 and the one just picked sat at qty 0 — and all eleven
  `orderstatus` rows still read `localstock = 1`. The orderstatus row genuinely knows nothing; the `localstock` TABLE does.

  So `rowState` needs two extra fields the flag columns can't give it — how many shelf rows are held for this line, and how many of
  those are at qty 0 — which is why order-status-customer-list.js carries a join for them. A line is `picked` only when EVERY held
  row is at qty 0; a part-picked line stays `pending`, because it still needs someone to walk to a shelf.

  !! THIN EVIDENCE, HANDLE WITH CARE. That is ONE observed pick. There is no history to widen it with: phase D deletes an order's
     shelf rows the moment phase C archives it, so a picked-and-fulfilled line leaves nothing behind. If a non-'#FREE' row can reach
     qty = 0 by some other route (an inventory adjustment, a PowerBuilder screen nobody here has read), this state will occasionally
     claim a pick that never happened. It is deliberately a DISPLAY state only — nothing branches on it, no write depends on it — so
     the blast radius of being wrong is a mislabelled row, not a mis-shipped order. Keep it that way. !!

  PACKED — the second half of the same story (verified against the live DB, 2026-07-31):

  `batch = '2'` is written when the unit is BOXED. Evidence, and it is much stronger than the pick signal's:
    - 3,098 of the 3,178 archived customer rows are batch '2'; the other 80 are '0'. Packed is the normal end of a line's life.
    - A line packed minutes before this was written went '0' -> '2' and nothing else on the row changed.
    - `batch = '1'` DOES NOT EXIST — not on a live row, not on any of the 3,178 archived ones. If you are looking for it because
      somebody remembered it that way, it isn't there.

  PICKED AND PACKED ARE NOT THE SAME STEP and both were observable at once when this was written: BC18668 was picked AND packed
  (batch '2', shelf row emptied), while BC18671 was picked and NOT packed (batch '0', shelf row emptied). That is the whole reason
  both states exist rather than one. The progression is: pending -> picked -> packed -> archived.

  BUT A LINE MAY GO STRAIGHT TO PACKED, and rowState is built for that (owner). `packed` is tested on its own, first, and never asks
  whether the line was seen as `picked` first. `picked` is an inference from a table that gets cleaned up; `packed` is a flag written
  on the row itself. The strong signal must never be gated behind the weak one.

  !! `batch` MEANS SOMETHING ELSE ON SUPPLIER ORDERS. On ordertype 2/3 it groups the lines of one purchase batch (utils/orderStatus.js
     counts on_order_batches with it). This is the SAME trap as `orderdate`, one column two meanings, and the same guard applies: one
     file per meaning, and nothing in this file may be reused there. !!

  The one batch value both meanings share is '-1', the legacy discard marker — excluded from this screen by notDiscarded() and
  deleted outright by orderSync phase F.

  Not to be confused with the archive: a packed line stays on this screen until Shopify reports the order FULFILLED, at which point
  phase C moves it to orderstatus_archive. `picked` and `packed` are exactly the window between the shelf and that fulfilment, which
  is the reason they exist — it's what the operator wants to see before the courier arrives.

  The `pending` state has been named three times and the first two were wrong in the same direction — they claimed progress the data
  didn't record. `picked` (the old name) read as done-and-packed while meaning only "reserved". `in_stock` was true but described the
  STOCK when the column describes the ORDER LINE. `pending` (owner's word) is what the line actually is: everything needed is
  reserved, and it is waiting on us. Note the name `picked` is now in use again — but for the state that genuinely means it.

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
 * rowState(row) -> 'parked' | 'no_stock' | 'waiting' | 'sourcing' | 'fba' | 'packed' | 'picked' | 'pending'
 *
 * Takes a row already selected with the flag columns and `batch`, PLUS `held_rows` / `picked_rows` from the localstock join (see the
 * PICKED note in the header — those two cannot be derived from orderstatus at all). A row selected without them simply never reaches
 * `picked`, which is the safe direction to fail: an un-joined consumer sees the earlier states, not a wrong new one.
 *
 * Kept in JS rather than a SQL CASE so the list route and any future consumer can't derive it two different ways, and so the
 * priority order is readable in one place.
 */
function rowState(row) {
  const local = Number(row.localstock) || 0;
  const amz = Number(row.amz) || 0;
  const ukd = Number(row.ukd) || 0;
  const other = Number(row.othersupplier) || 0;
  const held = Number(row.held_rows) || 0;
  const picked = Number(row.picked_rows) || 0;

  if (String(row.orderdate || '').toLowerCase().includes('do not order')) return 'parked';
  // The legacy li_outofstock derivation, unchanged.
  if (local === 0 && amz === 0 && ukd === 0 && other === 0) return 'no_stock';
  if (Number(row.customerwaiting) === 1) return 'waiting';
  if (ukd > 0 || other > 0) return 'sourcing';
  if (amz > 0) return 'fba';
  // The last three are one progression, newest step first. All sit below the exception states on purpose: `waiting` and the two
  // sourcing states are decisions someone MADE about this line, and they outrank an observation about where the goods physically are.
  //
  // PACKED IS TESTED ALONE AND FIRST. It deliberately does NOT require the pick signal as a precondition (owner): if the line is
  // boxed, the operator is satisfied, and how it got there is not this screen's business. That matters practically as well as
  // philosophically — the pick signal is the weak one (a single observed case, and the shelf row can be gone entirely by the time
  // anyone looks), so making the strong signal depend on the weak one would let a missing shelf row hide a packed order. Do not
  // "tidy" this into `if (packed && picked)`.
  if (String(row.batch || '') === '2') return 'packed';
  // `held > 0` guards the empty case — with no shelf rows at all, 0 === 0 would otherwise read as "all picked".
  if (held > 0 && picked === held) return 'picked';
  return 'pending';   // localstock > 0: reserved on a shelf, awaiting pick — NOT picked; see the header
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
