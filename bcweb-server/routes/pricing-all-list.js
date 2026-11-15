/*
=======================================================================================================================================
API Route: pricing_all_list
=======================================================================================================================================
Method: GET
Purpose: Shopify Pricing's home list — EVERY in-stock Shopify style, not one segment (owner, 2026-10-26: "shouldn't go off segments —
         just be a list of all, with a due and not due toggle"). Membership = live on Shopify (skusummary.shopify = 1) with sellable
         local stock (localstock #FREE — CLAUDE.md, never stockvariants). One unsplit list: no Selling / Stuck bars.

         PLUS every style on a Repricing STATUS list, out of stock or not (owner, 2026-10-28: "dashboard should cover everything" —
         Repricing showed 0-stock Birkenstocks as Due that Daily's Pricing count, read from here, missed). So membership = in stock
         (and shopify = 1) OR carries a portfolio status with a Shopify lead channel — exactly pricing-status-list's rows, same
         channelFilterSql. Nothing Repricing calls Due can be left off this list or the dashboard. 0-stock rows sort last.

         Same row shape as pricing-status-list, so /pricing/all?by=all renders it with the same table, drill,
         Due switch and bulk bar. Apply is the usual W1.

         Order: most stock first, then groupid. Parked styles (skusummary.next_shopify_price_review in the future) are dropped unless
         ?parked=include — the Due switch.

Requires auth.
=======================================================================================================================================
Request: GET /pricing-all-list[?parked=include][&limit=N][&cards=1][&step=<ladder step>]
  limit    safety cap only (utils/listLimit.js, default 100 / max 500).
  step     a STOCK LADDER step key (utils/stockLadder.js → STEPS, e.g. arrived): only the styles holding at least one SKU on that
           step (owner, 2026-11-15: Range's Arrived box opens a choice — Amazon New cards | Shopify cards for the Arrived styles).
           Narrows the list's own membership, never widens it; any brand. Unknown key = ignored.
           A STUCK step (3 Unsold 90 and on) also needs EVERY held SKU of the style on step 3 or later (owner, 2026-11-15, option A):
           a card there sets the STYLE price, and a style still holding an Arrived / Sold 90 size must never be cut to clear its dead
           sizes (CLAUDE.md — that is a size price's job, not built on the card yet). That day Unsold 90 had 135 styles: 56 whole-stuck.
           More exactly: NO held SKU on an EARLIER step than the one asked for, so a style sits on ONE stuck step — the step of its
           freshest size (Unsold 180, 2026-11-15: a style holding Unsold 90 and Unsold 180 sizes is an Unsold 90 card, never both,
           and the reason line's "no size has sold for n days" always fits the step).
           Each row then also carries `step_skus` — the style's SKU codes on that step — so Range's choice screen can show SKU
           figures that add up (owner, 2026-11-15: "fine as long as we see numbers on the screen that add up") — and
           `step_idle_days`: the FRESHEST of the style's held SKUs' days without a sale (the ladder's clock, any step), for the Shopify
           card's reason line (owner, same day: "will I know why it is there?"), with `step_held` (how many of the style's sizes we
           hold) and `style_last_sale_days` (days since ANY size of the style last sold, net — sold-out sizes included, utils/onShelf
           → lastNetSales). Why the last two: most stuck cards are a SELLING style's leftover sizes (that day 39 of 46 Unsold 90
           styles, 5 of 6 Unsold 180, had a sold-out size sell more recently than the sizes held — e.g. 1 size left, unsold 263
           days, the style last sold 4 days ago), so "no size has sold" would have been false.
  cards    1 = the SHOPIFY PRICE CARDS (owner, 2026-11-15, docs/shopify-cards/PLAN.md; components/ShopifyPriceCards): each returned
           row also carries `card` — picture, Shopify handle, profit line, Amazon's dearest live size, the last price change and every
           size with its Google benchmark and any size price in force (utils/shopifyCards.js, THE copy) — and the response carries
           `benchmark_day`, the last Google read. Same rows, same order, so the cards walk exactly what the list shows.

  step=overstocked   THE OVERSTOCK CARDS (owner, 2026-11-15, docs/overstock/PLAN.md): the styles holding an OVERSTOCKED size (the
           ladder's label on step 2 — any other size may be selling, that's the point: the overstocked ones get a SIZE price, never the
           style). step_skus = the overstocked codes; each row also carries `over_sizes` (utils/overstockCards.js — held, at Amazon,
           pairs over, sold 90d per overstocked size, size order).
  cards=1 also marks, on each size with a size price in force, `own_kind` (clearance | overstock) and — only when an overstock one is
           on the page — `overstocked` (is the size overstocked NOW), for the "no longer overstocked" reminder (decision 6).

Success Response:
{
  "return_code": "SUCCESS",
  "total": 205, "truncated": false, "out_of_stock": 12,     // rows listed for their status with no sellable stock
  "rows": [ { "rank": 1, "groupid": "…", "title": "…", "brand": "…", "price": 69.95, "rrp": 85, "stock": 5, "u30": 2,
              "match_amazon": false, "next_review": null, "parked": false }, ... ]
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
const { parseListLimit } = require('../utils/listLimit');
const { STATUSES, channelFilterSql } = require('../utils/portfolioStatus');
const logger = require('../utils/logger');
const { cardDetails } = require('../utils/shopifyCards');
const { STEPS, readStockLadder } = require('../utils/stockLadder');
const { lastNetSales } = require('../utils/onShelf');
const { overstockSizes } = require('../utils/overstockCards');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';
    const withCards = req.query.cards === '1';
    // STEP (header): the styles with a SKU on that ladder step, or null = no narrowing.
    // 'overstocked' is the ladder's LABEL on step 2, not a step: its own membership (header).
    const overMode = req.query.step === 'overstocked';
    const stepKey = overMode ? 'overstocked' : STEPS.some((s) => s.key === req.query.step) ? req.query.step : null;
    const stepOf = overMode ? 2 : stepKey ? STEPS.find((s) => s.key === stepKey).step : null;
    let overOf = new Map();        // overstocked: groupid -> its overstocked sizes (utils/overstockCards.js)
    let stepGroups = null;
    const stepCodes = new Map();   // groupid -> its SKU codes on the step
    const freshest = new Map();    // groupid -> the lowest idle_days of any held SKU (the ladder's clock)
    const held = new Map();        // groupid -> how many of its SKUs we hold
    let today = null;
    if (stepKey) {
      const ladder = await readStockLadder();
      const { skus } = ladder;
      today = ladder.today;
      for (const s of skus) {
        if (!freshest.has(s.groupid) || s.idle_days < freshest.get(s.groupid)) freshest.set(s.groupid, s.idle_days);
        held.set(s.groupid, (held.get(s.groupid) || 0) + 1);
      }
      // On a stuck step: the styles holding a size on an earlier step (new, selling, or stuck for less time) are left out.
      const live = new Set(skus.filter((s) => s.step < stepOf).map((s) => s.groupid));
      for (const s of skus) {
        if (overMode ? !s.overstocked : (s.step !== stepOf || (stepOf >= 3 && live.has(s.groupid)))) continue;
        if (!stepCodes.has(s.groupid)) stepCodes.set(s.groupid, []);
        stepCodes.get(s.groupid).push(s.code);
      }
      stepGroups = [...stepCodes.keys()];
      if (overMode) overOf = await overstockSizes({ query }, skus);
    }

    // $1 limit, $2 includeParked, $3 statuses, $4 the step's styles (NULL = all). Stock and 30-day units as on pricing-status-list (the shared table).
    const result = await query(`
      WITH stk AS (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY groupid
      ),
      win AS (
        SELECT groupid, SUM(qty) AS u30 FROM sales
        WHERE channel='SHP' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30
        GROUP BY groupid
      )
      SELECT ss.groupid,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.rrp')} AS rrp,
             COALESCE(st.stock, 0) AS stock,
             COALESCE(w.u30, 0) AS u30,
             ss.match_amazon_price AS match_amazon,
             t.shopifytitle,
             NULLIF(TRIM(ss.brand), '') AS brand,
             ss.next_shopify_price_review::text AS next_review,                 -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(ss.next_shopify_price_review > CURRENT_DATE, false) AS parked,
             COUNT(*) OVER () AS total_rows,
             COUNT(*) FILTER (WHERE st.stock IS NULL) OVER () AS oos_rows
      FROM skusummary ss
      LEFT JOIN stk st  ON st.groupid = ss.groupid        -- LEFT: status styles are listed out of stock too (see header)
      LEFT JOIN win w   ON w.groupid  = ss.groupid
      LEFT JOIN title t ON t.groupid  = ss.groupid
      WHERE ((ss.shopify = 1 AND st.groupid IS NOT NULL)
             OR (ss.portfolio_status = ANY($3::text[]) AND ${channelFilterSql('ss', 'SHP')}))
        AND ($2::boolean OR (ss.next_shopify_price_review IS NULL OR ss.next_shopify_price_review <= CURRENT_DATE))
        AND ($4::text[] IS NULL OR ss.groupid = ANY($4::text[]))
      -- Due before parked, so the safety cap can only ever trim parked rows (see amz-all-list.js — it bit there first).
      ORDER BY COALESCE(ss.next_shopify_price_review > CURRENT_DATE, false), COALESCE(st.stock, 0) DESC, ss.groupid
      LIMIT $1::int
    `, [limit, includeParked, STATUSES, stepGroups]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      groupid: r.groupid,
      title: r.shopifytitle || null,
      brand: r.brand || null,
      price: r.price === null || r.price === undefined ? null : Number(r.price),   // null when the legacy VARCHAR held junk/blank
      rrp: r.rrp === null || r.rrp === undefined ? null : Number(r.rrp),
      stock: Number(r.stock),
      u30: Number(r.u30),
      match_amazon: r.match_amazon === true,
      next_review: r.next_review || null,
      parked: r.parked === true,
      ...(stepKey ? { step_skus: stepCodes.get(r.groupid) ?? [], step_idle_days: freshest.get(r.groupid) ?? null } : {}),
      ...(overMode ? { over_sizes: overOf.get(r.groupid) ?? [] } : {}),
    }));

    // STYLE'S LAST SALE (header) — every size of the returned styles, held or sold out, in one read.
    if (stepKey && rows.length) {
      const codes = (await query(`SELECT code, groupid FROM skumap WHERE groupid = ANY($1::text[])`, [rows.map((r) => r.groupid)])).rows;
      const lastByCode = await lastNetSales(codes.map((c) => c.code));
      const lastByGroup = new Map();
      for (const c of codes) {
        const d = lastByCode.get(c.code);
        if (d && (!lastByGroup.has(c.groupid) || d > lastByGroup.get(c.groupid))) lastByGroup.set(c.groupid, d);
      }
      const dayN = (x) => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
      for (const r of rows) {
        const d = lastByGroup.get(r.groupid);
        r.step_held = held.get(r.groupid) ?? 0;
        r.style_last_sale_days = d ? dayN(today) - dayN(d) : null;
      }
    }
    const total = result.rows.length > 0 ? Number(result.rows[0].total_rows) : 0;
    const outOfStock = result.rows.length > 0 ? Number(result.rows[0].oos_rows) : 0;
    // CARDS (header, ?cards=1): the rest of each card, for the returned rows, in a fixed number of queries.
    let benchmarkDay;
    if (withCards) {
      const details = await cardDetails({ query }, rows.map((r) => r.groupid));
      for (const r of rows) r.card = details.byGroup[r.groupid] ?? null;
      benchmarkDay = details.benchmarkDay;
      // NO LONGER OVERSTOCKED (decision 6): only when an overstock markdown is on the page is the ladder read for it.
      const marked = rows.flatMap((r) => (r.card?.sizes ?? []).filter((z) => z.own_kind === 'overstock'));
      if (marked.length) {
        const now = new Set((await readStockLadder()).skus.filter((s) => s.overstocked).map((s) => s.code));
        for (const z of marked) z.overstocked = now.has(z.code);
      }
    }
    return res.json({ return_code: 'SUCCESS', total, truncated: rows.length < total, out_of_stock: outOfStock, rows,
      ...(withCards ? { benchmark_day: benchmarkDay } : {}) });
  } catch (err) {
    logger.error('[pricing-all-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Shopify list' });
  }
});

module.exports = router;
