'use client';
/*
=======================================================================================================================================
Component: LocationsBoard
=======================================================================================================================================
Purpose: The whole Locations screen. Pick a rack, see everything on it, put stock on it, take stock off it.

THE ONE THING THAT MAKES THIS SCREEN DIFFERENT: the shelf is the subject. Everywhere else on the platform the operator arrives with a
style in hand and the location is a detail on the end of the row (see InvLocations, which is deliberately ONE SIZE of one style). Here
they arrive with a rack in front of them and the stock is the unknown. So the rack list is permanent furniture down the left and the
contents fill the page — not a location column you filter.

TWO HANDS OR ONE, BOTH WORK. A rack is chosen by clicking it, or by scanning its printed label ('LC-58') into the search box, which
selects it and clears itself. That is the same trick Goods In plays with rack scans and for the same reason: the job happens standing
at the shelving with a gun, and anything that needs a mouse means putting the gun down. It is NOT a full scan station though — Goods
In owns that pattern, where every scan is a booked unit and an error stops the line. This screen is worked both ways: at the bench
during a stock check, and at the desk when someone asks what is on C1-04.

EVERY RACK IS LISTED, INCLUDING THE EMPTY ONES, and that is load-bearing rather than tidy. An empty shelf is precisely where a box
gets put, and it is the case the Inventory picker gets wrong today by deriving its list from localstock (utils/locations.js spells
this out: 17 of C1's 22 racks were invisible). The count badge is what separates them, not their absence.

ADD AND REMOVE ARE NOT SYMMETRICAL, so they don't look alike. Removing is a correction to a line that is already on screen — one
click on the minus beside it. Adding is a new fact the screen doesn't know yet and needs a code, so it is a form at the foot of the
list. Making both into a single "adjust" control would have cost the removes their one click.

NOTHING HERE IS WRITTEN YET (owner, 2026-09-10 — UI first). Edits are held in component state against placeholder racks from
src/lib/locationsUi.ts, and the banner says so in as many words, because a stock screen that silently keeps a change to itself is the
worst thing this could be mistaken for. The write contract is the shape the handlers already take: (location, code, delta, ids).
=======================================================================================================================================
*/

import { useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, MinusSmallIcon, PlusSmallIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  AREA_LABEL, AREA_ORDER, SAMPLE_RACKS, STATE_BADGE, areaOf,
  type Rack, type RackLine,
} from '@/lib/locationsUi';

type LoadedRack = Rack & { lines: RackLine[] };

// A rack label as printed on the shelving. Typed or scanned into the search box it jumps straight to that rack rather than filtering
// to it — a scan is a statement about where you are standing, not a query.
const RACK_LABEL = /^LC-\d+$/i;

export default function LocationsBoard() {
  // The racks and their contents. Placeholder for now; this is the state the two routes will fill.
  const [racks, setRacks] = useState<LoadedRack[]>(() => SAMPLE_RACKS.map((r) => ({ ...r })));
  const [area, setArea] = useState<string>('C3-Front');
  const [selected, setSelected] = useState<string>('C3-Front-01');
  const [find, setFind] = useState('');
  const findRef = useRef<HTMLInputElement>(null);

  const rack = racks.find((r) => r.location === selected) ?? null;

  // The left-hand list. Filtered by area, then by whatever is typed — matched against both the rack name and its printed barcode, so
  // a half-remembered label finds the shelf too.
  const listed = useMemo(() => {
    const q = find.trim().toLowerCase();
    return racks
      .filter((r) => areaOf(r.location) === area)
      .filter((r) => !q || r.location.toLowerCase().includes(q) || (r.barcode ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.pickorder ?? 1e9) - (b.pickorder ?? 1e9) || a.location.localeCompare(b.location));
  }, [racks, area, find]);

  // Areas that actually exist in the data, in the warehouse's own order. Derived rather than hard-coded so a new prefix can't go
  // missing from the tabs and take its racks with it.
  const areas = useMemo(() => {
    const present = new Set(racks.map((r) => areaOf(r.location)));
    return [...AREA_ORDER].filter((a) => present.has(a));
  }, [racks]);

  // Jump to a rack: switch the area tab under it too, or a search would land the operator on a list their rack isn't in.
  function goToRack(location: string) {
    setSelected(location);
    setArea(areaOf(location));
  }

  // A rack label typed or scanned into the search box selects that shelf and clears the box, ready for the next one.
  function onFindKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setFind(''); return; }
    if (e.key !== 'Enter') return;
    const typed = find.trim();
    if (!typed) return;
    const hit = RACK_LABEL.test(typed)
      ? racks.find((r) => (r.barcode ?? '').toLowerCase() === typed.toLowerCase())
      : racks.find((r) => r.location.toLowerCase() === typed.toLowerCase()) ?? listed[0];
    if (hit) { goToRack(hit.location); setFind(''); }
  }

  // ---- The edits. Both take the shape the write route will: which rack, which code, which underlying rows, and by how much. ----

  function adjust(location: string, key: string, delta: number) {
    setRacks((prev) => prev.map((r) => {
      if (r.location !== location) return r;
      const lines = r.lines
        .map((l) => (l.key === key
          ? { ...l, qty: l.qty + delta, ids: delta < 0 ? l.ids.slice(0, -1) : [...l.ids, `NEW-${l.ids.length}`] }
          : l))
        .filter((l) => l.qty > 0);   // a line that hits zero leaves the rack — it is no longer stock in a place
      return { ...r, lines, units: lines.reduce((n, l) => n + l.qty, 0) };
    }));
  }

  function addStock(location: string, code: string, qty: number) {
    const clean = code.trim().toUpperCase();
    if (!clean || qty < 1) return;
    setRacks((prev) => prev.map((r) => {
      if (r.location !== location) return r;
      const existing = r.lines.find((l) => l.code === clean && l.state === 'FREE');
      const lines = existing
        ? r.lines.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l))
        : [...r.lines, {
            key: `new-${clean}-${Date.now()}`,
            code: clean,
            // The title is the server's to fill in — a code is resolved against skumap, never guessed here.
            title: 'Resolved on save',
            size: clean.slice(-2),
            qty,
            state: 'FREE' as const,
            ids: [],
          }];
      return { ...r, lines, units: lines.reduce((n, l) => n + l.qty, 0) };
    }));
  }

  return (
    <div className="space-y-4">
      {/* The banner is not decoration — see the header. It goes at the top and stays put until the writes land. */}
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
        <span className="font-semibold">Nothing here is saved yet.</span>{' '}
        The racks are sample data and every add or remove is held on screen only — reload and it is gone.
      </div>

      <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        {/* ---- The racks. Permanent furniture: this is the screen's subject, so it never collapses into a dropdown. ---- */}
        <aside className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-3">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                ref={findRef}
                value={find}
                onChange={(e) => setFind(e.target.value)}
                onKeyDown={onFindKey}
                placeholder="Find a rack, or scan its label"
                className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-7 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              {find && (
                <button
                  type="button"
                  onClick={() => { setFind(''); findRef.current?.focus(); }}
                  className="absolute right-1.5 top-1.5 rounded p-1 text-slate-400 hover:text-slate-600"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Areas as chips rather than a second list: there are five or six and they are how the warehouse is spoken about. */}
            <div className="mt-2.5 flex flex-wrap gap-1">
              {areas.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setArea(a)}
                  className={
                    'rounded-full px-2.5 py-1 text-xs font-medium transition ' +
                    (a === area ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
                  }
                >
                  {AREA_LABEL[a] ?? a}
                </button>
              ))}
            </div>
          </div>

          {/* Walked in pickorder, which is the order the racks stand in — so scrolling this list is walking the aisle. */}
          <ul className="max-h-[32rem] overflow-y-auto py-1">
            {listed.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-400">No rack matches that.</li>
            )}
            {listed.map((r) => {
              const on = r.location === selected;
              return (
                <li key={r.location}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.location)}
                    className={
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition ' +
                      (on ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700 hover:bg-slate-50')
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{r.location}</span>
                    {r.barcode && <span className="shrink-0 text-xs text-slate-400">{r.barcode}</span>}
                    {/* An empty rack is greyed, not hidden — it is where the next box goes. */}
                    <span
                      className={
                        'w-8 shrink-0 rounded px-1 py-0.5 text-center text-xs font-medium tabular-nums ' +
                        (r.units ? 'bg-slate-100 text-slate-700' : 'bg-transparent text-slate-300')
                      }
                    >
                      {r.units}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ---- What is on the chosen rack. ---- */}
        <section className="rounded-xl border border-slate-200 bg-white">
          {!rack ? (
            <div className="p-10 text-center text-sm text-slate-400">Pick a rack on the left.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{rack.location}</h2>
                  <p className="text-xs text-slate-400">
                    {AREA_LABEL[areaOf(rack.location)] ?? areaOf(rack.location)}
                    {rack.barcode && <> · label {rack.barcode}</>}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-semibold tabular-nums text-slate-900">{rack.units}</div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">{rack.units === 1 ? 'unit' : 'units'}</div>
                </div>
              </div>

              {rack.lines.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-400">
                  This rack is empty. Add stock to it below.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 font-medium">Size</th>
                      <th className="px-3 py-2 text-center font-medium">Qty</th>
                      {/* Unlabelled, like InvLocations: blank means free to take, which is most rows. */}
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rack.lines.map((l) => {
                      const badge = STATE_BADGE[l.state];
                      return (
                        <tr key={l.key} className="hover:bg-slate-50">
                          <td className="px-4 py-1.5">
                            <div className="font-medium text-slate-800">{l.title}</div>
                            <div className="font-mono text-xs text-slate-400">{l.code}</div>
                          </td>
                          <td className="px-3 py-1.5 tabular-nums text-slate-700">{l.size}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => adjust(rack.location, l.key, -1)}
                                title={`Take one ${l.size} off ${rack.location}`}
                                className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <MinusSmallIcon className="h-4 w-4" />
                              </button>
                              <span className="w-6 text-center font-medium tabular-nums text-slate-800">{l.qty}</span>
                              <button
                                type="button"
                                onClick={() => adjust(rack.location, l.key, 1)}
                                title={`Put one more ${l.size} on ${rack.location}`}
                                className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600"
                              >
                                <PlusSmallIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-1.5">
                            {badge && (
                              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${badge.cls}`}>{badge.label}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <AddToRack key={rack.location} location={rack.location} onAdd={addStock} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/*
Put stock on the chosen rack. Its own component, mounted under the rack's key, so the form resets when the rack changes — which is the
behaviour you want at a shelf: what you were about to add to C1-04 should not follow you to C1-05.

ALWAYS OPEN, not behind an "add" link. On a screen whose entire job is moving stock on and off shelves, the add IS the screen — hiding
it costs a click on the most common action to save one row of a panel the operator is already looking at.
*/
function AddToRack({ location, onAdd }: { location: string; onAdd: (location: string, code: string, qty: number) => void }) {
  const [code, setCode] = useState('');
  const [qty, setQty] = useState(1);
  const codeRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onAdd(location, code, qty);
    setCode('');
    setQty(1);
    codeRef.current?.focus();   // the gun fires again straight away
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
      <span className="text-sm text-slate-500">Add to <span className="font-medium text-slate-700">{location}</span></span>
      <input
        ref={codeRef}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Scan a barcode, or type a SKU"
        className="w-64 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <input
        type="number"
        min={1}
        value={qty}
        onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
        className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <button
        type="submit"
        disabled={!code.trim()}
        className="rounded-md bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
      >
        Add
      </button>
    </form>
  );
}
