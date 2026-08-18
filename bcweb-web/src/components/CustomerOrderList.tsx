'use client';
/*
=======================================================================================================================================
Component: CustomerOrderList
=======================================================================================================================================
Purpose: The CUSTOMERS stage of the Order Status module — the fulfilment grid, ported from the legacy PowerBuilder Status screen
         (Downloads/legacy-status.png). What have customers bought, and can we send it.

WHY A DENSE TABLE AND NOT CARDS (owner, explicitly): there can be 100+ orders and the job is to GLANCE at the list — spot the red,
deal with it, move on. Cards turn a one-screen scan into four screens of scrolling. So: ~28px rows, tabular figures, one row per
physical unit, and colour doing the talking. This is the one screen in the app where a plain table beats anything prettier.

COLUMNS — the legacy grid's, less four that were saying the same thing twice (all owner's calls):
  Local, UKD  the pick count and the UKD-stock count. Both are folded into the state stripe. UKD sourcing isn't done any more anyway.
  FBA         an integer column that was empty on all but a handful of rows. FBA is one of the six states, so the status pill says it.
  Ordered     showed `createddate` while "Order date" showed `orderdate`. Neither was the right source. The surviving column is
              headed "Ordered" and reads `created` — WHEN THE CUSTOMER ORDERED, always present, always to the second. `orderdate`
              is when WE last acted on the line and only agrees with it ~63% of the time; it stays in the payload to drive the
              state derivation but is not printed. When-we-ordered may earn a column later; it isn't this one.

GRAIN vs GROUPING: `orderstatus` holds one row per physical unit (CLAUDE.md landmine), so a 2-pair order is two rows sharing an
ordernum. Rows stay flat — that's what keeps the list scannable — but the ordernum is printed only on a group's first row and a hairline
separates groups, so the eye reads "one order, two pairs" without the layout changing shape. Every ACTION is per-order, matching both
the server routes and the way an operator thinks ("chase BC18665"), so clicking any line selects the whole order.

SELECTION drives one action bar above the table rather than a control per row: 100 rows x 5 controls would be unreadable, and the
legacy screen worked exactly this way (pick a row, choose from the dropdown, Apply). The note lives in that bar too — it's the blank
strip across the top of the legacy grid, which is where the feature came from.

STICKY CONTROLS: filters + find box + action bar are pinned to the top of the viewport (`position: sticky`), because the two halves
of every job on this screen are 80 rows apart — you find the row down the list, then act on it in a bar that used to be off-screen by
then. Scrolling back up to reach the bar, with the selection made blind, was the friction. Now the bar follows.

The column header sticks BELOW that block, which is why its `top` is measured at runtime rather than written as a class: the block
grows and shrinks (error line, confirm box, chips wrapping), so a hard-coded offset would either overlap the headings or leave a gap.
Sticky only bites when no ancestor is a scroll container, hence `lg:overflow-visible` on the table wrapper — below lg the table needs
its horizontal scroller more than it needs a pinned heading row.

TWO REFRESH-SHAPED THINGS, AND THEY ARE NOT THE SAME (see the Refresh button for the full note): REFRESH here re-reads our own DB —
free, read-only, press it all day. UPDATE ORDERS in the title row calls Shopify and writes. Only the second one can make a packed
order leave the list, because that's the archive phase of the sync.

DATA comes from useApiQuery (SWR). Never fetch in a useEffect — docs/maintenance-notes.md.
=======================================================================================================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon, ChevronDownIcon, ExclamationTriangleIcon, MagnifyingGlassIcon, TrashIcon,
} from '@heroicons/react/24/outline';
import { ChatBubbleLeftEllipsisIcon } from '@heroicons/react/24/solid';
import {
  CustomerOrderLine, CustomerOrderState, deleteCustomerOrder, getCustomerOrders,
  setCustomerOrderCourier, setCustomerOrderFba, setCustomerOrderNote, setCustomerOrderWaiting,
} from '@/lib/api';
import {
  COURIERS, CUSTOMER_ORDERS_KEY, CUSTOMER_STATES,
  courierShort, isFba, isOutstanding, orderedAt, worstCustomerState,
} from '@/lib/orderStatusUi';
import { useApiQuery } from '@/lib/useApiQuery';

// Stable "nothing loaded yet" identity so the derived memos below aren't invalidated on every render.
const NO_LINES: CustomerOrderLine[] = [];

// Pack-only is a courier CODE on the row ('0', see COURIERS) but not a courier CHOICE on this screen — it has its own button on the
// action bar, so it's split out of the dropdown's options here. COURIERS stays the full list: the grid's Courier column still has to
// render 'Pack', and the server still validates '0' like any other code.
const PACK_ONLY = '0';
const SHIPPING = COURIERS.filter((c) => c.code !== PACK_ONLY);

export default function CustomerOrderList() {
  // Same SWR key the module home uses to headline the counts on the stage switch. SWR dedupes by key, so the two call sites share
  // one request and one cache entry — which is why this component doesn't report its counts upward through a prop. (It used to, and
  // that meant calling the parent's setState during this component's render: React rejects that outright, and rightly.)
  const { data, error: loadError, isLoading, busy, refresh } = useApiQuery(
    CUSTOMER_ORDERS_KEY,
    () => getCustomerOrders(),
  );

  const lines = data?.lines ?? NO_LINES;
  const truncated = data?.truncated ?? false;

  const [selected, setSelected] = useState<string | null>(null);
  // Two positions, not eight. See isOutstanding() — the screen asks one question and this is it. (Three now, but 'fba' is a
  // different question — "what has Amazon got to ship" — not a third slice of the packing job.)
  const [filter, setFilter] = useState<'all' | 'pending' | 'fba'>('all');
  const [term, setTerm] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // How tall the pinned control block currently is, so the table's heading row can stick directly underneath it instead of behind it.
  // Measured rather than assumed because the block changes height in normal use: selecting an order fills the bar, a failed write adds
  // an error line, a confirm swaps a button for a wider box, and the filter chips wrap on a narrow window.
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const [controlsHeight, setControlsHeight] = useState(0);
  useEffect(() => {
    const el = controlsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setControlsHeight(el.offsetHeight));
    ro.observe(el);
    setControlsHeight(el.offsetHeight);
    return () => ro.disconnect();
    // The ref is null on the loading/error renders (the block isn't mounted), so the effect has to run again once the grid appears —
    // that is what these deps are for, not the values themselves.
  }, [isLoading, loadError]);

  // --- derived -----------------------------------------------------------------------------------------------------------------

  // Per-order roll-up, computed once: the state stripe, the line count, and the order-level fields the action bar needs. Keyed by
  // ordernum because that is the unit of action.
  const orders = useMemo(() => {
    const map = new Map<string, {
      ordernum: string; lines: CustomerOrderLine[]; state: CustomerOrderState;
      customer: string | null; postcode: string | null; courier: string | null; note: string; waiting: boolean;
    }>();
    for (const l of lines) {
      let o = map.get(l.ordernum);
      if (!o) {
        // Placeholder only — overwritten by the worstCustomerState roll-up once every line of the group has been collected.
        o = { ordernum: l.ordernum, lines: [], state: 'pending', customer: l.customer, postcode: l.postcode,
              courier: l.courier, note: '', waiting: false };
        map.set(l.ordernum, o);
      }
      o.lines.push(l);
      // First non-empty note in the group wins. Writes fan out across every line, so they normally agree — this only matters for
      // orders PowerBuilder noted line-by-line before this screen existed.
      if (!o.note && l.note) o.note = l.note;
      if (l.state === 'waiting') o.waiting = true;
    }
    for (const o of map.values()) o.state = worstCustomerState(o.lines.map((l) => l.state));
    return map;
  }, [lines]);

  // Two tallies, and they do NOT add up to lines.length — that is the point. `outstanding` is our packing job; `fba` is Amazon's,
  // counted apart so it can't make a finished day look unfinished (see isOutstanding). Only `All` counts every line.
  const outstanding = useMemo(() => lines.reduce((n, l) => n + (isOutstanding(l.state) ? 1 : 0), 0), [lines]);
  const fbaCount = useMemo(() => lines.reduce((n, l) => n + (isFba(l.state) ? 1 : 0), 0), [lines]);

  // Search spans everything you'd have in your hand when looking an order up: the order number off a picking note, the customer's
  // name off an email, a postcode off a label, or the SKU. Case-insensitive substring, no term parsing — this is a find box, not a
  // query language (contrast the Inventory/Sales modules, where stepwise Contains filters earn their complexity).
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return lines.filter((l) => {
      // The same isOutstanding()/isFba() the chips counted with, so what a chip says and what it shows can never disagree.
      if (filter === 'pending' && !isOutstanding(l.state)) return false;
      if (filter === 'fba' && !isFba(l.state)) return false;
      if (!q) return true;
      return (
        l.ordernum.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q) ||
        (l.customer || '').toLowerCase().includes(q) ||
        (l.postcode || '').toLowerCase().includes(q) ||
        (l.title || '').toLowerCase().includes(q)
      );
    });
  }, [lines, filter, term]);

  const active = selected ? orders.get(selected) ?? null : null;

  // Read off the per-order roll-up rather than the line being rendered: the note may sit on any line of the group (PowerBuilder wrote
  // only the clicked row), so testing the current line would hide the marker whenever the noted line isn't the one on top.
  const noteFor = (ordernum: string) => orders.get(ordernum)?.note || '';

  // --- actions -----------------------------------------------------------------------------------------------------------------

  // One wrapper for all five writes: they share a shape (act on the selected order, surface the error inline, refetch). api.ts never
  // throws on an API-level error, so this branches on the envelope, not on a catch.
  async function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setWorking(true);
    setActionError(null);
    const res = await fn();
    if (!res.success) setActionError(res.error || 'That didn’t work');
    else await refresh();
    setWorking(false);
    return res.success;
  }

  // --- render ------------------------------------------------------------------------------------------------------------------

  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (loadError) return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>;

  return (
    <div>
      {/* --- the pinned control block ------------------------------------------------------------------------------------------
          Everything you can DO on this screen, held at the top of the viewport while the list scrolls under it. The negative margin
          + matching padding let the opaque background span the full width of AppShell's container, so rows disappear cleanly behind
          it rather than showing through at the edges. -top-px kills the hairline gap some browsers leave at fractional scroll
          offsets. z-30 keeps it above the table's own sticky heading row (z-10). */}
      <div ref={controlsRef} className="sticky -top-px z-30 -mx-4 border-b border-slate-200 bg-white px-4 pb-3 pt-1">
      {/* --- filter chips + find box ------------------------------------------------------------------------------------------ */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* TWO CHIPS. Pending is always rendered, even at zero — a day finished is worth seeing as "Pending 0", and a chip that
            disappears when it empties takes the reassurance with it. */}
        <Chip label="All" count={lines.length} active={filter === 'all'} onClick={() => setFilter('all')} />
        <Chip
          label="Pending"
          count={outstanding}
          active={filter === 'pending'}
          onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
        />

        {/* FBA, and ONLY when there are some. The opposite call to Pending's above, for the opposite reason: an FBA line is an
            exception that needs an MCF order placing, so the chip appearing IS the reminder — where "FBA 0" every day would be
            noise you'd stop seeing, which is exactly how the thing gets forgotten. Sky, to match the row stripe. */}
        {fbaCount > 0 && (
          <Chip
            label="FBA"
            count={fbaCount}
            active={filter === 'fba'}
            onClick={() => setFilter(filter === 'fba' ? 'all' : 'fba')}
            tone="sky"
          />
        )}

        {/* Progress is over OUR work only — FBA lines are out of both halves, so the bar can reach "All packed" on a day that has
            an MCF order still to place. That is deliberate: the chip beside it is what says otherwise. */}
        <PackProgress packed={lines.length - outstanding - fbaCount} total={lines.length - fbaCount} />

        {/* --- refresh ---------------------------------------------------------------------------------------------------------
            NOT "Update orders". This re-reads OUR database and nothing else: one query, no Shopify call, no writes. It's here so
            that checking pick progress through the busy part of the day — which is done constantly — costs nothing and can't hammer
            the Shopify API. Update orders stays in the title row, deliberately further away, because it writes.

            WHAT IT DOES AND DOESN'T SHOW, because the difference matters and isn't obvious:
              it DOES show   progress the team makes in our own DB — notes, courier / Pack only, Waiting, and the localstock
                             allocation PowerBuilder writes as things are picked.
              it does NOT    make a packed order leave the list. A line only disappears once Shopify reports it fulfilled and the
                             ARCHIVE phase moves it to orderstatus_archive — and that phase is part of the sync, so it needs an
                             Update orders (or the cron run, which fires around the dispatch window).
            So: Refresh to see how the picking is going, Update orders when you want the count to come down. */}
        <button
          type="button"
          onClick={() => refresh()}
          disabled={busy}
          title="Re-read our order list. Doesn't contact Shopify."
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowPathIcon className={'h-4 w-4 ' + (busy ? 'animate-spin' : '')} />
          Refresh
        </button>

        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          {/* Forced UPPERCASE, like the Pricing and Inventory find boxes (owner) — order numbers and SKUs are uppercase, so typing
              matches what's on the screen and on the picking note. Purely cosmetic to the filter: `shown` lowercases both sides, so
              a lowercase customer name or title still matches. `placeholder:normal-case` keeps the hint readable. */}
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            placeholder="Order, customer, postcode, SKU…"
            className="w-64 rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-sm uppercase placeholder:normal-case placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
          />
        </div>
      </div>

      {/* --- the action bar: the legacy screen's top strip ---------------------------------------------------------------------
          ALWAYS RENDERED, never conditionally mounted. Showing it only when a row was selected made the whole grid jump down the
          page on the click that selected it — and then jump back up on deselect, moving the row you were aiming at. With nothing
          selected it renders in the same footprint with its controls disabled, so clicking a row changes the contents of a box that
          was already there and the table never moves. */}
      <OrderActionBar
        order={active}
        working={working}
        error={actionError}
        onClose={() => { setSelected(null); setActionError(null); }}
        onNote={(note) => active && run(() => setCustomerOrderNote(active.ordernum, note))}
        onWaiting={(w) => active && run(() => setCustomerOrderWaiting(active.ordernum, w))}
        onCourier={(c) => active && run(() => setCustomerOrderCourier(active.ordernum, c))}
        onFba={() => active && run(() => setCustomerOrderFba(active.ordernum))}
        onDelete={async () => { if (active && await run(() => deleteCustomerOrder(active.ordernum))) setSelected(null); }}
      />
      </div>

      {/* Outside the pinned block on purpose: it's a one-off notice, not a control, and it would cost the grid a permanent strip of
          the viewport for something you read once. */}
      {truncated && (
        <div className="mb-2 mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing the first {lines.length} lines — there are more. Narrow it down with the search box.
        </div>
      )}

      {/* --- the grid ---------------------------------------------------------------------------------------------------------- */}
      {/* `overflow-x-auto` makes this a scroll container, and a sticky child positions against its nearest scrolling ancestor — which
          would pin the heading row to a box that never scrolls, i.e. not at all. From lg up the table fits the container outright, so
          the scroller is dropped and the heading sticks to the window like it's meant to. Below lg the horizontal scroll is worth
          more than a pinned heading. */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white lg:overflow-visible">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          {/* `top` is the live height of the pinned control block above — see the note on controlsHeight. */}
          <thead
            style={{ top: controlsHeight }}
            className="sticky z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"
          >
            <tr>
              <th className="w-1 p-0" aria-label="Status" />
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-2 py-2 font-medium">Code</th>
              <th className="px-2 py-2 text-right font-medium">Qty</th>
              <th className="px-2 py-2 font-medium">Supplier</th>
              <th className="px-2 py-2 font-medium">Customer</th>
              <th className="px-2 py-2 font-medium">Post code</th>
              {/* One date column, not two. The old "Ordered" showed createddate and "Order date" showed the orderdate stamp — the
                  same event at two precisions, in two columns, which is why one of them had to go. FBA lost its column too: it is
                  one of the states, so the stripe already says it and a mostly-empty integer column said it twice. */}
              <th className="px-2 py-2 font-medium">Ordered</th>
              <th className="px-2 py-2 font-medium">Courier</th>
              {/* Only ever holds "Packed" now — hence the heading, which says what the column is for rather than what it contains. */}
              <th className="px-2 py-2 font-medium">Packed</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => {
              // A group's first VISIBLE row prints the ordernum and gets the separator. Computed against the filtered list, so
              // filtering to one state never leaves a group looking headerless.
              const firstOfGroup = i === 0 || shown[i - 1].ordernum !== l.ordernum;
              const isSelected = selected === l.ordernum;
              const s = CUSTOMER_STATES[l.state];
              return (
                <tr
                  key={`${l.ordernum}|${l.code}`}
                  onClick={() => { setSelected(isSelected ? null : l.ordernum); setActionError(null); }}
                  className={
                    'cursor-pointer ' +
                    (firstOfGroup ? 'border-t border-slate-200 ' : '') +
                    (isSelected ? 'bg-brand-50' : 'hover:bg-slate-50')
                  }
                >
                  {/* The stripe is the whole point of the screen: state read by colour, at a glance, without reading a word. */}
                  <td className={'w-1 p-0 ' + s.stripe} />
                  {/* The note marker rides with the ordernum because the note is per-ORDER, so it must appear once per group and not
                      once per unit. Amber and solid-filled so it reads as "there is something here to read" against a row of grey
                      text — a hollow outline icon at this size disappears. The native title gives it away on hover for a mouse
                      user; the click that opens it is the row click that's already there. */}
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium tabular-nums text-slate-800">
                    {firstOfGroup && (
                      <span className="flex items-center gap-1.5">
                        {l.ordernum}
                        {noteFor(l.ordernum) && (
                          // `title` makes heroicons render a real <svg><title> child, which is what actually produces the hover
                          // tooltip (the title ATTRIBUTE does nothing on an SVG). titleId + aria-hidden={false} override the
                          // library's decorative defaults so the note is announced rather than skipped — this icon carries
                          // information, so it must not be hidden from assistive tech.
                          <ChatBubbleLeftEllipsisIcon
                            className="h-3.5 w-3.5 shrink-0 text-amber-500"
                            title={`Note: ${noteFor(l.ordernum)}`}
                            titleId={`note-${l.ordernum}`}
                            aria-hidden={false}
                          />
                        )}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-600" title={l.title || l.code}>{l.code}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{l.qty}</td>
                  <td className="max-w-[120px] truncate px-2 py-1.5 text-slate-500">{l.supplier || '—'}</td>
                  <td className="max-w-[150px] truncate px-2 py-1.5 text-slate-600">{l.customer || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{l.postcode || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-500">{orderedAt(l.created)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{courierShort(l.courier)}</td>
                  {/* ONE PILL, AND ONLY FOR PACKED (owner). A pill on every row meant the column was a wall of badges you had to
                      read to find the few that mattered; with only the finished lines badged, "what's done" is a shape you can see
                      without reading a word, and an empty cell means "not yet" — which is the other half of the same answer.
                      The other states haven't gone: they still colour the stripe on the left of the row. */}
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {l.state === 'packed' && (
                      <span className={'rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ' + s.pill}>{s.label}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-400">
            {lines.length === 0 ? 'No customer orders to fulfil.' : 'Nothing matches that filter.'}
          </p>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {shown.length === lines.length
          ? `${lines.length} line${lines.length === 1 ? '' : 's'} across ${orders.size} order${orders.size === 1 ? '' : 's'}`
          : `${shown.length} of ${lines.length} lines`}
        {busy && ' · refreshing…'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * PackProgress — how much of today's list is boxed, as a bar.
 *
 * Pure decoration in the sense that it adds no information: `All` and `Pending` already carry both numbers. It earns its place by
 * making them a SHAPE. "Pending 9" is a number you have to think about; a bar two-thirds full is a glance, and on a screen worked
 * all day in short visits, the glance is what you actually want.
 *
 * Kept to the height of the chips beside it and given a fixed-ish width so the row it sits in doesn't reflow every time the count
 * changes — this block is pinned to the top of the viewport, and anything that resizes in place makes the whole grid twitch.
 *
 * The fill animates its width rather than snapping, which is the entire "nice" of it: press Refresh after packing a couple and the
 * bar visibly moves. `transition-[width]` and not `transition-all`, so only the geometry animates and the colour swap at 100% lands
 * at once instead of fading through a muddy in-between.
 *
 * Hidden entirely on an empty list: a 0-of-0 bar is a progress indicator for no work, which reads as broken rather than as done.
 */
function PackProgress({ packed, total }: { packed: number; total: number }) {
  if (total === 0) return null;

  const pct = Math.round((packed / total) * 100);
  const done = packed === total;

  return (
    <div
      className="ml-1 flex min-w-[150px] max-w-[240px] flex-1 items-center gap-2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={packed}
      aria-label={`${packed} of ${total} packed`}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div
          className={'h-full rounded-full transition-[width] duration-700 ease-out ' +
            (done ? 'bg-emerald-500' : 'bg-emerald-400')}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* tabular-nums so the label can't change width as the digits change and nudge the bar — same reason as the fixed track. */}
      <span className={'shrink-0 text-xs font-medium tabular-nums ' + (done ? 'text-emerald-700' : 'text-slate-400')}>
        {done ? 'All packed' : `${packed}/${total}`}
      </span>
    </div>
  );
}

/*
 * Chip — All / Pending / FBA.
 *
 * `tone` is the one bit of styling it takes: default slate for the two chips that slice our own work, 'sky' for FBA so it reads as a
 * different KIND of thing at a glance and matches that row's stripe. Not a general colour prop — two tones, both spelled out, because
 * the next state that wants a colour should have to justify it here rather than pass a class in.
 */
function Chip({ label, count, active, onClick, tone = 'slate' }: {
  label: string; count: number; active: boolean; onClick: () => void; tone?: 'slate' | 'sky';
}) {
  const idle = tone === 'sky'
    ? 'border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300'
    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300';
  const on = tone === 'sky' ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-800 bg-slate-800 text-white';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ' + (active ? on : idle)
      }
    >
      {label}
      <span className={active ? 'text-white/70' : (tone === 'sky' ? 'text-sky-400' : 'text-slate-400')}>{count}</span>
    </button>
  );
}

/*
 * OrderActionBar — everything you can do to the selected order, in the strip above the grid.
 *
 * ACTIONS ARE RANKED BY HOW OFTEN THEY'RE ACTUALLY USED (all owner's calls), not by how interesting they are:
 *
 *   Note, Pack only, Courier      on the face of the bar, always visible, no click to reach them.
 *   Waiting, Send from FBA, Delete  rare. Behind a "More" disclosure.
 *
 * PACK ONLY is promoted OUT of the courier dropdown and onto the bar as its own button — it's one of the two things done most on
 * this screen ("deal with this, don't send it out"), and it isn't really a shipping choice at all: it's the decision NOT to ship
 * yet. Buried as one of three options in a select, a main action cost two clicks and read as a courier. It still writes the same
 * `courier='0'` through the same route, so the table column and the legacy screen are unaffected — only the control moved.
 *
 * The disclosure is the ONE thing here allowed to change the bar's height. Everything else is pinned (see below), but this only
 * expands on an explicit click on "More", when the operator is aiming at the bar rather than at the table.
 *
 * `order` is NULLABLE and the bar renders either way — see the note at the call site. Every control is simply disabled when nothing
 * is selected, which keeps the footprint identical between the two states; that is the whole point, so don't "tidy" this into an
 * early return.
 */
function OrderActionBar({ order, working, error, onClose, onNote, onWaiting, onCourier, onFba, onDelete }: {
  order: { ordernum: string; customer: string | null; postcode: string | null; courier: string | null; note: string;
           waiting: boolean; lines: CustomerOrderLine[] } | null;
  working: boolean;
  error: string | null;
  onClose: () => void;
  onNote: (note: string) => void;
  onWaiting: (w: boolean) => void;
  onCourier: (c: string) => void;
  onFba: () => void;
  onDelete: () => void;
}) {
  // Keyed on ordernum so selecting a different order re-seeds the field instead of carrying the previous order's note across.
  // Deriving state during render like this is the sanctioned React pattern for "reset when a prop changes" — note it sets THIS
  // component's own state, which is exactly what made the earlier parent-notifying version illegal.
  const [note, setNote] = useState(order?.note ?? '');
  const [noteFor, setNoteFor] = useState(order?.ordernum ?? null);
  const [confirm, setConfirm] = useState<'fba' | 'delete' | null>(null);
  const [more, setMore] = useState(false);

  if (noteFor !== (order?.ordernum ?? null)) {
    setNoteFor(order?.ordernum ?? null);
    setNote(order?.note ?? '');
    // Clear any half-answered confirm too. Without this, arming "Delete?" on one order and then clicking a different row would
    // leave the confirm showing against the new selection — one more click and the wrong order is gone. The disclosure re-closes
    // for the same reason: the rare actions should be a deliberate choice per order, never left standing open from the last one.
    setConfirm(null);
    setMore(false);
  }

  const idle = order === null;
  // Disabled whenever there's nothing selected OR a write is in flight, so the two cases never need separate handling below.
  const off = idle || working;
  const multiLine = (order?.lines.length ?? 0) > 1;
  const noteChanged = !idle && note.trim() !== order.note.trim();
  const packOnly = order?.courier === PACK_ONLY;

  return (
    // No bottom margin: the pinned block that wraps this owns the gap to the grid, and a margin here would be dead pinned pixels.
    <div className={'rounded-lg border p-3 transition-colors ' +
      (idle ? 'border-slate-200 bg-slate-50/60' : 'border-brand-200 bg-brand-50/50')}>
      {/* ONE header structure for both states, never a branch between two different layouts — that branch was the flip. Every slot
          is always present and always occupies its space: the order number falls back to a placeholder dash, the hint takes the
          customer slot, and Close goes `invisible` (which still reserves its box) rather than unmounting. The explicit min-height
          pins the row even if every slot happens to be empty, so the table below never moves. */}
      <div className="mb-2 flex min-h-[1.5rem] flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={'font-semibold ' + (idle ? 'text-slate-300' : 'text-slate-900')}>
          {order ? order.ordernum : '—'}
        </span>
        <span className={'text-sm ' + (idle ? 'text-slate-400' : 'text-slate-600')}>
          {order ? (order.customer || '—') : 'Select an order below'}
        </span>
        <span className="text-sm text-slate-400">{order?.postcode || ''}</span>
        <button
          type="button"
          onClick={onClose}
          disabled={idle}
          className={'ml-auto text-xs text-slate-400 hover:text-slate-600 ' + (idle ? 'invisible' : '')}
        >
          Close
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {/* --- the note: the legacy blank bar ------------------------------------------------------------------------------- */}
        <div className="min-w-[260px] flex-1">
          <label htmlFor="cust-note" className="mb-1 block text-xs font-medium text-slate-500">Note</label>
          <div className="flex gap-2">
            <input
              id="cust-note"
              value={note}
              disabled={off}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={idle ? '' : 'e.g. waiting for customer to confirm size'}
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none disabled:bg-slate-100"
            />
            <button
              type="button"
              disabled={off || !noteChanged}
              onClick={() => onNote(note)}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>

        {/* --- pack only ------------------------------------------------------------------------------------------------------ */}
        {/* A main action, so it gets a button. Toggle-styled rather than fire-and-forget because it's a STATE the order is in — you
            need to see at a glance that the selected order is already held back. There's no "un-pack": you leave it by picking a
            real courier next door, which is exactly what the operator does. */}
        <button
          type="button"
          disabled={off}
          aria-pressed={packOnly}
          onClick={() => onCourier(PACK_ONLY)}
          className={
            'rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ' +
            (packOnly
              ? 'border-amber-300 bg-amber-100 text-amber-900'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
          }
        >
          {packOnly ? 'Pack only ✓' : 'Pack only'}
        </button>

        {/* --- courier -------------------------------------------------------------------------------------------------------- */}
        <div>
          <label htmlFor="cust-courier" className="mb-1 block text-xs font-medium text-slate-500">Courier</label>
          <select
            id="cust-courier"
            value={SHIPPING.some((c) => c.code === order?.courier) ? (order!.courier as string) : ''}
            disabled={off}
            onChange={(e) => e.target.value && onCourier(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-100 disabled:opacity-60"
          >
            {/* Present whenever the stored code isn't one of the shipping services — pack-only (now the button's job), an
                unexpected value, or nothing selected. An unrecognised code is shown raw rather than silently re-labelled as
                something we do offer. */}
            {!SHIPPING.some((c) => c.code === order?.courier) && (
              <option value="">
                {packOnly ? 'Pack only' : order?.courier ? `Other (${order.courier})` : idle ? '—' : 'Not set'}
              </option>
            )}
            {SHIPPING.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>

        {/* --- the way through to the rare three ------------------------------------------------------------------------------ */}
        {/* Quiet on purpose: a plain text button, no border, no colour. It isn't an action, it's a door — and the whole point of
            moving Waiting, FBA and Delete behind it was to stop rarely-used buttons drawing the eye on every selection. */}
        <button
          type="button"
          disabled={off}
          aria-expanded={more}
          onClick={() => { setMore(!more); setConfirm(null); }}
          className="ml-auto flex items-center gap-1 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
        >
          More
          <ChevronDownIcon className={'h-4 w-4 transition-transform ' + (more ? 'rotate-180' : '')} />
        </button>
      </div>

      {/* --- the rare three ----------------------------------------------------------------------------------------------------
          Waiting, FBA and Delete. The two that can't be undone from this screen keep their confirm step; that's the whole warning,
          there's no prose telling the operator what they already know. */}
      {more && order && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            disabled={off}
            aria-pressed={order.waiting}
            onClick={() => onWaiting(!order.waiting)}
            className={
              'rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ' +
              (order.waiting
                ? 'border-amber-300 bg-amber-100 text-amber-900'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
            }
          >
            {order.waiting ? 'Waiting ✓' : 'Waiting'}
          </button>

          {confirm === 'fba' ? (
            <ConfirmBox
              message="Send from FBA?"
              onYes={() => { setConfirm(null); onFba(); }}
              onNo={() => setConfirm(null)}
            />
          ) : (
            <button
              type="button"
              disabled={off || multiLine}
              title={multiLine ? 'FBA can only be set on a single-line order' : undefined}
              onClick={() => setConfirm('fba')}
              className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40"
            >
              Send from FBA
            </button>
          )}

          {confirm === 'delete' ? (
            <ConfirmBox
              // The line count is the one thing the confirm has to say: deleting is per-ORDER, so a multi-line order takes its
              // siblings with it and the count is what tells you that.
              message={order.lines.length === 1 ? 'Delete this order?' : `Delete all ${order.lines.length} lines?`}
              onYes={() => { setConfirm(null); onDelete(); }}
              onNo={() => setConfirm(null)}
            />
          ) : (
            <button
              type="button"
              disabled={off}
              onClick={() => setConfirm('delete')}
              className="flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              <TrashIcon className="h-4 w-4" /> Delete
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-red-700">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

// Inline confirm rather than window.confirm: a native modal blocks the whole tab and reads as a browser error.
function ConfirmBox({ message, onYes, onNo }: { message: string; onYes: () => void; onNo: () => void }) {
  return (
    // nowrap on the message: if it wrapped, the confirm would grow taller than the button it replaced and shunt the table down —
    // the same flip this bar exists to avoid, just triggered by a different click.
    <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
      <span className="text-slate-700">{message}</span>
      <button type="button" onClick={onYes} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Yes</button>
      <button type="button" onClick={onNo} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">No</button>
    </span>
  );
}
