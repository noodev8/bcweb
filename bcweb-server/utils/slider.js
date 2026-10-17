/*
=======================================================================================================================================
Module: utils/slider.js   (Pricing Slider — the rules, in one place)
=======================================================================================================================================
Purpose: Everything the Pricing Slider decides, so the screen's reads and the writes can never disagree (the Amazon import's "preview and
         commit share one plan" lesson). Owner, 2026-10-17: group products, step their price down by a % of RRP every N days, and HOLD
         each one at the first price that sells — "drop the price until we find our selling point", without dropping straight to the
         bottom (which found some diamonds but sold others at a loss) and without still searching when the season is over.

THE MODEL (migrations/20261017_slider.sql)
  A GROUP is one channel + its rules. Shopify works per STYLE (groupid), Amazon per SKU (code) — the grains differ, so one group is one
  channel. A MEMBER is one product's time in one group. LIVE states (still "in a slider", badged on the pricing screens):
      sliding   stepping down
      found     sold — held at that price (the diamond). Reprice by hand or move it to another slider.
      floor     reached the floor — held there; a sale later still makes it found
  ENDED states (the row stays as history): repriced (price changed outside the slider), moved (into another group), removed, reset
  (back to RRP), ended (the group was ended).

THE RULES, AS THE OWNER SET THEM (2026-10-17)
  - NO CRON. Every move is a button press on the Slider screen, like normal pricing (phase 2). Amazon moves go into the existing team
    upload basket and only count once uploaded.
  - A step is step_pct % of the RRP the product joined with — a fixed £ amount, so the date it reaches the floor is predictable.
    Compounding on the current price was rejected: it slows down as the price falls, the wrong way round for this job.
  - The floor is floor_pct % of that RRP, and — only if the group ticks it — never below break-even. The floor is the human's choice
    ("don't restrict too much … they might just want to clear some rubbish too"); break-even is the protection on offer, not forced.
  - Found after stop_after_sales (1, 2 or 3) sales since joining. Between the first and the Nth, a sale HOLDS the price for another full
    interval rather than cutting something that has just sold.
  - The FIRST move is due straight away on joining. With start_from = 'rrp' that first move is the lift to RRP, which then sits a full
    interval before the first cut (otherwise it would go up and straight back down in one press).
  - Days, not hours: pressed at 9am Monday, a 2-day group is due again on Wednesday whatever the time, so a press a few minutes "early"
    never misses a step. Days are Europe/London.
  - No price-ending snapping (plain 2dp). No Shopify-vs-Amazon checks. Review dates are not touched — the badge is the indicator.
  - OUT OF STOCK WAITS (owner, phase 2): a product with no stock on its channel isn't moved — it can't sell, so a cut only gives margin
    away. Its clock isn't touched either, so it is due the moment stock arrives.
  - NO CATCH-UP (owner, phase 2): a press after a week of nobody pressing makes ONE move, and the next is due every_days after THAT press.
  - The clock (last_move_at) restarts on every press that acts on a sliding product: a move, or a sale hold.

WHAT A PRESS DOES — decide(), the ONE decision the group page shows and POST /slider-step carries out (the step re-reads inside its
transaction, so a stale screen can't make it do something else):
    repriced   the price isn't what the slider last set — someone priced it by hand; it leaves the slider, price untouched
    found      sold stop_after_sales since joining — holds at its price (also from the floor). Doesn't wait for the due date.
    hold       due, and sold since the last move but fewer than stop_after_sales — holds another interval
    floor      due, but already at (or, after a rules edit, below) the floor — holds there, price untouched
    lift       due, start_from='rrp' and not yet lifted — up (or down) to RRP
    step       due — one step down, never below the floor; a step that lands on the floor makes it 'floor'
  and two that WAIT (shown, not acted on): no_stock, no_price (the current price can't be read). Paused group = nothing.
=======================================================================================================================================
*/

const { priceForProfit } = require('./shopifyProfit');
const { breakevenPrice } = require('./amzProfit');

const CHANNELS = ['SHP', 'AMZ'];
// Still "in a slider" — must match the partial unique index slider_member_live_uq in the migration. Queries take it as a bound $n array.
const LIVE_STATES = ['sliding', 'found', 'floor'];

// Same as routes/amz-basket.js WINDOW_HOURS: a pending (not uploaded) Amazon change older than this has dropped out of the upload basket,
// so it never went live and must not be read as the SKU's current price.
const AMZ_PENDING_HOURS = 72;

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ---- Rules: validation ----------------------------------------------------------------------------------------------------------

/*
 * validateRules(body, { creating }) -> { error, message } | { rules }
 * The group form. `channel` is only read when creating — a group's channel never changes (its members are the wrong grain for the other).
 * The ranges match the CHECK constraints in the migration; this gives a readable message before the database would refuse.
 */
function validateRules(body, { creating }) {
  const b = body || {};
  const bad = (message) => ({ error: 'INVALID_RULES', message });

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return bad('Give the slider a name');
  if (name.length > 80) return bad('Name is too long (80 characters at most)');

  let channel = null;
  if (creating) {
    channel = typeof b.channel === 'string' ? b.channel.toUpperCase() : '';
    if (!CHANNELS.includes(channel)) return bad('Channel must be Shopify or Amazon');
  }

  const stepPct = Number(b.stepPct);
  if (!Number.isFinite(stepPct) || stepPct < 0.1 || stepPct > 50) return bad('Step must be between 0.1% and 50% of RRP');
  const everyDays = Number(b.everyDays);
  if (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > 60) return bad('Every must be a whole number of days, 1 to 60');
  const floorPct = Number(b.floorPct);
  if (!Number.isFinite(floorPct) || floorPct < 1 || floorPct >= 100) return bad('Floor must be between 1% and 99% of RRP');
  const stopAfterSales = Number(b.stopAfterSales);
  if (![1, 2, 3].includes(stopAfterSales)) return bad('Stop after must be 1, 2 or 3 sales');

  let dueDate = null;
  if (b.dueDate !== undefined && b.dueDate !== null && String(b.dueDate).trim() !== '') {
    const d = String(b.dueDate).trim();
    // A real calendar date, not just the shape — '2026-02-30' must not slip through to a DATE cast.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) return bad('Due date is not a valid date');
    dueDate = d;
  }

  const notes = b.notes === undefined || b.notes === null ? null : String(b.notes).trim().slice(0, 500) || null;

  return {
    rules: {
      name, channel,
      stepPct: round2(stepPct), everyDays, floorPct: round2(floorPct),
      floorBreakeven: b.floorBreakeven === true, stopAfterSales, dueDate, notes,
    },
  };
}

// ---- Prices ---------------------------------------------------------------------------------------------------------------------

/*
 * breakevenFor(channel, { cost, fbafee, tax }) -> number | null
 * The price at which a unit keeps £0 on that channel, from the same profit formula the sales rows are booked with (utils/shopifyProfit.js
 * / utils/amzProfit.js). null when the cost is unknown — then the break-even box simply can't apply to that product.
 */
function breakevenFor(channel, { cost, fbafee, tax }) {
  const c = num(cost);
  if (c === null || c <= 0) return null;
  return channel === 'AMZ' ? breakevenPrice({ cost: c, fbafee, tax }) : priceForProfit(0, c);
}

/*
 * floorFor(group, { rrp, breakeven }) -> { floor, pctFloor, breakeven, byBreakeven }
 * The lowest price the slider may set: floor_pct % of the member's RRP, raised to break-even only when the group ticks the box and the
 * break-even is known. byBreakeven says which one won, so the screen can show why the floor is where it is.
 */
function floorFor(group, { rrp, breakeven }) {
  const pctFloor = round2((Number(rrp) * Number(group.floor_pct)) / 100);
  const be = group.floor_breakeven && breakeven !== null && breakeven !== undefined ? Number(breakeven) : null;
  const byBreakeven = be !== null && be > pctFloor;
  return { floor: byBreakeven ? be : pctFloor, pctFloor, breakeven: breakeven ?? null, byBreakeven };
}

// One step in £: step_pct % of the RRP the member joined with.
function stepAmount(group, rrp) {
  return round2((Number(rrp) * Number(group.step_pct)) / 100);
}

// ---- Dates (Europe/London days) --------------------------------------------------------------------------------------------------

// 'YYYY-MM-DD' of an instant in London. en-CA formats as ISO.
function londonDate(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(at instanceof Date ? at : new Date(at));
}

// Calendar arithmetic on a 'YYYY-MM-DD' string, done in UTC so no clock change can move the day.
function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/*
 * plan(group, member, { floor }) -> { nextDue, nextPrice, lift, movesLeft, floorBy }
 * Where a sliding member is heading — what the screen shows and what decide() / the step act on.
 *   nextDue   'YYYY-MM-DD' the next move is due (the first is due on the day it joined — straight away); null once it isn't sliding
 *   nextPrice what that move would set: RRP for a start_from='rrp' first move, else one step down, never below the floor
 *   lift      true when that move is the start_from='rrp' lift
 *   movesLeft moves until it sits at the floor (0 = already there)
 *   floorBy   'YYYY-MM-DD' it reaches the floor if every move is pressed on the day it's due and nothing sells; null if already there
 * Works from the slider's own last price, which is what the step moves from. Pressing late pushes every later date back (no catch-up).
 */
function plan(group, m, { floor }) {
  if (m.state !== 'sliding') return { nextDue: null, nextPrice: null, lift: false, movesLeft: 0, floorBy: null };

  const rrp = Number(m.rrp);
  const step = stepAmount(group, rrp);
  const at = Number(m.last_price);
  const liftFirst = m.start_from === 'rrp' && Number(m.steps) === 0 && at !== rrp;

  // Due on the day it joined until the slider first acts on it; after that, every_days after its last action (a move or a sale hold —
  // a hold doesn't count as a step, so this is keyed on last_move_at, not steps).
  const nextDue = !m.last_move_at
    ? londonDate(m.joined_at)
    : addDays(londonDate(m.last_move_at), Number(group.every_days));

  const from = liftFirst ? rrp : at;
  const cuts = from > floor && step > 0 ? Math.ceil(round2(from - floor) / step - 1e-9) : 0;
  const movesLeft = (liftFirst ? 1 : 0) + cuts;
  const nextPrice = liftFirst ? rrp : movesLeft > 0 ? Math.max(round2(at - step), floor) : null;
  const floorBy = movesLeft > 0 ? addDays(nextDue, (movesLeft - 1) * Number(group.every_days)) : null;

  return { nextDue, nextPrice, lift: liftFirst, movesLeft, floorBy };
}

// What a press acts on, and what only waits. See WHAT A PRESS DOES in the header.
const DUE_ACTIONS = ['repriced', 'found', 'hold', 'floor', 'lift', 'step'];
const WAITS = ['no_stock', 'no_price'];

/*
 * decide(group, member, { now, plan, sold, soldSince, stock, today }) -> one of DUE_ACTIONS, one of WAITS, or null (nothing to do)
 *   group      needs state + stop_after_sales
 *   member     needs state + last_price
 *   now        the current price on the channel (null = unreadable)
 *   plan       plan()'s result for this member
 *   sold       units sold on its channel since it joined; soldSince = since the slider's last action on it (or since joining)
 *   stock      what its channel can sell now
 *   today      'YYYY-MM-DD', London
 * The order is the rule: a hand-set price wins over everything (the human has taken over), then a sale, then the clock.
 */
function decide(group, m, { now, plan: p, sold, soldSince, stock, today }) {
  if (group.state !== 'active' || !LIVE_STATES.includes(m.state)) return null;
  if (now !== null && round2(now) !== round2(Number(m.last_price))) return 'repriced';
  if (sold >= Number(group.stop_after_sales)) return m.state === 'found' ? null : 'found';
  if (m.state !== 'sliding' || !p.nextDue || p.nextDue > today) return null;
  if (soldSince > 0) return 'hold';
  if (p.movesLeft === 0) return 'floor';
  if (now === null) return 'no_price';
  if (stock <= 0) return 'no_stock';
  return p.lift ? 'lift' : 'step';
}

// ---- SQL fragments ----------------------------------------------------------------------------------------------------------------

/*
 * soldAtSql(alias) -> SQL expression: the moment a `sales` row was sold, as a timestamptz.
 * sales.solddate is a DATE and sales.ordertime a London 'HH:MM' VARCHAR (~6% of rows carry no usable time). A row with no usable time is
 * read as the END of its day — the agreed rule: a sale on the day of a move counts as a sale after it, so the slider stops rather than
 * cutting something that may have sold at that price. The regex guards the ::time cast (a '25:00' would throw). The group is
 * NON-capturing on purpose: SUBSTRING(… FROM pattern) returns the first CAPTURED group when there is one, so '([01]?[0-9]|…)' gave '16'
 * for '16:42' and the ::time cast threw.
 */
function soldAtSql(alias) {
  return `((${alias}.solddate + CASE WHEN ${alias}.ordertime ~ '^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]'
                                     THEN SUBSTRING(${alias}.ordertime FROM '^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]')::time
                                     ELSE time '23:59:59' END) AT TIME ZONE 'Europe/London')`;
}

/*
 * AMZ_NOW_CTES — two CTEs giving each Amazon SKU's CURRENT price (join amz_now ON code; COALESCE(amz_now.price, amzprice)).
 * amzfeed.amzprice is Amazon's price as of the last Update Amazon import, so a price logged AFTER that import is newer — if it has been
 * uploaded, or is still pending in the basket. A pending change that aged out of the basket (AMZ_PENDING_HOURS) never went live and is
 * ignored. The other Amazon screens read amzprice alone; the slider can't, because it records a start price and must not record a stale
 * one minutes after an Apply. Prefix the query's WITH list with this (it ends without a trailing comma).
 */
const AMZ_NOW_CTES = `
  amz_import AS (
    SELECT COALESCE(MAX(created_at), '-infinity'::timestamptz) AS at FROM bclog WHERE section = 'Amazon Update'
  ),
  amz_now AS (
    SELECT DISTINCT ON (l.code) l.code, l.new_price AS price
    FROM amz_price_log l CROSS JOIN amz_import i
    WHERE l.changed_at > i.at
      AND (l.uploaded_at IS NOT NULL OR l.changed_at >= now() - make_interval(hours => ${AMZ_PENDING_HOURS}))
    ORDER BY l.code, l.id DESC
  )`;

module.exports = {
  CHANNELS, LIVE_STATES, DUE_ACTIONS, WAITS, AMZ_NOW_CTES,
  validateRules, breakevenFor, floorFor, stepAmount, plan, decide, soldAtSql, londonDate, addDays, round2,
};
