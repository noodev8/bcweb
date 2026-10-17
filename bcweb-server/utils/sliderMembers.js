/*
=======================================================================================================================================
Module: utils/sliderMembers.js   (Pricing Slider — members with their live numbers)
=======================================================================================================================================
Purpose: One read of slider members joined to everything the screen shows beside them — the product's CURRENT price on its channel, stock,
         units sold since it joined, its floor and where it is heading (utils/slider.js → floorFor / plan). Shared by GET /slider-groups
         (the counts and "reaches floor by" per group) and GET /slider-group (the member table), so a group's tile and its page always
         agree. Phase 2's step route reads the same rows before it moves anything.

WHAT "NOW" IS PER CHANNEL
  SHP  skusummary.shopifyprice (safeNumeric — a junk VARCHAR reads NULL).
  AMZ  the latest price logged after the last Update Amazon import if it went live or is still pending in the basket, else amzfeed.amzprice
       (utils/slider.js → AMZ_NOW_CTES says why the slider can't read amzprice alone).

STOCK PER CHANNEL — what that channel can actually sell: SHP = sellable local stock (localstock #FREE, CLAUDE.md — never
  skusummary.stockvariants); AMZ = amzfeed.amzlive, FBA stock sellable now (the Amazon pricing screens' `fba`).

SOLD = units sold on the member's OWN channel (SHP by style, AMZ by SKU), positive sales lines only (returns are not a signal for
  pricing — the drill reports' rule), from the moment it joined to the moment it left (no end while it is live). Shop-counter sales
  (CM3) don't count for a Shopify slider: the slider is testing the website price. Sold time = utils/slider.js → soldAtSql (a row with
  no time reads as the end of its day — so a live member mustn't be capped at now(), or today's untimed sale would be missed until
  tomorrow). SOLD SINCE = the same, from the slider's last action on it (last_move_at) — what decides a hold.

OFF TRACK = a LIVE member someone priced by hand since the slider last set it (utils/slider.js → offTrack): on Shopify the live price
  differs; on Amazon a newer amz_price_log row for the SKU (`hand_price` — an Apply, a review hold, or a Seller Central change the import
  logged) carries a different price. The next press settles it as 'repriced' (utils/slider.js → decide).

ACTION = utils/slider.js → decide(): what the next press does to it (or why it waits). POST /slider-step reads it through this same
  function inside its transaction (pass `client`), so the screen's "due" and the write can't disagree.

AMAZON MOVES (utils/slider.js → AMAZON MOVES): the member's last move is its last_log_id row in amz_price_log → amz_upload live | pending
  | expired. THE CLOCK (clock_at — what "due" and SOLD SINCE count from) is the upload for a live Amazon move (uploaded_at, or the import
  that showed the price when nobody pressed "I've uploaded"), else last_move_at. An EXPIRED move is undone here, before plan / decide
  see the member: last_price back to the price before it, one step fewer, due again — and it reads that way on screen too.

Read-only.
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');
const {
  AMZ_NOW_CTES, AMZ_PENDING_HOURS, LIVE_STATES, breakevenFor, floorFor, stepAmount, plan, offTrack, decide, soldAtSql, londonDate, round2,
} = require('./slider');

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);

/*
 * loadMembers({ groupIds, liveOnly, memberIds, client }) -> member objects (see shape below), ordered live first, then by item.
 *   groupIds   integer[] — which groups (required; pass every id for an overview)
 *   liveOnly   true = only members still in the slider (sliding / found / floor)
 *   memberIds  integer[] — only these members (the step reads one)
 *   client     a transaction client (utils/transaction.js) — the step reads inside its own transaction, after its row locks
 */
async function loadMembers({ groupIds, liveOnly = false, memberIds = null, client = null }) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) return [];
  const run = client ? (sql, params) => client.query(sql, params) : query;

  // NB: no backticks inside this SQL — it is a JS template literal.
  const result = await run(`
    WITH ${AMZ_NOW_CTES},
    local_free AS (
      SELECT groupid, SUM(qty) AS qty FROM localstock
      WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
      GROUP BY groupid
    )
    SELECT m.id, m.group_id, m.channel, m.item_key, m.groupid, m.rrp, m.start_from, m.start_price, m.last_price, m.last_log_id,
           m.last_move_at, m.steps, m.state, m.found_price, m.found_at, m.joined_by, m.joined_at, m.ended_by, m.ended_at,
           g.step_pct, g.every_days, g.floor_pct, g.floor_breakeven, g.stop_after_sales, g.state AS group_state,
           t.shopifytitle AS title,
           NULLIF(TRIM(ss.brand), '') AS brand,
           CASE WHEN m.channel = 'AMZ' THEN SUBSTRING(m.item_key FROM '[^-]*$') END AS size,
           a.sku AS amz_sku,
           CASE WHEN m.channel = 'SHP' THEN ${safeNumeric('ss.shopifyprice')}
                ELSE COALESCE(an.price, ${safeNumeric('a.amzprice')}) END AS now,
           ${safeNumeric('ss.cost')}  AS cost,
           ${safeNumeric('a.fbafee')} AS fbafee,
           ss.tax,
           CASE WHEN m.channel = 'SHP' THEN COALESCE(lf.qty, 0) ELSE COALESCE(a.amzlive, 0) END AS stock,
           COALESCE(sold.units, 0) AS sold,
           COALESCE(sold.units_since, 0) AS sold_since,
           sold.last_at AS sold_last_at,
           pl.old_price AS move_from,
           pl.uploaded_at AS move_uploaded_at,
           hand.new_price AS hand_price,
           up.state AS amz_upload,
           clk.at AS clock_at
    FROM slider_member m
    JOIN slider_group g       ON g.id = m.group_id
    CROSS JOIN amz_import ai
    LEFT JOIN skusummary ss   ON ss.groupid = m.groupid
    LEFT JOIN title t         ON t.groupid = m.groupid
    LEFT JOIN amzfeed a       ON m.channel = 'AMZ' AND a.code = m.item_key
    LEFT JOIN amz_now an      ON m.channel = 'AMZ' AND an.code = m.item_key
    LEFT JOIN local_free lf   ON lf.groupid = m.groupid
    -- An Amazon member's last move (a reset also sets last_log_id, but a reset member has left — nothing reads it).
    LEFT JOIN amz_price_log pl ON m.channel = 'AMZ' AND pl.id = m.last_log_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN pl.id IS NULL THEN NULL
                  WHEN pl.uploaded_at IS NOT NULL OR ROUND(pl.new_price, 2) = ROUND(${safeNumeric('a.amzprice')}, 2) THEN 'live'
                  WHEN pl.changed_at >= now() - make_interval(hours => ${AMZ_PENDING_HOURS}) THEN 'pending'
                  ELSE 'expired' END AS state
    ) up
    -- Amazon "priced by hand": the newest price logged for the SKU after the slider's own last row (or since it joined) by anyone else.
    LEFT JOIN LATERAL (
      SELECT l.new_price FROM amz_price_log l
      WHERE m.channel = 'AMZ' AND l.code = m.item_key AND l.id > COALESCE(m.last_log_id, 0) AND l.changed_at >= m.joined_at
      ORDER BY l.id DESC LIMIT 1
    ) hand ON true
    -- The clock: from the upload for a live Amazon move (or the import that showed it — never before the press), else last_move_at.
    -- GREATEST with last_move_at so a later sale hold still restarts it.
    CROSS JOIN LATERAL (
      SELECT CASE WHEN up.state = 'live'
                  THEN GREATEST(m.last_move_at, COALESCE(pl.uploaded_at, GREATEST(pl.changed_at, ai.at)))
                  ELSE m.last_move_at END AS at
    ) clk
    LEFT JOIN LATERAL (
      SELECT SUM(s.qty) AS units,
             -- strictly AFTER: a hold restarts the clock AT the sale's reading (slider-step), and that sale must not count again
             SUM(s.qty) FILTER (WHERE ${soldAtSql('s')} > COALESCE(clk.at, m.joined_at)) AS units_since,
             MAX(${soldAtSql('s')}) AS last_at
      FROM sales s
      WHERE s.qty > 0
        AND s.channel = m.channel
        AND (CASE WHEN m.channel = 'SHP' THEN s.groupid = m.groupid ELSE s.code = m.item_key END)
        AND s.solddate >= (m.joined_at AT TIME ZONE 'Europe/London')::date
        AND ${soldAtSql('s')} >= m.joined_at
        AND (m.ended_at IS NULL OR ${soldAtSql('s')} <= m.ended_at)
    ) sold ON true
    WHERE m.group_id = ANY($1::int[])
      AND ($2::boolean = false OR m.state = ANY($3::text[]))
      AND ($4::int[] IS NULL OR m.id = ANY($4::int[]))
    ORDER BY (m.state = ANY($3::text[])) DESC, m.item_key
  `, [groupIds, liveOnly, LIVE_STATES, Array.isArray(memberIds) ? memberIds : null]);

  const today = londonDate();
  return result.rows.map((r) => {
    const group = {
      state: r.group_state,
      step_pct: r.step_pct, every_days: r.every_days, floor_pct: r.floor_pct,
      floor_breakeven: r.floor_breakeven, stop_after_sales: r.stop_after_sales,
    };
    const live = LIVE_STATES.includes(r.state);
    const now = num(r.now);
    const rrp = Number(r.rrp);
    const breakeven = breakevenFor(r.channel, { cost: r.cost, fbafee: r.fbafee, tax: r.tax });
    const f = floorFor(group, { rrp, breakeven });
    const upload = live ? r.amz_upload : null;
    // An expired Amazon move never happened: read the member as it was before it — its price, one step fewer, and due again (the
    // move was due when it was pressed; plan() dates a member with no last_move_at from joined_at, so give it the press day).
    // Once a press has written that back (slider-step), last_price IS the from price and nothing more is undone — the only way it is
    // still sliding then is a sale hold, whose clock is the normal one.
    const undo = upload === 'expired' && r.move_from !== null && round2(Number(r.last_price)) !== round2(Number(r.move_from));
    const m = undo
      ? { ...r, last_price: r.move_from, steps: Math.max(0, Number(r.steps) - 1), last_move_at: null, joined_at: r.clock_at }
      : { ...r, last_move_at: r.clock_at };
    const p = plan(group, m, { floor: f.floor });
    const stock = Number(r.stock) || 0;
    const sold = Number(r.sold) || 0;
    const soldSince = Number(r.sold_since) || 0;
    const action = decide(group, m, { now, plan: p, sold, soldSince, stock, today, upload });
    return {
      id: r.id,
      group_id: r.group_id,
      channel: r.channel,
      key: r.item_key,                  // groupid (SHP) or code (AMZ)
      groupid: r.groupid,
      size: r.size,                     // AMZ only
      amz_sku: r.amz_sku || null,       // AMZ only
      title: r.title || null,
      brand: r.brand || null,
      rrp,
      start_from: r.start_from,
      start_price: Number(r.start_price),
      last_price: Number(m.last_price),     // the price the slider last set (an expired Amazon move undone)
      now,
      now_pct_rrp: now !== null && rrp > 0 ? Math.round((now / rrp) * 100) : null,
      cost: num(r.cost),
      breakeven,
      floor: f.floor,
      floor_by_breakeven: f.byBreakeven,
      step: stepAmount(group, rrp),
      steps: Number(m.steps),
      stock,
      sold,
      sold_since: soldSince,            // since the slider's last action on it — what decides a hold
      sold_last_at: iso(r.sold_last_at),
      state: r.state,
      live,
      off_track: live && offTrack(m, now),
      action,                           // utils/slider.js → decide(): what the next press does, or why it waits; null = nothing
      amz_upload: upload,               // AMZ: live | pending | expired for its last move; null = Shopify / no move yet / left
      amz_undo: undo,                   // AMZ: an expired move the next acting press will write back (slider-step)
      move_from: num(r.move_from),      // AMZ: the price before its last move (what an expired move is undone to)
      move_uploaded_at: iso(r.move_uploaded_at),
      next_due: p.nextDue,
      next_price: p.nextPrice,
      lift: p.lift,
      moves_left: p.movesLeft,
      floor_by: p.floorBy,
      found_price: num(r.found_price),
      found_at: iso(r.found_at),
      last_move_at: iso(r.last_move_at),
      clock_at: iso(r.clock_at),        // what "due" counts from — on Amazon, the upload
      joined_by: r.joined_by || null,
      joined_at: iso(r.joined_at),
      ended_by: r.ended_by || null,
      ended_at: iso(r.ended_at),
    };
  });
}

module.exports = { loadMembers };
