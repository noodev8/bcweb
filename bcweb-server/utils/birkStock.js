/*
=======================================================================================================================================
Util: birkStock — the Birk Tracker "Full count" gauge (Analytics module).
=======================================================================================================================================
Purpose: Compute the current Birkenstock core-size availability snapshot, self-contained for the bcweb Analytics module. Ported from
         the reference tool C:\scripts\birk-stock\availability.py (its "locked output": Full / Styles).

           - Styles = every Birkenstock style whose size grid (skumap) offers ALL of the women's core sizes 38/39/40. No sales filter.
                      Requiring 38/39/40 in the grid drops men's-only grids (no 38). This is the in-range ceiling.
           - Full   = of those, the styles holding all three core sizes in FREE stock right now (any qty; 1+1+1 counts). The number the
                      owner acts on — the breadth of core-complete product Google Ads spend can ride.

Schema landmines respected (CLAUDE.md):
  - Stock is read from localstock FREE rows only (ordernum='#FREE' AND deleted=0 AND qty>0) — never skusummary.stockvariants/variants.
  - Size is parsed off the variant code; the reference uses the substring after the final '-', so we keep that exact rule here.
=======================================================================================================================================
*/

const { query } = require('../database');

const CORE_SIZES = [38, 39, 40]; // women's core; men's-only grids (no 38) fall out of the "grid offers all three" gate
const BRAND = 'Birkenstock';

// Compute the current snapshot. Returns { full, styles, totalFree, coreFree }.
//   - full / styles : the core-size BREADTH gauge (mirrors availability.py — brand -> grid offering all core sizes -> count Full).
//   - totalFree      : ALL Birkenstock FREE units on hand (every size) — the whole tank / fuel level.
//   - coreFree       : FREE units at the core sizes 38/39/40 — core depth within that tank.
// The two totals are deliberately across the WHOLE Birk range (not just the in-range grid subset the Full count uses): the tank is
// the tank. Two small round-trips (breadth query + totals query) — both cheap.
async function computeBirkSnapshot() {
  const coreList = CORE_SIZES.join(',');
  const result = await query(
    `
    WITH birk AS (
      SELECT groupid FROM skusummary WHERE brand = $1
    ),
    grid AS (
      -- styles whose grid offers ALL core sizes (drops men's-only grids)
      SELECT sm.groupid
      FROM skumap sm
      JOIN birk b ON b.groupid = sm.groupid
      WHERE sm.deleted = 0 AND sm.code ~ '-[0-9]+$'
        AND (REGEXP_REPLACE(sm.code, '^.*-', ''))::int IN (${coreList})
      GROUP BY sm.groupid
      HAVING COUNT(DISTINCT (REGEXP_REPLACE(sm.code, '^.*-', ''))::int) = ${CORE_SIZES.length}
    ),
    corestock AS (
      -- FREE stock per core size for those styles
      SELECT ls.groupid, (REGEXP_REPLACE(ls.code, '^.*-', ''))::int AS size, SUM(ls.qty) AS qty
      FROM localstock ls
      JOIN birk b ON b.groupid = ls.groupid
      WHERE ls.ordernum = '#FREE' AND ls.deleted = 0 AND ls.qty > 0
        AND ls.code ~ '-[0-9]+$'
        AND (REGEXP_REPLACE(ls.code, '^.*-', ''))::int IN (${coreList})
      GROUP BY 1, 2
    ),
    per AS (
      SELECT g.groupid,
             COUNT(DISTINCT cs.size) FILTER (WHERE cs.qty > 0) AS sizes_in_stock
      FROM grid g
      LEFT JOIN corestock cs ON cs.groupid = g.groupid
      GROUP BY g.groupid
    )
    SELECT COUNT(*)::int AS styles,
           COUNT(*) FILTER (WHERE sizes_in_stock = ${CORE_SIZES.length})::int AS full_count
    FROM per
    `,
    [BRAND]
  );

  const row = result.rows[0] || { styles: 0, full_count: 0 };

  // Total & core FREE-stock levels across the whole Birk range (the "fuel gauge"). Same FREE-row rule as the breadth query.
  const totals = await query(
    `
    SELECT
      COALESCE(SUM(ls.qty), 0)::int AS total_free,
      COALESCE(SUM(ls.qty) FILTER (
        WHERE ls.code ~ '-[0-9]+$'
          AND (REGEXP_REPLACE(ls.code, '^.*-', ''))::int IN (${coreList})
      ), 0)::int AS core_free
    FROM localstock ls
    JOIN skusummary k ON k.groupid = ls.groupid AND k.brand = $1
    WHERE ls.ordernum = '#FREE' AND ls.deleted = 0 AND ls.qty > 0
    `,
    [BRAND]
  );
  const t = totals.rows[0] || { total_free: 0, core_free: 0 };

  return {
    full: Number(row.full_count) || 0,
    styles: Number(row.styles) || 0,
    totalFree: Number(t.total_free) || 0,
    coreFree: Number(t.core_free) || 0,
  };
}

module.exports = { computeBirkSnapshot, CORE_SIZES, BRAND };
