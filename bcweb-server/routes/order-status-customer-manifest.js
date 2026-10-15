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

const WAIT_MS = 60000;   // how long to keep checking for the PDF before handing back `pending`
const POLL_MS = 2000;
// THE HARD LIMIT (2026-10-15). The client waits 120s. WAIT_MS alone didn't keep the route inside that: it's only checked between
// polls, a single Click & Drop call can take its full 30s timeout, and getManifest retries a dropped connection up to 3 times — so a
// hanging Click & Drop could run the route to ~2.5 minutes, the client would give up with "Network error", and the manifest's ids
// (it HAD started) would be lost. Now no Click & Drop read is started unless it can finish, at its 30s timeout, before HARD_MS; one
// that can't is left pending, and the client offers Collect manifest. 110s leaves 10s of slack for the reply to reach the browser.
const HARD_MS = 110000;
const CALL_MS = 30000;   // utils/clickDrop.js TIMEOUT_MS — the longest one call can take

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Finished = the manifest failed, or it completed AND its document is ready (the PDF is what the packer needs).
const finished = (m) => m.manifestStatus === 'Failed' || (m.manifestStatus === 'Completed' && m.documentStatus === 'Completed');

router.post('/', async (req, res) => {
  const startedAt = Date.now();
  const hardDeadline = startedAt + HARD_MS;
  const given = Array.isArray(req.body?.manifestIds)
    ? req.body.manifestIds.map((s) => String(s || '').trim()).filter(Boolean)
    : [];

  try {
    let ids = given;
    if (!given.length) {
      const started = await clickDrop.createManifests();
      // Always logged: the reply's shape is what broke the first live manifest (see createManifests).
      logger.info(`[order-status-customer-manifest] POST /manifests by ${req.user.display_name} -> ${(started.reply || 'NO_ELIGIBLE_ORDERS').slice(0, 200)}`);
      // THE PDF CAME BACK WITH THE MANIFEST (this account's real reply, 2026-10-15: HTTP 201 { manifestNumber, documentPdf }). Done —
      // nothing to poll; hand it straight to the screen, which saves it to Downloads.
      if (started.inline) {
        const { number, pdf, orders } = started.inline;
        logger.info(`[order-status-customer-manifest] manifest ${number ?? '(no number)'} — PDF returned inline, ${orders.length} orders listed`);
        return res.json({
          return_code: 'SUCCESS',
          manifests: [{ id: number || 'manifest', number, status: 'Completed', orders, pdf, pending: false, failed: false, errorReference: null, readError: null }],
        });
      }
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
    const deadline = Math.min(Date.now() + WAIT_MS, hardDeadline - CALL_MS);
    // Once the manifest has STARTED its ids must reach the client whatever happens next — a fetch failure here used to throw them
    // away (SERVER_ERROR, 2026-10-14) and leave the PDF reachable only on the website. So a manifest we can't read (getManifest has
    // already retried) stops being polled and comes back pending, with the reason; "Collect manifest" then tries it again.
    const unreadable = new Map();
    for (;;) {
      for (const id of ids) {
        if (unreadable.has(id) || (latest.has(id) && finished(latest.get(id)))) continue;
        // Not enough time left for this read to finish before the hard limit: leave it as it stands (pending) for Collect manifest.
        if (Date.now() + CALL_MS > hardDeadline) continue;
        try {
          latest.set(id, await clickDrop.getManifest(id, hardDeadline));
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
