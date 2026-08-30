'use client';
/*
=======================================================================================================================================
Component: PickList
=======================================================================================================================================
Purpose: The whole Pick screen below the title — mode switch, find box, the list, and the action bar. One component because the three
         are a single interaction: you scan into the box, the list narrows to one row, you press the button.

SORTED BY LOCATION, AND THAT IS NOT COSMETIC. `location, code` is the order you walk the racks in, and it is the legacy screen's sort
for exactly that reason. So there is no column sorting here: re-sorting this list by code or by order would destroy the one thing it
is for. Rows are grouped under a shelf heading, which is the same information the sort carries, made visible.

ACTIONED ROWS STAY ON THE LIST. Picking writes `localstock.qty` (0 picked / -1 not found / -2 re-stock) and the server deliberately
does not filter them out — if it did, a mis-pick would be unfixable, because the row you need to Unpick would have vanished. They go
grey with a pill instead. The "Outstanding" chip is how you hide them once you're only interested in what's left.

SELECTION IS BY `id`, never by code. Two identical units can sit on the same shelf under the same SKU (there are two right now on
C3-Front-04) and `localstock.id` is the only thing that tells them apart.

THE FIND BOX IS THE POINT OF THE DESKTOP SCREEN. The mobile app does the actual picking, scanner in hand; sitting at the desk you
want to answer "where is this one" and action it without hunting a 9-row list with a mouse. So the box takes a scan (a scanner types
the barcode then presses Enter) or typed text, filters live, and Enter runs the primary action on the filtered set when that set is a
single row. It autofocuses and re-focuses after every action, so a run of scans needs no clicks at all.

  ENTER IS GUARDED TO ONE ROW ON PURPOSE. A scan that matches nothing, or matches two units of the same SKU, does nothing and says
  so — it does not "pick the first one". Picking the wrong physical unit is invisible until the shelf count goes wrong weeks later.

A PARTIAL RESULT IS NORMAL, NOT AN ERROR. The mobile app is picking the same rows and order-sync deletes them when the order ships,
so `updated < requested` just means somebody got there first. It is reported as a note, not a red error, and the list refetches either
way (see the header on pickAction in src/lib/api.ts).
=======================================================================================================================================
*/

import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { ExclamationTriangleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { getPickList, pickAction, type PickMode, type PickRow, type PickList as PickListData } from '@/lib/api';
import { PICK_STATES, actionBar, pickAgeClass, matchesTerm } from '@/lib/pickUi';

export const pickListKey = (mode: PickMode) => ['pick-list', mode] as const;

export default function PickList() {
  const [mode, setMode] = useState<PickMode>('shopify');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, refresh } = useApiQuery<PickListData>(pickListKey(mode), () => getPickList(mode));

  const rows = useMemo(() => data?.rows || [], [data]);
  const visible = useMemo(
    () => rows.filter((r) => matchesTerm(r, term) && (!outstandingOnly || r.qty > 0)),
    [rows, term, outstandingOnly],
  );

  // Switching mode changes which rows exist, so a selection carried across it could only ever be stale — and worse, the server scopes
  // each mode's action to its own rows, so acting on it would update nothing and read as a silent no-op. Cleared in the handler
  // rather than in an effect on `mode`: this is a consequence of the click, not state that needs synchronising after the fact.
  const changeMode = (m: PickMode) => { setMode(m); setSelected(new Set()); setNote(null); setError(null); };

  // A selected row can leave the visible set (the term narrowed, or Outstanding-only came on), and acting on something you can't see
  // is how you pick the wrong shoe. So the selection is INTERSECTED with what's on screen at the point of use rather than trimmed by
  // an effect — same guarantee, no cascading render, and a row that comes back into view keeps its tick.
  const actionable = useMemo(() => {
    const ids = new Set(visible.map((r) => r.id));
    return [...selected].filter((id) => ids.has(id));
  }, [visible, selected]);

  const bar = actionBar(mode);
  const primary = bar.find((a) => a.primary) || bar[0];

  const run = useCallback(async (action: string, ids: string[]) => {
    if (ids.length === 0) return;
    setBusyAction(action);
    setError(null);
    setNote(null);
    const res = await pickAction(mode, action as never, ids);
    setBusyAction(null);
    if (!res.success) {
      setError(res.error || 'Could not action those rows');
      return;
    }
    const { updated, requested } = res.data!;
    if (updated < requested) {
      // Somebody else — the mobile app, or a sync — got to the missing ones first. Worth saying, not worth alarming about.
      setNote(`${updated} of ${requested} updated — the rest had already moved (the mobile app or a sync got there first).`);
    }
    setSelected(new Set());
    setTerm('');
    await refresh();
    findRef.current?.focus();
  }, [mode, refresh]);

  // Enter in the find box: run the primary action, but ONLY when the term has narrowed the list to exactly one row. See the header.
  const onFindKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!term.trim()) return;
    if (visible.length === 1) { void run(primary.action, [visible[0].id]); return; }
    setError(visible.length === 0
      ? `Nothing on this list matches "${term.trim()}"`
      : `${visible.length} rows match "${term.trim()}" — narrow it, or tick the one you mean.`);
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  // Shelf groupings, in the order the query returned them (location, code) — so this is the walk route, not a re-sort.
  const groups = useMemo(() => {
    const out: { location: string; rows: PickRow[] }[] = [];
    for (const r of visible) {
      const last = out[out.length - 1];
      if (last && last.location === r.location) last.rows.push(r);
      else out.push({ location: r.location, rows: [r] });
    }
    return out;
  }, [visible]);

  return (
    <div>
      {/* --- MODE SWITCH. Two jobs, not two views: Shopify picks are customer orders, Amazon rows are free stock being gathered for
          FBA. Counts are OUTSTANDING only and come from the same call for both modes, so the tab you aren't on is never stale. --- */}
      <div className="mb-4 flex gap-2">
        {(['shopify', 'amazon'] as PickMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => changeMode(m)}
            className={
              'flex-1 rounded-lg border px-4 py-2.5 text-left transition ' +
              (mode === m
                ? 'border-slate-400 bg-white shadow-sm ring-1 ring-slate-300'
                : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white')
            }
          >
            <span className="block text-sm font-semibold">
              {m === 'shopify' ? 'Customer picks' : 'Amazon shelf'}
              <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                {m === 'shopify' ? data?.counts.shopify ?? '—' : data?.counts.amazon ?? '—'}
              </span>
            </span>
            <span className="block text-xs text-slate-500">
              {m === 'shopify'
                ? 'Reserved against a customer order — take these off the shelf'
                : 'Flagged for FBA, still on a normal shelf — gather onto C3-Amazon'}
            </span>
          </button>
        ))}
      </div>

      {/* --- PINNED CONTROLS. Same pattern as CustomerOrderList: the find box and the action bar stay put while the list scrolls, so
          a row further down can be actioned without scrolling back. --- */}
      <div className="sticky -top-px z-30 -mx-4 border-b border-slate-200 bg-white px-4 pb-3 pt-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              ref={findRef}
              autoFocus
              value={term}
              onChange={(e) => { setTerm(e.target.value); setError(null); }}
              onKeyDown={onFindKey}
              placeholder={`Scan a barcode, or type a code / order / shelf — Enter to ${primary.label}`}
              className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>

          {/* Only offered when there is something to hide. A chip that says "Outstanding 9 of 9" every day is noise. */}
          {rows.some((r) => r.qty <= 0) && (
            <button
              type="button"
              onClick={() => setOutstandingOnly((v) => !v)}
              className={
                'rounded-full px-3 py-1 text-xs font-medium ring-1 ' +
                (outstandingOnly ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-600 ring-slate-300')
              }
            >
              Outstanding only
            </button>
          )}

          <span className="ml-auto text-xs text-slate-500">
            {actionable.length > 0 ? `${actionable.length} selected` : `${visible.length} of ${rows.length}`}
          </span>
        </div>

        {/* The action bar. Always visible but disabled with nothing selected, rather than sliding in on selection — a bar that
            appears and disappears moves the list under the cursor mid-scan. */}
        <div className="flex flex-wrap gap-2">
          {bar.map((a) => (
            <button
              key={a.action}
              type="button"
              title={a.hint}
              disabled={actionable.length === 0 || busyAction !== null}
              onClick={() => void run(a.action, actionable)}
              className={
                'rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ' +
                (a.primary
                  ? 'bg-slate-800 text-white hover:bg-slate-700'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
              }
            >
              {busyAction === a.action ? 'Working…' : a.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />{error}
        </div>
      )}
      {note && <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">{note}</div>}

      {/* --- THE LIST --- */}
      {isLoading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          {rows.length === 0
            ? mode === 'shopify' ? 'Nothing to pick — every customer order is off the shelf.' : 'Nothing waiting to go to the Amazon shelf.'
            : 'Nothing matches that.'}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="w-1 p-0" aria-label="State" />
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allVisibleSelected}
                    onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.id)))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>
                <th className="px-2 py-2 font-medium">Code</th>
                <th className="px-2 py-2 font-medium">Product</th>
                <th className="px-2 py-2 font-medium">{mode === 'shopify' ? 'Order' : 'FNSKU'}</th>
                {mode === 'shopify' && <th className="px-2 py-2 text-right font-medium">Days</th>}
                <th className="px-2 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                // The shelf heading. `location` is what the sort is FOR, so it gets a row of its own rather than a repeated column —
                // one glance tells you how many racks the run covers.
                <Fragment key={g.location}>
                  <tr className="bg-slate-50">
                    <td className="p-0" />
                    <td colSpan={mode === 'shopify' ? 6 : 5} className="px-2 py-1.5 text-xs font-semibold tracking-wide text-slate-600">
                      {g.location}
                      <span className="ml-2 font-normal text-slate-400">{g.rows.length}</span>
                    </td>
                  </tr>
                  {g.rows.map((r) => {
                    const st = PICK_STATES[r.state];
                    const done = r.qty <= 0;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => toggle(r.id)}
                        className={
                          'cursor-pointer border-b border-slate-100 hover:bg-slate-50 ' +
                          (selected.has(r.id) ? 'bg-slate-100 ' : '') + (done ? 'text-slate-400' : '')
                        }
                      >
                        <td className={'w-1 p-0 ' + st.stripe} />
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.code}`}
                            checked={selected.has(r.id)}
                            onChange={() => toggle(r.id)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-medium">{r.code}</td>
                        <td className="px-2 py-1.5">
                          <span className={done ? '' : 'text-slate-700'}>{r.title || r.groupid}</span>
                          {r.colour && <span className="ml-2 text-xs text-slate-400">{r.colour}</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                          {mode === 'shopify' ? r.ordernum : (r.fnsku || '—')}
                        </td>
                        {mode === 'shopify' && (
                          <td className="px-2 py-1.5 text-right">
                            <span className={'rounded px-1.5 py-0.5 text-xs font-medium ' + pickAgeClass(r.age_days)}>
                              {r.age_days === null ? '—' : r.age_days}
                            </span>
                          </td>
                        )}
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className={'inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' + st.pill}>
                              {st.label}
                            </span>
                            {/* Packed is a stronger, independently-written signal than the pick state (orderstatus.batch = '2') and
                                a line can reach it without ever looking picked here — see utils/customerOrders.js. Shown alongside
                                rather than folded into the state, so neither hides the other. */}
                            {r.packed && (
                              <span className="inline-block rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
                                Packed
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
