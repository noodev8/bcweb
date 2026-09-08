/*
=======================================================================================================================================
Module: utils/adFloor.js
=======================================================================================================================================
Purpose: The AD FLOOR — the Shopify price below which a style stops paying for its own Google advertising.

         A style can clear the existing below-cost bound, show a healthy margin on the pricing screen, and still lose money on every
         unit, because nothing in the pricing path has ever known what a customer costs to buy. This module supplies that number.

THE TWO NUMBERS
  adCostPerSale = Google spend / units sold, over the window. What one customer cost.
  adFloor       = the VAT-inclusive price at which per-unit NET profit exactly equals adCostPerSale, via
                  utils/shopifyProfit.js -> priceForProfit(). Price below it and the unit is sold at a loss once the click is paid for.

WHY IT IS A PRICE AND NOT A MARGIN. The operator sets a price, so the bound has to be expressed in the same units as the thing being
decided. "Needs £5.64 of margin" requires mental arithmetic through VAT, the payment fee, packing and postage at the moment of the
decision; "the floor is £71.55" does not. The conversion is exact, not an approximation — priceForProfit() is the profit formula read
backwards, sharing its constants.

WHY IT IS COMPUTED AND NEVER STORED. skusummary.minshopifyprice already tried the stored approach and died of it: the column is clean
and populated on all 292 styles, but sits at '0.00' on 167 of 176 Birkenstock rows, and routes/pricing-apply.js records that the bound
was switched off as unused. A floor built on ad costs moves whenever CPC or conversion moves, so a stored copy is wrong within weeks
and says nothing about being wrong. Reading it live costs one aggregate over google_product_daily and cannot go stale.

WHY 90 DAYS (owner's call). Long enough that a low-volume style has a stable click count, short enough to track current conditions. 30
days on a style selling two a month is a handful of clicks and a floor that jumps around; a season-to-date window blends peak and
off-peak, which on a sandal understates the floor in June and overstates it in October.

CONFIDENCE, AND WHY A THIN FLOOR IS WORSE THAN NO FLOOR. Only ~95 of 176 Birkenstock styles clear the evidence bar in a 90-day window.
A floor derived from nine clicks looks exactly as authoritative on screen as one derived from nine hundred, and would be acted on the
same way. So each floor is labelled:
    'own'     - the style's own ads and its own sales cleared MIN_CLICKS and MIN_UNITS. Trust it.
    'segment' - too thin on its own; the median ad cost per sale of its segment, applied to this style's cost. An ESTIMATE, and the
                caller must render it as one.
    'none'    - no usable ad data anywhere. Returns nulls. Show nothing; do NOT fall back to cost, which would present the
                already-enforced below-cost bound as if it were an ad floor.

THIS MODULE IS READ-ONLY AND ADVISORY. It writes nothing and blocks nothing. The apply path (W1) is untouched by design (owner's call):
the floor is an estimate over drifting data, and a hard block on an estimate eventually refuses a price that was actually right.
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');
const { priceForProfit } = require('./shopifyProfit');

const WINDOW_DAYS = 90;   // see "WHY 90 DAYS" above — owner's call, not a tuning knob to fiddle with per screen
const MIN_CLICKS = 100;   // below this the cost-per-click is noise, whatever the spend looks like
const MIN_UNITS = 10;     // below this the conversion rate is noise, so spend/units is not a customer's price

/*
 * getAdFloors(groupids) -> Map<groupid, floorRow>
 *
 * floorRow = {
 *   adCostPerSale: 12.76 | null,   // Google spend / units over the window
 *   adFloor:       71.55 | null,   // the price that nets exactly adCostPerSale
 *   confidence:    'own' | 'segment' | 'none',
 *   clicks: 309, units: 12, spend: 153.17,   // what the number was built on, so a screen can justify itself
 *   windowDays: 90
 * }
 *
 * One query for the batch, not one per style — the callers are list screens (CLAUDE.md: no N+1). An empty/absent input returns an
 * empty Map rather than querying for nothing.
 */
async function getAdFloors(groupids) {
  const ids = Array.isArray(groupids) ? groupids.filter(Boolean) : [];
  if (ids.length === 0) return new Map();

  // Spend and units are counted over the SAME window, and units come from `sales` rather than Google's own `conversions` on purpose:
  // conversions are Google-attributed and fractional, so spend/conversions would answer "what Google thinks it sold" rather than
  // "what we actually shipped". Returns are qty = -1 rows in `sales`, so SUM(qty) nets them off — COUNT(*) would count a return as a
  // sale and understate the true cost of a customer.
  const sql = `
    WITH ads AS (
      SELECT groupid, SUM(clicks) AS clicks, SUM(cost) AS spend
      FROM google_product_daily
      WHERE groupid = ANY($1) AND snapshot_date >= CURRENT_DATE - $2::int
      GROUP BY groupid
    ),
    sold AS (
      SELECT groupid, SUM(qty) AS units
      FROM sales
      WHERE groupid = ANY($1) AND solddate >= CURRENT_DATE - $2::int
      GROUP BY groupid
    )
    SELECT ss.groupid,
           ss.segment,
           ${safeNumeric('ss.cost')} AS cost,
           COALESCE(a.clicks, 0)     AS clicks,
           COALESCE(a.spend, 0)      AS spend,
           COALESCE(s.units, 0)      AS units
    FROM skusummary ss
    LEFT JOIN ads  a ON a.groupid = ss.groupid
    LEFT JOIN sold s ON s.groupid = ss.groupid
    WHERE ss.groupid = ANY($1)
  `;

  const { rows } = await query(sql, [ids, WINDOW_DAYS]);

  // Pass 1 — the styles that can speak for themselves, and the segment medians built from ONLY those. A thin style must not feed the
  // median it is about to borrow from, or the fallback would inherit the noise it exists to avoid.
  const own = new Map();
  const bySegment = new Map();

  for (const r of rows) {
    const clicks = Number(r.clicks) || 0;
    const units = Number(r.units) || 0;
    const spend = Number(r.spend) || 0;
    if (clicks < MIN_CLICKS || units < MIN_UNITS || spend <= 0) continue;

    const adCostPerSale = spend / units;
    own.set(r.groupid, adCostPerSale);

    const seg = r.segment || '(none)';
    if (!bySegment.has(seg)) bySegment.set(seg, []);
    bySegment.get(seg).push(adCostPerSale);
  }

  const segmentMedian = new Map();
  for (const [seg, values] of bySegment) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    segmentMedian.set(seg, values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2);
  }

  // Pass 2 — turn a cost-per-sale into a price for each requested style.
  const out = new Map();
  for (const r of rows) {
    const cost = r.cost === null || r.cost === undefined ? null : Number(r.cost);
    const clicks = Number(r.clicks) || 0;
    const units = Number(r.units) || 0;
    const spend = Number(r.spend) || 0;

    let adCostPerSale = null;
    let confidence = 'none';

    if (own.has(r.groupid)) {
      adCostPerSale = own.get(r.groupid);
      confidence = 'own';
    } else {
      const median = segmentMedian.get(r.segment || '(none)');
      // A segment estimate is only offered to a style that is actually being advertised. Handing a floor to a style with no spend
      // would invent a constraint out of its neighbours' costs.
      if (median !== undefined && spend > 0) {
        adCostPerSale = median;
        confidence = 'segment';
      }
    }

    // No cost means no floor: priceForProfit() cannot place a price without it, and cost is a junk-prone legacy VARCHAR (CLAUDE.md).
    const adFloor = adCostPerSale === null || cost === null ? null : priceForProfit(adCostPerSale, cost);

    out.set(r.groupid, {
      adCostPerSale: adCostPerSale === null ? null : Math.round(adCostPerSale * 100) / 100,
      adFloor,
      confidence: adFloor === null ? 'none' : confidence,
      clicks,
      units,
      spend: Math.round(spend * 100) / 100,
      windowDays: WINDOW_DAYS,
    });
  }

  return out;
}

module.exports = { getAdFloors, WINDOW_DAYS, MIN_CLICKS, MIN_UNITS };
