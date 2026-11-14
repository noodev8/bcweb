'use client';
/*
=======================================================================================================================================
Page: /amz/buybox/deck  (Buy Box — PRICING, the cards; was "Go through" until 2026-11-13 — owner: "I dont like the word 'Go through'. We
         are pricing here". On screen "Pricing"; the route, code and docs file names keep "deck" / "go through". 2026-11-12, a TRIAL)
=======================================================================================================================================
Purpose: Every Amazon size IN STOCK AT AMAZON gets ONE answer (New · Raise · Cut · Leave · Not selling — PLAN.md decisions
         13–20, the staff guide "Buy Box Guide"); this screen works the three that make cards, ONE SIZE AT A TIME, each with one
         suggested move, so a price is changed LOOKING at the Buy Box. Laptop first, keys for everything (owner: "95% of our price
         changes will be on laptop"); big buttons so it also works on a phone — deliberately not a swipe app.
         Server routes/amz-buybox-deck.js, THE rules utils/amzBuyBoxDeck.js (which sizes, the suggestion, the order — read its header).

TABS: New (landed in the last 30 days, no Amazon sale yet — "get the first sale": a penny under the lead, floor break-even; never mixed
         with the other cards, shown by style in size order; the mood doesn't touch it) · Raise · Cut. Opens on New when it has cards.

MOOD: Fierce · Chilled · Climb, chosen A LEVEL ABOVE THE CARDS (owner, 2026-11-13: "We should drill down into the cards with a mood
         already chosen"): picked on the AMAZON PRICING HOME (/amz — the old Buy Box screen became it, 2026-11-13, PLAN.md decision 23)
         and carried in the link (?mood=), shown here as a badge (components/MoodSwitch → MoodBadge) with "Change" back to the home — no
         switch beside the cards. No ?mood= (an old link) = Chilled. The tabs
         keep the mood.

THE CARD is components/AmzCardFrame — THE one Amazon price card layout, shared with the Not selling / search cards (owner,
         2026-11-14: "the same layout and make it simpler"; read its header). What is this page's own: the box STARTS AT THE SUGGESTION;
         a reason line above it (the answer tag, the suggestion and %, why); the sellers pop-up (offers, BB tags); stock and sales on one
         line, the last price change on the next (it replaced the price line with dots — components/PriceLadder is kept, unused, in case
         it comes back as a History toggle); the review is the fixed 4-week date in the chips' place. Profit for a typed price comes from
         the server's profit line — no second copy of the formula. Warnings are advice, nothing blocks: a move over 15%, a raise to or past
         the next rival (the walk-away / floor, RRP and "not under the lead" warnings went with the trim, 2026-11-14; a loss shows red,
         over RRP is noted by the frame, the lead's price is on the Buy Box line).

SET = the normal W-A1 (POST /amz-apply), sent to Amazon at once; note "Buy Box Raise" / "Buy Box Cut" / "Buy Box New" (+ "own price"
         when the box was changed). Its `buybox` fields record the press and move the Amazon Due date 4 WEEKS out, keeping a later one
         (server-side — PLAN.md decision 16, "one door per answer"; replaced the 7-day park). A set size leaves the deck until a reading
         has seen its new price. LEAVE = POST /amz-buybox-leave: nothing sent, the same 4-week Due date, recorded; asks nothing. A left
         card comes back when its suggestion changes or after 7 days (server rule); going back to it this visit shows it live (Set or
         Leave again). UNDO = the price back to what Amazon showed at the reading (another W-A1, note "Buy Box undo", recorded); the Due
         date stays. Two people at once: the last price wins (0 clashes in 90 days).

THE LIST STAYS PUT while you work: the deck is the snapshot from when the page opened (no refetch on focus); Refresh reloads it — sizes
         set or left since then have gone, anything else comes back.

LAYOUT (2026-11-13, owner: "too busy … no need for the list to always show … glance at data and maybe see some colours but not too
         conflicting"; docs/amz-buybox/GO-THROUGH-LAYOUT.md is the record): ONE centred column read in the order you decide —
         toolbar (tabs, mood badge, reading age) · progress dots (one per card: hollow to do, green set, grey left, ringed current;
         click to jump — the full list is a DRAWER behind List / Q, closed on every load, lying over the page so the card never moves)
         · the card (AmzCardFrame, 2026-11-14 — was the move headline, the price ladder and three fact boxes) · a failure as one quiet
         line under the card. COLOUR: the answer's colour (New violet, Raise emerald, Cut rose) only on the tab dot and the reason tag;
         amber = look twice, red = a loss, emerald = Set. A phone gets the same card stacked, the decide row pinned to the bottom.

KEYS: the frame's (Enter = Set · → or L = Leave / Next · ← = previous card · E = edit the price · in the box ↑ / ↓ = ±30p) + U = undo
         the last set · Q = the list (Esc closes it).
=======================================================================================================================================
*/

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzCardFrame, { LastChangeLine } from '@/components/AmzCardFrame';
import { MoodBadge } from '@/components/MoodSwitch';
import { applyAmzPrice, getAmzBuyBoxDeck, leaveAmzBuyBox, type AmzDeckCard, type AmzDeckKind, type AmzMood, type AmzSendOutcome } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { useAuth } from '@/contexts/AuthContext';

// `dot` / `tag` = the answer's colour (LAYOUT, header) — the tab dot and the solid reason tag.
const DECKS: { key: AmzDeckKind; label: string; verb: string; tagText: string; rule: string; dot: string; tag: string }[] = [
  { key: 'new', label: 'New', verb: 'New', tagText: 'New · cut', rule: 'Landed at Amazon in the last 30 days, no Amazon sale yet — a penny under the lead to get the first sale (up to it when a dearer seller is shown, never over the RRP), never below break-even', dot: 'bg-violet-500', tag: 'bg-violet-600' },
  { key: 'raise', label: 'Raise', verb: 'Raise', tagText: 'Raise', rule: 'We have the Buy Box and the next rival is more than 2% above — a small step up (Chilled 5%, Climb 8%). Sold in 30 days', dot: 'bg-emerald-500', tag: 'bg-emerald-600' },
  { key: 'cut', label: 'Cut', verb: 'Cut', tagText: 'Cut', rule: 'A rival has the Buy Box at a price that still keeps us £3 a pair — a penny under it (Chilled: 2% over a self-poster)', dot: 'bg-rose-500', tag: 'bg-rose-600' },
];

// REVIEW (header): a Set or Leave moves the Due date to today + REVIEW_DAYS SERVER-SIDE (a later date kept). Worked out here only to
// say on a card that its later date is kept — YYYY-MM-DD in the UK calendar, taken once at module load (react-hooks/purity).
const REVIEW_DAYS = 28;
function isoInDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const REVIEW_ON = isoInDays(REVIEW_DAYS);
// '9 Nov' from a pg timestamp text or a YYYY-MM-DD date, in the UK calendar (a date-only string is taken as that calendar day).
function dayLabel(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, mo, d] = v.split('-').map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  const t = Date.parse(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }) : v;
}
const noSubscribe = () => () => {};   // useSyncExternalStore for the "hydrated yet?" flag (nothing to subscribe to)
const STALE_SALE_DAYS = 14;   // "last sold" goes amber at this many days (or never) — beside the strip

const BIG_MOVE = 0.15;   // a move over 15% gets a warning (amz-price-set.js refuses these without a flag; here it is advice)
const NEW_DAYS = 30;     // New: days from landing to get the first sale (server NEW_DAYS) — "n days left" on the Selling fact

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);
const pct = (from: number, to: number) => {
  const p = ((to - from) / from) * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
};
function toMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const t = Date.parse(ts.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isFinite(t) ? t : null;
}
function ago(ms: number | null, now: number): string {
  if (ms === null) return 'never';
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} days ago`;
}

type Done =
  | { kind: 'set'; price: number; amazon: AmzSendOutcome | null; warnings: string[] }
  | { kind: 'left' };

export default function AmzBuyBoxDeckPage() {
  const { logout } = useAuth();
  const gParam = useUrlParam('g');
  // Old links (?g=room / can_match) land on the matching tab.
  const gWanted: AmzDeckKind | null = gParam === 'new' ? 'new' : gParam === 'raise' || gParam === 'room' ? 'raise'
    : gParam === 'cut' || gParam === 'can_match' ? 'cut' : null;
  // MOOD (header): from the link — chosen on the Amazon Pricing home. useUrlParam reads null until hydrated, so the deck waits for the
  // client (`hydrated`) before fetching — else it would fetch Chilled first, then the real mood.
  const moodParam = useUrlParam('mood');
  const mood: AmzMood = moodParam === 'fierce' || moodParam === 'climb' ? moodParam : 'chilled';
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // A snapshot: nothing refetches by itself, so the deck doesn't reshuffle while you work. Refresh reloads it; each mood is its own key.
  const { data: raw, error: loadError, busy: isLoading, refresh } = useApiQuery(hydrated ? ['amz-buybox-deck', mood] : null, () => getAmzBuyBoxDeck(mood), {
    revalidateOnFocus: false, revalidateIfStale: false, revalidateOnMount: true, revalidateOnReconnect: false,
  });
  // FRESH ON EVERY OPEN (owner, 2026-11-13: Daily said 8 due, the screen showed 0 until Refresh — a copy from an earlier visit).
  // revalidateOnMount reads again on every open; until that read is in, nothing shows, so a card is never priced from the old copy.
  // Nothing refetches while you work (focus / reconnect off), so the list still stays put.
  const data = isLoading ? undefined : raw;

  const [done, setDone] = useState<Map<string, Done>>(() => new Map());
  const [cur, setCur] = useState<Partial<Record<AmzDeckKind, string>>>({});
  const [setOrder, setSetOrder] = useState<string[]>([]);   // codes set this visit, newest last — U undoes the last
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'err'; undo?: string } | null>(null);
  // The list drawer (LAYOUT, header): closed on every load, nothing stored. Q toggles it, Esc closes it (the card's own keys ignore both).
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); setListOpen((o) => !o); }
      else if (e.key === 'Escape') setListOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The tab: the link's, else New when it has cards (the guide: "Go through first, starting with the New tab"), else Raise.
  const deck: AmzDeckKind = gWanted ?? ((data?.counts?.new ?? 0) > 0 ? 'new' : 'raise');

  const cards = useMemo(() => (data?.cards ?? []).filter((c) => c.deck === deck), [data, deck]);
  const open = cards.filter((c) => !done.has(c.code));
  // THE TAB COUNTS = still to do (owner, 2026-11-13: "I fixed the NEW but the count in the little bar at the top didnt update") — the
  // snapshot's cards less those set or left on this visit, so a tab counts down as you work (was the server's fixed counts).
  const toDo = (k: AmzDeckKind) => (data ? data.cards.filter((c) => c.deck === k && !done.has(c.code)).length : null);
  // The current card: the one you moved to, else the first still to do.
  const current = cards.find((c) => c.code === cur[deck]) ?? open[0] ?? null;
  const index = current ? cards.indexOf(current) : -1;

  function go(code: string | null) { setCur((p) => ({ ...p, [deck]: code ?? undefined })); }
  // The next card still to do after `code` (wraps round to the top), or null when the deck is finished.
  function nextAfter(code: string, doneNow: Map<string, Done>): string | null {
    const i = cards.findIndex((c) => c.code === code);
    const order = [...cards.slice(i + 1), ...cards.slice(0, i)];
    return order.find((c) => !doneNow.has(c.code))?.code ?? null;
  }

  // The press details recorded with a Set / Leave / Undo (the agree rate, read later).
  const pressOf = (card: AmzDeckCard) => ({ mood, tab: card.deck, our_price: card.our_price, suggested: card.suggest });

  async function setPrice(card: AmzDeckCard, price: number, edited: boolean) {
    if (busy) return;
    setBusy(true); setMsg(null);
    const verb = DECKS.find((d) => d.key === card.deck)!.verb;
    const note = `Buy Box ${verb}${edited ? ' (own price)' : ''}`;
    // No reviewDays: the `buybox` fields make the server move the Due date 4 weeks out, keeping a later one.
    const res = await applyAmzPrice(card.code, price, note, null, { ...pressOf(card), action: 'set' });
    setBusy(false);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success || !res.data) { setMsg({ text: `${card.code}: ${res.error || 'could not set the price'}`, tone: 'err' }); return; }
    const amazon = res.data.amazon;
    const nextDone = new Map(done).set(card.code, { kind: 'set', price, amazon, warnings: res.data.warnings });
    setDone(nextDone);
    setSetOrder((o) => [...o.filter((c) => c !== card.code), card.code]);
    setMsg({
      text: `${card.code} set to ${money(price)} — ${amazon?.sent ? 'sent to Amazon' : amazon ? `saved, NOT sent: ${amazon.message}` : 'saved'}`,
      tone: amazon && !amazon.sent ? 'warn' : 'ok', undo: card.code,
    });
    go(nextAfter(card.code, nextDone));
  }

  // LEAVE (header): straight on to the next card while the write (Due date + record) runs behind it — Leave never slows the run.
  // If it fails, the card comes back undone with the reason on the result line.
  async function leave(card: AmzDeckCard) {
    const nextDone = new Map(done).set(card.code, { kind: 'left' });
    setDone(nextDone);
    go(nextAfter(card.code, nextDone));
    const res = await leaveAmzBuyBox(card.code, pressOf(card));
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success) {
      setDone((p) => { const n = new Map(p); if (n.get(card.code)?.kind === 'left') n.delete(card.code); return n; });
      setMsg({ text: `Leave ${card.code}: ${res.error || 'not saved'} — the card is back`, tone: 'err' });
    }
  }

  // UNDO = back to the price Amazon showed at the reading (another W-A1, recorded). The card goes back in the deck and becomes current.
  async function undo(code: string) {
    const card = data?.cards.find((c) => c.code === code);
    const d = done.get(code);
    if (!card || !d || d.kind !== 'set' || busy) return;
    setBusy(true); setMsg(null);
    const res = await applyAmzPrice(code, card.our_price, 'Buy Box undo', null, { ...pressOf(card), action: 'undo' });
    setBusy(false);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success || !res.data) { setMsg({ text: `Undo ${code}: ${res.error || 'failed'}`, tone: 'err' }); return; }
    const amazon = res.data.amazon;
    setDone((p) => { const n = new Map(p); n.delete(code); return n; });
    setSetOrder((o) => o.filter((c) => c !== code));
    setCur((p) => ({ ...p, [card.deck]: code }));
    setMsg({ text: `${code} back to ${money(card.our_price)} — ${amazon?.sent ? 'sent to Amazon' : amazon ? `saved, NOT sent: ${amazon.message}` : 'saved'}`, tone: amazon && !amazon.sent ? 'warn' : 'ok' });
  }

  function previous() {
    if (index > 0) go(cards[index - 1].code);
  }

  async function reload() {
    setDone(new Map()); setCur({}); setSetOrder([]); setMsg(null);
    await refresh();
  }

  const lastSet = setOrder.length ? setOrder[setOrder.length - 1] : null;
  const readMs = toMs(data?.last_all?.finished_at);
  const setCount = cards.filter((c) => done.get(c.code)?.kind === 'set').length;
  const leftCount = cards.filter((c) => done.get(c.code)?.kind === 'left').length;

  return (
    <AppShell crumb={<span className="font-medium text-slate-800">Pricing</span>}>
      {/* ONE CENTRED COLUMN (LAYOUT, header): toolbar, progress, card and the result line all the same width. */}
      <div className="mx-auto flex max-w-[55rem] flex-col gap-2.5">
        {/* 1 TOOLBAR — tabs · mood badge · how old the reading is. No result message here any more (it sits under the card). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Back to the mood + tiles — worded "Back", not "Amazon Pricing", so it isn't read as the nav button (owner, 2026-11-13). */}
          <Link href="/amz" title="Back to the mood and the New / Raise / Cut tiles"
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            ← Back
          </Link>
          <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm sm:w-auto">
            {DECKS.map((d) => (
              <Link key={d.key} href={`/amz/buybox/deck?g=${d.key}&mood=${mood}`} title={d.rule}
                className={'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm sm:flex-none ' + (d.key === deck ? 'bg-slate-100 font-medium text-slate-900 ring-1 ring-inset ring-slate-200' : 'text-slate-600 hover:bg-slate-50')}>
                <span className={`inline-block h-2 w-2 rounded-full ${d.dot}`} /> {d.label}
                <span className="font-semibold tabular-nums text-slate-900">{toDo(d.key) ?? ''}</span>
              </Link>
            ))}
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 sm:ml-auto">
            <MoodBadge mood={mood} />
            <Link href="/amz" title="The mood is chosen on Amazon Pricing" className="text-xs text-brand-700 hover:underline">Change</Link>
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-sm text-slate-400 sm:ml-0" title="Read every hour by the cron">
            Read {ago(readMs, now)}{data?.running ? ' · a read is running' : ''}
            <button type="button" onClick={reload} aria-label="Refresh"
              title="Reload the deck — sizes set or left since have gone; anything else comes back"
              className="inline-grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
              <ArrowPathIcon className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>

        {/* 2 PROGRESS — a dot per card (hover: the code and the move; click to jump), then the count. The list is a drawer (Q). */}
        {cards.length > 0 && (
          <div className="flex min-h-6 items-center gap-3">
            <div className="flex min-w-0 flex-nowrap gap-1.5 overflow-hidden sm:flex-wrap">
              {cards.map((c) => {
                const d = done.get(c.code);
                const on = current?.code === c.code;
                return (
                  <button key={c.code} type="button" onClick={() => go(c.code)} aria-label={c.code}
                    title={`${c.code} · ${d?.kind === 'set' ? `set ${money(d.price)}` : `${money(c.our_price)} → ${money(c.suggest)}`}${d?.kind === 'left' ? ' (left)' : ''}`}
                    className={'h-3 w-3 shrink-0 rounded-full border-[1.5px] ' +
                      (d?.kind === 'set' ? 'border-emerald-500 bg-emerald-500' : d?.kind === 'left' ? 'border-slate-300 bg-slate-300' : 'border-slate-300 bg-white') +
                      (on ? ' ring-2 ring-slate-800 ring-offset-2' : '')} />
                );
              })}
            </div>
            <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-slate-400">
              {index >= 0 ? `${index + 1} of ${cards.length}` : `${cards.length}`} · {setCount} set · {leftCount} left
              {deck === 'new' && <span className="hidden md:inline" title="New sizes only — a penny under the lead to get the first sale, never below break-even"> · no raises here, the mood doesn’t apply</span>}
            </span>
            <button type="button" onClick={() => setListOpen((o) => !o)} title="Every card in this tab (Q)"
              className="ml-auto hidden h-7 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-600 hover:bg-slate-50 lg:inline-flex">
              {listOpen ? 'Hide list' : 'List'} <kbd className="rounded border border-slate-300 px-1 font-mono text-[10px] text-slate-400">Q</kbd>
            </button>
          </div>
        )}

        {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
        {loadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}

        {data && (
          <>
            {/* ONE card layout for every state, so the buttons never move (owner, 2026-11-12). Going back to a card you LEFT shows it
                live again (Leave is only a skip — Set or Leave it again); one you SET shows what was sent, with Undo in Set's place and
                Next in Leave's. */}
            {current ? (
              <Card key={`${current.code}:${current.suggest}` + (done.get(current.code)?.kind === 'set' ? ':set' : '')} card={current} mood={mood} n={index + 1} busy={busy}
                setDone={done.get(current.code)?.kind === 'set' ? (done.get(current.code) as Extract<Done, { kind: 'set' }>) : null}
                onSet={(p, edited) => setPrice(current, p, edited)} onLeave={() => leave(current)} onPrev={previous}
                onUndo={() => undo(current.code)} onNext={() => go(nextAfter(current.code, done))}
                onUndoLast={() => lastSet && undo(lastSet)} />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
                <div className="text-lg font-medium text-slate-900">{cards.length ? 'All done here' : 'Nothing to go through'}</div>
                <p className="mt-1 text-sm text-slate-500">
                  {cards.length ? `${setCount} set · ${leftCount} left. ` : ''}
                  A size that was set comes back after the next hourly reading if it still has a move; one left comes back when its
                  price would change, or after 7 days.
                </p>
              </div>
            )}

            {/* 6 UNDER THE CARD — only a failure shows (owner 2026-11-13: the ✓ / Undo / waiting lines were clutter). */}
            {msg && msg.tone !== "ok" && (
              <p className={"text-sm " + (msg.tone === "err" ? "text-red-600" : "text-amber-700")}>{msg.text}</p>
            )}
          </>
        )}
      </div>

      {/* THE LIST DRAWER (laptop) — every card in this tab, in order; click one to jump. Lies over the page (fixed), so the card never
          moves when it opens. Closed on every load. */}
      {listOpen && cards.length > 0 && (
        <aside className="fixed inset-y-0 right-0 z-40 hidden w-80 flex-col border-l border-slate-200 bg-white text-sm shadow-xl lg:flex">
          <div className="flex items-center border-b border-slate-100 px-3 py-2.5 text-xs text-slate-500">
            {DECKS.find((d) => d.key === deck)?.label} · {open.length} to go · {setCount} set · {leftCount} left
            <button type="button" onClick={() => setListOpen(false)} aria-label="Close the list" title="Close (Esc)"
              className="ml-auto inline-grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100">✕</button>
          </div>
          <ul className="flex-1 divide-y divide-slate-50 overflow-y-auto">
            {cards.map((c) => {
              const d = done.get(c.code);
              const on = current?.code === c.code;
              return (
                <li key={c.code}>
                  <button type="button" onClick={() => go(c.code)}
                    className={'flex w-full items-center gap-2 px-3 py-1.5 text-left ' + (on ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                    <span className={'inline-block h-2 w-2 shrink-0 rounded-full ' + (d?.kind === 'set' ? 'bg-emerald-500' : d?.kind === 'left' ? 'bg-slate-300' : 'border border-slate-300')} />
                    <span className={'min-w-0 flex-1 truncate font-mono text-xs ' + (d ? 'text-slate-400' : 'text-slate-700')} title={c.title || undefined}>{c.code}</span>
                    <span className="shrink-0 tabular-nums text-xs text-slate-500">
                      {d?.kind === 'set' ? money(d.price) : `${money(c.our_price)} → ${money(c.suggest)}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      )}
    </AppShell>
  );
}

// Who has the Buy Box, in words — the frame's Buy Box line (the same words as the price cards).
function holderOf(card: AmzDeckCard): string {
  switch (card.holder) {
    case 'US': return 'We have it';
    case 'US_SHARED': return 'We share it';
    case 'AMAZON': return `Amazon at ${money(card.bb_price)}`;
    case 'OTHER_FBA': return `An FBA seller at ${money(card.bb_price)}`;
    case 'OTHER_MFN': return `A self-poster at ${money(card.bb_price)}`;
    default: return 'Nobody has it';
  }
}
const daysAgo = (n: number | null) => (n === null ? 'never' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

function Card({ card, mood, n, busy, setDone, onSet, onLeave, onPrev, onUndo, onNext, onUndoLast }: {
  card: AmzDeckCard; mood: AmzMood; n: number; busy: boolean;
  setDone: Extract<Done, { kind: 'set' }> | null;   // set this visit: show what was sent, Undo where Set is, Next where Leave is
  onSet: (price: number, edited: boolean) => void; onLeave: () => void; onPrev: () => void;
  onUndo: () => void; onNext: () => void; onUndoLast: () => void;
}) {
  const meta = DECKS.find((d) => d.key === card.deck)!;
  // THE BOX STARTS AT THE SUGGESTION (the one difference from the price cards, header) — or at what was sent on a set card.
  const [text, setText] = useState((setDone ? setDone.price : card.suggest).toFixed(2));
  const price = Number(text);
  const p2 = Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null;
  const edited = p2 !== null && Math.abs(p2 - card.suggest) >= 0.005;
  const same = p2 !== null && Math.abs(p2 - card.our_price) < 0.005;
  // Profit at a price: the server's figure for the suggestion, the profit line for any other (no second copy of the formula).
  const profitAt = (p: number) => (Math.abs(p - card.suggest) < 0.005 && card.profit_suggest !== null ? card.profit_suggest
    : card.profit_line ? Math.round((card.profit_line.per_pound * p + card.profit_line.at_zero) * 100) / 100 : null);
  const room = card.deck === 'raise';
  const isNew = card.deck === 'new';
  const parkedLong = !!card.next_review && card.next_review > REVIEW_ON;
  const lastSoldStale = card.strip.last_sold_ago === null || card.strip.last_sold_ago >= STALE_SALE_DAYS;
  const daysLeftNew = card.landed_ago === null ? null : Math.max(0, NEW_DAYS - card.landed_ago);
  const matchAt = card.bb_price !== null && card.holder !== 'US' && card.holder !== 'US_SHARED' ? card.bb_price : null;
  const size = card.groupid && card.code.startsWith(card.groupid + '-') ? card.code.slice(card.groupid.length + 1) : null;

  // Warnings are advice (header). The floor (walk-away) and RRP warnings went with the trim (owner, 2026-11-14): a loss shows red in
  // the profit and "over RRP" is noted by the frame.
  const warnings: string[] = [];
  if (p2 !== null) {
    if (Math.abs(p2 - card.our_price) / card.our_price > BIG_MOVE) warnings.push(`A big move — ${pct(card.our_price, p2)}`);
    if (room && card.next_up !== null && p2 >= card.next_up - 0.005) warnings.push(`At or above the next rival (${money(card.next_up)}) — it may take the Buy Box`);
    // The "not under the lead" / "more than 2% over a self-posting lead" warnings were removed (owner, 2026-11-14: "too much text") —
    // the Buy Box line under the box shows the lead's price and Match.
  }

  function submit() {
    if (setDone || busy || p2 === null || same) return;
    onSet(p2, edited);
  }

  // THE REASON — the answer tag (its colour is the only strong one) and why, one line, in full on hover.
  const reason = (
    <>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white ${meta.tag}`}>
        {isNew && card.suggest > card.our_price ? 'New · up' : meta.tagText}</span>
      <span className="shrink-0 tabular-nums text-slate-500">{money(card.suggest)} · {pct(card.our_price, card.suggest)}</span>
      <span className="min-w-0 flex-1 truncate text-slate-600" title={card.suggest_note}>{card.suggest_note}</span>
    </>
  );

  // FACTS — stock and sales; then the last price change (replaced the price line with dots, owner 2026-11-14).
  const facts = (
    <>
      <div title="At Amazon = sellable at FBA now (+ on its way in). At home = sellable local stock. On order = placed with the supplier, not yet arrived.">
        {card.live} at Amazon{card.total > card.live && ` · +${card.total - card.live} coming`}
        {card.at_home > 0 && ` · ${card.at_home} at home`}
        {card.on_order > 0 && ` · ${card.on_order} on order`}
        {card.weeks_left !== null && <span title="FBA stock ÷ the last 30 days' pace"> · {card.weeks_left} wks</span>}
        <span className="text-slate-300"> · </span>
        {isNew ? (
          <span title="Days since this size first landed at Amazon — New until its first sale, or 30 days">
            no Amazon sale yet · {card.landed_ago === null ? '—' : card.landed_ago === 0 ? 'landed today' : `${card.landed_ago} days in`}
            {daysLeftNew !== null && <>, <b className="font-semibold text-slate-900">{daysLeftNew} days</b> left to get the first sale</>}
          </span>
        ) : (
          <span>
            {card.sold30} sold in 30 days · <span className={lastSoldStale ? 'text-amber-700' : ''}>last sold {daysAgo(card.strip.last_sold_ago)}</span>
            {/* PRICED → SOLD (PLAN.md decision 22): how soon the last pair sold after its price went live. Raise cards only. */}
            {room && card.speed.priced_to_sold !== null && (
              <span title="The last Amazon sale came this long after the price it sold at went live">
                {' '}· priced → sold {card.speed.priced_to_sold === 0 ? 'same day' : `${card.speed.priced_to_sold} day${card.speed.priced_to_sold === 1 ? '' : 's'}`}
              </span>
            )}
          </span>
        )}
      </div>
      <LastChangeLine change={card.last_change} />
    </>
  );

  return (
    <AmzCardFrame
      code={card.code} groupid={card.groupid} size={size} title={card.title} brand={card.brand} imagename={card.imagename}
      links={[
        { href: `/amz/sku/${encodeURIComponent(card.code)}?from=${encodeURIComponent(`/amz/buybox/deck?g=${card.deck}&mood=${mood}`)}`, label: 'Full price screen →' },
        ...(card.asin ? [{ href: `https://www.amazon.co.uk/dp/${card.asin}`, label: 'Amazon ↗', external: true }] : []),
      ]}
      reason={reason}
      priceStr={text} setPriceStr={setText} locked={!!setDone}
      now={card.our_price} start={card.suggest} profitNow={card.profit_now} profitAt={profitAt} rrp={card.rrp}
      profitExtra={room && !edited && !setDone && card.gain_week !== null && card.gain_week > 0
        ? <span className="text-slate-500" title="About this much more profit a week if it keeps selling at the same pace">+£{card.gain_week.toFixed(2)} a week</span>
        : undefined}
      holder={holderOf(card)} share={card.our_share} matchAt={matchAt} offers={card.offers} featured={card.featured} rank={card.sales_rank ?? null}
      bbTags={<>
        {card.rival_at_our_price && (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-px text-[11px] text-slate-600"
            title="A rival at our exact price, to the penny — likely a repricer following us">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> following us
          </span>
        )}
        {card.amazon_retail && <span className="rounded-full border border-slate-200 px-2 py-px text-[11px] text-slate-600">Amazon sells it</span>}
      </>}
      facts={facts}
      review={
        <span className="text-sm text-slate-500" title="A Set or a Leave moves the Amazon Due date 4 weeks out, keeping a later one">
          {parkedLong ? `Review: keeps the later date, ${dayLabel(card.next_review!)}` : `Set or Leave → review ${dayLabel(REVIEW_ON)}`}
        </span>
      }
      onPrev={onPrev} prevDisabled={busy || n <= 1}
      secondary={setDone
        ? { label: 'Next →', onClick: onNext, disabled: busy, title: 'Next card (→ or L)' }
        : { label: 'Leave', onClick: onLeave, disabled: busy, title: 'Leave (→ or L) — nothing sent; off the Due list for 4 weeks' }}
      primary={setDone
        ? { label: <><ArrowUturnLeftIcon className="h-4 w-4" /> {busy ? 'Sending…' : `Undo to ${money(card.our_price)}`}</>, onClick: onUndo, disabled: busy, title: 'Undo (U)', tone: 'plain' }
        // "Already £x" when the box holds today's price — nothing to send; Leave keeps it (owner, 2026-11-14: a grey Set read as broken).
        : { label: busy ? 'Sending…' : same ? `Already ${money(p2)}` : p2 !== null ? `Set ${money(p2)}` : 'Set', onClick: submit, disabled: busy || p2 === null || same,
            title: same ? 'Already the price on Amazon — Leave keeps it' : 'Set (Enter) — sent to Amazon at once' }}
      note={setDone ? (
        <span className={'truncate ' + (setDone.amazon && !setDone.amazon.sent ? 'text-amber-700' : 'text-slate-500')} title={setDone.amazon?.message || undefined}>
          {money(card.our_price)} → <span className="font-medium text-slate-800">{money(setDone.price)}</span> — {setDone.amazon?.sent ? 'sent to Amazon' : setDone.amazon ? `NOT sent: ${setDone.amazon.message}` : 'saved'}
        </span>
      ) : warnings.length ? (
        <span className="truncate text-amber-700" title={warnings.join(' · ')}>{warnings.join(' · ')}</span>
      ) : null}
      onKey={(e) => {
        if (e.key === 'u' || e.key === 'U') { if (setDone) onUndo(); else onUndoLast(); return true; }
        return false;
      }}
    />
  );
}
