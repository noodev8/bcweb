'use client';
/*
=======================================================================================================================================
Component: AddOrderLine
=======================================================================================================================================
Purpose: "Add a line" on a supplier's TO PLACE sheet — for when the supplier offers a deal while the order is being placed and the
         operator wants it on THIS order rather than bouncing back to the legacy PowerBuilder screen, re-adding it there, and coming
         back to a stale sheet (by which point the CSV they already downloaded is wrong).

PICK, NEVER TYPE. The code is chosen from a typeahead over the supplier's own SKUs (GET /order-status-find), never entered free-text.
That's what makes the feature safe rather than risky: a typo'd code, a code that doesn't exist, and another supplier's style are all
impossible to express, so the row can't land in the queue missing the title/barcode/cost that the CSV and the order total depend on.

Collapsed by default. This is an occasional action — a search box sitting permanently open above the sheet would imply the normal way
to build an order is by searching, when the normal way is that the legacy screen already filled the queue.

Barcode-less SKUs are shown but can't be added: they'd be excluded from the CSV anyway (see PlaceOrderSheet), so letting one in would
only produce a line that silently can't be ordered. Better to say why at the point of choosing.
=======================================================================================================================================
*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { OrderFindRow, addOrderLine, findOrderSkus } from '@/lib/api';
import { money } from '@/lib/orderStatusUi';

interface Props {
  supplier: string;
  onAdded: () => Promise<void> | void;   // refetch the sheet
  onUnauthorized: () => void;
}

export default function AddOrderLine({ supplier, onAdded, onUnauthorized }: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<OrderFindRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<OrderFindRow | null>(null);
  const [qty, setQty] = useState(1);
  // Amazon by default, matching the legacy request screen — most added lines are FBA. Local is the deliberate alternative.
  const [ordertype, setOrdertype] = useState<2 | 3>(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search. The 250ms wait keeps a fast typist from firing a query per keystroke; `cancelled` stops an earlier, slower
  // response from overwriting the results of a later one.
  useEffect(() => {
    if (term.trim().length < 2) { setResults(null); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await findOrderSkus(supplier, term.trim());
      if (cancelled) return;
      setSearching(false);
      if (res.success && res.data) setResults(res.data);
      else if (res.return_code === 'UNAUTHORIZED') onUnauthorized();
      else setResults([]);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [term, supplier, onUnauthorized]);

  const reset = useCallback(() => {
    setTerm(''); setResults(null); setPicked(null); setQty(1); setError(null);
  }, []);

  async function doAdd() {
    if (!picked) return;
    setBusy(true); setError(null); setNote(null);
    const res = await addOrderLine(supplier, picked.code, qty, ordertype);
    setBusy(false);
    if (res.success && res.data) {
      setNote(`Added ${res.data.added} × ${picked.code} — now ${res.data.qty} on this order`);
      reset();
      await onAdded();
    } else if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); }
    else setError(res.error || 'Failed to add the line');
  }

  if (!open) {
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={() => { setOpen(true); setNote(null); setTimeout(() => inputRef.current?.focus(), 0); }}
          className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <PlusIcon className="h-4 w-4" />
          Add a line
        </button>
        {note && <p className="mt-2 text-xs text-emerald-700">{note}</p>}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Add a line to this order</span>
        <button
          type="button"
          onClick={() => { setOpen(false); reset(); }}
          className="ml-auto text-slate-400 hover:text-slate-600"
          aria-label="Close"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Picked state replaces the search box entirely — once a SKU is chosen the only remaining decisions are how many and where
          it's going, so the search UI would just be noise to read past. */}
      {picked ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-700">
            {picked.title || picked.groupid}{' '}
            <span className="text-slate-500">· {picked.uksize || picked.size}</span>{' '}
            <span className="font-mono text-xs text-slate-400">{picked.code}</span>
          </span>
          <button type="button" onClick={() => setPicked(null)} className="text-xs text-slate-400 underline hover:text-slate-600">
            change
          </button>

          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Qty
              <input
                type="number"
                min={1}
                max={200}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                className="w-16 rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
              />
            </label>
            {/* Destination is set here rather than on arrival — the whole point of pre-setting it (owner). */}
            <div className="flex overflow-hidden rounded border border-slate-300">
              {([3, 2] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setOrdertype(t)}
                  className={'px-2.5 py-1 text-xs font-medium ' +
                    (ordertype === t ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
                >
                  {t === 3 ? 'Amazon' : 'Local'}
                </button>
              ))}
            </div>
            <span className="text-sm font-medium text-slate-700">
              {picked.cost === null ? '—' : money(picked.cost * qty)}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={doAdd}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={`Search ${supplier} styles or codes…`}
              className="w-full rounded border border-slate-300 py-1.5 pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
            />
          </div>

          {searching && <p className="mt-2 text-xs text-slate-400">Searching…</p>}

          {!searching && results !== null && results.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Nothing matching for {supplier}. Only this supplier&apos;s live styles can be added — if it&apos;s a brand-new product,
              set it up in Add/Modify first.
            </p>
          )}

          {!searching && results !== null && results.length > 0 && (
            <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 bg-white">
              {results.map((r) => (
                <li key={r.code}>
                  <button
                    type="button"
                    disabled={!r.has_barcode}
                    onClick={() => setPicked(r)}
                    className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
                  >
                    <span className="min-w-0 flex-1 truncate text-slate-700">{r.title || r.groupid}</span>
                    <span className="shrink-0 text-slate-500">{r.uksize || r.size}</span>
                    <span className="shrink-0 font-mono text-xs text-slate-400">{r.code}</span>
                    {r.already > 0 && (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{r.already} on order</span>
                    )}
                    {!r.has_barcode && (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">no barcode</span>
                    )}
                    <span className="shrink-0 text-xs text-slate-500">{money(r.cost)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
