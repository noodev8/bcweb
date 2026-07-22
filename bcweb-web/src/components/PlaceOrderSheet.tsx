'use client';
/*
=======================================================================================================================================
Component: PlaceOrderSheet
=======================================================================================================================================
Purpose: The TO PLACE half of a supplier's Order Status page — the sheet you work an order up on, then actually place. One row per
         SKU (aggregating orderstatus' one-row-per-unit duplicates), grouped under style headings with per-style subtotals, because an
         order is read and checked style by style, not as a flat list of sizes.

WHY TWO BUTTONS. Placing is a three-step act the app can only see two thirds of: download the CSV -> push it into the supplier's system
OUTSIDE this app -> come back and mark it ordered. So "Download CSV" is free and repeatable, and "Mark as ordered" is the deliberate
commit that stamps `orderdate`. Fusing them would stamp the order before anyone knows the supplier accepted it. The Mark button lifts
to solid once you've downloaded — a nudge through the intended order, not a lock (you may have sent yesterday's file by hand).

SELECTION is opt-out, not opt-in: everything starts ticked, because the normal case is "order the lot". Unticking is for the exception —
a size the supplier can't fulfil — and an unticked row simply stays in the queue for next time rather than being deleted.

BARCODE-LESS ROWS are included, ticked by default like everything else, but export with a blank barcode column rather than being
dropped — the point is to not let a style get silently forgotten just because the EAN is missing. The operator sees "no barcode" in
the row and on the CSV line, and orders it with the supplier by hand (phone/email) rather than via barcode lookup.

Quantities are editable in place via the existing POST /order-status-adjust-qty (+/- inserts or archives whole units — the same control
the ON ORDER batch view uses), so the order can be tuned here without bouncing to another screen.

WHOLE-STYLE REMOVAL sits on the style heading ("Remove style"). Checking real availability at this stage often turns up a style the
supplier has NOTHING of, in any size — and the only way to bin it used to be "−" per size, per unit. One click archives every unit
under the heading via POST /order-status-archive. No undo strip (owner): the archive table is the backstop. It IS two-step, though —
removing a style closes the list up and lands the next style's button under a resting cursor, which nearly cost the owner the wrong
style. Arming, not asking, is the fix: a button that arrives under the pointer is un-armed, so one stray click can't remove anything.

A LINE WALKED DOWN TO 0 STAYS ON SCREEN (owner, 2026-07-22: the disappearance "feels jerky"). The last "−" deletes the line's final
orderstatus row, so it drops out of the next fetch and everything below jumps up under the cursor. Instead the row is kept, greyed, at
qty 0 (lib/zeroedLines.ts) — out of the totals, the CSV and the placement, but holding its place — and its "+" restores the archived
units via POST /order-status-restore. It's display-only: the units really are archived, and the ghost is gone on the next page load.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownTrayIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import {
  OrderToPlaceRow, OrderToPlaceTotals, adjustOrderStatusQty, restoreOrderStatus, archiveOrderStatus, placeOrder, unplaceOrder,
} from '@/lib/api';
import { useZeroedLines, spliceZeroed } from '@/lib/zeroedLines';
import { chosenAgeClass, money } from '@/lib/orderStatusUi';
import { csvColumnsFor, OrderCsvColumn } from '@/lib/orderCsvFormat';
import AddOrderLine from '@/components/AddOrderLine';

// Where the units on a line are headed. Amazon and Local get the same colours they carry on the ON ORDER batch cards, so the two
// screens teach one vocabulary. A line can hold both (units chosen separately, then merged into one supplier line), in which case the
// split is spelled out rather than picking a winner.
function DestinationChip({ amz, local }: { amz: number; local: number }) {
  if (amz > 0 && local > 0) {
    return (
      <span className="whitespace-nowrap text-xs text-slate-500">
        <span className="rounded border border-orange-200 bg-orange-50 px-1 py-0.5 text-orange-700">{amz} Amazon</span>
        {' + '}
        <span className="rounded border border-sky-200 bg-sky-50 px-1 py-0.5 text-sky-700">{local} Local</span>
      </span>
    );
  }
  const isAmz = amz > 0;
  return (
    <span className={'whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ' +
      (isAmz ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-sky-200 bg-sky-50 text-sky-700')}>
      {isAmz ? 'Amazon' : 'Local'}
    </span>
  );
}

interface Props {
  supplier: string;
  rows: OrderToPlaceRow[];
  totals: OrderToPlaceTotals;
  onChanged: () => Promise<void> | void;   // refetch after a qty adjust / place / undo
  onUnauthorized: () => void;
}

// What the last successful placement did — drives the confirmation strip and its Undo.
interface Placement { placed: number; ponumber: string; time: string; ordernums: string[]; }

export default function PlaceOrderSheet({ supplier, rows, totals, onChanged, onUnauthorized }: Props) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  // Lines walked down to 0 by "−". They stay on screen at qty 0 instead of vanishing from under the cursor (lib/zeroedLines.ts);
  // `display` is the server list with those ghosts spliced back into the position they held.
  const { zeroed, remember, forget, clear: clearZeroed } = useZeroedLines<OrderToPlaceRow>();
  const display = useMemo(
    () => spliceZeroed(rows, Array.from(zeroed.values()), (r) => r.code),
    [rows, zeroed]
  );
  // Everything real: a ghost has no units and no ordernums, so it must never reach the totals, the CSV or the placement. `qty === 0`
  // is a safe marker — the server groups by COUNT(*), so a genuine line is never 0.
  const sellable = useMemo(() => display.filter((r) => r.qty > 0), [display]);

  const [busy, setBusy] = useState(false);
  const [adjustingCode, setAdjustingCode] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);   // style heading mid-removal, so only that button shows it

  // Which "Remove style" button is armed. Removing a style closes the list up, so the NEXT style's button slides under a cursor that
  // hasn't moved (owner nearly deleted the wrong style this way, 2026-07-22). Arming is the guard, and not mainly because it asks a
  // question: a button that arrives under the pointer is always un-armed, so the stray click can only arm it — and the label it then
  // shows names the style and the units, which is exactly the check the operator needs. Only one can be armed at a time.
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = useCallback(() => {
    if (disarmTimer.current) { clearTimeout(disarmTimer.current); disarmTimer.current = null; }
    setArmedKey(null);
  }, []);

  // Armed state expires by itself: an armed button left sitting there is exactly the trap this is meant to prevent.
  const arm = useCallback((key: string) => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    setArmedKey(key);
    disarmTimer.current = setTimeout(() => { setArmedKey(null); disarmTimer.current = null; }, 4000);
  }, []);

  useEffect(() => () => { if (disarmTimer.current) clearTimeout(disarmTimer.current); }, []);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // The CSV layout this supplier's system will accept (Lunar drops the trailing `code`). Also drives the footer note, so what the
  // screen SAYS the file contains can't drift from what it writes.
  const columns = useMemo(() => csvColumnsFor(supplier), [supplier]);

  const chosen = useMemo(() => sellable.filter((r) => !excluded.has(r.code)), [sellable, excluded]);
  const chosenUnits = chosen.reduce((n, r) => n + r.qty, 0);
  const chosenCost = chosen.reduce((n, r) => n + (r.line_cost || 0), 0);
  const chosenNoCost = chosen.filter((r) => r.unit_cost === null).reduce((n, r) => n + r.qty, 0);

  function toggle(code: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }
  function setAll(on: boolean) {
    setExcluded(on ? new Set() : new Set(sellable.map((r) => r.code)));
  }

  // --- CSV -----------------------------------------------------------------------------------------------------------------
  // Built here from the rows already on screen (same approach as the Analytics sales export), so what downloads is exactly what
  // you're looking at — no second server round-trip that could disagree with the sheet. The COLUMNS depend on the supplier
  // (lib/orderCsvFormat.ts): everyone gets barcode + qty, and only some get our `code` on the end — Lunar's system rejects the file
  // if it's there. The barcode arrives already stripped of its legacy trailing 'B'. Barcode-less rows export with an empty barcode
  // cell rather than being dropped — the line still needs to reach the supplier, just placed by hand instead of scanned.
  const downloadCsv = useCallback(() => {
    if (chosen.length === 0) return;
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cell = (r: OrderToPlaceRow, col: OrderCsvColumn) => (
      col === 'barcode' ? (r.has_barcode ? r.barcode : '') : col === 'qty' ? r.qty : r.code
    );
    const lines = chosen.map((r) => columns.map((c) => esc(cell(r, c))).join(','));
    const csv = [columns.join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    // The PO reference doesn't exist yet (it's minted at Mark as ordered), so the filename falls back to supplier + date.
    a.href = url;
    a.download = `${supplier.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }, [chosen, supplier, columns]);

  // --- the write -----------------------------------------------------------------------------------------------------------
  async function doPlace() {
    if (chosenUnits === 0) return;
    const ordernums = chosen.flatMap((r) => r.ordernums);
    setBusy(true); setError(null);
    const res = await placeOrder(ordernums);
    setBusy(false);
    if (res.success && res.data) {
      setPlacement({ placed: res.data.placed, ponumber: res.data.ponumber, time: res.data.placed_time, ordernums });
      setDownloaded(false);
      setExcluded(new Set());
      clearZeroed();   // the sheet has been placed and emptied — holding a place in a list that no longer exists helps nobody
      await onChanged();
    } else if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); }
    else setError(res.error || 'Failed to place the order');
  }

  async function doUndo() {
    if (!placement) return;
    setBusy(true); setError(null);
    const res = await unplaceOrder(placement.ordernums);
    setBusy(false);
    if (res.success && res.data) {
      setPlacement(null);
      await onChanged();
    } else if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); }
    else setError(res.error || 'Failed to undo the placement');
  }

  // The last "−" deletes the line's final orderstatus row, so it would drop out of the next fetch and the rows below would jump up.
  // Instead we remember it and keep rendering it at 0, holding its place, with the archived ids its "+" can restore.
  async function doAdjust(row: OrderToPlaceRow, delta: number) {
    setAdjustingCode(row.code); setError(null);
    const index = display.findIndex((r) => r.code === row.code);
    const res = await adjustOrderStatusQty(row.ordernums, delta);
    setAdjustingCode(null);
    if (res.success && res.data) {
      // From THIS line's own count, not the response's `qty`: that recount is scoped to the SKU's createddate group, while a TO PLACE
      // row aggregates every createddate — so the two disagree for a SKU chosen on more than one day.
      const nextQty = row.qty + res.data.added - res.data.removed;
      if (nextQty <= 0) {
        remember(row.code, { payload: { ...row, qty: 0, line_cost: 0 }, index: Math.max(index, 0), removed: res.data.removed_ordernums });
      } else {
        forget(row.code);   // back above zero by any route — the real row takes over again
      }
      await onChanged();
    }
    else if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); }
    else setError(res.error || 'Failed to adjust quantity');
  }

  // WHOLE-STYLE REMOVAL. The real reason a style leaves the sheet is "the supplier has none of it, in any size" (owner) — and walking
  // eleven sizes down to zero one "−" at a time is just typing. This archives every unit under the heading in ONE call, through the
  // same /order-status-archive the ON ORDER side uses, so the rows land in orderstatus_archive rather than being destroyed.
  //
  // Deliberately no confirm step and no undo strip (owner: "No need to undo. Not important. Remove the style."). The control is small,
  // sits away from the +/- and the tick, and says what it does; the archive table is the backstop if someone ever needs the rows back.
  async function doRemoveStyle(style: { key: string; title: string | null; rows: OrderToPlaceRow[] }) {
    const ordernums = style.rows.flatMap((r) => r.ordernums);   // ghosts carry none, so they contribute nothing
    if (ordernums.length === 0) return;
    disarm();   // nothing stays armed across the re-render this write causes — that's the whole point of the guard
    setRemovingKey(style.key); setBusy(true); setError(null);
    const res = await archiveOrderStatus(ordernums);
    setBusy(false); setRemovingKey(null);
    if (res.success) {
      // The whole style is leaving the sheet, so nothing here should hold a place at 0, and no stale "unticked" state should survive
      // to surprise the operator if the same SKU is added again later.
      const codes = new Set(style.rows.map((r) => r.code));
      codes.forEach((code) => forget(code));
      setExcluded((prev) => {
        const next = new Set(prev);
        codes.forEach((code) => next.delete(code));
        return next;
      });
      await onChanged();
    }
    else if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); }
    else setError(res.error || 'Failed to remove the style');
  }

  // "+" on a zeroed line. It can't go through adjust-qty: that adds by cloning one of the group's own rows and at 0 there are none
  // left. The units are archived rather than gone, so we move those exact rows back — same batch, same context.
  async function doRestore(row: OrderToPlaceRow) {
    const ghost = zeroed.get(row.code);
    if (!ghost || ghost.removed.length === 0) return;
    setAdjustingCode(row.code); setError(null);
    const res = await restoreOrderStatus(ghost.removed, row.code);
    setAdjustingCode(null);
    if (res.success) { forget(row.code); await onChanged(); }
    else if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); }
    else setError(res.error || 'Failed to bring the line back');
  }

  // Group into styles for display; rows arrive already ordered by title then size, so a simple run-grouping preserves that. Built from
  // `display` (server rows + zeroed ghosts) so a line walked to 0 stays under its own style heading rather than vanishing.
  const styles = useMemo(() => {
    const map = new Map<string, { key: string; title: string | null; groupid: string | null; rows: OrderToPlaceRow[] }>();
    for (const r of display) {
      const key = r.groupid || r.code;
      if (!map.has(key)) map.set(key, { key, title: r.title, groupid: r.groupid, rows: [] });
      map.get(key)!.rows.push(r);
    }
    return Array.from(map.values());
  }, [display]);

  // Just-placed confirmation. Shown INSTEAD of an empty-state when the queue has drained, so the screen answers "did that work?"
  // rather than just going blank.
  const justPlaced = placement && (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
      <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600" />
      <span className="text-sm text-emerald-800">
        Placed <strong>{placement.placed}</strong> unit{placement.placed === 1 ? '' : 's'} with {supplier} at {placement.time} ·
        {' '}reference <strong className="font-mono">{placement.ponumber}</strong>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={doUndo}
        className="ml-auto rounded border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
      >
        Undo
      </button>
    </div>
  );

  // Nothing left to show — but a ghost still counts as something on screen (its "+" is the way back), so this is `display`, not `rows`.
  if (display.length === 0) {
    return (
      <>
        {justPlaced}
        {!placement && (
          <div className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
            Nothing waiting to be ordered from {supplier}. Styles appear here once they&apos;re chosen in the legacy order screen.
          </div>
        )}
        {/* Offered even on an empty queue — a deal on a single style is a perfectly good reason to start an order from nothing. */}
        <AddOrderLine supplier={supplier} onAdded={onChanged} onUnauthorized={onUnauthorized} />
      </>
    );
  }

  const allOn = sellable.length > 0 && excluded.size === 0;

  return (
    <>
      {justPlaced}

      {/* The action bar. Sticky, because the sheet can run long and the totals are what you're checking against as you scroll. */}
      <div className="sticky top-0 z-10 mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={allOn} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            All
          </label>
          {/* Units and money are the two figures that decide whether this order goes today — biggest things in the bar. */}
          <span className="text-sm">
            <strong className="text-slate-800">{chosenUnits}</strong>
            <span className="text-slate-500"> unit{chosenUnits === 1 ? '' : 's'} · {chosen.length} SKU{chosen.length === 1 ? '' : 's'}</span>
          </span>
          <span className="text-lg font-semibold text-slate-900">{money(chosenCost)}</span>
          {chosenNoCost > 0 && (
            <span className="text-xs text-amber-700">+{chosenNoCost} unpriced</span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy || chosenUnits === 0}
              onClick={downloadCsv}
              className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Download CSV
            </button>
            <button
              type="button"
              disabled={busy || chosenUnits === 0}
              onClick={doPlace}
              title="Stamp these units as ordered — do this once the CSV is actually in the supplier's system"
              className={
                'rounded px-3 py-1.5 text-xs font-medium disabled:opacity-40 ' +
                (downloaded
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50')
              }
            >
              {busy ? 'Working…' : `Mark ${chosenUnits} as ordered`}
            </button>
          </div>
        </div>

        {totals.nobarcode_units > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
            <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
            {totals.nobarcode_units} unit{totals.nobarcode_units === 1 ? '' : 's'} have no barcode on file — still included in the CSV
            (blank barcode cell) so nothing gets forgotten, but the operator will need to order these by hand.
          </div>
        )}
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Below the totals bar, above the styles: an addition belongs with the order it joins, and putting it here keeps it out of
          the sticky header where it would compete with the figures you're checking against. */}
      <AddOrderLine supplier={supplier} onAdded={onChanged} onUnauthorized={onUnauthorized} />

      <div className="space-y-3">
        {styles.map((s) => {
          const styleUnits = s.rows.reduce((n, r) => n + r.qty, 0);
          const styleCost = s.rows.reduce((n, r) => n + (r.line_cost || 0), 0);
          return (
            <div key={s.key} className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-baseline gap-3 border-b border-slate-100 px-4 py-2.5">
                <span className="flex-1 truncate text-sm font-medium text-slate-800">
                  {s.title || <span className="text-slate-400">{s.groupid}</span>}
                </span>
                <span className="text-xs text-slate-400">{styleUnits} unit{styleUnits === 1 ? '' : 's'}</span>
                <span className="text-sm font-medium text-slate-600">{money(styleCost)}</span>
                {/* Whole-style removal — for "the supplier has none of it, in any size". Deliberately quiet and set apart from the row
                    controls: it's a different kind of act from a tick (which keeps the line for next time) or a "−" (one unit).
                    Two-step: the first click arms it and states what will go, the second does it. Moving the pointer off disarms, so
                    a button that has just slid under a resting cursor can't stay armed behind your back. */}
                <button
                  type="button"
                  disabled={busy || styleUnits === 0}
                  onClick={() => (armedKey === s.key ? doRemoveStyle(s) : arm(s.key))}
                  onMouseLeave={() => { if (armedKey === s.key) disarm(); }}
                  title={`Remove all ${styleUnits} unit${styleUnits === 1 ? '' : 's'} of this style from the order`}
                  className={
                    'whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium disabled:opacity-40 ' +
                    (armedKey === s.key
                      ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
                      : 'border-slate-200 text-slate-500 hover:border-red-300 hover:bg-red-50 hover:text-red-700')
                  }
                >
                  {removingKey === s.key
                    ? 'Removing…'
                    : armedKey === s.key
                      ? `Remove all ${styleUnits}? Click again`
                      : 'Remove style'}
                </button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="w-10 py-1 pl-4"></th>
                    <th className="py-1 font-medium">Size</th>
                    <th className="py-1 font-medium">For</th>
                    <th className="py-1 font-medium">Code</th>
                    <th className="py-1 font-medium">Barcode</th>
                    <th className="py-1 text-right font-medium">Qty</th>
                    <th className="py-1 text-right font-medium">Cost</th>
                    <th className="py-1 pr-4 text-right font-medium">Line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {s.rows.map((r) => {
                    // A line walked down to 0 by "−". It holds its place instead of vanishing: greyed, unticked, un-tickable (there are
                    // no units to include), and its "+" restores the archived units rather than cloning a row that no longer exists.
                    const zero = r.qty === 0;
                    const on = !zero && !excluded.has(r.code);
                    return (
                      <tr key={r.code} className={(zero ? 'bg-slate-50 text-slate-400' : on ? '' : 'opacity-45') + (r.has_barcode || zero ? '' : ' bg-amber-50/40')}>
                        <td className="py-1 pl-4">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={zero}
                            onChange={() => toggle(r.code)}
                            className="h-4 w-4 rounded border-slate-300 disabled:opacity-40"
                            aria-label={`Include ${r.code} in this order`}
                          />
                        </td>
                        <td className={'py-1 ' + (zero ? 'text-slate-400' : 'text-slate-700')}>{r.uksize || r.size}</td>
                        <td className="py-1">
                          {/* ALWAYS shown, never only-when-mixed. Destination is a decision the operator makes when adding a line
                              and then can't otherwise verify — an absent chip reads as "no answer", not as "Local". A zeroed line has
                              no units to send anywhere, so it says what actually happened to it instead. */}
                          {zero
                            ? <span className="whitespace-nowrap rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-400">removed</span>
                            : <DestinationChip amz={r.amz_qty} local={r.local_qty} />}
                        </td>
                        <td className="py-1 font-mono text-xs text-slate-500">{r.code}</td>
                        <td className="py-1 font-mono text-xs text-slate-500">
                          {r.has_barcode
                            ? r.barcode
                            : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">no barcode</span>}
                        </td>
                        <td className="py-1 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={zero || adjustingCode === r.code || busy}
                              onClick={() => doAdjust(r, -1)}
                              title="Remove one unit from this order"
                              className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                            >
                              −
                            </button>
                            <span className={'w-5 text-center font-medium ' + (zero ? 'text-slate-400' : 'text-slate-700')}>{r.qty}</span>
                            <button
                              type="button"
                              disabled={adjustingCode === r.code || busy}
                              onClick={() => (zero ? doRestore(r) : doAdjust(r, 1))}
                              title={zero ? 'Put this line back' : 'Add one unit to this order'}
                              className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="py-1 text-right text-slate-500">{money(r.unit_cost)}</td>
                        {/* A zeroed line costs nothing — showing £0.00 would read as a real line worth nothing, so it's a dash. */}
                        <td className={'py-1 pr-4 text-right font-medium ' + (zero ? 'text-slate-300' : 'text-slate-700')}>{zero ? '—' : money(r.line_cost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* How long this has been sitting un-ordered. Placed at the foot rather than per-row: it's a property of the queue as a whole
          ("this should have gone out on Monday"), and the per-row ages are almost always identical. */}
      {display.length > 0 && (
        <p className="mt-4 text-xs text-slate-400">
          Oldest choice{' '}
          <span className={'rounded px-1.5 py-0.5 font-medium ' + chosenAgeClass(Math.max(...display.map((r) => r.oldest_days)))}>
            {Math.max(...display.map((r) => r.oldest_days))}d
          </span>{' '}
          ago · CSV columns are {columns.join(', ')}
        </p>
      )}
    </>
  );
}
