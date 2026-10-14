/*
=======================================================================================================================================
API Route: order_status_customer_manifest
=======================================================================================================================================
Method: POST
Purpose: The "Fulfill" button on Customer Orders, step one only (docs/fulfil-plan.md): manifest EVERYTHING Click & Drop has waiting —
         bcweb's labels and PowerBuilder's alike (owner, 2026-10-14) — and return the manifest PDF(s) for the browser to save to Downloads.
         The Shopify fulfil step is not built yet.

ASYNCHRONOUS IN CLICK & DROP: POST /manifests only starts the work and hands back ids; the PDF appears on GET /manifests/{id} once
documentStatus is Completed. This route waits for that, polling for up to WAIT_MS, so the normal press is one request in, PDF out. If
Royal Mail is slower than that, the unfinished manifests come back as `pending` with their ids, and the client calls again with
`manifestIds` to collect them — WITHOUT starting another manifest. (Pressing again with no ids is harmless too: anything already
manifested is no longer waiting, so it comes back NOTHING_TO_MANIFEST — but the earlier manifest's PDF would only be reachable through
the Click & Drop website.)

NO DB WRITES. A manifest changes Click & Drop only; nothing in orderstatus records it.

MANIFEST_NO_ID: Click & Drop accepted the manifest (it IS done) but its reply carried no id this route could read, so there's no PDF to
collect here — the message says so, includes the raw reply, and points at the Click & Drop website. The first live manifest
(2026-10-14) hit exactly this and was wrongly reported as "nothing to manifest"; utils/clickDrop.js → createManifests has the detail.

IRREVERSIBLE: a manifested order can no longer be cancelled in Click & Drop. The client asks for a confirm before calling.
=======================================================================================================================================
Request Payload:
{}                                              start a manifest of everything that's ready
{ "manifestIds": ["<uuid>", ...] }              collect manifests started earlier that were still pending

Success Response:
{ "return_code": "SUCCESS",
  "manifests": [ { "id": "<uuid>", "status": "Completed", "orders": ["BC19314", ...], "pdf": "<base64>" | null,
                   "pending": false, "failed": false, "errorReference": null, "readError": null } ] }
  readError: Click & Drop couldn't be read for that manifest (after retries) — it comes back pending, to collect again.
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NOTHING_TO_MANIFEST" · "MANIFEST_NO_ID" · "CLICKDROP_ERROR" · "UNAUTHORIZED" · "SERVER_ERROR"
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
    let ids = given;
    if (!given.length) {
      const started = await clickDrop.createManifests();
      // Always logged: the reply's shape is what broke the first live manifest (see createManifests).
      logger.info(`[order-status-customer-manifest] POST /manifests by ${req.user.display_name} -> ${started.reply || 'NO_ELIGIBLE_ORDERS'}`);
      if (started.nothing) {
        return res.json({ return_code: 'NOTHING_TO_MANIFEST', message: 'Nothing on Click & Drop is waiting to be manifested' });
      }
      if (!started.ids.length) {
        // Click & Drop ACCEPTED — the manifest happened — but gave no id to collect the PDF with. Say so; never "nothing".
        return res.json({
          return_code: 'MANIFEST_NO_ID',
          message: `Manifested on Click & Drop, but it didn't say which manifest — download the PDF from the Click & Drop website (Manifests). Click & Drop replied ${started.reply}`,
        });
      }
      ids = started.ids;
    }

    // Poll every manifest until all are finished or the wait runs out.
    const latest = new Map();
    const deadline = Date.now() + WAIT_MS;
    // Once the manifest has STARTED its ids must reach the client whatever happens next — a fetch failure here used to throw them
    // away (SERVER_ERROR, 2026-10-14) and leave the PDF reachable only on the website. So a manifest we can't read (getManifest has
    // already retried) stops being polled and comes back pending, with the reason; "Collect manifest" then tries it again.
    const unreadable = new Map();
    for (;;) {
      for (const id of ids) {
        if (unreadable.has(id) || (latest.has(id) && finished(latest.get(id)))) continue;
        try {
          latest.set(id, await clickDrop.getManifest(id));
        } catch (err) {
          logger.error(`[order-status-customer-manifest] reading ${id}:`, err.message);
          unreadable.set(id, err.message);
        }
      }
      if (ids.every((id) => unreadable.has(id) || finished(latest.get(id))) || Date.now() >= deadline) break;
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
        readError: unreadable.get(id) || null,
      };
    });
    for (const m of manifests) {
      logger.info(`[order-status-customer-manifest] ${m.id} ${m.status}${m.pending ? ' (pending)' : ''} — ${m.orders.length} orders${m.readError ? ` — couldn't read: ${m.readError}` : ''}`);
    }
    return res.json({ return_code: 'SUCCESS', manifests });
  } catch (err) {
    if (err instanceof clickDrop.ClickDropError) {
      logger.error('[order-status-customer-manifest] Click & Drop:', err.message);
      // Connection lost on the POST itself: Click & Drop may have manifested anyway, and we'd have no id to collect the PDF with.
      if (err.status === 0 && err.message.includes('POST /manifests')) {
        return res.json({
          return_code: 'CLICKDROP_ERROR',
          message: 'Lost the connection to Click & Drop while manifesting — it may have gone through. Check Manifests on the Click & Drop website for the PDF.',
        });
      }
      return res.json({ return_code: 'CLICKDROP_ERROR', message: `Click & Drop: ${err.message}` });
    }
    logger.error('[order-status-customer-manifest] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to manifest' });
  }
});

module.exports = router;
