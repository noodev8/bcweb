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

BARCODE-LESS ROWS are force-excluded and can't be ticked. `skumap.ean` is empty for ~61 live SKUs, and a CSV line with a blank barcode
doesn't fail loudly at the supplier's end — it gets mis-read or silently dropped, which is worse. Better to make the operator fix the
EAN than to send a line nobody can match.

Quantities are editable in place via the existing POST /order-status-adjust-qty (+/- inserts or archives whole units — the same control
the ON ORDER batch view uses), so the order can be tuned here without bouncing to another screen.
=======================================================================================================================================
*/

import { useCallback, useMemo, useState } from 'react';
import { ArrowDownTrayIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import {
  OrderToPlaceRow, OrderToPlaceTotals, adjustOrderStatusQty, placeOrder, unplaceOrder,
} from '@/lib/api';
import { chosenAgeClass, money } from '@/lib/orderStatusUi';
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
  // Selection is by SKU code. Rows without a barcode are never selectable, so they're excluded from the derived sets below rather
  // than tracked here — that way "select all" can't quietly re-add one.
  const sellable = useMemo(() => rows.filter((r) => r.has_barcode), [rows]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  const [adjustingCode, setAdjustingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);

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
  // you're looking at — no second server round-trip that could disagree with the sheet. Columns are the three the supplier needs:
  // barcode, qty, code. The barcode arrives already stripped of its legacy trailing 'B'.
  const downloadCsv = useCallback(() => {
    if (chosen.length === 0) return;
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = chosen.map((r) => [r.barcode, r.qty, r.code].map(esc).join(','));
    const csv = [['barcode', 'qty', 'code'].join(','), ...lines].join('\r\n');
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
  }, [chosen, supplier]);

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

  async function doAdjust(code: string, ordernums: string[], delta: number) {
    setAdjustingCode(code); setError(null);
    const res = await adjustOrderStatusQty(ordernums, delta);
    setAdjustingCode(null);
    if (res.success) { await onChanged(); }
    else if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); }
    else setError(res.error || 'Failed to adjust quantity');
  }

  // Group into styles for display; rows arrive already ordered by title then size, so a simple run-grouping preserves that.
  const styles = useMemo(() => {
    const map = new Map<string, { key: string; title: string | null; groupid: string | null; rows: OrderToPlaceRow[] }>();
    for (const r of rows) {
      const key = r.groupid || r.code;
      if (!map.has(key)) map.set(key, { key, title: r.title, groupid: r.groupid, rows: [] });
      map.get(key)!.rows.push(r);
    }
    return Array.from(map.values());
  }, [rows]);

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

  if (rows.length === 0) {
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
            {totals.nobarcode_units} unit{totals.nobarcode_units === 1 ? '' : 's'} have no barcode on file and can&apos;t be exported —
            add the EAN in Add/Modify, then they&apos;ll join the order.
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
                    const on = r.has_barcode && !excluded.has(r.code);
                    return (
                      <tr key={r.code} className={r.has_barcode ? (on ? '' : 'opacity-45') : 'bg-amber-50/40'}>
                        <td className="py-1 pl-4">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!r.has_barcode}
                            onChange={() => toggle(r.code)}
                            className="h-4 w-4 rounded border-slate-300 disabled:opacity-30"
                            aria-label={`Include ${r.code} in this order`}
                          />
                        </td>
                        <td className="py-1 text-slate-700">{r.uksize || r.size}</td>
                        <td className="py-1">
                          {/* ALWAYS shown, never only-when-mixed. Destination is a decision the operator makes when adding a line
                              and then can't otherwise verify — an absent chip reads as "no answer", not as "Local". */}
                          <DestinationChip amz={r.amz_qty} local={r.local_qty} />
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
                              disabled={adjustingCode === r.code || busy}
                              onClick={() => doAdjust(r.code, r.ordernums, -1)}
                              title="Remove one unit from this order"
                              className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                            >
                              −
                            </button>
                            <span className="w-5 text-center font-medium text-slate-700">{r.qty}</span>
                            <button
                              type="button"
                              disabled={adjustingCode === r.code || busy}
                              onClick={() => doAdjust(r.code, r.ordernums, 1)}
                              title="Add one unit to this order"
                              className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="py-1 text-right text-slate-500">{money(r.unit_cost)}</td>
                        <td className="py-1 pr-4 text-right font-medium text-slate-700">{money(r.line_cost)}</td>
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
      {rows.length > 0 && (
        <p className="mt-4 text-xs text-slate-400">
          Oldest choice{' '}
          <span className={'rounded px-1.5 py-0.5 font-medium ' + chosenAgeClass(Math.max(...rows.map((r) => r.oldest_days)))}>
            {Math.max(...rows.map((r) => r.oldest_days))}d
          </span>{' '}
          ago · CSV columns are barcode, qty, code
        </p>
      )}
    </>
  );
}
