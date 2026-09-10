'use client';
/*
=======================================================================================================================================
Component: LocationsBoard
=======================================================================================================================================
Purpose: The whole Locations screen. Pick a rack, read what is on it, put stock on it, take stock off it.

THE ONE THING THAT MAKES THIS SCREEN DIFFERENT: the shelf is the subject. Everywhere else on the platform the operator arrives with a
style in hand and the location is a detail on the end of the row (see InvLocations, which is deliberately ONE SIZE of one style). Here
they arrive with a rack in front of them and the stock is the unknown. So the rack list is permanent furniture down the left and the
contents fill the page — not a location column you filter.

REBUILT 2026-09-10 (owner: "a lot of odd space and scrolling"). The first cut printed one row per localstock line, which is how the
data is stored and NOT how a shelf looks. The numbers say why that failed: the busiest rack, C3-Front-19, holds 96 units as 71
distinct codes — 71 near-identical rows, most of them the same style at a different size, each carrying its own +/- controls and a
title long enough to wrap ("Birkenstock Arizona Two-Strap Birko-Flor Sandals Dark Brown Regular Fit" is 72 characters). Three changes,
each aimed at that:

  1. A RACK IS A SIZE RUN, NOT A LIST OF UNITS. One row per STYLE, with its sizes as chips along the row. C3-Front-19 goes from 71
     rows to 43, a typical rack from ~30 to ~16, and the style name is printed once instead of six times. It is also the vocabulary
     the rest of the platform already speaks — every pricing drill-down shows a size curve — so the shelf reads the way the stock is
     thought about. The chip is the unit of everything here: it carries the size, the count when there is more than one, and its
     takeability as a colour.
  2. ONE ACTION SURFACE. Per-row +/- put six controls on every line and made each row twice as tall for a thing done to one size at a
     time. Instead: click a chip, and the footer becomes that unit's controls. Nothing to look past while reading, one place to look
     while editing, and it is where Move will go when it exists.
  3. THE PAGE DOES NOT SCROLL — the panes do. Both columns are pinned to the viewport, so the rack list and the shelf scroll inside
     themselves and the footer (add a shoe, adjust a chip) never leaves the screen. The old layout scrolled the page AND the rack list
     independently, which is what "odd space" was: a short rack left a tall empty white panel, a long one pushed the add form below
     the fold.

COLOUR IS TAKEABILITY, and it is the only colour on the shelf. A plain chip is free stock; amber is picked for a customer order and
still physically here; sky is allocated to Amazon. Neither exception is greyed out — a picked or Amazon unit is on the shelf in front
of you, and per the order lifecycle an Amazon one can still go to a Shopify customer. Everything else on the panel is slate, so the
three states are the only thing on it that reads as information at a glance.

TWO CALLS, BECAUSE THERE ARE TWO PANELS. GET /locations-racks loads every rack once and the list then sits still; POST
/locations-stock is keyed on the chosen rack, so clicking down the aisle is a small query each time rather than one payload of the
whole warehouse. Both go through useApiQuery — never a fetch in an effect (docs/maintenance-notes.md).

A RACK IS ALSO CHOSEN BY SCANNING IT. Its printed label ('LC-58') typed or scanned into the search box selects that shelf and clears
the box. Same trick as Goods In and for the same reason: the job happens standing at the shelving with a gun, and anything that needs
a mouse means putting the gun down. It is NOT a full scan station though — Goods In owns that pattern, where every scan is a booked
unit and an error stops the line. This screen is worked both ways: at the bench during a stock check, and at the desk when someone
asks what is on C1-04.

EVERY RACK IS LISTED, INCLUDING THE EMPTY ONES (20 of the 72 today), because an empty shelf is precisely where a box gets put — the
case the Inventory picker gets wrong by deriving its list from localstock. A rack marked `known:false` is the opposite: stock sitting
somewhere that is not a shelf at all — today exactly one, 'Ordered', which is a marker meaning the units are still with the supplier.
It is tagged, never hidden.

ONE WRITE IS REAL, THE REST ARE NOT YET, and the screen has to be honest about which is which. POST /locations-empty takes everything
off a rack for good (soft-deleted, so recoverable by hand, but not from here). The per-chip +/- is still held in `edits`, a per-rack
overlay laid over the server's lines at render time, and the chip footer says so where the editing happens rather than in a banner
across the top of a screen that is mostly reading. The overlay is shaped like the write it stands in for — which rack, which code,
which localstock ids, by how much — which is the shape inv-adjust already takes, so wiring it up is a swap rather than a rewrite.
The asymmetry is why Empty rack is the quietest control in the header and the loudest thing on the page once pressed: it is the only
button here that does something that lasts.
=======================================================================================================================================
*/

import { useMemo, useRef, useState } from 'react';
import { ExclamationTriangleIcon, MagnifyingGlassIcon, MinusSmallIcon, PlusSmallIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { emptyLocation, getLocationRacks, getLocationStock, type InvLocationState, type LocationStockLine } from '@/lib/api';
import { AREA_LABEL, AREA_ORDER, areaOf } from '@/lib/locationsUi';

// A rack label as printed on the shelving. Typed or scanned into the search box it jumps straight to that rack rather than filtering
// to it — a scan is a statement about where you are standing, not a query.
const RACK_LABEL = /^LC-\d+$/i;

// The unsaved overlay: per rack, a delta against each existing line's key, plus whole lines added that the server has never seen.
interface RackEdits { deltas: Record<string, number>; added: LocationStockLine[] }
const NO_EDITS: RackEdits = { deltas: {}, added: [] };

// A chip's three states. Free stock is unstyled on purpose: it is most of the shelf, and tinting it would leave nothing for the two
// exceptions to stand out against. Ring rather than fill so a chip stays a chip — the tint says "takeable, with a condition", and a
// filled block would read as a different kind of object.
const CHIP_STATE: Record<InvLocationState, string> = {
  FREE: 'border-slate-200 bg-white text-slate-700 hover:border-slate-400',
  PICKED: 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500',
  AMZ: 'border-sky-300 bg-sky-50 text-sky-800 hover:border-sky-500',
};
const STATE_WORD: Record<InvLocationState, string> = {
  FREE: 'free to take',
  PICKED: 'picked for a customer order',
  AMZ: 'allocated to Amazon',
};

// Sizes are text (RIGHT(code,2)), so they sort numerically or a 40 lands before a 5. Non-numeric sizes go last rather than nowhere.
const sizeRank = (s: string) => (/^\d+$/.test(s) ? Number(s) : 999);

export default function LocationsBoard() {
  const [area, setArea] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [edits, setEdits] = useState<Record<string, RackEdits>>({});
  const [picked, setPicked] = useState<string | null>(null);   // the chip being worked on, by line key
  const [confirmEmpty, setConfirmEmpty] = useState(false);     // the footer is asking whether to clear the whole rack
  const [emptying, setEmptying] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const findRef = useRef<HTMLInputElement>(null);

  // Every rack in the building, in walking order. One call, cached for the session — the list of shelves changes about never, so a
  // revalidate on every rack click would be load on the live DB for a list that is already right.
  const { data: rackData, isLoading: racksLoading, error: racksError, refresh: refreshRacks } = useApiQuery(
    ['locations-racks'],
    () => getLocationRacks(),
    { revalidateIfStale: false, revalidateOnReconnect: false },
  );
  const racks = useMemo(() => rackData?.racks ?? [], [rackData]);

  // Areas present in the data, in the warehouse's own order. Derived rather than hard-coded so a new prefix can't go missing from the
  // tabs and take its racks with it.
  const areas = useMemo(() => {
    const present = new Set(racks.map((r) => areaOf(r.location)));
    return AREA_ORDER.filter((a) => present.has(a));
  }, [racks]);

  // The area falls back to the first one that exists rather than being seeded by an effect, which would fight the operator's own
  // clicks on every refetch. The RACK does not fall back at all — see `selected` below.
  const activeArea = area && areas.includes(area as (typeof AREA_ORDER)[number]) ? area : areas[0] ?? null;

  // The left-hand list. Filtered by area, then by whatever is typed — matched against the rack name and its printed label, so a
  // half-remembered barcode finds the shelf too. Already in pickorder from the route; no re-sort here.
  const listed = useMemo(() => {
    const q = find.trim().toLowerCase();
    return racks
      .filter((r) => areaOf(r.location) === activeArea)
      .filter((r) => !q || r.location.toLowerCase().includes(q) || (r.barcode ?? '').toLowerCase().includes(q));
  }, [racks, activeArea, find]);

  // A RACK IS ONLY EVER SELECTED BECAUSE SOMEONE SELECTED IT (owner, 2026-09-10). This used to fall back to the first rack in the
  // listed area, which made changing area a lie in two directions at once: the panel either kept showing a rack from the area you
  // just left, or silently jumped you onto a shelf you never picked and invited you to edit it. Neither is a thing to do on a screen
  // whose buttons move stock. So the fallback is gone, changing area clears the choice, and the panel asks for one.
  const selected = chosen && racks.some((r) => r.location === chosen) ? chosen : null;
  const rack = racks.find((r) => r.location === selected) ?? null;

  // What is on the chosen rack. Keyed on the rack, so SWR keeps each shelf's contents and stepping back to one just looked at is
  // instant. `null` while nothing is selected = no request at all.
  const { data: stockData, isLoading: stockLoading, error: stockError, refresh: refreshStock } = useApiQuery(
    selected ? ['locations-stock', selected] : null,
    () => getLocationStock(selected as string),
  );

  // ---- The unsaved overlay. Laid over the server's lines at render time; see the header. ----

  const rackEdits = (selected && edits[selected]) || NO_EDITS;

  // Server lines with their deltas applied, then the added ones. A line worked down to zero drops out — it is no longer stock in a
  // place — which is what the write will do to the underlying localstock rows.
  const lines = useMemo(() => {
    const base = (stockData?.lines ?? [])
      .map((l) => ({ ...l, qty: l.qty + (rackEdits.deltas[l.key] ?? 0) }))
      .filter((l) => l.qty > 0);
    return [...base, ...rackEdits.added];
  }, [stockData, rackEdits]);

  // The shelf as it looks: one row per style, its sizes along it. Grouped on groupid (the style), falling back to the code so a
  // localstock row with no groupid still appears as its own row rather than being swept into someone else's.
  const shelf = useMemo(() => {
    const byStyle = new Map<string, { key: string; title: string | null; groupid: string | null; units: number; chips: typeof lines }>();
    for (const l of lines) {
      const k = l.groupid || l.code;
      const hit = byStyle.get(k);
      if (hit) { hit.units += l.qty; hit.chips.push(l); }
      else byStyle.set(k, { key: k, title: l.title, groupid: l.groupid, units: l.qty, chips: [l] });
    }
    for (const s of byStyle.values()) {
      s.chips.sort((a, b) => sizeRank(a.size) - sizeRank(b.size) || a.state.localeCompare(b.state));
    }
    return [...byStyle.values()];
  }, [lines]);

  const units = lines.reduce((n, l) => n + l.qty, 0);
  const pickedLine = lines.find((l) => l.key === picked) ?? null;
  const unsaved = Object.keys(rackEdits.deltas).length > 0 || rackEdits.added.length > 0;

  // WHAT THE RACK ACTUALLY HOLDS, taken from the server's lines and NOT from the overlay above. Emptying is a real write, so the
  // count it warns with and the count it guards on must both be the truth the DB will see — an unsaved +2 held on screen is a
  // fiction, and sending it would get the sweep refused as CHANGED for no reason.
  const serverLines = stockData?.lines ?? [];
  const serverUnits = stockData?.units ?? 0;
  const serverPicked = serverLines.filter((l) => l.state === 'PICKED').reduce((n, l) => n + l.qty, 0);
  const serverAmz = serverLines.filter((l) => l.state === 'AMZ').reduce((n, l) => n + l.qty, 0);

  // Take everything off the rack. The confirm has already happened in the footer; this is the button at the end of it.
  async function doEmpty(location: string) {
    setEmptying(true);
    const res = await emptyLocation(location, serverUnits);
    setEmptying(false);
    if (res.success && res.data) {
      // The overlay for this rack is moot the moment the shelf is cleared — keeping it would re-draw stock that is no longer there.
      setEdits((prev) => { const next = { ...prev }; delete next[location]; return next; });
      setPicked(null);
      setConfirmEmpty(false);
      const { units: took, codes, picked: wasPicked, amz: wasAmz } = res.data;
      const caveat = [wasPicked ? `${wasPicked} picked` : '', wasAmz ? `${wasAmz} Amazon` : ''].filter(Boolean).join(', ');
      setFlash({ ok: true, text: `Took ${took} ${took === 1 ? 'unit' : 'units'} off ${location} across ${codes} ${codes === 1 ? 'size' : 'sizes'}${caveat ? ` — including ${caveat}` : ''}.` });
    } else {
      setFlash({ ok: false, text: res.error || 'Could not empty that rack.' });
      setConfirmEmpty(false);
    }
    // Either way the screen re-reads: on success to show the empty shelf, on a CHANGED refusal because the rack moved under us.
    await Promise.all([refreshStock(), refreshRacks()]);
  }

  // A rack's badge in the left list has to agree with the panel, so it carries that rack's unsaved edits too. Only the chosen rack has
  // a loaded line list, so every other rack is the server's count plus its own pending deltas.
  function unitsOn(location: string, serverUnits: number) {
    if (location === selected) return units;
    const e = edits[location];
    if (!e) return serverUnits;
    const delta = Object.values(e.deltas).reduce((n, d) => n + d, 0) + e.added.reduce((n, l) => n + l.qty, 0);
    return Math.max(0, serverUnits + delta);
  }

  function applyEdit(location: string, fn: (e: RackEdits) => RackEdits) {
    setEdits((prev) => ({ ...prev, [location]: fn(prev[location] ?? NO_EDITS) }));
  }

  function adjust(location: string, line: LocationStockLine, delta: number) {
    applyEdit(location, (e) => {
      // An added line is not on the server, so it is corrected in place rather than carried as a delta against something real.
      if (e.added.some((l) => l.key === line.key)) {
        return { ...e, added: e.added.map((l) => (l.key === line.key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0) };
      }
      return { ...e, deltas: { ...e.deltas, [line.key]: (e.deltas[line.key] ?? 0) + delta } };
    });
  }

  function addStock(location: string, code: string, qty: number) {
    const clean = code.trim().toUpperCase();
    if (!clean || qty < 1) return;
    applyEdit(location, (e) => {
      const hit = e.added.find((l) => l.code === clean);
      if (hit) return { ...e, added: e.added.map((l) => (l === hit ? { ...l, qty: l.qty + qty } : l)) };
      // Anything already on the rack under this code is a server line, so it is topped up as a delta instead of a second line.
      const server = (stockData?.lines ?? []).find((l) => l.code === clean && l.state === 'FREE');
      if (server && location === selected) {
        return { ...e, deltas: { ...e.deltas, [server.key]: (e.deltas[server.key] ?? 0) + qty } };
      }
      return {
        ...e,
        added: [...e.added, {
          key: `new-${clean}-${Date.now()}`,
          code: clean,
          groupid: null,
          // The name is the server's to fill in — a code is resolved against skumap by the write, never guessed here.
          title: null,
          size: clean.slice(-2),
          uksize: null,
          qty,
          state: 'FREE',
          ids: [],
        }],
      };
    });
  }

  // Changing area drops the rack with it — a shelf in C1 is not a thing you are still looking at once you have moved to C3-Front.
  function goToArea(a: string) {
    setArea(a);
    setChosen(null);
    setPicked(null);
    setConfirmEmpty(false);
    setFlash(null);
  }

  function goToRack(location: string) {
    setChosen(location);
    setArea(areaOf(location));
    setPicked(null);        // a chip belongs to the rack it was on
    setConfirmEmpty(false); // ...and so does a half-answered "empty this?"
    setFlash(null);
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

  const emptyRacks = racks.filter((r) => r.units === 0).length;

  return (
    // Pinned to the viewport so the panes scroll and the page does not. The floor stops the whole thing collapsing on a short window;
    // below lg the columns stack and the page scrolls normally, which is the right behaviour on a phone at the shelving.
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-14rem)] lg:min-h-[28rem]">
      {/* Areas across the top rather than inside the rack list: they are how the warehouse is spoken about, they belong to the whole
          screen, and six of them in a 17rem column wrapped to three lines of chips. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {areas.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => goToArea(a)}
            className={
              'rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
              (a === activeArea ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')
            }
          >
            {AREA_LABEL[a] ?? a}
          </button>
        ))}
        {racks.length > 0 && (
          <span className="ml-auto text-xs text-slate-400">{racks.length} racks · {emptyRacks} empty</span>
        )}
      </div>

      {racksError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          Could not load the racks: {racksError.message}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* ---- The racks. Permanent furniture: this is the screen's subject, so it never collapses into a dropdown. ---- */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="relative shrink-0 border-b border-slate-100 p-2">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-4 h-4 w-4 text-slate-400" />
            <input
              ref={findRef}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={onFindKey}
              placeholder="Find a rack, or scan its label"
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-7 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            {find && (
              <button
                type="button"
                onClick={() => { setFind(''); findRef.current?.focus(); }}
                className="absolute right-3 top-3.5 rounded p-1 text-slate-400 hover:text-slate-600"
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Walked in pickorder, which is the order the racks stand in — so scrolling this list is walking the aisle. */}
          <ul className="min-h-0 flex-1 overflow-y-auto py-1 max-lg:max-h-64">
            {racksLoading && <li className="px-3 py-6 text-center text-sm text-slate-400">Loading racks…</li>}
            {!racksLoading && listed.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-400">No rack matches that.</li>
            )}
            {listed.map((r) => {
              const on = r.location === selected;
              const n = unitsOn(r.location, r.units);
              return (
                <li key={r.location}>
                  <button
                    type="button"
                    onClick={() => goToRack(r.location)}
                    className={
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition focus-visible:outline-none focus-visible:bg-slate-100 ' +
                      (on ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700 hover:bg-slate-50')
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{r.location}</span>
                    {/* Not a rack in the `location` table — stock is sitting somewhere that isn't a shelf. Flagged, never hidden. */}
                    {!r.known && <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700">stray</span>}
                    {/* An empty rack keeps its number, greyed — it is not missing, it is where the next box goes. */}
                    <span className={'w-7 shrink-0 text-right tabular-nums ' + (n ? 'text-slate-600' : 'text-slate-300')}>{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ---- The shelf itself. ---- */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          {!rack ? (
            <div className="flex flex-1 items-center justify-center p-10 text-sm text-slate-400">
              {racksLoading ? 'Loading…' : 'Pick a rack to see what is on it.'}
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-base font-semibold text-slate-900">{rack.location}</h2>
                  {rack.barcode && <span className="text-xs text-slate-400">{rack.barcode}</span>}
                  {!rack.known && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">not a shelf</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  {unsaved && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">unsaved</span>}
                  <span><span className="font-semibold tabular-nums text-slate-900">{units}</span> {units === 1 ? 'unit' : 'units'}</span>
                  <span className="tabular-nums">{shelf.length} {shelf.length === 1 ? 'style' : 'styles'}</span>
                  {/* QUIET UNTIL IT IS ASKED FOR. The one button on this screen that cannot be undone gets no red, no fill and no
                      prominence — it sits last, in slate, and only turns red once it has been pressed and the footer is asking. A
                      destructive control that shouts is one that gets pressed by mistake; the weight belongs on the confirm, not on
                      the way in. Hidden entirely on an empty rack: there is nothing to take off. */}
                  {serverUnits > 0 && (
                    <button
                      type="button"
                      onClick={() => { setPicked(null); setFlash(null); setConfirmEmpty(true); }}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <TrashIcon className="h-3.5 w-3.5" /> Empty rack
                    </button>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {stockError ? (
                  <div className="px-4 py-10 text-center text-sm text-rose-700">Could not load this rack: {stockError.message}</div>
                ) : stockLoading ? (
                  <div className="px-4 py-10 text-center text-sm text-slate-400">Loading…</div>
                ) : shelf.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm text-slate-400">
                    Nothing on this rack. Scan a shoe below to put it here.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {shelf.map((s) => (
                      <li key={s.key} className="flex items-center gap-3 px-4 py-1.5 hover:bg-slate-50/70">
                        {/* THE CODE IS THE ROW, and it is the only text on it (owner, 2026-09-10: names off the shelf, keep them
                            for the click). The code is what is printed on the box in your hand, so it is what a row is matched
                            against — and being monospaced in a fixed column, the codes stack into a list the eye runs straight down,
                            which a ragged left edge of 70-character titles never does. The name is one click away in the footer,
                            which is where it is actually needed: confirming the shoe before changing a count, since 0051191-ARIZONA
                            and 0051193-ARIZONA differ by one digit and are different colours. Sized for the longest code in stock
                            (21 characters), so nothing truncates in practice; the tooltip carries the name for a hover. */}
                        <span
                          className="w-40 shrink-0 truncate font-mono text-xs text-slate-900"
                          title={s.title ? `${s.key} · ${s.title}` : s.key}
                        >
                          {s.key}
                        </span>
                        {/* Chips start at the same x on every row now that nothing sits between them and the code, so one shelf's
                            size runs can be compared down the column as well as read across. */}
                        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                          {s.chips.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              onClick={() => setPicked(picked === c.key ? null : c.key)}
                              title={`${c.code} · ${c.qty} ${c.qty === 1 ? 'pair' : 'pairs'} · ${STATE_WORD[c.state]}`}
                              className={
                                'inline-flex min-w-[2.1rem] items-center justify-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
                                CHIP_STATE[c.state] +
                                (picked === c.key ? ' ring-2 ring-brand-500' : '')
                              }
                            >
                              {c.size}
                              {c.qty > 1 && <span className="text-[10px] opacity-60">×{c.qty}</span>}
                            </button>
                          ))}
                        </div>
                        <span className="w-6 shrink-0 text-right text-sm tabular-nums text-slate-400">{s.units}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* What just happened, said once, where the thing happened. It stays until the next action rather than fading, because
                  "I took 14 units off a shelf" is not a thing to blink at someone for three seconds. */}
              {flash && (
                <div
                  className={
                    'flex shrink-0 items-start gap-2 border-t px-4 py-2 text-sm ' +
                    (flash.ok ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-rose-100 bg-rose-50 text-rose-800')
                  }
                >
                  <span className="min-w-0 flex-1">{flash.text}</span>
                  <button type="button" onClick={() => setFlash(null)} className="shrink-0 rounded p-0.5 hover:bg-black/5">
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* ONE FOOTER, THREE MODES. Adding is the default because it is what you come to a shelf holding a box to do; picking a
                  chip swaps in that unit's controls, and asking to empty the rack swaps in the confirm. Same strip, same position, so
                  nothing moves and there is never a dialog over the shelf you are deciding about. */}
              <div className="shrink-0 border-t border-slate-100 bg-slate-50">
                {confirmEmpty ? (
                  <ConfirmEmpty
                    location={rack.location}
                    units={serverUnits}
                    picked={serverPicked}
                    amz={serverAmz}
                    unsaved={unsaved}
                    busy={emptying}
                    onConfirm={() => doEmpty(rack.location)}
                    onCancel={() => setConfirmEmpty(false)}
                  />
                ) : pickedLine ? (
                  <PickedChip
                    line={pickedLine}
                    location={rack.location}
                    onAdjust={(d) => adjust(rack.location, pickedLine, d)}
                    onDone={() => setPicked(null)}
                  />
                ) : (
                  <AddToRack key={rack.location} location={rack.location} onAdd={addStock} />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/*
The one irreversible thing on this screen, so it is the only place that spends any red.

WHAT IT SAYS IS THE WHOLE CONTROL. The counts are read off the SERVER's lines, not the screen's unsaved overlay, and picked and Amazon
units are named separately because those are the two that cost something elsewhere: a picked unit is committed to a customer order
that still expects it, and clearing the shelf tells that order nothing (owner, 2026-09-10 — "everything, with a warning"). If the rack
holds neither, the sentence stays short rather than padding itself with two zeroes.

It sits in the footer like every other action rather than in a modal over the shelf. A dialog would cover the very thing being decided
about — you want to be able to look at the rack while reading the question.
*/
function ConfirmEmpty({ location, units, picked, amz, unsaved, busy, onConfirm, onCancel }: {
  location: string;
  units: number;
  picked: number;
  amz: number;
  unsaved: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const flagged = [picked ? `${picked} picked for a customer order` : '', amz ? `${amz} allocated to Amazon` : ''].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-rose-50 px-4 py-2.5" onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-rose-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-rose-900">
          Take all <span className="font-semibold tabular-nums">{units}</span> {units === 1 ? 'unit' : 'units'} off{' '}
          <span className="font-semibold">{location}</span>? This cannot be undone from here.
        </p>
        {flagged.length > 0 && (
          <p className="text-xs text-rose-800">
            Includes {flagged.join(' and ')} — those units are removed too, and nothing tells the order.
          </p>
        )}
        {/* The overlay is about to be dropped along with the shelf, so say so rather than letting it disappear quietly. */}
        {unsaved && <p className="text-xs text-rose-800">The unsaved changes on this rack are discarded with it.</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1.5 text-sm text-rose-900 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          autoFocus
          className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
        >
          {busy ? 'Emptying…' : 'Empty the rack'}
        </button>
      </div>
    </div>
  );
}

/*
The chip's controls. Named for the thing it acts on ("Arizona · 38"), because the alternative — a bare stepper — makes the operator
remember which chip they clicked while they are looking at their hands.

It also carries the unsaved warning, and that placement is the point: it sits where the change is being made rather than in a banner
across the top of a screen that is mostly reading, so it is read at the moment it matters instead of dismissed on arrival.
*/
function PickedChip({ line, location, onAdjust, onDone }: {
  line: LocationStockLine;
  location: string;
  onAdjust: (delta: number) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5" onKeyDown={(e) => { if (e.key === 'Escape') onDone(); }}>
      <div className="min-w-0 flex-1">
        {/* Same order as the shelf above it: the code identifies the unit, the name confirms it. */}
        <div className="truncate font-mono text-sm font-medium text-slate-900">{line.code}</div>
        <div className="truncate text-xs text-slate-500">{line.title ?? 'No name on file'}</div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onAdjust(-1)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <MinusSmallIcon className="h-4 w-4" /> Take one off
        </button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums text-slate-900">{line.qty}</span>
        <button
          type="button"
          onClick={() => onAdjust(1)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <PlusSmallIcon className="h-4 w-4" /> Put one on
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2.5 py-1.5 text-sm text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Done
        </button>
      </div>

      <p className="w-full text-xs text-amber-700">
        Held on screen only — {location} is not updated until the save is built.
      </p>
    </div>
  );
}

/*
Put a shoe on the chosen rack. Its own component, mounted under the rack's key, so the box empties when the rack changes — what you
were about to add to C1-04 should not follow you to C1-05.

ALWAYS OPEN, not behind an "add" link. On a screen whose job is moving stock on and off shelves, the add IS the screen — hiding it
costs a click on the most common action to save one strip of a panel the operator is already looking at.
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
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <input
        ref={codeRef}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={`Scan a shoe to put it on ${location}`}
        className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <input
        type="number"
        min={1}
        value={qty}
        onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
        aria-label="How many"
        className="w-14 rounded-md border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <button
        type="submit"
        disabled={!code.trim()}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        Put it on
      </button>
    </form>
  );
}
