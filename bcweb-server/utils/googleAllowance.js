/*
=======================================================================================================================================
Module: utils/googleAllowance.js
=======================================================================================================================================
Purpose: THE GOOGLE ALLOWANCE — the average Google ad spend per Shopify unit sold, over 90 days (table google_allowance, migrations/
         20261025_process_google_allowance.sql). Shown on the Google Ads screen (owner, 2026-10-26: moved there from the Today screen
         when Today was removed) as one line with a Re-measure button.

         FIXED, NOT LIVE (owner, 2026-10-25): re-measured QUARTERLY BY BUTTON. Re-measure SHOWS the new figure beside the one in force
         and nothing changes until Accept ("display the new fixed number before it is accepted"). One row per accepted measurement;
         the newest row is the figure in force; rows are never edited, so the history stays readable.

         WHY IT EXISTS: Shopify profit (utils/shopifyProfit.js) is booked BEFORE Google spend, and spend is recorded per STYLE, so it
         can't be shared out to sizes. The allowance is the per-unit cost to hold a Shopify sale against. It first set Today's Shopify
         "good" line (£3 + allowance); nothing calculates from it now — it is a reference figure.
=======================================================================================================================================
*/

// Measured over 90 days; falls DUE 90 days after it was accepted (owner: quarterly, by button).
const MEASURE_DAYS = 90;
const ALLOWANCE_DUE_DAYS = 90;

// The allowance in force: the newest accepted row. null if the table is empty (never, after the migration's seed).
async function readAllowance(q) {
  const r = await q(`
    SELECT per_unit, spend, units, window_from::text AS window_from, window_to::text AS window_to, accepted_by,
           (accepted_at AT TIME ZONE 'Europe/London')::date::text AS accepted_on,
           ((accepted_at AT TIME ZONE 'Europe/London')::date + $1::int)::text AS due_on,
           (accepted_at AT TIME ZONE 'Europe/London')::date + $1::int <= (now() AT TIME ZONE 'Europe/London')::date AS due
      FROM google_allowance ORDER BY accepted_at DESC, id DESC LIMIT 1
  `, [ALLOWANCE_DUE_DAYS]);
  if (!r.rows.length) return null;
  const a = r.rows[0];
  return {
    perUnit: Number(a.per_unit), spend: a.spend === null ? null : Number(a.spend), units: a.units === null ? null : Number(a.units),
    windowFrom: a.window_from, windowTo: a.window_to, acceptedBy: a.accepted_by, acceptedOn: a.accepted_on,
    dueOn: a.due_on, due: a.due,
  };
}

// Measure the allowance: Google spend / Shopify units sold, over MEASURE_DAYS ending `windowTo` — by default the newest COMPLETE day
// of ad data (a day we hold a row for that was captured on a LATER day; the newest import is normally a part day — the anchor
// routes/google-ads-styles.js uses, for the same reason). Units are positive rows (qty > 0), the Ad Efficiency / Ad Daily basis.
// READ ONLY. Returns perUnit null when nothing sold in the window.
async function measureAllowance(q, windowTo = null) {
  const r = await q(`
    WITH anchor AS (
      SELECT COALESCE($2::date, LEAST(CURRENT_DATE, (
               SELECT MAX(snapshot_date) FROM google_product_daily
                WHERE (imported_at AT TIME ZONE 'Europe/London')::date > snapshot_date
             ))) AS d
    )
    SELECT (a.d - ($1::int - 1))::text AS window_from, a.d::text AS window_to,
           (SELECT COALESCE(SUM(cost), 0) FROM google_product_daily WHERE snapshot_date BETWEEN a.d - ($1::int - 1) AND a.d) AS spend,
           (SELECT COALESCE(SUM(qty), 0) FROM sales
             WHERE channel = 'SHP' AND qty > 0 AND solddate BETWEEN a.d - ($1::int - 1) AND a.d)                     AS units
      FROM anchor a
  `, [MEASURE_DAYS, windowTo]);
  const m = r.rows[0];
  const spend = Math.round(Number(m.spend) * 100) / 100;
  const units = Number(m.units);
  return {
    windowFrom: m.window_from, windowTo: m.window_to, spend, units,
    perUnit: units > 0 ? Math.round((spend / units) * 100) / 100 : null,
  };
}

module.exports = { MEASURE_DAYS, ALLOWANCE_DUE_DAYS, readAllowance, measureAllowance };
