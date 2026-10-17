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

OFF TRACK = a LIVE member whose current price is not the price the slider last set — someone priced it by hand on another screen (or, on
  Amazon, the import has caught up with a price not set here). The next press settles it as 'repriced' (utils/slider.js → decide).

ACTION = utils/slider.js → decide(): what the next press does to it (or why it waits). POST /slider-step reads it through this same
  function inside its transaction (pass `client`), so the screen's "due" and the write can't disagree.

Read-only.
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');
const {
  AMZ_NOW_CTES, LIVE_STATES, breakevenFor, floorFor, stepAmount, plan, decide, soldAtSql, londonDate, round2,
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
           sold.last_at AS sold_last_at
    FROM slider_member m
    JOIN slider_group g       ON g.id = m.group_id
    LEFT JOIN skusummary ss   ON ss.groupid = m.groupid
    LEFT JOIN title t         ON t.groupid = m.groupid
    LEFT JOIN amzfeed a       ON m.channel = 'AMZ' AND a.code = m.item_key
    LEFT JOIN amz_now an      ON m.channel = 'AMZ' AND an.code = m.item_key
    LEFT JOIN local_free lf   ON lf.groupid = m.groupid
    LEFT JOIN LATERAL (
      SELECT SUM(s.qty) AS units,
             -- strictly AFTER: a hold restarts the clock AT the sale's reading (slider-step), and that sale must not count again
             SUM(s.qty) FILTER (WHERE ${soldAtSql('s')} > COALESCE(m.last_move_at, m.joined_at)) AS units_since,
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
    const p = plan(group, r, { floor: f.floor });
    const stock = Number(r.stock) || 0;
    const sold = Number(r.sold) || 0;
    const soldSince = Number(r.sold_since) || 0;
    const action = decide(group, r, { now, plan: p, sold, soldSince, stock, today });
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
      last_price: Number(r.last_price),
      now,
      now_pct_rrp: now !== null && rrp > 0 ? Math.round((now / rrp) * 100) : null,
      cost: num(r.cost),
      breakeven,
      floor: f.floor,
      floor_by_breakeven: f.byBreakeven,
      step: stepAmount(group, rrp),
      steps: Number(r.steps),
      stock,
      sold,
      sold_since: soldSince,            // since the slider's last action on it — what decides a hold
      sold_last_at: iso(r.sold_last_at),
      state: r.state,
      live,
      off_track: live && now !== null && round2(now) !== round2(Number(r.last_price)),
      action,                           // utils/slider.js → decide(): what the next press does, or why it waits; null = nothing
      next_due: p.nextDue,
      next_price: p.nextPrice,
      lift: p.lift,
      moves_left: p.movesLeft,
      floor_by: p.floorBy,
      found_price: num(r.found_price),
      found_at: iso(r.found_at),
      last_move_at: iso(r.last_move_at),
      joined_by: r.joined_by || null,
      joined_at: iso(r.joined_at),
      ended_by: r.ended_by || null,
      ended_at: iso(r.ended_at),
    };
  });
}

module.exports = { loadMembers };
