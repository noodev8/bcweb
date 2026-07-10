/*
=======================================================================================================================================
Module: utils/amzSuggest.js
=======================================================================================================================================
Purpose: The Amazon per-SKU "suggested move" engine — a code port of the 🟢/🟡/⚪ classifier in
         C:\scripts\amz-price\AMZ_FULL_REVIEW.md (Step 2). Given one SKU's signals (current price, FBA stock, recent sales, returns,
         last change) it returns { tier, action, target, why } so the screen can offer a one-click CREEP / DROP / REVERT the operator
         accepts or overrides. It never applies anything — it is advice only; the write path (POST /amz-apply) is the only thing that
         changes a price. Read `AMZ_FULL_REVIEW.md` for the thresholds' rationale; this file must stay faithful to that doc.

Segment parameters (floor / ceiling / step-band):
  These live in the markdown registry (C:\scripts\amz-price\AMZ_PRODUCTS.md) today, which the server can't read. Per the spec's §6
  fallback (docs/amz-pricing-spec.md), we compute what the DB gives us — hard-floor = cost + FBA fee, ceiling = RRP — and layer a
  small REGISTRY override for the few segments where a *discovered* working-floor / ceiling / step-band exists (currently only IVES).
  When an `amz_segment_params` table is added, replace REGISTRY with a lookup and keep this classifier unchanged.

  hard_floor    = cost + fbafee (breakeven; the write path blocks below this)   — economic, per-row (varies within UKD-SEG etc.)
  working_floor = lowest price we actually use (tidy convention / proven clear) — defaults to hard_floor when none discovered
  ceiling       = discovered resistance a creep shouldn't cross without prior sales above it — defaults to RRP when none discovered
  step_band     = the price range where creeps use the small (£0.30) step
=======================================================================================================================================
*/

// Discovered per-segment numbers from AMZ_PRODUCTS.md. Only segments with a *proven* floor/ceiling/step belong here; everything else
// falls back to computed hard-floor + RRP (which is correct — most segments have "no tested ceiling yet").
const REGISTRY = {
  'IVES-WHITE':  { working_floor: 35.99, ceiling: 40.00, step_low: 38.50, step_high: 39.00 },
  'IVES-COLOUR': { working_floor: 35.99, ceiling: 40.00, step_low: 38.50, step_high: 39.00 },
};

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function gbp(n) {
  return `£${round2(n).toFixed(2)}`;
}

// Build this row's effective parameters from its own economics + any registry override. cost/fbafee/rrp are per-row (already numeric
// or null) so a segment with per-style economics (e.g. UKD-SEG) gets the right floor for each style, not a segment average.
function paramsFor(segment, cost, fbafee, rrp) {
  const hard_floor = cost != null && fbafee != null ? round2(cost + fbafee) : null;
  const reg = REGISTRY[segment] || {};
  return {
    hard_floor,
    working_floor: reg.working_floor != null ? reg.working_floor : hard_floor,
    ceiling: reg.ceiling != null ? reg.ceiling : (rrp != null ? rrp : null),
    step_low: reg.step_low != null ? reg.step_low : null,
    step_high: reg.step_high != null ? reg.step_high : null,
    rrp: rrp != null ? rrp : null,
  };
}

/*
Classify one SKU. `r` must already have numeric fields coerced (Number or null), matching utils/amzSkuState.js output:
  current_price, cost, rrp, fbafee, fba_live, fba_inbound, sold_7d, sold_14d, returns_14d,
  days_since_sale (null = never sold), days_since_change (null = never changed), last_direction, sold_since_change, pre_change_price.

Returns { tier: 'green'|'amber'|'white', action: 'creep'|'drop'|'revert'|'hold', target: number|null, why: string, return_rate: number, params }.
  green  = 🟢 ROUTINE   — a rule-based move to accept in one click.
  amber  = 🟡 JUDGMENT  — a move is suggested but flagged (crosses a floor/ceiling, returns crisis, contradictory) — look before applying.
  white  = ⚪ HOLD       — nothing to do; greyed at the bottom of the list.
*/
function classify(r) {
  const p = paramsFor(r.segment, r.cost, r.fbafee, r.rrp);
  const price = r.current_price;
  const live = r.fba_live || 0;
  const inbound = r.fba_inbound || 0;
  const dsc = r.days_since_change;            // null = never changed
  const everSold = r.days_since_sale != null;
  const dss = everSold ? r.days_since_sale : 9999;  // never-sold-with-stock counts as long-dead for the DROP gate
  const rr = r.sold_14d > 0 ? r.returns_14d / r.sold_14d : 0;

  const hold = (why) => ({ tier: 'white', action: 'hold', target: null, why, return_rate: rr, params: p });
  const green = (action, target, why) => ({ tier: 'green', action, target: round2(target), why, return_rate: rr, params: p });
  const amber = (action, target, why) => ({ tier: 'amber', action, target: target != null ? round2(target) : null, why, return_rate: rr, params: p });

  // --- Unconditional holds -----------------------------------------------------------------------------------------------------
  if (price == null) return hold('no live price');
  if (live === 0 && inbound === 0) return hold('OOS');

  // --- REVERT (🟢) — undo a failed creep. Evaluated BEFORE the "just changed" hold so a 2-day-dead creep can be pulled back. -----
  if (r.last_direction === 'creep' && r.sold_since_change === 0 && dsc != null && dsc >= 2 && r.pre_change_price != null) {
    return green('revert', r.pre_change_price, `failed creep — revert to ${gbp(r.pre_change_price)}`);
  }

  // A just-applied change hasn't had time to read out — Amazon settles in ~3 days.
  if (dsc != null && dsc < 3) return hold('just changed');

  // Returns crisis is a judgment call (price or sizing?), never an auto-move.
  if (rr >= 0.40 && r.sold_14d > 0) return amber(null, null, `returns ${Math.round(rr * 100)}% (14d) — price or sizing?`);

  // --- Rule-based candidacy ----------------------------------------------------------------------------------------------------
  const creep = r.sold_7d >= 3 && rr < 0.20 && live >= 3;
  const drop = dss >= 8 && live >= 3;

  if (creep && drop) return amber(null, null, 'contradictory: selling yet stale');

  if (creep) {
    const inBand = p.step_low != null && price >= p.step_low && price <= p.step_high;
    const step = inBand || r.last_direction === 'creep' ? 0.30 : 0.50;
    const target = round2(price + step);
    // Ceiling guard: we don't have "prior sales at/above the ceiling" cheaply here, so any cross is a judgment call (per spec §5).
    if (p.ceiling != null && target > p.ceiling) {
      return amber('creep', target, `creep would cross ceiling ${gbp(p.ceiling)}`);
    }
    return green('creep', target, `creep ${step.toFixed(2)} — ${r.sold_7d}u/7d`);
  }

  if (drop) {
    const aggressive = dss >= 14;
    const step = aggressive ? 1.00 : 0.50;
    const target = round2(price - step);
    const deadLabel = everSold ? `${dss}d dead` : 'never sold';
    // Can't go below breakeven — flag as at-floor rather than suggesting an uneconomic cut.
    if (p.hard_floor != null && target < p.hard_floor) return amber('drop', p.hard_floor, `at economic floor ${gbp(p.hard_floor)} — ${deadLabel}`);
    // Below the tidy working-floor is allowed (clear dead piles) but is a judgment call.
    if (p.working_floor != null && target < p.working_floor) return amber('drop', target, `cut below floor ${gbp(p.working_floor)} — ${deadLabel}`);
    return green('drop', target, `${deadLabel} — cut ${step.toFixed(2)}`);
  }

  // --- Holds (reason codes mirror AMZ_FULL_REVIEW ⚪) ---------------------------------------------------------------------------
  if (live <= 2) return hold(inbound > 0 ? 'stock thin (inbound)' : 'stock thin');
  if (r.sold_7d >= 1) return hold('steady');
  return hold('hold');
}

module.exports = { classify, paramsFor, round2, REGISTRY };
