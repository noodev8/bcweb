/*
=======================================================================================================================================
API Route: birk_tracker
=======================================================================================================================================
Method: GET
Purpose: Analytics module — Birk Tracker read. Returns the stored daily snapshot history (birk_stock_snapshot) so the /analytics/birk
         -tracker page can render the Full / Styles / Full% trend (table + line chart). Also returns the most recent row as `latest`
         for the headline. Read-only; the snapshot itself is (re)computed by the "Update" button -> POST /birk-tracker-update.

           - Full   = Birk styles holding all 3 core sizes (38/39/40) in FREE stock — the decision number.
           - Styles = all in-range Birk styles (grid offers 38/39/40) — the ceiling.
           - Full % = Full / Styles (computed app-side for display; not stored).

         Requires auth.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  days   optional integer >= 1 — trailing window of history to return (default 90). Cap 730 (the 2-year retention).

Success Response:
{
  "return_code": "SUCCESS",
  "days": 90,
  "latest": { "date": "2026-07-11", "full": 39, "styles": 149, "full_pct": 26, "units7": 216,
              "total_free": 1682, "core_free": 562, "cover_weeks": 7.8 } | null,
  "rows": [ { ...same shape... }, ... ]   // oldest -> newest
}
  - units7      = trailing 7-day Birkenstock units sold (all-channel) ending on that snapshot date. Computed LIVE from `sales`
                  (NOT stored) — sales are permanently recorded, so unlike stock they can be reconstructed for any past window.
  - total_free  = ALL Birk FREE units on hand that day (every size) — the whole tank. STORED (nullable; NULL on pre-totals rows).
  - core_free   = FREE units at core sizes 38/39/40 — core depth. STORED (nullable).
  - cover_weeks = total_free / units7 (whole tank / weekly burn) — aggregate weeks-of-cover, the push/scale-back signal. Computed
                  here; NULL when total_free is unknown (old row) or units7 = 0. Seasonality caveat: availability and sales both
                  rise together in season, so cover is the forward "are we draining?" read, not proof stock drives sales.
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
const logger = require('../utils/logger');

router.use(verifyToken);

// pg DATE comes back as a JS Date (or an ISO-ish string) — normalise to YYYY-MM-DD without timezone drift.
function toIso(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function shape(r) {
  const full = Number(r.full_count) || 0;
  const styles = Number(r.styles_count) || 0;
  const units7 = Number(r.units7) || 0;
  // Totals are nullable (pre-existing rows weren't backfilled) — keep null through, don't coerce to 0 (0 stock != unknown stock).
  const totalFree = r.total_free_units == null ? null : Number(r.total_free_units);
  const coreFree = r.core_free_units == null ? null : Number(r.core_free_units);
  // Aggregate weeks-of-cover = whole tank / weekly burn. units7 is the trailing-7-day total, i.e. the weekly rate. Null when we have
  // no stock level (old row) or no recent sales (can't divide) — either way "cover unknown", shown as "—".
  const coverWeeks = totalFree != null && units7 > 0 ? Math.round((totalFree / units7) * 10) / 10 : null;
  return {
    date: toIso(r.snapshot_date),
    full,
    styles,
    full_pct: styles ? Math.round((full / styles) * 100) : 0,
    units7,
    total_free: totalFree,
    core_free: coreFree,
    cover_weeks: coverWeeks,
  };
}

router.get('/', async (req, res) => {
  try {
    // Window: default 90 days, clamp to [1, 730] (730 = the 2-year retention cap the update route enforces).
    let days = parseInt(req.query.days, 10);
    if (!Number.isInteger(days) || days < 1) days = 90;
    if (days > 730) days = 730;

    // Stock snapshot rows + a LIVE trailing-7-day Birk units series (units7) computed per snapshot date from the sales table.
    // Sales are permanently recorded, so units7 is derived on read (not snapshotted) — it can always be reconstructed for any date.
    // units7 = all-channel Birk units where solddate is in (snapshot_date - 6 .. snapshot_date], joined to skusummary for the brand
    // (definitionally the same 'Birkenstock' population the Full gauge counts). CROSS JOIN LATERAL keeps it one row per snapshot.
    const result = await query(
      `SELECT b.snapshot_date, b.full_count, b.styles_count, b.total_free_units, b.core_free_units, u.units7
         FROM birk_stock_snapshot b
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(s.qty), 0)::int AS units7
             FROM sales s
             JOIN skusummary k ON k.groupid = s.groupid AND k.brand = 'Birkenstock'
            WHERE s.solddate <= b.snapshot_date
              AND s.solddate > b.snapshot_date - 7
         ) u
        WHERE b.snapshot_date >= CURRENT_DATE - ($1::int - 1)
        ORDER BY b.snapshot_date ASC`,
      [days]
    );

    const rows = result.rows.map(shape);
    const latest = rows.length ? rows[rows.length - 1] : null;

    return res.json({ return_code: 'SUCCESS', days, latest, rows });
  } catch (err) {
    logger.error('[birk-tracker] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Birk Tracker history' });
  }
});

module.exports = router;
