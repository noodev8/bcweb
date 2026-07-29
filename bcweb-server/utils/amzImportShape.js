/*
=======================================================================================================================================
Util: amzImportShape
=======================================================================================================================================
Purpose: Turn a full import plan (utils/amzImport.js) into the compact JSON the Update Amazon screen renders.

WHY THIS IS SEPARATE
The plan holds every row it intends to write — 744 sales lines on a normal 30-day run. That is exactly what the commit needs and
exactly what the preview must NOT send down the wire. This module is the one place that decides what the operator sees, so the
preview and the post-commit receipt are guaranteed to describe the same run in the same shape and the same words.

The summary is deliberately an ACCOUNT, not a headline: for every file, rows in the file = written + already there + skipped, with
each skip carrying a reason. The legacy import's defining flaw was discarding rows invisibly, so "the numbers add up" is the feature.
=======================================================================================================================================
*/

// Human wording for every skip/rejection reason the parser and planner can produce. Kept here rather than in the client so the
// server stays the single source of truth for what a run did — the screen renders whatever it is handed.
const REASON_TEXT = {
  NOT_AMAZON_UK: 'Not an Amazon.co.uk sale (virtual/bundle listing)',
  CANCELLED: 'Cancelled order — handled as a retraction, not a sale',
  STATUS_NOT_COUNTED: 'Order status is not Shipped or Pending',
  BAD_ORDER_ID: 'Malformed Amazon order id',
  NO_SKU: 'Row has no SKU',
  NO_ITEM_PRICE: 'No item price on the line',
  BAD_ITEM_PRICE: 'Item price could not be read as a number',
  NO_ORDER_ITEM_ID: 'No order-item-id — cannot key this line safely',
  ZERO_QUANTITY: 'Quantity is zero or missing',
  BAD_PURCHASE_DATE: 'Purchase date could not be read',
  BAD_RETURN_DATE: 'Return date could not be read',
  NO_ORDER_ID: 'Return has no order id',
  NO_LICENSE_PLATE: 'Return has no license-plate-number — cannot key it safely',
  NOT_GBP: 'Fee row is not in GBP',
  NO_FEE_VALUE: 'No fulfilment fee value on the row',
  ZERO_FEE: 'Fulfilment fee is zero',
};

function groupSkips(skipped) {
  const by = new Map();
  for (const s of skipped) {
    if (!by.has(s.reason)) by.set(s.reason, { reason: s.reason, label: REASON_TEXT[s.reason] || s.reason, count: 0, examples: [] });
    const g = by.get(s.reason);
    g.count += 1;
    if (g.examples.length < 3) g.examples.push(s.detail);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/**
 * @param {object} parsed  type -> parseReport() result, for the files actually uploaded
 * @param {object} plan    buildPlan() output
 * @param {object} [opts]  { committed: true } to word it as a receipt rather than a forecast
 */
function shapePlan(parsed, plan, opts = {}) {
  const committed = Boolean(opts.committed);

  const files = Object.values(parsed).map((p) => ({
    type: p.type,
    label: p.label,
    rowsInFile: p.rowCount,
    usable: p.rows.length,
    skipped: p.skipped.length,
    skipReasons: groupSkips(p.skipped),
    window: p.window,
    // Non-empty only when Amazon has changed the report's shape since the layout was captured. Normally both are empty and the UI
    // says nothing; when they aren't, it is the earliest warning that a report format has moved.
    newColumns: p.extraColumns || [],
    droppedColumns: p.droppedColumns || [],
  }));

  return {
    committed,
    files,

    sales: {
      written: plan.sales.insert.length,
      units: plan.sales.units,
      value: plan.sales.value,
      alreadyImported: plan.sales.duplicate,
      alreadyInDbFromLegacy: plan.sales.legacyDuplicate,
      withoutProfit: plan.sales.noProfit,
      unknownSku: plan.sales.unknownSku,
    },

    returns: {
      written: plan.returns.insert.length,
      units: plan.returns.units,
      alreadyImported: plan.returns.duplicate,
      alreadyInDbFromLegacy: plan.returns.legacyDuplicate,
      // A return whose original sale isn't in `sales` — normal on a first run or a backfill, because the sale may predate the
      // window. Those rows are written with a NULL profit rather than a guessed one.
      withoutOriginalSale: plan.returns.unmatchedSale,
      unknownSku: plan.returns.unknownSku,
      // Stock that came back DEFECTIVE or CUSTOMER_DAMAGED: it never sells again, so the whole cost of goods is gone rather than
      // just the margin. Reported as its own figure because it is the one return cost that is measured rather than estimated, and
      // because a rising number here is a supplier or listing problem, not a pricing one.
      writeOffUnits: plan.returns.writeOffUnits,
      writeOffValue: plan.returns.writeOffValue,
      dispositions: plan.returns.dispositions,
    },

    // The only destructive step, so it is always itemised — never a bare count.
    cancellations: {
      rows: plan.cancellations.rows,
      units: plan.cancellations.units,
      value: plan.cancellations.value,
      detail: plan.cancellations.orders.slice(0, 50),
    },

    fees: {
      updated: plan.fees.update.length,
      unchanged: plan.fees.unchanged,
      firstRealFee: plan.fees.newlyReal,
      unknownSku: plan.fees.unknownSku,
      biggestMoves: plan.fees.biggestMoves,
    },

    stock: {
      rowsInReport: plan.stock.rows,
      matched: plan.stock.matched,
      liveUnits: plan.stock.liveUnits,
      totalUnits: plan.stock.totalUnits,
      // Products this report introduces (new, or with a re-issued fnsku). The barcode panel shows itself ONLY when this is non-empty,
      // so it costs the operator nothing on an ordinary import. Capped like the other lists — it is a prompt, not a report.
      newBarcodes: plan.stock.newBarcodes.slice(0, 50),
      newBarcodeCount: plan.stock.newBarcodes.length,
    },

    // Three buckets, not one list of ~109 "problems" (design doc 3.7 / 2.8). Only `unknownSku` is a to-do list.
    reconciliation: {
      unknownSku: plan.stock.unknownSku.slice(0, 200),
      unknownSkuCount: plan.stock.unknownSku.length,
      virtual: plan.stock.virtual.slice(0, 50),
      virtualCount: plan.stock.virtual.length,
      goneFromAmazon: plan.stock.goneFromAmazon.slice(0, 200),
      goneFromAmazonCount: plan.stock.goneFromAmazon.length,
    },
  };
}

module.exports = { shapePlan, REASON_TEXT };
