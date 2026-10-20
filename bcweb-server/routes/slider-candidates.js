/*
=======================================================================================================================================
API Route: slider_candidates
=======================================================================================================================================
Method: GET
Purpose: Pricing Slider "Add products" — EVERY product the channel can slide, once, so the browser can narrow it with the standard
         Contains / Does not contain steps (the Collections / Inventory pattern: a few hundred rows shipped once, filtered client-side;
         plain substring both ways over the haystack fields). Each row carries what the add screen needs to choose well: current price,
         RRP, break-even, stock, units sold in 30 days on this channel, the stamped portfolio status, and — if it's already in a slider
         on this channel — which one (adding it elsewhere is a MOVE).

         SHP  one row per STYLE live on Shopify (skusummary.shopify = 1). An off-Shopify style can't sell there, so sliding it tests nothing.
         AMZ  one row per Amazon SKU (amzfeed — the FBA catalogue). Size = the code's suffix after the last '-' (CLAUDE.md, never RIGHT(…,2)).
              Only SKUs whose style still has a skusummary row: amzfeed keeps listings for styles deleted from our DB (owner, 2026-10-20 —
              e.g. Y0783-00, 9 styles / 54 SKUs), and with no RRP, cost or name they can't join a slider anyway.

         Price, stock and sold use the slider's own definitions (utils/sliderMembers.js header): SHP price = shopifyprice, stock = sellable
         local; AMZ price = utils/slider.js → AMZ_NOW_CTES (a logged change newer than the last import wins), stock = amzlive.
         Read-only. Requires auth.
=======================================================================================================================================
Request Query Params:
  channel (string, required) - 'SHP' | 'AMZ'

Success Response:
{
  "return_code": "SUCCESS",
  "channel": "SHP",
  "rows": [
    { "key": "22152-42-019", "groupid": "22152-42-019", "size": null, "amz_sku": null,
      "title": "Caprice …", "brand": "Caprice", "segment": "CAPRICE-WIN", "supplier": "CAPRICE", "season": "Winter",
      "codes": "22152-42-019-37 …",          // the haystack extras: size codes + Amazon SKUs (SHP) / Amazon SKU (AMZ); null if none
      "price": 65, "rrp": 65, "cost": 23.5, "breakeven": 35.11,
      "stock": 9, "sold30": 0, "status": "NEW",  // skusummary.portfolio_status; null if never stamped
      "slider": null }                          // or { "group_id": 3, "name": "Caprice NEW", "state": "sliding" }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { safeNumeric } = require('../utils/sql');
const { verifyToken } = require('../middleware/verifyToken');
const { AMZ_NOW_CTES, LIVE_STATES, breakevenFor } = require('../utils/slider');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// NB: no backticks inside these SQL strings — they are JS template literals.
const SHP_SQL = `
  WITH local_free AS (
    SELECT groupid, SUM(qty) AS qty FROM localstock
    WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
    GROUP BY groupid
  ),
  sold AS (
    SELECT groupid, SUM(qty) AS units FROM sales
    WHERE channel = 'SHP' AND qty > 0 AND solddate >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY groupid
  ),
  codes AS (
    SELECT groupid,
           string_agg(code, ' ') || COALESCE(' ' || string_agg(sku, ' ') FILTER (WHERE sku IS NOT NULL), '') AS codes
    FROM skumap GROUP BY groupid
  ),
  live AS (
    SELECT m.item_key, m.group_id, g.name, m.state
    FROM slider_member m JOIN slider_group g ON g.id = m.group_id
    WHERE m.channel = 'SHP' AND m.state = ANY($1::text[])
  )
  SELECT ss.groupid AS key, ss.groupid, NULL::text AS size, NULL::text AS amz_sku,
         t.shopifytitle AS title, NULLIF(TRIM(ss.brand), '') AS brand, ss.segment, ss.supplier, NULLIF(TRIM(ss.season), '') AS season,
         codes.codes,
         ${safeNumeric('ss.shopifyprice')} AS price,
         ${safeNumeric('ss.rrp')}          AS rrp,
         ${safeNumeric('ss.cost')}         AS cost,
         NULL::text AS fbafee, ss.tax,
         COALESCE(lf.qty, 0)    AS stock,
         COALESCE(sold.units, 0) AS sold30,
         ss.portfolio_status    AS status,
         live.group_id, live.name AS group_name, live.state AS slider_state
  FROM skusummary ss
  LEFT JOIN title t       ON t.groupid = ss.groupid
  LEFT JOIN local_free lf ON lf.groupid = ss.groupid
  LEFT JOIN sold          ON sold.groupid = ss.groupid
  LEFT JOIN codes         ON codes.groupid = ss.groupid
  LEFT JOIN live          ON live.item_key = ss.groupid
  WHERE ss.shopify = 1
  ORDER BY ss.created_at DESC NULLS LAST, ss.groupid
`;

const AMZ_SQL = `
  WITH ${AMZ_NOW_CTES},
  sold AS (
    SELECT code, SUM(qty) AS units FROM sales
    WHERE channel = 'AMZ' AND qty > 0 AND solddate >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY code
  ),
  live AS (
    SELECT m.item_key, m.group_id, g.name, m.state
    FROM slider_member m JOIN slider_group g ON g.id = m.group_id
    WHERE m.channel = 'AMZ' AND m.state = ANY($1::text[])
  )
  SELECT a.code AS key, a.groupid, SUBSTRING(a.code FROM '[^-]*$') AS size, a.sku AS amz_sku,
         t.shopifytitle AS title, NULLIF(TRIM(ss.brand), '') AS brand, ss.segment, ss.supplier, NULLIF(TRIM(ss.season), '') AS season,
         a.sku AS codes,
         COALESCE(an.price, ${safeNumeric('a.amzprice')}) AS price,
         ${safeNumeric('ss.rrp')}   AS rrp,
         ${safeNumeric('ss.cost')}  AS cost,
         ${safeNumeric('a.fbafee')} AS fbafee, ss.tax,
         COALESCE(a.amzlive, 0)  AS stock,
         COALESCE(sold.units, 0) AS sold30,
         ss.portfolio_status     AS status,
         live.group_id, live.name AS group_name, live.state AS slider_state
  FROM amzfeed a
  JOIN skusummary ss      ON ss.groupid = a.groupid      -- inner: drops listings of styles deleted from our DB
  LEFT JOIN title t       ON t.groupid = a.groupid
  LEFT JOIN amz_now an    ON an.code = a.code
  LEFT JOIN sold          ON sold.code = a.code
  LEFT JOIN live          ON live.item_key = a.code
  WHERE a.code IS NOT NULL
  -- Size sorts numerically where it is a number (37 < 37.5 < 38), else as text (CLAUDE.md size landmine).
  ORDER BY a.groupid, CASE WHEN SUBSTRING(a.code FROM '[^-]*$') ~ '^[0-9]+([.][0-9]+)?$'
                           THEN SUBSTRING(a.code FROM '[^-]*$')::numeric END NULLS LAST, a.code
`;

router.get('/', async (req, res) => {
  try {
    const channel = typeof req.query.channel === 'string' ? req.query.channel.toUpperCase() : '';
    if (channel !== 'SHP' && channel !== 'AMZ') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'channel (SHP or AMZ) is required' });
    }

    const result = await query(channel === 'SHP' ? SHP_SQL : AMZ_SQL, [LIVE_STATES]);
    const rows = result.rows.map((r) => ({
      key: r.key,
      groupid: r.groupid,
      size: r.size,
      amz_sku: r.amz_sku,
      title: r.title || null,
      brand: r.brand || null,
      segment: r.segment || null,
      supplier: r.supplier || null,
      season: r.season || null,
      codes: r.codes || null,
      price: num(r.price),
      rrp: num(r.rrp),
      cost: num(r.cost),
      breakeven: breakevenFor(channel, { cost: r.cost, fbafee: r.fbafee, tax: r.tax }),
      stock: Number(r.stock) || 0,
      sold30: Number(r.sold30) || 0,
      status: r.status || null,
      slider: r.group_id ? { group_id: r.group_id, name: r.group_name, state: r.slider_state } : null,
    }));

    return res.json({ return_code: 'SUCCESS', channel, rows });
  } catch (err) {
    logger.error('[slider-candidates] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load products' });
  }
});

module.exports = router;
