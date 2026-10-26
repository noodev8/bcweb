/*
=======================================================================================================================================
Util: onShelf
=======================================================================================================================================
Purpose: ON SHELF — when the OLDEST pair we still hold of a size (code) arrived. Read by GET /analytics-slow-sizes and
         GET /analytics-style-sizes (Back Office -> Slow Sizes). Owner, 2026-10-15: a column "saying how long its been on the shelf".

         Dated the unit ledger's way (utils/unitAge.js): oldest sells first, so the pairs held are the code's NEWEST Goods In
         arrivals; walk them newest -> oldest until every held pair is matched, and the last one reached dates the oldest pair.

BEFORE THE LOG = 31 DEC 2024. A held pair that can't be matched to a logged arrival came in before Goods In began logging. It is dated
         LOG_FLOOR (owner, same day: "just pick a date 31/12/2024 then everything rolls as standard instead of putting text in"), so
         every size has a day count. It is a floor, not a fact: such a pair may have been here much longer. A size that SOLD before
         2025 can therefore show more days since its last sale than on shelf — that is this floor, not an error.

         ...UNLESS THE STYLE IS NEWER. The floor is never earlier than the style's skusummary.created_at: a pair can't have arrived
         before its style existed. Stock put away without Goods In (73220-24, created 8 Oct 2026, showed 653 days on Slow Sizes)
         is dated from the style's creation instead.

IDLE SINCE (owner, 2026-10-15: "We are penalising sizes that have no stock" ... "this screen is about clearing losers"). Slow Sizes
         asks how long the stock we hold NOW has sat without a sale, so its clock starts at the LATER of the last sale and the oldest
         held pair's arrival. A size that last sold in Apr 25 and was restocked in Sep 26 has sat since Sep 26 — the months it was
         sold out are not its fault. This reverses, for this case only, the 2026-10-10 "deliveries ignored" rule.
         The LOG_FLOOR is not an arrival, so it never moves the clock past a real last sale (a size that sold in 2024 and still holds
         pre-log pairs stays dated from that sale). The style-creation floor is a real bound and counts.

LAST NET SALE (owner, 2026-10-26: "Net" — Slow Sizes and Process's Clearance card use the same numbers). A sale that came back is
         not a sale: on each channel, walking newest -> oldest, a return (qty < 0) cancels the next sale(s) before it, unit for unit;
         the newest sale left uncancelled is that channel's last net sale, and the size's is the newest across channels (sold
         anywhere = good). sales.returnsaleid can't be used to pair them — Amazon returns never carry it and many Shopify ones don't.
         A return with no earlier sale on its channel (sold before the log) just cancels nothing.

CLEARANCE (owner, 2026-10-26: "Something that hasnt been sold for 9 months is a proper loser"). A held size whose idle clock started on
         or before today minus CLEARANCE_MONTHS calendar months. Months, not days, so Slow Sizes' top box and Process's Clearance
         card are the one test (utils/slowSizes.js).

         READ-ONLY.
=======================================================================================================================================
Exports:
  LOG_FLOOR                                     '2024-12-31'
  oldestHeldArrival(held: Map<code, units>) -> Map<code, 'YYYY-MM-DD'>   // every code with units > 0
  idleSince(lastSale, onShelf) -> { since: 'YYYY-MM-DD', from: 'sale' | 'arrival' } | null   // null = none held
  lastNetSales(codes: string[]) -> Map<code, 'YYYY-MM-DD'>      // codes with no net sale ever are absent
  CLEARANCE_MONTHS                              9
  clearanceCutoff(today: 'YYYY-MM-DD') -> 'YYYY-MM-DD'          // idle since <= this = clearance
=======================================================================================================================================
*/

const { query } = require('../database');

const LOG_FLOOR = '2024-12-31';

async function oldestHeldArrival(held) {
  const codes = [...held.entries()].filter(([, u]) => u > 0).map(([c]) => c);
  const out = new Map();
  if (codes.length === 0) return out;

  // Newest first within a code — the FIFO order.
  const r = await query(
    `SELECT code, to_char(arrival_date, 'YYYY-MM-DD') AS d, GREATEST(quantity_added, 1)::int AS q
     FROM incoming_stock WHERE code = ANY($1::text[]) AND arrival_date IS NOT NULL
     ORDER BY code, arrival_date DESC, id DESC`,
    [codes]
  );
  const arrivals = new Map();
  for (const a of r.rows) {
    if (!arrivals.has(a.code)) arrivals.set(a.code, []);
    arrivals.get(a.code).push(a);
  }

  // Each code's style creation date (London day), for the floor. Only rows newer than LOG_FLOOR matter.
  const c = await query(
    `SELECT m.code, to_char(s.created_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS d
     FROM skumap m JOIN skusummary s ON s.groupid = m.groupid
     WHERE m.code = ANY($1::text[]) AND s.created_at > $2::date`,
    [codes, LOG_FLOOR]
  );
  const created = new Map(c.rows.map((x) => [x.code, x.d]));

  for (const code of codes) {
    let left = held.get(code);
    let since = created.get(code) || LOG_FLOOR;   // pairs left over after the logged arrivals predate the log (or the style)
    for (const a of arrivals.get(code) || []) {
      left -= a.q;
      if (left <= 0) { since = a.d; break; }
    }
    out.set(code, since);
  }
  return out;
}

// Where a size's idle clock starts (see IDLE SINCE). Both args 'YYYY-MM-DD' or null; onShelf null = none held — nothing sitting, so no
// clock at all (owner, 2026-10-15: "Not sure we need to show a number for out of stock"). Same-format date strings compare as text.
function idleSince(lastSale, onShelf) {
  if (!onShelf) return null;
  if (!lastSale) return { since: onShelf, from: 'arrival' };
  if (onShelf !== LOG_FLOOR && onShelf > lastSale) return { since: onShelf, from: 'arrival' };
  return { since: lastSale, from: 'sale' };
}

// See LAST NET SALE. Newest first within a code and channel; id breaks a same-day tie (a return is booked after its sale).
async function lastNetSales(codes) {
  const out = new Map();
  if (codes.length === 0) return out;
  const r = await query(
    `SELECT code, channel, to_char(solddate, 'YYYY-MM-DD') AS d, qty
       FROM sales WHERE code = ANY($1::text[]) AND qty <> 0 AND solddate IS NOT NULL
      ORDER BY code, channel, solddate DESC, id DESC`,
    [codes]
  );
  let key = null, cancel = 0, done = false;
  for (const x of r.rows) {
    const k = `${x.code}|${x.channel}`;
    if (k !== key) { key = k; cancel = 0; done = false; }
    if (done) continue;
    if (x.qty < 0) { cancel += -x.qty; continue; }
    if (cancel >= x.qty) { cancel -= x.qty; continue; }
    done = true;   // a unit of this sale stayed sold
    const prev = out.get(x.code);
    if (!prev || x.d > prev) out.set(x.code, x.d);
  }
  return out;
}

const CLEARANCE_MONTHS = 9;
// Calendar months back, clamped to the month's last day (30 Nov - 9 months = 28 Feb). UTC, so BST never shifts it.
function clearanceCutoff(today) {
  const [y, m, d] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - CLEARANCE_MONTHS, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

module.exports = { LOG_FLOOR, oldestHeldArrival, idleSince, lastNetSales, CLEARANCE_MONTHS, clearanceCutoff };
