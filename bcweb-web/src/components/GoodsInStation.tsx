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

EVERY SCAN IS A REAL WRITE. One POST /goods-in-book marks the order line arrived, puts the unit on a shelf, records the arrival and
logs it, in one transaction. The SERVER decides which line was claimed and therefore where the shoe goes — this component does not
guess and then hope the write agrees, it renders what came back. That is why the delivery note is refetched after every scan rather
than decremented locally: the server is the only thing that knows, and two operators working the same delivery see each other's units
disappear.

THE RUN LIST IS THIS SESSION'S, THOUGH, and deliberately not persisted. It is the box in front of you, not an audit trail — bclog and
incoming_stock are the audit trail. Undo works off the handles the book call returned, so it survives as long as the list does.
=======================================================================================================================================
*/

import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getGoodsInShelves, getGoodsInExpected, goodsInBook, goodsInCancel,
  type GoodsInShelvesData, type GoodsInExpectedData,
} from '@/lib/api';
import { AMAZON_SHELF, normaliseScan } from '@/lib/goodsIn';

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
  expected: boolean;                   // claimed an order line; false = the supplier sent something we did not order
  supplier: string | null;
  ordernum: string | null;             // the claimed line, so an undo can reopen exactly that row
  incomingId: number | null;           // handles from the book call, for the undo
  localstockId: string | null;
  cancelled: boolean;
}

// Remembered preferences. Read in a lazy initialiser rather than a mount effect, which is safe HERE specifically: AppShell renders a
// splash instead of its children until auth has hydrated, so this component never renders on the server and there is no first paint
// for a localStorage value to disagree with. (The `typeof window` guard is belt and braces for that assumption changing.)
function remembered(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export default function GoodsInStation() {
  const [shelf, setShelf] = useState(() => remembered(SHELF_KEY, DEFAULT_SHELF));
  const [sound, setSound] = useState(() => remembered(SOUND_KEY, 'on') !== 'off');
  const [value, setValue] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [verdict, setVerdict] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);   // a gun can fire faster than a round-trip; one scan at a time

  // EVERY rack that exists, empty ones included — /goods-in-shelves reads the `location` table rather than deriving the list from
  // what happens to be holding stock, which is the difference between offering C1's 22 racks and offering the 5 with shoes on them.
  // The route has already dropped the Amazon staging bay and ordered everything by the warehouse's own walking sequence.
  const { data: shelfData } = useApiQuery<GoodsInShelvesData>(['goods-in-shelves'], getGoodsInShelves);
  const { data: expected, isLoading, error, refresh: refreshNote } =
    useApiQuery<GoodsInExpectedData>(['goods-in-expected'], getGoodsInExpected);

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

  // The delivery note, straight from the server — a booked unit leaves it because the server marked the line arrived, not because
  // this component subtracted one. Refetched after every scan, which is also how two operators on one delivery stay in step.
  const note = expected?.rows || [];
  const stillExpected = note.reduce((n, r) => n + r.units, 0);

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
    if (row.cancelled || row.incomingId === null || row.localstockId === null) return;
    // Struck through immediately: the operator has the shoe back in their hand and needs the screen to agree at once. A failed cancel
    // puts it back and says so, which is rarer than the round-trip being slow.
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, cancelled: true } : r)));
    if (verdict?.key === row.key) setVerdict({ ...row, cancelled: true });

    const res = await goodsInCancel({
      incomingId: row.incomingId, localstockId: row.localstockId, ordernum: row.ordernum, code: row.code || '',
    });
    // NOT_FOUND means it was already undone — the row is correctly struck through either way, so only a real failure is rolled back.
    if (!res.success && res.return_code !== 'NOT_FOUND') {
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, cancelled: false } : r)));
      setVerdict({
        key: `${Date.now()}-${Math.random()}`, input: row.code || '', kind: 'error',
        message: res.error || 'Could not undo that unit', code: row.code, title: row.title, destination: null,
        expected: false, supplier: null, ordernum: null, incomingId: null, localstockId: null, cancelled: false,
      });
    }
    await refreshNote();
    focusInput();
  }, [verdict, refreshNote]);

  const submit = useCallback(async (raw: string) => {
    const typed = raw.trim();
    if (!typed) return;
    const command = typed.toUpperCase();

    // Typed commands come first — they have to work while the line is blocked, which is the only time you need one.
    if (command === 'RESETERROR') { reset(); return; }
    if (command === 'UNDO') {
      // Same target as the "Undo last" button: the newest row still standing. Reads `rows` rather than the derived `lastBooked` so
      // the callback does not need to be rebuilt on every render of the counts line.
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
        expected: false, supplier: null, ordernum: null, incomingId: null, localstockId: null, cancelled: false,
      });
      focusInput();
      return;
    }

    // THE WRITE. One call books the unit in — arrived flag, shelf row, arrival record, log — and tells us what it decided. Nothing is
    // guessed client-side: which order line got claimed is the server's call, and it is what determines the destination.
    inFlight.current = true;
    setBusy(true);
    const res = await goodsInBook({ scan, shelf });
    setBusy(false);
    inFlight.current = false;

    // A fresh key per scan remounts the verdict panel, which is what replays the flash — two identical scans still register as two.
    const key = `${Date.now()}-${Math.random()}`;

    // NOT_FOUND is the real stop — the label is unreadable or the SKU was never set up, and the shoe has to go to one side. Everything
    // else (a bad shelf, the server down, the transaction rolled back) is shown in the same red but does NOT block the line: nothing
    // was written, the same scan will work once the cause is fixed, and making the operator clear a stop that was never theirs is how
    // a screen trains people to clear stops without reading them.
    if (!res.success || !res.data) {
      const stop = res.return_code === 'NOT_FOUND';
      setVerdict({
        key, input: typed, kind: stop ? 'not-found' : 'error', message: stop ? null : (res.error || 'Could not book that in'),
        code: null, title: null, destination: null,
        expected: false, supplier: null, ordernum: null, incomingId: null, localstockId: null, cancelled: false,
      });
      beep();
      focusInput();
      return;
    }

    const b = res.data;
    const row: Row = {
      key,
      input: typed,
      kind: b.amazon ? 'amazon' : 'shelf',
      message: null,
      code: b.code,
      title: b.title,
      destination: b.destination,
      expected: b.expected,
      supplier: b.supplier,
      ordernum: b.ordernum,
      incomingId: b.incomingId,
      localstockId: b.localstockId,
      cancelled: false,
    };
    setVerdict(row);
    setRows((prev) => [row, ...prev]);
    focusInput();
    // Not awaited: the delivery note catching up a moment later is fine, and the operator is already reaching for the next shoe.
    void refreshNote();
  }, [blocked, rows, shelf, racks, chooseShelf, beep, reset, undo, refreshNote]);

  const booked = rows.filter((r) => !r.cancelled);
  // `rows` is newest-first, so the first un-cancelled row IS the last scan — what both "Undo last" and the typed UNDO act on.
  const lastBooked = booked[0] || null;
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

      </div>

      {/* --- THE RUN. What this session has scanned, newest first — the order you would count the box back in. --- */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-slate-200 pb-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">
          {booked.length === 0 ? 'Nothing scanned yet' : `${booked.length} scanned`}
        </span>
        {booked.length > 0 && <span>{toAmazon} to Amazon · {booked.length - toAmazon} to a shelf</span>}
        {unexpected > 0 && <span className="text-amber-700">{unexpected} not on order</span>}
        {busy && <span className="text-slate-400">Working…</span>}

        {/* UNDO THE LAST SCAN — the cancel you actually reach for, since a mis-scan is noticed with the shoe still in your hand. The
            per-row control below covers going further back. Offered only when there is something to undo: a permanently greyed-out
            button is a worse answer to "can I take that back" than no button at all. */}
        {lastBooked && (
          <button
            type="button"
            onClick={() => void undo(lastBooked)}
            title={`Puts ${lastBooked.code} back on order and takes it off ${lastBooked.destination} — or just type UNDO`}
            className="ml-auto text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
          >
            Undo last
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            const next = !sound;
            setSound(next);
            window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
            focusInput();
          }}
          className={(lastBooked ? '' : 'ml-auto ') + 'text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline'}
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
          <p className="mt-3 text-sm text-slate-500">Loading the delivery note…</p>
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
                  <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-slate-800">{r.units}</td>
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
