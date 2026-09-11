/*
=======================================================================================================================================
Util: financeStock
=======================================================================================================================================
Purpose: The stock VALUATION shown on the Month End screen — units held and what they cost us. Spec: docs/finance-month-end-spec.md §3.6.
         Display only: it is not a QuickFile line. It replaces typing the figure into Brookfield-Finance.xls each month.

NAME COLLISION — DO NOT CONFUSE THIS WITH utils/stockPosition.js
Analytics already has a "Stock Position" module. That one COUNTS products that are commercially alive (a living-catalogue gauge, four
buckets, per channel). This one is a VALUATION in pounds. Same words, different measures, and they will never agree — which is fine,
because they are not measuring the same thing.

WHAT COUNTS AS STOCK (agreed with the owner, ported from C:\scripts\month-end\stock_position.py)
  - Local: localstock where deleted = 0 AND ordernum = '#FREE'. Sellable, owned stock. Units allocated to an open order are NOT
    counted — that value is already accounted for in revenue.
  - Amazon: amzfeed.amztotal, the units Amazon holds. A separate physical location that localstock does not represent.
  - Cost: skusummary.cost per groupid.

The C3-Amazon staging location is deliberately NOT added on top. The legacy PowerBuilder figure added it to the Amazon side while
those same units were already sitting in localstock as #FREE rows, so it double-counted them. This does not.
=======================================================================================================================================
Exports:
  stockValue()  -> { units, value }   (async)
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');

// Aggregating to groupid BEFORE applying cost is equivalent to valuing each code separately, because every code within a groupid
// shares one cost. It is also one pass instead of a join per row.
//
// skusummary.cost is a legacy VARCHAR that can hold junk ('RRP' is a real value in this database), so it goes through safeNumeric
// and degrades to NULL -> 0 rather than throwing (CLAUDE.md schema landmines). A style with no usable cost values at 0 and its units
// still count, which is the honest reading: we hold the stock, we just cannot price it.
const STOCK_VALUE_SQL = `
  WITH local_free AS (
    SELECT groupid, SUM(qty) AS qty
    FROM localstock
    WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE'
    GROUP BY groupid
  ),
  amz AS (
    SELECT groupid, SUM(amztotal) AS qty
    FROM amzfeed
    WHERE groupid IS NOT NULL
    GROUP BY groupid
  ),
  gids AS (
    SELECT groupid FROM local_free
    UNION
    SELECT groupid FROM amz
  )
  SELECT
    COALESCE(SUM(COALESCE(lf.qty, 0) + COALESCE(a.qty, 0)), 0) AS units,
    COALESCE(SUM(
      (COALESCE(lf.qty, 0) + COALESCE(a.qty, 0)) * COALESCE(${safeNumeric('ss.cost')}, 0)
    ), 0) AS value
  FROM gids g
  LEFT JOIN local_free lf ON lf.groupid = g.groupid
  LEFT JOIN amz        a  ON a.groupid  = g.groupid
  LEFT JOIN skusummary ss ON ss.groupid = g.groupid
`;

/** Units held and their cost value, right now. Read-only. */
async function stockValue() {
  const res = await query(STOCK_VALUE_SQL);
  const row = res.rows[0] || { units: 0, value: 0 };
  return {
    units: Number(row.units) || 0,
    value: Math.round(Number(row.value) * 100) / 100 || 0,
  };
}

module.exports = { stockValue };
