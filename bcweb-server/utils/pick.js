/*
=======================================================================================================================================
Module: utils/pick.js
=======================================================================================================================================
Purpose: Shared vocabulary for the Pick module — the two list filters, the qty magic numbers, and which actions each mode is allowed
         to perform. Both routes (GET /pick-list, POST /pick-action) import from here so a row can never be listed under one
         definition and written under another.

THE WHOLE MODULE IS ONE COLUMN. Legacy PowerBuilder's pick button (of_pickunpick) took an integer parm and wrote it straight into
`localstock.qty`. That is the entire data model:

    0   picked      the unit is off the shelf, in the packing area
    1   waiting     on the shelf, reserved, nobody has been for it (the resting state phase E leaves behind)
   -1   not_found   somebody walked to the shelf and it wasn't there
   -2   restock     somebody walked to the shelf and it needs putting back / re-stocking

Every value except 1 is <= 0, which is what removes the unit from sellable stock — CLAUDE.md defines sellable as
`ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0`. So -1 and -2 are not just labels; they genuinely take the unit out of play.
Nothing downstream distinguishes them (see the header of routes/pick-list.js) — they are a message to a human on this screen.

MODES ARE A SAFETY BOUNDARY, NOT A VIEW. The two lists are different KINDS of row and take different writes:

  shopify   ordernum <> '#FREE' AND deleted = 0     a unit reserved against a customer order. Actioned by writing qty.
  amazon    allocated = 'amz' AND location <> 'C3-Amazon'
                                                    a '#FREE' unit flagged for FBA, still on a normal shelf. Actioned by moving it
                                                    to the C3-Amazon shelf or by handing it back to the free pool. NEVER by qty —
                                                    zeroing a '#FREE' row makes it sellable-invisible AND orderSync phase F then
                                                    deletes it outright (`DELETE FROM localstock WHERE qty = 0 AND ordernum='#FREE'`),
                                                    i.e. the stock silently ceases to exist. That is why the mode gate exists.

  DIVERGENCE FROM LEGACY, APPROVED (owner, 2026-08-30). PowerBuilder's Amazon branch ignored its parm entirely: Pick, Not Found and
  Re-Stock all did the same thing, `allocated = 'unallocated'`. And the branch that moves a row to the C3-Amazon shelf sat in the
  SHOPIFY half of the function behind `qty = 0 AND allocated = 'amz'` — unreachable, because amz rows are '#FREE' and so never pass
  the Shopify filter. The result was that the Amazon list had no button for the job it exists to do. Here the two intents are two
  named actions instead: `to_amazon` and `unallocate`.

  `to_amazon` leaves `allocated` alone at 'amz'. It does not need to set it — orderSync phase F re-flags anything on that shelf
  anyway (`UPDATE localstock SET allocated='amz' WHERE location='C3-Amazon' AND allocated='unallocated'`) — and the row drops off
  this list the moment its location changes, which is the confirmation the operator wants.

NO HIDDEN TOGGLE. The legacy did `IF ai_qty = 0 AND li_currentqty = 0 THEN ai_qty = 1`, so pressing Pick on an already-picked row
silently unpicked it. That is defensible for one button labelled "Pick / Unpick" and a trap on a screen that has an explicit Unpick.
Dropped (owner, 2026-08-30): four actions, each of which writes exactly what it says.
=======================================================================================================================================
*/

const PICK_MODES = ['shopify', 'amazon'];

// qty value -> the word the client renders. Keyed by the number so there is one place the magic numbers are spelled out.
const QTY_STATES = { 0: 'picked', 1: 'waiting', '-1': 'not_found', '-2': 'restock' };

/*
 * qtyState(qty) -> string
 *
 * Anything above 1 reads as `waiting` too: a multi-unit shelf row is stock nobody has been for, and only the '#FREE' rows this module
 * doesn't action are normally above 1 anyway. An unrecognised negative degrades to `not_found` rather than to a blank chip — the
 * operator should see "something is wrong with this unit", which is true of any negative qty however it got there.
 */
function qtyState(qty) {
  const n = Number(qty);
  if (n > 1) return 'waiting';
  return QTY_STATES[n] || (n < 0 ? 'not_found' : 'waiting');
}

// The qty each Shopify-mode action writes. The keys are the action names the client sends; there is no other route from a client
// string to a number, so an unknown action can only ever be rejected, never guessed at.
const SHOPIFY_ACTIONS = { pick: 0, unpick: 1, not_found: -1, restock: -2 };

// Amazon-mode actions don't write qty at all — see the header. Listed here so the route can validate against one source.
const AMAZON_ACTIONS = ['to_amazon', 'unallocate'];

// The shelf every FBA-bound unit is gathered onto. Also hard-coded in orderSync phase F, which is the other half of this pair.
const AMAZON_SHELF = 'C3-Amazon';

/*
 * modeFilter(mode, alias) -> SQL predicate
 *
 * The two list definitions, as one string each, used by BOTH routes: pick-list to SELECT and pick-action to re-check that every id it
 * was handed really is a row of the mode the client claims. That second use is the point of putting them here — an action can only
 * touch rows the same mode would have listed, so a stale tab or a hand-built payload can't reach across.
 *
 * No parameters are interpolated: `mode` is validated against PICK_MODES before it ever reaches here and `alias` is a caller-supplied
 * constant, so there is nothing user-supplied in the returned string.
 */
function modeFilter(mode, alias = 'ls') {
  if (mode === 'amazon') {
    return `${alias}.allocated = 'amz' AND ${alias}.location <> '${AMAZON_SHELF}' AND COALESCE(${alias}.deleted, 0) = 0`;
  }
  // Shopify. The legacy wrote `deleted = 0` rather than a COALESCE; the column is nullable, so a NULL row would silently drop off the
  // pick list and never get picked. COALESCE'd here to match how the rest of the codebase reads it (CLAUDE.md).
  return `${alias}.ordernum <> '#FREE' AND COALESCE(${alias}.deleted, 0) = 0`;
}

module.exports = { PICK_MODES, QTY_STATES, qtyState, SHOPIFY_ACTIONS, AMAZON_ACTIONS, AMAZON_SHELF, modeFilter };
