/*
=======================================================================================================================================
Module: src/lib/orderStatusUi.ts
=======================================================================================================================================
Purpose: Shared "how stale is this" styling for the Order Status module — one place for the amber/red day thresholds so the supplier
         list and the batch/order lists agree on what "stuck" means. (Can't live in a page.tsx: Next's App Router only allows a fixed
         set of named exports from a page file.)

TWO SCALES, because the module's two stages age completely differently:

  ON ORDER  (ageClass)       — days since the order was PLACED with the supplier. A few days is just delivery; the thresholds give
                               about a week's warning ahead of the legacy 30-day auto-purge (clean_sales.sql).
  TO PLACE  (chosenAgeClass) — days since the goods were CHOSEN and left un-ordered. Far tighter, because this clock measures our own
                               inaction rather than a supplier's lead time: nothing is on its way, and every day of it is a day the
                               stock lands later. Two days sitting in the queue already deserves a nudge.

Plus, at the foot of the file, the CUSTOMER ORDERS vocabulary — which isn't an age scale at all, but a state palette. See the header
on that section for why colour carries the meaning there and not here.
=======================================================================================================================================
*/

import type { CustomerOrderState } from '@/lib/api';

// --- ON ORDER: waiting on the supplier ---------------------------------------------------------------------------------------
export const STALE_AMBER_DAYS = 14;
export const STALE_RED_DAYS = 21;

export function ageClass(days: number): string {
  if (days >= STALE_RED_DAYS) return 'text-red-700 bg-red-50';
  if (days >= STALE_AMBER_DAYS) return 'text-amber-700 bg-amber-50';
  return 'text-slate-500';
}

// --- TO PLACE: sitting in our own queue --------------------------------------------------------------------------------------
export const UNPLACED_AMBER_DAYS = 2;
export const UNPLACED_RED_DAYS = 4;

export function chosenAgeClass(days: number): string {
  if (days >= UNPLACED_RED_DAYS) return 'text-red-700 bg-red-50';
  if (days >= UNPLACED_AMBER_DAYS) return 'text-amber-700 bg-amber-50';
  return 'text-slate-500';
}

// £ for a possibly-unknown cost. Whole pounds once the total is big enough that pennies are noise — which is how an order value
// actually gets read ("about £400") — but exact to 2dp below that, where the pennies still say something.
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v >= 1000 ? `£${Math.round(v).toLocaleString('en-GB')}` : `£${v.toFixed(2)}`;
}

// =============================================================================================================================
// CUSTOMER ORDERS (ordertype 1) — the fulfilment stage. A THIRD scale, unrelated to the two above: this list isn't aged, it's
// triaged. What matters is "can we send it", and that's a state, not a number of days.
// =============================================================================================================================

// Colour IS the information here — the legacy screen's whole UI was a coloured row, and operators read it by scanning stripes, not
// by reading the state word. So each state gets a distinct hue rather than a shared "selected" tint (contrast the deliberately
// single-colour OrderStageSwitch, where colour only means "this one").
//
// The pairing is: red = nobody has dealt with this; amber = someone has, and it's held on purpose; blue/indigo = in motion, sourced
// from elsewhere; teal/green = the goods are ours and moving; grey = nothing is happening to this line (either waiting its turn, or
// deliberately out of play).
//
// "Pending" (owner's word) is the label for `pending`, and it is the THIRD name this state has had. The flag means a shelf unit is
// RESERVED against the line and ~96% of customer order lines sit in it for their whole life, so the two earlier names both claimed
// progress the data doesn't record: "Picked" read as done-and-packed, and "In stock" described the STOCK when the column describes
// the ORDER LINE. Pending says the true thing — everything needed is here, and it's waiting on us.
export const CUSTOMER_STATES: Record<CustomerOrderState, { label: string; stripe: string; pill: string }> = {
  no_stock: { label: 'No stock', stripe: 'bg-red-500',    pill: 'bg-red-50 text-red-700 ring-red-200' },
  waiting:  { label: 'Waiting',  stripe: 'bg-amber-400',  pill: 'bg-amber-50 text-amber-800 ring-amber-200' },
  sourcing: { label: 'Sourcing', stripe: 'bg-indigo-500', pill: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  fba:      { label: 'FBA',      stripe: 'bg-sky-500',    pill: 'bg-sky-50 text-sky-700 ring-sky-200' },
  // PENDING -> PICKED -> PACKED is one progression, but it is NOT one hue at three depths. That was tried (2026-07-31) and rejected
  // immediately: at a 1px stripe, three tints of green are three shades of the same smudge — the two you most need to tell apart
  // (has this moved or not) were the two hardest to separate. Depth is too weak a signal at this size, whatever the theory says.
  //
  // So the progression is carried by MOVEMENT INTO COLOUR instead, which reads at a glance:
  //   pending  GREY   — reserved on a shelf, nobody has moved. It is also the resting state of ~96% of lines, so grey is honest
  //                     twice over: nothing has happened, and there is nothing here to look at. The eye should skip it.
  //   picked   teal   — off the shelf. First colour, because it is the first thing anyone actually did.
  //   packed   SOLID  — boxed, done with. The only filled pill on the screen, because it's the only state that means "finished".
  packed:   { label: 'Packed',   stripe: 'bg-emerald-600', pill: 'bg-emerald-600 text-white ring-emerald-700' },
  picked:   { label: 'Picked',   stripe: 'bg-teal-500',    pill: 'bg-teal-50 text-teal-700 ring-teal-200' },
  // Styled to look DISABLED (owner) — the flat grey of a control that isn't in play: faint stripe, washed-out text, barely-there
  // ring. It is the resting state of ~96% of lines, so the more it recedes the more the handful of rows that HAVE moved stand out.
  // This is the one pill deliberately built to be skipped over rather than read.
  pending:  { label: 'Pending',  stripe: 'bg-slate-200',   pill: 'bg-slate-100 text-slate-400 ring-slate-200' },
  // Deepened from slate-400 so it can't be mistaken for the now-grey `pending` beside it. It keeps a grey because it is the other
  // "nothing is happening here" state, but a line taken deliberately out of play must not read as one merely waiting its turn.
  parked:   { label: 'Do not order', stripe: 'bg-slate-600', pill: 'bg-slate-200 text-slate-700 ring-slate-400' },
};

// Chip order for the filter bar, and the ranking for the order-level "worst state" roll-up: lower index wins.
//
// This is the ONLY roll-up ranking in the codebase — the server deliberately has none (it derives per-ROW states and stops there).
// It is NOT the same order as rowState()'s internal precedence, and the difference is load-bearing: `parked` comes FIRST there (the
// 'Do Not Order' string overrides every other flag on that row) but LAST here, so a line taken deliberately out of play can never
// mask a sibling line in the same order that nobody has dealt with. See utils/customerOrders.js for the full reasoning.
//
// The progression states run pending -> picked -> packed here, which is the opposite of how they read: packed is furthest along, so
// surely it "wins"? No — this ranking answers "what still needs doing on this order", and lower index = more outstanding. A two-pair
// order with one pair boxed and one still on the shelf is a PENDING order; letting the packed line colour it would call it done
// while a pair is unpicked. Only `parked` ranks lower, for the reason above.
export const CUSTOMER_STATE_ORDER: CustomerOrderState[] =
  ['no_stock', 'waiting', 'sourcing', 'fba', 'pending', 'picked', 'packed', 'parked'];

/*
 * isOutstanding(state) -> is this line still to be packed?
 *
 * THE WHOLE FILTER MODEL OF THIS SCREEN, deliberately reduced to one question (owner, 2026-07-31). It used to offer a chip per
 * state — No stock, Waiting, Sourcing, FBA, Pending, Picked, Packed, Do not order — which was eight ways to slice a list that on a
 * normal day is one job: pack what hasn't been packed. The eight chips answered questions nobody was asking while the answer to the
 * one being asked had to be assembled from several of them.
 *
 * So: packed, or not. Everything that isn't boxed is outstanding, whatever the reason it isn't — a line waiting on stock and a line
 * sitting picked on the bench are both work left to do, and the row itself says which is which when you get to it.
 *
 * The six states still EXIST and are still derived server-side (utils/customerOrders.js); this is only about what the top of the
 * screen offers to filter by. They remain in CUSTOMER_STATES for the row stripe, and in CUSTOMER_STATE_ORDER for the roll-up.
 *
 * `parked` ('Do not order') counts as outstanding, which is arguable — it's deliberately out of play, so it will never be packed and
 * will sit in the Pending count forever. It is left in because the alternative is a line that has silently vanished from both chips,
 * and there are zero such rows today. Revisit if that changes.
 */
export function isOutstanding(state: CustomerOrderState): boolean {
  return state !== 'packed';
}

// The states that mean "someone needs to do something" — everything else is already handled and only needs to be findable.
// Lives here rather than in the list component because the stage switch headlines the same number.
export const CUSTOMER_ATTENTION_STATES: CustomerOrderState[] = ['no_stock', 'waiting'];

/*
 * The SWR key for the customer order list, shared by BOTH call sites: the list itself, and the module home that headlines its counts
 * on the stage switch. SWR dedupes and caches by key, so two components asking for the same key is ONE request and one cache entry —
 * an action in the list refreshes the switch's counts for free, with no prop plumbing between them.
 *
 * Exported as a constant rather than written out twice because a typo in either copy would silently split the cache in two: two
 * fetches, and counts that stop agreeing with the list they're counting. The key is what SWR identifies data by (see the note in
 * useApiQuery.ts) — it is not a place to be casual.
 */
export const CUSTOMER_ORDERS_KEY = ['customer-orders'] as const;

export function customerAttentionCount(lines: { state: CustomerOrderState }[]): number {
  return lines.reduce((n, l) => n + (CUSTOMER_ATTENTION_STATES.includes(l.state) ? 1 : 0), 0);
}

export function worstCustomerState(states: CustomerOrderState[]): CustomerOrderState {
  // Seeded with the LOWEST-priority state so any real state beats it; an empty order can't happen (a row is what creates the group).
  let worst: CustomerOrderState = 'parked';
  for (const s of states) {
    if (CUSTOMER_STATE_ORDER.indexOf(s) < CUSTOMER_STATE_ORDER.indexOf(worst)) worst = s;
  }
  return worst;
}

// The three shipping services still in use. Mirrors COURIERS in utils/customerOrders.js — the server validates against its own copy,
// so a drift here shows up as a rejected write rather than a silently wrong column. DHL ('2') and DPD ('3') were on the legacy
// dropdown but have never been used once, and were dropped.
export const COURIERS: { code: string; label: string; short: string }[] = [
  { code: '0', label: 'Pack only',     short: 'Pack' },
  { code: '4', label: 'Royal Mail 24', short: 'RM24' },
  { code: '5', label: 'Royal Mail 48', short: 'RM48' },
];

// Unknown codes render as the raw value rather than '—': a courier we don't recognise is worth SEEING (it means something else wrote
// it), not hiding behind a dash.
export function courierShort(code: string | null | undefined): string {
  if (!code) return '—';
  return COURIERS.find((c) => c.code === code)?.short ?? code;
}

/*
 * orderedAt('20260730 15:44:38') -> '30/07 15:44'
 *
 * The "Ordered" column: WHEN THE CUSTOMER PLACED THE ORDER. Reads `orderstatus.created`, and only that.
 *
 * There are two different timestamps on a customer order line and conflating them is the trap here:
 *
 *   `created`    when the CUSTOMER ordered. orderSync writes it from the Shopify order's created_at at insert, and nothing ever
 *                changes it. Always present, to the second — verified across all 3,177 archived customer rows: every one is a
 *                well-formed 'YYYYMMDD HH24:MI:SS' stamp, none blank, none null. It cannot be absent, because the row only exists
 *                because the order does. THIS is the column.
 *   `orderdate`  when WE acted — phase E stamps it on allocation, the FBA/UKD actions blank it, PowerBuilder can write 'Do Not
 *                Order' into it. It matches `created` on only 2,017 of those 3,177 rows and is empty on 21. It is a state marker
 *                that happens to be date-shaped, NOT the customer's order time, and it is kept for the state derivation only.
 *
 * An earlier version of this function read `orderdate` and fell back to `createddate` to paper over the gaps. That was answering
 * "when did we last touch this" while claiming to answer "when did the customer order" — two different questions blended into one
 * column. `created` answers the second one outright, so there is no fallback and no blank.
 *
 * Parsed by SLICING THE STRING, never `new Date(...)`: the stamp is Europe/London wall clock carrying no offset, so constructing a
 * Date would reinterpret it in the viewer's zone and shift every time by an hour for half the year.
 */
export function orderedAt(created: string | null | undefined): string {
  const m = (created || '').trim().match(/^(\d{4})(\d{2})(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '—';
  const [, , mo, d, h, mi] = m;
  return `${d}/${mo} ${h}:${mi}`;
}
