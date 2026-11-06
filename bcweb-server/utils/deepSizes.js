/*
=======================================================================================================================================
Util: deepSizes
=======================================================================================================================================
Purpose: DEEP SELLERS (owner, 2026-11-06). SKUs that SELL but hold far more than they sell. Read by GET /analytics-deep-sizes.

THE GAP IT FILLS. Range's green card ("Sold in the last 90 days") counts a SKU as done once ONE pair sells in 90 days. On 2026-11-06,
         222 of the 386 green SKUs had sold just 1 pair in 90 days and between them held 594. A size holding 13 that sold 1 sits on
         the success card beside a size that sold 10 and holds 2. Range never catches these because they never go idle, and the order
         screens only ask "do I need more?", never "did I buy too many?". The owner's rule: "Good sellers need to be kept in stock and
         not over bought". Buying mistakes should be ditched quickly, before they drift past 90 days.
         THE GREEN CARD STAYS AS IT IS (owner). This list branches off it, and every size here is still a green Range size.

WHO IS ON THE LIST, all four must hold:
  1. Held: STOCK as Range counts it (local #FREE not deleted + amzfeed.amztotal, utils/slowSizes.js).
  2. Range's green card: it has a net sale on record and its idle clock is 90 days or less (utils/onShelf.js; RANGE_DAYS).
     Sizes past that are already on Range's own lists (No sale 91 days – 9 months / 9 months+), so they aren't repeated here.
  3. Past its first 90 days: FIRST SEEN (the earlier of its first Goods In arrival and its first sale) more than NEW_DAYS ago.
     Younger SKUs are New stuff's question (one sale in the first 90 days) and haven't had a fair 90 days to show their pace.
     A SKU with no arrival on record counts as old: Goods In began logging on 31 Dec 2024.
  4. DEEP: OVER >= MIN_OVER pairs, where
       pace  = net units sold in the last 12 months over the days it has been here (first seen, capped at 365), so a SKU 5 months
               old isn't judged on a 12-month average it never had. 12 months rather than 90 days ON PURPOSE: the 90-day pace in
               November makes summer sellers look badly overbought (Ives White-07: sold 13 in 90 days, 155 in the year).
               Owner: "Season matters, but still, it will kick harder when spring comes".
       keep  = 90 days' worth at that pace, rounded up, and never below 1 (a size in the run keeps a pair to sell).
       over  = held − keep, the pairs beyond 90 days' worth, i.e. the number to push out.
     MIN_OVER = 3 cuts the "holds 2, sells 4 a year" noise (on 2026-11-06, 115 of 313 SKUs over 4 months' cover were one pair over).

THE WAY OUT (per style; THE copy of the tag, the screen only words it). Price grain decides what can move a size (CLAUDE.md:
         Shopify is priced per STYLE, Amazon per SKU; Birkenstock is never on Amazon or eBay):
  'shopify'   the deep sizes hold HALF OR MORE of the style's stock, so a style price drop is aimed at the problem, not
              at the sizes that sell (Bend black, 2026-11-06: 5 of 9 sizes deep).
  'amazon'    otherwise, a non-Birkenstock style with a deep size live on Amazon, priced by size (W-A1).
  'off'       otherwise: no price lever. A single deep Birkenstock size of a selling style (Milano 36). Its ways out are off-channel:
              job lot, personal / CM3 shop sales, sale-or-return with another shop (owner, 2026-11-06). A per-size Shopify price is
              a valid future option, just not today (tried before, it caused confused support calls about the price).
  The owner chose to see ALL the styles, the 'off' ones included.

ON ORDER = supplier lines not yet arrived (orderstatus ordertype 2 local / 3 Amazon, arrived = 0; one row per unit). It is SHOWN, not
         counted in over (the list is about what is sitting), because a deep size with more on order is worth seeing at once.

         Computed live; nothing stored. READ-ONLY.
=======================================================================================================================================
Exports:
  RANGE_DAYS, NEW_DAYS, MIN_OVER
  readDeepSizes() -> { today, sizes: [{ code, groupid, size, title, brand, units, last_sale, idle_days, sold_12m, sold_90d,
                                        first_seen, days_here, keep, over, on_order, on_amazon }],
                       styles: [{ groupid, units, deep_units, way_out }], held: [...all held sizes of those styles, same shape as
                       utils/slowSizes.js rows plus sold_12m] }
=======================================================================================================================================
*/

const { query } = require('../database');
const { readSlowSizes } = require('./slowSizes');

const RANGE_DAYS = 90;    // Range's green card: idle 90 days or less (lib/slowBands.ts NEW_DAYS on the web side)
const NEW_DAYS = 90;      // New stuff's window (utils/processMap.js)
const MIN_OVER = 3;       // pairs beyond 90 days' worth before a size is "deep"
const PACE_CAP_DAYS = 365;

// Whole days between two 'YYYY-MM-DD' strings, in UTC so BST never shifts a day.
const day = (x) => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

async function readDeepSizes() {
  const { today, sizes } = await readSlowSizes();
  const codes = sizes.map((s) => s.code);
  const [soldQ, firstQ, ordQ, amzQ] = await Promise.all([
    query(`SELECT code, SUM(qty)::int AS s12,
                  SUM(CASE WHEN solddate > (now() AT TIME ZONE 'Europe/London')::date - 90 THEN qty ELSE 0 END)::int AS s90
             FROM sales
            WHERE code = ANY($1::text[]) AND solddate > (now() AT TIME ZONE 'Europe/London')::date - 365
            GROUP BY code`, [codes]),
    // FIRST SEEN = the earlier of the first Goods In arrival and the first sale ever (a sale before any logged arrival means the
    // size was here before Goods In began logging).
    query(`SELECT code, to_char(MIN(d), 'YYYY-MM-DD') AS d FROM (
             SELECT code, MIN(arrival_date) AS d FROM incoming_stock WHERE code = ANY($1::text[]) GROUP BY code
             UNION ALL
             SELECT code, MIN(solddate) FROM sales WHERE code = ANY($1::text[]) AND qty > 0 GROUP BY code
           ) x WHERE d IS NOT NULL GROUP BY code`, [codes]),
    query(`SELECT shopifysku AS code, COUNT(*)::int AS n FROM orderstatus
            WHERE COALESCE(arrived, 0) = 0 AND ordertype IN (2, 3) AND shopifysku = ANY($1::text[])
            GROUP BY shopifysku`, [codes]),
    query(`SELECT DISTINCT code FROM amzfeed WHERE code = ANY($1::text[])`, [codes]),
  ]);
  const sold = new Map(soldQ.rows.map((r) => [r.code, r]));
  const first = new Map(firstQ.rows.map((r) => [r.code, r.d]));
  const onOrder = new Map(ordQ.rows.map((r) => [r.code, r.n]));
  const onAmazon = new Set(amzQ.rows.map((r) => r.code));
  const t = day(today);

  const all = sizes.map((s) => {
    const r = sold.get(s.code);
    const sold12 = Math.max(Number(r?.s12) || 0, 0);
    const sold90 = Math.max(Number(r?.s90) || 0, 0);
    const firstSeen = first.get(s.code) || null;
    const daysHere = firstSeen ? t - day(firstSeen) : null;              // null = before the log, i.e. old
    const paceDays = Math.min(daysHere ?? PACE_CAP_DAYS, PACE_CAP_DAYS);
    const keep = Math.max(1, Math.ceil((sold12 * 90) / Math.max(paceDays, 1)));
    return {
      code: s.code, groupid: s.groupid, size: s.size, title: s.title, brand: s.brand, units: s.units,
      last_sale: s.last_sale, idle_days: s.idle_days, sold_12m: sold12, sold_90d: sold90,
      first_seen: firstSeen, days_here: daysHere, keep, over: s.units - keep,
      on_order: onOrder.get(s.code) || 0, on_amazon: onAmazon.has(s.code),
    };
  });

  const isDeep = (x) => !!x.last_sale && x.idle_days <= RANGE_DAYS
    && (x.days_here === null || x.days_here > NEW_DAYS) && x.over >= MIN_OVER;
  const deep = all.filter(isDeep);
  const deepStyles = new Set(deep.map((x) => x.groupid));
  const held = all.filter((x) => deepStyles.has(x.groupid));

  const isBirk = (b) => /^birk/i.test((b || '').trim());
  const styles = [...deepStyles].map((groupid) => {
    const mine = held.filter((x) => x.groupid === groupid);
    const units = mine.reduce((n, x) => n + x.units, 0);
    const deepMine = deep.filter((x) => x.groupid === groupid);
    const deepUnits = deepMine.reduce((n, x) => n + x.units, 0);
    const way_out = deepUnits * 2 >= units ? 'shopify'
      : !isBirk(mine[0].brand) && deepMine.some((x) => x.on_amazon) ? 'amazon'
        : 'off';
    return { groupid, units, deep_units: deepUnits, way_out };
  });

  return { today, sizes: deep, styles, held };
}

module.exports = { RANGE_DAYS, NEW_DAYS, MIN_OVER, readDeepSizes };
