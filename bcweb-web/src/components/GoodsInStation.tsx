'use client';
/*
=======================================================================================================================================
Component: GoodsInStation
=======================================================================================================================================
Purpose: The whole Goods In screen. A delivery lands, the operator scans each unit, and the screen answers one question per scan:
         WHERE DOES THIS SHOE GO?

THE BRIEF IS THE BENCH, NOT THE DESK. Whoever is using this has a box on one side, a rack on the other, a gun in one hand and a shoe
in the other. They are not reading. They glance up between scans, take one word off the screen, and look back down at the shelf. So
the design spends everything on that one word:

  - THE VERDICT IS THE PAGE. The destination shelf is set enormous and is the ONLY coloured thing on the screen — amber for the Amazon
    staging bay, indigo for a local shelf, red for a scan that resolved to nothing. Everything else, the delivery note and the run list
    included, is grey on white at 12-13px. Colour here is information, so it is spent once; the moment the tables get row colours too,
    the destination stops being the loud thing and the screen needs reading again.
  - IT SITS ABOVE THE INPUT, AND BOTH ARE PINNED. The legacy screen split this across two places — a small blue AMZ box bottom-left
    and a red error bar top-right — so "where does it go" and "did it work" were different eye movements. One panel, one position,
    never moves.
  - NO STAT TILES, NO ROW STRIPES, NO ICONS IN THE LISTS. Each was tried and each competed with the verdict.

AN ERROR STOPS THE LINE, and that is load-bearing, not defensive UI. It is the legacy behaviour (of_scan2 refuses to proceed while an
error row exists) and the reason is physical: a scan that resolves to nothing means a shoe in your hand that the system cannot account
for. Scanning the next one buries it. So the input goes red, refuses, and says what to do. Clear it with the button, with Escape, or by
typing RESETERROR — the legacy command, kept because it is in the operator's fingers.

THE KEYBOARD NEVER LEAVES THE INPUT — in fact the gun never leaves the operator's hand. Everything a run needs goes through the one
box: a shoe books in, a RACK LABEL ('LC-58', printed on every shelf) points the run at that shelf, RESETERROR clears a stop and UNDO
reverses the last unit. The rack scan is the one that matters most, because it matches how the job is actually done — you walk to a
shelf, scan it, and fill it — where reaching back to a dropdown means putting the gun down. UNDO is new too; the legacy Cancel Item
needed a row selected with a mouse, and the per-row control stays for fixing something further back. The input autofocuses and
re-focuses after every action, so none of this costs a click.

WHERE THE DATA COMES FROM. The delivery note is the live ON ORDER stage of `orderstatus` (/goods-in-expected) and every scan is
resolved against the live catalogue (/goods-in-lookup). What does NOT exist yet is the write that books a unit in, so the run is held
in this component and the screen says so permanently rather than letting an operator believe stock has moved. src/lib/goodsInWrite.ts
carries the contract for that route; when it lands, `claimed` below stops being local truth and the delivery note refetches instead.

CLAIMING IS DONE HERE, NOT ON THE SERVER, for exactly as long as that is true. A scanned unit is matched to a delivery-note line the
way the server will match it — Amazon (ordertype 3) before local (2), matching of_scan2 — and the line's remaining count is decremented
locally. Two consequences worth knowing: a refresh loses the run, and two people scanning the same delivery on two screens will not see
each other. Both go away with the write.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getGoodsInShelves, getGoodsInExpected, goodsInLookup,
  type GoodsInShelvesData, type GoodsInExpectedData,
} from '@/lib/api';
import { AMAZON_SHELF, WRITE_AVAILABLE, bookIn, cancelBooking, normaliseScan, type Booking } from '@/lib/goodsInWrite';

// The shelf the run puts local stock on. Legacy default, and the bay a delivery nearly always lands on.
const DEFAULT_SHELF = 'C3-Back-Stage';
const SHELF_KEY = 'bc_goodsin_shelf';
const SOUND_KEY = 'bc_goodsin_sound';

// Used only while /goods-in-shelves is unreachable — a shelf picker with nothing in it is a dead screen.
const FALLBACK_SHELVES: GoodsInShelvesData['areas'] = [
  { area: 'C3-Back', locations: [{ location: DEFAULT_SHELF, barcode: null, pickorder: null }] },
];

// Zones whose label reads badly in a picker. 'OTHER' is the route's catch-all for racks that fit no zone prefix — they are offered
// like any other shelf, the heading is just written the way a person would say it.
const AREA_LABEL: Record<string, string> = { OTHER: 'Other' };

// The verdicts. `bar` is the fat left edge that carries the colour at a distance; `wash` is the panel fill. Only three READ as
// different — `error` borrows the stop's styling because it is also "don't put this shoe away yet", but it does NOT block the line:
// see the note on it in submit().
const STOP = { bar: 'bg-red-800', wash: 'bg-red-600 ring-red-700', head: 'text-white', sub: 'text-red-100' } as const;
const VERDICT = {
  amazon: { bar: 'bg-amber-500', wash: 'bg-amber-50 ring-amber-200', head: 'text-amber-900', sub: 'text-amber-800/80' },
  shelf: { bar: 'bg-brand-500', wash: 'bg-brand-50 ring-brand-100', head: 'text-brand-700', sub: 'text-brand-700/70' },
  'not-found': STOP,
  error: STOP,
  // A rack scan is NOT a verdict about a shoe, so it must not borrow either destination colour — an operator glancing up mid-run has
  // to be able to tell "here is where this one goes" from "here is where the next ones go" without reading. Slate says neither.
  'shelf-set': { bar: 'bg-slate-700', wash: 'bg-slate-800 ring-slate-900', head: 'text-white', sub: 'text-slate-300' },
} as const;

// A delivery-note line is identified by SKU *and* ordertype: the same code can be on order twice, once for Amazon and once for the
// local shelf, and they are different destinations.
const lineKey = (code: string, ordertype: number) => `${code}|${ordertype}`;

interface Row {
  key: string;
  input: string;                       // what was actually scanned, kept for the audit of a mis-scan
  kind: 'amazon' | 'shelf' | 'not-found' | 'error' | 'shelf-set';
  message: string | null;              // 'error' only — what the API said went wrong
  code: string | null;
  title: string | null;
  destination: string | null;
  expected: boolean;                   // claimed a delivery-note line; false = the supplier sent something we did not order
  claimedKey: string | null;
  supplier: string | null;
  deleted: boolean;                    // resolved to a SKU that is out of the catalogue but has physically turned up
  booking: Booking | null;
  cancelled: boolean;
}

export default function GoodsInStation() {
  const [shelf, setShelf] = useState(DEFAULT_SHELF);
  const [sound, setSound] = useState(true);
  const [value, setValue] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [verdict, setVerdict] = useState<Row | null>(null);
  const [claimed, setClaimed] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);   // a gun can fire faster than a round-trip; one scan at a time

  // Preferences are read after mount rather than during render: this component is prerendered, and reading localStorage in a lazy
  // useState initialiser gives the server and the client different HTML.
  useEffect(() => {
    const s = window.localStorage.getItem(SHELF_KEY);
    if (s) setShelf(s);
    setSound(window.localStorage.getItem(SOUND_KEY) !== 'off');
  }, []);

  // EVERY rack that exists, empty ones included — /goods-in-shelves reads the `location` table rather than deriving the list from
  // what happens to be holding stock, which is the difference between offering C1's 22 racks and offering the 5 with shoes on them.
  // The route has already dropped the Amazon staging bay and ordered everything by the warehouse's own walking sequence.
  const { data: shelfData } = useApiQuery<GoodsInShelvesData>(['goods-in-shelves'], getGoodsInShelves);
  const { data: expected, isLoading, error } = useApiQuery<GoodsInExpectedData>(['goods-in-expected'], getGoodsInExpected);

  const shelfAreas = useMemo(() => {
    const areas = shelfData?.areas?.length ? shelfData.areas : FALLBACK_SHELVES;
    return areas.filter((a) => a.locations.length > 0);
  }, [shelfData]);
  const shelves = useMemo(() => shelfAreas.flatMap((a) => a.locations.map((l) => l.location)), [shelfAreas]);

  // SCAN A RACK TO POINT THE RUN AT IT. Every rack carries its own label ('LC-58'), so the operator can walk to a shelf, scan it, and
  // start filling it — which is the actual job, where reaching back to a dropdown is not. Matched HERE rather than server-side: the
  // list is already loaded, so the shelf changes in the same instant the gun beeps, and a rack scan never costs a round-trip.
  // The rack's own name is accepted too — a label may carry either, and no SKU code can collide with a location.
  const racks = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of shelfAreas) {
      for (const l of a.locations) {
        if (l.barcode) m.set(normaliseScan(l.barcode), l.location);
        m.set(normaliseScan(l.location), l.location);
      }
    }
    return m;
  }, [shelfAreas]);

  const chooseShelf = useCallback((location: string) => {
    setShelf(location);
    window.localStorage.setItem(SHELF_KEY, location);
  }, []);

  // The delivery note, less what this run has already taken off it.
  const note = useMemo(() => {
    const src = expected?.rows || [];
    return src
      .map((r) => ({ ...r, remaining: r.units - (claimed[lineKey(r.code, r.ordertype)] || 0) }))
      .filter((r) => r.remaining > 0);
  }, [expected, claimed]);

  const stillExpected = note.reduce((n, r) => n + r.remaining, 0);

  // A not-found verdict blocks the line until it is cleared. See the header.
  const blocked = verdict?.kind === 'not-found';

  const focusInput = () => inputRef.current?.focus();

  // One short tone, on a stop only. A beep per scan in a stock room is torture; a stop the operator scans past is a lost shoe.
  const beep = useCallback(() => {
    if (!sound) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 196;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
      osc.onended = () => void ctx.close();
    } catch { /* no audio device, or the browser blocked it — the red panel is the real signal */ }
  }, [sound]);

  const reset = useCallback(() => { setVerdict(null); focusInput(); }, []);

  const undo = useCallback(async (row: Row) => {
    if (row.cancelled) return;
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, cancelled: true } : r)));
    if (verdict?.key === row.key) setVerdict({ ...row, cancelled: true });
    // Put the unit back on the delivery note before the round-trip: the count is local truth, and a lagging one reads as a bug.
    if (row.claimedKey) {
      setClaimed((prev) => ({ ...prev, [row.claimedKey!]: Math.max(0, (prev[row.claimedKey!] || 0) - 1) }));
    }
    if (row.booking) await cancelBooking(row.booking);
    focusInput();
  }, [verdict]);

  const submit = useCallback(async (raw: string) => {
    const typed = raw.trim();
    if (!typed) return;
    const command = typed.toUpperCase();

    // Typed commands come first — they have to work while the line is blocked, which is the only time you need one.
    if (command === 'RESETERROR') { reset(); return; }
    if (command === 'UNDO') {
      const last = rows.find((r) => !r.cancelled);
      if (last) await undo(last);
      return;
    }
    if (blocked) { beep(); return; }
    if (inFlight.current) return;

    const scan = normaliseScan(typed);

    // A RACK BEFORE A SHOE. Checked first so a rack label can never reach the catalogue and come back NOT_FOUND, which would stop the
    // line over a scan that was perfectly valid. It is deliberately NOT reachable while blocked (the guard above): a stop means a shoe
    // is unaccounted for, and letting a rack scan repaint the panel would wipe the stop off the screen while the line was still shut.
    const rack = racks.get(scan);
    if (rack) {
      chooseShelf(rack);
      setVerdict({
        key: `${Date.now()}-${Math.random()}`, input: typed, kind: 'shelf-set', message: null,
        code: null, title: null, destination: rack,
        expected: false, claimedKey: null, supplier: null, deleted: false, booking: null, cancelled: false,
      });
      focusInput();
      return;
    }

    inFlight.current = true;
    setBusy(true);
    const res = await goodsInLookup(scan);
    // A fresh key per scan remounts the verdict panel, which is what replays the flash — two identical scans still register as two.
    const key = `${Date.now()}-${Math.random()}`;

    // NOT_FOUND is the real stop — the label is unreadable or the SKU was never set up, and the shoe has to go to one side. Anything
    // else (server down, query failed) is the API having a moment: the same scan will work when it comes back, so it shows the same
    // red panel but does NOT block the line. Blocking on a network blip would make the operator clear a stop that was never theirs.
    if (!res.success || !res.data) {
      setBusy(false);
      inFlight.current = false;
      const stop = res.return_code === 'NOT_FOUND';
      setVerdict({
        key, input: typed, kind: stop ? 'not-found' : 'error', message: stop ? null : (res.error || 'Could not look that up'),
        code: null, title: null, destination: null,
        expected: false, claimedKey: null, supplier: null, deleted: false, booking: null, cancelled: false,
      });
      beep();
      focusInput();
      return;
    }

    // Match the scan to a delivery-note line the way the server will: Amazon before local (of_scan2 tests ordertype 3 first).
    const sku = res.data;
    const open = note.filter((r) => r.code === sku.code);
    const claim = open.find((r) => r.ordertype === 3) || open.find((r) => r.ordertype === 2) || null;
    const amazon = claim?.ordertype === 3;
    const destination = amazon ? AMAZON_SHELF : shelf;

    const booking = await bookIn({ code: sku.code, shelf: destination });
    setBusy(false);
    inFlight.current = false;

    const row: Row = {
      key,
      input: typed,
      kind: amazon ? 'amazon' : 'shelf',
      message: null,
      code: sku.code,
      title: sku.title,
      destination,
      expected: Boolean(claim),
      claimedKey: claim ? lineKey(claim.code, claim.ordertype) : null,
      supplier: claim?.supplier ?? sku.supplier,
      deleted: sku.deleted,
      booking,
      cancelled: false,
    };
    if (row.claimedKey) setClaimed((prev) => ({ ...prev, [row.claimedKey!]: (prev[row.claimedKey!] || 0) + 1 }));
    setVerdict(row);
    setRows((prev) => [row, ...prev]);
    focusInput();
  }, [blocked, rows, note, shelf, racks, chooseShelf, beep, reset, undo]);

  const booked = rows.filter((r) => !r.cancelled);
  const toAmazon = booked.filter((r) => r.kind === 'amazon').length;
  const unexpected = booked.filter((r) => !r.expected).length;

  return (
    <div className="pb-10">
      {/* The flash is the one piece of motion on the screen, and it fires only in answer to a scan. */}
      <style>{`
        @keyframes gi-land { from { opacity: .35; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
        .gi-land { animation: gi-land 140ms ease-out; }
        @media (prefers-reduced-motion: reduce) { .gi-land { animation: none; } }
      `}</style>

      {/* --- PINNED: destination, verdict, input. The operator's eye returns to this block and nothing else moves under it. --- */}
      <div className="sticky -top-px z-30 -mx-4 bg-slate-100 px-4 pb-3 pt-3">

        {/* The shelf this run puts local stock on. A run is one shelf, so this is set once and then left alone — which is why it sits
            above the verdict as a quiet standing statement rather than beside the input as a per-scan control. */}
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <label htmlFor="gi-shelf">Local stock goes to</label>
          <select
            id="gi-shelf"
            value={shelf}
            onChange={(e) => { chooseShelf(e.target.value); focusInput(); }}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            {/* Grouped by zone, which is how the racks are known and how the legacy screen's C1/C3 buttons carved them up — a flat
                list of ~70 shelf names is a scroll, not a choice. A remembered shelf that has since emptied off localstock (and so is
                no longer in the list) is kept at the top rather than silently swapped for another rack. */}
            {!shelves.includes(shelf) && <option value={shelf}>{shelf}</option>}
            {shelfAreas.map((a) => (
              <optgroup key={a.area} label={AREA_LABEL[a.area] || a.area}>
                {a.locations.map((l) => <option key={l.location} value={l.location}>{l.location}</option>)}
              </optgroup>
            ))}
          </select>
          <span className="text-slate-400">Scan a rack label to change it. Amazon lines override it and go to {AMAZON_SHELF}.</span>
        </div>

        {/* --- THE VERDICT --- */}
        <div
          key={verdict?.key || 'idle'}
          className={
            'gi-land flex min-h-[7.5rem] items-stretch overflow-hidden rounded-xl ring-1 ' +
            (verdict ? VERDICT[verdict.kind].wash : 'bg-white ring-slate-200')
          }
          aria-live="assertive"
        >
          <div className={'w-2 shrink-0 ' + (verdict ? VERDICT[verdict.kind].bar : 'bg-slate-200')} />

          {!verdict ? (
            <div className="flex flex-1 flex-col justify-center px-5 py-4">
              <p className="text-[clamp(1.25rem,3vw,1.75rem)] font-semibold tracking-tight text-slate-300">Ready</p>
              <p className="mt-1 text-sm text-slate-500">Scan a shoe. The shelf it belongs on appears here.</p>
            </div>
          ) : verdict.kind === 'shelf-set' ? (
            <div className="flex flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4">
              <div className="min-w-0">
                <p className={'text-[clamp(1.75rem,5vw,3.25rem)] font-bold uppercase leading-none tracking-tight ' + VERDICT['shelf-set'].head}>
                  {verdict.destination}
                </p>
                <p className={'mt-2 text-sm ' + VERDICT['shelf-set'].sub}>
                  Filling this shelf now. Scan a shoe.
                </p>
              </div>
              <p className={'shrink-0 font-mono text-sm tabular-nums tracking-tight ' + VERDICT['shelf-set'].sub}>{verdict.input}</p>
            </div>
          ) : verdict.kind === 'not-found' || verdict.kind === 'error' ? (
            <div className="flex flex-1 flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className={'text-[clamp(1.75rem,5vw,3.25rem)] font-bold leading-none tracking-tight ' + STOP.head}>
                  {verdict.kind === 'not-found' ? 'Not found' : 'No answer'}
                </p>
                <p className={'mt-2 text-sm ' + STOP.sub}>
                  {verdict.kind === 'not-found'
                    ? 'Put it to one side. Nothing else can be scanned until this is cleared.'
                    : `${verdict.message} — scan it again.`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded bg-red-800/40 px-2 py-1 font-mono text-sm tabular-nums text-red-50">{verdict.input}</span>
                {verdict.kind === 'not-found' && (
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4">
              <div className="min-w-0">
                <p className={'text-[clamp(1.75rem,5vw,3.25rem)] font-bold uppercase leading-none tracking-tight ' + VERDICT[verdict.kind].head}>
                  {verdict.destination}
                </p>
                <p className={'mt-2 text-sm ' + VERDICT[verdict.kind].sub}>
                  {verdict.title || verdict.code}
                  {verdict.expected
                    ? <> · on order from {verdict.supplier}</>
                    : <> · <span className="font-semibold">nothing on order</span> — putting it away as free stock</>}
                  {verdict.deleted && <> · <span className="font-semibold">not in the catalogue</span></>}
                </p>
              </div>
              <p className={'shrink-0 font-mono text-sm tabular-nums tracking-tight ' + VERDICT[verdict.kind].sub}>{verdict.code}</p>
            </div>
          )}
        </div>

        {/* --- THE INPUT. Autofocused, re-focused after everything, and the only control a run needs. --- */}
        <form
          className="mt-2"
          onSubmit={(e) => { e.preventDefault(); const v = value; setValue(''); void submit(v); }}
        >
          <input
            ref={inputRef}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setValue(''); reset(); } }}
            placeholder={blocked ? 'Clear the stop before scanning again' : 'Scan a shoe — or a rack label to fill a different shelf'}
            aria-label="Scan a barcode"
            className={
              'w-full rounded-lg border px-4 py-3 font-mono text-lg tabular-nums tracking-tight outline-none transition ' +
              (blocked
                ? 'border-red-400 bg-red-50 text-red-800 placeholder:text-red-400 focus:ring-2 focus:ring-red-300'
                : 'border-slate-300 bg-white placeholder:font-sans placeholder:text-base placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200')
            }
          />
        </form>

        {/* Permanent, and it stays until the write route lands. An operator who believes stock has been booked in and walks away is
            worse off than one who never opened the screen. */}
        {!WRITE_AVAILABLE && (
          <p className="mt-1.5 text-xs text-slate-500">
            Scans are identified and routed, but not yet written to stock — put the shoes away and book the delivery in on the legacy
            screen. This run is lost on a refresh.
          </p>
        )}
      </div>

      {/* --- THE RUN. What this session has scanned, newest first — the order you would count the box back in. --- */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-slate-200 pb-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">
          {booked.length === 0 ? 'Nothing scanned yet' : `${booked.length} scanned`}
        </span>
        {booked.length > 0 && <span>{toAmazon} to Amazon · {booked.length - toAmazon} to a shelf</span>}
        {unexpected > 0 && <span className="text-amber-700">{unexpected} not on order</span>}
        {busy && <span className="text-slate-400">Working…</span>}
        <button
          type="button"
          onClick={() => {
            const next = !sound;
            setSound(next);
            window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
            focusInput();
          }}
          className="ml-auto text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
        >
          {sound ? 'Sound on' : 'Sound off'}
        </button>
      </div>

      {rows.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Units scanned during this run, newest first</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={'border-b border-slate-100 ' + (r.cancelled ? 'text-slate-300' : 'text-slate-600')}>
                <td className={'py-1.5 pr-3 font-mono tabular-nums ' + (r.cancelled ? 'line-through' : 'text-slate-800')}>
                  {r.code || r.input}
                </td>
                <td className="hidden py-1.5 pr-3 sm:table-cell">{r.title}</td>
                <td className="py-1.5 pr-3 text-right sm:text-left">
                  {r.destination}
                  {!r.expected && !r.cancelled && <span className="ml-2 text-xs text-amber-700">not on order</span>}
                </td>
                <td className="w-8 py-1.5 text-right">
                  {r.cancelled ? (
                    <span className="text-xs text-slate-300">undone</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void undo(r)}
                      title={`Undo ${r.code} — takes it back off ${r.destination}`}
                      aria-label={`Undo ${r.code}`}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <ArrowUturnLeftIcon className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* --- THE DELIVERY NOTE: what is on order with every supplier and hasn't arrived. It shrinks as the box is worked, which makes
          it the run's progress bar as well as its crib sheet. Kept below the run so the thing you are doing stays above the thing you
          are checking against. --- */}
      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
          <h2 className="text-xs font-semibold text-slate-700">Still to arrive</h2>
          <p className="text-xs text-slate-500">
            {isLoading ? 'Loading…' : `${stillExpected} units on ${note.length} lines`}
          </p>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700">{error.message}</p>
        ) : isLoading ? (
          <p className="mt-3 text-sm text-slate-500">Loading what's on order…</p>
        ) : note.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {(expected?.rows.length ?? 0) === 0
              ? 'Nothing is on order. Anything that turns up will go away as free stock.'
              : 'Every unit on order has been scanned. Nothing left in the box.'}
          </p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="w-10 py-1.5 pr-3 text-right font-medium">Qty</th>
                <th className="py-1.5 pr-3 font-medium">Code</th>
                <th className="hidden py-1.5 pr-3 font-medium sm:table-cell">Product</th>
                <th className="py-1.5 pr-3 font-medium">Supplier</th>
                <th className="py-1.5 text-right font-medium">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {note.map((r) => (
                <tr key={lineKey(r.code, r.ordertype)} className="border-b border-slate-100 text-slate-600">
                  <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-slate-800">{r.remaining}</td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums">
                    {r.code}
                    {/* The only place a delivery-note line needs a mark: an Amazon line will not go on the chosen shelf. */}
                    {r.ordertype === 3 && <span className="ml-2 font-sans text-amber-700">Amazon</span>}
                  </td>
                  <td className="hidden py-1.5 pr-3 sm:table-cell">{r.title || '—'}</td>
                  <td className="py-1.5 pr-3">{r.supplier || '—'}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{r.days === null ? '—' : `${r.days}d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
