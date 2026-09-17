/*
=======================================================================================================================================
API Route: birk_tracker_scan
=======================================================================================================================================
Method: POST
Purpose: Birk Tracker module — WRITE. One scan of a physical pair marks one pair arrived against the Birkenstock order book. This is
         the receiving end of the season order: a delivery is opened and each pair is beeped in.

TRACKER ONLY — IT DOES NOT TOUCH STOCK (owner, 2026-09-14). It writes `birktracker.arrived` and nothing else: no `localstock`, no
`incoming_stock`, no shelf. That is NOT an oversight and it is not the same job as Goods In, which books other suppliers' deliveries
onto shelves. Birkenstock has never been in `orderstatus` at all (checked: its supplier history is Lunar, West Midland, Strive,
Skechers, Rieker) so there is nothing here to duplicate — and the season order's question is "has the thing we bought six months ago
turned up and been billed correctly", which is answered without moving a single stock row. If Birk stock is ever to be shelved by
scan, that is goods-in-book.js's job to grow, not this route's — and it has: with its "Birk Tracker" toggle on, Goods In shelves the
pair AND ticks it arrived here (utils/birkTracker.js, header point 3), picking the oldest-invoiced line where this route would ask.

ONE SCAN = ONE PAIR. `arrived` goes up by exactly 1. No quantity field, deliberately: the gun is pointed at a physical shoe and the
count is however many times it beeps. A mistake is undone by writing the old value back through /birk-tracker-save (the client holds
it), which is why there is no decrement path here.

-- RESOLVING THE SCAN, WHICH IS THE WHOLE DIFFICULTY -------------------------------------------------------------------------------
A BARCODE DOES NOT IDENTIFY AN ORDER LINE. The same EAN sits on up to FOUR different orders in the live book, and among lines still
outstanding, 10 of 90 barcodes are ambiguous. The physical shoe cannot tell you which order it belongs to, so this route narrows by
rule and refuses to guess when the rule runs out:

  1. SCOPE. If the screen is focused on an order or an invoice, only its lines are considered. This is the normal case and it
     removes the ambiguity outright — you are unpacking a known delivery, so say which one before you start beeping.
  2. OUTSTANDING ONLY. Lines already fully arrived are dropped; a pair in your hand cannot be one that is already counted.
  3. BILLED FIRST. If more than one remains, prefer lines where `invoiced > arrived` — Birkenstock has billed for that pair, so it is
     the one physically travelling. This resolves most of what scope does not.
  4. ASK. Anything still ambiguous comes back as AMBIGUOUS with the candidates, and the operator picks one; the client then calls
     again with `ordernum` + `code` to name the line explicitly. Guessing here would silently credit the wrong order, and the two
     orders would then BOTH be wrong — one over, one under — with nothing recording which scan did it.

ALREADY_COMPLETE and NOT_FOUND are outcomes, not failures, and are worth distinguishing: the first means "this pair is real but the
book already says it is all here" (a double-scan, or a delivery of something already booked), the second means the barcode is not in
the order book at all (wrong brand, a returns box, or one of the 6 lines that carry no EAN and can only be keyed by hand).

BARCODE NORMALISATION: whitespace trimmed, and a single trailing 'B' stripped. `birktracker.ean` holds none today, but `skumap.ean`
carries that suffix by convention (CLAUDE.md) and a gun reading a shelf label rather than a shoe box would send it.
=======================================================================================================================================
Request Payload:
{
  "barcode": "4013871023883",          // string, required unless ordernum+code are given
  "scope": { "kind": "order",          // optional — 'order' | 'invoice'; narrows step 1 above
             "value": "0001927328" },
  "ordernum": "0001927328",            // optional pair — names the line explicitly, skipping resolution entirely.
  "code": "0034703-MILANO-38"          //   Used when the operator picks from an AMBIGUOUS list.
}

Success Response:
{
  "return_code": "SUCCESS",
  "line": { "ordernum": "0001927328", "code": "0034703-MILANO-38", "size": "38",
            "requested": 3, "invoiced": 3, "arrived": 3, "complete": true }
}

Ambiguous Response (normal outcome — the operator chooses):
{
  "return_code": "AMBIGUOUS",
  "message": "That barcode is on 2 open orders",
  "candidates": [ { "ordernum": "...", "code": "...", "size": "38", "requested": 3, "invoiced": 0, "arrived": 0 } ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"AMBIGUOUS"
"ALREADY_COMPLETE"
"NOT_FOUND"
"MISSING_FIELDS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

// Size is the trailing two digits of the code (CLAUDE.md) — returned so the screen can say "38" without re-parsing.
function sizeOf(code) {
  const m = /-(\d{2})$/.exec(code || '');
  return m ? m[1] : '';
}

function shape(r) {
  const requested = Number(r.requested) || 0;
  const invoiced = Number(r.invoiced) || 0;
  const arrived = Number(r.arrived) || 0;
  return {
    ordernum: (r.ordernum || '').trim(),
    code: (r.code || '').trim(),
    size: sizeOf(r.code),
    requested,
    invoiced,
    arrived,
    // Same green rule as everywhere else — see routes/birk-tracker-lines.js.
    complete: requested > 0 && invoiced === requested && arrived === requested,
  };
}

router.post('/', async (req, res) => {
  try {
    const { barcode, scope, ordernum, code } = req.body || {};

    const explicit = typeof ordernum === 'string' && ordernum.trim() !== '' && typeof code === 'string' && code.trim() !== '';
    // Strip whitespace and a single trailing 'B' (see header). Everything else is passed through as scanned.
    const scanned = typeof barcode === 'string' ? barcode.trim().replace(/B$/i, '') : '';

    if (!explicit && scanned === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Nothing was scanned' });
    }

    const result = await withTransaction(async (client) => {
      let target;

      if (explicit) {
        // The operator has already chosen — no resolution, just re-check the line is still there and still outstanding.
        const pick = await client.query(
          `SELECT ordernum, code, requested, invoiced, arrived FROM birktracker
            WHERE ordernum = $1 AND code = $2 FOR UPDATE`,
          [ordernum.trim(), code.trim()]
        );
        if (pick.rowCount === 0) return { kind: 'NOT_FOUND' };
        target = pick.rows[0];
        if ((Number(target.arrived) || 0) >= (Number(target.requested) || 0)) {
          return { kind: 'ALREADY_COMPLETE', line: shape(target) };
        }
      } else {
        // Step 1 — scope. FOR UPDATE so two people scanning the same delivery cannot both read the same arrived count and each
        // write count+1, losing a pair.
        const params = [scanned];
        let where = `btrim(ean) = $1`;
        if (scope && (scope.kind === 'order' || scope.kind === 'invoice') && typeof scope.value === 'string' && scope.value.trim()) {
          params.push(scope.value.trim());
          where += scope.kind === 'order' ? ` AND btrim(ordernum) = $2` : ` AND btrim(invoicenum) = $2`;
        }
        const found = await client.query(
          `SELECT ordernum, code, requested, invoiced, arrived FROM birktracker
            WHERE ${where} ORDER BY ordernum ASC, code ASC FOR UPDATE`,
          params
        );
        if (found.rowCount === 0) return { kind: 'NOT_FOUND' };

        // Step 2 — outstanding only.
        const open = found.rows.filter((r) => (Number(r.arrived) || 0) < (Number(r.requested) || 0));
        if (open.length === 0) return { kind: 'ALREADY_COMPLETE', line: shape(found.rows[0]) };

        if (open.length === 1) {
          target = open[0];
        } else {
          // Step 3 — billed first. Only narrows if it leaves exactly one; otherwise we ask rather than guess.
          const billed = open.filter((r) => (Number(r.invoiced) || 0) > (Number(r.arrived) || 0));
          if (billed.length === 1) target = billed[0];
          else return { kind: 'AMBIGUOUS', candidates: (billed.length > 1 ? billed : open).map(shape) };
        }
      }

      // The write: one pair, on the line we resolved to.
      const out = await client.query(
        `UPDATE birktracker SET arrived = COALESCE(arrived, 0) + 1
          WHERE ordernum = $1 AND code = $2
          RETURNING ordernum, code, requested, invoiced, arrived`,
        [target.ordernum, target.code]
      );
      const line = shape(out.rows[0]);

      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Birk Tracker',
        log: `Scanned ${line.code} in on order ${line.ordernum} — arrived ${line.arrived} of ${line.requested}`,
      });

      return { kind: 'SUCCESS', line };
    });

    if (result.kind === 'SUCCESS') return res.json({ return_code: 'SUCCESS', line: result.line });
    if (result.kind === 'AMBIGUOUS') {
      return res.json({
        return_code: 'AMBIGUOUS',
        message: `That barcode is on ${result.candidates.length} open order lines`,
        candidates: result.candidates,
      });
    }
    if (result.kind === 'ALREADY_COMPLETE') {
      return res.json({
        return_code: 'ALREADY_COMPLETE',
        message: 'Every line with that barcode is already fully arrived',
        line: result.line,
      });
    }
    return res.json({ return_code: 'NOT_FOUND', message: 'That barcode is not on this order book' });
  } catch (err) {
    logger.error('[birk-tracker-scan] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not record that scan' });
  }
});

module.exports = router;
