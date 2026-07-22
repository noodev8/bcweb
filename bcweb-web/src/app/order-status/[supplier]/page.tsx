'use client';
/*
=======================================================================================================================================
Page: /order-status/[supplier]  (Stage 1 — one supplier, both halves of the lifecycle)
=======================================================================================================================================
Purpose: Everything for one supplier, behind the module's TO PLACE | ON ORDER switch — the two opposite jobs the Order Status module
         exists for. The switch is repeated here (not just on the module home) so you can flip between "what am I buying" and "what am
         I chasing" for the same supplier without going back a screen.

  TO PLACE — the order-build sheet (PlaceOrderSheet): tune quantities, export the CSV, stamp it as ordered.
  ON ORDER — the original batch view. Each card is one PLACEMENT: every orderstatus row that went to the supplier on the same day
             (see routes/order-status-list.js for why the key is the orderdate stamp rather than createddate or ponumber). Shows the
             arrived/waiting split and age up front so a stuck batch is obvious; expand a card to see the style/size breakdown.
             Operators tick a whole batch (or individual lines within it) to switch order type or archive — e.g. select a whole dead
             batch and archive it in one go, rather than a separate age-based sweep (owner: "feels risky, I can do that by selecting
             the batch above it").

Both stages load together on mount. They're small queries and the switch is used constantly — refetching on every flip would make the
control feel heavier than the decision it represents.
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import OrderStageSwitch, { OrderStage } from '@/components/OrderStageSwitch';
import PlaceOrderSheet from '@/components/PlaceOrderSheet';
import { ageClass } from '@/lib/orderStatusUi';
import {
  getOrderStatusList, getOrderToPlace, switchOrderType, archiveOrderStatus, adjustOrderStatusQty,
  OrderStatusBatch, OrderStatusLine, OrderToPlaceRow, OrderToPlaceTotals,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

function batchKey(b: OrderStatusBatch): string { return `${b.ordertype}|${b.placeddate}`; }
function typeLabel(t: 2 | 3): string { return t === 3 ? 'Amazon' : 'Local'; }
function typeChipClass(t: 2 | 3): string {
  return t === 3 ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-sky-50 text-sky-700 border-sky-200';
}
// Batches are grouped by (ordertype, placed date) — a supplier with both Amazon and Local orders gets two separate cards, each with
// its own single type badge; the two never merge into one row with two badges.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtOrderedDate(iso: string | null): string {
  if (!iso) return 'date unknown';
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]}`;
}

// useSearchParams must sit inside a Suspense boundary for Next's build (App Router). Thin wrapper does that.
export default function OrderStatusSupplierPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SupplierContent />
    </Suspense>
  );
}

function SupplierContent() {
  const params = useParams<{ supplier: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supplier = decodeURIComponent(params.supplier);
  const { logout } = useAuth();

  const [stage, setStage] = useState<OrderStage>(searchParams.get('stage') === 'order' ? 'order' : 'place');

  const [batches, setBatches] = useState<OrderStatusBatch[] | null>(null);
  const [toPlace, setToPlace] = useState<{ rows: OrderToPlaceRow[]; totals: OrderToPlaceTotals } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set()); // ordernums
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<string | null>(null);
  const [adjustingCode, setAdjustingCode] = useState<string | null>(null); // code currently mid +/-, so only that row's buttons disable

  // Only shows the full-page "Loading…" state on the very first fetch (batches === null). Refetches after an action (switch/archive/
  // adjust/place) update the data in place instead — the list staying on screen throughout is what stops the "keeps flipping" flash the
  // owner flagged; the table simply updates once the new numbers land.
  // Both stages refetch together: placing an order MOVES units from one to the other, so refreshing only the stage you're on would
  // leave the other showing figures that are already wrong.
  const load = useCallback(async () => {
    setError(null);
    const [listRes, placeRes] = await Promise.all([getOrderStatusList(supplier), getOrderToPlace(supplier)]);
    if (listRes.return_code === 'UNAUTHORIZED' || placeRes.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (listRes.success && listRes.data) setBatches(listRes.data); else setError(listRes.error || 'Failed to load orders');
    if (placeRes.success && placeRes.data) setToPlace(placeRes.data);
    setLoading(false);
  }, [supplier, logout]);

  useEffect(() => { load(); }, [load]);

  function pickStage(next: OrderStage) {
    setStage(next);
    router.replace(`/order-status/${encodeURIComponent(supplier)}?stage=${next}`, { scroll: false });
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleLineGroup(ordernums: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      ordernums.forEach((o) => { if (checked) next.add(o); else next.delete(o); });
      return next;
    });
  }
  function toggleBatch(b: OrderStatusBatch, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      b.lines.forEach((l) => { if (checked) next.add(l.ordernum); else next.delete(l.ordernum); });
      return next;
    });
  }

  async function doSwitchType(newType: 2 | 3) {
    if (selected.size === 0) return;
    setBusy(true); setActionError(null); setResultSummary(null);
    const res = await switchOrderType(Array.from(selected), newType);
    setBusy(false);
    if (res.success && res.data) {
      setResultSummary(`Switched ${res.data.updated} to ${typeLabel(newType)}`);
      setSelected(new Set());
      await load();
    } else if (res.return_code === 'UNAUTHORIZED') { logout(); }
    else setActionError(res.error || 'Failed to switch order type');
  }

  async function doArchive() {
    if (selected.size === 0) return;
    setBusy(true); setActionError(null); setResultSummary(null);
    const res = await archiveOrderStatus(Array.from(selected));
    setBusy(false);
    if (res.success && res.data) {
      setResultSummary(`Archived ${res.data.archived}`);
      setSelected(new Set());
      await load();
    } else if (res.return_code === 'UNAUTHORIZED') { logout(); }
    else setActionError(res.error || 'Failed to archive');
  }

  // +/- the unit count for one SKU/size group (owner: "a way to Add/Remove from the count"). Keyed by `code` so only the row being
  // adjusted disables, not the whole page. Ticked units are dropped from the selection if a remove happened to consume one of them.
  async function doAdjustQty(code: string, ordernums: string[], delta: number) {
    setAdjustingCode(code); setActionError(null); setResultSummary(null);
    const res = await adjustOrderStatusQty(ordernums, delta);
    setAdjustingCode(null);
    if (res.success && res.data) {
      await load();
    } else if (res.return_code === 'UNAUTHORIZED') { logout(); }
    else setActionError(res.error || 'Failed to adjust quantity');
  }

  const onOrderUnits = batches ? batches.reduce((n, b) => n + b.waiting, 0) : null;
  const isEmpty = !loading && !error && batches !== null && batches.length === 0;

  return (
    <AppShell title={supplier} backHref={`/order-status?stage=${stage}`} backLabel="Suppliers">
      <OrderStageSwitch
        stage={stage}
        onChange={pickStage}
        toPlaceUnits={toPlace ? toPlace.totals.units : null}
        toPlaceCost={toPlace ? toPlace.totals.cost : null}
        onOrderUnits={onOrderUnits}
      />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* ---------------------------------------------------------------- TO PLACE ---------------------------------------------- */}
      {!loading && stage === 'place' && toPlace && (
        <PlaceOrderSheet
          supplier={supplier}
          rows={toPlace.rows}
          totals={toPlace.totals}
          onChanged={load}
          onUnauthorized={logout}
        />
      )}

      {/* ---------------------------------------------------------------- ON ORDER ---------------------------------------------- */}
      {!loading && stage === 'order' && isEmpty && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Nothing on order with {supplier} right now.
        </div>
      )}

      {!loading && !error && stage === 'order' && batches && batches.length > 0 && (
        <>
          {/* Selection action bar — always in place (owner: the appear/disappear "felt awkward") so the layout never jumps; the
              buttons themselves disable to 0 selected instead of the whole bar vanishing. */}
          <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <span className="text-sm font-medium text-slate-700">
              {selected.size > 0 ? `${selected.size} selected` : 'Tick rows to switch type or archive'}
            </span>
            <button disabled={busy || selected.size === 0} onClick={() => doSwitchType(3)} className="rounded border border-orange-300 bg-white px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-40">
              Set: Amazon
            </button>
            <button disabled={busy || selected.size === 0} onClick={() => doSwitchType(2)} className="rounded border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40">
              Set: Local
            </button>
            <button disabled={busy || selected.size === 0} onClick={doArchive} className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40">
              Archive selected
            </button>
            <button disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())} className="ml-auto text-xs text-slate-400 hover:text-slate-600 disabled:opacity-40">
              Clear selection
            </button>
          </div>

          {(actionError || resultSummary) && (
            <div className={'mb-4 rounded-md px-3 py-2 text-sm ' + (actionError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
              {actionError || resultSummary}
            </div>
          )}

          <div className="space-y-3">
            {batches.map((b) => {
              const key = batchKey(b);
              const isOpen = expanded.has(key);
              const allChecked = b.lines.length > 0 && b.lines.every((l) => selected.has(l.ordernum));
              return (
                <div key={key} className="rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => toggleBatch(b, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                      aria-label="Select whole batch"
                    />
                    <button onClick={() => toggleExpand(key)} className="flex flex-1 items-center gap-3 text-left">
                      {isOpen ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
                      <span className={'rounded border px-2 py-0.5 text-xs font-medium ' + typeChipClass(b.ordertype)}>{typeLabel(b.ordertype)}</span>
                      {/* Lead with "how long have I been waiting" (owner's first instinct) — bigger and bolder than the date. The
                          placed date is secondary context ("when did I order it"), so it's smaller and muted, right after. The time
                          of day is what tells two same-day placements apart. */}
                      <span className={'rounded px-2 py-1 text-sm font-semibold ' + ageClass(b.days ?? 0)}>{b.days ?? '—'}d</span>
                      <span className="text-xs text-slate-400">
                        placed {fmtOrderedDate(b.placeddate)}{b.placedtime ? ` ${b.placedtime}` : ''}
                      </span>
                      {/* The reference to quote when chasing. Ours read BC-YYYYMMDD-NNN; legacy ones are the supplier's 6-digit number. */}
                      {b.ponumbers.length > 0 && (
                        <span className="font-mono text-xs text-slate-400">{b.ponumbers.join(', ')}</span>
                      )}
                    </button>
                    {/* Arrived dropped from the header — waiting is the number the operator actually acts on (switch/archive/±).
                        Total kept, small, so expanding a card is never a surprise on size. Arrived-vs-waiting per SKU is still
                        visible on expand, in the LinesTable status column. */}
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm font-medium text-slate-700">{b.waiting} waiting</span>
                      <span className="text-xs text-slate-400">/ {b.total} total</span>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-slate-100 px-4 py-2">
                      <LinesTable lines={b.lines} selected={selected} onToggle={toggleLineGroup} onAdjust={doAdjustQty} adjustingCode={adjustingCode} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </AppShell>
  );
}

// One row per SKU/size (code), collapsing the underlying one-row-per-unit orderstatus duplicates (CLAUDE.md: qty is always 1,
// duplicated lines) into a total the operator can read at a glance — "5 waiting" not five identical rows. Ticking a row selects
// every unit behind it; +/- adds or removes units in place ("-" takes waiting units first, then falls back to arrived ones once
// waiting runs out, so it walks the row down to zero regardless of arrival status).
interface CodeGroup {
  code: string; groupid: string | null; title: string | null; size: string;
  qty: number; arrivedCount: number; waitingCount: number; ordernums: string[];
}

function LinesTable({ lines, selected, onToggle, onAdjust, adjustingCode }: {
  lines: OrderStatusLine[]; selected: Set<string>; onToggle: (ordernums: string[], checked: boolean) => void;
  onAdjust: (code: string, ordernums: string[], delta: number) => void; adjustingCode: string | null;
}) {
  const groups = new Map<string, CodeGroup>();
  for (const l of lines) {
    if (!groups.has(l.code)) {
      groups.set(l.code, { code: l.code, groupid: l.groupid, title: l.title, size: l.size, qty: 0, arrivedCount: 0, waitingCount: 0, ordernums: [] });
    }
    const g = groups.get(l.code)!;
    g.qty += 1;
    if (l.arrived) g.arrivedCount += 1; else g.waitingCount += 1;
    g.ordernums.push(l.ordernum);
  }
  // Preserve title on the first row of a run of the same product (matches the earlier per-unit layout's grouping-by-eye).
  let lastGroupid: string | null = null;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
        <tr>
          <th className="w-10 py-1"></th>
          <th className="py-1 font-medium">Product</th>
          <th className="py-1 font-medium">Size</th>
          <th className="py-1 font-medium">Code</th>
          <th className="py-1 text-right font-medium">Qty</th>
          <th className="py-1 text-right font-medium">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {Array.from(groups.values()).map((g) => {
          const showTitle = g.groupid !== lastGroupid;
          lastGroupid = g.groupid;
          const allSelected = g.ordernums.every((o) => selected.has(o));
          const someSelected = !allSelected && g.ordernums.some((o) => selected.has(o));
          return (
            <tr key={g.code}>
              <td className="py-1">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={() => onToggle(g.ordernums, !allSelected)}
                  className="h-4 w-4 rounded border-slate-300"
                  aria-label="Select all units of this SKU"
                />
              </td>
              <td className="py-1 text-slate-700">
                {showTitle ? (g.title || <span className="text-slate-400">{g.groupid}</span>) : ''}
              </td>
              <td className="py-1 text-slate-600">{g.size}</td>
              <td className="py-1 font-mono text-xs text-slate-500">{g.code}</td>
              <td className="py-1 text-right">
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={adjustingCode === g.code}
                    onClick={() => onAdjust(g.code, g.ordernums, -1)}
                    title={g.waitingCount > 0 ? 'Remove one waiting unit' : 'Remove one arrived unit (archives it)'}
                    className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-5 text-center font-medium text-slate-700">{g.qty}</span>
                  <button
                    type="button"
                    disabled={adjustingCode === g.code}
                    onClick={() => onAdjust(g.code, g.ordernums, 1)}
                    title="Add one unit to this order"
                    className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </td>
              <td className="py-1 text-right">
                {g.waitingCount === 0
                  ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">{g.arrivedCount} arrived</span>
                  : g.arrivedCount === 0
                    ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">{g.waitingCount} waiting</span>
                    : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">{g.arrivedCount} arrived · {g.waitingCount} waiting</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
