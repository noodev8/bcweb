/*
=======================================================================================================================================
API Route: amz_all_list
=======================================================================================================================================
Method: GET
Purpose: Amazon Pricing's home list — EVERY in-stock Amazon SKU, not one segment (owner, 2026-10-26: "shouldn't go off segments —
         just be a list of all, with a due and not due toggle"). Membership = an amzfeed listing with live FBA stock (amzlive > 0).
         One unsplit list: no Selling / Stuck bars.

         PLUS every SKU on a Repricing STATUS list, FBA stock or not (owner, 2026-10-28: "dashboard should cover everything" — Daily's
         Amazon due count is read from here and missed 0-stock SKUs Repricing called Due). So membership = amzlive > 0 OR its style
         carries a portfolio status with an Amazon lead channel — exactly amz-status-list's rows, same channelFilterSql. 0-stock last.

         PLUS every SKU with stock ON ITS WAY IN and none live (owner, 2026-10-29: "yes include them" — so it can be priced before it
         lands; 75 such sizes that day). Inbound = amztotal − amzlive, shown on screen as "0 +6" (fba_inbound).

         Same row shape as amz-status-list, so /amz/all?by=all renders it with the same table, drill, Due switch,
         bulk bar and upload basket. Apply is unchanged: amz_price_log + the Seller Central upload; amzfeed stays READ ONLY.

         Order: due first, then most FBA stock, then code. Not-due SKUs are dropped unless ?parked=include — the Due switch.

         DUE = THE ONE AMAZON RULE (utils/amzDue.js, PLAN.md decisions 21 + 26, 2026-11-13): a size the Buy Box answers in Chilled
         (selling at FBA, or New) is NEVER due — one with a card is a BUY BOX MOVE (decision 27, `bb_card`); every other size is
         due when its review date has come round. `parked` keeps
         its name on the wire (the page dims / hides on it) but now means NOT DUE by that rule. Each row says which half decides it
         (`due_by`), and a Buy Box row carries its answer.

         ?half=review (the Amazon Pricing home's "Not selling · due" tile, decision 23) = only the review half — the sizes the Buy
         Box doesn't answer — since decision 27 the same rows as the due list without it (Buy Box sizes are never due).
         DAILY reads this route twice in one: "Amazon due" = `total` of the due list, "Buy Box moves" = `buybox_moves` (the Chilled
         cards, utils/amzDue.js → buyBoxMoves) — sent on every response.

Requires auth.
=======================================================================================================================================
Request: GET /amz-all-list[?parked=include][&half=review][&limit=N][&q=text][&g=groupid][&cards=1]
  limit    safety cap only (utils/listLimit.js, default 100 / max 500).
  half     review = only the sizes the Buy Box doesn't answer (the review-date half).
  q        the search (owner, 2026-11-13 — "search for Caprice, see the count, press it and get the cards one by one"): only rows whose
           SKU, groupid, name or brand contain it; `total` counts the search. THE match: utils/amzBuyBoxDeck.js → matchesSearch. Used
           by the Amazon Pricing home's search card (with parked=include: due, Buy Box moves and not due) and its search cards.
  g        ONE STYLE, exactly (utils/amzBuyBoxDeck.js → matchesStyle): the product menu's Amazon Price card opens the search cards for
           the selected group id (owner, 2026-11-13, from New Additions). Works like q (incl. the Buy Box suggestion), without q's
           contains-match pulling in a longer group id.
  cards    1 = PRICE CARDS (components/AmzPriceCards — Due cards and search cards, owner 2026-11-13: "the usual price change screen but
           reduced to cards"): each row also carries what a card shows — imagename, u12 (Amazon pairs, 12 months), breakeven, walk
           (the £3 walk-away, amzPricingStandard SETTINGS.WALK_AWAY_PROFIT — the Buy Box cards' floor), profit_line (profit a pair =
           per_pound × price + at_zero, utils/amzBuyBoxDeck.js → profitLine, so a typed price is priced without a second copy of the
           formula), profit_now. One query for the returned rows. Display only — nothing here blocks a price.
           With q, a size that has a Buy Box card in ?mood= (default chilled) also carries that card's suggestion — bb_suggest,
           bb_suggest_note, bb_deck (new / raise / cut) — from utils/amzBuyBoxDeck.js → readDeck (the same rules as the Buy Box
           cards, never a second copy). Shown on the search card with a "Use it" button; never applied by itself.

Success Response:
{
  "return_code": "SUCCESS",
  "total": 233, "truncated": false, "out_of_stock": 20,     // rows listed for their status with no FBA stock
  "buybox_moves": 34,                                        // the Chilled cards — Daily's "Buy Box moves" box
  "done_today": { "due": 58, "buybox": 0 },                  // sizes worked today — Daily's ticks
  "rows": [ { "rank": 1, "code": "…-38", "amz_sku": "…", "groupid": "…", "size": "38", "title": "…", "brand": "…", "price": 42.5,
              "rrp": 60, "fba": 4, "fba_inbound": 0, "units": 3, "u7": 1, "last_sold": "2026-10-20", "next_review": null, "parked": false,
              "due_by": "review", "bb_answer": null, "bb_reason": null }, ... ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query, pool } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { parseListLimit } = require('../utils/listLimit');
const { STATUSES, channelFilterSql } = require('../utils/portfolioStatus');
const { readBuyBoxSide, dueBy, buyBoxMoves } = require('../utils/amzDue');
const { matchesSearch, matchesStyle, profitLine, readDeck } = require('../utils/amzBuyBoxDeck');
const { amzProfit, priceForProfit, breakevenPrice } = require('../utils/amzProfit');
const { SETTINGS } = require('../utils/amzPricingStandard');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';
    const reviewHalf = req.query.half === 'review';
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100).trim().toLowerCase() : '';
    const g = typeof req.query.g === 'string' ? req.query.g.slice(0, 100).trim().toLowerCase() : '';
    const withCards = req.query.cards === '1';
    const mood = typeof req.query.mood === 'string' ? req.query.mood : undefined;   // readDeck normalises (anything else = chilled)

    // Every member is read (no SQL limit, no Due filter) because "due" is decided below in JS by THE rule (utils/amzDue.js) — the
    // Buy Box half needs the stored reading's answers. ~700 rows; the safety cap is applied after.
    // $1 statuses. Units / last sold are Amazon's, as on the other Amazon lists.
    const result = await query(`
      WITH u AS (
        SELECT code,
               SUM(qty) AS u30,
               COALESCE(SUM(qty) FILTER (WHERE solddate >= CURRENT_DATE - 7), 0) AS u7
        FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30
        GROUP BY code
      ),
      ls AS (
        SELECT code, MAX(solddate) AS last_sold FROM sales
        WHERE channel='AMZ' AND qty>0
        GROUP BY code
      )
      SELECT a.code, a.groupid, a.sku AS amz_sku, SUBSTRING(a.code FROM '[^-]*$') AS size,   -- size = suffix after the last '-'
             t.shopifytitle AS title,
             NULLIF(TRIM(sk.brand), '') AS brand,
             ${safeNumeric('a.amzprice')} AS price,
             ${safeNumeric('sk.rrp')} AS rrp,
             COALESCE(a.amzlive,0) AS fba,
             GREATEST(COALESCE(a.amztotal,0) - COALESCE(a.amzlive,0), 0) AS fba_inbound,   -- on its way in (amz-drill's inbound)
             COALESCE(u.u30,0)     AS units,
             COALESCE(u.u7,0)      AS u7,
             to_char(ls.last_sold,'YYYY-MM-DD') AS last_sold,
             m.next_amz_price_review::text AS next_review,                -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(m.next_amz_price_review > CURRENT_DATE, false) AS review_parked,
             bb.our_share AS bb_share,                                    -- Buy Box: % of views showing US (amz_buybox_now, owner 2026-11-12)
             bb.bb_price  AS bb_lead,                                     -- the lead offer's price incl. postage (the one to match)
             bb.rivals    AS bb_rivals,                                   -- 0 = Alone (no Buy Box race)
             bb.holder    AS bb_holder,
             to_char(bb.read_at AT TIME ZONE 'Europe/London', 'DD Mon HH24:MI') AS bb_read_at,
             COALESCE(a.amztotal,0) = 0 AS oos                            -- nothing live or on its way
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN skumap m      ON m.code     = a.code
      LEFT JOIN u        ON u.code     = a.code
      LEFT JOIN ls       ON ls.code    = a.code
      LEFT JOIN title t  ON t.groupid  = a.groupid
      LEFT JOIN amz_buybox_now bb ON bb.code = a.code AND bb.error IS NULL   -- latest Buy Box reading, display only
      WHERE (COALESCE(a.amzlive,0) > 0 OR COALESCE(a.amztotal,0) > 0
             OR (sk.portfolio_status = ANY($1::text[]) AND ${channelFilterSql('sk', 'AMZ')}))
      ORDER BY COALESCE(a.amzlive,0) DESC, a.code
    `, [STATUSES]);

    // THE RULE (header): each row's half, and whether it is due.
    const side = await readBuyBoxSide(pool);
    const judged = result.rows.map((r) => ({ r, d: dueBy(side, r.code, r.review_parked !== true) }))
      .filter((x) => !reviewHalf || x.d.by === 'review')
      .filter((x) => includeParked || x.d.due)
      .filter((x) => matchesSearch(x.r, q) && matchesStyle(x.r, g));
    // Due before not-due, so the safety cap can only ever trim not-due rows: with the status rows the list passed 500 (2026-10-28)
    // and the 0-stock due SKUs, sorting last, were cut — Daily counted them, the list didn't show them. Stable: stock order kept.
    judged.sort((a, b) => Number(b.d.due) - Number(a.d.due));
    const total = judged.length;
    const outOfStock = judged.filter((x) => x.r.oos === true).length;

    const rows = judged.slice(0, limit).map(({ r, d }, i) => ({
      rank: i + 1,
      code: r.code,
      amz_sku: r.amz_sku,
      groupid: r.groupid,
      size: r.size,
      title: r.title || null,
      brand: r.brand || null,
      price: num(r.price),
      rrp: num(r.rrp),
      fba: Number(r.fba),
      fba_inbound: Number(r.fba_inbound),
      units: Number(r.units),
      u7: Number(r.u7),
      last_sold: r.last_sold || null,
      next_review: r.next_review || null,
      parked: !d.due,                       // NOT DUE by THE rule (header) — the name kept for the page
      due_by: d.by,                         // 'buybox' | 'review' — which half decides
      bb_answer: d.answer,                  // the Buy Box answer in Chilled (new / raise / cut / leave), Buy Box half only
      bb_reason: d.reason,
      bb_card: d.card,                      // a Buy Box move: a card in Chilled (never due, decision 27)
      bb_share: num(r.bb_share),
      bb_lead: num(r.bb_lead),
      bb_rivals: r.bb_rivals === null || r.bb_rivals === undefined ? null : Number(r.bb_rivals),
      bb_holder: r.bb_holder || null,
      bb_read_at: r.bb_read_at || null,
    }));

    // CARDS (header, ?cards=1): the card's economics and picture for the returned rows, in one query.
    if (withCards && rows.length) {
      const econ = (await query(
        `SELECT a.code, a.fbafee, sk.cost, sk.tax, sk.imagename,
                (SELECT COALESCE(SUM(s.qty), 0) FROM sales s WHERE s.channel = 'AMZ' AND s.code = a.code AND s.qty > 0
                   AND s.solddate >= CURRENT_DATE - 365)::int AS u12
         FROM amzfeed a JOIN skusummary sk ON sk.groupid = a.groupid
         WHERE a.code = ANY($1)`, [rows.map((r) => r.code)])).rows;
      const econOf = Object.fromEntries(econ.map((e) => [e.code, e]));
      for (const row of rows) {
        const e = econOf[row.code];
        if (!e) continue;
        const ec = { cost: e.cost, fbafee: e.fbafee, tax: e.tax };
        row.imagename = e.imagename || null;
        row.u12 = Number(e.u12) || 0;
        row.breakeven = breakevenPrice(ec);
        row.walk = priceForProfit(ec, SETTINGS.WALK_AWAY_PROFIT);
        row.profit_line = profitLine(ec);
        row.profit_now = row.price === null ? null : amzProfit({ ...ec, price: row.price }).profit;
      }
      // The Buy Box cards' suggestion for the search's sizes (header) — the deck read narrowed to the same search.
      if (q || g) {
        const deck = await readDeck(pool, { mood, q, groupid: g });
        const cardOf = Object.fromEntries(deck.cards.map((c) => [c.code, c]));
        for (const row of rows) {
          const c = cardOf[row.code];
          row.bb_suggest = c ? c.suggest : null;
          row.bb_suggest_note = c ? c.suggest_note : null;
          row.bb_deck = c ? c.deck : null;
        }
      }
    }

    // DONE TODAY (owner, 2026-11-13: "an indicator or tick to say done today") — Daily's ticks, sizes worked since UK midnight:
    //   buybox = sizes Set or Left on a card (amz_buybox_press; an Undo isn't work);
    //   due    = sizes priced or given a review date anywhere else (amz_price_log — a review-only set logs a hold row there too),
    //            the cards' own rows ("Buy Box …" notes) left out.
    const done = (await query(`
      SELECT (SELECT COUNT(DISTINCT code) FROM amz_buybox_press
                WHERE action IN ('set', 'leave')
                  AND (pressed_at AT TIME ZONE 'Europe/London')::date = (now() AT TIME ZONE 'Europe/London')::date)::int AS buybox,
             (SELECT COUNT(DISTINCT code) FROM amz_price_log
                WHERE (changed_at AT TIME ZONE 'Europe/London')::date = (now() AT TIME ZONE 'Europe/London')::date
                  AND COALESCE(notes, '') NOT LIKE 'Buy Box%')::int AS due`)).rows[0];

    return res.json({ return_code: 'SUCCESS', total, truncated: rows.length < total, out_of_stock: outOfStock,
      buybox_moves: buyBoxMoves(side), done_today: { due: done.due, buybox: done.buybox }, rows });
  } catch (err) {
    logger.error('[amz-all-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Amazon list' });
  }
});

module.exports = router;
