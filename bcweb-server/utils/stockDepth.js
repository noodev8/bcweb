/*
=======================================================================================================================================
Module: utils/stockDepth.js
=======================================================================================================================================
Purpose: THE stock-depth / excess rule — one place, two readers:
           - routes/analytics-stock-depth.js  — Reports → Stock vs Sales, the "how deep is the stock?" card and the excess-units hero
           - routes/pricing-excess-list.js    — the Repricing list a depth tile opens (owner, 2026-10-10: "get the list up in the
                                                repricer")
         Moved here from the analytics route on 2026-10-10 so the two can never disagree: a tile reading 51 styles must open a list
         of exactly those 51. The full "why" of each definition is in routes/analytics-stock-depth.js's header.

         UNITS   per style: localstock #FREE + amzfeed.amztotal (the stock_daily / Month End definition)
         PACE    units sold per month, all channels, net of returns, over the last 12 months (or the style's life if younger)
         MONTHS  units / pace
         BANDS   new (< NEW_DAYS old, no pace) | under6 | 6to12 | over12 (> 12 months, OR no sales at all — months null)
         EXCESS  units − NEED_MONTHS × pace, floored at 0. Birkenstock needs 6 months, everything else 2. No sales → all excess.
                 New → 0, never guessed.

loadStockDepth() → { bands: [{ band, styles, units }] in BAND_ORDER, excessUnits, rows: [{ groupid, title, brand, units, sold,
                     months, band, excess }] }   — every style we hold stock of, right now. READ-ONLY.
=======================================================================================================================================
*/

const { query } = require('../database');

const NEW_DAYS = 56;          // 8 weeks — long enough for a fresh style to have shown some pace
const BAND_ORDER = ['under6', '6to12', 'over12', 'new'];
// Months of its own sales a style NEEDS to hold, by brand (how long until more can land). Anything not listed can be re-ordered weekly.
const NEED_MONTHS = { Birkenstock: 6 };
const NEED_MONTHS_DEFAULT = 2;

async function loadStockDepth() {
  const r = await query(
    `WITH stock AS (
       SELECT groupid, SUM(qty)::int AS units FROM (
         SELECT groupid, qty FROM localstock WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE'
         UNION ALL
         SELECT groupid, amztotal FROM amzfeed WHERE groupid IS NOT NULL
       ) x
       GROUP BY groupid
       HAVING SUM(qty) > 0
     ),
     styles AS (
       -- Window = the last 365 days, or the style's life if shorter (min 1 day). created_at is authoritative (backfilled 2026-07).
       SELECT s.groupid, s.units, t.shopifytitle AS title, ss.brand,
              CURRENT_DATE - ss.created_at::date AS age_days,
              LEAST(365, GREATEST(COALESCE(CURRENT_DATE - ss.created_at::date, 365), 1)) AS window_days
       FROM stock s
       LEFT JOIN skusummary ss ON ss.groupid = s.groupid
       LEFT JOIN title t ON t.groupid = s.groupid
     ),
     sold AS (
       SELECT st.groupid, SUM(sa.qty) AS sold
       FROM styles st
       JOIN sales sa ON sa.groupid = st.groupid AND sa.solddate > CURRENT_DATE - st.window_days
       GROUP BY st.groupid
     )
     SELECT st.groupid, st.title, st.brand, st.units, st.age_days, st.window_days, COALESCE(so.sold, 0)::int AS sold
     FROM styles st
     LEFT JOIN sold so ON so.groupid = st.groupid`
  );

  const counts = Object.fromEntries(BAND_ORDER.map((b) => [b, { band: b, styles: 0, units: 0 }]));
  let excessUnits = 0;
  const rows = r.rows.map((s) => {
    const units = Number(s.units);
    const sold = Number(s.sold);
    let band;
    let months = null;
    let excess = 0;
    if (s.age_days !== null && Number(s.age_days) < NEW_DAYS) {
      band = 'new';
    } else if (sold <= 0) {
      band = 'over12';
      excess = units;
    } else {
      const perMonth = sold / (Number(s.window_days) / 30.44);
      months = Math.round((units / perMonth) * 10) / 10;
      band = months <= 6 ? 'under6' : months <= 12 ? '6to12' : 'over12';
      const need = (NEED_MONTHS[s.brand] ?? NEED_MONTHS_DEFAULT) * perMonth;
      excess = Math.max(0, Math.round(units - need));
    }
    counts[band].styles += 1;
    counts[band].units += units;
    excessUnits += excess;
    return { groupid: s.groupid, title: s.title, brand: s.brand || null, units, sold, months, band, excess };
  });

  return { bands: BAND_ORDER.map((b) => counts[b]), excessUnits, rows };
}

module.exports = { loadStockDepth, BAND_ORDER, NEW_DAYS };
