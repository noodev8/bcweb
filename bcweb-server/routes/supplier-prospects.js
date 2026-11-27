/*
=======================================================================================================================================
API Route: supplier_prospects
=======================================================================================================================================
Method: GET
Purpose: Prospects → Rieker list (owner, 2026-11-27: "Start with what we can get and then see if it is worth it"). Every style on the
         supplier's stock list WITH stock that we don't stock, with how it sells on Amazon — its best-ranked size's overall Fashion
         rank, Buy Box, sellers — as the last scan found it (scripts/supplier-amazon-scan.js → supplier_amazon, run after each "load the
         Rieker list"), plus our cost from the list and the return on cost at that price (utils/prospect.js → returnOnCost, THE Amazon
         formula). Best rank first. ONLY RANKED STYLES (owner, 2026-11-27: "lets not even show no rank for now. we dont add them
         ourselves") — a style with no Fashion rank, or not on Amazon at all, is left out; the scan still stores them.
         "On the list" = a Prospects line (active or archived) carries the style's Amazon ASIN, or its name reads as the style
         (utils/supplierStock.js → lookup, the same code match as the saved lines' dots — a line's link is often another size).
         READ ONLY. Adding goes through prospect-save as usual. Requires auth.
=======================================================================================================================================
Request Query Params:
  supplier (string, optional) — 'rieker' (the only one)

Success Response:
{ "return_code": "SUCCESS",
  "list_date": "2026-11-27", "scanned_at": "2026-11-27T15:10:00Z" | null,      // the list, and when it was looked up on Amazon
  "rows": [
    { "style": "44650-02", "season": "Autumn/Winter", "cost": 30.05, "sizes": { "38": "limited" },
      "rrp_est": 70,                                 // ESTIMATED RRP from the cost (utils/supplierStock.js → estRrp) — whole pounds
      "asin": "B0…" | null, "title": "…" | null, "size": "6 UK" | null,
      "rank": 27296 | null, "rank_category": "Fashion" | null,
      "buybox": 42.89 | null, "lowest": 42.5 | null, "fba": 2 | null, "fbm": 8 | null,
      "return_on_cost": { "price": 42.89, "cost": 30.05, "profit": 1.2, "on_cost_pct": 4 } | null,
      "listed": { "id": 70, "archived": false } | null,
      "scanned": true }                                // false = the scan hasn't looked at this style yet (added by a newer load)
  ] }
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
const { returnOnCost } = require('../utils/prospect');
const supplierStock = require('../utils/supplierStock');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const supplier = String(req.query.supplier || 'rieker');
    const { rows } = await query(`
      SELECT st.style, st.season, st.cost::float AS cost, st.sizes, st.list_date::text AS list_date,
             sa.style IS NOT NULL AS scanned, sa.asin, sa.title, sa.size, sa.group_rank, sa.rank_category,
             sa.buybox, sa.lowest, sa.fba, sa.fbm, sa.scanned_at,
             pl.id AS listed_id, pl.archived AS listed_archived
        FROM supplier_stock st
        LEFT JOIN supplier_amazon sa ON sa.supplier = st.supplier AND sa.style = st.style
        LEFT JOIN LATERAL (
          SELECT p.id, p.archived_at IS NOT NULL AS archived
            FROM prospect p
           WHERE sa.asin IS NOT NULL AND (p.asin = sa.asin
                    OR EXISTS (SELECT 1 FROM prospect_check c WHERE c.prospect_id = p.id AND c.asin = sa.asin))
           ORDER BY p.archived_at IS NOT NULL, p.id
           LIMIT 1) pl ON true
       WHERE st.supplier = $1 AND st.sizes <> '{}'::jsonb
         AND NOT EXISTS (SELECT 1 FROM skusummary s WHERE s.groupid = st.style)
         AND sa.group_rank IS NOT NULL
       ORDER BY sa.group_rank, st.style`, [supplier]);

    // Lines matched by the code in their name — one lookup for every line (its id stands in for an ASIN).
    const lines = (await query(`SELECT id, name, archived_at IS NOT NULL AS archived FROM prospect ORDER BY archived_at IS NOT NULL, id`)).rows;
    const matched = await supplierStock.lookup(lines.map((l) => ({ asin: String(l.id), title: l.name })));
    const byStyle = new Map();
    for (const l of lines) {
      const m = matched.get(String(l.id));
      if (m && m.colour_sure && m.styles.length === 1 && !byStyle.has(m.styles[0].style)) byStyle.set(m.styles[0].style, l);
    }

    const out = rows.map((r) => {
      const price = num(r.buybox) ?? num(r.lowest);
      return {
        style: r.style, season: r.season, cost: r.cost, sizes: r.sizes, rrp_est: supplierStock.estRrp(supplier, r.cost),
        asin: r.asin, title: r.title, size: r.size, rank: r.group_rank, rank_category: r.rank_category,
        buybox: num(r.buybox), lowest: num(r.lowest), fba: r.fba, fbm: r.fbm,
        return_on_cost: price !== null && r.cost ? returnOnCost(String(price), String(r.cost)) : null,
        listed: r.listed_id ? { id: r.listed_id, archived: r.listed_archived }
          : byStyle.has(r.style) ? { id: byStyle.get(r.style).id, archived: byStyle.get(r.style).archived } : null,
        scanned: r.scanned,
      };
    });
    const scannedAt = rows.reduce((m, r) => (r.scanned_at && (!m || r.scanned_at > m) ? r.scanned_at : m), null);
    res.json({ return_code: 'SUCCESS', list_date: rows[0]?.list_date ?? null, scanned_at: scannedAt, rows: out });
  } catch (err) {
    logger.error('[supplier-prospects] error:', err.message);
    res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the supplier list' });
  }
});

module.exports = router;
