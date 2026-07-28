/*
=======================================================================================================================================
Util: amzReports
=======================================================================================================================================
Purpose: Identify and parse the four Amazon Seller Central reports behind the Update Amazon module. Pure functions — no DB, no I/O.
         Given a file's text, work out WHICH report it is from its header alone, verify the columns we depend on are present, and
         hand back typed rows plus an honest account of anything skipped.

         Replaces the legacy PowerBuilder loader (of_updateamzdatadb / of_amzsalesload), which had two failure modes worth naming
         because they are exactly what this file exists to prevent:

         1. SILENT MISSING FILE. `FileOpen` on an absent file returns -1, the read loop exits immediately, and the datastore stays
            empty. No error, no message. The buy-box and fee reports had been failing this way for a long time and nobody could
            have known. Here, a file either identifies as a known report or is rejected loudly.

         2. POSITIONAL IMPORT IN DISGUISE. The legacy code imports into a DataWindow by POSITION and then reads by DataWindow column
            name, which reads like name-based access but isn't. If Amazon inserts a column, every field after it silently shifts and
            the import keeps going with wrong values in every row. Here we resolve each column by NAME, once, against the actual
            header, so inserted/reordered columns are harmless and a REMOVED column is a hard stop.

Two header quirks in the real files that a naive name match gets wrong (both verified in the 2026-07-28 samples):
  * the orders report's last header cell is "order-item-id " — with a TRAILING SPACE.
  * the fee report's first header cell carries a UTF-8 BOM (U+FEFF), so it reads as "<BOM>sku", not "sku".
normaliseHeader() strips both. Do not remove it.

Report identification is by header content, never by filename — the operator downloads these as opaque numeric names
(118981020662.txt etc.) that carry no meaning and change every time.
=======================================================================================================================================
Exports:
  REPORTS                        the four report definitions (type, label, required + optional columns)
  identify(text)                 -> { type, label, header, extraColumns } | { type: null, reason }
  parseReport(text)              -> { type, label, rows, skipped, extraColumns, window, rowCount }
  normaliseHeader(cell)          exported for tests
=======================================================================================================================================
*/

const logger = require('./logger');

// ---------------------------------------------------------------------------------------------------------------------------------
// Report definitions
// ---------------------------------------------------------------------------------------------------------------------------------
// `required` = columns the import genuinely reads. A missing one is a hard stop (we cannot do the job correctly, and doing it
// half-correctly is what the legacy code did). `identity` = the subset that fingerprints the report; it must be distinctive enough
// to tell the four apart. Note the inventory and fee reports SHARE their first three columns (sku, fnsku, asin) — column 4 is the
// discriminator ('product-name' vs 'amazon-store'), which is why identity lists more than just the leading columns.
//
// `layout` = the FULL header as Amazon shipped it on 2026-07-28, captured from the sample files. It is not used for parsing at all —
// its only job is to make "Amazon added a column" detectable. Without it, `extraColumns` would list every column we simply don't
// read (26 of the orders report's 34), which would fire on every single upload and train the operator to ignore it. With it, a
// non-empty extraColumns means something genuinely changed and is worth a look. Update this list when Amazon changes a report.
const REPORTS = {
  ORDERS: {
    type: 'ORDERS',
    label: 'Orders',
    identity: ['amazon-order-id', 'purchase-date', 'order-status', 'sales-channel', 'order-item-id'],
    required: ['amazon-order-id', 'purchase-date', 'order-status', 'sales-channel', 'sku', 'quantity', 'item-price', 'order-item-id'],
    layout: [
      'amazon-order-id', 'merchant-order-id', 'purchase-date', 'last-updated-date', 'order-status', 'fulfillment-channel',
      'sales-channel', 'order-channel', 'url', 'ship-service-level', 'product-name', 'sku', 'asin', 'item-status', 'quantity',
      'currency', 'item-price', 'item-tax', 'shipping-price', 'shipping-tax', 'gift-wrap-price', 'gift-wrap-tax',
      'item-promotion-discount', 'ship-promotion-discount', 'ship-city', 'ship-state', 'ship-postal-code', 'ship-country',
      'promotion-ids', 'is-business-order', 'purchase-order-number', 'price-designation', 'is-iba', 'order-item-id',
    ],
  },
  INVENTORY: {
    type: 'INVENTORY',
    label: 'FBA Inventory',
    identity: ['sku', 'fnsku', 'asin', 'product-name', 'afn-fulfillable-quantity'],
    required: ['sku', 'fnsku', 'asin', 'your-price', 'afn-fulfillable-quantity', 'afn-total-quantity'],
    layout: [
      'sku', 'fnsku', 'asin', 'product-name', 'condition', 'your-price', 'mfn-listing-exists', 'mfn-fulfillable-quantity',
      'afn-listing-exists', 'afn-warehouse-quantity', 'afn-fulfillable-quantity', 'afn-unsellable-quantity',
      'afn-reserved-quantity', 'afn-total-quantity', 'per-unit-volume', 'afn-inbound-working-quantity',
      'afn-inbound-shipped-quantity', 'afn-inbound-receiving-quantity', 'afn-researching-quantity', 'afn-reserved-future-supply',
      'afn-future-supply-buyable', 'afn-fulfillable-quantity-local', 'afn-fulfillable-quantity-remote', 'afn-fc-transfer-quantity',
      'afn-onhand-buyable-quantity', 'store',
    ],
  },
  RETURNS: {
    type: 'RETURNS',
    label: 'FBA Returns',
    identity: ['return-date', 'order-id', 'sku', 'license-plate-number'],
    // `detailed-disposition` is REQUIRED, not optional: it decides whether a returned unit is a margin reversal or a whole-cost
    // write-off, and 8.5% of returns are the latter. If Amazon ever renames it we want a named hard stop, not returns that quietly
    // cost nothing again.
    required: ['return-date', 'order-id', 'sku', 'quantity', 'license-plate-number', 'detailed-disposition'],
    layout: [
      'return-date', 'order-id', 'sku', 'asin', 'fnsku', 'product-name', 'quantity', 'fulfillment-center-id',
      'detailed-disposition', 'reason', 'status', 'license-plate-number', 'customer-comments',
    ],
  },
  FEES: {
    type: 'FEES',
    label: 'FBA Fee Preview',
    identity: ['sku', 'fnsku', 'asin', 'amazon-store', 'estimated-fee-total'],
    required: ['sku', 'currency', 'expected-domestic-fulfilment-fee-per-unit'],
    layout: [
      'sku', 'fnsku', 'asin', 'amazon-store', 'product-name', 'product-group', 'brand', 'fulfilled-by', 'has-local-inventory',
      'your-price', 'sales-price', 'longest-side', 'median-side', 'shortest-side', 'length-and-girth', 'unit-of-dimension',
      'item-package-weight', 'unit-of-weight', 'product-size-weight-band', 'currency', 'estimated-fee-total',
      'estimated-referral-fee-per-unit', 'estimated-variable-closing-fee', 'estimated-order-handling-fee-per-order',
      'expected-domestic-fulfilment-fee-per-unit', 'expected-efn-fulfilment-fee-per-unit-uk', 'expected-efn-fulfilment-fee-per-unit-de',
      'expected-efn-fulfilment-fee-per-unit-fr', 'expected-efn-fulfilment-fee-per-unit-it', 'expected-efn-fulfilment-fee-per-unit-es',
      'expected-efn-fulfilment-fee-per-unit-se',
    ],
  },
};

// The fee report's fulfilment-fee column has been renamed by Amazon before ('fulfillment' vs 'fulfilment', and older reports used
// 'expected-fulfilment-fee-per-unit' with no '-domestic'). Accept any of them for that one field rather than hard-stopping on a
// cosmetic rename — the value means the same thing. Checked in order; first present wins.
const FEE_COLUMN_ALIASES = [
  'expected-domestic-fulfilment-fee-per-unit',
  'expected-domestic-fulfillment-fee-per-unit',
  'expected-fulfilment-fee-per-unit',
  'expected-fulfillment-fee-per-unit',
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Header handling
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Normalise one header cell for name matching. Strips the UTF-8 BOM (fee report, column 1), trims surrounding whitespace
 * (orders report, 'order-item-id ' — trailing space) and lower-cases. Both quirks are real and present in the live files.
 */
function normaliseHeader(cell) {
  return String(cell === undefined || cell === null ? '' : cell)
    .replace(/^\uFEFF/, '')   // UTF-8 BOM, written as an escape: a literal BOM here is invisible and gets "tidied away" by editors
    .trim()
    .toLowerCase();
}

/** Split a report into non-empty lines. Handles CRLF (all four samples are CRLF) and a missing trailing newline. */
function splitLines(text) {
  return String(text || '')
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length > 0);
}

/** Header cells of a tab-delimited report, normalised. */
function headerCells(text) {
  const lines = splitLines(text);
  if (lines.length === 0) return [];
  return lines[0].split('\t').map(normaliseHeader);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Work out which report this is, from the header alone. Returns { type: null, reason } when nothing matches, so the caller can tell
 * the operator WHY a file was rejected rather than just refusing it.
 */
function identify(text) {
  const header = headerCells(text);
  if (header.length === 0) return { type: null, reason: 'The file is empty.' };
  if (header.length === 1) {
    return { type: null, reason: 'The first line has no tab characters — this does not look like a tab-delimited Amazon report.' };
  }

  const present = new Set(header);
  for (const def of Object.values(REPORTS)) {
    if (def.identity.every((col) => present.has(col))) {
      // Columns Amazon has ADDED since the layout was captured. Not an error — Amazon adds columns and our name-based parsing is
      // immune to it — but it's the earliest visible sign of a report format change, so the preview surfaces it. Measured against
      // the full known layout, not just the columns we read, so this stays empty in normal use and means something when it isn't.
      const known = new Set([...def.layout, ...def.required, ...def.identity, ...(def.type === 'FEES' ? FEE_COLUMN_ALIASES : [])]);
      const extraColumns = header.filter((c) => c && !known.has(c));
      // Columns that have GONE since the layout was captured but that we don't actually read. Harmless, and not worth stopping for,
      // but reported for the same early-warning reason.
      const droppedColumns = def.layout.filter((c) => !present.has(c) && !def.required.includes(c));
      return { type: def.type, label: def.label, header, extraColumns, droppedColumns };
    }
  }

  // Nothing matched exactly. Before giving up with a generic "not recognised", work out whether this is OBVIOUSLY one of the four
  // with a column missing or renamed — which is the single most likely real-world failure and the one worth naming precisely.
  // A report whose full layout still overlaps heavily is far more useful reported as "this is the Returns report but
  // license-plate-number has gone" than as "unknown file".
  let best = null;
  for (const def of Object.values(REPORTS)) {
    const overlap = def.layout.filter((c) => present.has(c)).length;
    const score = overlap / def.layout.length;
    if (!best || score > best.score) best = { def, score, overlap };
  }

  if (best && best.score >= 0.5) {
    const missingIdentity = best.def.identity.filter((c) => !present.has(c));
    const missingRequired = best.def.required.filter((c) => !present.has(c));
    const named = [...new Set([...missingRequired, ...missingIdentity])];
    return {
      type: null,
      bestGuess: best.def.type,
      reason: `This looks like the ${best.def.label} report (${best.overlap} of ${best.def.layout.length} known columns present), but ${named.length > 1 ? 'these columns are' : 'this column is'} missing or renamed: ${named.join(', ')}. Amazon may have changed the report — nothing was imported.`,
    };
  }

  return {
    type: null,
    reason: `Header not recognised as any of the four Amazon reports. First columns seen: ${header.slice(0, 6).join(', ')}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------------------------------------------------------------

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** Number or null. Amazon writes '' for "not applicable" and '--' for "no value" (seen in the fee report's handling-fee column). */
function number(v) {
  const s = text(v);
  if (s === '' || s === '--') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Integer or null, via number() so '' / '--' behave the same. */
function integer(v) {
  const n = number(v);
  return n === null ? null : Math.trunc(n);
}

/**
 * Amazon timestamps are ISO-8601 with an offset ('2026-07-14T09:31:02+01:00'). We want the LOCAL (Europe/London) calendar date the
 * order was placed, which is what the offset in the string already describes — so take the date part textually rather than parsing
 * to a JS Date and formatting, which would re-interpret it in the server's zone and shift the day for anything near midnight.
 * This is the same class of bug CLAUDE.md warns about for pg DATE -> toISOString().
 */
function localDatePart(v) {
  const s = text(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 'HH:MM' from the same timestamp, for sales.ordertime (a varchar in the legacy schema). */
function localTimePart(v) {
  const s = text(v);
  const m = s.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Parse a report end to end.
 *
 * Returns { ok: false, reason } when the file can't be used at all (unidentifiable, or missing a column we genuinely read).
 * Otherwise { ok: true, type, label, rows, skipped, extraColumns, window, rowCount }, where:
 *   rows    — typed, business-rule-filtered records ready for the importer
 *   skipped — [{ line, reason, detail }] for every data row we did NOT return, so the preview can account for the difference
 *             between "the file had 774 rows" and "756 will import". The legacy code discarded these invisibly.
 *   window  — { from, to } across the rows that carry a date; null for the fee report, which is a snapshot with no dates at all.
 */
function parseReport(fileText) {
  const id = identify(fileText);
  if (!id.type) return { ok: false, reason: id.reason };

  const def = REPORTS[id.type];
  const header = id.header;

  // Resolve every required column to an index ONCE, by name. This is the whole point of the module: after this block, nothing
  // downstream knows or cares what order Amazon put the columns in.
  const idx = {};
  const missing = [];
  for (const col of def.required) {
    const at = header.indexOf(col);
    if (at === -1) missing.push(col);
    else idx[col] = at;
  }

  // The fee report's fulfilment-fee column has been renamed by Amazon before — accept any known spelling before declaring it missing.
  if (def.type === 'FEES') {
    const canonical = 'expected-domestic-fulfilment-fee-per-unit';
    if (idx[canonical] === undefined) {
      const alias = FEE_COLUMN_ALIASES.find((a) => header.indexOf(a) !== -1);
      if (alias) {
        idx[canonical] = header.indexOf(alias);
        const stillMissing = missing.indexOf(canonical);
        if (stillMissing !== -1) missing.splice(stillMissing, 1);
      }
    }
  }

  if (missing.length > 0) {
    // Hard stop, naming the columns. Better a refused upload than a silently wrong one.
    return {
      ok: false,
      type: def.type,
      label: def.label,
      reason: `${def.label}: required column${missing.length > 1 ? 's' : ''} missing or renamed — ${missing.join(', ')}. Amazon may have changed this report; nothing was imported.`,
    };
  }

  const lines = splitLines(fileText);
  const rows = [];
  const skipped = [];
  const cell = (parts, col) => parts[idx[col]];

  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split('\t');
    const lineNo = i + 1; // 1-based, counting the header — matches what the operator sees in a text editor
    const skip = (reason, detail) => skipped.push({ line: lineNo, reason, detail });

    if (def.type === 'ORDERS') {
      const parsed = parseOrderRow(parts, cell, skip);
      if (parsed) rows.push(parsed);
    } else if (def.type === 'INVENTORY') {
      const parsed = parseInventoryRow(parts, cell, skip);
      if (parsed) rows.push(parsed);
    } else if (def.type === 'RETURNS') {
      const parsed = parseReturnRow(parts, cell, skip);
      if (parsed) rows.push(parsed);
    } else if (def.type === 'FEES') {
      const parsed = parseFeeRow(parts, cell, skip);
      if (parsed) rows.push(parsed);
    }
  }

  // Date window across whatever the rows carry. Purely informational — it's what the preview shows the operator so they can see at
  // a glance that they uploaded the window they meant to (decision D7 removed any cap, so this is the only guard against surprise).
  let window = null;
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (dates.length > 0) window = { from: dates[0], to: dates[dates.length - 1] };

  logger.info(`[amzReports] ${def.label}: ${rows.length} usable, ${skipped.length} skipped, ${id.extraColumns.length} new columns`);

  return {
    ok: true,
    type: def.type,
    label: def.label,
    rows,
    skipped,
    extraColumns: id.extraColumns,
    droppedColumns: id.droppedColumns,
    window,
    rowCount: lines.length - 1,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Per-report row parsers
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Orders -> a candidate `sales` row. Business filters reproduce of_amzsalesload:139-151 exactly, because they encode real decisions
 * and this port is not the place to change them:
 *   - sales-channel must be 'Amazon.co.uk'   (excludes the 11 'Non-Amazon' rows — those are the amzn.gr virtual/bundle listings)
 *   - order-status must be Shipped or Pending (Cancelled is handled separately as a RETRACTION, see the commit route)
 *   - amazon-order-id must be 19 chars       (Amazon's fixed format; anything else is a malformed line)
 * Added here, and NOT in the legacy code: a usable order-item-id is now required, because it is our idempotency key. In the sample
 * the only rows lacking one are the Non-Amazon rows already excluded above, so this rejects nothing that would otherwise import.
 */
function parseOrderRow(parts, cell, skip) {
  const status = text(cell(parts, 'order-status'));
  const channel = text(cell(parts, 'sales-channel'));
  const orderId = text(cell(parts, 'amazon-order-id'));
  const sku = text(cell(parts, 'sku'));
  const itemPriceRaw = text(cell(parts, 'item-price'));
  const orderItemId = text(cell(parts, 'order-item-id'));

  if (channel !== 'Amazon.co.uk') return skip('NOT_AMAZON_UK', channel || '(blank sales-channel)'), null;
  if (status === 'Cancelled') return skip('CANCELLED', orderId), null;      // not an error — retracted separately
  if (status !== 'Shipped' && status !== 'Pending') return skip('STATUS_NOT_COUNTED', status || '(blank)'), null;
  if (orderId.length !== 19) return skip('BAD_ORDER_ID', orderId || '(blank)'), null;
  if (!sku) return skip('NO_SKU', orderId), null;
  if (itemPriceRaw === '') return skip('NO_ITEM_PRICE', `${orderId} / ${sku}`), null;
  // '0' is what Amazon writes when there is no line id (only ever seen on the Non-Amazon rows filtered out above). Treat it as absent
  // rather than building an idempotency key of 'AMZ:O:<order>:0' that would collide across orders.
  if (!orderItemId || orderItemId === '0') return skip('NO_ORDER_ITEM_ID', `${orderId} / ${sku}`), null;

  const qty = integer(cell(parts, 'quantity'));
  if (qty === null || qty <= 0) return skip('ZERO_QUANTITY', `${orderId} / ${sku}`), null;

  const itemPrice = number(itemPriceRaw);
  if (itemPrice === null) return skip('BAD_ITEM_PRICE', `${orderId} / ${sku} = "${itemPriceRaw}"`), null;

  const purchase = cell(parts, 'purchase-date');
  const date = localDatePart(purchase);
  if (!date) return skip('BAD_PURCHASE_DATE', `${orderId} = "${text(purchase)}"`), null;

  return {
    kind: 'SALE',
    orderId,
    orderItemId,
    sku,
    qty,
    // item-price is the LINE total; sales.soldprice is per unit (of_amzsalesload:131 does the same divide).
    unitPrice: Math.round((itemPrice / qty) * 100) / 100,
    date,
    time: localTimePart(purchase),
    status,
    sourceKey: `AMZ:O:${orderId}:${orderItemId}`,
  };
}

/** Orders that are Cancelled — collected separately so the commit can retract any sale row previously written for them (bug 2.7.1). */
function parseCancellations(fileText) {
  const id = identify(fileText);
  if (id.type !== 'ORDERS') return [];
  const header = id.header;
  const iStatus = header.indexOf('order-status');
  const iOrder = header.indexOf('amazon-order-id');
  const iSku = header.indexOf('sku');
  if (iStatus === -1 || iOrder === -1) return [];

  const out = [];
  const lines = splitLines(fileText);
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split('\t');
    if (text(parts[iStatus]) !== 'Cancelled') continue;
    const orderId = text(parts[iOrder]);
    if (orderId.length !== 19) continue;
    out.push({ orderId, sku: iSku === -1 ? '' : text(parts[iSku]) });
  }
  return out;
}

/**
 * FBA Inventory -> the stock snapshot for `amzfeed`. Verified against live amzfeed on 2026-07-28: amzprice = your-price,
 * amzlive = afn-fulfillable-quantity, amztotal = afn-total-quantity, matching for every SKU spot-checked (which also confirms the
 * legacy gi_amzstockbuffer is currently 0 — no buffer is subtracted, values pass through unchanged).
 *
 * Note the legacy `afn-listing-exists = 'Yes'` filter is now a no-op (all 630 sample rows are 'Yes'), so it isn't reproduced.
 */
function parseInventoryRow(parts, cell, skip) {
  const sku = text(cell(parts, 'sku'));
  if (!sku) return skip('NO_SKU', `line has no sku`), null;

  return {
    kind: 'STOCK',
    sku,
    fnsku: text(cell(parts, 'fnsku')),
    asin: text(cell(parts, 'asin')),
    price: number(cell(parts, 'your-price')),
    live: integer(cell(parts, 'afn-fulfillable-quantity')) || 0,
    total: integer(cell(parts, 'afn-total-quantity')) || 0,
    // Amazon's own virtual bundle/group SKUs. They are real rows in the report but will never match skumap, so flag them here and
    // let the reconciliation panel bucket them as "expected" rather than showing them to the operator as ~13 missing products.
    isVirtual: sku.startsWith('amzn.gr.'),
    date: null,
  };
}

/**
 * FBA Returns -> a negative `sales` row. The reversal's profit is worked out at commit time from the ORIGINAL sale row, so it
 * cancels that sale exactly (matching of_amzsalesload:317-326); nothing profit-related is decided here.
 */
function parseReturnRow(parts, cell, skip) {
  const sku = text(cell(parts, 'sku'));
  const orderId = text(cell(parts, 'order-id'));
  const lpn = text(cell(parts, 'license-plate-number'));

  if (!sku) return skip('NO_SKU', orderId || '(blank order)'), null;
  if (!orderId) return skip('NO_ORDER_ID', sku), null;
  // The unique per-unit id. The legacy code READ this into ls_licenseplate at line 259 and then never used it, which is precisely
  // why two same-sku returns on one order collapsed into one (bug 2.7.2). Without it we have no honest key, so the row is skipped.
  if (!lpn) return skip('NO_LICENSE_PLATE', `${orderId} / ${sku}`), null;

  const qty = integer(cell(parts, 'quantity'));
  if (qty === null || qty <= 0) return skip('ZERO_QUANTITY', `${orderId} / ${sku}`), null;

  const date = localDatePart(cell(parts, 'return-date'));
  if (!date) return skip('BAD_RETURN_DATE', `${orderId} / ${sku}`), null;

  return {
    kind: 'RETURN',
    orderId,
    sku,
    qty: -qty,                 // stored negative, mirroring the legacy reversal rows
    date,
    time: localTimePart(cell(parts, 'return-date')),
    licensePlate: lpn,
    // SELLABLE | DEFECTIVE | CUSTOMER_DAMAGED (and others Amazon may add). Anything but SELLABLE means the unit never sells again,
    // so the whole cost of goods is lost rather than just the margin — see utils/amzProfit.js -> returnProfit().
    disposition: text(cell(parts, 'detailed-disposition')).toUpperCase() || null,
    sourceKey: `AMZ:R:${orderId}:${lpn}`,
  };
}

/**
 * FBA Fee Preview -> the real per-SKU FBA fulfilment fee for skumap.fbafee.
 *
 * GBP-only, reproducing the legacy currency filter (of_updateamzdatadb:176-184). All 260 sample rows are GBP, but the filter is
 * kept because the report can carry other stores' rows and a EUR fee written into a GBP margin would be quietly wrong.
 *
 * Coverage is NOT expected to be complete and that is not an error: the report covers SKUs with FBA inventory (202 of the 204
 * live-stock SKUs in the sample), so ~371 zero-stock listings are simply absent. A SKU missing from a present fee file keeps its
 * last known fee — see the commit route.
 */
function parseFeeRow(parts, cell, skip) {
  const sku = text(cell(parts, 'sku'));
  if (!sku) return skip('NO_SKU', 'line has no sku'), null;

  const currency = text(cell(parts, 'currency'));
  if (currency && currency !== 'GBP') return skip('NOT_GBP', `${sku} = ${currency}`), null;

  const fee = number(cell(parts, 'expected-domestic-fulfilment-fee-per-unit'));
  if (fee === null) return skip('NO_FEE_VALUE', sku), null;
  if (fee <= 0) return skip('ZERO_FEE', `${sku} = ${fee}`), null;

  return { kind: 'FEE', sku, fee: Math.round(fee * 100) / 100, date: null };
}

module.exports = {
  REPORTS,
  identify,
  parseReport,
  parseCancellations,
  normaliseHeader,
};
