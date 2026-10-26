/*
=======================================================================================================================================
Util: slowSizes
=======================================================================================================================================
Purpose: Every SIZE (code) we hold, with its idle clock — the list behind Back Office -> Slow Sizes (routes/analytics-slow-sizes.js)
         and the count on Process's CLEARANCE card (utils/processMap.js → clearanceCount). One function, so the card and the list's
         Clearance box can't count differently (owner, 2026-10-26: "lets use the same numbers").

IDLE = since the LATER of the size's last NET sale (any channel — a sale that came back is not a sale) and its oldest held pair's
         arrival (utils/onShelf.js → lastNetSales / idleSince — read that header). CLEARANCE = idle since on or before
         clearanceCutoff(today), i.e. CLEARANCE_MONTHS (9) calendar months — unsold anywhere for 9 months, and here that long.

STOCK = local #FREE not deleted + amzfeed.amztotal, LIVE — one number (utils/financeStock.js at code grain).

         READ-ONLY.
=======================================================================================================================================
Exports:
  readSlowSizes() -> { today, cutoff, sizes: [{ code, groupid, size, title, brand, units, last_sale, idle_days, idle_from,
                                                on_shelf, on_shelf_days, style_sold_12m, clearance }] }   // unsorted
=======================================================================================================================================
*/

const { query } = require('../database');
const { oldestHeldArrival, idleSince, lastNetSales, clearanceCutoff } = require('./onShelf');

// Held sizes with their style facts. Size is the suffix after the last dash (CLAUDE.md: not RIGHT(code,2)).
const SIZES_SQL = `
  WITH held AS (
    SELECT code, SUM(q)::int AS units FROM (
      SELECT code, qty AS q FROM localstock WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE'
      UNION ALL
      SELECT code, amztotal FROM amzfeed WHERE code IS NOT NULL
    ) x GROUP BY code HAVING SUM(q) > 0
  )
  SELECT h.code, h.units,
         COALESCE(m.groupid, h.code) AS groupid,
         SUBSTRING(h.code FROM '[^-]*$') AS size,
         t.shopifytitle AS title, NULLIF(TRIM(ss.brand), '') AS brand
  FROM held h
  LEFT JOIN skumap m      ON m.code     = h.code
  LEFT JOIN skusummary ss ON ss.groupid = m.groupid
  LEFT JOIN title t       ON t.groupid  = m.groupid
`;

// Whole days between two 'YYYY-MM-DD' strings, in UTC so BST never shifts a day.
const day = (x) => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

async function readSlowSizes() {
  const [sizesQ, todayQ, soldQ] = await Promise.all([
    query(SIZES_SQL),
    query(`SELECT to_char((now() AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS today`),
    query(`SELECT groupid, SUM(qty)::int AS q FROM sales
           WHERE solddate > (now() AT TIME ZONE 'Europe/London')::date - 365 AND groupid IS NOT NULL
           GROUP BY groupid`),
  ]);
  const today = todayQ.rows[0].today;
  const cutoff = clearanceCutoff(today);
  const codes = sizesQ.rows.map((r) => r.code);
  const [shelf, lastSale] = await Promise.all([
    oldestHeldArrival(new Map(sizesQ.rows.map((r) => [r.code, r.units]))),
    lastNetSales(codes),
  ]);
  const sold12m = new Map(soldQ.rows.map((r) => [r.groupid, r.q]));

  const sizes = sizesQ.rows.map((r) => {
    const onShelf = shelf.get(r.code);
    const last = lastSale.get(r.code) || null;
    const idle = idleSince(last, onShelf);   // held, so never null
    return {
      code: r.code,
      groupid: r.groupid,
      size: r.size,
      title: r.title || null,
      brand: r.brand || null,
      units: r.units,
      last_sale: last,
      idle_days: day(today) - day(idle.since),
      idle_from: idle.from,
      on_shelf: onShelf,
      on_shelf_days: day(today) - day(onShelf),
      style_sold_12m: sold12m.get(r.groupid) || 0,
      clearance: idle.since <= cutoff,
    };
  });
  return { today, cutoff, sizes };
}

module.exports = { readSlowSizes };
