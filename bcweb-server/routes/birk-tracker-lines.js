/*
=======================================================================================================================================
API Route: birk_tracker_lines
=======================================================================================================================================
Method: GET
Purpose: Birk Tracker module — the whole order book, one row per ordered SKU. This is the read behind /birk-tracker, the port of the
         legacy PowerBuilder "Birk Tracker" screen: what we asked Birkenstock for, what they have invoiced, and what has physically
         arrived, with the invoice number and date that did it. READ ONLY — no writes in this phase.

THE NAME CLASH IS RESOLVED — this note is kept so the history reads straight. Until Sep 2026 an unrelated `/birk-tracker` (+
`/birk-tracker-update`) was also mounted: the Analytics daily availability snapshot (Full / Styles / Full%). The two shared nothing but
the brand and the word, and the plan recorded here was that the analytics one should move, being a view inside Reports rather than a
module. It did: it is now Birk Availability, `/birk-availability` (+ `-update`), at /analytics/birk-availability on the web. "Birk
Tracker" means the ORDER BOOK — this module — and nothing else.

THE TABLE IS LEGACY AND SHARED. `birktracker` is written today by the PowerBuilder screen — this module reads the same rows, so every
legacy landmine applies:
  - EVERY COLUMN THAT SHOULD BE A NUMBER OR A DATE IS `character varying`. cost/rrp are read through safeNumeric (CLAUDE.md: a bare
    ::numeric THROWS on the junk these columns carry).
  - DATES ARE DISPLAY STRINGS IN TWO DIFFERENT FORMATS: `placedate` is dd/MM/yyyy (our order date) and `invoicedate` is dd.MM.yyyy
    (Birkenstock's, straight off their invoice). They are passed through VERBATIM rather than parsed. That is deliberate: they are
    keyed by hand off paperwork, the two formats are the supplier's and ours, and any parse would have to guess on an ambiguous or
    half-typed value. Nothing here sorts or filters on them, so there is nothing to gain by guessing — and handing a parsed pg DATE
    back through toISOString() is the BST day-shift landmine in CLAUDE.md. When a write phase needs real date logic, parse it THERE,
    explicitly, with the format named.
  - `due` is a MONTH NAME ('MAY', 'AUG', …) or blank — the delivery window Birkenstock quoted, not a date. Text, as-is.
  - The natural key is (ordernum, code); verified unique on the live table. There is no surrogate id and no declared PK, so a future
    write must address a row by that pair.

`complete` is the only thing computed here, and it is the green row: requested > 0 AND invoiced = requested AND arrived = requested —
ALL THREE NUMBERS AGREE (owner, 2026-09-14). Not "arrived >= requested", which is what it was first built as. The stricter rule is the
right one because the three numbers are three different promises and a line is only finished when none of them is outstanding:
  invoiced < requested   Birkenstock has not yet billed the rest, so the rest is still owed even if everything billed has landed.
  invoiced > requested   they have billed for more than we ordered — money to argue about, and never "done".
  arrived  < invoiced    billed and not here: in transit.
  arrived  > requested   more turned up than was asked for.
On the live book today the two rules select exactly the same 59 lines, because `invoiced` equals `arrived` on every row. They diverge
only when the three stop agreeing — which is precisely the case the screen exists to surface, so the loose rule was hiding the very
thing it was meant to show.
  THE RULE IS SHARED WITH routes/birk-tracker-clear-arrived.js, which archives exactly the rows this flag paints green — so it now
  lives in ONE place, utils/birkTracker.js, and both import it. It used to be typed out in both files under a warning comment asking
  whoever changed one to remember the other.

NO PAGINATION, NO FILTER PARAMS. The table is season-scale (hundreds of rows — an order book, not a ledger), the screen's two filter
rails are a click each, and its Find box types letter by letter; round-tripping either would make a screen meant to feel like the
desktop app it replaces feel like a website. The whole set goes over the wire once and the client filters it. `cap` is a safety net
against that assumption quietly stopping being true, not a feature: it bounds the response and `truncated` says it happened.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  cap    optional integer >= 1 — max rows to return (default 5000, max 20000). A safety bound only; see above.

Success Response:
{
  "return_code": "SUCCESS",
  "total": 166,                       // rows in the book (before the cap)
  "truncated": false,                 // true when `cap` cut the set — the screen says so rather than lying by omission
  "ordernums": ["0001906867", ...],   // every distinct order, ascending — the left rail
  "invoices":  ["5290103741", ...],   // every distinct non-blank invoice number, ascending — the other rail
  "totals": { "requested": 318, "invoiced": 129, "arrived": 129 },  // across ALL rows, not just the returned page
  "rows": [
    { "ordernum": "0001906867", "code": "0051751-ARIZONA-35", "placed": "07/09/2026", "bksize": "225/2.5",
      "requested": 1, "invoiced": 1, "arrived": 1, "invoice_date": "25.08.2026", "invoice_num": "5290103742",
      "due": "", "ean": "", "cost": null, "rrp": null, "complete": true }
  ]  // ordernum, then code — the order the legacy grid reads in, and the order the eye needs to group by order
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { isComplete } = require('../utils/birkTracker');
const logger = require('../utils/logger');

router.use(verifyToken);

// Legacy text columns are frequently '' rather than NULL, and the difference means nothing here — both are "not filled in yet".
// Collapse them once, so the client has one emptiness to test instead of two.
function text(v) {
  return v == null ? '' : String(v).trim();
}

// The three count columns are nullable in the schema even though the screen only ever writes numbers into them. NULL means the same
// as 0 for all three (nothing asked / invoiced / arrived), so coercing is safe — unlike the stock totals on the analytics snapshot,
// where 0 and "unknown" are genuinely different facts and are kept apart.
function int(v) {
  return Number(v) || 0;
}

router.get('/', async (req, res) => {
  try {
    // Safety cap only (see header). Clamp rather than reject: an out-of-range cap is a caller bug, and failing the whole read over
    // something with an obvious sane answer would take the screen down for no gain.
    let cap = parseInt(req.query.cap, 10);
    if (!Number.isInteger(cap) || cap < 1) cap = 5000;
    if (cap > 20000) cap = 20000;

    // One trip for the rows. cost/rrp go through safeNumeric so a junk value degrades to NULL instead of 500-ing the screen.
    // Sort: ordernum then code. Code carries the size as its suffix and Birkenstock sizes are two digits (no half sizes in the Birk range), so a
    // plain text sort on code puts each style's sizes in size order for free.
    const rowsQ = query(
      `SELECT ordernum, code, placedate, bksize, requested, invoiced, arrived,
              invoicedate, invoicenum, due, ean,
              ${safeNumeric('cost')} AS cost,
              ${safeNumeric('rrp')}  AS rrp
         FROM birktracker
        ORDER BY ordernum ASC, code ASC
        LIMIT $1`,
      [cap]
    );

    // …and one for the figures that must describe the WHOLE book rather than the returned slice: the two filter rails and the footer
    // totals. Deriving them in SQL rather than off the returned rows is what keeps them honest if the cap ever bites.
    const summaryQ = query(
      `SELECT (SELECT count(*) FROM birktracker)                                AS total,
              (SELECT COALESCE(SUM(requested), 0) FROM birktracker)             AS req,
              (SELECT COALESCE(SUM(invoiced),  0) FROM birktracker)             AS inv,
              (SELECT COALESCE(SUM(arrived),   0) FROM birktracker)             AS arr,
              (SELECT COALESCE(array_agg(DISTINCT btrim(ordernum) ORDER BY btrim(ordernum)), '{}')
                 FROM birktracker WHERE btrim(COALESCE(ordernum, '')) <> '')    AS ordernums,
              (SELECT COALESCE(array_agg(DISTINCT btrim(invoicenum) ORDER BY btrim(invoicenum)), '{}')
                 FROM birktracker WHERE btrim(COALESCE(invoicenum, '')) <> '')  AS invoices`
    );

    const [rowsRes, summaryRes] = await Promise.all([rowsQ, summaryQ]);
    const s = summaryRes.rows[0] || {};
    const total = int(s.total);

    const rows = rowsRes.rows.map((r) => {
      const requested = int(r.requested);
      const invoiced = int(r.invoiced);
      const arrived = int(r.arrived);
      return {
        ordernum: text(r.ordernum),
        code: text(r.code),
        placed: text(r.placedate),
        bksize: text(r.bksize),
        requested,
        invoiced,
        arrived,
        invoice_date: text(r.invoicedate),
        invoice_num: text(r.invoicenum),
        due: text(r.due),
        ean: text(r.ean),
        // safeNumeric already returned NULL for junk; Number() here only turns pg's numeric-as-string into a number.
        cost: r.cost == null ? null : Number(r.cost),
        rrp: r.rrp == null ? null : Number(r.rrp),
        // The green row: all three numbers agree. One shared rule — see utils/birkTracker.js.
        complete: isComplete(requested, invoiced, arrived),
      };
    });

    return res.json({
      return_code: 'SUCCESS',
      total,
      truncated: rows.length < total,
      ordernums: s.ordernums || [],
      invoices: s.invoices || [],
      totals: { requested: int(s.req), invoiced: int(s.inv), arrived: int(s.arr) },
      rows,
    });
  } catch (err) {
    logger.error('[birk-tracker-lines] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Birk Tracker order book' });
  }
});

module.exports = router;
