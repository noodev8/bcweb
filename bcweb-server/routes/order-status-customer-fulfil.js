/*
=======================================================================================================================================
API Route: order_status_customer_fulfil
=======================================================================================================================================
Method: POST
Purpose: Marks PACKED customer orders fulfilled on Shopify, with tracking, and sends the customer Shopify's shipping email
         (docs/fulfil-plan.md — the owner's decisions are there, don't re-ask them).

TWO WAYS IN (owner, 2026-10-20 — "split it from manifest, own button, and give each order its own fulfil button so when testing can do
one at a time"):
  { "ordernum": "BC19343" }   one order, from its Fulfil button in the order box — the testing path
  {}                          every packed order on the list, from the Fulfil button in the title row

Manifest is a separate button for now (routes/order-status-customer-manifest.js); the plan's one-press chain comes later.

WHAT IS FULFILLED — every order we have as packed, nothing else (owner, 2026-10-19). An order qualifies when EVERY line reads `packed`
by utils/customerOrders.js → rowState:
  Royal Mail  batch = '2' → tracking number from Click & Drop (findByReference(ordernum).trackingNumber). No Click & Drop order or no
              number → skipped, with the reason. Pack only ('0') has no label → skipped.
  FBA         amz > 0 with the MCF file made (orderdate stamped) → fulfilled with the Amazon courier, no tracking number (owner: "fba
              orders - mark as fulfilled with amz courier"). FBA orders are always single-line, so an order is one kind or the other.
A partly packed order is skipped. Shopify customer orders only (ordertype 1, channel SHOPIFY).

ALREADY DONE IS NOT AN ERROR. An order Shopify has already fulfilled (PowerBuilder still fulfils in parallel), or with no open
fulfillment order left, comes back `already` and nothing is sent — so pressing again is safe. One order failing never stops the rest.

TIME. Each order is ~3 calls. The client waits 120s; no new order is started after BUDGET_MS, and the ones not reached come back
`skipped` ("not reached — press Fulfil again").

NO DB WRITES. Shopify is the record; the next Update orders sees the order FULFILLED and archives it (orderSync phase C).

IRREVERSIBLE: it emails a real customer. The client asks for a confirm before calling.
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC19343" } | {}

Success Response:
{ "return_code": "SUCCESS",
  "results": [ { "ordernum": "BC19343", "outcome": "fulfilled" | "already" | "skipped" | "failed",
                 "reason": null | "No tracking number on Click & Drop", "kind": "royalmail" | "fba", "tracking": "MX822421214GB" | null } ] }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NOT_FOUND" · "SHOPIFY_NOT_CONFIGURED" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { CUSTOMER_ORDERTYPE, notDiscarded, rowState } = require('../utils/customerOrders');
const clickDrop = require('../utils/clickDrop');
const shopifyFulfil = require('../utils/shopifyFulfil');
const logger = require('../utils/logger');

router.use(verifyToken);

const BUDGET_MS = 90000;   // no order is started after this; one order's three calls fit in the remaining 30s of the client's 120s

// The "why didn't it fulfil?" trail: every step and every outcome, per order. ERROR level on purpose — production runs LOG_LEVEL=error,
// which would silence info, and this is the only record of what was sent to a real customer. It's pressed a few times a day, so the
// volume is small. Read it with `pm2 logs` and grep `[fulfil]`.
const trail = (msg) => logger.error(`[fulfil] ${msg}`);

// One order: work out its tracking, check Shopify, fulfil. Never throws — every outcome is a result row (and a trail line).
async function fulfilOne(ordernum, lines) {
  const out = (outcome, reason, extra = {}) => {
    const r = { ordernum, outcome, reason, kind: null, tracking: null, ...extra };
    trail(`${ordernum} -> ${outcome.toUpperCase()}${reason ? `: ${reason}` : ''} (kind=${r.kind ?? '-'} tracking=${r.tracking ?? '-'})`);
    return r;
  };
  let step = 'checking lines';
  try {
    trail(`${ordernum} start: ${lines.length} line(s) — ${lines.map((l) =>
      `[state=${rowState(l)} batch='${l.batch}' courier='${l.courier ?? ''}' amz=${l.amz} orderdate='${l.orderdate ?? ''}']`).join(' ')}`);
    if (!lines.every((l) => rowState(l) === 'packed')) return out('skipped', 'Not every line is packed');

    // An FBA order is ALWAYS sent by Amazon — Amazon courier, never Royal Mail, whatever else is on the row (owner, 2026-10-20).
    const fba = lines.some((l) => Number(l.amz) > 0);
    let trackingInfo;
    let tracking = null;
    if (fba) {
      trackingInfo = shopifyFulfil.FBA_TRACKING;
    } else {
      if (String(lines[0].courier ?? '').trim() === '0') return out('skipped', 'Pack only — no label, no tracking');
      step = 'Click & Drop lookup';
      const cd = await clickDrop.findByReference(ordernum);
      if (!cd) return out('skipped', 'No Click & Drop label for this order', { kind: 'royalmail' });
      tracking = cd.trackingNumber || cd.packages?.find((p) => p.trackingNumber)?.trackingNumber || null;
      trail(`${ordernum} Click & Drop: id=${cd.orderIdentifier ?? '?'} status=${cd.status ?? '?'} trackingNumber=${cd.trackingNumber ?? '-'} packages=${JSON.stringify(cd.packages ?? null)}`);
      if (!tracking) return out('skipped', 'No tracking number on Click & Drop yet', { kind: 'royalmail' });
      trackingInfo = shopifyFulfil.royalMailTracking(tracking);
    }
    const kind = fba ? 'fba' : 'royalmail';

    step = 'Shopify order lookup';
    const order = await shopifyFulfil.findOrder(ordernum);
    if (!order) return out('failed', 'Not found on Shopify', { kind, tracking });
    trail(`${ordernum} Shopify: ${order.id} status=${order.fulfillmentStatus} cancelled=${order.cancelled} fulfillmentOrders=${JSON.stringify(order.fulfillmentOrders)}`);
    if (order.cancelled) return out('skipped', 'Cancelled on Shopify', { kind, tracking });
    if (!order.openFulfillmentOrderIds.length) {
      return order.fulfillmentStatus === 'FULFILLED'
        ? out('already', 'Already fulfilled on Shopify', { kind, tracking })
        : out('skipped', `Nothing open to fulfill on Shopify (${order.fulfillmentStatus})`, { kind, tracking });
    }

    step = 'Shopify fulfillmentCreate';
    trail(`${ordernum} sending fulfillmentCreate: fulfillmentOrders=${JSON.stringify(order.openFulfillmentOrderIds)} trackingInfo=${JSON.stringify(trackingInfo)}`);
    const f = await shopifyFulfil.fulfil(order.openFulfillmentOrderIds, trackingInfo);
    trail(`${ordernum} Shopify fulfillment ${f.id} ${f.status} trackingInfo=${JSON.stringify(f.trackingInfo)}`);
    return out('fulfilled', null, { kind, tracking });
  } catch (err) {
    // Everything we know about the failure: where it was, the coded reason, and Click & Drop's HTTP status/body when it was them.
    const cdErr = err instanceof clickDrop.ClickDropError;
    trail(`${ordernum} ERROR during ${step}: code=${err.code ?? '-'}${cdErr ? ` clickdrop_status=${err.status} clickdrop_body=${JSON.stringify(err.body ?? null).slice(0, 500)}` : ''} — ${err.message}`);
    if (!err.code && !cdErr) logger.error(err.stack);   // an unexpected throw (a bug, not a refusal) — keep where it came from
    return out('failed', (cdErr ? 'Click & Drop: ' : '') + err.message);
  }
}

router.post('/', async (req, res) => {
  const startedAt = Date.now();
  const one = String(req.body?.ordernum || '').trim().toUpperCase();

  trail(`pressed by ${req.user.display_name}: ${one ? `one order ${one}` : 'whole list'}`);

  if (!shopifyFulfil.isConfigured()) {
    trail('stopped: SHOPIFY_FULFIL_CLIENT_ID / _SECRET (or the shop) not set in .env');
    return res.json({
      return_code: 'SHOPIFY_NOT_CONFIGURED',
      message: 'Fulfill needs SHOPIFY_FULFIL_CLIENT_ID and SHOPIFY_FULFIL_CLIENT_SECRET in bcweb-server/.env (the "bcweb fulfil" Dev Dashboard app)',
    });
  }

  try {
    // The columns rowState() reads. No localstock join: packed doesn't need the pick counts.
    const { rows } = await query(
      `SELECT o.ordernum, o.courier, o.orderdate, COALESCE(o.batch, '') AS batch,
              COALESCE(o.localstock, 0) AS localstock, COALESCE(o.amz, 0) AS amz, COALESCE(o.ukd, 0) AS ukd,
              COALESCE(o.othersupplier, 0) AS othersupplier, COALESCE(o.customerwaiting, 0) AS customerwaiting
         FROM orderstatus o
        WHERE o.ordertype = $1 AND UPPER(COALESCE(o.channel, '')) = 'SHOPIFY' AND ${notDiscarded('o')}
          AND ($2 = '' OR o.ordernum = $2)
        ORDER BY o.ordernum`,
      [CUSTOMER_ORDERTYPE, one]
    );
    if (one && !rows.length) {
      trail(`stopped: ${one} isn't a live Shopify customer order on the list (ordertype ${CUSTOMER_ORDERTYPE}, channel SHOPIFY, not discarded)`);
      return res.json({ return_code: 'NOT_FOUND', message: `${one} isn't a Shopify customer order on the list` });
    }

    const orders = new Map();
    for (const r of rows) {
      if (!orders.has(r.ordernum)) orders.set(r.ordernum, []);
      orders.get(r.ordernum).push(r);
    }

    // List-wide: only orders that are wholly packed are candidates — the rest of the list isn't reported, it just isn't ready.
    // One order: always reported, so its button says why if it can't go.
    const candidates = one
      ? [...orders]
      : [...orders].filter(([, lines]) => lines.every((l) => rowState(l) === 'packed'));
    trail(`${orders.size} order(s) on the list, ${candidates.length} to try: ${candidates.map(([o]) => o).join(', ') || '(none)'}`);

    const results = [];
    for (const [ordernum, lines] of candidates) {
      if (Date.now() - startedAt > BUDGET_MS) {
        trail(`${ordernum} -> SKIPPED: not reached, ${Math.round((Date.now() - startedAt) / 1000)}s used`);
        results.push({ ordernum, outcome: 'skipped', reason: 'Not reached in time — press Fulfill again', kind: null, tracking: null });
        continue;
      }
      results.push(await fulfilOne(ordernum, lines));
    }

    const n = (o) => results.filter((r) => r.outcome === o).length;
    trail(`done by ${req.user.display_name}${one ? ` (${one})` : ''} in ${Math.round((Date.now() - startedAt) / 1000)}s: ${n('fulfilled')} fulfilled, ${n('already')} already, ${n('skipped')} skipped, ${n('failed')} failed`);
    return res.json({ return_code: 'SUCCESS', results });
  } catch (err) {
    trail(`run failed: ${err.message}`);
    logger.error(err.stack);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to fulfill' });
  }
});

module.exports = router;
