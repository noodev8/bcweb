/*
=======================================================================================================================================
Util: amzBuyBoxDeck  (THE rules for "Go through" — the Buy Box one-at-a-time screen, /amz/buybox/deck, 2026-11-12)
=======================================================================================================================================
Purpose: Turn the two Buy Box groups that have a job into a short deck of decisions, one size at a time, each with ONE suggested move —
         so a price change is made LOOKING at the Buy Box instead of blind from the Due list (1,076 changes by one person in 22 days,
         median 11 s apart, and 0 in-stock sizes Due on 2026-11-12: the team already gets through everything; the question is whether
         each move is right). PLAN.md step 3 (the Match / Raise presses) — started on the owner's say, 2026-11-12. A TRIAL: it may
         become the main Amazon pricing screen or be folded away. Laptop first (owner: "95% of our price changes will be on laptop"),
         usable on a phone. Reads utils/amzBuyBox.js → readScreen (the stored reading, never Amazon). The write is the normal W-A1
         (POST /amz-apply), sent to Amazon at once — nothing here writes.

THE DECKS (owner agreed the recommendations, 2026-11-12):
  room       "Winning, room to go up" -> RAISE to the next rival above us minus 1p, capped at +5% on our price and at the RRP; never down.
             (Room is still a guess — FBA wins above cheaper self-posters — so the cap keeps each step small; history will show more.)
             AND, when a rival already sells BELOW us, capped at 2% over that cheapest rival (owner, 2026-11-12). Why: across the
             2026-11-12 reading our average share of views was 78% as the cheapest offer, 54% at 0–2% over the cheapest rival, 46% at
             2–5%, 12% at 5–8% and ~0 at 20%+ — the FBA premium over a cheaper self-poster is only a few %. A size already 2%+ over
             the cheaper rival gets NO card (counted as `cheaper_rival`) — raising would give views away.
  can_match  "Losing, can match"      -> MATCH: a penny under the lead price, postage included. A penny under, not level: at our exact
             price Amazon gives the tie to the rival (the 'tie' group). Never under the £3 walk-away — if a penny under would be, the
             suggestion is the lead price itself (a tie, said on the card).
  Every other group's answer is "leave it", so it makes no card.

WHO IS IN A DECK:
  - SOLD IN 30 DAYS only (owner: leave out sizes that sold nothing, at first) — counted as `not_selling`.
  - NOT ACTED ON SINCE THE READING: a size with a price set after its reading (amz_price_log newer than read_at — set_since, any
    screen, any person) leaves the deck and comes back only once a reading has SEEN its new price, if it is still in the group
    (owner agreed: the cooldown is the next reading, not a review date — the same test Team week judges a move by). Counted as
    `waiting`. The deck never READS review dates. A Set PARKS the size 7 days on the Amazon review date, keeping a later one
    (owner, 2026-11-12: so the Due list doesn't move it again blind — this screen is the preferred place; the screen sends it).
  - room: NOT RAISED WITHOUT A SALE SINCE — the last real price move a raise and no net pair sold since: no card until one sells
    (owner, 2026-11-12; see the filter in readDeck). Counted as `raised_waiting`.
  - can_match: our offer not "not eligible" — no price wins a Buy Box Amazon won't consider us for. Counted as `not_eligible`.
  "Leave" on the screen is a skip for this visit only (nothing stored), like the Buy Box screen's ×.

ORDER — money at stake first, so the first cards are the ones that matter:
  room       pairs a week × the extra profit a pair at the suggested price ("≈ £x a week more if it keeps selling" — shown on the card).
  can_match  pairs in 30 days × the share of views we are NOT shown to (no £ figure: how many more we'd sell is unknown).

PROFIT ON THE CARD: amzProfit is a straight line in price (fees and VAT are % of price, the rest fixed, then ÷1.2), so each card carries
  that line (profit = per_pound × price + at_zero) worked out HERE from two amzProfit calls — the screen prices a typed-in figure
  without a second copy of the formula.
=======================================================================================================================================
*/

const { amzProfit } = require('./amzProfit');
const { readScreen } = require('./amzBuyBox');
const { placed } = require('./orderStatus');

const DECKS = ['room', 'can_match'];
const RAISE_CAP = 0.05;            // a raise is at most +5% on our price per step
const OVER_CHEAPER_CAP = 0.02;     // ...and at most 2% over a rival already cheaper than us (header)
const PENNY = 0.01;

const floor2 = (n) => Math.floor(n * 100 + 1e-6) / 100;
const ceil2 = (n) => Math.ceil(n * 100 - 1e-6) / 100;
const r2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

/** profit = per_pound × price + at_zero (see header). null when the cost is unknown. */
function profitLine(econ) {
  const a = amzProfit({ ...econ, price: 10 }).profit;
  const b = amzProfit({ ...econ, price: 110 }).profit;
  if (a === null || b === null) return null;
  const perPound = (b - a) / 100;
  return { per_pound: Math.round(perPound * 1e6) / 1e6, at_zero: Math.round((a - perPound * 10) * 1e4) / 1e4 };
}

/** The cheapest rival offer priced BELOW us (postage included, as stored), or null when we are the cheapest. */
function cheaperRival(r) {
  const below = (r.offers || []).filter((o) => !o.us && o.price !== null && o.price !== undefined && Number(o.price) < r.our_price - 0.005);
  return below.length ? Math.min(...below.map((o) => Number(o.price))) : null;
}

/** The suggested move for one stored row of the Buy Box screen. Returns { price, note } or null when there is no move. */
function suggest(r) {
  if (r.our_price === null) return null;
  if (r.group === 'room') {
    if (r.next_up === null) return null;
    let p = floor2(Math.min(r.next_up - PENNY, r.our_price * (1 + RAISE_CAP)));
    let note = p <= r.next_up - PENNY - 0.005 ? 'Capped at +5% — the next rival is further up' : 'A penny under the next rival above us';
    if (r.rrp !== null && p > r.rrp) { p = floor2(r.rrp); note = 'Capped at the RRP'; }
    const cheaper = cheaperRival(r);
    if (cheaper !== null && p > floor2(cheaper * (1 + OVER_CHEAPER_CAP))) {
      p = floor2(cheaper * (1 + OVER_CHEAPER_CAP));
      note = `Capped at 2% over the cheaper rival (${'£' + cheaper.toFixed(2)})`;
    }
    return p > r.our_price + 0.005 ? { price: p, note } : null;
  }
  if (r.group === 'can_match') {
    if (r.bb_price === null) return null;
    const under = r2(r.bb_price - PENNY);
    if (r.walk !== null && under < ceil2(r.walk)) {
      return { price: r2(r.bb_price), note: 'Level with the lead — a penny under would be below the £3 walk-away (a tie usually goes to them)' };
    }
    return { price: under, note: 'A penny under the lead price, postage included' };
  }
  return null;
}

async function readDeck(db) {
  const screen = await readScreen(db);
  const counts = Object.fromEntries(DECKS.map((d) => [d, 0]));
  const leftOut = Object.fromEntries(DECKS.map((d) => [d, { not_selling: 0, not_selling_recent: 0, waiting: 0, not_eligible: 0, cheaper_rival: 0, raised_waiting: 0 }]));

  const picked = [];
  const notSelling = [];
  for (const r of screen.rows) {
    if (!DECKS.includes(r.group)) continue;
    if (r.set_since !== null) { leftOut[r.group].waiting += 1; continue; }
    if (!(r.sold30 > 0)) { leftOut[r.group].not_selling += 1; notSelling.push(r); continue; }
    if (r.group === 'can_match' && r.our_eligible === false) { leftOut[r.group].not_eligible += 1; continue; }
    const s = suggest(r);
    if (!s) { if (r.group === 'room' && cheaperRival(r) !== null) leftOut[r.group].cheaper_rival += 1; continue; }
    picked.push({ r, s });
  }

  // NOT SELLING, SPLIT (owner, 2026-11-12: "Do we never go down here? ... is the feeling here, just wait"): the Buy Box isn't the
  // question for a size that sold nothing in 30 days — we're shown on most of them — demand and price are. So the note says where
  // each is handled: `not_selling_recent` = last net Amazon sale within 90 days (slowed, mostly season: wait — the review dates
  // bring it back); the rest (never sold on Amazon, or 90+ days ago) are Range / Clearance's job. `not_selling` stays the total.
  if (notSelling.length) {
    const recent = new Set((await db.query(
      `SELECT DISTINCT code FROM sales WHERE channel = 'AMZ' AND qty > 0 AND code = ANY($1) AND solddate >= CURRENT_DATE - 90`,
      [notSelling.map((r) => r.code)])).rows.map((x) => x.code));
    for (const r of notSelling) if (recent.has(r.code)) leftOut[r.group].not_selling_recent += 1;
  }

  // The style's picture (the thumbnails' imagename), one query for the whole deck.
  const groupids = [...new Set(picked.map((p) => p.r.groupid).filter(Boolean))];
  const imgs = groupids.length
    ? await db.query(`SELECT groupid, imagename FROM skusummary WHERE groupid = ANY($1)`, [groupids])
    : { rows: [] };
  const imageOf = Object.fromEntries(imgs.rows.map((x) => [x.groupid, x.imagename || null]));

  // cost / fbafee / tax for the profit line — readScreen doesn't return them, so read them for the picked sizes only.
  const codes = picked.map((p) => p.r.code);
  const econRows = codes.length
    ? await db.query(
      `SELECT a.code, a.fbafee, sk.cost, sk.tax FROM amzfeed a JOIN skumap m ON m.code = a.code
       LEFT JOIN skusummary sk ON sk.groupid = m.groupid WHERE a.code = ANY($1)`, [codes])
    : { rows: [] };
  const econOf = Object.fromEntries(econRows.rows.map((x) => [x.code, { cost: x.cost, fbafee: x.fbafee, tax: x.tax }]));

  // MORE COMING (owner, 2026-11-12): a low "weeks left" reads as scarce when a restock is already on its way. On order = supplier
  // lines (2 local / 3 Amazon) PLACED with the supplier and not yet arrived (utils/orderStatus.js → placed); at home = sellable
  // local stock (#FREE). Shown on the card only — neither changes the suggestion.
  const stockRows = codes.length
    ? await db.query(
      `SELECT c.code,
              (SELECT COUNT(*) FROM orderstatus o WHERE o.shopifysku = c.code AND o.ordertype IN (2, 3)
                 AND ${placed('o')} AND COALESCE(o.arrived, 0) = 0)::int AS on_order,
              (SELECT COALESCE(SUM(l.qty), 0) FROM localstock l WHERE l.code = c.code AND l.ordernum = '#FREE'
                 AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0)::int AS at_home,
              (SELECT to_char(m.next_amz_price_review, 'YYYY-MM-DD') FROM skumap m WHERE m.code = c.code LIMIT 1) AS next_review
       FROM unnest($1::text[]) AS c(code)`, [codes])
    : { rows: [] };
  const stockOf = Object.fromEntries(stockRows.rows.map((x) => [x.code, x]));

  // LAST CHANGED (owner, 2026-11-12): the size's last real price MOVE (holds — same-price saves — skipped), by whom, and the net
  // Amazon pairs sold since that day (sales carry a date only, so a sale earlier on the same day counts — as Team week). Shows
  // whether the last step held before taking the next one, and a size someone just moved from another screen.
  const lastRows = codes.length
    ? await db.query(
      `WITH last AS (
         -- changed_at is NULL on the 458 rows logged before it existed (Apr – Jul 2026): fall back to log_date, else those NULLs
         -- would sort FIRST under DESC and pass for the latest change.
         SELECT DISTINCT ON (code) code, COALESCE(changed_at, log_date::timestamptz) AS changed_at, changed_by,
                old_price::float8 AS old_price, new_price::float8 AS new_price
         FROM amz_price_log WHERE code = ANY($1) AND abs(new_price - old_price) >= 0.005
         ORDER BY code, COALESCE(changed_at, log_date::timestamptz) DESC, id DESC)
       SELECT l.code, l.changed_at::text AS changed_at, l.changed_by, l.old_price, l.new_price,
              (SELECT COALESCE(SUM(s.qty), 0) FROM sales s WHERE s.channel = 'AMZ' AND s.code = l.code
                 AND s.solddate >= (l.changed_at AT TIME ZONE 'Europe/London')::date)::int AS sold_since
       FROM last l`, [codes])
    : { rows: [] };
  const lastOf = Object.fromEntries(lastRows.rows.map((x) => [x.code, {
    at: x.changed_at, by: x.changed_by, old_price: x.old_price, new_price: x.new_price, sold_since: x.sold_since }]));

  // THE 30-DAY STRIP (owner, 2026-11-12: "want to be able to glance" — BLACKSOLE-05 sold 5 at £41.79 in 26–29 Oct, then nothing
  // for 14 days once a self-poster came in under it; "4 sold since" hid that). Per card: net Amazon pairs per UK day for the last
  // 30 days (oldest first, today last), the real price moves in those days (holds skipped), and how many days since the last pair
  // sold (any time; null = never). Shown only — no rule reads it.
  const STRIP_DAYS = 30;
  const [stripSales, stripMoves, lastSales] = codes.length ? await Promise.all([
    db.query(`SELECT code, (CURRENT_DATE - solddate)::int AS ago, SUM(qty)::int AS n FROM sales
               WHERE channel = 'AMZ' AND code = ANY($1) AND solddate > CURRENT_DATE - $2::int GROUP BY 1, 2`, [codes, STRIP_DAYS]),
    db.query(`SELECT code, (CURRENT_DATE - (COALESCE(changed_at, log_date::timestamptz) AT TIME ZONE 'Europe/London')::date)::int AS ago,
                     changed_by, old_price::float8 AS old_price, new_price::float8 AS new_price
                FROM amz_price_log WHERE code = ANY($1) AND abs(new_price - old_price) >= 0.005
                 AND COALESCE(changed_at, log_date::timestamptz) >= CURRENT_DATE - ($2::int - 1)
               ORDER BY COALESCE(changed_at, log_date::timestamptz), id`, [codes, STRIP_DAYS]),
    db.query(`SELECT code, (CURRENT_DATE - MAX(solddate))::int AS ago FROM sales
               WHERE channel = 'AMZ' AND qty > 0 AND code = ANY($1) GROUP BY 1`, [codes]),
  ]) : [{ rows: [] }, { rows: [] }, { rows: [] }];
  const stripOf = {};
  for (const c of codes) stripOf[c] = { sold: Array(STRIP_DAYS).fill(0), moves: [], last_sold_ago: null };
  for (const x of stripSales.rows) if (x.ago >= 0 && x.ago < STRIP_DAYS) stripOf[x.code].sold[STRIP_DAYS - 1 - x.ago] = x.n;
  for (const x of stripMoves.rows) {
    if (x.ago >= 0 && x.ago < STRIP_DAYS) stripOf[x.code].moves.push({ day: STRIP_DAYS - 1 - x.ago, by: x.changed_by, old_price: x.old_price, new_price: x.new_price });
  }
  for (const x of lastSales.rows) stripOf[x.code].last_sold_ago = x.ago;

  // ONE STEP, THEN A SALE (owner, 2026-11-12: "otherwise we are making a guess on top of a guess"): a Room size whose last price
  // move was a RAISE with no net pair sold since gets no card — it would come back after every reading and step up again on no
  // evidence (BLACKSOLE-08: raised £39.89 -> £41.88 in the morning, suggested £43.97 that afternoon). The Buy Box half of the
  // test is hourly anyway: a raise that lost the box leaves Room by itself. Back once a pair sells; a size that then sells
  // nothing for 30 days falls into not_selling. Cuts and Can match are not held (losing the box costs sales now).
  const kept = picked.filter(({ r }) => {
    const l = lastOf[r.code];
    if (r.group === 'room' && l && l.new_price > l.old_price + 0.005 && !(l.sold_since > 0)) {
      leftOut.room.raised_waiting += 1;
      return false;
    }
    return true;
  });

  const cards = kept.map(({ r, s }) => {
    const econ = econOf[r.code] || {};
    const profitNow = amzProfit({ ...econ, price: r.our_price }).profit;
    const profitSuggest = amzProfit({ ...econ, price: s.price }).profit;
    const perWeek = r.sold30 * 7 / 30;
    let stake;
    let gain = null;
    if (r.group === 'room') {
      gain = profitNow !== null && profitSuggest !== null ? r2(perWeek * (profitSuggest - profitNow)) : null;
      stake = gain ?? 0;
    } else {
      stake = r.sold30 * (100 - (r.our_share ?? 0)) / 100;
    }
    counts[r.group] += 1;
    return {
      deck: r.group, code: r.code, groupid: r.groupid, title: r.title, brand: r.brand, asin: r.asin, imagename: imageOf[r.groupid] ?? null,
      read_at: r.read_at, live: r.live, total: r.total, sold30: r.sold30, weeks_left: r.weeks_left,
      on_order: stockOf[r.code]?.on_order ?? 0, at_home: stockOf[r.code]?.at_home ?? 0,
      next_review: stockOf[r.code]?.next_review ?? null,   // the Amazon review date — the screen keeps a later one when it parks
      last_change: lastOf[r.code] ?? null,
      strip: stripOf[r.code],
      our_price: r.our_price, rrp: r.rrp, walk: r.walk,
      holder: r.holder, bb_price: r.bb_price, lead_share: r.lead_share, our_share: r.our_share, next_up: r.next_up, rivals: r.rivals,
      rival_at_our_price: r.rival_at_our_price, amazon_retail: r.amazon_retail,
      offers: r.offers, featured: r.featured,
      suggest: s.price, suggest_note: s.note,
      profit_now: profitNow, profit_suggest: profitSuggest, profit_line: profitLine(econ),
      gain_week: gain, stake,
    };
  });
  cards.sort((a, b) => b.stake - a.stake || b.sold30 - a.sold30 || a.code.localeCompare(b.code));

  return { cards, counts, left_out: leftOut, last_all: screen.last_all, running: screen.running };
}

module.exports = { DECKS, RAISE_CAP, OVER_CHEAPER_CAP, cheaperRival, suggest, profitLine, readDeck };
