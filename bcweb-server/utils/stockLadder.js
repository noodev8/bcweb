/*
=======================================================================================================================================
Util: stockLadder  (THE copy of the Stock ladder rules — docs/stock-ladder.md is the agreed design, owner 2026-11-15)
=======================================================================================================================================
Purpose: Every SKU we hold sits on exactly ONE of five steps, set by how long it has gone without a sale. Read by
         GET /analytics-stock-ladder (Range's front screen, /analytics/slow-sizes). The lists per step: utils/stockLadderList.js (GET /amz-all-list ?step=).

THE FIVE STEPS (a sale on ANY channel counts, net of returns — utils/onShelf.js):
  1 Arrived     stock came in when we had none (first time ever, or after selling out) and it hasn't sold since — up to 90 days.
  2 Sold 90     sold in the last 90 days. The sweet spot.
  3 Unsold 90   no sale for 91–180 days.
  4 Unsold 180  no sale for 181 days – 9 months.
  5 Clearance   no sale for 9 months+. ONE-WAY: a sale does NOT take it out (owner: "Clearance cannot leave until ALL its stock is
                gone"); only selling out does. Steps 3 and 4 DO go back to 2 on one sale (owner, same day).
  Stock at 0 = on no step (nothing to price). A TOP-UP changes nothing — only stock arriving from 0 restarts the clock at step 1.

THE CLOCK = Range's idle clock, unchanged (utils/onShelf.js → idleSince, read its header): since the LATER of the last net sale and the
         oldest held pair's arrival (oldest pairs sell first, so a top-up never moves the oldest held pair; a restock after selling
         out does). from 'arrival' within 90 days = step 1, from 'sale' within 90 days = step 2. A never-sold SKU that was topped up
         is dated from its FIRST arrival (utils/slowSizes.js → datedFromFirstArrival, Range's own rule).

CLEARANCE HOLDS (step 5): a SKU is on step 5 when, at ANY point while we have held it, 9 months passed without a sale — not only
         now. "While held" starts at the oldest held pair's arrival: with oldest-first selling, stock has never been at 0 since that
         pair came in, so every gap from then on (arrival -> sale -> sale ... -> today) was time sitting on the shelf. A gap before that
         pair's arrival is not seen (the run may have started earlier), so the test can only under-count, never wrongly mark.
         9 months = calendar months, utils/onShelf.js → clearanceCutoff.

OVERSTOCKED — a LABEL on steps 1 and 2, never a step. Two ways on (`over_why`):
  'cover'  (step 2, owner 2026-11-15): we hold MORE than 4 months' worth at its selling rate (90
         days' ideal + one month's buffer). Even 1 pair over counts (the Deep sellers 3-pair minimum was never approved — dropped here;
         Deep sellers itself is unchanged until it is replaced). Rate = THE pace rule, utils/deepSizes.js → keepFor (12-month pace over
         the days it has been here). Judged only once a SKU is past its first 90 days here, as Deep sellers — before that it has no
         fair rate. over = held − 4 months' worth: the pairs to sell off.
  'unsold' (step 1, owner 2026-11-17 — "if not sold in 30 days and we have a number of items in stock"): MORE than 30 days here
         with no sale and 2+ pairs held. 1 pair is never overstocked; over = held − 1. A first sale moves it to step 2 (the 'cover'
         test then judges it); no sale moves it to step 3 on day 91, where no label is worked out — one place at a time.

STOCK = local #FREE not deleted + amzfeed.amztotal, one number (utils/slowSizes.js). Computed live; nothing stored. READ-ONLY.
=======================================================================================================================================
Exports:
  STEPS                                  [{ step: 1, key: 'arrived' }, … { step: 5, key: 'clearance' }]
  OVER_COVER_DAYS                        days of cover before Overstocked (4 months)
  ARRIVED_OVER_DAYS, ARRIVED_OVER_UNITS   step 1's Overstocked test: more than 30 days, 2+ pairs
  readStockLadder() -> { today, skus: [{ code, groupid, units, step, idle_days, last_sale, overstocked, over, over_why }] }
=======================================================================================================================================
*/

const { query } = require('../database');
const { readSlowSizes, datedFromFirstArrival } = require('./slowSizes');
const { netSaleDates, clearanceCutoff } = require('./onShelf');
const { keepFor, NEW_DAYS } = require('./deepSizes');

const STEPS = [
  { step: 1, key: 'arrived' },
  { step: 2, key: 'sold' },
  { step: 3, key: 'unsold90' },
  { step: 4, key: 'unsold180' },
  { step: 5, key: 'clearance' },
];
const WINDOW_DAYS = 90;                         // steps 1 and 2
const UNSOLD_180_DAYS = 180;                    // step 3 ends here
const OVER_COVER_DAYS = Math.round((365 / 12) * 4);   // 4 months' worth = 122 days
const ARRIVED_OVER_DAYS = 30;                   // step 1: unsold MORE than this many days …
const ARRIVED_OVER_UNITS = 2;                   // … holding at least this many pairs = Overstocked (held − 1 over)

const day = (x) => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

// A 9-month gap anywhere in the dates (oldest first), the last one ending today. Same-format date strings compare as text.
function hadNineMonthGap(datesOldestFirst, today) {
  const points = [...datesOldestFirst, today];
  for (let i = 1; i < points.length; i += 1) {
    if (points.at(i - 1) <= clearanceCutoff(points.at(i))) return true;
  }
  return false;
}

async function readStockLadder() {
  const { today, cutoff, sizes } = await readSlowSizes();
  await datedFromFirstArrival(sizes, today, cutoff);
  const codes = sizes.map((s) => s.code);

  const [sales, soldQ, firstQ] = await Promise.all([
    netSaleDates(codes),
    query(`SELECT code, SUM(qty)::int AS s12 FROM sales
            WHERE code = ANY($1::text[]) AND solddate > (now() AT TIME ZONE 'Europe/London')::date - 365
            GROUP BY code`, [codes]),
    // FIRST SEEN, as utils/deepSizes.js: the earlier of the first Goods In arrival and the first sale ever.
    query(`SELECT code, to_char(MIN(d), 'YYYY-MM-DD') AS d FROM (
             SELECT code, MIN(arrival_date) AS d FROM incoming_stock WHERE code = ANY($1::text[]) GROUP BY code
             UNION ALL
             SELECT code, MIN(solddate) FROM sales WHERE code = ANY($1::text[]) AND qty > 0 GROUP BY code
           ) x WHERE d IS NOT NULL GROUP BY code`, [codes]),
  ]);
  const sold12 = new Map(soldQ.rows.map((r) => [r.code, Math.max(Number(r.s12) || 0, 0)]));
  const first = new Map(firstQ.rows.map((r) => [r.code, r.d]));
  const t = day(today);

  const skus = sizes.map((s) => {
    // Clearance holds: any 9-month gap since the oldest held pair arrived (or since first arrival, for a never-sold SKU).
    const runFrom = s.last_sale ? s.on_shelf : today;   // never sold: idle_days already runs from its first arrival
    const inRun = (sales.get(s.code) || []).filter((d) => d >= runFrom).reverse();
    const clearance = s.clearance || (!!s.last_sale && hadNineMonthGap([runFrom, ...inRun], today));

    let step;
    if (clearance) step = 5;
    else if (s.idle_days <= WINDOW_DAYS) step = s.idle_from === 'arrival' ? 1 : 2;
    else if (s.idle_days <= UNSOLD_180_DAYS) step = 3;
    else step = 4;

    let over = 0;
    let overWhy = null;
    if (step === 1 && s.idle_days > ARRIVED_OVER_DAYS && s.units >= ARRIVED_OVER_UNITS) {
      over = s.units - 1;
      overWhy = 'unsold';
    }
    if (step === 2) {
      const firstSeen = first.get(s.code) || null;
      const daysHere = firstSeen ? t - day(firstSeen) : null;   // null = before the log, i.e. old
      if (daysHere === null || daysHere > NEW_DAYS) over = Math.max(0, s.units - keepFor(sold12.get(s.code) || 0, daysHere, OVER_COVER_DAYS));
      if (over > 0) overWhy = 'cover';
    }
    return { code: s.code, groupid: s.groupid, units: s.units, step, idle_days: s.idle_days, last_sale: s.last_sale, overstocked: over > 0, over, over_why: overWhy };
  });

  return { today, skus };
}

module.exports = { STEPS, OVER_COVER_DAYS, ARRIVED_OVER_DAYS, ARRIVED_OVER_UNITS, readStockLadder };
