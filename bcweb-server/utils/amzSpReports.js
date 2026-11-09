/*
=======================================================================================================================================
Util: utils/amzSpReports.js   — fetch an Amazon report through the SP-API Reports API (2021-06-30)
=======================================================================================================================================
Purpose: Ask Amazon for a report, wait while it is prepared, download it, and hand back its TEXT — the same tab-separated file a
         person would download from Seller Central, so the existing parsers (utils/amzReports.js) read it unchanged.

         createReport -> poll getReport until DONE (IN_QUEUE / IN_PROGRESS in between) -> getReportDocument -> download the pre-signed
         URL (no auth header on that one) -> gunzip if Amazon says GZIP -> decode with the charset Amazon names (Cp1252 / UTF-8).

Preparing a report takes minutes, which is why reports run NIGHTLY (scripts/amz-inventory-nightly.js) and never inside Update Orders.

Report types used (2026-11-09 — each the file Update Amazon used to take as an upload, same columns, read by the same parser):
  GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA     "Manage FBA Inventory"        nightly        (~40 s; ~1 request per 30 min allowed)
  GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA   FBA customer returns          nightly, 30 days back (~30 s)
  GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA         Fee Preview                   every 28 days (~30 s)
=======================================================================================================================================
*/

const zlib = require('zlib');
const sp = require('./amzSpApi');

const POLL_MS = 20 * 1000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function decode(buf, contentType) {
  const m = /charset=([^;]+)/i.exec(contentType || '');
  let cs = (m ? m[1] : 'utf-8').trim().toLowerCase();
  if (cs === 'cp1252') cs = 'windows-1252';
  try {
    return new TextDecoder(cs).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/**
 * @returns {Promise<{ text: string, reportId: string, waitedSeconds: number }>}
 * Throws when Amazon reports CANCELLED / FATAL, or the wait passes timeoutMs.
 */
async function fetchReport(reportType, { timeoutMs = DEFAULT_TIMEOUT_MS, onWait, dataStartTime } = {}) {
  const started = Date.now();
  // dataStartTime: the window's start for reports that take one (the returns report — 30 days back each night).
  const created = await sp.spPost('/reports/2021-06-30/reports', {
    reportType, marketplaceIds: [sp.marketplaceId()], ...(dataStartTime ? { dataStartTime } : {}),
  });
  const reportId = created && created.reportId;
  if (!reportId) throw new Error(`Amazon did not return a report id for ${reportType}`);

  let report;
  for (;;) {
    await sp.sleep(POLL_MS);
    report = await sp.spGet(`/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`);
    const status = report && report.processingStatus;
    if (onWait) onWait(status, Math.round((Date.now() - started) / 1000));
    if (status === 'DONE') break;
    if (status === 'CANCELLED' || status === 'FATAL') {
      // A FATAL report usually carries a small document saying why (e.g. requested again too soon — this report type is limited to
      // about one request every 30 minutes; seen 2026-11-09). Read it for the message; never let that read hide the real error.
      let why = '';
      if (report.reportDocumentId) {
        try {
          const d = await sp.spGet(`/reports/2021-06-30/documents/${encodeURIComponent(report.reportDocumentId)}`);
          const r = await fetch(d.url);
          let b = Buffer.from(await r.arrayBuffer());
          if (d.compressionAlgorithm === 'GZIP') b = zlib.gunzipSync(b);
          why = ` — ${b.toString('utf8').slice(0, 300).replace(/\s+/g, ' ')}`;
        } catch { /* no reason available */ }
      }
      throw new Error(`Amazon report ${reportType} ended ${status} (report ${reportId})${why}`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Amazon report ${reportType} not ready after ${Math.round(timeoutMs / 60000)} minutes (report ${reportId}, ${status})`);
    }
  }

  const doc = await sp.spGet(`/reports/2021-06-30/documents/${encodeURIComponent(report.reportDocumentId)}`);
  const res = await fetch(doc.url);
  if (!res.ok) throw new Error(`Report download failed (${res.status})`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (doc.compressionAlgorithm === 'GZIP') buf = zlib.gunzipSync(buf);
  const text = decode(buf, res.headers.get('content-type'));
  return { text, reportId, waitedSeconds: Math.round((Date.now() - started) / 1000) };
}

module.exports = { fetchReport };
