/*
=======================================================================================================================================
Module: src/lib/goodsInWrite.ts  —  the ONE part of Goods In that is not yet real.
=======================================================================================================================================
Everything the screen READS is live: /goods-in-expected is the real ON ORDER stage of `orderstatus`, and /goods-in-lookup resolves a
scan against the real `skumap`. What does not exist yet is the WRITE that books a unit in, so this module stands in for it and is the
only file that has to change when the route lands.

Until then a run is client-side: the screen identifies each scan and says where the shoe goes, and the counts come off the real
delivery note, but nothing reaches the database and a refresh loses the run. THE SCREEN SAYS SO, plainly and permanently — an operator
who thinks stock has been booked in and walks away is worse off than one who never opened the screen.

WHAT THE WRITE HAS TO DO, from the legacy PowerBuilder source in goodsin/ (of_save, of_cancel-item). All of it inside ONE
withTransaction, per CLAUDE.md:

  POST /goods-in-book   { code, shelf }   ->  { incomingId, localstockId }
    1. Claim an order line: the FIRST `orderstatus` row with shopifysku = code AND arrived = 0 AND COALESCE(orderdate,'') <> ''
       (CLAUDE.md landmine — orderdate is varchar and an un-placed row is '' or NULL). ordertype 3 (Amazon) is tried before 2 (local),
       matching of_scan2. The legacy customer-order branch (ordertype 1 -> "Pick") is commented out at source and stays out.
       Set arrived = 1, arriveddate = today. No line found is NOT an error — the unit is free stock, see step 2.
    2. Insert ONE `localstock` row — ordernum '#FREE', qty 1, deleted 0, pickorder 100, and:
         claimed an Amazon line -> location 'C3-Amazon', allocated 'amz'
         anything else          -> location = shelf, allocated 'unallocated'
       brand/supplier off `skusummary` via the code's groupid. `updated` is the legacy TEXT stamp 'YYYYMMDD HH24:MI:SS'.
    3. Insert `incoming_stock` (code, groupid, arrival_date, quantity_added 1, created_at, target, workstation); return its id.
    4. Log to `bclog`, section 'Goods In'.

  POST /goods-in-cancel { incomingId, localstockId } -> DELETE both rows, set the claimed order line back to arrived = 0, log it.

TWO LEGACY CONTROLS ARE DELIBERATELY ABSENT, the same call /pick made about its label machinery:
  - "Amazon Direct is ON" pushed each Amazon-bound scan into the FBA check-in/label screen. bcweb has no check-in screen yet; when one
    lands, the toggle belongs on the Goods In screen next to the shelf picker.
  - "Incoming Report" is a report. Reports live behind /analytics.
The typed command "AMAZON" (legacy: jump to the label screen) goes with them. "RESETERROR" stays — it still has something to reset.
=======================================================================================================================================
*/

/** The Amazon staging bay. An Amazon-claimed unit goes here and NOT to the operator's chosen shelf — see utils/pick.js server-side. */
export const AMAZON_SHELF = 'C3-Amazon';

/** Flips to true when /goods-in-book exists. The screen reads it to decide whether to promise the operator anything. */
export const WRITE_AVAILABLE = false;

/** Handles the real route will return, so a cancel can find the rows it wrote. Null while the write is a stand-in. */
export interface Booking { incomingId: number | null; localstockId: string | null }

/** Book one unit onto a shelf. Stand-in: resolves without touching the database. */
export async function bookIn(_args: { code: string; shelf: string }): Promise<Booking> {
  return { incomingId: null, localstockId: null };
}

/** Undo one booked-in unit. Stand-in: resolves without touching the database. */
export async function cancelBooking(_booking: Booking): Promise<void> {
  return;
}

/** Normalise what the gun typed: case, whitespace, and the trailing 'B' the barcode column carries (CLAUDE.md). */
export function normaliseScan(raw: string): string {
  const v = raw.trim().toUpperCase();
  return /^\d+B$/.test(v) ? v.slice(0, -1) : v;
}
