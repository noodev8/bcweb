/*
=======================================================================================================================================
API Route: pricing_vs_amazon
=======================================================================================================================================
Method: GET
Purpose: The "Shopify vs Amazon" screen (/pricing/vs-amazon, owner 2026-10-07). One row per style that is LIVE on Amazon, with the
         style's one Shopify price beside Amazon's per-size spread, so the operator can see where Shopify UNDERCUTS Amazon and lift it.

         Why it exists: Amazon can suppress the Buy Box when it sees the same item cheaper elsewhere. Shopify was quietly below Amazon's
         LOWEST on 8 of the 10 IVES colours when this was built. The owner's rule is "Shopify never below Amazon's HIGHEST live size",
         so `gap` = shopify − amazon_highest and the client sorts the most-negative gap first.

         This is NOT the retired match-Amazon autopilot (CLAUDE.md — "Shopify and Amazon prices are INDEPENDENT"): nothing here writes,
         nothing is automatic, and Amazon is never re-priced. The screen applies via the ordinary W1 (/pricing-apply), by hand.

Membership: a style with at least one amzfeed size IN STOCK at Amazon (amzlive > 0). A style listed but with nothing live has no
            Amazon price a customer can see, so there is nothing to compare against — it is left off (owner, 2026-10-07).
            The review cooldown (next_shopify_price_review) is deliberately IGNORED: this is a "don't undercut Amazon" check, not the
            repricing queue, so a parked style still shows.

Amazon spread: same definition as pricing-drill — MIN/MAX of amzprice over sizes with amzlive > 0, via safeNumeric (amzprice is a
               junk-prone VARCHAR). amzfeed is READ ONLY (CLAUDE.md).
=======================================================================================================================================
Request Query Params: none

Success Response:
{
  "return_code": "SUCCESS",
  "rows": [
    {
      "groupid": "FLE030-IVES-WHITE", "title": "Ives White …", "segment": "IVES", "supplier": "…",
      "codes": "FLE030-IVES-WHITE-05 … <Amazon SKUs>",   // for the client's Contains search (same haystack as Inventory)
      "price": 37.30, "cost": 18.00, "rrp": 45.00,       // safeNumeric — null on junk
      "stock": 14,                                       // Shopify sellable stock (#FREE localstock)
      "next_review": "2027-01-05",                       // next_shopify_price_review (YYYY-MM-DD) or null — the screen keeps a later one
      "amazon_lowest": 37.90, "amazon_highest": 41.69, "amazon_live": 36,
      "gap": -4.39,                                      // price − amazon_highest; null if price unknown
      "shp_30d": 2, "amz_30d": 11,                       // units sold, last 30 days, qty > 0 only
      "last_change": { "date": "2026-10-07", "by": "Andreas", "note": "Amazon Match", "price": 41.69 } | null,
      "sizes": [ { "size": "37", "qty": 2, "amz_price": 41.69, "amz_live": 4 }, … ]   // amz_price null = not on Amazon ("—")
    }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
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

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    // One pass for the style rows. Every per-style aggregate is pre-grouped in its own CTE and LEFT JOINed, so no join fans another out.
    // NB: no backticks anywhere in this string; it is a JS template literal.
    const styles = await query(`
      WITH amz AS (
        SELECT groupid,
               MIN(${safeNumeric('amzprice')}) AS lo,
               MAX(${safeNumeric('amzprice')}) AS hi,
               SUM(amzlive)                    AS live
        FROM amzfeed
        WHERE COALESCE(amzlive,0) > 0
        GROUP BY groupid
      ),
      stk AS (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY groupid
      ),
      sold AS (
        SELECT groupid,
               SUM(qty) FILTER (WHERE channel='SHP') AS shp,
               SUM(qty) FILTER (WHERE channel='AMZ') AS amz
        FROM sales
        WHERE qty > 0 AND solddate >= CURRENT_DATE - 30 AND channel IN ('SHP','AMZ')
        GROUP BY groupid
      ),
      codes AS (
        -- Same haystack source as inv-styles.js: internal size codes + Amazon Seller SKUs, so a pasted code finds its style.
        SELECT groupid,
               string_agg(code, ' ') || COALESCE(' ' || string_agg(sku, ' ') FILTER (WHERE sku IS NOT NULL), '') AS codes
        FROM skumap
        GROUP BY groupid
      ),
      last_chg AS (
        -- Most recent Shopify price change per style: who, when, what note — so an "Amazon Match" just applied is visible on the row.
        SELECT DISTINCT ON (groupid) groupid, change_date::text AS d, changed_by, reason_notes, new_price
        FROM price_change_log
        WHERE channel='SHP'
        ORDER BY groupid, change_date DESC, id DESC
      )
      SELECT ss.groupid, t.shopifytitle, ss.segment, NULLIF(TRIM(ss.supplier),'') AS supplier, c.codes,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.cost')}         AS cost,
             ${safeNumeric('ss.rrp')}          AS rrp,
             COALESCE(st.stock,0)              AS stock,
             ss.next_shopify_price_review::text AS next_review,   -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             a.lo, a.hi, a.live,
             COALESCE(so.shp,0) AS shp_30d, COALESCE(so.amz,0) AS amz_30d,
             lc.d AS last_date, lc.changed_by AS last_by, lc.reason_notes AS last_note, lc.new_price AS last_price
      FROM amz a
      JOIN skusummary ss ON ss.groupid = a.groupid
      LEFT JOIN title t     ON t.groupid  = ss.groupid
      LEFT JOIN stk st      ON st.groupid = ss.groupid
      LEFT JOIN sold so     ON so.groupid = ss.groupid
      LEFT JOIN codes c     ON c.groupid  = ss.groupid
      LEFT JOIN last_chg lc ON lc.groupid = ss.groupid
      WHERE a.hi IS NOT NULL
    `);

    // Per-size detail for every listed style in ONE query (no N+1). Same shape and rules as pricing-drill's sizes[]: full size range
    // from skumap, stock and Amazon each pre-aggregated per (groupid,size) so multiple rows per code can't fan the sizes out.
    // Size = suffix after the last '-' (CLAUDE.md — never RIGHT(code,2)).
    const groupids = styles.rows.map((r) => r.groupid);
    const sizesResult = groupids.length === 0 ? { rows: [] } : await query(`
      SELECT sz.groupid, sz.size, COALESCE(st.qty,0) AS qty, af.amz_price, COALESCE(af.amz_live,0) AS amz_live
      FROM (
        SELECT DISTINCT groupid, SUBSTRING(code FROM '[^-]*$') AS size
        FROM skumap WHERE groupid = ANY($1) AND COALESCE(deleted,0)=0
      ) sz
      LEFT JOIN (
        SELECT groupid, SUBSTRING(code FROM '[^-]*$') AS size, SUM(qty) AS qty FROM localstock
        WHERE groupid = ANY($1) AND ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY 1, 2
      ) st ON st.groupid = sz.groupid AND st.size = sz.size
      LEFT JOIN (
        SELECT groupid, SUBSTRING(code FROM '[^-]*$') AS size,
               MAX(${safeNumeric('amzprice')}) AS amz_price,
               SUM(COALESCE(amzlive,0))        AS amz_live
        FROM amzfeed WHERE groupid = ANY($1)
        GROUP BY 1, 2
      ) af ON af.groupid = sz.groupid AND af.size = sz.size
      ORDER BY sz.groupid,
               CASE WHEN sz.size ~ '^[0-9]+([.][0-9]+)?$' THEN sz.size::numeric END NULLS LAST,
               sz.size
    `, [groupids]);

    const sizesBy = new Map();
    for (const r of sizesResult.rows) {
      if (!sizesBy.has(r.groupid)) sizesBy.set(r.groupid, []);
      sizesBy.get(r.groupid).push({
        size: r.size,
        qty: Number(r.qty),
        amz_price: num(r.amz_price),   // null = size not on Amazon at all — render "—", never 0
        amz_live: Number(r.amz_live),
      });
    }

    const rows = styles.rows.map((r) => {
      const price = num(r.price);
      const hi = num(r.hi);
      return {
        groupid: r.groupid,
        title: r.shopifytitle || null,
        segment: r.segment || null,
        supplier: r.supplier || null,
        codes: r.codes || null,
        price,
        cost: num(r.cost),
        rrp: num(r.rrp),
        stock: Number(r.stock),
        next_review: r.next_review || null,
        amazon_lowest: num(r.lo),
        amazon_highest: hi,
        amazon_live: Number(r.live),
        gap: price !== null && hi !== null ? Math.round((price - hi) * 100) / 100 : null,
        shp_30d: Number(r.shp_30d),
        amz_30d: Number(r.amz_30d),
        last_change: r.last_date
          ? { date: r.last_date, by: r.last_by || null, note: r.last_note || null, price: num(r.last_price) }
          : null,
        sizes: sizesBy.get(r.groupid) || [],
      };
    });

    return res.json({ return_code: 'SUCCESS', rows });
  } catch (err) {
    logger.error('[pricing-vs-amazon] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Shopify vs Amazon' });
  }
});

module.exports = router;
