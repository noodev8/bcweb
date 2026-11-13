/*
=======================================================================================================================================
Util: amzPricingStandard
=======================================================================================================================================
Purpose: THE Amazon pricing standard — one verdict and one suggested price per Amazon SIZE, judged against its sister sizes. Agreed
         with the owner one decision at a time on 2026-11-04 (memory: amz-size-pricing-standard). Read first by
         scripts/amz-pricing-check.js (the /amz-pricing skill, READ ONLY); a Pricing screen is meant to read the same functions once the
         verdicts are trusted — never a second copy of these rules.

WHY: Amazon prices each size separately (its own child ASIN, offer, Buy Box and stock), but a shopper sees one style page — same
photos, reviews, season and ads — and picks a size. So the sister sizes are the control. The case that started it: IVES-WHITE-06 sat
at £41.29 last winter with 26–29 pairs at FBA and sold 3 while the style sold 54 — and the Business Report showed we held its Buy Box
~4.5% of the time.

THE RULES (owner, 2026-11-04 — change them here and nowhere else; every number is a named setting in SETTINGS):
  1. PRICE PER SIZE, JUDGED AGAINST THE STYLE (style = our groupid).
  2. WINDOW = the size's CURRENT price period: from the day that price went live to `to` (today by default). Under 7 days = "too
     new" (no verdict — owner, 2026-11-04, was 14: in peak season a size reaches 5 expected pairs in days and 14 sat on a clear
     answer; in quiet months the 5-expected rule is what waits, so a busy weekend still can't decide it); over 12 weeks = judged on its last 12 weeks. Sisters are measured over exactly the same days, so the season
     cancels out. A NUDGE DOESN'T RESTART IT (owner, 2026-11-04): the period runs back for as long as the price stayed within 2% of
     today's — the team nudges sizes up ~30p a week while they keep selling ("if it continues selling, we continue getting bigger
     profit. That's the idea"), and a window restarted by every nudge never reached 14 days. A real move (> 2%) starts a new one.
  3. ONLY DAYS IN STOCK COUNT — for the expected pairs and for the normal share. In stock = the size-history row in force that day:
     an import row's live > 0, a ledger row's total > 0 (ledger rows only know the total). A day before a size's first history row
     is unknown and counted as in stock (no evidence it wasn't).
  4. BUY BOX FIRST: with a Business Report supplied, a size whose Buy Box % is under 50 is LOST BUY BOX, before anything else, and is
     left out of every sister median. Without a report the step is skipped and the output says so.
  5. EXPECTED PAIRS = style pairs sold on the size's in-stock window days × the size's NORMAL SHARE. Normal share = the size's pairs ÷
     the style's pairs on the days the size was in stock, over the 12 months before the window starts. Under 5 expected = CAN'T TELL.
  6. SELLING: under ½ expected = UNDER; over 1½× = OVER; else IN LINE.
  7. PRICE POSITION: the size's current price against the MEDIAN of its sisters' prices over the window — a sister counts when it was
     in stock on at least half the window's days and (with a report) holds the Buy Box. More than 2% above = ABOVE, more than 2%
     below = BELOW, else LEVEL.
  8. VERDICTS: LOST_BUY_BOX · TOO_HIGH (under + above) · NOT_PRICE (under + level/below) · LEAVE (in line + above/level) ·
     ROOM_TO_GO_UP (over at any price, or in line + below) · CANT_TELL.
  9. SUGGESTIONS — LEAN (default): Too high → sister median; Room to go up → the median if priced below it, else +3%.
     PUSH: Too high → median − 3%; Room to go up → the median if priced below, else HOLD; Leave priced above → the median.
     Never above RRP. NEVER BELOW THE WALK-AWAY PRICE (the price keeping £3 a pair — amzProfit.priceForProfit, Simmer's bar): a cut
     that would go under it stops at it and says so; Lost Buy Box suggests NO price, only the walk-away ("worth chasing to £x, no
     lower" — owner: don't follow the Buy Box race to the bottom). The human always decides; nothing here writes.
     NO STEP RULE for Lost Buy Box (owner, 2026-11-04: "Lets not do it at all. It muddys the water for now. Let the human decide but
     have the data available. Human and your judgement rather than a step rule") — a sell-by target (26 weeks / 90 days) was
     proposed and turned down. The data for that judgement is on every row: pairs a week at this price, weeks of stock left, the
     next 4 weeks' profit (FORECAST_WEEKS).
  10. The verdict itself ignores review dates — a new price starts a new window, and the check says when there is enough evidence
      again. But WHICH sizes get checked follows the team's Amazon Due list (owner, 2026-11-04: "same system as our manual due
      dates" — `--top` ranked by 12-month sales and showed the same Ives colours every time): `dueStyles` = the sizes the Amazon
      screens call Due (FBA stock, due by THE ONE AMAZON RULE — utils/amzDue.js, docs/amz-buybox/PLAN.md decision 26, 2026-11-13:
      a size the Buy Box answers in Chilled (selling at FBA, or New) is never due — its cards are worked on Amazon Pricing (decision
      27) — every other size when its review date has passed or is unset — the rule routes/amz-all-list.js uses), and a
      size the skill decides on is parked like a manual review: REVIEW_AFTER_PRICE_DAYS after a price, REVIEW_AFTER_LEAVE_DAYS
      after a "leave" (owner: "use smaller windows ... amazon sales are way before 14 days"). A later review date already set is
      kept. CAN'T TELL sizes are not parked by the skill — they stay Due for the team.

IMPLEMENTATION CHOICES (not owner decisions — flagged so they can be revisited):
  - Units are GROSS orders (sales qty > 0). A return is dated when it comes back and books at £0, so it can't be placed against the
    price it sold at (the same choice as utils/sellSpeed.js's price steps). Business Report "Units ordered" is gross too.
  - A size's price on a day = the latest of: an amz_price_log real change by its LIVE day (utils/sellSpeed.js's rule), a size-history
    import row's price, a sale's price, and (when `to` is today) amzfeed's price. Same-day priority feed > history > log > sale (a
    sale can go at the old price on the day of a change). Prices within 1p are the same price (39.98 / 39.99). A sale's price is
    used ONLY before the size's first log row — after that the log is the record and odd sale prices (B2B, vouchers) are ignored.
  - When the current price is first seen in a SALE (no log row — the log starts Apr 2026), it went live some time after the last
    sign of the previous price. The window starts the day after that sign (the earliest it can have been live) and the row is
    marked `startUncertain`.
  - A normal share needs MIN_NORMAL_STYLE_PAIRS style pairs on the size's in-stock days, or the size reads CAN'T TELL ("no normal").
  - An unknown price position (no sister qualifies) reads: Over → Room to go up (+3%); In line → Leave; Under → Can't tell.

Exports:
  SETTINGS
  findStyles(db, text)                         -> groupids on Amazon matching the text
  topStyles(db, n, to)                         -> the n styles with the most Amazon pairs in the 12 months to `to`
  dueStyles(db, { on, all })                   -> [{ groupid, codes, parked: { code: 'YYYY-MM-DD' } }] — styles with a size Due on
                                                  the Amazon screens (rule 10); on = look ahead to that day; all = the OVERRIDE,
                                                  parked sizes too
  readBusinessReport(db, file)                 -> Map code -> { buyBox, sessions, units } (MSKU -> code via amzfeed.sku)
  checkStyle(db, groupid, { to, mode, buyBox }) -> { style, sizes } — everything the script / a screen prints
  decide(row, mode)                            -> { verdict, reason, suggested, note } — THE verdict, pure
=======================================================================================================================================
*/

const { safeNumeric, LONDON_TODAY_SQL } = require('./sql');
const { LIVE_DAY, REAL_CHANGE } = require('./sellSpeed');
const { amzProfit, priceForProfit } = require('./amzProfit');
const { readCsv } = require('./csv');

const SETTINGS = Object.freeze({
  MIN_WINDOW_DAYS: 7,             // a price younger than this is "too new" (owner, 2026-11-04 — was 14)
  MAX_WINDOW_DAYS: 84,            // 12 weeks — an older price is judged on its last 12 weeks
  NORMAL_DAYS: 365,               // the normal share is measured over the 12 months before the window
  MIN_EXPECTED: 5,                // under 5 expected pairs = can't tell
  UNDER_RATIO: 0.5,               // sold under half expected = under
  OVER_RATIO: 1.5,                // sold over 1½× expected = over
  POSITION_BAND: 0.02,            // more than 2% from the sister median = above / below
  SISTER_MIN_STOCK_SHARE: 0.5,    // a sister counts when in stock on at least half the window's days
  BUY_BOX_MIN: 50,                // Buy Box % under this = lost Buy Box
  RAISE_STEP: 0.03,               // Lean: room to go up = +3%
  PUSH_UNDERCUT: 0.03,            // Push: too high = median − 3%
  WALK_AWAY_PROFIT: 3,            // £ kept a pair at the walk-away price
  MIN_NORMAL_STYLE_PAIRS: 20,     // implementation choice: a normal share needs this many style pairs behind it
  SAME_PRICE: 0.011,              // prices within 1p are one price
  FORECAST_WEEKS: 4,              // "a profit estimate inside a month" (owner) — shown, not a rule
  NUDGE_BAND: 0.02,               // a price within 2% of today's is the same price period (a nudge doesn't restart the window)
  REVIEW_AFTER_PRICE_DAYS: 7,     // park a size the skill priced — MIN_WINDOW_DAYS, the earliest the new price can be judged (rule 10)
  REVIEW_AFTER_LEAVE_DAYS: 3,     // park a size the skill checked and left — short: Amazon moves within days (owner, 2026-11-04)
});

const MODES = ['lean', 'push'];

// ---- dates (ISO 'YYYY-MM-DD' strings; noon UTC so a BST shift can't move the day) ----------------------------------------------
function addDay(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { // b - a, in days
  return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
}
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const samePrice = (a, b) => a !== null && b !== null && Math.abs(a - b) <= SETTINGS.SAME_PRICE;

// The size suffix after the last '-' (CLAUDE.md: never RIGHT(code,2)); numeric sort where it is a number.
const sizeOf = (code) => String(code).split('-').pop();
const sizeSort = (a, b) => {
  const x = Number(sizeOf(a)); const y = Number(sizeOf(b));
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return String(a).localeCompare(String(b));
};

// ---- finding styles -----------------------------------------------------------------------------------------------------------
/** Groupids with at least one Amazon size, matching the text (exact first, else contains). */
async function findStyles(db, text) {
  const t = String(text || '').trim();
  const r = await db.query(
    `SELECT DISTINCT m.groupid FROM amzfeed a JOIN skumap m ON m.code = a.code
     WHERE m.groupid ILIKE $1 ORDER BY m.groupid`,
    [`%${t}%`]
  );
  const all = r.rows.map((x) => x.groupid);
  const exact = all.filter((g) => g.toLowerCase() === t.toLowerCase());
  return exact.length ? exact : all;
}

/** The n styles on Amazon with the most gross Amazon pairs in the 12 months to `to`. */
async function topStyles(db, n, to) {
  const r = await db.query(
    `SELECT m.groupid, SUM(s.qty)::int AS pairs
     FROM sales s JOIN skumap m ON m.code = s.code
     WHERE s.channel = 'AMZ' AND s.qty > 0 AND s.solddate > $1::date - 365 AND s.solddate <= $1::date
       AND EXISTS (SELECT 1 FROM amzfeed a JOIN skumap m2 ON m2.code = a.code WHERE m2.groupid = m.groupid)
     GROUP BY m.groupid ORDER BY pairs DESC LIMIT $2`,
    [to, n]
  );
  return r.rows;
}

// THE Amazon Due list, by style (rule 10). Same rule as routes/amz-all-list.js's Due switch — FBA stock live or on its way in, due by
// THE ONE AMAZON RULE (utils/amzDue.js) — so the skill and the screens mean the same by "Due".
// Today, or a day AHEAD (`on`: what will be Due then — review dates have no history, so never a past day; the Buy Box half is judged
// on today's reading whatever `on` says — there is no reading of a day ahead). A Buy Box size with no card shows in `parked` as
// "Buy Box" (no date decides it). `all` is the OVERRIDE
// (owner, 2026-11-04: "we need to be able to override due when seeing the list" — the team prices by hand, so the Due list is
// often empty while the top sellers still need a look): parked sizes come too, with their review date in `parked`, like the
// screens' Due switch off. The status lists' 0-stock rows are left
// out: no stock, no verdict.
async function dueStyles(db, { on = null, all = false } = {}) {
  // Required here, not at the top: utils/amzBuyBox.js reads this file's SETTINGS, and amzDue → amzBuyBoxDeck → amzBuyBox would
  // otherwise load this file half-built (a require cycle).
  const { readBuyBoxSide, sideParams, dueSql } = require('./amzDue');
  const sp = sideParams(await readBuyBoxSide(db));
  const due = dueSql('a.code', 'm.next_amz_price_review', '$3', 'COALESCE($1::date, CURRENT_DATE)');
  const r = await db.query(
    `SELECT m.groupid, array_agg(a.code ORDER BY a.code) AS codes,
            COALESCE(jsonb_object_agg(a.code, CASE WHEN a.code = ANY($3::text[]) THEN 'Buy Box' ELSE m.next_amz_price_review::text END)
                       FILTER (WHERE NOT ${due}), '{}'::jsonb) AS parked
     FROM amzfeed a JOIN skumap m ON m.code = a.code
     WHERE (COALESCE(a.amzlive, 0) > 0 OR COALESCE(a.amztotal, 0) > 0)
       AND ($2::boolean OR ${due})
     GROUP BY m.groupid ORDER BY m.groupid`,
    [on, all, sp.bb]
  );
  return r.rows;
}

// ---- Business Report ----------------------------------------------------------------------------------------------------------
/**
 * Seller Central → Reports → Business Reports → Detail Page Sales and Traffic by Child Item (CSV). The legacy file has NO date
 * column — the dates are whatever was picked when downloading, so the caller states them. amzn.gr.* rows (Amazon's resale of our
 * returns) are skipped. Business Reports retire at the end of 2026 for Custom Analytics (owner, 2026-11-04) — supplied per analysis
 * for now, storing it is a later decision.
 */
async function readBusinessReport(db, file) {
  const rows = readCsv(file);
  const need = ['SKU', 'Featured Offer (Buy Box) percentage', 'Units ordered'];
  const missing = need.filter((c) => rows.length && !(c in rows[0]));
  if (!rows.length || missing.length) {
    throw new Error(`Not a Business Report (Detail Page Sales and Traffic by Child Item) — missing: ${missing.join(', ') || 'rows'}`);
  }
  const sessionsCol = Object.keys(rows[0]).find((k) => /^Sessions\s*[–-]\s*Total$/.test(k));
  const feed = await db.query(`SELECT sku, code FROM amzfeed WHERE sku IS NOT NULL AND code IS NOT NULL`);
  const bySku = new Map(feed.rows.map((f) => [f.sku, f.code]));
  const n = (v) => Number(String(v ?? '').replace(/[£,%\s]/g, '')) || 0;
  const out = new Map();
  let unknown = 0;
  for (const r of rows) {
    const sku = String(r.SKU || '');
    if (!sku || sku.startsWith('amzn.gr.')) continue;
    const code = bySku.get(sku);
    if (!code) { unknown += 1; continue; }
    out.set(code, {
      buyBox: n(r['Featured Offer (Buy Box) percentage']),
      sessions: sessionsCol ? n(r[sessionsCol]) : null,
      units: n(r['Units ordered']),
    });
  }
  out.unknownSkus = unknown;
  return out;
}

// ---- the verdict (pure) -------------------------------------------------------------------------------------------------------
/**
 * THE verdict for one size row (as built by checkStyle). Returns { verdict, reason, suggested, note }.
 * suggested = the price to move to, or null (no move). note explains a cap / floor.
 */
/**
 * The sister reading — selling (expected vs sold) × price position → a verdict, or a CAN'T TELL reason. Shared by the normal
 * verdict and the Lost Buy Box line, so both read the sizes the same way.
 */
function sisterReading(row) {
  const S = SETTINGS;
  if (row.priceAgeDays < S.MIN_WINDOW_DAYS) return { verdict: 'CANT_TELL', why: `too new — price live ${row.priceAgeDays} days` };
  if (row.normalShare === null) return { verdict: 'CANT_TELL', why: 'no normal share yet (too few style sales in the 12 months before)' };
  if (row.expected < S.MIN_EXPECTED) return { verdict: 'CANT_TELL', why: `expected ${row.expected.toFixed(1)} pairs (under ${S.MIN_EXPECTED})` };
  const ratio = row.sold / row.expected;
  const selling = ratio < S.UNDER_RATIO ? 'under' : ratio > S.OVER_RATIO ? 'over' : 'in line';
  const pos = row.position; // 'above' | 'level' | 'below' | null
  const med = row.sisterMedian;
  const who = row.sisterGroup === 'contested' ? 'the contested sisters\' median' : 'the sister median';
  const why = `sold ${row.sold} of ${row.expected.toFixed(1)} expected (${selling})` +
    (pos ? `, priced ${pos}${med !== null ? ` ${who} £${med.toFixed(2)}` : ''}` : ', no sister price to compare');
  let verdict;
  if (selling === 'under') verdict = pos === 'above' ? 'TOO_HIGH' : pos ? 'NOT_PRICE' : 'CANT_TELL';
  else if (selling === 'over') verdict = 'ROOM_TO_GO_UP';
  else verdict = pos === 'below' ? 'ROOM_TO_GO_UP' : 'LEAVE';
  return { verdict, why, selling, pos, med };
}

function decide(row, mode = 'lean') {
  const S = SETTINGS;
  const out = (verdict, reason, suggested = null, note = null, extra = {}) => ({ verdict, reason, suggested, note, ...extra });
  const P = row.price;
  if (P === null) return out('CANT_TELL', 'no price known');

  if (row.buyBox !== null && row.buyBox !== undefined && row.buyBox < S.BUY_BOX_MIN) {
    // Still no price suggested (the human decides), but the sizes are compared with each other: `sisterVerdict` says whether this
    // one is pricing itself out on top of the competition (TOO_HIGH) or is in line with its contested sisters.
    const sr = sisterReading(row);
    return out('LOST_BUY_BOX',
      `Buy Box ${row.buyBox}% (under ${S.BUY_BOX_MIN}%) — another offer is winning · against its sisters: ` +
        `${sr.verdict === 'CANT_TELL' ? sr.why : `${sr.verdict.replace(/_/g, ' ').toLowerCase()} — ${sr.why}`}`,
      null,
      row.walkAway !== null ? `worth chasing down to £${row.walkAway.toFixed(2)}, no lower` : 'walk-away price unknown (no cost)',
      { sisterVerdict: sr.verdict });
  }
  const sr = sisterReading(row);
  if (!sr.selling) return out('CANT_TELL', sr.why);
  const { verdict, why, pos, med } = sr;

  // The move, before caps.
  let target = null;
  const push = mode === 'push';
  if (verdict === 'TOO_HIGH') target = push ? med * (1 - S.PUSH_UNDERCUT) : med;
  else if (verdict === 'ROOM_TO_GO_UP') {
    if (pos === 'below') target = med;
    else target = push ? null : P * (1 + S.RAISE_STEP);
  } else if (verdict === 'LEAVE' && push && pos === 'above') target = med;
  if (target === null) {
    const note = verdict === 'ROOM_TO_GO_UP' && push ? 'Push: hold — let it sell' : null;
    return out(verdict, why, null, note);
  }

  target = Math.round(target * 100) / 100;
  let note = null;
  if (target > P) {
    if (row.rrp !== null && target > row.rrp) {
      if (P >= row.rrp) return out(verdict, why, null, 'already at RRP');
      target = row.rrp; note = 'capped at RRP';
    }
  } else if (row.walkAway !== null && target < row.walkAway) {
    if (P <= row.walkAway) return out(verdict, why, null, `already at or under the walk-away price £${row.walkAway.toFixed(2)}`);
    target = row.walkAway; note = `stopped at the walk-away price (£${S.WALK_AWAY_PROFIT} a pair)`;
  }
  if (samePrice(target, P)) return out(verdict, why, null, 'already there');
  return out(verdict, why, target, note);
}

// ---- loading + building a style ------------------------------------------------------------------------------------------------
/**
 * Everything for one style, as of `to` (default: today, London). mode 'lean' | 'push'. buyBox = Map from readBusinessReport, or
 * null. READ ONLY.
 */
async function checkStyle(db, groupid, { to = null, mode = 'lean', buyBox = null } = {}) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
  const S = SETTINGS;
  const t = await db.query(`SELECT ${LONDON_TODAY_SQL}::text AS today`);
  const today = t.rows[0].today;
  const asOf = to || today;
  const live = asOf === today;
  const from = addDay(asOf, -(S.MAX_WINDOW_DAYS + S.NORMAL_DAYS + 60)); // enough to find each size's previous price

  // One query at a time: db may be a single transaction client (pg refuses overlapping queries on one client).
  const feedR = await db.query(
    `SELECT DISTINCT ON (a.code) a.code, a.sku, ${safeNumeric('a.amzprice')} AS price, a.amzlive AS live, a.amztotal AS total,
            a.fbafee, sk.cost, sk.tax, ${safeNumeric('sk.rrp')} AS rrp
     FROM amzfeed a JOIN skumap m ON m.code = a.code LEFT JOIN skusummary sk ON sk.groupid = m.groupid
     WHERE m.groupid = $1 ORDER BY a.code`,
    [groupid]
  );
  const codesR = await db.query(`SELECT DISTINCT code FROM skumap WHERE groupid = $1`, [groupid]);
  const feed = feedR.rows.sort((a, b) => sizeSort(a.code, b.code));
  if (!feed.length) return { style: { groupid, asOf, mode, found: false }, sizes: [] };
  const amzCodes = feed.map((f) => f.code);
  const allCodes = [...new Set([...codesR.rows.map((r) => r.code), ...amzCodes])];

  const salesR = await db.query(
    `SELECT code, solddate::text AS d, qty, soldprice, id FROM sales
     WHERE channel = 'AMZ' AND qty > 0 AND code = ANY($1) AND solddate BETWEEN $2::date AND $3::date ORDER BY solddate, id`,
    [allCodes, from, asOf]
  );
  const logR = await db.query(
    `SELECT l.code, ${LIVE_DAY}::text AS d, l.new_price, l.id FROM amz_price_log l
     WHERE ${REAL_CHANGE} AND l.code = ANY($1) AND ${LIVE_DAY} <= $2::date ORDER BY l.id`,
    [amzCodes, asOf]
  );
  const histR = await db.query(
    `SELECT code, day::text AS d, price, live, total, source FROM amz_size_history
     WHERE code = ANY($1) AND day <= $2::date ORDER BY code, day`,
    [amzCodes, asOf]
  );

  // Every day from `from` to asOf.
  const days = [];
  for (let d = from; d <= asOf; d = addDay(d, 1)) days.push(d);
  const idx = new Map(days.map((d, i) => [d, i]));

  // Style pairs per day, and each size's pairs per day.
  const styleDay = new Array(days.length).fill(0);
  const sizeDay = new Map(amzCodes.map((c) => [c, new Array(days.length).fill(0)]));
  for (const s of salesR.rows) {
    const i = idx.get(s.d);
    if (i === undefined) continue;
    styleDay[i] += s.qty;
    if (sizeDay.has(s.code)) sizeDay.get(s.code)[i] += s.qty;
  }

  // In stock per day, from the history row in force (unknown before the first row = in stock).
  const histBy = new Map(amzCodes.map((c) => [c, []]));
  for (const h of histR.rows) histBy.get(h.code).push(h);
  const stockDay = new Map();
  const totalAt = new Map();
  for (const c of amzCodes) {
    const rows = histBy.get(c);
    const arr = new Array(days.length);
    let p = -1;
    for (let i = 0; i < days.length; i += 1) {
      while (p + 1 < rows.length && rows[p + 1].d <= days[i]) p += 1;
      if (p < 0) { arr[i] = true; continue; }
      const h = rows[p];
      arr[i] = h.source === 'ledger' || h.live === null ? Number(h.total) > 0 : Number(h.live) > 0;
    }
    stockDay.set(c, arr);
    totalAt.set(c, rows.length ? Number(rows[rows.length - 1].total) : null);
  }

  // Price events per size: [day, price, priority, source]. Same-day priority: feed 4 > history 3 > log 2 > sale 1.
  const events = new Map(amzCodes.map((c) => [c, []]));
  // A sale's price stands in for the price ONLY before the size's first price-log row. Once the log covers a size, a sale is not a
  // price: odd ones (a B2B price, a voucher — IVES-WHITE-05 sold at £42.12 and £36.21 inside its £41.09–41.69 run, Sep 2026)
  // restarted the window and hid a Too high for weeks.
  const firstLog = new Map();
  for (const l of logR.rows) if (!firstLog.has(l.code) || l.d < firstLog.get(l.code)) firstLog.set(l.code, l.d);
  for (const s of salesR.rows) {
    if (!events.has(s.code) || !(num(s.soldprice) > 0)) continue;
    if (firstLog.has(s.code) && s.d >= firstLog.get(s.code)) continue;
    events.get(s.code).push([s.d, Number(s.soldprice), 1, 'sale']);
  }
  for (const l of logR.rows) if (num(l.new_price) > 0) events.get(l.code).push([l.d, Number(l.new_price), 2, 'log']);
  for (const h of histR.rows) if (h.source === 'import' && num(h.price) > 0) events.get(h.code).push([h.d, Number(h.price), 3, 'history']);
  if (live) for (const f of feed) if (num(f.price) > 0) events.get(f.code).push([asOf, Number(f.price), 4, 'feed']);
  for (const ev of events.values()) ev.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[2] - b[2]));

  // Price per day (latest event on or before; null before the first).
  const priceDay = new Map();
  for (const c of amzCodes) {
    const ev = events.get(c);
    const arr = new Array(days.length).fill(null);
    let p = -1;
    for (let i = 0; i < days.length; i += 1) {
      while (p + 1 < ev.length && ev[p + 1][0] <= days[i]) p += 1;
      arr[i] = p < 0 ? null : ev[p][1];
    }
    priceDay.set(c, arr);
  }

  const end = days.length - 1;
  const sum = (arr, a, b, keep) => { let x = 0; for (let i = a; i <= b; i += 1) if (!keep || keep[i]) x += arr[i]; return x; };
  const count = (keep, a, b) => { let x = 0; for (let i = a; i <= b; i += 1) if (keep[i]) x += 1; return x; };

  // Pass 1: each size's window.
  const base = feed.map((f) => {
    const ev = events.get(f.code);
    const price = priceDay.get(f.code)[end];
    let liveStart = null; let startUncertain = false;
    if (price !== null) {
      let k = ev.length - 1;
      while (k >= 0 && ev[k][0] > asOf) k -= 1;
      let firstSame = k;
      // Back through every price within the nudge band of today's — the start of the current price PERIOD, not the last nudge.
      const inPeriod = (p) => Math.abs(p - price) <= price * S.NUDGE_BAND + 1e-9;
      while (firstSame - 1 >= 0 && inPeriod(ev[firstSame - 1][1])) firstSame -= 1;
      const prev = firstSame - 1 >= 0 ? ev[firstSame - 1] : null;
      const first = ev[firstSame];
      if (first[3] === 'log' || !prev) liveStart = first[0];
      else {
        liveStart = addDay(prev[0], 1);
        if (liveStart > first[0]) liveStart = first[0];
        startUncertain = liveStart < first[0];
      }
      if (liveStart < days[0]) liveStart = days[0];
    }
    const priceAgeDays = liveStart ? daysBetween(liveStart, asOf) + 1 : 0;
    const winStartDay = liveStart ? (priceAgeDays > S.MAX_WINDOW_DAYS ? addDay(asOf, -(S.MAX_WINDOW_DAYS - 1)) : liveStart) : asOf;
    return { f, price, liveStart, startUncertain, priceAgeDays, winStart: idx.get(winStartDay) };
  });

  // Pass 2: expected, sold, sisters, verdict.
  const sizes = base.map((b) => {
    const { f, price } = b;
    const a = b.winStart;
    const inStock = stockDay.get(f.code);
    const winDays = end - a + 1;
    const inStockDays = count(inStock, a, end);
    const sold = sum(sizeDay.get(f.code), a, end);

    const na = Math.max(0, a - S.NORMAL_DAYS); const nb = a - 1;
    const normDen = nb >= na ? sum(styleDay, na, nb, inStock) : 0;
    const normNum = nb >= na ? sum(sizeDay.get(f.code), na, nb) : 0;
    const normalShare = normDen >= S.MIN_NORMAL_STYLE_PAIRS ? Math.min(1, normNum / normDen) : null;
    const stylePairs = sum(styleDay, a, end, inStock);
    const expected = normalShare === null ? null : stylePairs * normalShare;

    const bb = buyBox ? buyBox.get(f.code) : null;
    // Which sisters this size is compared with. A size HOLDING the Buy Box (or no report): the in-stock sisters that hold it too.
    // A size that LOST it: the in-stock sisters that lost it too — same page, same competitors, so the comparison is fair (owner,
    // 2026-11-04: "yes compare them against each other" — IVES-WHITE-05 at +£1.40 over the £39.99 sellers sold 0.4 a week while
    // 06 at +80p sold 3.5, every size contested); none = every in-stock sister.
    const lost = (x) => !!x && x.buyBox < S.BUY_BOX_MIN;
    const thisLost = lost(bb);
    const pick = (wantLost) => {
      const list = [];
      for (const o of base) {
        if (o.f.code === f.code) continue;
        const os = stockDay.get(o.f.code);
        if (count(os, a, end) < winDays * S.SISTER_MIN_STOCK_SHARE) continue;
        const obb = buyBox ? buyBox.get(o.f.code) : null;
        if (wantLost !== null && lost(obb) !== wantLost) continue;
        const op = priceDay.get(o.f.code);
        let tot = 0; let n = 0;
        for (let i = a; i <= end; i += 1) if (os[i] && op[i] !== null) { tot += op[i]; n += 1; }
        if (n) list.push({ code: o.f.code, price: tot / n });
      }
      return list;
    };
    let sisters = pick(thisLost);
    let sisterGroup = thisLost ? 'contested' : 'holding';
    if (thisLost && !sisters.length) { sisters = pick(null); sisterGroup = 'all'; }
    const sisterMedian = sisters.length ? median(sisters.map((s) => s.price)) : null;
    let position = null;
    if (sisterMedian !== null && price !== null) {
      position = price > sisterMedian * (1 + S.POSITION_BAND) ? 'above'
        : price < sisterMedian * (1 - S.POSITION_BAND) ? 'below' : 'level';
    }

    const walkAway = priceForProfit({ cost: f.cost, fbafee: f.fbafee, tax: f.tax }, S.WALK_AWAY_PROFIT);
    const keptAt = (p) => (p === null ? null : amzProfit({ price: p, cost: f.cost, fbafee: f.fbafee, tax: f.tax })?.profit ?? null);
    const units28 = sum(sizeDay.get(f.code), Math.max(0, end - 27), end);
    const stock = live ? num(f.total) : totalAt.get(f.code);

    const row = {
      code: f.code,
      size: sizeOf(f.code),
      price: price === null ? null : r2(price),
      liveStart: b.liveStart,
      startUncertain: b.startUncertain,
      priceAgeDays: b.priceAgeDays,
      windowFrom: days[a],
      windowTo: asOf,
      windowDays: winDays,
      inStockDays,
      sold,
      normalShare: normalShare === null ? null : Math.round(normalShare * 1000) / 1000,
      expected: expected === null ? null : Math.round(expected * 10) / 10,
      buyBox: bb ? bb.buyBox : null,
      sessions: bb ? bb.sessions : null,
      sisterMedian: sisterMedian === null ? null : r2(sisterMedian),
      sisters: sisters.map((s) => ({ code: s.code, price: r2(s.price) })),
      sisterGroup,
      position,
      rrp: num(f.rrp),
      walkAway,
      stock,
      liveNow: live ? num(f.live) : null,
      units28,
    };
    const d = decide(row, mode);
    // SELL-OUT + A MONTH'S PROFIT at the CURRENT price (owner, 2026-11-04: "a calculation of time to run out of stock ... and a
    // profit estimate inside a month" — the comfort check beside the verdict). Rate = pairs sold per in-stock week over the window
    // (the price's own pace, not last month's); needs a week in stock. Month = FORECAST_WEEKS, capped at the stock held.
    const keptNow = keptAt(row.price);
    const rate = inStockDays >= 7 ? (sold / inStockDays) * 7 : null;
    const weeksLeft = rate > 0 && stock !== null ? Math.round((stock / rate) * 10) / 10 : null;
    const profitMonth = rate !== null && keptNow !== null && stock !== null
      ? Math.round(Math.min(rate * S.FORECAST_WEEKS, stock) * keptNow) : null;
    return {
      ...row, ...d, keptNow, keptSuggested: keptAt(d.suggested),
      ratePerWeek: rate === null ? null : Math.round(rate * 10) / 10, weeksLeft, profitMonth,
    };
  });

  const stockAll = sizes.reduce((x, s) => x + (s.stock || 0), 0);
  const profitMonth = sizes.reduce((x, s) => x + (s.profitMonth || 0), 0);
  const units28 = sum(styleDay, Math.max(0, end - 27), end);
  return {
    style: {
      groupid,
      found: true,
      asOf,
      mode,
      buyBoxChecked: !!buyBox,
      stock: stockAll,
      units28,
      coverWeeks: units28 > 0 ? Math.round((stockAll / (units28 / 4)) * 10) / 10 : null,
      profitMonth,
      reportFrom: sizes.reduce((m, s) => (!m || s.windowFrom < m ? s.windowFrom : m), null),
    },
    sizes,
  };
}

module.exports = { SETTINGS, MODES, findStyles, topStyles, dueStyles, readBusinessReport, checkStyle, decide };
