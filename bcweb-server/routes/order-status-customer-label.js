/*
=======================================================================================================================================
API Route: order_status_customer_label
=======================================================================================================================================
Method: POST
Purpose: The Royal Mail label for a customer order, via Click & Drop (docs/clickdrop-labels-plan.md). Two uses:

  FIRST PRINT  (reprint omitted/false) — the order's last shoe has just been scanned on Customer Orders. Checks the scans cover the
               order, works out the weight, creates the Click & Drop order, returns its label PDF and marks the order PACKED.
  REPRINT      (reprint: true) — a jam or a smudge. Finds the order in Click & Drop by ordernum and returns the SAME label. Never
               creates anything, never needs scans.

NO NEW TABLE (owner, 2026-10-13). Nothing about the shipment is stored in bcweb:
  - PACKED is the status customer orders already use, `batch = '2'` (utils/customerOrders.js PACKED), plus `orderstatus.weight`,
    which is what PowerBuilder writes at pack time.
  - THE LABEL lives in Click & Drop, found by its orderReference = our ordernum (utils/clickDrop.js findByReference).

THE SCAN IS THE CHECK (owner, 2026-10-12 — there is no Print button). Scan progress lives on the screen; the scanned codes come in with
the first-print request and must cover every open unit of the order, code for code, or nothing is created. A client can't print an
order off a click.

NEVER PAY POSTAGE TWICE. Before creating, Click & Drop is asked whether an order with this reference already exists — bcweb's own
earlier attempt (the create succeeded but our commit didn't), or PowerBuilder's, which still sends orders there in parallel. If one
does, its label is fetched instead. The check-and-create runs under a per-order advisory lock so two quick scans of the same order
can't both get past the check.

The C&D call runs INSIDE the transaction, so the packed write commits only if the shipment exists. If the commit then fails, the
shipment exists and the order isn't packed; the next scan finds it by reference and reuses it — no second postage.

WEIGHT is the whole parcel (one order = one parcel). A SINGLE-PAIR order uses its stored skumap.weight (varchar, kg per variant); if it
has none the route answers WEIGHT_NEEDED. A GROUP order (more than one open unit) ALWAYS answers WEIGHT_NEEDED (owner, 2026-10-13):
the parcel is weighed, never added up from the shoes. Either way the screen asks for the whole-order weight in kg, sent back as
weightKg. It is written to every packed line's orderstatus.weight, as PowerBuilder does (BC19297: two lines, both '1.1'). An entered weight is for this label only — it is NOT written back to skumap. skumap.weight is read with its
own pattern rather than utils/sql.js safeNumeric(), because the stored values start with a bare point ('.54') and safeNumeric's
pattern needs a leading digit.

SERVICE: courier '4' -> Tracked 24, '5' -> Tracked 48, whatever the weight. Package format always 'parcel'.

REFUSED, NO LABEL: pack only ('0'), no courier, no address line 1 / town / postcode, a country other than GB (customs is a separate
job). Click & Drop requires all three address fields.

The county is left off when it's a region code ('ENG', 'SCT' — what Shopify's province_code puts there), so it doesn't print on the
label as an address line.
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC19314", "codes": ["1010551-039"], "weightKg": 1.2 }   // first print; weightKg only when asked for
{ "ordernum": "BC19314", "reprint": true }                              // reprint

Success Response:
{ "return_code": "SUCCESS", "ordernum": "BC19314", "pdf": "<base64>", "reprint": false, "existing": false,
  "trackingNumber": "MX822420837GB", "weightKg": 1.2, "service": "TPS48" }
  existing = the Click & Drop order was already there (PowerBuilder's, or an earlier attempt) and its label was reused.

WEIGHT_NEEDED: { "return_code": "WEIGHT_NEEDED", "message": "...", "missing": ["1010551-039"] }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "NOT_FOUND" · "NOTHING_TO_PACK" · "NOT_SCANNED" · "PACK_ONLY" · "NO_COURIER" · "NO_ADDRESS" ·
"NOT_GB" · "WEIGHT_NEEDED" · "INVALID_WEIGHT" · "NO_LABEL" · "CLICKDROP_ERROR" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { LEGACY_STAMP } = require('../utils/orderStatus');
const { CUSTOMER_ORDERTYPE, notDiscarded, rowState } = require('../utils/customerOrders');
const clickDrop = require('../utils/clickDrop');
const logger = require('../utils/logger');

router.use(verifyToken);

// A line that goes in this box: anything not already packed. The same set the screen lets you scan (owner, 2026-10-15: the only
// refusals are pack only, already packed, and not all scanned). 'Do Not Order' (parked) is packed — it means don't source it, nothing
// more. An FBA line is packed too if the shoe is here; one whose Amazon file has been made already reads `packed` (rowState).
const OPEN = (state) => state !== 'packed';

// A refusal the screen shows as it stands. Thrown out of the transaction so it rolls back.
class Refusal extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}

router.post('/', async (req, res) => {
  const ordernum = String(req.body?.ordernum || '').trim().toUpperCase();
  if (!ordernum) return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernum is required' });

  try {
    // --- REPRINT: Click & Drop only, no lock, no writes. -----------------------------------------------------------------------
    if (req.body?.reprint) {
      const existing = await clickDrop.findByReference(ordernum);
      if (!existing) return res.json({ return_code: 'NO_LABEL', message: `${ordernum} has no Click & Drop label to reprint` });
      const pdf = await clickDrop.getLabel(existing.orderIdentifier);
      return res.json({
        return_code: 'SUCCESS', ordernum, pdf: pdf.toString('base64'), reprint: true, existing: true,
        trackingNumber: existing.trackingNumber || null,
      });
    }

    // --- FIRST PRINT ------------------------------------------------------------------------------------------------------------
    const codes = Array.isArray(req.body?.codes) ? req.body.codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean) : [];
    const weightIn = req.body?.weightKg;

    const out = await withTransaction(async (client) => {
      // Serialises everything for this order: two scans landing together can't both find "no C&D order yet" and both create one.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`clickdrop:${ordernum}`]);

      const { rows } = await client.query(
        `SELECT o.shopifysku AS code, o.orderdate, o.batch, o.courier,
                COALESCE(o.localstock, 0) AS localstock, COALESCE(o.amz, 0) AS amz, COALESCE(o.ukd, 0) AS ukd,
                COALESCE(o.othersupplier, 0) AS othersupplier, COALESCE(o.customerwaiting, 0) AS customerwaiting,
                o.shippingname, o.company, o.address1, o.address2, o.city, o.county, o.postcode, o.country, o.phone, o.email,
                CASE WHEN btrim(sm.weight) ~ '^[0-9]*[.]?[0-9]+$' THEN btrim(sm.weight)::numeric END AS weight_kg
           FROM orderstatus o
           LEFT JOIN LATERAL (SELECT s.weight FROM skumap s WHERE s.code = o.shopifysku
                               ORDER BY COALESCE(s.deleted, 0) LIMIT 1) sm ON true
          WHERE o.ordernum = $1 AND o.ordertype = $2 AND ${notDiscarded('o')}`,
        [ordernum, CUSTOMER_ORDERTYPE]
      );
      if (rows.length === 0) throw new Refusal('NOT_FOUND', `${ordernum} isn't a customer order on the list`);

      const open = rows.filter((r) => OPEN(rowState(r)));
      if (open.length === 0) {
        throw new Refusal('NOTHING_TO_PACK', `${ordernum} has nothing left to pack — use Reprint if its label is lost`);
      }

      // The scan check: every open unit, code for code. Extra scans of a code don't matter; a short one does.
      const need = new Map();
      for (const r of open) need.set(r.code.toUpperCase(), (need.get(r.code.toUpperCase()) || 0) + 1);
      const have = new Map();
      for (const c of codes) have.set(c, (have.get(c) || 0) + 1);
      const short = [...need].filter(([c, n]) => (have.get(c) || 0) < n).map(([c]) => c);
      if (short.length) {
        throw new Refusal('NOT_SCANNED', `Not every shoe is scanned — still need ${short.join(', ')}`);
      }

      // Order-level fields: every line carries the same copy (the sync writes them per line), so the first one stands for all.
      const o = rows[0];
      const courier = String(o.courier ?? '').trim();
      if (courier === '0') throw new Refusal('PACK_ONLY', 'Pack only — no label');
      const serviceCode = clickDrop.SERVICE_CODES[courier];
      if (!serviceCode) throw new Refusal('NO_COURIER', 'Choose a courier first');
      if (!String(o.address1 || '').trim() || !String(o.city || '').trim() || !String(o.postcode || '').trim()) {
        throw new Refusal('NO_ADDRESS', 'Address line 1, town or postcode is missing on this order');
      }
      const country = String(o.country || '').trim().toUpperCase();
      if (country !== 'GB') throw new Refusal('NOT_GB', `Not a UK address (${country || 'no country'}) — no label from here`);

      // Weight: stored, or entered for this label.
      let weightKg;
      let entered = false;
      if (weightIn !== undefined && weightIn !== null && weightIn !== '') {
        weightKg = Number(weightIn);
        entered = true;
      } else if (open.length > 1) {
        // GROUP ORDER (owner, 2026-10-13): always weighed as the parcel it is, never added up from the shoes' stored weights.
        throw new Refusal('WEIGHT_NEEDED', `Group order (${open.length} pairs) — weigh the parcel and enter its weight`, { missing: [] });
      } else {
        const missing = [...new Set(open.filter((r) => r.weight_kg === null || Number(r.weight_kg) <= 0).map((r) => r.code))];
        if (missing.length) {
          throw new Refusal('WEIGHT_NEEDED', `No stored weight for ${missing.join(', ')} — enter the parcel weight`, { missing });
        }
        weightKg = open.reduce((s, r) => s + Number(r.weight_kg), 0);
      }
      if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > clickDrop.MAX_KG) {
        throw new Refusal('INVALID_WEIGHT', `Weight must be more than 0 and at most ${clickDrop.MAX_KG} kg`);
      }
      weightKg = Math.round(weightKg * 1000) / 1000;

      // Postage: reuse an existing Click & Drop order for this ordernum, else create one.
      let existing = await clickDrop.findByReference(ordernum);
      let trackingNumber = existing?.trackingNumber || null;
      let pdf;
      if (existing) {
        pdf = await clickDrop.getLabel(existing.orderIdentifier);
      } else {
        const county = String(o.county || '').trim();
        const created = await clickDrop.createOrder({
          ordernum, serviceCode, weightKg,
          name: o.shippingname, company: o.company, address1: o.address1, address2: o.address2, city: o.city,
          county: /^[A-Z]{2,3}$/.test(county) ? '' : county,
          postcode: o.postcode, phone: o.phone, email: o.email,
        });
        trackingNumber = created.trackingNumber;
        pdf = created.label || await clickDrop.getLabel(created.orderIdentifier);
      }

      // PACKED. Every line not already packed — FBA and 'Do Not Order' lines included (owner, 2026-10-15).
      const weightText = String(weightKg);
      await client.query(
        `UPDATE orderstatus o
            SET batch = '2', weight = $3, updated = ${LEGACY_STAMP}
          WHERE o.ordernum = $1 AND o.ordertype = $2 AND ${notDiscarded('o')}
            AND COALESCE(o.batch, '') <> '2'`,
        [ordernum, CUSTOMER_ORDERTYPE, weightText]
      );

      logger.info(`[order-status-customer-label] ${ordernum} ${existing ? 'reused' : 'created'} C&D label, ${weightKg} kg${entered ? ' (entered)' : ''}, ${serviceCode}, by ${req.user.display_name}`);
      return { pdf, existing: !!existing, trackingNumber, weightKg, serviceCode };
    });

    return res.json({
      return_code: 'SUCCESS', ordernum, pdf: out.pdf.toString('base64'), reprint: false, existing: out.existing,
      trackingNumber: out.trackingNumber, weightKg: out.weightKg, service: out.serviceCode,
    });
  } catch (err) {
    if (err instanceof Refusal) return res.json({ return_code: err.code, message: err.message, ...err.extra });
    if (err instanceof clickDrop.ClickDropError) {
      logger.error('[order-status-customer-label] Click & Drop:', err.message, JSON.stringify(err.body)?.slice(0, 1000));
      return res.json({ return_code: 'CLICKDROP_ERROR', message: `Click & Drop: ${err.message}` });
    }
    logger.error('[order-status-customer-label] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to make the label' });
  }
});

module.exports = router;
