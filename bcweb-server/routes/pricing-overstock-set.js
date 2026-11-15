/*
=======================================================================================================================================
API Route: pricing_overstock_set
=======================================================================================================================================
Method: POST
Purpose: SET on an OVERSTOCK card (owner, 2026-11-15, docs/overstock/PLAN.md decision 5) — the style price and the overstocked sizes'
         own prices decided together, saved together:
           - the STYLE price, when it moved: W1 (utils/priceWrite.js → writeShopifyPrice — logged, bounds flagged never blocked, and
             any size price it reaches is ended there: styleDrop);
           - otherwise W2 (parkShopifyStyle): the price held, the review date moved — so the card leaves Due even when only a size moved;
           - each size sent: a price BELOW the (new) style price = an OVERSTOCK size price (utils/sizePrice.js → setSizePrice, kind
             'overstock' — it keeps its paid Google Shopping ads, decision 2); a price at or above it, or null = back to the style price
             (clearSizePrice; nothing to do when the size had none).
         ONE transaction: any refusal (a size not in this style, no stock, an unreadable style price …) writes NOTHING and says why. Then
         ONE push to Shopify (utils/shopify.js → pushIfLive — best-effort, never rolls back). Google needs nothing here: the size price
         log rows are born un-sent for the 2-hourly sweep, and a W1 is picked up from price_change_log as always.
         The review date is required: decision 1 — the card comes due on the style's normal review date, and Set moves it.
=======================================================================================================================================
Request Payload:
{
  "groupid":    "0034791-MILANO",
  "price":      82.49,                                   // the style price on the card's box; required
  "sizes":      [{ "code": "0034791-MILANO-38", "price": 70 }, { "code": "0034791-MILANO-37", "price": null }],
  "reviewDays": 7,                                       // integer >= 1, required
  "note":       "Overstock card"                         // optional
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "…", "style": { "old_price": 82.49, "new_price": "82.49", "moved": false },
  "sizes_set":   [{ "code", "size", "price", "old_price" }],
  "sizes_ended": [{ "code", "size", "price" }],          // ended by hand here (back to the style price)
  "size_prices_ended": [{ "code", "size", "price" }],    // ended because the style price went to or below them (W1's styleDrop)
  "warnings": ["BELOW_COST" …], "next_review": "YYYY-MM-DD", "shopify": { … } | null
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_PRICE"
"INVALID_REVIEW_DAYS"
"NOT_IN_STYLE"          a size code that isn't a live size of this style
plus any refusal from writeShopifyPrice / setSizePrice (NOT_FOUND, MATCH_LOCKED, NO_STYLE_PRICE, NO_STOCK …) — nothing written
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { writeShopifyPrice, parkShopifyStyle } = require('../utils/priceWrite');
const { setSizePrice, clearSizePrice } = require('../utils/sizePrice');
const { writeBcLog } = require('../utils/bclog');
const shopify = require('../utils/shopify');
const logger = require('../utils/logger');

router.use(verifyToken);

// A refusal inside the transaction: thrown so withTransaction rolls EVERYTHING back, caught below and returned as the API's code.
class Refused extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const r2 = (n) => Math.round(n * 100) / 100;
const isoDay = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const groupid = String(body.groupid || '').trim();
    if (!groupid || body.price === undefined || body.price === null || body.reviewDays === undefined || body.reviewDays === null
        || !Array.isArray(body.sizes)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid, price, sizes and reviewDays are required' });
    }
    const p = Number(body.price);
    if (!Number.isFinite(p) || p <= 0) return res.json({ return_code: 'INVALID_PRICE', message: 'price must be a positive number' });
    const stylePrice = r2(p);
    const reviewDays = Number(body.reviewDays);
    if (!Number.isInteger(reviewDays) || reviewDays < 1) {
      return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
    }
    const sizes = [];
    for (const z of body.sizes) {
      const code = String((z && z.code) || '').trim();
      if (!code) return res.json({ return_code: 'MISSING_FIELDS', message: 'every size needs a code' });
      let price = null;
      if (z.price !== null && z.price !== undefined && String(z.price).trim() !== '') {
        const n = Number(z.price);
        if (!Number.isFinite(n) || n <= 0) return res.json({ return_code: 'INVALID_PRICE', message: `${code}: price must be a positive number` });
        price = r2(n);
      }
      sizes.push({ code, price });
    }
    const note = (body.note === undefined || body.note === null ? '' : String(body.note)).trim().slice(0, 500) || 'Overstock card';
    const by = req.user.display_name;

    const out = await withTransaction(async (client) => {
      // Every size must be a live size of THIS style (a card can only price its own sizes).
      if (sizes.length) {
        const ok = new Set((await client.query(
          `SELECT code FROM skumap WHERE groupid = $1 AND code = ANY($2::text[]) AND COALESCE(deleted, 0) = 0`,
          [groupid, sizes.map((z) => z.code)])).rows.map((r) => r.code));
        const bad = sizes.find((z) => !ok.has(z.code));
        if (bad) throw new Refused('NOT_IN_STYLE', `${bad.code} is not a size of ${groupid}`);
      }

      // 1) THE STYLE — W1 when the price moved, else W2 (the review date still moves).
      const cur = await client.query(`SELECT ${safeNumeric('shopifyprice')} AS now FROM skusummary WHERE groupid = $1`, [groupid]);
      if (!cur.rows.length) throw new Refused('NOT_FOUND', 'Style not found');
      const before = cur.rows[0].now === null ? null : Number(cur.rows[0].now);
      const moved = before === null || Math.round(before * 100) !== Math.round(stylePrice * 100);
      let style; let warnings = []; let sizePricesEnded = []; let nextReview;
      if (moved) {
        const w = await writeShopifyPrice(client, { groupid, price: stylePrice, reviewDays, note, changedBy: by });
        if (w.error) throw new Refused(w.error, w.message);
        style = { old_price: w.oldPrice, new_price: w.newPrice, moved: true };
        warnings = w.warnings || []; sizePricesEnded = w.sizePricesEnded || []; nextReview = w.nextReview;
      } else {
        const w = await parkShopifyStyle(client, { groupid, reviewDays, note, changedBy: by });
        if (w.error) throw new Refused(w.error, w.message);
        style = { old_price: before, new_price: stylePrice.toFixed(2), moved: false };
        nextReview = w.nextReview;
      }

      // 2) THE SIZES — below the style price = an overstock size price; at / above it, or none = back to the style price.
      const set = []; const ended = [];
      for (const z of sizes) {
        if (z.price !== null && z.price < stylePrice) {
          const w = await setSizePrice(client, { code: z.code, price: z.price, note, by, kind: 'overstock' });
          if (w.error) throw new Refused(w.error, `${z.code}: ${w.message}`);
          set.push({ code: z.code, size: w.size, price: z.price, old_price: w.oldPrice });
          for (const x of w.warnings) if (!warnings.includes(x)) warnings.push(x);
        } else {
          const w = await clearSizePrice(client, { code: z.code, by });
          if (!w.error) ended.push({ code: z.code, size: w.size, price: w.oldPrice });   // NOT_SET = it had none: nothing to do
        }
      }

      const parts = [moved ? `style £${style.old_price ?? '?'} → £${style.new_price}` : `style held £${style.new_price}`];
      for (const s of set) parts.push(`size ${s.size} £${s.price.toFixed(2)}`);
      for (const e of ended) parts.push(`size ${e.size} back to style`);
      await writeBcLog(client, { who: by, section: 'Shopify Pricing', log: `Overstock card ${groupid}: ${parts.join(' · ')} · review ${reviewDays}d` });
      return { style, warnings, sizePricesEnded, nextReview, set, ended };
    });

    const touched = out.style.moved || out.set.length > 0 || out.ended.length > 0 || out.sizePricesEnded.length > 0;
    const shopifyResult = touched ? await shopify.pushIfLive(groupid) : null;

    return res.json({
      return_code: 'SUCCESS', groupid, style: out.style,
      sizes_set: out.set, sizes_ended: out.ended, size_prices_ended: out.sizePricesEnded,
      warnings: out.warnings, next_review: isoDay(out.nextReview), shopify: shopifyResult,
    });
  } catch (err) {
    if (err instanceof Refused) return res.json({ return_code: err.code, message: err.message });
    logger.error('[pricing-overstock-set] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save the overstock card' });
  }
});

module.exports = router;
