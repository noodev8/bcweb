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

WHICH IS TWO DISTANCES, AND THEY NEEDED SEPARATING (owner, 2026-09-11: "when scanning the person is not at the computer, they are at a
distance"). At the desk you are 60cm from 12px type with a mouse in your hand. At the shelving you are two metres away holding a gun
and a box, and you glance up between scans and take one word off the screen. Six things broke at the second distance, and the fixes
are the shape of everything below:

  1. TWO BOXES TOOK A GUN — the rack finder and the add box — and which had the caret depended on the last click, which you cannot
     see from the aisle. A rack label fired into the add box came back "Nothing matches LC-58"; a shoe fired into the finder quietly
     filtered the aisle instead of going on a shelf. Both now go through `onScan`, which decides what a scan means from WHAT IT IS
     (a rack's barcode or name, or else a shoe) rather than from where it landed. That is the flow change: at a shelf, scanning a
     shoe IS putting it there.
  2. FAST SCANS WERE DROPPED IN SILENCE. `addStock` returned early while a write was in flight and AddToRack had already cleared the
     box, so a gun outrunning the round-trip lost a pair with nothing on screen saying so — the worst possible failure for a stock
     check, because you only find out when the count is wrong weeks later. Scans are now HELD one deep (`queued`) and run when the
     write lands; a second one on top of that is refused out loud.
  3. NOTHING MADE A NOISE. Goods In beeps only on a stop and can afford to — its operator is at arm's length. Here silence after a
     scan is indistinguishable from the gun not firing, so a write blips and a refusal gets Goods In's low buzz. Toggleable, and
     remembered, exactly as it is there.
  4. THE ANSWER WAS 14px AT THE BOTTOM EDGE. The flash strip was right to persist rather than fade, but it sat below a list that can
     be 43 rows long. In scan mode it is an answer BAND, next to the scan box, and it prints the number the job is actually checking
     — what is on the shelf NOW, read back off the re-read rather than added up from the delta we sent.
  5. EVERY WRITE LOST YOUR PLACE in the desk shelf. The touched line now keeps a ring until the next action and is scrolled to.
  6. THE SHELF ITSELF WAS THE WRONG THING TO SHOW (owner, 2026-09-11: "scan mode I don't care about displaying what's on the rack —
     transfer, add or remove, don't want to overwhelm the user with needed info"). At the shelving the shelf is in front of your face.
     So scan mode is not a bigger version of this screen, it is a different one: three verbs, the rack you are standing at, the answer
     band and the box. Nothing to read past. The desk view keeps the size runs, the chips and the footer exactly as they were —
     averaging the two would give a screen too big to browse and too small to read.

TRANSFER IS A BASKET, filled by scanning and emptied onto one rack (owner, 2026-09-11: "needs to work for multiple pairs in one go — I
don't want to do one at a time and keep choosing"). Scan every pair you are carrying off the shelf, then name the destination ONCE.
That is the shape of the errand: an armful off one rack and onto another, where the walk is the expensive part and choosing the far
rack five times is pure tax. Scanning the same size twice makes it two of that size, capped at what the shelf actually holds.
It is the same `transfer` state the desk's chip button fills (with one line) and the same POST /locations-transfer — warnings, the
Amazon-bay question and the undo all included — so there is one move on this screen, reached two ways, and not two to keep in step.
Emptying the basket LOOPS that route, one call per line, the same shape the bulk price move uses. So a basket can land half-moved, and
the message says which lines did not go rather than reporting one cheerful total.

WHICH UNIT A SCAN MEANS, for Remove and Transfer, is `STATE_PREFERENCE`: a rack can hold the same code as a free pair and a picked one
at once, and they are not interchangeable. Free first, Amazon next, picked last, and the confirmation names the state whenever it is
not free.

EVERY RACK IS LISTED, INCLUDING THE EMPTY ONES (20 of the 72 today), because an empty shelf is precisely where a box gets put — the
case the Inventory picker gets wrong by deriving its list from localstock. A rack marked `known:false` is the opposite: stock sitting
somewhere that is not a shelf at all — today exactly one, 'Ordered', which is a marker meaning the units are still with the supplier.
It is tagged, never hidden.

EVERY BUTTON ON THIS SCREEN NOW WRITES, and there is no client-side overlay left. Three routes do it:
  - the chip's +/-        POST /inv-adjust      the EXISTING Inventory write, unchanged. It already took exactly the shape this screen
                          needed (code, location, delta, and the localstock ids behind the line), so Locations never grew a second
                          write for the same job — one route, one set of rules, one bclog phrasing, and a fix to either screen's
                          behaviour is a fix to both.
  - putting a shoe on     POST /locations-find-sku then /inv-adjust with EMPTY ids — resolve the scan, then place it. In that order,
                          so an unreadable barcode is caught before anything is written and the confirmation can name the shoe.
  - Empty rack            POST /locations-empty  every unit off in one transaction, soft-deleted.
  - Transfer              POST /locations-transfer  one shelf to another. A MOVE: the row changes location and keeps `ordernum` /
                          `allocated`, so a unit picked for a customer order is still picked when it lands. Deliberately NOT two
                          inv-adjust calls, which would mint a free unallocated pair at the far end and un-pick the order waiting for
                          it with nothing recording that it happened.
THE TWO IRREVERSIBLE-VERSUS-REVERSIBLE BARGAINS ARE OPPOSITE, on purpose. Empty rack asks first and cannot be undone. Transfer does not
ask at all and can: the route returns the ids of the rows it landed, so undo sends exactly those back rather than whatever now happens
to sit on that rack under the same code. A wrong rack should cost a click, not a hunt.
After any of them the panel and the rack list both re-read, so what is on screen is what the DB says rather than a local guess that
agreed with it until someone else picked from the same shelf. A write in flight disables the controls: a gun and a mouse can both
outrun a round-trip.
NOTHING HERE IS UNDOABLE FROM THE SCREEN. Removals are soft deletes (`deleted=1`) so they are recoverable by hand, and every change
writes a bclog line under the operator's name — which is why the destructive control is the quietest one in the header until it is
pressed.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon, ArrowRightCircleIcon, ExclamationTriangleIcon, MagnifyingGlassIcon, MinusSmallIcon, PlusSmallIcon, QrCodeIcon,
  TrashIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  adjustStock, emptyLocation, findLocationSku, getLocationRacks, getLocationStock, transferStock,
  type InvLocationState, type LocationStockLine,
} from '@/lib/api';
import { AREA_LABEL, AREA_ORDER, areaOf } from '@/lib/locationsUi';
import { normaliseScan } from '@/lib/goodsIn';

// A rack label as printed on the shelving. Typed or scanned into the search box it jumps straight to that rack rather than filtering
// to it — a scan is a statement about where you are standing, not a query.
const RACK_LABEL = /^LC-\d+$/i;

// Remembered preferences. Same lazy-initialiser trick as GoodsInStation, and safe for the same reason: AppShell renders a splash
// instead of its children until auth has hydrated, so this component never renders on the server and there is no first paint for a
// localStorage value to disagree with. KEEP THE TWO IN STEP if that assumption ever changes.
const SCAN_KEY = 'bc_locations_scan';
const SOUND_KEY = 'bc_locations_sound';
function remembered(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

// THE TWO DISTANCES THIS SCREEN IS READ FROM (owner, 2026-09-11). The header already said this screen is worked two ways — at the desk
// when someone asks what is on C1-04, and at the shelving during a stock check — and they are not the same screen. At the desk you are
// 60cm from 12px type with a mouse; at the shelving you are two metres away with a gun in one hand and a box in the other, and you
// glance up between scans the way Goods In describes.
//
// SCAN MODE IS NOT A BIGGER VERSION OF THIS SCREEN, it is a different one (owner, 2026-09-11: "scan mode I don't care about displaying
// what's on the rack — transfer, add or remove, don't want to overwhelm the user with needed info"). At the shelving you already have
// the shelf: it is in front of your face, and reading 43 rows of it off a monitor two metres away is work the operator did not ask
// for. What they cannot see is whether the gun landed. So scan mode drops the shelf entirely and is three verbs, a rack, and a box:
// see ScanStation. The desk view keeps everything — the size runs, the chips, the footer — unchanged.
//
// What the two modes still share is the way into a rack, so this is only the tabs and the aisle list.
const SCALE = {
  desk: { area: 'px-3 py-1.5 text-sm', rackRow: 'px-3 py-1.5 text-sm' },
  scan: { area: 'px-4 py-2 text-base', rackRow: 'px-4 py-2.5 text-lg' },
} as const;

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

// THE THREE VERBS OF SCAN MODE. Everything that screen can do, said as the operator would say it, because at the shelving the whole
// interface is "which of these am I doing, and did it land". Transfer is last: it is two scans rather than one, and the rarest errand.
type ScanAction = 'add' | 'remove' | 'transfer';
const ACTIONS: { key: ScanAction; label: string; hint: (rack: string) => string }[] = [
  { key: 'add', label: 'Add', hint: (r) => `Scan a shoe to put it on ${r}` },
  { key: 'remove', label: 'Remove', hint: (r) => `Scan a shoe to take it off ${r}` },
  { key: 'transfer', label: 'Transfer', hint: (r) => `Scan the pairs to move off ${r}` },
];

// WHICH UNIT A SCANNED CODE MEANS when the shelf holds it more than once. A code is one size of one style, but a rack can carry it as
// several localstock clusters at the same time — a free pair standing next to one picked for a customer order — and those are not
// interchangeable. Free first, then Amazon, and a picked unit only when there is nothing else: taking the pair an order is waiting for
// is the most expensive of the three mistakes. When it does land on one, the confirmation says so rather than letting it pass.
const STATE_PREFERENCE: InvLocationState[] = ['FREE', 'AMZ', 'PICKED'];

// WHAT IS IN YOUR HANDS. A transfer is a BASKET, not a shoe (owner, 2026-09-11: "needs to work for multiple pairs in one go — I don't
// want to do one at a time and keep choosing"). You fill it at one rack — scan, scan, scan — and then name the destination ONCE. That
// is how the errand actually looks: an armful off one shelf and onto another, where the walk is the expensive part and choosing the
// far rack five times is pure tax. One entry per shelf line, carrying how many of that line are going; scanning the same size twice
// makes it two rather than a second entry.
interface TransferItem { line: LocationStockLine; units: number }
interface TransferBasket { from: string; items: TransferItem[] }

// inv-adjust caps one call at 50 units (MAX_DELTA there, so a typo's extra zero cannot mint a warehouse). Mirrored here so the box
// refuses it rather than the write doing so after the operator has committed.
const MAX_ADD = 50;

// Sizes are text (RIGHT(code,2)), so they sort numerically or a 40 lands before a 5. Non-numeric sizes go last rather than nowhere.
const sizeRank = (s: string) => (/^\d+$/.test(s) ? Number(s) : 999);

export default function LocationsBoard() {
  const [area, setArea] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [picked, setPicked] = useState<string | null>(null);   // the chip being worked on, by line key
  const [confirmEmpty, setConfirmEmpty] = useState(false);     // the footer is asking whether to clear the whole rack
  const [busy, setBusy] = useState(false);                     // a write is in flight; the gun can fire faster than a round-trip
  // The transfer in progress: the chip being moved and the rack it is coming off. Non-null puts the whole screen in transfer mode.
  const [transfer, setTransfer] = useState<TransferBasket | null>(null);
  // The basket mirrored in a ref, for the same reason `inFlight` is one: a scan that was held while a write was in the air is run by
  // `drain` from inside that write's closure, where the `transfer` of a render ago is what you would read. The ref is always now.
  const basketRef = useRef<TransferBasket | null>(null);
  const [askAmazon, setAskAmazon] = useState<string | null>(null);   // a destination that needs a word first — see chooseDestination
  // `undo` is only ever set by a transfer: it is the one action here that is exactly reversible, which is why it gets an undo instead
  // of a confirm — the opposite bargain to Empty rack, which gets a confirm and no undo.
  // `code` is the SKU the message is about, and it is what lets the answer band print a count that is still true after the re-read
  // (see `flashQty`) and ring the line on the shelf that changed — the two things a stock check is actually checking.
  const [flash, setFlash] = useState<{ tone: 'ok' | 'bad' | 'pending'; text: string; code?: string; undo?: () => void } | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const touchedRef = useRef<HTMLLIElement>(null);

  // See SCALE. Scan mode is the shelving; desk mode is the desk. Remembered per operator because nobody switches jobs mid-morning.
  // DEFAULTS TO ON (owner): this screen is mostly worked at the shelving, so the station is what it opens on and the desk view is the
  // thing you switch TO. The other way round meant the commonest job began by hunting for a small button in the corner.
  const [scanMode, setScanMode] = useState(() => remembered(SCAN_KEY, 'on') !== 'off');
  const [sound, setSound] = useState(() => remembered(SOUND_KEY, 'on') !== 'off');
  const T = scanMode ? SCALE.scan : SCALE.desk;

  // A WRITE IN FLIGHT, held in a ref as well as in state. `busy` drives the disabled buttons; this is what the scan path tests,
  // because a handler called from inside another handler reads the `busy` of the render it was built in — which is exactly the case a
  // queued scan creates, and exactly the case that must not be got wrong.
  const inFlight = useRef(false);
  // A SCAN THAT LANDS MID-WRITE IS HELD, NOT DROPPED. It used to be dropped in silence: addStock returned early on `busy` and the box
  // had already cleared itself, so at the shelving a pair simply never got written and nothing said so. One deep — a second scan on
  // top of a held one is refused out loud, because three shoes in the air is a stock check you will be doing again anyway.
  const queued = useRef<{ typed: string; qty: number } | null>(null);
  // How many pairs the next scan puts on. Lives up here because the scan bar is rendered inline in scan mode; it snaps back to 1 after
  // every scan, so a 12 typed once for a box can never quietly multiply the shoe scanned after it.
  const [scanQty, setScanQty] = useState(1);
  const [scanValue, setScanValue] = useState('');
  // ALWAYS OPENS ON ADD, never remembered. The difference between putting a shoe on and taking one off is a scan you cannot take
  // back, and an operator walking up to a machine somebody else left in Remove would find that out one pair too late.
  const [action, setAction] = useState<ScanAction>('add');

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

  // WHAT IS ON THE SHELF IS WHAT THE SERVER SAYS IS ON THE SHELF. There is no client-side overlay any more: every +/- is a real
  // inv-adjust write and the panel re-reads after it, so what you are looking at is the DB rather than a local guess that agreed with
  // it until someone else picked from the same rack.
  const lines = stockData?.lines ?? [];

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
  // Emptying guards on the count it was shown, so it sends the SERVER's total rather than anything derived — see locations-empty.js.
  const serverUnits = stockData?.units ?? 0;
  const serverPicked = lines.filter((l) => l.state === 'PICKED').reduce((n, l) => n + l.qty, 0);
  const serverAmz = lines.filter((l) => l.state === 'AMZ').reduce((n, l) => n + l.qty, 0);

  // TWO TONES, BECAUSE AT THE SHELVING NOBODY IS LOOKING. Goods In beeps only on a stop, and can: the operator is at arm's length from
  // its screen. Here they are across the room, where silence after a scan is indistinguishable from the gun not having fired — so a
  // write gets a short blip and a refusal gets Goods In's low buzz, which is the sound this warehouse already reads as "stop".
  const beep = useCallback((ok: boolean) => {
    if (!sound) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = ok ? 'sine' : 'square';
      osc.frequency.value = ok ? 880 : 196;
      gain.gain.value = ok ? 0.04 : 0.06;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (ok ? 0.07 : 0.22));
      osc.onended = () => void ctx.close();
    } catch { /* no audio device, or the browser blocked it — the answer band is the real signal */ }
  }, [sound]);

  // Said once, in one place, so every outcome on this screen sounds and reads the same way.
  const say = useCallback((tone: 'ok' | 'bad' | 'pending', text: string, extra?: { code?: string; undo?: () => void }) => {
    setFlash({ tone, text, ...extra });
    if (tone !== 'pending') beep(tone === 'ok');
  }, [beep]);

  // Both panels re-read after any write: the shelf because it changed, the rack list because its count did.
  async function reread() {
    await Promise.all([refreshStock(), refreshRacks()]);
  }

  // Take everything off the rack. The confirm has already happened in the footer; this is the button at the end of it.
  async function doEmpty(location: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const res = await emptyLocation(location, serverUnits);
    inFlight.current = false;
    setBusy(false);
    if (res.success && res.data) {
      setPicked(null);
      setConfirmEmpty(false);
      const { units: took, codes, picked: wasPicked, amz: wasAmz } = res.data;
      const caveat = [wasPicked ? `${wasPicked} picked` : '', wasAmz ? `${wasAmz} Amazon` : ''].filter(Boolean).join(', ');
      say('ok', `Took ${took} ${took === 1 ? 'unit' : 'units'} off ${location} across ${codes} ${codes === 1 ? 'size' : 'sizes'}${caveat ? ` — including ${caveat}` : ''}.`);
    } else {
      say('bad', res.error || 'Could not empty that rack.');
      setConfirmEmpty(false);
    }
    // Either way the screen re-reads: on success to show the empty shelf, on a CHANGED refusal because the rack moved under us.
    await reread();
  }

  // ONE UNIT ON OR OFF ONE SHELF LINE — the existing inv-adjust write, unchanged and shared with the Inventory panel, which is why
  // this screen never grew a write of its own for it. `ids` is the whole cluster behind the chip: localstock stores two pairs on a
  // shelf as either one row of qty 2 or two rows of qty 1, so the route peels units off the cluster rather than assuming a row.
  async function adjust(location: string, line: LocationStockLine, delta: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const res = await adjustStock({ code: line.code, location, delta, ids: line.ids });
    inFlight.current = false;
    setBusy(false);
    if (res.success) {
      say('ok', delta > 0 ? `Put one ${line.code} on ${location}.` : `Took one ${line.code} off ${location}.`, { code: line.code });
    } else {
      // NOT_FOUND here means the cluster is gone — someone else cleared the line while it was on screen. The re-read below is the fix,
      // so the message says that rather than reading as a failure of the button.
      say('bad', res.error || 'Could not change that line.');
    }
    await reread();
    drain();
  }

  // PUT A SHOE ON THE SHELF, in two steps, and the order matters: RESOLVE the scan first, then write. A barcode is not a code, so
  // handing the raw scan to inv-adjust would fail as an unknown SKU after the operator had already committed. Resolving first means an
  // unreadable scan is caught before anything is written, and the confirmation can name the shoe rather than the barcode.
  async function addStock(location: string, scan: string, qty: number) {
    const typed = scan.trim();
    if (!typed || qty < 1 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const found = await findLocationSku(typed);
    if (!found.success || !found.data) {
      inFlight.current = false;
      setBusy(false);
      say('bad', found.error || `Nothing matches ${typed.toUpperCase()}.`);
      drain();
      return;
    }
    const sku = found.data;
    // ids EMPTY is inv-adjust's "put it somewhere it isn't yet" path: it mints a free, unallocated row from the catalogue. That is the
    // right shape even when the code IS already on this rack — a second free row joins the same cluster and the panel re-collapses it.
    const res = await adjustStock({ code: sku.code, location, delta: qty, ids: [] });
    inFlight.current = false;
    setBusy(false);
    if (res.success) say('ok', `Put ${qty} × ${sku.code}${sku.title ? ` (${sku.title})` : ''} on ${location}.`, { code: sku.code });
    else say('bad', res.error || `Could not put ${sku.code} on ${location}.`);
    await reread();
    // Whatever was fired while that was in the air goes now, in the order it was fired.
    drain();
  }

  // ---- Transfer: an armful off this rack and onto another one. --------------------------------------------------------------
  //
  // POST /locations-transfer, which is a MOVE and not a remove plus an add, however much it reads like one: the row changes shelf and
  // keeps who it is promised to. That is the whole reason it is not two inv-adjust calls — see the route header.
  //
  // IT IS THE ONE UNDOABLE THING ON THIS SCREEN, so it is the one that does not ask first. A wrong rack is a shrug, not a hunt: the
  // route hands back the ids of the rows it actually landed there, and undo sends exactly those back the other way — never "whatever
  // is now sitting on that rack under this code", which could be somebody else's pick that happened to be the same size.
  //
  // THE BASKET IS FILLED AT ONE RACK AND EMPTIED ONTO ANOTHER. Both ways in fill it: the desk's chip button puts one line in it, and
  // in scan mode every shoe scanned adds one more. Either way the destination is chosen once, at the end.
  //
  // ONE CALL PER LINE, NOT ONE TRANSACTION. /locations-transfer moves one code, so emptying the basket loops it — the same shape the
  // bulk price move uses, and for the same reason: each line gets the route's own rules and its own audit line rather than a second
  // bulk write growing up beside the single one. The cost is that a basket can land half-moved, so it is reported that way, by name,
  // instead of as one cheerful total.
  function setBasket(next: TransferBasket | null) {
    basketRef.current = next;
    setTransfer(next);
  }

  function startTransfer(line: LocationStockLine, from: string) {
    setBasket({ from, items: [{ line, units: 1 }] });
    setAskAmazon(null);
    setFlash(null);
    setFind('');
  }

  // One more pair into the basket. The cap is what is ON THE SHELF: you cannot carry off three of a size the rack holds two of, and
  // finding that out from a failed write after the walk is the wrong time.
  function addToBasket(line: LocationStockLine, from: string): boolean {
    const basket = basketRef.current && basketRef.current.from === from ? basketRef.current : { from, items: [] };
    const at = basket.items.findIndex((i) => i.line.key === line.key);
    if (at >= 0) {
      if (basket.items[at].units >= line.qty) {
        say('bad', `${line.code} — only ${line.qty} on ${from}, and ${line.qty === 1 ? 'it is' : 'they are'} already in hand.`);
        return false;
      }
      const items = [...basket.items];
      items[at] = { ...items[at], units: items[at].units + 1 };
      setBasket({ from, items });
    } else {
      setBasket({ from, items: [...basket.items, { line, units: 1 }] });
    }
    return true;
  }

  function cancelTransfer() {
    setBasket(null);
    setAskAmazon(null);
  }

  // A destination was clicked or scanned. C3-Amazon is the one that does not just happen: per amz-pick-allocate.js a row is on the
  // Amazon gather list BECAUSE it is not at the bay yet, so putting a unit there quietly does a Pick, and taking one out puts it back
  // on the list. Same treatment the empty gets — say what it does, then let them decide.
  function chooseDestination(to: string) {
    const basket = basketRef.current;
    if (!basket || to === basket.from) return;
    // A rack the racks table does not know is not somewhere a shoe can be PUT — 'Ordered' is a marker meaning the units are still with
    // the supplier, not a shelf. Stock can come off one, which is a real tidy-up, so those racks stay selectable in the normal way and
    // are refused only as a destination. The route refuses it too (BAD_SHELF); this is so the operator never gets that far.
    if (!racks.find((r) => r.location === to)?.known) {
      say('bad', `${to} is not a rack — stock can come off it, but not go onto it.`);
      return;
    }
    if (areaOf(to) === 'C3-Amazon') { setAskAmazon(to); return; }
    completeTransfer(to);
  }

  async function completeTransfer(to: string) {
    const basket = basketRef.current;
    if (!basket || inFlight.current) return;
    const { from, items } = basket;
    const asked = items.reduce((n, i) => n + i.units, 0);
    setBasket(null);
    setAskAmazon(null);
    setPicked(null);
    inFlight.current = true;
    setBusy(true);

    // What actually landed, line by line, so the undo sends back exactly those rows and the message can name what did not go.
    const moved: { code: string; ids: string[]; units: number }[] = [];
    const failed: string[] = [];
    const short: string[] = [];   // moved, but fewer than asked — the cluster had been picked from under us
    let movedUnits = 0;
    let landed = to;
    for (const item of items) {
      const res = await transferStock({ code: item.line.code, from, to, ids: item.line.ids, units: item.units });
      if (res.success && res.data && res.data.moved > 0) {
        // `moved` is what the route ACTUALLY shifted — it caps at what the cluster still held, so a size someone else picked from a
        // moment ago comes back short. Reporting anything else here would be reporting our own intention as fact.
        moved.push({ code: item.line.code, ids: res.data.movedIds, units: res.data.moved });
        movedUnits += res.data.moved;
        landed = res.data.to;
        if (res.data.moved < item.units) short.push(`${item.line.code} (${res.data.moved} of ${item.units})`);
      } else {
        failed.push(item.line.code);
      }
    }
    inFlight.current = false;
    setBusy(false);

    const pairs = (n: number) => `${n} ${n === 1 ? 'pair' : 'pairs'}`;
    if (moved.length > 0) {
      const undo = () => undoTransfer(from, landed, moved);
      // A basket of one code can still print its shelf count in the band; several cannot without picking a favourite, so it does not.
      const code = moved.length === 1 ? moved[0].code : undefined;
      if (failed.length === 0 && short.length === 0) {
        say('ok', `Moved ${pairs(movedUnits)} from ${from} to ${landed}.`, { code, undo });
      } else if (failed.length === 0) {
        say('pending', `Moved ${movedUnits} of ${asked} from ${from} to ${landed} — ${short.join(', ')} had less on the shelf than that.`, { code, undo });
      } else {
        // Amber, not red: most of it worked. Naming the ones that did not is the whole value of the message — those pairs are still
        // on the old shelf and somebody has to know which.
        say('pending', `Moved ${movedUnits} of ${asked} from ${from} to ${landed} — ${[...failed, ...short].join(', ')} did not all move.`, { code, undo });
      }
    } else {
      say('bad', `Could not move ${failed.join(', ')} to ${to}.`);
    }
    await reread();
    drain();
  }

  // The same route, the other way round, with the ids it just handed us. An undo that fails says so and leaves the flash alone —
  // there is nothing to fall back to, and re-reading shows the truth either way.
  async function undoTransfer(from: string, to: string, moved: { code: string; ids: string[]; units: number }[]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const back: string[] = [];
    const stuck: string[] = [];
    for (const m of moved) {
      const res = await transferStock({ code: m.code, from: to, to: from, ids: m.ids, units: m.units });
      (res.success ? back : stuck).push(m.code);
    }
    inFlight.current = false;
    setBusy(false);
    if (stuck.length === 0) say('ok', `Put ${back.length === 1 ? back[0] : `${back.length} lines`} back on ${from}.`, { code: back.length === 1 ? back[0] : undefined });
    else say('bad', `Could not put ${stuck.join(', ')} back on ${from}.`);
    await reread();
    drain();
  }

  // Changing area drops the rack with it — a shelf in C1 is not a thing you are still looking at once you have moved to C3-Front.
  // EXCEPT MID-TRANSFER, when the areas are how you reach the rack you are moving TO: the source has to stay put underneath, or
  // walking to another zone would cancel the move you are in the middle of making.
  function goToArea(a: string) {
    setArea(a);
    if (transfer) return;
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

  // ---- ONE SCAN, ONE MEANING (owner, 2026-09-11) ------------------------------------------------------------------------------
  //
  // Both boxes on this screen took a gun — the rack finder and the add box — and which one had the caret depended on the last thing
  // clicked, which from two metres away is invisible. So a rack label fired into the add box came back "Nothing matches LC-58", and a
  // shoe fired into the finder quietly filtered the aisle instead of going on the shelf. Neither of those failures looks like a
  // failure from where the operator is standing.
  //
  // Every scan and every Enter now arrives HERE, and WHAT was scanned decides what it means:
  //   1. a rack's printed barcode          -> stand at that rack (mid-transfer: that is the destination)
  //   2. a rack's name, exactly            -> the same
  //   3. LC-shaped but matching no rack    -> refused out loud. A shelf label is never a shoe, and guessing would send it off to be
  //                                           looked up as a SKU and report the wrong failure.
  //   4. narrows the racks to exactly one  -> that rack. The typed search the find box has always done, except it now spans the whole
  //                                           building rather than the open area: a scan is a statement about where you are standing,
  //                                           and you can walk into another zone without telling the screen first.
  //   5. anything else                     -> a shoe, onto the rack in front of you.
  //
  // Rule 5 is the flow change: holding a shoe at a shelf, scanning it IS putting it there. There is no button left in the gesture.
  function rackFor(typed: string): string | null {
    const scan = normaliseScan(typed);
    const low = typed.trim().toLowerCase();
    const byLabel = racks.find((r) => r.barcode && normaliseScan(r.barcode) === scan);
    if (byLabel) return byLabel.location;
    const byName = racks.find((r) => r.location.toLowerCase() === low);
    if (byName) return byName.location;
    const narrowed = racks.filter((r) => r.location.toLowerCase().includes(low) || (r.barcode ?? '').toLowerCase().includes(low));
    return narrowed.length === 1 ? narrowed[0].location : null;
  }

  // The gate, and the only place that asks whether a write is in the air. runScan must NOT ask — draining the queue calls it from
  // inside the very write that was blocking it, where the answer would still be yes.
  function onScan(raw: string, qty = 1) {
    const typed = raw.trim();
    if (!typed) return;
    if (inFlight.current) {
      if (queued.current === null) {
        queued.current = { typed, qty };
        say('pending', `Holding ${typed.toUpperCase()} — the one before it is still being written.`);
      } else {
        say('bad', 'Too fast — that scan was not taken. Scan it again.');
      }
      return;
    }
    runScan(typed, qty);
  }

  function runScan(typed: string, qty: number) {
    // The basket off the ref, not off state: `drain` runs this from inside the write that was blocking it, where the `transfer` of a
    // render ago is what a closure would hand you.
    const basket = basketRef.current;
    const to = rackFor(typed);
    if (to) {
      if (basket) chooseDestination(to);
      else { goToRack(to); beep(true); }
      return;
    }
    if (RACK_LABEL.test(typed)) { say('bad', `No rack carries the label ${typed.toUpperCase()}.`); return; }
    // A SHOE SCANNED WITH A BASKET IN YOUR HANDS GOES INTO THE BASKET, whatever verb is showing. This used to refuse it — "that is not
    // a rack" — which was right while a transfer was a single shoe and the only thing left to answer was where it went. It is not
    // right now: the second pair of an armful is the commonest scan there is, and buzzing at it makes the basket a basket of one.
    if (basket) { pickUpScanned(basket.from, typed); return; }
    if (!selected) { say('bad', `Scan a rack first — ${typed.toUpperCase()} has nowhere to go yet.`); return; }
    // WHICH VERB IS IN FORCE decides what a shoe means. The desk has no verb — its add box is the only place a scan can arrive — so
    // it adds, exactly as it always did.
    if (!scanMode || action === 'add') { addStock(selected, typed, qty); return; }
    if (action === 'remove') { removeScanned(selected, typed); return; }
    pickUpScanned(selected, typed);
  }

  // Both Remove and Transfer start the same way: turn the scan into a code (a barcode is not a SKU), then find that code ON THIS
  // RACK. Resolving before looking means an unreadable scan is reported as an unreadable scan and a readable one that simply is not
  // on this shelf is reported as that — two different problems, fixed two different ways, and from two metres away the operator only
  // gets the sentence.
  async function findOnRack(location: string, typed: string): Promise<LocationStockLine | null> {
    const found = await findLocationSku(typed);
    if (!found.success || !found.data) { say('bad', found.error || `Nothing matches ${typed.toUpperCase()}.`); return null; }
    const { code } = found.data;
    for (const state of STATE_PREFERENCE) {
      const hit = lines.find((l) => l.code === code && l.state === state);
      if (hit) return hit;
    }
    say('bad', `${code} is not on ${location}.`);
    return null;
  }

  // REMOVE: one pair off, per scan. The same inv-adjust write the chip's minus button makes — one route, one set of rules — with the
  // scan standing in for the click. Never more than one a scan, whatever the pairs box says: that box is for putting a box of twelve
  // on a shelf, and there is no equivalent errand in the other direction.
  async function removeScanned(location: string, typed: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const line = await findOnRack(location, typed);
    if (!line) { inFlight.current = false; setBusy(false); drain(); return; }
    const res = await adjustStock({ code: line.code, location, delta: -1, ids: line.ids });
    inFlight.current = false;
    setBusy(false);
    if (res.success) {
      // Naming the state only when it is not FREE: on a free pair it is noise, and on the other two it is the thing the operator has
      // to know they have just done.
      say('ok', `Took one ${line.code} off ${location}${line.state === 'FREE' ? '' : ` — it was ${STATE_WORD[line.state]}`}.`, { code: line.code });
    } else {
      say('bad', res.error || `Could not take ${line.code} off ${location}.`);
    }
    await reread();
    drain();
  }

  // TRANSFER, first half: the shoe goes in your hand. The second half is a rack scan, which lands in `chooseDestination` above like
  // any other — so the two-scan gesture reuses the move the chip's Transfer button already makes, warnings and undo included.
  async function pickUpScanned(location: string, typed: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const line = await findOnRack(location, typed);
    inFlight.current = false;
    setBusy(false);
    if (line) {
      // The first scan starts the basket and every one after adds to it — the operator is doing the same thing each time, and a
      // basket that behaved differently on the second shoe is one you would have to think about.
      if (!basketRef.current) { setAskAmazon(null); setFlash(null); setFind(''); }
      if (addToBasket(line, location)) beep(true);
    }
    drain();
  }

  // Changing verb drops anything half done. A shoe picked up for a transfer is not a shoe you still meant to pick up once you have
  // decided you are removing instead.
  function chooseAction(next: ScanAction) {
    setAction(next);
    if (transfer) cancelTransfer();
    setFlash(null);
    scanRef.current?.focus();
  }

  // Whatever was fired while the last write was in the air. Called at the END of each write, after the re-read, so the held scan is
  // decided against the shelf as it now is rather than as it was when the gun went off.
  function drain() {
    const held = queued.current;
    queued.current = null;
    if (held) runScan(held.typed, held.qty);
  }

  // FIRE THE SCAN BOX. It is a function and not the form's onSubmit because IMPLICIT FORM SUBMISSION DOES NOT HAPPEN when a form has
  // more than one field and no submit button — and this form grows a second field (pairs per scan) on Add. So Enter worked in Remove
  // and Transfer and did nothing at all in Add, which is a gun that looks broken on the one verb it is used for most. Enter is now
  // handled on the inputs themselves and preventDefault'd, so there is exactly one path in whatever the form happens to contain.
  //
  // The pairs box is read BEFORE it is reset, because state set here is not readable until the next render.
  function submitScan() {
    const v = scanValue.trim();
    if (!v) return;
    const qty = scanQty;
    setScanValue('');
    setScanQty(1);
    onScan(v, qty);
  }

  // Enter fires the scan, Escape clears it and backs out of a half-made transfer. Shared by both boxes in the scan bar so the pairs
  // field is not a place Enter quietly dies.
  function onScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setScanValue(''); if (transfer) cancelTransfer(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submitScan();
  }

  // Enter in the find box. Escape still clears it, and still cancels a transfer.
  function onFindKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setFind(''); if (transfer) cancelTransfer(); return; }
    if (e.key !== 'Enter') return;
    const typed = find.trim();
    if (!typed) return;
    setFind('');
    onScan(typed);
  }

  const emptyRacks = racks.filter((r) => r.units === 0).length;

  // The count the answer band prints is READ OFF THE SHELF rather than added up from the delta we just sent, so it is still true after
  // the re-read — and if someone else picked from the same rack in between, it says what is there now instead of what we hoped.
  const transferUnits = transfer ? transfer.items.reduce((n, i) => n + i.units, 0) : 0;
  const flashQty = flash?.code ? lines.filter((l) => l.code === flash.code).reduce((n, l) => n + l.qty, 0) : null;

  // WHAT IS ON THE RACK IS A DESK QUESTION. Scan mode never shows the shelf — see SCALE for why — so the whole right-hand pane is
  // gone there, and the aisle list stays only while it is something to DO: the way into a rack when none is chosen, and the fallback
  // destination picker mid-transfer when a shelf label will not scan. Once you are standing at a rack with a verb chosen, the screen
  // is three buttons, a rack name and a box.
  const verb = ACTIONS.find((a) => a.key === action) ?? ACTIONS[0];
  const showShelf = !scanMode;
  const showAside = !scanMode || !selected || !!transfer;
  const twoCol = showAside && showShelf;

  // THE CARET LIVES IN THE SCAN BOX, and only scan mode gets that discipline. Every action here — picking a chip, finishing a
  // transfer, dismissing the answer — used to leave focus wherever it landed, so the next scan went nowhere and, from two metres,
  // looked exactly like the gun failing to fire. At the desk the mouse is in the operator's hand and stealing focus is the rude
  // behaviour rather than the helpful one, so nothing changes there. A confirm is the one exception: its own button wants the focus.
  useEffect(() => {
    if (scanMode && !confirmEmpty && !askAmazon) scanRef.current?.focus();
  }, [scanMode, selected, transfer, picked, busy, confirmEmpty, askAmazon]);

  // Walk to the line that just changed. The shelf is rebuilt from the server after every write and a 43-row rack gives no clue which
  // row moved; the ring says which one, and this puts it in front of you instead of making you find it again.
  useEffect(() => {
    if (flash?.code) touchedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flash?.code, stockData]);

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
              'rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' + T.area + ' ' +
              (a === activeArea ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')
            }
          >
            {AREA_LABEL[a] ?? a}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-3 text-sm text-slate-400">
          {racks.length > 0 && <span className="text-xs max-sm:hidden">{racks.length} racks · {emptyRacks} empty</span>}
          {/* THE MODE SWITCH. It is a real change of screen rather than a preference, so it is a filled button when it is on and says
              its own name — an operator who walks up to a machine someone else left in scan mode should be able to see why it looks
              like that, and press the same thing to get their desk back. */}
          <button
            type="button"
            onClick={() => {
              const next = !scanMode;
              setScanMode(next);
              window.localStorage.setItem(SCAN_KEY, next ? 'on' : 'off');
            }}
            title="Add, remove or transfer by scanning — for working at the shelving with a gun. Switch it off for the shelf view."
            className={
              'rounded-lg px-3 py-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
              (scanMode ? 'bg-brand-600 text-white' : 'text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50')
            }
          >
            {scanMode ? 'Scan mode' : 'Shelf view'}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !sound;
              setSound(next);
              window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
            }}
            className="text-xs underline-offset-2 hover:text-slate-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {sound ? 'Sound on' : 'Sound off'}
          </button>
        </span>
      </div>

      {/* ---- SCAN MODE — three verbs, a rack, and a box. -------------------------------------------------------------------
              What is on the rack is deliberately NOT here (owner, 2026-09-11). At the shelving the shelf is in front of your face;
              reading 43 rows of it back off a monitor two metres away is work nobody asked for. What you cannot see from there is
              whether the gun landed — so that is all this says, at a size that reads across the room.

              THE ORDER OF THE THREE STRIPS IS LOAD-BEARING: verb, rack, box, and only then the answer. The box never moves, because
              it is the thing the operator aims at; the answer appears under it when there is one and is not there the rest of the
              time. It used to sit ABOVE the box carrying an idle "scan a shoe to put it on C3-Front-19", which read as the field
              itself (owner: "I keep thinking I need to scan in there") and pushed the real box down the screen when a message
              arrived. The instruction now lives in the box, as its placeholder, where the thing it is instructing you to do is.

              THERE IS NO "SCAN A RACK TO START" (owner, 2026-09-11: "we barely do that"). Rack labels are scanned rarely — the rack is
              picked off the list — so opening on a box that would only accept a shelf label meant the first shoe scanned came back
              "scan a rack first", which reads as the screen being broken. The station does not exist without a rack now: no rack, no
              verbs and no box, just the list to pick one from. A rack label scanned INTO the box still moves you; it is simply no
              longer advertised as the way in. ---- */}
      {scanMode && rack && (
        <div
          className="flex flex-col gap-3"
          // THE CARET COMES BACK ON ITS OWN. A stray click on the panel — or on the rack card — used to leave the gun firing into
          // nothing, which from two metres looks exactly like a dead scanner. Anything that is not itself a control hands focus back.
          onMouseUp={(e) => {
            if ((e.target as HTMLElement).closest('button, input, a')) return;
            scanRef.current?.focus();
          }}
        >
          {/* THE VERB IN FORCE, and the only thing on this screen with three colours. "Which one am I in" is the question that costs a
              pair when it is answered wrong, so the live one is FILLED — from two metres a border is not a state — and each takes the
              colour the rest of the platform already gives it: rose takes stock away, brand moves it, emerald puts it on. */}
          <div className="grid grid-cols-3 gap-2">
            {ACTIONS.map((a) => {
              const on = a.key === action;
              const live = a.key === 'remove' ? 'bg-rose-600 text-white' : a.key === 'transfer' ? 'bg-brand-600 text-white' : 'bg-emerald-600 text-white';
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => chooseAction(a.key)}
                  className={
                    'rounded-xl py-3 text-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500 ' +
                    (on ? live : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50')
                  }
                >
                  {a.label}
                </button>
              );
            })}
          </div>

          {/* WHERE YOU ARE STANDING. The rack's name at reading size and how MUCH is on it — not what, just the total, which is the one
              number that confirms you are at the shelf you think you are. */}
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-3xl font-semibold tracking-tight text-slate-900">{rack.location}</span>
                {!rack.known && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">not a shelf</span>
                )}
              </div>
              <div className="text-sm text-slate-400">
                <span className="tabular-nums">{units}</span> {units === 1 ? 'unit' : 'units'} on it{rack.barcode ? ` · ${rack.barcode}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { if (transfer) cancelTransfer(); setChosen(null); setFlash(null); }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-base font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <ArrowLeftIcon className="h-5 w-5" /> Change rack
            </button>
          </div>

          {/* ONE BOX, ALWAYS THE SAME BOX, AND IT NEVER MOVES. What a scan means is decided by what it IS (a rack label or a shoe) and
              by the verb above it — never by which field has the caret, because from the shelving you cannot see which field has the
              caret. The icon is a scan code and not a magnifying glass on purpose: a magnifier had it read as a search box, which is
              the one thing it is not (owner). */}
          <form onSubmit={(e) => { e.preventDefault(); submitScan(); }} className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <QrCodeIcon className="pointer-events-none absolute left-4 top-1/2 h-7 w-7 -translate-y-1/2 text-slate-400" />
              <input
                ref={scanRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={onScanKey}
                autoFocus
                placeholder={transfer ? 'Scan another pair, or the rack they go on' : verb.hint(rack.location)}
                className="w-full rounded-xl border-2 border-slate-300 py-3.5 pl-14 pr-4 text-xl placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
            {/* Pairs per scan, and ONLY on Add — it is for putting a box of twelve on a shelf, and there is no errand in the other
                direction that a gun cannot do one pair at a time. It snaps back to 1 after every scan, so a 12 typed once can never
                quietly multiply the shoe scanned after it. */}
            {action === 'add' && !transfer && (
              <input
                type="number"
                min={1}
                max={MAX_ADD}
                value={scanQty}
                onChange={(e) => setScanQty(Math.min(MAX_ADD, Math.max(1, Number(e.target.value) || 1)))}
                onKeyDown={onScanKey}
                aria-label="Pairs per scan"
                className="w-20 rounded-xl border-2 border-slate-300 px-3 py-3.5 text-center text-xl tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            )}
          </form>

          {/* THE ANSWER, and only when there IS one. It stays until the next scan rather than fading — you are not always looking when
              it arrives — and it prints the number the job is actually checking: what is on the shelf NOW, read back off the re-read
              rather than added up from the delta we just sent. Mid-transfer it says what is in your hand instead, because that is then
              the live question and there is no result yet to report. */}
          {(flash || transfer) && (
            <div
              className={
                'flex items-center gap-4 rounded-xl border px-5 py-3 ' +
                (transfer ? 'border-brand-300 bg-brand-50 text-brand-900'
                  : flash?.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : flash?.tone === 'pending' ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900')
              }
            >
              <p className="min-w-0 flex-1 text-lg leading-snug">
                {transfer ? (
                  <>
                    Holding {transferUnits} {transferUnits === 1 ? 'pair' : 'pairs'} off {transfer.from} — keep scanning, or scan the rack
                    {transferUnits === 1 ? ' it goes' : ' they go'} on.
                    {/* The armful itself, so you can see a size went in without counting the beeps. */}
                    <span className="mt-1 block font-mono text-sm text-brand-700">
                      {transfer.items.map((i) => `${i.line.code}${i.units > 1 ? ` ×${i.units}` : ''}`).join('   ·   ')}
                    </span>
                    {transfer.items.some((i) => i.line.state !== 'FREE') && (
                      <span className="block text-sm text-brand-700">
                        Some are picked or allocated to Amazon — they stay that way wherever they go.
                      </span>
                    )}
                  </>
                ) : flash?.text}
              </p>
              {!transfer && flashQty !== null && selected && (
                <span className="shrink-0 text-right leading-none">
                  <span className="text-3xl font-semibold tabular-nums">{flashQty}</span>
                  <span className="ml-1.5 text-base">on {selected}</span>
                </span>
              )}
              {transfer ? (
                <button
                  type="button"
                  onClick={cancelTransfer}
                  className="shrink-0 rounded-md px-2.5 py-1.5 text-base font-medium hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  Cancel
                </button>
              ) : flash?.undo ? (
                <button
                  type="button"
                  onClick={flash.undo}
                  disabled={busy}
                  className="shrink-0 rounded-md px-2 py-1 text-lg font-semibold underline underline-offset-2 hover:bg-black/5 disabled:opacity-40"
                >
                  Undo
                </button>
              ) : null}
            </div>
          )}

          {/* The one destination that is not just a shelf — the same question the desk asks, asked here in the same words. */}
          {askAmazon && (
            <div className="overflow-hidden rounded-xl border border-amber-200">
              <ConfirmAmazonBay
                what={transfer ? (transfer.items.length === 1 ? transfer.items[0].line.code : `${transferUnits} pairs`) : ''}
                to={askAmazon}
                onConfirm={() => completeTransfer(askAmazon)}
                onCancel={() => setAskAmazon(null)}
              />
            </div>
          )}
        </div>
      )}

      {racksError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          Could not load the racks: {racksError.message}
        </div>
      )}

      {(showAside || showShelf) && (
      <div className={'grid min-h-0 flex-1 gap-3 ' + (twoCol ? 'lg:grid-cols-[17rem_minmax(0,1fr)]' : 'grid-cols-1')}>
        {/* ---- The racks. Permanent furniture: this is the screen's subject, so it never collapses into a dropdown. ---- */}
        {showAside && (
        <aside className={
          'flex min-h-0 flex-col overflow-hidden rounded-xl border bg-white transition ' +
          (transfer ? 'border-brand-400 ring-1 ring-brand-300' : 'border-slate-200')
        }>
          {/* THE RACK LIST IS THE DESTINATION PICKER. There is no second widget for "where to", because the racks are already on
              screen, in walking order, with their counts — the thing you would have had to build a dropdown to show. Mid-transfer the
              list changes what a click MEANS, and says so, rather than changing what it looks like. */}
          {transfer && (
            <div className="flex shrink-0 items-center gap-2 border-b border-brand-200 bg-brand-50 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-brand-800">Transfer to which rack?</span>
              <button
                type="button"
                onClick={cancelTransfer}
                className="shrink-0 rounded p-0.5 text-brand-700 hover:bg-brand-100"
                title="Cancel the transfer"
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {/* THE WAY INTO A RACK, in both modes. It used to be hidden in scan mode so there was only ever one place a scan could land,
              but the aisle list is now the ONLY way in there — racks are picked, not scanned (owner) — and a list of 72 you can only
              scroll is not a picker. The old two-guns-one-caret hazard went with the resolver anyway: Enter here runs the same
              `onScan`, so the two boxes cannot disagree about what a scan means. */}
          <div className="relative shrink-0 border-b border-slate-100 p-2">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-4 h-4 w-4 text-slate-400" />
            <input
              ref={findRef}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={onFindKey}
              placeholder={transfer ? 'Scan the rack it goes on' : 'Find a rack, or scan its label'}
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

          {/* The list is the entire screen in scan mode until a rack is chosen, so there it says what it is for. Nothing in desk mode,
              where it sits beside a shelf panel that explains it. */}
          {scanMode && !selected && (
            <div className="shrink-0 border-b border-slate-100 px-3 py-2 text-base font-medium text-slate-500">Pick a rack</div>
          )}

          {/* Walked in pickorder, which is the order the racks stand in — so scrolling this list is walking the aisle. */}
          <ul className="min-h-0 flex-1 overflow-y-auto py-1 max-lg:max-h-64">
            {racksLoading && <li className="px-3 py-6 text-center text-sm text-slate-400">Loading racks…</li>}
            {!racksLoading && listed.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-400">No rack matches that.</li>
            )}
            {listed.map((r) => {
              const on = r.location === selected;
              // The rack the shoe is coming OFF is not somewhere it can go. Marked and inert rather than hidden: it is the one you are
              // standing at, and a list that quietly loses a rack mid-move is a list you stop trusting.
              const source = transfer?.from === r.location;
              // The count comes straight off the rack list, which is re-read after every write — so it agrees with the panel because
              // both were told by the server, not because the client kept them in step.
              const n = r.location === selected ? units : r.units;
              return (
                <li key={r.location}>
                  <button
                    type="button"
                    disabled={source}
                    onClick={() => (transfer ? chooseDestination(r.location) : goToRack(r.location))}
                    className={
                      'flex w-full items-center gap-2 text-left transition focus-visible:outline-none focus-visible:bg-slate-100 ' + T.rackRow + ' ' +
                      (source
                        ? 'cursor-default bg-slate-50 text-slate-400'
                        : transfer
                          ? 'text-slate-700 hover:bg-brand-50 hover:font-semibold hover:text-brand-700'
                          : on ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700 hover:bg-slate-50')
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{r.location}</span>
                    {source && <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">from here</span>}
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
        )}

        {/* ---- The shelf itself. ---- */}
        {showShelf && (
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
                  <span><span className="font-semibold tabular-nums text-slate-900">{units}</span> {units === 1 ? 'unit' : 'units'}</span>
                  <span className="tabular-nums">{shelf.length} {shelf.length === 1 ? 'style' : 'styles'}</span>
                  {/* QUIET UNTIL IT IS ASKED FOR. The one button on this screen that cannot be undone gets no red, no fill and no
                      prominence — it sits last, in slate, and only turns red once it has been pressed and the footer is asking. A
                      destructive control that shouts is one that gets pressed by mistake; the weight belongs on the confirm, not on
                      the way in. Hidden entirely on an empty rack: there is nothing to take off. */}
                  {serverUnits > 0 && !transfer && (
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
                    {shelf.map((s) => {
                      // The line the last write touched. It keeps its ring until the next action, the same rule the answer band
                      // follows — "where did that shoe land" is not a question to blink at someone for three seconds.
                      const touched = !!flash?.code && s.chips.some((c) => c.code === flash.code);
                      return (
                      <li
                        key={s.key}
                        ref={touched ? touchedRef : undefined}
                        className={'flex items-center gap-3 px-4 py-1.5 hover:bg-slate-50/70' + (touched ? ' bg-brand-50/70' : '')}
                      >
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
                              disabled={!!transfer}
                              onClick={() => setPicked(picked === c.key ? null : c.key)}
                              title={`${c.code} · ${c.qty} ${c.qty === 1 ? 'pair' : 'pairs'} · ${STATE_WORD[c.state]}`}
                              className={
                                'inline-flex min-w-[2.1rem] items-center justify-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' +
                                CHIP_STATE[c.state] +
                                (picked === c.key ? ' ring-2 ring-brand-500' : '') +
                                // Mid-transfer the shelf is not what is being chosen from — the rack list is — so the chips stop
                                // inviting a click rather than accepting one the footer has no room to answer.
                                (transfer && picked !== c.key ? ' opacity-40' : '')
                              }
                            >
                              {c.size}
                              {c.qty > 1 && <span className="text-[10px] opacity-60">×{c.qty}</span>}
                            </button>
                          ))}
                        </div>
                        <span className="w-6 shrink-0 text-right text-sm tabular-nums text-slate-400">{s.units}</span>
                      </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* What just happened, said once, where the thing happened. It stays until the next action rather than fading, because
                  "I took 14 units off a shelf" is not a thing to blink at someone for three seconds. */}
              {flash && (
                <div
                  className={
                    'flex shrink-0 items-start gap-2 border-t px-4 py-2 text-sm ' +
                    // Amber is its own outcome, not a soft red: "this would have worked, and nothing happened" is a different thing
                    // from a failure, and on a screen where every other button writes it is the one that must not be mistaken for one.
                    (flash.tone === 'ok' ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
                      : flash.tone === 'pending' ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : 'border-rose-100 bg-rose-50 text-rose-800')
                  }
                >
                  <span className="min-w-0 flex-1">{flash.text}</span>
                  {/* Undo sits IN the sentence that reports the move, because that is the moment you realise it was the wrong rack. It
                      is offered by transfers only — nothing else here can be taken back — and it disappears with the message. */}
                  {flash.undo && (
                    <button
                      type="button"
                      onClick={flash.undo}
                      disabled={busy}
                      className="shrink-0 rounded px-1.5 py-0.5 text-sm font-semibold underline underline-offset-2 hover:bg-black/5 disabled:opacity-40"
                    >
                      Undo
                    </button>
                  )}
                  <button type="button" onClick={() => setFlash(null)} className="shrink-0 rounded p-0.5 hover:bg-black/5">
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* ONE FOOTER, THREE MODES. Adding is the default because it is what you come to a shelf holding a box to do; picking a
                  chip swaps in that unit's controls, and asking to empty the rack swaps in the confirm. Same strip, same position, so
                  nothing moves and there is never a dialog over the shelf you are deciding about. */}
              <div className="shrink-0 border-t border-slate-100 bg-slate-50">
                {askAmazon ? (
                  <ConfirmAmazonBay
                    what={transfer ? (transfer.items.length === 1 ? transfer.items[0].line.code : `${transferUnits} pairs`) : ''}
                    to={askAmazon}
                    onConfirm={() => completeTransfer(askAmazon)}
                    onCancel={() => setAskAmazon(null)}
                  />
                ) : transfer ? (
                  <TransferBar basket={transfer} units={transferUnits} onCancel={cancelTransfer} />
                ) : confirmEmpty ? (
                  <ConfirmEmpty
                    location={rack.location}
                    units={serverUnits}
                    picked={serverPicked}
                    amz={serverAmz}
                    busy={busy}
                    onConfirm={() => doEmpty(rack.location)}
                    onCancel={() => setConfirmEmpty(false)}
                  />
                ) : pickedLine ? (
                  <PickedChip
                    line={pickedLine}
                    busy={busy}
                    onAdjust={(d) => adjust(rack.location, pickedLine, d)}
                    onTransfer={() => startTransfer(pickedLine, rack.location)}
                    onDone={() => setPicked(null)}
                  />
                ) : (
                  <AddToRack key={rack.location} location={rack.location} busy={busy} onAdd={addStock} />
                )}
              </div>
            </>
          )}
        </section>
        )}
      </div>
      )}
    </div>
  );
}

/*
The one irreversible thing on this screen, so it is the only place that spends any red.

WHAT IT SAYS IS THE WHOLE CONTROL. Picked and Amazon units are named separately because those are the two that cost something elsewhere: a picked unit is committed to a customer order
that still expects it, and clearing the shelf tells that order nothing (owner, 2026-09-10 — "everything, with a warning"). If the rack
holds neither, the sentence stays short rather than padding itself with two zeroes.

It sits in the footer like every other action rather than in a modal over the shelf. A dialog would cover the very thing being decided
about — you want to be able to look at the rack while reading the question.
*/
function ConfirmEmpty({ location, units, picked, amz, busy, onConfirm, onCancel }: {
  location: string;
  units: number;
  picked: number;
  amz: number;
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
The transfer, waiting for somewhere to go. It says the shoe and the shelf it is leaving, and then gets out of the way — the choice is
being made in the rack list to its left, so this bar is a reminder of what is in your hand, not a control in its own right.

Its one job beyond that is the way out. Cancel, or Escape in the search box, and nothing has happened.
*/
function TransferBar({ basket, units, onCancel }: { basket: TransferBasket; units: number; onCancel: () => void }) {
  // The desk fills the basket one chip at a time, so it is usually a basket of one and reads best said that way. A scan-mode basket
  // can land here too (the modes share the state), which is why it counts rather than assuming.
  const only = basket.items.length === 1 && basket.items[0].units === 1 ? basket.items[0].line : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-brand-50 px-4 py-2.5">
      <ArrowRightCircleIcon className="h-5 w-5 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-brand-900">
          Moving {only ? <>one <span className="font-mono font-medium">{only.code}</span></> : `${units} pairs`} off{' '}
          <span className="font-medium">{basket.from}</span> — pick the rack {units === 1 ? 'it goes' : 'they go'} on.
        </p>
        {basket.items.some((i) => i.line.state !== 'FREE') && (
          // Worth saying out loud, because it is the thing a move must not break: the unit stays promised to whatever claimed it.
          <p className="truncate text-xs text-brand-700">
            {only
              ? `${only.state === 'PICKED' ? 'Picked for a customer order' : 'Allocated to Amazon'} — it stays that way wherever it goes.`
              : 'Some are picked or allocated to Amazon — they stay that way wherever they go.'}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-2.5 py-1.5 text-sm text-brand-800 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        Cancel
      </button>
    </div>
  );
}

/*
The one destination that is not just a shelf. amz-pick-allocate.js puts it plainly — a row is on the Amazon gather list BECAUSE it is
not at the bay yet — so dropping a unit on C3-Amazon quietly marks it gathered, and lifting one off puts it back on the list. Goods In
refuses the bay as a manual destination outright for this reason; here it is allowed, because moving stock is the whole point of the
screen, but never silently.
*/
function ConfirmAmazonBay({ what, to, onConfirm, onCancel }: {
  what: string; to: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-amber-50 px-4 py-2.5">
      <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-amber-900">
          <span className="font-medium">{to}</span> is the Amazon staging bay. Putting{' '}
          <span className="font-mono">{what}</span> there takes them off the Amazon gather list.
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1.5 text-sm text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          Pick another rack
        </button>
        <button
          type="button"
          onClick={onConfirm}
          autoFocus
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          Put it in the bay
        </button>
      </div>
    </div>
  );
}

/*
The chip's controls. Named for the thing it acts on ("Arizona · 38"), because the alternative — a bare stepper — makes the operator
remember which chip they clicked while they are looking at their hands.

EVERY PRESS IS A WRITE — one inv-adjust call, audited to bclog — so both buttons go dead while one is in flight. A gun and a mouse can
both outrun a round-trip, and two presses racing each other against the same cluster is the one way to take off a pair you meant to
take off once.
*/
function PickedChip({ line, busy, onAdjust, onTransfer, onDone }: {
  line: LocationStockLine;
  busy: boolean;
  onAdjust: (delta: number) => void;
  onTransfer: () => void;
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
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <MinusSmallIcon className="h-4 w-4" /> Take one off
        </button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums text-slate-900">{line.qty}</span>
        <button
          type="button"
          onClick={() => onAdjust(1)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <PlusSmallIcon className="h-4 w-4" /> Put one on
        </button>
        {/* TRANSFER SITS AFTER THE TWO COUNTS because it is the rarer errand, and it is worded as the warehouse words it — the legacy
            PowerBuilder screen has been logging 'Transfer ... >> to ...' since May, so calling it anything else here would give one
            job two names across two apps. */}
        <button
          type="button"
          onClick={onTransfer}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <ArrowRightCircleIcon className="h-4 w-4" /> Transfer
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2.5 py-1.5 text-sm text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/*
Put a shoe on the chosen rack. Its own component, mounted under the rack's key, so the box empties when the rack changes — what you
were about to add to C1-04 should not follow you to C1-05.

ALWAYS OPEN, not behind an "add" link. On a screen whose job is moving stock on and off shelves, the add IS the screen — hiding it
costs a click on the most common action to save one strip of a panel the operator is already looking at.
*/
function AddToRack({ location, busy, onAdd }: {
  location: string;
  busy: boolean;
  onAdd: (location: string, scan: string, qty: number) => void;
}) {
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
        max={MAX_ADD}
        value={qty}
        // Clamped to inv-adjust's own MAX_DELTA rather than letting the write refuse it: the operator finds out here, before pressing.
        onChange={(e) => setQty(Math.min(MAX_ADD, Math.max(1, Number(e.target.value) || 1)))}
        aria-label="How many"
        className="w-14 rounded-md border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <button
        type="submit"
        disabled={!code.trim() || busy}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {busy ? 'Putting on…' : 'Put it on'}
      </button>
    </form>
  );
}
