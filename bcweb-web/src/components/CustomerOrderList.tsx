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

DATA comes from useApiQuery (SWR). Never fetch in a useEffect — docs/maintenance-notes.md.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { ExclamationTriangleIcon, MagnifyingGlassIcon, TrashIcon } from '@heroicons/react/24/outline';
import { ChatBubbleLeftEllipsisIcon } from '@heroicons/react/24/solid';
import {
  CustomerOrderLine, CustomerOrderState, deleteCustomerOrder, getCustomerOrders,
  setCustomerOrderCourier, setCustomerOrderFba, setCustomerOrderNote, setCustomerOrderWaiting,
} from '@/lib/api';
import {
  COURIERS, CUSTOMER_ORDERS_KEY, CUSTOMER_STATES, CUSTOMER_STATE_ORDER,
  courierShort, orderedAt, worstCustomerState,
} from '@/lib/orderStatusUi';
import { useApiQuery } from '@/lib/useApiQuery';

// Stable "nothing loaded yet" identity so the derived memos below aren't invalidated on every render.
const NO_LINES: CustomerOrderLine[] = [];

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
  const [filter, setFilter] = useState<CustomerOrderState | 'all'>('all');
  const [term, setTerm] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

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

  const counts = useMemo(() => {
    const byState: Record<string, number> = {};
    for (const l of lines) byState[l.state] = (byState[l.state] || 0) + 1;
    return byState;
  }, [lines]);

  // Search spans everything you'd have in your hand when looking an order up: the order number off a picking note, the customer's
  // name off an email, a postcode off a label, or the SKU. Case-insensitive substring, no term parsing — this is a find box, not a
  // query language (contrast the Inventory/Sales modules, where stepwise Contains filters earn their complexity).
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    return lines.filter((l) => {
      if (filter !== 'all' && l.state !== filter) return false;
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
      {/* --- filter chips + find box ------------------------------------------------------------------------------------------ */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip label="All" count={lines.length} active={filter === 'all'} onClick={() => setFilter('all')} />
        {CUSTOMER_STATE_ORDER.map((s) => (
          counts[s] ? (
            <Chip
              key={s}
              label={CUSTOMER_STATES[s].label}
              count={counts[s]}
              active={filter === s}
              stripe={CUSTOMER_STATES[s].stripe}
              onClick={() => setFilter(filter === s ? 'all' : s)}
            />
          ) : null
        ))}

        <div className="relative ml-auto">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Order, customer, postcode, SKU…"
            className="w-64 rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
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

      {truncated && (
        <div className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing the first {lines.length} lines — there are more. Narrow it down with the search box.
        </div>
      )}

      {/* --- the grid ---------------------------------------------------------------------------------------------------------- */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
                  one of the six states, so the status pill already says it and a mostly-empty integer column said it twice. */}
              <th className="px-2 py-2 font-medium">Ordered</th>
              <th className="px-2 py-2 font-medium">Courier</th>
              <th className="px-2 py-2 font-medium">Status</th>
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
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className={'rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ' + s.pill}>{s.label}</span>
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

function Chip({ label, count, active, stripe, onClick }: {
  label: string; count: number; active: boolean; stripe?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ' +
        (active ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
      }
    >
      {stripe && <span className={'h-2 w-2 rounded-full ' + stripe} />}
      {label}
      <span className={active ? 'text-white/70' : 'text-slate-400'}>{count}</span>
    </button>
  );
}

/*
 * OrderActionBar — everything you can do to the selected order, in the strip above the grid.
 *
 * Note first and widest: it's the feature the legacy top bar existed for, and the one used most. The two destructive/irreversible
 * actions (FBA, Delete) sit apart on the right behind a confirm step, because both are one click from a consequence that this screen
 * cannot undo.
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

  if (noteFor !== (order?.ordernum ?? null)) {
    setNoteFor(order?.ordernum ?? null);
    setNote(order?.note ?? '');
    // Clear any half-answered confirm too. Without this, arming "Delete?" on one order and then clicking a different row would
    // leave the confirm showing against the new selection — one more click and the wrong order is gone.
    setConfirm(null);
  }

  const idle = order === null;
  // Disabled whenever there's nothing selected OR a write is in flight, so the two cases never need separate handling below.
  const off = idle || working;
  const multiLine = (order?.lines.length ?? 0) > 1;
  const noteChanged = !idle && note.trim() !== order.note.trim();

  return (
    <div className={'mb-3 rounded-lg border p-3 transition-colors ' +
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

        {/* --- waiting -------------------------------------------------------------------------------------------------------- */}
        <button
          type="button"
          disabled={off}
          onClick={() => onWaiting(!order?.waiting)}
          className={
            'rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ' +
            (order?.waiting
              ? 'border-amber-300 bg-amber-100 text-amber-900'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
          }
        >
          {order?.waiting ? 'Waiting ✓' : 'Waiting'}
        </button>

        {/* --- courier -------------------------------------------------------------------------------------------------------- */}
        <div>
          <label htmlFor="cust-courier" className="mb-1 block text-xs font-medium text-slate-500">Courier</label>
          <select
            id="cust-courier"
            value={COURIERS.some((c) => c.code === order?.courier) ? (order!.courier as string) : ''}
            disabled={off}
            onChange={(e) => e.target.value && onCourier(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-100 disabled:opacity-60"
          >
            {/* Present only when the stored code isn't one we offer — so an unexpected value is visible rather than silently
                re-labelled as something we do offer. Also covers the nothing-selected state. */}
            {!COURIERS.some((c) => c.code === order?.courier) && (
              <option value="">{order?.courier ? `Other (${order.courier})` : idle ? '—' : 'Not set'}</option>
            )}
            {COURIERS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>

        {/* --- the two that bite ---------------------------------------------------------------------------------------------- */}
        <div className="ml-auto flex items-end gap-2">
          {confirm === 'fba' && order ? (
            <ConfirmBox
              // Spelled out because the sync can never re-source the line afterwards and this screen has no undo for it.
              message="Send from FBA? This can't be undone here."
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

          {confirm === 'delete' && order ? (
            <ConfirmBox
              // The only place the line count still appears, now that the header doesn't repeat it — and the one place it matters,
              // because deleting is per-order and a multi-line order takes its siblings with it.
              message={order.lines.length === 1
                ? 'Delete this order? Shopify will re-add it on the next sync.'
                : `Delete all ${order.lines.length} lines? Shopify will re-add them on the next sync.`}
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
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-red-700">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

// Inline confirm rather than window.confirm: a native modal blocks the whole tab and reads as a browser error, and this one needs to
// state a consequence the operator may not know.
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
