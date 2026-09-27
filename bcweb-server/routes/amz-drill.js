/*
=======================================================================================================================================
API Route: amz_drill
=======================================================================================================================================
Method: GET
Purpose: Stage 2 — the drill-down / decision screen for ONE Amazon SKU (one size), the mirror of Shopify's pricing-drill. Returns the
         header stats — the frame for the decision. Everything read-only:
           - header : current Amazon price, cost, FBA fee, RRP, computed floor (cost+FBA) and net margin, FBA live/inbound stock, the
                      Amazon SKU (amz_sku — needed for the upload file), title.
         (The 6-week velocity `weeks` and 60-day price `bands` evidence were REMOVED 2026-09-27 with the drill's "Supporting detail"
         block — owner: not used.)

         The price-change history and the raw sales list are SEPARATE lazily-loaded reports (amz-history / amz-sales), fetched only when the
         operator opens those sections — keeping the initial drill fast (mirrors the Shopify pricing-history / pricing-sales split).

Never writes; amzfeed is untouched (FBA-only, refreshed nightly from Amazon). Sales are channel='AMZ' only (qty<0 = a return). Margin here
is the NET Amazon contribution (price - cost - FBA fee), since the FBA fee is a real per-unit cost on this channel.

Schema landmines respected: amzprice/cost/rrp/fbafee are junk-prone VARCHARs -> safeNumeric (NULL on non-numeric). amzlive/amztotal are
real integers; inbound = amztotal - amzlive. Size = the code's suffix after the last '-' (not RIGHT(code,2), which reads '.5' on a half size). Requires auth.
=======================================================================================================================================
Request Query Params:
  code (string, required)  - our SKU (amzfeed.code / sales.code), e.g. 'FLE030-IVES-WHITE-38'

Success Response:
{
  "return_code": "SUCCESS",
  "header": {
    "code": "FLE030-IVES-WHITE-38", "amz_sku": "AD-0XF8D-48L", "groupid": "FLE030-IVES-WHITE", "segment": "IVES-WHITE",
    "size": "38", "title": "...", "imagename": "ives-white.jpg",  // product image filename (images.brookfieldcomfort.com) or null
    "price": 37.99, "cost": 15.99, "fbafee": 3.06, "rrp": 45.00,
    "floor": 19.05,                            // cost + FBA fee (breakeven)
    "margin": 18.94, "margin_pct": 50,         // net = price - cost - FBA fee, and as % of price (null if any part unknown)
    "fba_live": 96, "fba_inbound": 0
  }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();

// UK VAT at 20% on a VAT-inclusive price: gross / 1.2 = the ex-VAT amount, the same convention utils/shopifyProfit.js and
// utils/amzProfit.js use. See the margin note in this file's header for why the DIAL carries it.
const VAT_MULTIPLIER = 1.2;
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code is required' });
    }

    // ---- Header: economics for this SKU. amzfeed is the Amazon/FBA truth (price, fee, stock); cost/rrp live on skusummary. ----
    const headerResult = await query(`
      SELECT a.code, a.groupid, sk.segment, SUBSTRING(a.code FROM '[^-]*$') AS size, a.sku AS amz_sku,
             t.shopifytitle AS title,
             sk.imagename,
             sk.match_amazon_price AS match_amazon,
             ${safeNumeric('a.amzprice')} AS price,
             ${safeNumeric('sk.cost')}    AS cost,
             ${safeNumeric('sk.rrp')}     AS rrp,
             ${safeNumeric('a.fbafee')}   AS fbafee,
             COALESCE(a.amzlive,0)  AS fba_live,
             GREATEST(COALESCE(a.amztotal,0) - COALESCE(a.amzlive,0), 0) AS fba_inbound
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      LEFT JOIN title t ON t.groupid = a.groupid
      WHERE a.code = $1
    `, [code]);

    if (headerResult.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'SKU not found in amzfeed' });
    }

    const h = headerResult.rows[0];
    const price = num(h.price);
    const cost = num(h.cost);
    const fbafee = num(h.fbafee);
    const rrp = num(h.rrp);
    // Floor = cost + FBA fee. UNCHANGED, deliberately: it mirrors the guard in /amz-apply, and moving one without the other would
    // let the screen and the write disagree about what is blocked. NOTE the consequence — now that margin is ex-VAT, margin no longer
    // reads 0 AT the floor (it reads negative there, because the floor is a gross price compared against a net keep). That gap is real
    // and pre-existing; it is on the open list, not something to paper over here.
    const floor = cost !== null && fbafee !== null ? Math.round((cost + fbafee) * 100) / 100 : null;
    // Net margin is EX-VAT (2026-08-31), same reasoning as pricing-drill.js: price is VAT-inclusive, the ~1/6 going to HMRC was never
    // ours. Still a HIGH-LEVEL DIAL — the 15% referral fee is knowingly NOT in here (nor is it in the legacy figure this replaced);
    // pulling it in is a bigger change than was asked for and stays on the open list. VAT is in because it moves where zero is.
    const netPrice = price === null ? null : price / VAT_MULTIPLIER;
    const margin = netPrice !== null && cost !== null && fbafee !== null ? Math.round((netPrice - cost - fbafee) * 100) / 100 : null;
    const marginPct = margin !== null && netPrice ? Math.round((margin / netPrice) * 100) : null;

    const header = {
      code: h.code,
      amz_sku: h.amz_sku,
      groupid: h.groupid,
      segment: h.segment || null,
      size: h.size,
      title: h.title || null,
      // Filename only (or null) — served from https://images.brookfieldcomfort.com/<imagename> on the web side. Purely so the operator
      // can eyeball what they're pricing; not used in any decision logic. Lives on skusummary (per style, shared across the SKU's sizes).
      imagename: h.imagename || null,
      // Read-only flag for the drill badge: the parent STYLE auto-matches its Shopify price to Amazon's lowest in-stock size. Purely
      // informational on the Amazon side (this SKU's Amazon price is set here as usual); it tells the operator Shopify follows Amazon.
      match_amazon: h.match_amazon === true,
      price,
      cost,
      fbafee,
      rrp,
      floor,
      margin,
      margin_pct: marginPct,
      fba_live: Number(h.fba_live),
      fba_inbound: Number(h.fba_inbound),
    };

    return res.json({ return_code: 'SUCCESS', header });
  } catch (err) {
    logger.error('[amz-drill] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load SKU detail' });
  }
});

module.exports = router;
