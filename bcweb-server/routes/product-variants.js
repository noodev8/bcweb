/*
=======================================================================================================================================
API Route: product_variants
=======================================================================================================================================
Method: GET
Purpose: The drill behind /product/<groupid> — one STYLE opened out to its sizes (owner, 2026-09-22: "double click to drill down if on
         groupid level ... CODE, Stock, Amz Price, Shopify Price, Total Sold for code"). Same four numbers as product-overview, one
         rung down, plus the barcode, so the whole product-first errand — find it, look at it, act on it — never leaves this pair of
         screens for the numbers. Read-only.

NAMED product-variants, NOT product-sizes. routes/product-sizes.js already exists and is the Add/Modify WRITE that saves a style's
size list to skumap (and re-pushes to Shopify). Two routes called "sizes", one read and one write, is exactly the mix-up worth one
extra word in a filename.

THE SHOPIFY PRICE IS IN THE HEADER, NOT ON THE ROWS (owner's list asked for it per code, and this is the one place the shape was
changed). skusummary.shopifyprice is STYLE grain — there is no per-size Shopify price to read — so a Shopify column here would print
the same number down every row and quietly invite the reader to believe the sizes could differ. They cannot. Amazon's CAN, and does
(see product-overview's header on the spread), so amz_price stays a real per-row column and the asymmetry between the two channels is
visible on the screen instead of being flattened away. That asymmetry is the whole reason CLAUDE.md retired the amz-match autopilot.

SIZES COME FROM skumap, NOT localstock (CLAUDE.md landmine): localstock holds in-stock rows only, so a sold-out size has NO row there.
Taking the range from skumap and LEFT JOINing each source means a sold-out size still appears, reading 0 — which is the answer the
operator needs ("we have none in a 39"), not a missing row they will read as "not stocked". Same rule, same reason, as inv-stock.js.

STOCK IS ONE COLUMN, local + Amazon-held, exactly as product-overview defines it — and the rows here must sum back to the figure the
list showed, or the two screens disagree about the same style one click apart. If you change the definition in one file, change both.

Requires auth.
=======================================================================================================================================
Request Query Params:
  groupid (string, required) - the style key

Success Response:
{
  "return_code": "SUCCESS",
  "header": {
    "groupid": "1005292-ARIZONA",
    "title": "Birkenstock Arizona Two-Strap Sandals Black",   // title.shopifytitle; null if none
    "segment": "ARIZONA-GENERAL",
    "imagename": "birkenstock-....jpg",   // bare filename; the web builds https://images.brookfieldcomfort.com/<imagename>
    "price": 46.95,                       // live SHOPIFY price - style grain, which is why it is here and not on the rows
    "rrp": 55.00,                         // safeNumeric; null when the legacy varchar holds junk (rrp is literally 'RRP' on 37 rows)
    "cost": 21.40,
    "stock": 38, "local": 27, "amazon": 11,   // style totals; the rows sum back to these
    "sold30": 19
  },
  "rows": [
    {
      "code": "1005292-ARIZONA-36",
      "size": "36 EU / 3.5 UK",           // skumap.optionsize with its '<seq>--' ordering prefix stripped; falls back to the EU size
      "eu": "36",                         // SUBSTRING(code FROM '[^-]*$') - drives the ordering
      "stock": 12, "local": 10, "amazon": 2,
      "amz_price": 37.30,                 // amzfeed.amzprice for THIS size (safeNumeric); null when the size has no FBA row
      "amz_live": 2,                      // amzfeed.amzlive - units a customer can buy today. 0 with a price = listed, out of stock
      "sold30": 6,                        // units sold in 30 days for this code, all channels, returns excluded
      "barcode": "4055855583264",         // skumap.ean with the legacy trailing 'B' stripped (CLAUDE.md); null when unset
      "amz_sku": "17659-23-36-2607"       // full Amazon Seller SKU (skumap.sku); null when the size is not mapped to Amazon
    }
  ]
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
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const groupid = (req.query.groupid || '').trim();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    // The style header. Fetched first and on its own so a bad groupid returns NOT_FOUND instead of an empty size list, which would
    // read as "this style has no sizes" — a different and much more alarming fact.
    // NB: no backticks inside this template literal (CLAUDE.md) — one would end the query mid-flight.
    const head = await query(`
      SELECT s.groupid, t.shopifytitle AS title, s.segment, s.imagename,
             ${safeNumeric('s.shopifyprice')} AS price,
             ${safeNumeric('s.rrp')}          AS rrp,
             ${safeNumeric('s.cost')}         AS cost
      FROM skusummary s
      LEFT JOIN title t ON t.groupid = s.groupid
      WHERE s.groupid = $1
    `, [groupid]);

    if (head.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'No such product' });
    }

    // One query for every size, no N+1. skumap is the spine (one row per variant = the FULL size range); each source LEFT JOINs on so
    // a sold-out or non-Amazon size reads 0/null rather than dropping out.
    const result = await query(`
      WITH loc AS (
        -- Local: SUM(qty), ALL states. SUM not COUNT - localstock.qty is not always 1 (see inv-styles' header).
        SELECT code, SUM(qty) AS units
        FROM localstock
        WHERE groupid = $1 AND COALESCE(deleted, 0) = 0 AND qty > 0
        GROUP BY code
      ),
      sold AS (
        -- 30 days, all channels, returns dropped (qty > 0) - the same basis as product-overview, one rung down. sales.code is the
        -- internal size code, so this is a straight per-size count with no join.
        SELECT code, SUM(qty) AS units
        FROM sales
        WHERE groupid = $1 AND solddate >= CURRENT_DATE - INTERVAL '30 days' AND qty > 0
        GROUP BY code
      )
      SELECT
        m.code,
        SUBSTRING(m.code FROM '[^-]*$') AS eu,
        -- The size label the operator themselves chose on the Add/Modify sizes screen, so a UK-sized brand reads "5 UK" rather than a
        -- bogus "05 EU". It lives in optionsize behind an '<seq>--' ordering prefix (e.g. '101--35 EU / 2.5 UK'), stripped here.
        -- Same treatment as inv-stock.js; NULLIF gives the client a clean fallback for a blank one.
        NULLIF(btrim(regexp_replace(COALESCE(m.optionsize, ''), '^[0-9]+--', '')), '') AS sizedisplay,
        -- Barcode = skumap.ean with the legacy trailing 'B' stripped (CLAUDE.md). Same expression as amazon-order-list.js, so the two
        -- screens can never print a different barcode for the same size.
        NULLIF(regexp_replace(COALESCE(m.ean, ''), 'B$', ''), '') AS barcode,
        m.sku AS amz_sku,
        COALESCE(loc.units, 0)  AS local_units,
        -- amztotal is live + inbound already; do NOT add amzlive to it (see product-overview). amzfeed is FBA-only and READ ONLY.
        COALESCE(f.amztotal, 0) AS amazon_units,
        COALESCE(f.amzlive, 0)  AS amz_live,
        ${safeNumeric('f.amzprice')} AS amz_price,
        COALESCE(sold.units, 0) AS sold_units
      FROM skumap m
      LEFT JOIN loc      ON loc.code  = m.code
      LEFT JOIN sold     ON sold.code = m.code
      LEFT JOIN amzfeed f ON f.code   = m.code
      WHERE m.groupid = $1
      -- Numeric-aware ordering so 5 sorts before 10 and a half size lands between its neighbours. The size is the last dash-segment
      -- (NOT RIGHT(code,2), which reads '.5' on a half size). The first key parks any NON-numeric size at the END: those are the odd
      -- ones (a letter width, a blank) and they belong after the real run, not scattered through it or sitting on top of it.
      ORDER BY CASE WHEN substring(m.code from '[^-]+$') ~ '^[0-9]+(\\.[0-9]+)?$' THEN 0 ELSE 1 END,
               CASE WHEN substring(m.code from '[^-]+$') ~ '^[0-9]+(\\.[0-9]+)?$'
                    THEN substring(m.code from '[^-]+$')::numeric END,
               m.code
    `, [groupid]);

    const rows = result.rows.map((r) => {
      // pg returns SUM() as a string (numeric/bigint) - coerce so the JSON carries real numbers the client never parses.
      const local = Number(r.local_units) || 0;
      const amazon = Number(r.amazon_units) || 0;
      return {
        code: r.code,
        eu: r.eu || null,
        // Fall back to the bare EU size when the style has no chosen label, so the column is never blank.
        size: r.sizedisplay || r.eu || r.code,
        stock: local + amazon,
        local,
        amazon,
        amz_price: r.amz_price === null ? null : Number(r.amz_price),
        amz_live: Number(r.amz_live) || 0,
        sold30: Number(r.sold_units) || 0,
        barcode: r.barcode || null,
        amz_sku: r.amz_sku || null,
      };
    });

    const h = head.rows[0];
    // Style totals are SUMMED FROM THE ROWS, not queried again. Two separate aggregates over the same tables is how a header and its
    // own rows end up disagreeing on screen; this way they cannot.
    const local = rows.reduce((a, r) => a + r.local, 0);
    const amazon = rows.reduce((a, r) => a + r.amazon, 0);

    return res.json({
      return_code: 'SUCCESS',
      header: {
        groupid: h.groupid,
        title: h.title || null,
        segment: h.segment || null,
        imagename: h.imagename || null,
        price: h.price === null ? null : Number(h.price),
        rrp: h.rrp === null ? null : Number(h.rrp),
        cost: h.cost === null ? null : Number(h.cost),
        stock: local + amazon,
        local,
        amazon,
        sold30: rows.reduce((a, r) => a + r.sold30, 0),
      },
      rows,
    });
  } catch (err) {
    logger.error('[product-variants] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Lookup failed' });
  }
});

module.exports = router;
