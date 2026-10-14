/*
=======================================================================================================================================
API Route: order_status_customer_manifest
=======================================================================================================================================
Method: POST
Purpose: The "Fulfill" button on Customer Orders, step one only (docs/fulfil-plan.md): manifest EVERYTHING Click & Drop has waiting —
         bcweb's labels and PowerBuilder's alike (owner, 2026-10-14) — and return the manifest PDF(s) for the browser to print.
         The Shopify fulfil step is not built yet.

ASYNCHRONOUS IN CLICK & DROP: POST /manifests only starts the work and hands back ids; the PDF appears on GET /manifests/{id} once
documentStatus is Completed. This route waits for that, polling for up to WAIT_MS, so the normal press is one request in, PDF out. If
Royal Mail is slower than that, the unfinished manifests come back as `pending` with their ids, and the client calls again with
`manifestIds` to collect them — WITHOUT starting another manifest. (Pressing again with no ids is harmless too: anything already
manifested is no longer waiting, so it comes back NOTHING_TO_MANIFEST — but the earlier manifest's PDF would only be reachable through
the Click & Drop website.)

NO DB WRITES. A manifest changes Click & Drop only; nothing in orderstatus records it.

IRREVERSIBLE: a manifested order can no longer be cancelled in Click & Drop. The client asks for a confirm before calling.
=======================================================================================================================================
Request Payload:
{}                                              start a manifest of everything that's ready
{ "manifestIds": ["<uuid>", ...] }              collect manifests started earlier that were still pending

Success Response:
{ "return_code": "SUCCESS",
  "manifests": [ { "id": "<uuid>", "status": "Completed", "orders": ["BC19314", ...], "pdf": "<base64>" | null,
                   "pending": false, "failed": false, "errorReference": null } ] }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NOTHING_TO_MANIFEST" · "CLICKDROP_ERROR" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const clickDrop = require('../utils/clickDrop');
const logger = require('../utils/logger');

router.use(verifyToken);

const WAIT_MS = 60000;   // inside the client's 90s timeout
const POLL_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Finished = the manifest failed, or it completed AND its document is ready (the PDF is what the packer needs).
const finished = (m) => m.manifestStatus === 'Failed' || (m.manifestStatus === 'Completed' && m.documentStatus === 'Completed');

router.post('/', async (req, res) => {
  const given = Array.isArray(req.body?.manifestIds)
    ? req.body.manifestIds.map((s) => String(s || '').trim()).filter(Boolean)
    : [];

  try {
    const ids = given.length ? given : await clickDrop.createManifests();
    if (!ids.length) {
      return res.json({ return_code: 'NOTHING_TO_MANIFEST', message: 'Nothing on Click & Drop is waiting to be manifested' });
    }
    if (!given.length) logger.info(`[order-status-customer-manifest] started ${ids.join(', ')} by ${req.user.display_name}`);

    // Poll every manifest until all are finished or the wait runs out.
    const latest = new Map();
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      for (const id of ids) {
        if (latest.has(id) && finished(latest.get(id))) continue;
        latest.set(id, await clickDrop.getManifest(id));
      }
      if (ids.every((id) => finished(latest.get(id))) || Date.now() >= deadline) break;
      await sleep(POLL_MS);
    }

    const manifests = ids.map((id) => {
      const m = latest.get(id) || {};
      return {
        id,
        status: m.manifestStatus || 'Unknown',
        orders: (m.orders || []).map((o) => o.orderReference).filter(Boolean),
        pdf: m.documentStatus === 'Completed' && m.pdf ? m.pdf : null,
        pending: !finished(m),
        failed: m.manifestStatus === 'Failed',
        errorReference: m.errorReference || null,
      };
    });
    for (const m of manifests) {
      logger.info(`[order-status-customer-manifest] ${m.id} ${m.status}${m.pending ? ' (pending)' : ''} — ${m.orders.length} orders`);
    }
    return res.json({ return_code: 'SUCCESS', manifests });
  } catch (err) {
    if (err instanceof clickDrop.ClickDropError) {
      logger.error('[order-status-customer-manifest] Click & Drop:', err.message);
      return res.json({ return_code: 'CLICKDROP_ERROR', message: `Click & Drop: ${err.message}` });
    }
    logger.error('[order-status-customer-manifest] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to manifest' });
  }
});

module.exports = router;
