/*
=======================================================================================================================================
Util: amzBuyBoxDeck  (THE rules for "Go through" — the Buy Box one-at-a-time screen, /amz/buybox/deck; answers and New
                      agreed 2026-11-12, docs/amz-buybox/PLAN.md decisions 13–20; staff guide = the claude.ai "Buy Box Guide")
=======================================================================================================================================
Purpose: Give every Amazon size IN STOCK AT AMAZON (FBA live > 0) ONE answer — Raise · Cut · Leave · Not for this screen — or put it on
         the NEW tab (landed in the last 30 days, no Amazon sale yet). Only Raise, Cut and New make cards, one size at a time, each with
         ONE suggested move, so a price change is made LOOKING at the Buy Box instead of blind from the Due list. The nine Buy Box groups
         (utils/amzBuyBox.js → classify) stay, but only as the REASONS behind an answer (owner: "remove all the other boxes ... that
         aren't a decision factor"). Reads utils/amzBuyBox.js → readScreen (the stored reading, never Amazon). The price write is the
         normal W-A1 (POST /amz-apply) / W-A2 (POST /amz-buybox-leave); recordPress below is the only thing here that writes.

IN STOCK ONLY (decision 13): a size with nothing live at FBA (inbound-only, sold out) gets no answer — the `not_live` group drops off.
         A sold-out size is Amazon Order's job (restock). The answers add up to the in-stock total.

NEW (decision 20 — "new is just first sale, then normal rules"): live at FBA, LANDED in the last NEW_DAYS (its first amz_size_history day
         with live > 0, or a ledger row with total > 0 — history reaches back to 2025-05-02), and NO Amazon sale yet. While new it is in
         no other pile. The card: a rival leads → a PENNY UNDER THE LEAD, straight away (no sold-in-30-days test — "bite quickly ... get
         it sold"); floor = BREAK-EVEN (profit £0, not the £3 walk-away — a pair sold at £0–£3 lands in Amazon Order's Simmer; a loss is
         never reordered). We already lead → no card. A rival shown at a price DEARER than ours → UP to a penny under it, never over
         the RRP (owner, 2026-11-13: "get the card"; at the RRP already = no card, reason `rrp`). And (owner, 2026-11-13: "keep it"):
           - a penny under would be below break-even → level with the lead if that is still a cut and not a loss, else no card
             (the same shape as Chilled's walk-away rule).
         The first sale — or NEW_DAYS without one — ends it: the size joins the normal answers. No raises on New.
         A SELF-POSTING lead on New: SELF_POST_UNDER under it (as can_match below), floor break-even, else no card (`breakeven`) —
         never a penny under or level with a self-poster.

ONE WAY OF PRICING (owner, 2026-11-21: "all apart from chilled are now dropped. We only use chilled"): the Fierce and Climb moods
         (decision 15) are gone — these are the Chilled rules, the only ones. amz_buybox_press.mood keeps its history; every new press is
         recorded 'chilled'. A `mood` sent by a client is ignored.
         Always: never under the £3 walk-away (New: break-even), never over RRP, ONE STEP THEN A SALE (raised_waiting).

THE MOVES (suggest):
  room       RAISE to the next rival above us minus 1p, capped at RAISE_CAP (+3%, PLAN.md decision 29) on our price and at the RRP;
             never down. AND, when a rival already sells BELOW us, capped at 2% over that cheapest rival (across the 2026-11-12 reading
             our share of views was 78% as the cheapest offer, 54% at 0–2% over, 46% at 2–5%, 12% at 5–8%, ~0 at 20%+). A size already
             2%+ over the cheaper rival gets no move → LEAVE (`cheaper_rival`), not Raise.
  can_match  a SELF-POSTING lead (OTHER_MFN): SELF_POST_UNDER (1%) under it, or LEAVE (`self_poster`) when that is under the
             walk-away — never a penny under or level with it (owner, 2026-11-21, PLAN.md decision 30: "go clearly under or leave").
             Why: 11–21 Nov, 170 cuts to within 0.5% of a self-posting lead won the box 35% of the time and the rival came down again
             by the next reading 98 times (pricing software following us); 27 cuts 0.5%+ under won 17 (63%) and were followed 3 times.
             This replaces the "2% over a self-poster" trial (14 moves, won 29%).
             Any other lead (FBA, Amazon): a penny under it, postage included (at our exact price Amazon gives the tie to the rival;
             a penny under an FBA lead won 75%). If a penny under is below the walk-away, level with the lead (a tie, said on the card).

THE ANSWERS (answerFor) — the reason is the old group, or why it waits:
  Not for this screen  sold nothing in 30 days, whatever the group. Reasons: `recent` (last
                       Amazon sale within 90 days — resting, mostly season) / `older` (90+ days or never). Stays on the Due list.
                       The pile itself is PARKED for a later talk (PLAN.md) — not "drop until it sells".
  Raise / Cut          `ready` = a card. WAITING (no card): `left` (Left on Go through — back when the suggestion differs from the one
                       left, to the penny, or after LEAVE_BACK_DAYS), `changed` (a price set since the reading — back once a reading has
                       SEEN the new price), `raised` (room: the last real move was a raise and no pair sold since — "otherwise we are
                       making a guess on top of a guess").
  Leave                every other selling size: top · alone · dearer · cant_match · no_bb · unknown · error · tie
                       · cheaper_rival · rrp (no room under the RRP) · not_eligible (Amazon won't feature us whatever the price — Seller
                       Central) · self_poster (1% under the self-posting lead would be under the walk-away).
  New                  ready / left / changed as above, or no card: `lead` (we're shown) · `dearer` · `breakeven` · `no_bb` ·
                       `not_eligible` · `unknown` (no cost).

SET / LEAVE (decisions 16–18): both move skumap.next_amz_price_review to GREATEST(existing, today + REVIEW_DAYS) — 4 weeks, a later date
  kept — so the Due list doesn't move it blind (Go through itself still never reads review dates). Both are recorded in amz_buybox_press
  (recordPress — kept PRESS_KEEP_MONTHS, purged by the write itself). Leave asks nothing. Two people at once: the last price wins.

ORDER — money at stake first: raise = pairs a week × the extra profit a pair; cut = pairs in 30 days × the views we're not shown to
  (then FBA stock); new = by style, then the style's size order (owner: test buys are
  smaller size sets and rivals don't stock every size).

PROFIT ON THE CARD: amzProfit is a straight line in price, so each card carries that line (profit = per_pound × price + at_zero) worked
  out HERE from two amzProfit calls — the screen prices a typed-in figure without a second copy of the formula.
=======================================================================================================================================
*/

const { amzProfit } = require('./amzProfit');
const { sizeTaxSql } = require('./vat');
const { readScreen } = require('./amzBuyBox');
const { placed } = require('./orderStatus');
const { SELL_SPEED_CTES } = require('./sellSpeed');

const MOOD = 'chilled';            // the only one left (header) — written on every press row
const TABS = ['new', 'raise', 'cut'];
const ANSWERS = ['new', 'raise', 'cut', 'leave', 'off'];
// 3% (was 5% — owner, 2026-11-21, PLAN.md decision 29): of the raises made 11–21 Nov from sizes holding the box, under +3% kept it
// 74% of the time, +3–6% only 41%.
const RAISE_CAP = 0.03;            // a raise is at most this much on our price per step
const OVER_CHEAPER_CAP = 0.02;     // ...and at most 2% over a rival already cheaper than us (header)
const SELF_POST_UNDER = 0.01;      // can_match / New: this far under a self-posting lead, never a penny (header, decision 30)
const NEW_DAYS = 30;               // New = landed within this many days, no Amazon sale yet
const LEAVE_BACK_DAYS = 7;         // a left card comes back after this many days (or as soon as its suggestion changes)
const REVIEW_DAYS = 28;            // a Set or a Leave moves the Amazon Due date 4 weeks out, keeping a later one
const PRESS_KEEP_MONTHS = 12;      // amz_buybox_press is kept this long
const RECENT_SALE_DAYS = 90;       // Not for this screen: sold on Amazon within this many days = `recent`
const PENNY = 0.01;

const floor2 = (n) => Math.floor(n * 100 + 1e-6) / 100;
const ceil2 = (n) => Math.ceil(n * 100 - 1e-6) / 100;
const r2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const isUs = (h) => h === 'US' || h === 'US_SHARED';
const isSelfPoster = (h) => h === 'OTHER_MFN';
/** Run query thunks one after another (see readDeck). */
async function inSequence(thunks) { const out = []; for (const t of thunks) out.push(await t()); return out; }

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

/** The suggested move for one stored row. Returns { price, note } or null when there is no move. */
function suggest(r) {
  if (r.our_price === null) return null;
  if (r.group === 'room') {
    if (r.next_up === null) return null;
    let p = floor2(Math.min(r.next_up - PENNY, r.our_price * (1 + RAISE_CAP)));
    const capPct = `${Math.round(RAISE_CAP * 100)}%`;
    let note = p <= r.next_up - PENNY - 0.005 ? `Capped at +${capPct} — the next rival is further up` : 'A penny under the next rival above us';
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
    if (isSelfPoster(r.holder)) {
      // CLEARLY UNDER A SELF-POSTER, OR LEAVE (header, decision 30) — a penny under gets followed down.
      const under = floor2(r.bb_price * (1 - SELF_POST_UNDER));
      if (under >= r.our_price - 0.005 || (r.walk !== null && under < ceil2(r.walk))) return null;
      return { price: under, note: `1% under the self-posting lead (${'£' + r.bb_price.toFixed(2)}) — a penny under gets followed down` };
    }
    const under = r2(r.bb_price - PENNY);
    if (r.walk !== null && under < ceil2(r.walk)) {
      return { price: r2(r.bb_price), note: 'Level with the lead — a penny under would be below the £3 walk-away (a tie usually goes to them)' };
    }
    return { price: under, note: 'A penny under the lead price, postage included' };
  }
  return null;
}

/**
 * NEW: the move for a new size (header) — a penny under a rival lead, floor break-even. Returns { price, note } or { reason } when
 * there is no card (lead · no_bb · dearer · breakeven · unknown).
 */
function suggestNew(r) {
  if (r.our_price === null) return { reason: 'unknown' };
  if (isUs(r.holder)) return { reason: 'lead' };
  if (r.holder === 'NONE' || r.bb_price === null) return { reason: 'no_bb' };
  if (r.bb_price > r.our_price + 0.005) {
    // A DEARER rival is shown over us (owner, 2026-11-13: "get the card"): UP to a penny under it — never over the RRP.
    let p = r2(r.bb_price - PENNY);
    let note = `New — up to a penny under the dearer lead (${'£' + r.bb_price.toFixed(2)}): Amazon shows them over us even at our lower price`;
    if (r.rrp !== null && r.rrp !== undefined && p > r.rrp) { p = floor2(r.rrp); note = `New — up to the RRP, under the dearer lead (${'£' + r.bb_price.toFixed(2)})`; }
    return p > r.our_price + 0.005 ? { price: p, note } : { reason: 'rrp' };
  }
  const be = r.breakeven;
  if (be === null || be === undefined) return { reason: 'unknown' };
  if (isSelfPoster(r.holder)) {
    // CLEARLY UNDER A SELF-POSTER (header, decision 30): 1% under, never a penny or level; floor break-even.
    const clear = floor2(r.bb_price * (1 - SELF_POST_UNDER));
    if (clear >= ceil2(be) && clear < r.our_price - 0.005) return { price: clear, note: `New — 1% under the self-posting lead (${'£' + r.bb_price.toFixed(2)}) to get the first sale; a penny under gets followed down` };
    return { reason: 'breakeven' };
  }
  const under = r2(r.bb_price - PENNY);
  if (under >= ceil2(be)) return { price: under, note: 'New — a penny under the lead to get the first sale' };
  // A penny under would be a loss: level with the lead if that is still a cut and not a loss (a tie usually goes to them).
  if (r.bb_price >= ceil2(be) && r.bb_price < r.our_price - 0.005) {
    return { price: r2(r.bb_price), note: 'New — level with the lead; a penny under would be below break-even (a tie usually goes to them)' };
  }
  return { reason: 'breakeven' };
}

/**
 * The answer for one in-stock, NOT-new size: { answer, reason, s } — s = the suggestion when the answer has a card (raise / cut),
 * before the waiting checks (readDeck turns `ready` into left / changed / raised).
 */
function answerFor(r) {
  const sold = r.sold30 > 0;
  if (r.group === 'error') return sold ? { answer: 'leave', reason: 'error' } : { answer: 'off', reason: null };
  if (!sold) return { answer: 'off', reason: null };   // recent / older, filled in by readDeck
  if (r.group === 'room') {
    const s = suggest(r);
    if (s) return { answer: 'raise', reason: 'ready', s };
    return { answer: 'leave', reason: cheaperRival(r) !== null ? 'cheaper_rival' : 'rrp' };
  }
  if (r.group === 'can_match') {
    if (r.our_eligible === false) return { answer: 'leave', reason: 'not_eligible' };
    const s = suggest(r);
    if (s) return { answer: 'cut', reason: 'ready', s };
    return { answer: 'leave', reason: isSelfPoster(r.holder) ? 'self_poster' : 'can_match' };
  }
  return { answer: 'leave', reason: r.group };
}

/**
 * SEARCH (owner, 2026-11-13: "how can I just look at Caprice and see the cards for it?"): any text — brand, style name, groupid or SKU
 * — narrows the deck to the sizes whose `code groupid title brand` contains it (case ignored; the same haystack as Sizes at Amazon's
 * search box). Applied to the in-stock sizes BEFORE they are answered, so the counts, the answers and the cards all agree with it.
 * Empty = everything. The rules for a size don't change — a filter only narrows which sizes are looked at.
 */
function matchesSearch(r, q) {
  if (!q) return true;
  return `${r.code} ${r.groupid || ''} ${r.title || ''} ${r.brand || ''}`.toLowerCase().includes(q);
}

/**
 * ONE STYLE, EXACTLY (owner, 2026-11-13: "choose a style [on New Additions] and … go through the cards"): the product menu's Amazon
 * Price card opens the search cards for the selected group id. matchesSearch is a contains-match, so a group id that sits inside a
 * longer one would pull that style in too — this is the whole group id, case ignored. Empty = everything.
 */
function matchesStyle(r, g) {
  if (!g) return true;
  return String(r.groupid || '').toLowerCase() === g;
}

/**
 * The deck. answersOnly = stop after the answers (step 3) — no cards built: what utils/amzDue.js needs to decide Amazon
 * "due" (PLAN.md decision 26), without the card queries. q = the search (matchesSearch), groupid = one style (matchesStyle) — screens
 * only; amzDue never passes them.
 */
/**
 * LAST CHANGED (THE copy — the Buy Box cards and the price cards, routes/amz-all-list ?cards=1): each size's last real price MOVE
 * (holds skipped), by whom, and net Amazon pairs sold since that day (sales carry a date only, so a sale earlier on the same day
 * counts — as Team week). changed_at is NULL on the 458 rows logged before it existed (Apr – Jul 2026): fall back to log_date, else
 * those NULLs would sort FIRST under DESC and pass for the latest change.
 * Returns { code: { at, by, old_price, new_price, sold_since } } — a size never changed is absent.
 */
async function lastChanges(db, codes) {
  if (!codes.length) return {};
  const { rows } = await db.query(
    `WITH last AS (
       SELECT DISTINCT ON (code) code, COALESCE(changed_at, log_date::timestamptz) AS changed_at, changed_by,
              old_price::float8 AS old_price, new_price::float8 AS new_price
       FROM amz_price_log WHERE code = ANY($1) AND abs(new_price - old_price) >= 0.005
       ORDER BY code, COALESCE(changed_at, log_date::timestamptz) DESC, id DESC)
     SELECT l.code, l.changed_at::text AS changed_at, l.changed_by, l.old_price, l.new_price,
            (SELECT COALESCE(SUM(s.qty), 0) FROM sales s WHERE s.channel = 'AMZ' AND s.code = l.code
               AND s.solddate >= (l.changed_at AT TIME ZONE 'Europe/London')::date)::int AS sold_since
     FROM last l`, [codes]);
  return Object.fromEntries(rows.map((x) => [x.code, {
    at: x.changed_at, by: x.changed_by, old_price: x.old_price, new_price: x.new_price, sold_since: x.sold_since }]));
}

async function readDeck(db, { answersOnly = false, q: qIn = '', groupid: gIn = '' } = {}) {
  const q = typeof qIn === 'string' ? qIn.trim().toLowerCase() : '';
  const g = typeof gIn === 'string' ? gIn.trim().toLowerCase() : '';
  const screen = await readScreen(db);
  // IN STOCK ONLY (decision 13), then the search / the style.
  const live = screen.rows.filter((r) => r.live > 0 && matchesSearch(r, q) && matchesStyle(r, g));
  const liveCodes = live.map((r) => r.code);

  // NEW + NOT-FOR-THIS-SCREEN facts, one query for every in-stock size: the landing date (first history day live, or a ledger day
  // with stock), any Amazon sale ever, and an Amazon sale within RECENT_SALE_DAYS.
  const facts = liveCodes.length ? (await db.query(
    `SELECT c.code,
            (CURRENT_DATE - (SELECT MIN(h.day) FROM amz_size_history h WHERE h.code = c.code
               AND (COALESCE(h.live, 0) > 0 OR (h.source = 'ledger' AND COALESCE(h.total, 0) > 0))))::int AS landed_ago,
            EXISTS (SELECT 1 FROM sales s WHERE s.channel = 'AMZ' AND s.code = c.code AND s.qty > 0) AS sold_ever,
            EXISTS (SELECT 1 FROM sales s WHERE s.channel = 'AMZ' AND s.code = c.code AND s.qty > 0
                      AND s.solddate >= CURRENT_DATE - $2::int) AS sold_recent
     FROM unnest($1::text[]) AS c(code)`, [liveCodes, RECENT_SALE_DAYS])).rows : [];
  const factOf = Object.fromEntries(facts.map((x) => [x.code, x]));

  // 1) every in-stock size's answer, before the waiting checks.
  const all = live.map((r) => {
    const f = factOf[r.code] || {};
    const isNew = f.landed_ago !== null && f.landed_ago !== undefined && f.landed_ago < NEW_DAYS && !f.sold_ever;
    if (isNew) {
      if (r.group === 'error') return { r, answer: 'new', reason: 'error', landed_ago: f.landed_ago };
      if (r.our_eligible === false) return { r, answer: 'new', reason: 'not_eligible', landed_ago: f.landed_ago };
      const m = suggestNew(r);
      return m.reason ? { r, answer: 'new', reason: m.reason, landed_ago: f.landed_ago } : { r, answer: 'new', reason: 'ready', s: m, landed_ago: f.landed_ago };
    }
    const a = answerFor(r);
    if (a.answer === 'off') a.reason = f.sold_recent ? 'recent' : 'older';
    return { r, ...a, landed_ago: f.landed_ago ?? null };
  });

  // 2) THE WAITING CHECKS for the would-be cards: the latest press (a Leave with the same suggestion, < LEAVE_BACK_DAYS), a price set
  //    since the reading, and (raise only) the last real move a raise with nothing sold since.
  const cand = all.filter((x) => x.reason === 'ready');
  const candCodes = cand.map((x) => x.r.code);
  // In sequence, not Promise.all: `db` may be ONE client, and pg refuses overlapping queries on a client (deprecated, gone in pg@9).
  const [pressRows, lastRows] = candCodes.length ? await inSequence([
    () => db.query(
      `SELECT DISTINCT ON (code) code, action, suggested::float8 AS suggested,
              (pressed_at > now() - make_interval(days => $2)) AS recent
       FROM amz_buybox_press WHERE code = ANY($1) ORDER BY code, pressed_at DESC, id DESC`, [candCodes, LEAVE_BACK_DAYS]),
    () => lastChanges(db, candCodes),   // LAST CHANGED (lastChanges, above)
  ]) : [{ rows: [] }, {}];
  const pressOf = Object.fromEntries(pressRows.rows.map((x) => [x.code, x]));
  const lastOf = lastRows;

  for (const x of cand) {
    const p = pressOf[x.r.code];
    const l = lastOf[x.r.code];
    if (p && p.action === 'leave' && p.recent && p.suggested !== null && Math.abs(p.suggested - x.s.price) < 0.005) x.reason = 'left';
    else if (x.r.set_since !== null) x.reason = 'changed';
    // ONE STEP, THEN A SALE (owner, 2026-11-12): BLACKSOLE-08 was raised £39.89 -> £41.88 in the morning and suggested £43.97 that
    // afternoon. A raise that lost the box leaves Room by itself (hourly). Cuts are not held (losing the box costs sales now).
    else if (x.answer === 'raise' && l && l.new_price > l.old_price + 0.005 && !(l.sold_since > 0)) x.reason = 'raised';
  }

  // 3) the summary: each answer's total and its reasons, and every in-stock size's answer (the Buy Box screen's bar filters on it).
  const answers = Object.fromEntries(ANSWERS.map((a) => [a, { total: 0, ready: 0, reasons: {} }]));
  const answerOf = {};
  for (const x of all) {
    const a = answers[x.answer];
    a.total += 1;
    if (x.reason === 'ready') a.ready += 1;
    a.reasons[x.reason] = (a.reasons[x.reason] || 0) + 1;
    answerOf[x.r.code] = [x.answer, x.reason];
  }
  if (answersOnly) return { q, answers, answer_of: answerOf, in_stock: live.length, last_all: screen.last_all };

  // 4) the cards — the ready ones, with what the card shows.
  const picked = all.filter((x) => x.reason === 'ready');
  const codes = picked.map((x) => x.r.code);
  const groupids = [...new Set(picked.map((x) => x.r.groupid).filter(Boolean))];
  const STRIP_DAYS = 30;
  const [imgs, econRows, stockRows, stripSales, stripMoves, lastSales, speedRows] = codes.length ? await inSequence([
    // The style's picture (the thumbnails' imagename).
    () => db.query(`SELECT groupid, imagename FROM skusummary WHERE groupid = ANY($1)`, [groupids]),
    // cost / fbafee / tax for the profit line — readScreen doesn't return them.
    () => db.query(
      `SELECT a.code, a.fbafee, sk.cost, ${sizeTaxSql('m', 'sk')} AS tax FROM amzfeed a JOIN skumap m ON m.code = a.code
       LEFT JOIN skusummary sk ON sk.groupid = m.groupid WHERE a.code = ANY($1)`, [codes]),
    // MORE COMING (owner, 2026-11-12): on order = supplier lines (2 local / 3 Amazon) PLACED and not arrived (utils/orderStatus.js →
    // placed); at home = sellable local stock (#FREE). Shown on the card only — neither changes the suggestion.
    () => db.query(
      `SELECT c.code,
              (SELECT COUNT(*) FROM orderstatus o WHERE o.shopifysku = c.code AND o.ordertype IN (2, 3)
                 AND ${placed('o')} AND COALESCE(o.arrived, 0) = 0)::int AS on_order,
              (SELECT COALESCE(SUM(l.qty), 0) FROM localstock l WHERE l.code = c.code AND l.ordernum = '#FREE'
                 AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0)::int AS at_home,
              (SELECT to_char(m.next_amz_price_review, 'YYYY-MM-DD') FROM skumap m WHERE m.code = c.code LIMIT 1) AS next_review
       FROM unnest($1::text[]) AS c(code)`, [codes]),
    // THE 30-DAY STRIP (owner, 2026-11-12: "want to be able to glance" — BLACKSOLE-05 sold 5 at £41.79 in 26–29 Oct, then nothing for
    // 14 days once a self-poster came in under it): net Amazon pairs per UK day, the real price moves in those days (holds skipped),
    // and days since the last pair sold (any time; null = never). Shown only — no rule reads it.
    () => db.query(`SELECT code, (CURRENT_DATE - solddate)::int AS ago, SUM(qty)::int AS n FROM sales
               WHERE channel = 'AMZ' AND code = ANY($1) AND solddate > CURRENT_DATE - $2::int GROUP BY 1, 2`, [codes, STRIP_DAYS]),
    () => db.query(`SELECT code, (CURRENT_DATE - (COALESCE(changed_at, log_date::timestamptz) AT TIME ZONE 'Europe/London')::date)::int AS ago,
                     changed_by, old_price::float8 AS old_price, new_price::float8 AS new_price
                FROM amz_price_log WHERE code = ANY($1) AND abs(new_price - old_price) >= 0.005
                 AND COALESCE(changed_at, log_date::timestamptz) >= CURRENT_DATE - ($2::int - 1)
               ORDER BY COALESCE(changed_at, log_date::timestamptz), id`, [codes, STRIP_DAYS]),
    () => db.query(`SELECT code, (CURRENT_DATE - MAX(solddate))::int AS ago FROM sales
               WHERE channel = 'AMZ' AND qty > 0 AND code = ANY($1) GROUP BY 1`, [codes]),
    // PRICED → SOLD (PLAN.md decision 22 — Fast sellers retired, its speed figure moved here): days from the price the last sale went
    // at going live to that sale, THE rule in utils/sellSpeed.js. A size that sold within a day of its last raise is the one to raise again.
    // Only the two CTEs it needs are read (PostgreSQL skips the unreferenced ones).
    () => db.query(`WITH ${SELL_SPEED_CTES}
               SELECT c.code, to_char(ss_sale.sold_on, 'YYYY-MM-DD') AS sold_on, ss_sale.sold_price::float8 AS sold_price,
                      (ss_sale.sold_on - ss_priced.priced_on)::int AS priced_to_sold
               FROM unnest($1::text[]) AS c(code)
               LEFT JOIN ss_sale ON ss_sale.code = c.code
               LEFT JOIN ss_priced ON ss_priced.code = c.code`, [codes]),
  ]) : Array(7).fill({ rows: [] });
  const imageOf = Object.fromEntries(imgs.rows.map((x) => [x.groupid, x.imagename || null]));
  const econOf = Object.fromEntries(econRows.rows.map((x) => [x.code, { cost: x.cost, fbafee: x.fbafee, tax: x.tax }]));
  const stockOf = Object.fromEntries(stockRows.rows.map((x) => [x.code, x]));
  const stripOf = {};
  for (const c of codes) stripOf[c] = { sold: Array(STRIP_DAYS).fill(0), moves: [], last_sold_ago: null };
  for (const x of stripSales.rows) if (x.ago >= 0 && x.ago < STRIP_DAYS) stripOf[x.code].sold[STRIP_DAYS - 1 - x.ago] = x.n;
  for (const x of stripMoves.rows) {
    if (x.ago >= 0 && x.ago < STRIP_DAYS) stripOf[x.code].moves.push({ day: STRIP_DAYS - 1 - x.ago, by: x.changed_by, old_price: x.old_price, new_price: x.new_price });
  }
  for (const x of lastSales.rows) stripOf[x.code].last_sold_ago = x.ago;
  const speedOf = Object.fromEntries(speedRows.rows.map((x) => [x.code, {
    priced_to_sold: x.priced_to_sold ?? null, sold_on: x.sold_on || null, sold_price: x.sold_price ?? null }]));

  const cards = picked.map(({ r, s, answer, landed_ago }) => {
    const econ = econOf[r.code] || {};
    const profitNow = amzProfit({ ...econ, price: r.our_price }).profit;
    const profitSuggest = amzProfit({ ...econ, price: s.price }).profit;
    const perWeek = r.sold30 * 7 / 30;
    let gain = null;
    let stake;
    if (answer === 'raise') {
      gain = profitNow !== null && profitSuggest !== null ? r2(perWeek * (profitSuggest - profitNow)) : null;
      stake = gain ?? 0;
    } else {
      stake = r.sold30 * (100 - (r.our_share ?? 0)) / 100;
    }
    return {
      deck: answer, group: r.group, code: r.code, groupid: r.groupid, title: r.title, brand: r.brand, asin: r.asin,
      imagename: imageOf[r.groupid] ?? null,
      read_at: r.read_at, live: r.live, total: r.total, sold30: r.sold30, weeks_left: r.weeks_left,
      landed_ago: answer === 'new' ? landed_ago : null,
      on_order: stockOf[r.code]?.on_order ?? 0, at_home: stockOf[r.code]?.at_home ?? 0,
      next_review: stockOf[r.code]?.next_review ?? null,
      last_change: lastOf[r.code] ?? null,
      strip: stripOf[r.code],
      speed: speedOf[r.code] ?? { priced_to_sold: null, sold_on: null, sold_price: null },
      our_price: r.our_price, rrp: r.rrp, walk: r.walk, breakeven: r.breakeven,
      // THE FLOOR the card warns at: break-even on New (before its first sale), the £3 walk-away everywhere else.
      floor: answer === 'new' ? r.breakeven : r.walk,
      holder: r.holder, bb_price: r.bb_price, lead_share: r.lead_share, our_share: r.our_share, next_up: r.next_up, rivals: r.rivals,
      rival_at_our_price: r.rival_at_our_price, amazon_retail: r.amazon_retail,
      offers: r.offers, featured: r.featured, sales_rank: r.sales_rank ?? null,
      suggest: s.price, suggest_note: s.note,
      profit_now: profitNow, profit_suggest: profitSuggest, profit_line: profitLine(econ),
      gain_week: gain, stake,
    };
  });
  // NEW: by style, then the style's size order (numeric size suffix). Raise / Cut: money at stake first, then stock.
  const sizeKey = (code) => { const s = code.split('-').pop(); return /^[0-9]+([.][0-9]+)?$/.test(s) ? Number(s) : Infinity; };
  cards.sort((a, b) => {
    if (a.deck !== b.deck) return TABS.indexOf(a.deck) - TABS.indexOf(b.deck);
    if (a.deck === 'new') return (a.groupid || '').localeCompare(b.groupid || '') || sizeKey(a.code) - sizeKey(b.code) || a.code.localeCompare(b.code);
    return b.stake - a.stake || b.sold30 - a.sold30 || b.total - a.total || a.code.localeCompare(b.code);
  });

  const counts = Object.fromEntries(TABS.map((t) => [t, cards.filter((c) => c.deck === t).length]));
  return {
    q, cards, counts, answers, answer_of: answerOf, in_stock: live.length,
    last_all: screen.last_all, running: screen.running,
  };
}

/**
 * Record one press on Go through (decision 17) and purge rows past PRESS_KEEP_MONTHS — inside the caller's transaction, behind a
 * SAVEPOINT: the record is for the agree rate, so a failure here never stops the price / review write it belongs to.
 * press = { code, by, tab, action: 'set' | 'leave' | 'undo', our_price, suggested, price } — recorded with mood 'chilled' (header).
 * Returns true when recorded.
 */
async function recordPress(client, press) {
  await client.query('SAVEPOINT amz_buybox_press');
  try {
    await client.query(
      `INSERT INTO amz_buybox_press (code, pressed_by, mood, tab, action, our_price, suggested, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [press.code, press.by || null, MOOD, press.tab, press.action,
        press.our_price ?? null, press.suggested ?? null, press.price ?? null]);
    await client.query(`DELETE FROM amz_buybox_press WHERE pressed_at < now() - make_interval(months => $1)`, [PRESS_KEEP_MONTHS]);
    await client.query('RELEASE SAVEPOINT amz_buybox_press');
    return true;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT amz_buybox_press');
    require('./logger').error(`amzBuyBoxDeck: press not recorded for ${press.code}: ${e.message}`);
    return false;
  }
}

/** Validate a press's Go through fields from a request body: { tab, our_price, suggested } or { error }. A `mood` is ignored (header). */
function pressFields(b) {
  if (!b || typeof b !== 'object') return { error: 'buybox fields missing' };
  if (!TABS.includes(b.tab)) return { error: 'tab must be new, raise or cut' };
  const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
  return { tab: b.tab, our_price: n(b.our_price), suggested: n(b.suggested) };
}

module.exports = {
  TABS, ANSWERS, RAISE_CAP, OVER_CHEAPER_CAP, SELF_POST_UNDER, NEW_DAYS, LEAVE_BACK_DAYS, REVIEW_DAYS,
  PRESS_KEEP_MONTHS, cheaperRival, suggest, suggestNew, answerFor, profitLine, matchesSearch, matchesStyle, readDeck, recordPress, pressFields, lastChanges,
};
