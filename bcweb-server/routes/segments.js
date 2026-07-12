/*
=======================================================================================================================================
API Route: segments
=======================================================================================================================================
Method: GET
Purpose: Step 3 of the Segments module (docs/segments-spec.md §3, §5) — the overview "heatmap" read. Returns one row per ACTIVE
         segment with a live importance gutter (revenue + gross-profit %) and, for each work area, that review clock's due state.
         This is the front door that answers "which segment do I click and work on next".

Self-healing (spec §6-A): the read runs the reconcile FIRST, so a newly-tagged segment (or a newly-added area) shows up with its
clocks already seeded — no separate maintenance step. Reconcile is best-effort: if it fails we log and still serve the current
registry rather than blank the whole dashboard.

Importance gutter (spec §3): revenue/GP are computed LIVE, never stored. Revenue = SUM(qty × soldprice) over the window across ALL
channels (SHP + AMZ + …) — a segment's total worth, not just its Shopify slice — because one of the three areas is Amazon and ~46%
of units sell there. GP% = (revenue − COGS)/revenue, COGS = SUM(qty × skusummary.cost). Cost is a legacy VARCHAR → safeNumeric.

Due state per area (spec §4): from segment_area_state.next_review_date vs CURRENT_DATE —
  off    (grey)  = off = true (operator flagged this area N/A for this segment, e.g. EVA-SEG on Amazon) — checked first,
                   independent of the date, so a stale next_review_date underneath doesn't leak through
  overdue(red)   = next_review_date < today OR next_review_date IS NULL (never worked → straight to overdue, no separate
                   "never" state) → daysOverdue = today − next_review_date, or 0 when never worked (no baseline date)
  due-soon(amber)= due within AMBER_DAYS (incl. today)
  ok     (green) = further out
Last-worked (who/when) is the most recent segment_worklog row for that (segment, area).

DERIVED Shopify clock (spec §9 — CHANGE 2026-07-11): the SHOPIFY area no longer reads its manual next_review_date. Instead its due
state is COMPUTED from the products' own review dates — the same in-stock / un-parked pool triage & losers draw from — so the segment
can't disagree with its styles (§9.2). One extra set-based query (grouped by ss.segment) counts, per segment: `instock` (live +
in-stock styles) and `outstanding` (of those, un-parked → still need pricing). utils/segmentDerived.js maps those to dueState
'due' (outstanding>0, RED, cell shows "12 / 30 waiting") / 'ok' (all parked, GREEN, cell shows when the soonest parked style returns),
with the operator's `off` flag still short-circuiting. The AMAZON area derives the same way at SKU grain (§10 — FBA-in-stock SKUs from
amzfeed, per-SKU review date on skumap.next_amz_price_review). Both pricing cells carry the extra `outstanding`/`instock` counts; only
the manual clock (Housekeeping) leaves them null and keeps the classifyDue path above.

Heat (🔥) is a deferred fast-follow (spec §3/§7) — returned as null for now.
=======================================================================================================================================
Request Query Params:
  days  (int, optional)  - revenue/GP lookback window in days; default 30 (matches the gutter label "Rev(30d)").

Success Response:
{
  "return_code": "SUCCESS",
  "days": 30,
  "segments": [
    {
      "name": "EVA-SEG",
      "revenue30": 9314.74,
      "gpPct": 44,
      "heat": null,
      "areas": [
        { "area": "Shopify", "cadenceDays": 30, "dueState": "due", "daysOverdue": 0, "outstanding": 12, "instock": 30,
          "nextReview": null, "lastWorkedBy": null, "lastWorkedAt": null },   // DERIVED (§9): 12 of 30 in-stock styles un-parked
        { "area": "Housekeeping", "cadenceDays": 91, "dueState": "overdue", "daysOverdue": 0, "outstanding": null, "instock": null,
          "nextReview": null, "lastWorkedBy": null, "lastWorkedAt": null },   // manual clock: never worked → overdue, daysOverdue 0
        ...  // ordered by area.sort
      ]
    },
    ...  // ordered by revenue30 desc (importance); client may re-sort by worst-overdue
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
const { withTransaction } = require('../utils/transaction');
const { reconcileSegments } = require('../utils/segmentReconcile');
const { safeNumeric } = require('../utils/sql');
const { classifyDue, isoDate } = require('../utils/segmentDue');
const { deriveShopify } = require('../utils/segmentDerived');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 30;

    // 1) Self-heal the registry (best-effort — never let a reconcile hiccup blank the dashboard).
    try {
      await withTransaction((client) => reconcileSegments(client));
    } catch (recErr) {
      logger.warn('[segments] reconcile failed, serving current registry:', recErr.message);
    }

    // 2) Importance gutter — live revenue + COGS per segment, all channels, over the window. Keyed by segment name.
    const rev = await query(`
      SELECT ss.segment AS name,
             SUM(s.qty * s.soldprice)                 AS revenue,
             SUM(s.qty * ${safeNumeric('ss.cost')})   AS cogs
      FROM sales s
      JOIN skusummary ss ON ss.groupid = s.groupid
      WHERE s.qty > 0 AND s.soldprice > 0
        AND s.solddate >= CURRENT_DATE - $1::int
      GROUP BY ss.segment
    `, [days]);

    const revByName = new Map();
    for (const r of rev.rows) {
      const revenue = r.revenue === null ? 0 : Number(r.revenue);
      const cogs = r.cogs === null ? null : Number(r.cogs);
      const gpPct = revenue > 0 && cogs !== null ? Math.round(((revenue - cogs) / revenue) * 100) : null;
      revByName.set(r.name, { revenue30: Math.round(revenue * 100) / 100, gpPct });
    }

    // 2b) Derived SHOPIFY clock (spec §9.3) — per segment, how many pricing-ACTIONABLE styles still need pricing (un-parked) vs are
    //     parked into the future. The candidate pool is deliberately NOT "every in-stock style": it is exactly the union of what the
    //     WINNERS and LOSERS job-lists surface, so the heatmap count can always be driven to zero by working those two lists. Without
    //     this, "healthy-middle" styles (in stock, un-parked, but neither a fast recent seller nor dead/slow) counted as outstanding
    //     yet appeared in no job-list — the segment could never go green and "0/9" looked like unclearable work (owner-reported).
    //
    //     A style is ACTIONABLE when it is one of (mirrors pricing-triage / pricing-losers membership, same default windows):
    //       - WINNER: sold > 0 units on Shopify in the last 30 days, OR
    //       - DEAD:   no Shopify sales in the last 90 days (u90 = 0), OR
    //       - SLOW:   cover = stock × (90/7) / u90 ≥ 26 weeks (~6 months).
    //     The healthy middle (some 90d sales, nothing in 30d, cover < 26wk) is excluded — genuinely nothing to do. `instock` here is
    //     therefore the ACTIONABLE count (the denominator the cell shows), not the raw in-stock count. Parking is unaffected by sales,
    //     so a parked-but-actionable style is "done" (drops out of outstanding) until its review lapses. COUNT..FILTER counts a
    //     winner-and-slow style once (no double-count). Same candidate stock pool as triage/losers (localstock #FREE).
    const shp = await query(`
      WITH stk AS (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
        GROUP BY groupid
      ),
      s30 AS (   -- 30d Shopify units (winner test)
        SELECT groupid, SUM(qty) AS u30 FROM sales
        WHERE channel = 'SHP' AND qty > 0 AND soldprice > 0 AND solddate >= CURRENT_DATE - 30
        GROUP BY groupid
      ),
      s90 AS (   -- 90d Shopify units (dead / slow test)
        SELECT groupid, SUM(qty) AS u90 FROM sales
        WHERE channel = 'SHP' AND qty > 0 AND soldprice > 0 AND solddate >= CURRENT_DATE - 90
        GROUP BY groupid
      ),
      cand AS (
        SELECT ss.segment AS name,
               ss.next_shopify_price_review AS review,
               ( COALESCE(s30.u30, 0) > 0                                              -- WINNER
                 OR COALESCE(s90.u90, 0) = 0                                           -- DEAD
                 OR stk.stock * (90 / 7.0) / NULLIF(s90.u90, 0) >= 26 ) AS actionable  -- SLOW (cover >= 26wk)
        FROM skusummary ss
        JOIN stk ON stk.groupid = ss.groupid          -- INNER JOIN drops 0-stock styles (nothing to price)
        LEFT JOIN s30 ON s30.groupid = ss.groupid
        LEFT JOIN s90 ON s90.groupid = ss.groupid
        WHERE ss.shopify = 1                           -- live on Shopify only
      )
      SELECT name,
             COUNT(*) FILTER (WHERE actionable)::int AS instock,
             COUNT(*) FILTER (WHERE actionable
                                AND (review IS NULL OR review <= CURRENT_DATE))::int AS outstanding,
             MIN(review) FILTER (WHERE actionable AND review > CURRENT_DATE) AS next_wake
      FROM cand
      GROUP BY name
    `);
    const shopifyByName = new Map();
    for (const r of shp.rows) {
      shopifyByName.set(r.name, { instock: r.instock, outstanding: r.outstanding, nextWake: r.next_wake });
    }

    // 2c) Derived AMAZON clock (spec §10.3) — the SKU-grain twin of the Shopify block. Candidate pool = FBA-in-stock SKUs
    //     (amzfeed.amzlive>0, the same pool amz-winners/amz-losers draw from); the per-SKU review date lives on skumap
    //     (next_amz_price_review). code is unique in skumap and every in-stock amzfeed SKU has a skumap row, so the join is 1:1
    //     and can't double-count. Keyed by segment name; merged onto the Amazon area cell below via the same deriveShopify helper.
    //
    //     NOTE — unlike Shopify (block 2b), this deliberately counts EVERY un-parked in-stock SKU, with NO "actionable" sales filter,
    //     because on Amazon that filter would be a no-op: every in-stock un-parked SKU is already a WINNER or a LOSER, so
    //     un-parked-in-stock == WINNERS ∪ LOSERS and there is no "healthy middle" to exclude. Why it holds: WINNER = sold in 30d
    //     (amz-winners), DEAD = NO sale in 14d (amz-losers). The 14d dead window is NESTED inside the 30d winner window, so a SKU with
    //     no 30d sale necessarily has no 14d sale → it's DEAD (a loser). No gap. (Shopify's gap existed only because its DEAD window,
    //     90d, is LONGER than its 30d winner window.) VERIFIED on prod 2026-07-12: IVES-COLOUR 51 in-stock, healthy-middle gap = 0.
    //     LANDMINE: if the Amazon DEAD window in amz-losers.js is ever lengthened past 30d, this nesting breaks and a gap reappears —
    //     at that point mirror block 2b's actionable-count CTEs here.
    const amz = await query(`
      SELECT sk.segment AS name,
             COUNT(*)::int AS instock,
             COUNT(*) FILTER (WHERE m.next_amz_price_review IS NULL
                                 OR m.next_amz_price_review <= CURRENT_DATE)::int AS outstanding,
             MIN(m.next_amz_price_review)
               FILTER (WHERE m.next_amz_price_review > CURRENT_DATE) AS next_wake
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN skumap m ON m.code = a.code               -- 1:1 (code unique in skumap; every in-stock amzfeed SKU has a skumap row)
      WHERE COALESCE(a.amzlive, 0) > 0               -- in FBA stock now (nothing to price on an out-of-stock SKU)
      GROUP BY sk.segment
    `);
    const amazonByName = new Map();
    for (const r of amz.rows) {
      amazonByName.set(r.name, { instock: r.instock, outstanding: r.outstanding, nextWake: r.next_wake });
    }

    // 3) Clocks + last-worked for every ACTIVE segment × ACTIVE area. One set-based query (no N+1), ordered for assembly.
    const clocks = await query(`
      SELECT s.name AS segment, a.name AS area, a.sort,
             st.cadence_days,
             st.next_review_date,
             st.off,
             (CURRENT_DATE - st.next_review_date) AS days_over,
             lw.worked_by AS last_worked_by,
             lw.worked_at AS last_worked_at
      FROM segment s
      JOIN segment_area_state st ON st.segment_id = s.id
      JOIN area a ON a.id = st.area_id AND a.active = true
      LEFT JOIN LATERAL (
        SELECT worked_by, worked_at
        FROM segment_worklog w
        WHERE w.segment_id = s.id AND w.area_id = a.id
        ORDER BY w.worked_at DESC
        LIMIT 1
      ) lw ON true
      WHERE s.active = true
      ORDER BY s.name, a.sort
    `);

    // 4) Assemble: group clock rows by segment, attach the live gutter, compute due state.
    const bySegment = new Map();
    for (const c of clocks.rows) {
      if (!bySegment.has(c.segment)) {
        const gutter = revByName.get(c.segment) || { revenue30: 0, gpPct: null };
        bySegment.set(c.segment, { name: c.segment, revenue30: gutter.revenue30, gpPct: gutter.gpPct, heat: null, areas: [] });
      }
      const daysOver = c.days_over === null ? null : Number(c.days_over);
      // Shopify AND Amazon are DERIVED clocks (§9/§10 — computed from the products' own review dates); Housekeeping (and any future
      // manual area) keeps the manual next_review_date classification. Both pricing areas use the same grain-agnostic deriveShopify.
      const areaName = c.area.toLowerCase();
      const derived =
        areaName === 'shopify' ? deriveShopify(shopifyByName.get(c.segment), c.off) :
        areaName === 'amazon' ? deriveShopify(amazonByName.get(c.segment), c.off) :
        null;
      bySegment.get(c.segment).areas.push({
        area: c.area,
        cadenceDays: c.cadence_days,
        dueState: derived ? derived.dueState : classifyDue(daysOver, c.off),
        daysOverdue: derived ? 0 : (daysOver !== null && daysOver > 0 ? daysOver : 0),
        nextReview: derived ? derived.nextReview : isoDate(c.next_review_date),
        outstanding: derived ? derived.outstanding : null,   // derived (Shopify) only; null for manual clocks
        instock: derived ? derived.instock : null,
        lastWorkedBy: c.last_worked_by || null,
        lastWorkedAt: c.last_worked_at ? c.last_worked_at.toISOString() : null,
      });
    }

    // Default order = importance (revenue desc); the client can offer a "worst-overdue" re-sort (spec §3).
    const segments = Array.from(bySegment.values()).sort((a, b) => b.revenue30 - a.revenue30);

    return res.json({ return_code: 'SUCCESS', days, segments });
  } catch (err) {
    logger.error('[segments] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load segments overview' });
  }
});

module.exports = router;
