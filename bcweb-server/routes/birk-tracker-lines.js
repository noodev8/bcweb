/*
=======================================================================================================================================
API Route: birk_tracker_lines
=======================================================================================================================================
Method: GET
Purpose: Birk Tracker module — the whole order book, one row per ordered SKU. This is the read behind /birk-tracker, the port of the
         legacy PowerBuilder "Birk Tracker" screen: what we asked Birkenstock for, what they have invoiced, and what has physically
         arrived, with the invoice number and date that did it. READ ONLY — no writes in this phase.

NAME CLASH, ON PURPOSE — READ THIS BEFORE RENAMING ANYTHING. There is an unrelated `/birk-tracker` (+ `/birk-tracker-update`) already
mounted: the Analytics daily availability snapshot (Full / Styles / Full%), which lives at /analytics/birk-tracker on the web. This
route is the ORDER BOOK and has nothing to do with it beyond the brand and the word. They do not collide at the router — Express mounts
match on a path-segment boundary, so `/birk-tracker` never swallows `/birk-tracker-lines` — but a human reading server.js will trip
over it. The owner's name for THIS module is "Birk Tracker" (it is what the legacy screen is called and what the table is called); if
one of the two is ever renamed, the analytics one is the one that should move, being a view inside Reports rather than a module.

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

`complete` is the only thing computed here, and it is the green row on the legacy screen: requested > 0 AND arrived >= requested, i.e.
the line is fully in the building. Invoiced is NOT part of it — a line can be invoiced and still be sitting on a lorry, and the gap
between those two facts is the whole point of the screen. It is computed server-side so the rule is stated once, where the two numbers
come from, rather than re-derived by every caller that renders a row.

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
    // Sort: ordernum then code. Code carries the size as its suffix and sizes are two digits (CLAUDE.md: size = RIGHT(code,2)), so a
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
      const arrived = int(r.arrived);
      return {
        ordernum: text(r.ordernum),
        code: text(r.code),
        placed: text(r.placedate),
        bksize: text(r.bksize),
        requested,
        invoiced: int(r.invoiced),
        arrived,
        invoice_date: text(r.invoicedate),
        invoice_num: text(r.invoicenum),
        due: text(r.due),
        ean: text(r.ean),
        // safeNumeric already returned NULL for junk; Number() here only turns pg's numeric-as-string into a number.
        cost: r.cost == null ? null : Number(r.cost),
        rrp: r.rrp == null ? null : Number(r.rrp),
        // The green row. See the header for why `invoiced` is deliberately not part of this test.
        complete: requested > 0 && arrived >= requested,
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
