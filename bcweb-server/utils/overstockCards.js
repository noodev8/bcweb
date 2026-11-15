/*
=======================================================================================================================================
Util: overstockCards   (THE copy of what an OVERSTOCK card shows per size — owner 2026-11-15, docs/overstock/PLAN.md)
=======================================================================================================================================
Purpose: The overstock cards are the Shopify price cards narrowed to the styles holding an OVERSTOCKED size (the Stock ladder's label —
         utils/stockLadder.js: sold in 90 days, holding more than 4 months' worth at its 12-month pace). Decision 1: one card per STYLE,
         with a size price box for each overstocked size beside the style price. This builds those rows (decision 4), for many styles in
         a fixed number of queries. Read by routes/pricing-all-list.js ?step=overstocked.

Per overstocked size, size order:
  code, size
  held      pairs we hold — the ladder's number: local free + Amazon total (utils/slowSizes.js)
  fba       of those, live at Amazon (amzfeed.amzlive) — shown as "n at Amazon"
  over      pairs beyond 4 months' worth — what needs to sell (the ladder's `over`)
  sold90    units sold in the last 90 days, ANY channel, net of returns — shows it IS selling

The size price in force (own_price / own_kind) is on the card's own size list (utils/shopifyCards.js) — not repeated here.
ONLY sizes overstocked NOW (decision 6): a size that sold down to 4 months' worth drops off, its markdown (if any) stays, and the normal
Shopify cards carry the "no longer overstocked" reminder.
=======================================================================================================================================
*/

const sizeKey = (code) => { const s = code.split('-').pop(); return /^[0-9]+([.][0-9]+)?$/.test(s) ? Number(s) : Infinity; };

/**
 * @param db     pool query wrapper or a client
 * @param skus   the Stock ladder's rows (readStockLadder().skus) — only `overstocked` ones are used
 * @returns Map(groupid -> [{ code, size, held, fba, over, sold90 }])
 */
async function overstockSizes(db, skus) {
  const over = skus.filter((s) => s.overstocked);
  const out = new Map();
  if (!over.length) return out;
  const codes = over.map((s) => s.code);
  const [fba, sold] = await Promise.all([
    db.query(`SELECT code, MAX(COALESCE(amzlive, 0))::int AS live FROM amzfeed WHERE code = ANY($1::text[]) GROUP BY code`, [codes]),
    db.query(`SELECT code, COALESCE(SUM(qty), 0)::int AS units FROM sales
               WHERE code = ANY($1::text[]) AND solddate >= CURRENT_DATE - 90 GROUP BY code`, [codes]),
  ]);
  const fbaOf = new Map(fba.rows.map((r) => [r.code, Number(r.live)]));
  const soldOf = new Map(sold.rows.map((r) => [r.code, Math.max(0, Number(r.units))]));
  for (const s of over.sort((a, b) => sizeKey(a.code) - sizeKey(b.code) || a.code.localeCompare(b.code))) {
    if (!out.has(s.groupid)) out.set(s.groupid, []);
    out.get(s.groupid).push({
      code: s.code, size: s.code.split('-').pop(),
      held: s.units, fba: fbaOf.get(s.code) ?? 0, over: s.over, sold90: soldOf.get(s.code) ?? 0,
    });
  }
  return out;
}

module.exports = { overstockSizes };
