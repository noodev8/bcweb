/*
=======================================================================================================================================
Module: utils/birkTracker.js
=======================================================================================================================================
Purpose: The two facts about the Birkenstock order book that more than one route has to agree on, stated once here so they cannot
         drift apart. Both used to be duplicated by hand, with a warning comment in each copy asking whoever changed one to remember
         the other — this file is that warning made structural.

  1. THE GREEN ROW (`ARRIVED_SQL` / `isComplete`). A line is finished when requested > 0 AND invoiced = requested AND arrived =
     requested — ALL THREE NUMBERS AGREE (owner, 2026-09-14). Not "arrived >= requested", which is what it was first built as. The
     three numbers are three separate promises and the line is only done when none of them is left open:
       invoiced < requested   Birkenstock has not yet billed the rest, so the rest is still owed even if everything billed landed.
       invoiced > requested   they have billed for more than we ordered — money to argue about, and never "done".
       arrived  < invoiced    billed and not here: in transit.
       arrived  > requested   more turned up than was asked for.
     It matters that this is ONE rule because routes/birk-tracker-lines.js paints a row green with it and
     routes/birk-tracker-clear-arrived.js archives exactly the rows it painted. If those two ever disagreed, the button would take
     something other than what the operator was looking at — which is also what the count guard on that route is defending against
     from the other direction. The SQL and the JS forms are the same test written twice for two callers; keep them identical.
     (The web screen's `stateOf` in components/BirkTrackerBook.tsx is a third copy, and cannot import this one — it recomputes state
     live from unsaved typing, before anything reaches the server. Its header carries the same note.)

  2. THE BOOK'S COLUMNS (`BOOK_COLUMNS`). All 15 legacy columns of `birktracker`, in table order, used to move a row into
     `birktracker_archive` and back out again. Two of them — `justarrived` and `colouralt` — are read by nothing in this platform,
     which is precisely why they are listed: an archive that quietly dropped them would hand back a DIFFERENT row from the one it
     took, and the legacy PowerBuilder screen is still out there reading both. The archive table is created with
     `LIKE birktracker` (migrations/20260916_birktracker_archive.sql), so the two shapes match by construction and this list is the
     column ORDER the copy is written in, not a second definition of the table.
=======================================================================================================================================
*/

// The green row as a SQL predicate. Unqualified column names — callers put it in a WHERE against one table at a time.
const ARRIVED_SQL = 'requested > 0 AND invoiced = requested AND arrived = requested';

// The same test in JS, for rows already read. NULL/undefined counts mean 0 (the columns are nullable even though the screens only
// ever write numbers), so coerce before comparing rather than letting a NULL quietly fail every test it is in.
function isComplete(requested, invoiced, arrived) {
  const req = Number(requested) || 0;
  const inv = Number(invoiced) || 0;
  const arr = Number(arrived) || 0;
  return req > 0 && inv === req && arr === req;
}

// Every legacy column of `birktracker`, in table order. See the header for why the unused two are here.
const BOOK_COLUMNS = [
  'code', 'ordernum', 'placedate', 'bksize', 'requested', 'invoiced', 'arrived',
  'invoicedate', 'invoicenum', 'justarrived', 'rrp', 'cost', 'colouralt', 'due', 'ean',
];

// The column list as it goes into SQL. A constant built from the array above so the INSERT and the SELECT of a copy can never be
// given different lists — the one mistake that would silently shuffle a row's values into the wrong columns.
const BOOK_COLUMNS_SQL = BOOK_COLUMNS.join(', ');

module.exports = { ARRIVED_SQL, isComplete, BOOK_COLUMNS, BOOK_COLUMNS_SQL };
