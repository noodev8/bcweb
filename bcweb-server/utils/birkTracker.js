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

  3. GOODS IN TICKING THE BOOK OFF (`markArrivedFromGoodsIn` / `unmarkArrivedFromGoodsIn`). When the Goods In screen's "Birk Tracker"
     toggle is on, a Birkenstock pair booked onto a shelf also counts one pair arrived here, so the shoe is not scanned twice on two
     screens. It lives here rather than in goods-in-book.js because it is a rule about this book, and the Birk Tracker's own scan
     route is the other half of the same question. WHICH LINE (owner, 2026-09-17): the one invoiced LONGEST AGO first — a pair
     Birkenstock billed three weeks ago is far likelier to be in the box than one billed yesterday — then lines not yet invoiced,
     oldest order first (goods routinely land before the invoice is keyed). Only lines still short (`arrived < requested`) are
     candidates, the same outstanding test as routes/birk-tracker-scan.js. Unlike that route it NEVER ASKS: at the Goods In bench
     there is no one to pick from a list, and "oldest invoice first" is the owner's answer to the ambiguity.
     The dates are legacy display strings (`invoicedate` dd.MM.yyyy, `placedate` dd/MM/yyyy) and are ORDERED AS REARRANGED TEXT
     (yyyymmdd), never cast — a to_date on one junk value would throw and take the pair's tracker tick down with it.
     These run inside the Goods In transaction behind a SAVEPOINT (see the callers): a tracker problem must come back as a message on
     the Goods In screen, never as a shoe that could not be put on a shelf.
=======================================================================================================================================
*/

const { writeBcLog } = require('./bclog');

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

// A legacy dd.MM.yyyy / dd/MM/yyyy string as sortable yyyymmdd text, or NULL when it is not that shape. See header point 3.
const sortableDate = (col) =>
  `CASE WHEN btrim(COALESCE(${col}, '')) ~ '^\\d{2}[./]\\d{2}[./]\\d{4}$'
        THEN substr(btrim(${col}), 7, 4) || substr(btrim(${col}), 4, 2) || substr(btrim(${col}), 1, 2) END`;

// Tick one pair arrived for a unit Goods In has just booked. `code` is the resolved skumap code; `eans` are the barcodes the pair is
// known by (the raw scan and skumap's EAN, trailing 'B' already stripped) — a tracker line is matched on either, because 15 lines
// share a code with skumap but carry a different EAN, and some are only reachable by EAN. `isBirk` decides whether finding nothing is
// worth telling the operator about (a Birkenstock pair missing from the book) or simply means this was some other brand's shoe.
//
// Returns null (nothing to say), or { marked: true, ordernum, code, requested, invoiced, arrived, invoicenum }, or
// { marked: false, reason, message }. Throws only on a database error, which the caller catches at its savepoint.
async function markArrivedFromGoodsIn(client, { code, eans, isBirk, who }) {
  const barcodes = [...new Set((eans || []).map((e) => String(e || '').trim()).filter(Boolean))];
  const match = `(btrim(code) = $1 OR (btrim(COALESCE(ean, '')) <> '' AND btrim(ean) = ANY($2::text[])))`;

  const pick = await client.query(
    `SELECT ordernum, code FROM birktracker
      WHERE ${match} AND COALESCE(arrived, 0) < COALESCE(requested, 0)
      ORDER BY CASE WHEN COALESCE(invoiced, 0) > COALESCE(arrived, 0) THEN 0 ELSE 1 END,
               ${sortableDate('invoicedate')} ASC NULLS LAST,
               ${sortableDate('placedate')} ASC NULLS LAST,
               ordernum ASC, code ASC
      LIMIT 1
      FOR UPDATE`,
    [code, barcodes]
  );

  if (pick.rowCount === 0) {
    // Nothing open. Tell "already all here" apart from "not in the book at all" — the first is a surplus pair or a double scan, the
    // second a missing order line — and say nothing at all for a shoe that is not a Birkenstock and was never going to be here.
    const any = await client.query(`SELECT 1 FROM birktracker WHERE ${match} LIMIT 1`, [code, barcodes]);
    if (any.rowCount > 0) {
      return { marked: false, reason: 'ALL_ARRIVED', message: `Every Birk Tracker line for ${code} is already fully arrived` };
    }
    if (!isBirk) return null;
    return { marked: false, reason: 'NOT_ON_TRACKER', message: `${code} is not on the Birk Tracker` };
  }

  const out = await client.query(
    `UPDATE birktracker SET arrived = COALESCE(arrived, 0) + 1
      WHERE ordernum = $1 AND code = $2
      RETURNING ordernum, code, requested, invoiced, arrived, invoicenum`,
    [pick.rows[0].ordernum, pick.rows[0].code]
  );
  const r = out.rows[0];
  const line = {
    marked: true,
    ordernum: (r.ordernum || '').trim(),
    code: (r.code || '').trim(),
    requested: Number(r.requested) || 0,
    invoiced: Number(r.invoiced) || 0,
    arrived: Number(r.arrived) || 0,
    invoicenum: (r.invoicenum || '').trim() || null,
  };

  await writeBcLog(client, {
    who,
    section: 'Birk Tracker',
    log: `Goods In marked ${line.code} arrived on order ${line.ordernum} — arrived ${line.arrived} of ${line.requested}`,
  });
  return line;
}

// The undo of the above, for /goods-in-cancel. Addressed by the exact line the booking ticked (the client holds it), never re-resolved
// — the book may have moved on since and "the oldest invoice" could now be a different line. Guarded on arrived > 0 so a line someone
// has since zeroed on the Birk Tracker screen cannot go negative.
async function unmarkArrivedFromGoodsIn(client, { ordernum, code, who }) {
  const out = await client.query(
    `UPDATE birktracker SET arrived = arrived - 1
      WHERE ordernum = $1 AND code = $2 AND COALESCE(arrived, 0) > 0
      RETURNING arrived, requested`,
    [ordernum, code]
  );
  if (out.rowCount === 0) {
    return { undone: false, message: `Could not take ${code} back off Birk Tracker order ${ordernum} — check it on the tracker` };
  }
  await writeBcLog(client, {
    who,
    section: 'Birk Tracker',
    log: `Goods In undo took ${code} back off order ${ordernum} — arrived ${out.rows[0].arrived} of ${out.rows[0].requested}`,
  });
  return { undone: true };
}

module.exports = {
  ARRIVED_SQL, isComplete, BOOK_COLUMNS, BOOK_COLUMNS_SQL, markArrivedFromGoodsIn, unmarkArrivedFromGoodsIn,
};
