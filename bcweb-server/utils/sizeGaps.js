/*
=======================================================================================================================================
Util: sizeGaps
=======================================================================================================================================
Purpose: THE RULES of Size gaps (owner, 2026-11-08) — sizes missing from styles we already sell, as SKU-level PROSPECTS. The problem
         (owner): "We buy products and get the core sizes to test, but then forget what is there and just keep ordering the same
         sizes." Found from the Prospects screen (a "Size gaps · n" link → /prospects/size-gaps), ordered BY HAND from the supplier,
         then it arrives and is loaded onto the system as usual. Tables: migrations/20261108c_size_gap.sql (read its header).

THE RANGE = a BRAND SETTING (size_gap_range, set by hand): Lunar UK 3–9 (2026-11-08); Rieker, Remonte, Strive Womens EU 36–42 (2026-11-09,
         owner: "these 3 in EU fit well for our next work" — in their OWN sizing); then Free Spirit Womens UK 3–8, Rieker Mens EU 40–46,
         Roamers / Goor Mens UK 6–14, Lazy Dogz Womens UK 3–8 (2026-11-09, migrations/20261109b — read its header for who was left out). Every style of the brand is checked against every
         whole size in it (owner chose a brand setting over "what the model's other colours carry", which can never suggest a size we
         never bought). A range is per BRAND + WHO — the first word of title.shopifytitle ('Womens' / 'Mens'), because Rieker's Mens
         styles run EU 40–46 and a women's range would flag their 36–39 as gaps — so Rieker has two ranges. A brand + who with no range
         (Goor Boys, Mod Comfys, Caprice…) is simply not on the list.
A SIZE = THE WHOLE NUMBER AT THE END OF THE CODE (…-38 → 38, Lunar …-03 → 3), for every brand (2026-11-09 — was skumap.uksize). The EU
         brands' codes end in whole EU sizes one-to-one with their UK size, but in UK their core sizes are halves (Rieker / Remonte
         EU 40 = 6.5, 41 = 7.5, no UK 7) and the brands convert differently (Strive EU 41 = UK 7), so the code is the one clean measure.
         Lunar's codes end 03…09 = its UK 3–9, so nothing changed for it. A half-size code (…-37.5) is off the run (no tile).
         size_gap_range.sizing ('UK' | 'EU') is a LABEL only ("38 EU"). The columns uk_from / uk_to / size_gap_mark.uk and the API's
         "uk" fields keep their 2026-11-08 names but hold this size (UK or EU) — migrations/20261109_size_gap_eu.sql.

A GAP = a size in the range that is EITHER
  new     NOT ON OUR SYSTEM — no live skumap row for the style at that size, OR
  empty   on the system with NO STOCK anywhere (local #FREE + amzfeed.amztotal, which includes inbound), NOTHING ON ORDER (orderstatus
          supplier lines 2 local / 3 Amazon not yet arrived — to place and on order both count), AND NO NET SALE IN 90 DAYS
          (utils/onShelf.js → lastNetSales; a sale that came back is not a sale). Owner changed it from 6 months to 90 days, the
          same clock as Range. Before that the size is the order screens' job. (Amazon Order's Warm still reads 6 months, so a size
          that sold 3–6 months ago at > £3 can be on both — known, owner's call.)
         Every other size of the style is HELD (stock), ON ORDER, or SELLING (sold in 90 days) — shown grey, never worked here.

LEFT OUT: Can't get styles (utils/noSupply.js — style-wide, lapses by itself, so they come back).

THE ORDER = THE STYLE'S BEST SIZE, BY PROFIT A PAIR (owner, 2026-11-09 — replaced the style's total 12-month profit: "If a size can
         make good size profit, then maybe another size can. Not interested in qty at this stage"). For every size of the style (every
         code, on the run or not): its 12-month net profit ÷ its 12-month net pairs, EVERY CHANNEL, NET OF RETURNS (returns are negative
         sales rows, so both sums are net); a size whose net pairs are 0 or less has no figure. The style's BEST = its highest, and the
         list runs highest first; a style with no size sold in 12 months goes last. QTY PLAYS NO PART — a size that sold one pair at
         £9 outranks one that sold 100 at £4. The figure IS SHOWN (owner: "There's no indication of why you sorted that way") — the
         Best size column, and each size's own figure on hover. No success bar: the owner works top to bottom and parks the low ones.
         A style with NOTHING held stays on the list (owner: "It is on the list so won't be misplaced").

THE MARKS (size_gap_mark, one per groupid + size — a missing size has no code):
  park      until = today + 14, 30 or 90 DAYS (owner, 2026-11-09 — all in days: "use days so they are all the same"; was 3 / 6 months. 14 / 30
            for "the supplier is out, check again before the season goes" — Chime Taupe, out at Lunar in winter; 6 months dropped);
            the size is back on the list ON that day
  notmade   no date — never ends by time (owner); released by hand
  ordered   until = today + 90 days (was 3 months — days, like the parks)
         EVERY MARK ENDS WHEN THE SIZE ARRIVES — a Goods In arrival of the size on or after the day it was marked (found 2026-11-09 on
         review). A mark is a decision about a size we DON'T have; once one turns up the decision is spent. Without this, a Not made
         size the supplier did make after all (ordered, sold out, then 90 days quiet) would stay hidden for good, and a Park could hide
         a size that came and went inside its months. (While the size has stock / is on order / sold in 90 days it isn't a gap anyway.)
         Ended / lapsed marks are simply ignored (a new mark overwrites the row; Release deletes it).
         A mark only ever sits on a GAP: a held or selling size isn't on the list, so it has nothing to mark.

         READ-ONLY.
=======================================================================================================================================
Exports:
  MARKS                      { park14: {mark:'park',days:14}, park30, park90, notmade: {days:null}, ordered: {days:90} }  — the choices
  GAP_DAYS                   90
  readSizeGaps() -> { today, ranges: [{brand, who, uk_from, uk_to, sizing}], styles: [ {
        groupid, title, brand, imagename, asin, sizing,     // sizing = 'UK' | 'EU', the label for its sizes
        best: { per_pair, size } | null,     // the style's best size by 12-month profit a pair (size = e.g. "38 EU" / "5 UK")
        sizes: [ { uk, code, state: 'gap'|'held'|'onorder'|'selling', is_new, units, on_order, last_sale,
                   per_pair,                  // this size's 12-month profit a pair, null if none sold (net)
                   mark: { mark, until, marked_on, marked_by } | null } ]   // every size of the range, in order (uk = THE size, UK or EU); marked_on = London day
     } ],   // only styles with at least one gap (open or marked), best-size order
     counts: { open_styles, open_sizes, park, ordered, notmade } }   // open = an unmarked gap; the mark counts are SIZES
=======================================================================================================================================
*/

const { query } = require('../database');
const { LONDON_TODAY_SQL } = require('./sql');
const { noSupplyNowSql } = require('./noSupply');
const { lastNetSales } = require('./onShelf');

const GAP_DAYS = 90;

// The screen's choices -> what is stored. ALL IN DAYS (owner, 2026-11-09: "use days so they are all the same. 14,30,90").
const MARKS = {
  park14: { mark: 'park', days: 14 },
  park30: { mark: 'park', days: 30 },
  park90: { mark: 'park', days: 90 },
  notmade: { mark: 'notmade', days: null },
  ordered: { mark: 'ordered', days: 90 },
};

// THE SIZE of a code (header): the whole number after its last '-' ("…-38" → 38, "…-03" → 3). A half size ("…-37.5") or junk is NULL.
const sizeSql = (col) => `CASE WHEN substring(${col} FROM '[^-]*$') ~ '^[0-9]{1,2}$' THEN substring(${col} FROM '[^-]*$')::int END`;

async function readSizeGaps() {
  const [todayQ, rangeQ] = await Promise.all([
    query(`SELECT to_char(${LONDON_TODAY_SQL}, 'YYYY-MM-DD') AS today,
                  to_char(${LONDON_TODAY_SQL} - ${GAP_DAYS}, 'YYYY-MM-DD') AS sold_since`),
    query(`SELECT brand, who, uk_from, uk_to, sizing FROM size_gap_range ORDER BY brand, who`),
  ]);
  const { today, sold_since: soldSince } = todayQ.rows[0];
  const ranges = rangeQ.rows;
  const empty = { today, ranges, styles: [], counts: { open_styles: 0, open_sizes: 0, park: 0, ordered: 0, notmade: 0 } };
  if (!ranges.length) return empty;

  // THE STYLES — every style of a ranged brand + who (Womens / Mens, from its title), Can't get left out, with its picture.
  const stylesQ = await query(
    `SELECT s.groupid, NULLIF(TRIM(s.brand), '') AS brand, t.shopifytitle AS title, NULLIF(TRIM(s.imagename), '') AS imagename,
            r.uk_from, r.uk_to, r.sizing
       FROM skusummary s
       JOIN title t ON t.groupid = s.groupid
       JOIN size_gap_range r ON LOWER(TRIM(s.brand)) = LOWER(r.brand)
                            AND LOWER(split_part(TRIM(t.shopifytitle), ' ', 1)) = LOWER(r.who)   -- 'Womens' / 'Mens' (header)
      WHERE NOT ${noSupplyNowSql('s')}`);
  if (!stylesQ.rows.length) return empty;
  const groupids = stylesQ.rows.map((r) => r.groupid);
  const sizingBy = new Map(stylesQ.rows.map((r) => [r.groupid, r.sizing]));   // 'UK' | 'EU' — the label on the Best size

  // THE SIZES ON OUR SYSTEM (live skumap rows whose code ends in a whole size), each with stock and supplier lines on order. One query, no N+1.
  const [sizesQ, marksQ, asinQ, perCodeQ] = await Promise.all([
    query(
      `WITH m AS (
         SELECT m.groupid, m.code, ${sizeSql('m.code')} AS uk FROM skumap m
          WHERE m.groupid = ANY($1::text[]) AND COALESCE(m.deleted, 0) = 0 AND m.code IS NOT NULL
       ),
       stock AS (
         SELECT code, SUM(q)::int AS units FROM (
           SELECT code, qty AS q FROM localstock
            WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0 AND code IN (SELECT code FROM m)
           UNION ALL
           SELECT code, amztotal FROM amzfeed WHERE code IN (SELECT code FROM m)
         ) x GROUP BY code
       ),
       ordered AS (
         SELECT shopifysku AS code, COUNT(*)::int AS n FROM orderstatus
          WHERE ordertype IN (2, 3) AND COALESCE(arrived, 0) = 0 AND shopifysku IN (SELECT code FROM m)
          GROUP BY shopifysku
       )
       SELECT m.groupid, m.code, m.uk, GREATEST(COALESCE(s.units, 0), 0) AS units, COALESCE(o.n, 0) AS on_order
         FROM m LEFT JOIN stock s ON s.code = m.code LEFT JOIN ordered o ON o.code = m.code
        WHERE m.uk IS NOT NULL`, [groupids]),
    query(
      `SELECT groupid, uk, mark, to_char(until, 'YYYY-MM-DD') AS until, marked_at, marked_by,
              to_char(marked_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS marked_day
         FROM size_gap_mark WHERE groupid = ANY($1::text[])`, [groupids]),
    // One ASIN per style for the Amazon link — the size with the most stock at Amazon, so the link opens a live page.
    query(
      `SELECT DISTINCT ON (groupid) groupid, asin FROM amzfeed
        WHERE groupid = ANY($1::text[]) AND NULLIF(TRIM(asin), '') IS NOT NULL
        ORDER BY groupid, COALESCE(amztotal, 0) DESC, code`, [groupids]),
    // THE ORDER (header): each size's 12-month NET profit and NET pairs, every channel. Every code the style sold, on the run or not.
    query(
      `SELECT x.groupid, x.code, SUM(x.profit)::float AS profit, SUM(x.qty)::int AS pairs,
              ${sizeSql('x.code')} AS uk
         FROM sales x
        WHERE x.groupid = ANY($1::text[]) AND x.code IS NOT NULL AND x.solddate > ${LONDON_TODAY_SQL} - 365
        GROUP BY x.groupid, x.code`, [groupids]),
  ]);

  // Profit a pair per style + size (for the tiles) and each style's best size (for the order). Net pairs 0 or less = no figure.
  const perPairBySize = new Map();   // groupid|uk -> £ a pair
  const sumBySize = new Map();       // groupid|uk -> { profit, pairs } (two codes at one size are added together)
  const bestBy = new Map();          // groupid -> { per_pair, size }
  const round2 = (v) => Math.round(v * 100) / 100;
  for (const r of perCodeQ.rows) {
    if (r.uk != null) {
      const k = `${r.groupid}|${r.uk}`;
      const cur = sumBySize.get(k) || { profit: 0, pairs: 0 };
      cur.profit += r.profit || 0; cur.pairs += r.pairs || 0;
      sumBySize.set(k, cur);
    } else if (r.pairs > 0) {
      // A size off the run (a half size): no tile, but it can still be the style's best.
      const pp = round2((r.profit || 0) / r.pairs);
      const b = bestBy.get(r.groupid);
      if (!b || pp > b.per_pair) bestBy.set(r.groupid, { per_pair: pp, size: `${r.code.split('-').pop()} ${sizingBy.get(r.groupid)}` });
    }
  }
  for (const [k, v] of sumBySize) {
    if (v.pairs <= 0) continue;
    const pp = round2(v.profit / v.pairs);
    perPairBySize.set(k, pp);
    const [groupid, uk] = k.split('|');
    const b = bestBy.get(groupid);
    if (!b || pp > b.per_pair) bestBy.set(groupid, { per_pair: pp, size: `${uk} ${sizingBy.get(groupid)}` });
  }

  const codes = sizesQ.rows.map((r) => r.code);
  const lastSale = await lastNetSales(codes);

  // EVERY MARK ENDS WHEN THE SIZE ARRIVES (header): any Goods In of one of its codes on or after the day it was marked.
  const arrived = new Set();
  if (marksQ.rows.length) {
    const a = await query(
      `SELECT DISTINCT k.groupid, k.uk FROM size_gap_mark k
         JOIN skumap m ON m.groupid = k.groupid AND ${sizeSql('m.code')} = k.uk
         JOIN incoming_stock i ON i.code = m.code
        WHERE k.groupid = ANY($1::text[])
          AND i.arrival_date >= (k.marked_at AT TIME ZONE 'Europe/London')::date`, [groupids]);
    for (const r of a.rows) arrived.add(`${r.groupid}|${r.uk}`);
  }

  // Per style + size: the codes there (normally one; a duplicate row is summed).
  const bySize = new Map();
  for (const r of sizesQ.rows) {
    const k = `${r.groupid}|${r.uk}`;
    const cur = bySize.get(k);
    const last = lastSale.get(r.code) || null;
    if (!cur) bySize.set(k, { code: r.code, units: r.units, on_order: r.on_order, last_sale: last });
    else {
      cur.units += r.units;
      cur.on_order += r.on_order;
      if (last && (!cur.last_sale || last > cur.last_sale)) cur.last_sale = last;
    }
  }
  const markBy = new Map(marksQ.rows.map((k) => [`${k.groupid}|${k.uk}`, k]));
  const asinBy = new Map(asinQ.rows.map((r) => [r.groupid, r.asin.trim()]));

  // A mark in force today: the size hasn't arrived since it was marked, and (Park / Ordered) its until is still ahead — back ON the
  // until day. Not made has no until.
  const liveMark = (k, key) => {
    if (!k || arrived.has(key)) return null;
    if (k.mark === 'notmade') return k;
    if (!k.until || k.until <= today) return null;
    return k;
  };

  const counts = { open_styles: 0, open_sizes: 0, park: 0, ordered: 0, notmade: 0 };
  const styles = [];
  for (const s of stylesQ.rows) {
    const sizes = [];
    let gaps = 0, open = 0;
    for (let uk = s.uk_from; uk <= s.uk_to; uk += 1) {
      const key = `${s.groupid}|${uk}`;
      const have = bySize.get(key);
      let state = 'gap';
      if (have) {
        if (have.units > 0) state = 'held';
        else if (have.on_order > 0) state = 'onorder';
        else if (have.last_sale && have.last_sale > soldSince) state = 'selling';
      }
      const k = state === 'gap' ? liveMark(markBy.get(key), key) : null;
      if (state === 'gap') {
        gaps += 1;
        if (k) counts[k.mark] += 1; else open += 1;
      }
      sizes.push({
        uk,
        code: have ? have.code : null,
        state,
        is_new: !have,
        units: have ? have.units : 0,
        on_order: have ? have.on_order : 0,
        last_sale: have ? have.last_sale : null,
        per_pair: perPairBySize.has(key) ? perPairBySize.get(key) : null,
        mark: k ? { mark: k.mark, until: k.until, marked_on: k.marked_day, marked_by: k.marked_by } : null,
      });
    }
    if (!gaps) continue;
    if (open) { counts.open_styles += 1; counts.open_sizes += open; }
    styles.push({
      groupid: s.groupid, title: s.title || null, brand: s.brand, imagename: s.imagename || null,
      asin: asinBy.get(s.groupid) || null, sizing: s.sizing, best: bestBy.get(s.groupid) || null, sizes,
    });
  }
  // Best size's profit a pair first; a style with nothing sold in 12 months last; ties by group id.
  styles.sort((a, b) => {
    if (a.best && b.best) return b.best.per_pair - a.best.per_pair || a.groupid.localeCompare(b.groupid);
    if (a.best) return -1;
    if (b.best) return 1;
    return a.groupid.localeCompare(b.groupid);
  });

  return { today, ranges, styles, counts };
}

module.exports = { MARKS, GAP_DAYS, readSizeGaps };
