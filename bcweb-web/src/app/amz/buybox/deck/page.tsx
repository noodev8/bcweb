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

THE CARD: our price → the suggested price, why, our share of views, the lead offer / next dearer rival (on screen "Next dearer"), the
         floor (walk-away, or break-even on New), RRP, stock, pairs sold (New: days since it landed), profit a pair now and at the price
         in the box (typed prices priced from the server's profit line — no second copy of the formula). Warnings are advice, nothing
         blocks (as every pricing screen): under the floor, over the RRP, a move over 15%, a raise to or past the next rival, a cut not
         under the lead.

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
         · the card: who → THE MOVE (verb tag, old → new, the reason in full) → the PRICE LADDER (components/PriceLadder: floor, lead,
         rivals, our move, RRP on one line — replaced the Lead / Next dearer / Walk-away / RRP facts) → three facts (Buy Box, Selling,
         Stock) → decide (price, keeps £x, Leave, Set at the far right; one reserved line for warnings / the Due date) · the last
         result as one quiet line under the card. COLOUR: the answer's colour (New violet, Raise emerald, Cut rose) only on the tab
         dot, the verb tag and the ladder arrow; green = sold / set, amber = look twice, red = under the floor only, indigo = Set.
         FIXED HEIGHTS on a laptop for every zone, so the buttons sit in the same place on every card. A phone gets the same card
         stacked, the decide row pinned to the bottom of the screen.

KEYS (not while typing in the price box, except Enter / Esc): Enter = Set · → or L = Leave · ← = previous card · E = edit the price ·
         U = undo the last set · Q = the list (Esc closes it).
=======================================================================================================================================
*/

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import StyleThumb from '@/components/StyleThumb';
import PriceLadder from '@/components/PriceLadder';
import { MoodBadge } from '@/components/MoodSwitch';
import { applyAmzPrice, getAmzBuyBoxDeck, leaveAmzBuyBox, type AmzBuyBoxFeatured, type AmzDeckCard, type AmzDeckKind, type AmzMood, type AmzSendOutcome } from '@/lib/api';
import { reasonLabel } from '@/lib/buyboxAnswers';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { useAuth } from '@/contexts/AuthContext';

// `dot` / `tag` = the answer's colour (LAYOUT, header) — the tab dot and the solid verb tag; PriceLadder's arrow uses the same hue.
const DECKS: { key: AmzDeckKind; label: string; verb: string; tagText: string; rule: string; dot: string; tag: string }[] = [
  { key: 'new', label: 'New', verb: 'New', tagText: 'New · cut', rule: 'Landed at Amazon in the last 30 days, no Amazon sale yet — a penny under the lead to get the first sale (up to it when a dearer seller is shown, never over the RRP), never below break-even', dot: 'bg-violet-500', tag: 'bg-violet-600' },
  { key: 'raise', label: 'Raise', verb: 'Raise', tagText: 'Raise', rule: 'We have the Buy Box and the next rival is more than 2% above — a small step up (Chilled 5%, Climb 8%). Sold in 30 days', dot: 'bg-emerald-500', tag: 'bg-emerald-600' },
  { key: 'cut', label: 'Cut', verb: 'Cut', tagText: 'Cut', rule: 'A rival has the Buy Box at a price that still keeps us £3 a pair — a penny under it (Chilled: 2% over a self-poster)', dot: 'bg-rose-500', tag: 'bg-rose-600' },
];

// Who a featured offer is, in words, for the Buy Box fact's one line.
function whoIs(card: AmzDeckCard, f: AmzBuyBoxFeatured, isLead: boolean): string {
  if (f.us) return 'We';
  if (isLead && card.holder === 'AMAZON') return 'Amazon';
  return f.fba ? 'An FBA seller' : 'A self-poster';
}
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
  const { data, error: loadError, isLoading, refresh } = useApiQuery(hydrated ? ['amz-buybox-deck', mood] : null, () => getAmzBuyBoxDeck(mood), {
    revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false,
  });

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
  const meta = DECKS.find((d) => d.key === deck)!;

  const cards = useMemo(() => (data?.cards ?? []).filter((c) => c.deck === deck), [data, deck]);
  const open = cards.filter((c) => !done.has(c.code));
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
  // This tab's sizes with no card, by reason (waiting, or no move) — the footnote.
  const waiting = Object.entries(data?.answers?.[deck]?.reasons ?? {}).filter(([k, n]) => k !== 'ready' && n > 0);
  const setCount = cards.filter((c) => done.get(c.code)?.kind === 'set').length;
  const leftCount = cards.filter((c) => done.get(c.code)?.kind === 'left').length;

  return (
    <AppShell backHref="/amz" backLabel="Amazon Pricing" crumb={<span className="font-medium text-slate-800">Pricing</span>}>
      {/* ONE CENTRED COLUMN (LAYOUT, header): toolbar, progress, card and the result line all the same width. */}
      <div className="mx-auto flex max-w-[55rem] flex-col gap-2.5">
        {/* 1 TOOLBAR — tabs · mood badge · how old the reading is. No result message here any more (it sits under the card). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm sm:w-auto">
            {DECKS.map((d) => (
              <Link key={d.key} href={`/amz/buybox/deck?g=${d.key}&mood=${mood}`} title={d.rule}
                className={'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm sm:flex-none ' + (d.key === deck ? 'bg-slate-100 font-medium text-slate-900 ring-1 ring-inset ring-slate-200' : 'text-slate-600 hover:bg-slate-50')}>
                <span className={`inline-block h-2 w-2 rounded-full ${d.dot}`} /> {d.label}
                <span className="font-semibold tabular-nums text-slate-900">{data?.counts?.[d.key] ?? ''}</span>
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

            {/* 6 UNDER THE CARD — the last result as ONE quiet line (a ✓ and Undo; red / amber TEXT, never a coloured bar), in a fixed
                slot so nothing above moves when it appears. Then what isn't on a card, in one line. */}
            <div className="flex h-6 min-w-0 items-center gap-2.5 whitespace-nowrap text-sm" title={msg?.text}>
              {msg && (
                <>
                  {msg.tone === 'ok' && <span className="font-bold text-emerald-600">✓</span>}
                  <span className={'min-w-0 truncate ' + (msg.tone === 'err' ? 'text-red-600' : msg.tone === 'warn' ? 'text-amber-700' : 'text-slate-600')}>{msg.text}</span>
                  {msg.undo && done.get(msg.undo)?.kind === 'set' && (
                    <button type="button" onClick={() => undo(msg.undo!)} disabled={busy}
                      className="inline-flex shrink-0 items-center gap-1 text-brand-700 underline disabled:opacity-50">
                      <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Undo
                    </button>
                  )}
                </>
              )}
            </div>
            <p className="truncate text-xs text-slate-400" title={waiting.map(([k, n]) => `${n} ${reasonLabel(k).toLowerCase()}`).join(' · ') || undefined}>
              {waiting.length > 0 && <>{meta.label}, not on a card: {waiting.map(([k, n]) => `${n} ${reasonLabel(k).toLowerCase()}`).join(' · ')}. </>}
              Every size in stock is on <Link href={`/amz/buybox?mood=${mood}`} className="text-brand-700 hover:underline">Sizes at Amazon</Link>.
            </p>
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

// The 30-day strip (Selling fact). Day i of 30: i = 29 is today. Each square's hover names the day and the pairs; a price change that
// day draws a dark notch on the square's left edge and adds who / from → to to the hover.
function SalesStrip({ card }: { card: AmzDeckCard }) {
  const days = card.strip.sold.length;
  return (
    <span className="flex h-5 shrink-0 items-center gap-[2px]" aria-label="Amazon pairs sold a day, last 30 days">
      {card.strip.sold.map((n, i) => {
        const ago = days - 1 - i;
        const moves = card.strip.moves.filter((m) => m.day === i);
        const when = ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`;
        const title = [`${when}: ${n > 0 ? `${n} sold` : n < 0 ? `${-n} returned` : 'none sold'}`,
          ...moves.map((m) => `price ${money(m.old_price)} → ${money(m.new_price)}${m.by ? ` (${m.by})` : ''}`)].join(' · ');
        return (
          <span key={i} title={title}
            className={'relative inline-block h-4 w-[7px] rounded-[2px] ' + (n >= 2 ? 'bg-emerald-700' : n === 1 ? 'bg-emerald-500' : 'bg-slate-200')}>
            {moves.length > 0 && <span className="absolute -left-[2px] -top-[3px] h-[22px] w-[2px] rounded bg-slate-800" />}
          </span>
        );
      })}
    </span>
  );
}

// One of the three facts: a small uppercase label, then its content — a FIXED height on a laptop (zone 4), so cards line up.
function Fact({ label, extra, children }: { label: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative flex min-w-0 flex-col gap-1.5 px-4 py-3 sm:px-5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">{label}{extra}</div>
      {children}
    </div>
  );
}

function Card({ card, mood, n, busy, setDone, onSet, onLeave, onPrev, onUndo, onNext, onUndoLast }: {
  card: AmzDeckCard; mood: AmzMood; n: number; busy: boolean;
  setDone: Extract<Done, { kind: 'set' }> | null;   // set this visit: show what was sent, Undo where Set is, Next where Leave is
  onSet: (price: number, edited: boolean) => void; onLeave: () => void; onPrev: () => void;
  onUndo: () => void; onNext: () => void; onUndoLast: () => void;
}) {
  const meta = DECKS.find((d) => d.key === card.deck)!;
  const [text, setText] = useState((setDone ? setDone.price : card.suggest).toFixed(2));
  const inputRef = useRef<HTMLInputElement>(null);
  const price = Number(text);
  const valid = Number.isFinite(price) && price > 0;
  const p2 = valid ? Math.round(price * 100) / 100 : null;
  const edited = p2 !== null && Math.abs(p2 - card.suggest) >= 0.005;
  // Profit at the price in the box: the server's figure for the suggestion, the profit line for a typed price (header).
  const profitAt = p2 === null ? null
    : !edited ? card.profit_suggest
    : card.profit_line ? Math.round((card.profit_line.per_pound * p2 + card.profit_line.at_zero) * 100) / 100 : null;
  const room = card.deck === 'raise';
  const isNew = card.deck === 'new';
  // The floor: break-even on New (before its first sale), the £3 walk-away everywhere else (server: card.floor).
  const floorName = isNew ? 'break-even' : 'the £3 walk-away';
  const parkedLong = !!card.next_review && card.next_review > REVIEW_ON;
  // The last sale goes amber once it is STALE_SALE_DAYS old, or never — the "stopped selling" signal beside the strip.
  const lastSoldStale = card.strip.last_sold_ago === null || card.strip.last_sold_ago >= STALE_SALE_DAYS;
  const same = p2 !== null && Math.abs(p2 - card.our_price) < 0.005;

  const warnings: { text: string; red?: boolean }[] = [];
  if (p2 !== null) {
    if (card.floor !== null && p2 < card.floor - 0.005) warnings.push({ text: `Under ${floorName} (${money(card.floor)})`, red: true });
    if (card.rrp !== null && p2 > card.rrp + 0.005) warnings.push({ text: `Over the RRP (${money(card.rrp)})` });
    if (Math.abs(p2 - card.our_price) / card.our_price > BIG_MOVE) warnings.push({ text: `A big move — ${pct(card.our_price, p2)}` });
    if (room && card.next_up !== null && p2 >= card.next_up - 0.005) warnings.push({ text: `At or above the next rival (${money(card.next_up)}) — it may take the Buy Box` });
    // Over a self-posting lead by up to 2% is the suggestion itself (a trial, Chilled), so it isn't warned; past 2%, or level with any
    // lead, is. Fierce has no premium (a penny under every lead), so there any price at or over the lead is warned.
    const premium = card.holder === 'OTHER_MFN' && mood !== 'fierce';
    if (!room && card.bb_price !== null && p2 >= card.bb_price - 0.005
        && !(premium && p2 <= Math.floor(card.bb_price * 102 + 1e-6) / 100 + 0.005 && p2 > card.bb_price + 0.005)) {
      warnings.push({ text: premium
        ? `More than 2% over the self-posting lead (${money(card.bb_price)}) — FBA's edge runs out about there`
        : `Not under the lead (${money(card.bb_price)}) — a tie usually goes to them` });
    }
  }

  function submit() {
    if (setDone || busy || p2 === null || same) return;
    onSet(p2, edited);
  }

  // Keys (header). Re-subscribed each render so the handler always sees the current box — cheap, and no stale closure.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
      if (typing) { if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); return; }
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') { e.preventDefault(); if (setDone) onNext(); else onLeave(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
      else if ((e.key === 'e' || e.key === 'E') && !setDone) { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
      else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); if (setDone) onUndo(); else onUndoLast(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // BUY BOX fact: who gets the views, biggest first — the views bar (us green, the lead dark, others lighter) and one line in words.
  const featured = [...card.featured].filter((f) => f.share > 0).sort((a, b) => b.share - a.share);
  const top = featured[0] ?? null;
  const second = featured[1] ?? null;
  const viewsLine = !top ? 'Nobody is shown the Buy Box on this size.'
    : top.us ? `We're the lead.${second ? ` ${whoIs(card, second, false)} at ${money(second.price)} gets ${Math.round(second.share)}%.` : ''}`
    : `${whoIs(card, top, true)} at ${money(top.price)} gets ${Math.round(top.share)}%.${second ? ` ${second.us ? 'We get' : `${whoIs(card, second, false)} at ${money(second.price)} gets`} ${Math.round(second.share)}%.` : ''}`;
  const offersSorted = [...card.offers].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const daysLeftNew = card.landed_ago === null ? null : Math.max(0, NEW_DAYS - card.landed_ago);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* WHO — the groupid led, the size as a dark chip after it (owner, 2026-11-12: led by the GROUPID); name and brand under it. */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <StyleThumb imagename={card.imagename} alt={card.title || card.code} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 font-mono text-base font-semibold text-slate-900" title={card.code}>
            {card.groupid && card.code.startsWith(card.groupid + '-')
              ? <><span className="truncate">{card.groupid}</span><span className="shrink-0 rounded-md bg-slate-900 px-2 py-px font-sans text-xs font-semibold text-white">{card.code.slice(card.groupid.length + 1)}</span></>
              : <span className="truncate">{card.code}</span>}
          </div>
          <div className="truncate text-sm text-slate-600" title={card.title || undefined}>
            {card.title || '—'}<span className="ml-2 text-slate-400">{card.brand}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-sm sm:flex-row sm:gap-4">
          <Link href={`/amz/sku/${encodeURIComponent(card.code)}?from=${encodeURIComponent(`/amz/buybox/deck?g=${card.deck}&mood=${mood}`)}`} className="hidden text-brand-700 hover:underline sm:inline">Price screen →</Link>
          {card.asin && <a href={`https://www.amazon.co.uk/dp/${card.asin}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">Amazon ↗</a>}
        </div>
      </div>

      {/* 3 THE MOVE — one solid verb tag (the only strong colour), old price grey → new price large, the %, then the reason IN FULL
          (two lines reserved on a laptop, so a long reason doesn't move the buttons). */}
      <div className="px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          <span className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-white ${meta.tag}`}>
            {isNew && card.suggest > card.our_price ? 'New · up' : meta.tagText}</span>
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900 sm:text-[1.75rem]">
            <span className="font-medium text-slate-400">{money(card.our_price)}</span>
            <span className="mx-2 font-normal text-slate-300">→</span>{money(card.suggest)}
          </span>
          <span className="text-sm tabular-nums text-slate-500">{pct(card.our_price, card.suggest)}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600 sm:h-10" title={card.suggest_note}>{card.suggest_note}</p>
      </div>

      {/* THE PRICE LADDER — floor, lead, rivals, our move, RRP on one line (replaced four facts). Fixed height. */}
      <div className="px-4 pb-1 pt-1 sm:px-5">
        <PriceLadder card={card} />
      </div>

      {/* 4 THREE FACTS — Buy Box (full width on a phone), Selling and Stock. Fixed height on a laptop. */}
      <div className="grid grid-cols-2 border-t border-slate-100 sm:h-[7.75rem] sm:grid-cols-[1.2fr_1.2fr_0.9fr] sm:divide-x sm:divide-slate-100">
        <div className="col-span-2 border-b border-slate-100 sm:col-span-1 sm:border-b-0">
          <Fact label="Buy Box" extra={<>
            {card.rival_at_our_price && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-px text-[11px] normal-case tracking-normal text-slate-600"
                title="A rival at our exact price, to the penny — likely a repricer following us">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> following us
              </span>
            )}
            {card.amazon_retail && <span className="rounded-full border border-slate-200 px-2 py-px text-[11px] normal-case tracking-normal text-slate-600">Amazon sells it</span>}
          </>}>
            <div className="text-xl font-semibold tabular-nums leading-tight text-slate-900" title="Our share of page views at the reading — our Buy Box %">
              We&apos;re shown {card.our_share === null ? '—' : `${Math.round(card.our_share)}%`}
            </div>
            <div className="flex h-2 overflow-hidden rounded bg-slate-200" aria-hidden="true">
              {featured.map((f, i) => (
                <span key={`${f.seller}-${i}`} style={{ width: `${f.share}%` }} title={`${f.us ? 'Us' : i === 0 ? 'Lead' : 'Rival'} ${Math.round(f.share)}%`}
                  className={'block h-full ' + (f.us ? 'bg-emerald-500' : i === 0 ? 'bg-slate-600' : 'bg-slate-400')} />
              ))}
            </div>
            <div className="truncate text-[13px] text-slate-600" title={viewsLine}>
              {viewsLine}{' '}
              <details className="inline">
                <summary className="inline cursor-pointer list-none text-brand-700 hover:underline">{card.offers.length} offers</summary>
                {/* The full offers table — a pop-over, so it never takes space on the card. */}
                <div className="absolute left-4 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg sm:left-5">
                  <table className="text-xs">
                    <tbody>
                      {offersSorted.map((o, i) => {
                        const f = card.featured.find((x) => x.seller === o.seller);
                        const isLead = !!top && !top.us && f === top;
                        return (
                          <tr key={`${o.seller}-${i}`} className={o.us ? 'font-semibold text-slate-900' : 'text-slate-600'}>
                            <td className="py-px pr-4 tabular-nums">{money(o.price)}</td>
                            <td className="py-px pr-4">{o.us ? 'Us' : isLead ? 'Lead' : 'Rival'}</td>
                            <td className="py-px pr-4">{o.fba ? 'FBA' : 'Self-post'}</td>
                            <td className="py-px tabular-nums text-emerald-700">{f && f.share > 0 ? `${Math.round(f.share)}%` : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </Fact>
        </div>
        <Fact label={isNew ? 'New · first sale' : 'Selling · 30 days'}>
          {isNew ? (
            <>
              <div className="text-xl font-semibold tabular-nums leading-tight text-slate-900" title="Days since this size first landed at Amazon — New until its first sale, or 30 days">
                {card.landed_ago === null ? '—' : card.landed_ago === 0 ? 'Landed today' : `${card.landed_ago} day${card.landed_ago === 1 ? '' : 's'} in`}
              </div>
              <div className="text-[13px] text-slate-600">No Amazon sale yet</div>
              {daysLeftNew !== null && <div className="text-[13px] text-slate-600"><span className="font-semibold text-slate-900">{daysLeftNew} days</span> left to get the first sale</div>}
            </>
          ) : (
            <>
              {/* THE 30-DAY STRIP (owner, 2026-11-12: "want to be able to glance"): a square a day, oldest left — filled = sold,
                  a dark notch = a price change (hover: when, who, from → to). A stop reads as a blank run on the right. */}
              <SalesStrip card={card} />
              <div className="text-[13px] text-slate-600">
                <span className="font-semibold tabular-nums text-slate-900">{card.sold30}</span> sold ·{' '}
                <span className={lastSoldStale ? 'font-medium text-amber-700' : ''}>
                  {card.strip.last_sold_ago === null ? 'never sold on Amazon' : `last sold ${card.strip.last_sold_ago === 0 ? 'today' : card.strip.last_sold_ago === 1 ? 'yesterday' : `${card.strip.last_sold_ago} days ago`}`}
                </span>
              </div>
              {/* PRICED → SOLD (PLAN.md decision 22 — moved from the retired Fast sellers): how soon the last pair sold after the
                  price it went at went live. A raise that sold within a day is the one to take further (Climb). Raise cards only. */}
              {room && (
                <div className="text-[13px] text-slate-600" title={card.speed.sold_on
                  ? `The last Amazon sale (${card.speed.sold_on}${card.speed.sold_price !== null ? `, ${money(card.speed.sold_price)}` : ''}) came this long after the price it sold at went live`
                  : 'No Amazon sale to measure from'}>
                  {card.speed.priced_to_sold === null ? 'Priced → sold: —'
                    : <>Priced → sold: <span className="font-semibold tabular-nums text-slate-900">{card.speed.priced_to_sold === 0 ? 'same day' : `${card.speed.priced_to_sold} day${card.speed.priced_to_sold === 1 ? '' : 's'}`}</span></>}
                </div>
              )}
            </>
          )}
        </Fact>
        <Fact label="Stock">
          <div className="text-xl font-semibold tabular-nums leading-tight text-slate-900" title="FBA stock ÷ the last 30 days' pace">
            {card.weeks_left === null ? '—' : `${card.weeks_left} wks`}
          </div>
          <div className="text-[13px] tabular-nums text-slate-600"
            title="FBA = sellable at Amazon now (+ on its way in). At home = sellable local stock (could be sent to FBA). On order = placed with the supplier, not yet arrived.">
            <span className="font-semibold text-slate-900">{card.live}</span> at FBA{card.total > card.live && <> +{card.total - card.live} coming</>}
            {card.at_home > 0 && <> · <span className="font-semibold text-slate-900">{card.at_home}</span> at home</>}
            {card.on_order > 0 && <> · {card.on_order} on order</>}
          </div>
        </Fact>
      </div>

      {/* 5 DECIDE — the price and what it keeps on the left; Leave then SET at the far right (where Enter is). Pinned to the bottom of
          the screen on a phone. Keys show as faint marks on the buttons (no hint sentence). */}
      <div className="rounded-b-xl border-t border-slate-200 bg-slate-50 px-4 pb-2.5 pt-3 max-sm:sticky max-sm:bottom-0 max-sm:z-10 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 sm:flex-nowrap">
          <label className="flex items-center gap-1.5 text-base text-slate-500">
            £
            <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" disabled={!!setDone} aria-label="Price"
              className="h-11 w-28 rounded-lg border border-slate-300 bg-white px-2.5 text-xl font-semibold tabular-nums text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100" />
          </label>
          <div className="min-w-0 text-sm leading-snug text-slate-500">
            {setDone ? (
              <span className={setDone.amazon && !setDone.amazon.sent ? 'text-amber-700' : 'text-slate-600'}>Set this visit</span>
            ) : (
              <span className="text-slate-600">
                {profitAt !== null ? <>keeps <span className="text-base font-semibold tabular-nums text-slate-900">{money(profitAt)}</span> a pair</> : valid ? '' : 'Not a price'}
              </span>
            )}
            <span className="block tabular-nums text-slate-400">
              now {money(card.profit_now)}
              {room && !edited && !setDone && card.gain_week !== null && card.gain_week > 0 && (
                <span title="About this much more profit a week if it keeps selling at the same pace"> · +£{card.gain_week.toFixed(2)} a week</span>
              )}
            </span>
          </div>
          <div className="flex w-full items-center gap-2.5 sm:ml-auto sm:w-auto">
            <button type="button" onClick={onPrev} disabled={busy || n <= 1} title="Previous card (←)" aria-label="Previous card"
              className="hidden h-11 shrink-0 rounded-lg px-2 text-slate-400 hover:bg-slate-100 disabled:opacity-40 sm:inline-block">←</button>
            {setDone ? (
              <>
                <button type="button" onClick={onNext} disabled={busy} title="Next card (→ or L)"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-28 sm:flex-none">
                  Next <Kbd>→</Kbd>
                </button>
                <button type="button" onClick={onUndo} disabled={busy} title="Undo (U)"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-44 sm:flex-none">
                  <ArrowUturnLeftIcon className="h-4 w-4" /> {busy ? 'Sending…' : `Undo to ${money(card.our_price)}`}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={onLeave} disabled={busy} title="Leave (→ or L) — nothing sent; off the Due list for 4 weeks"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:w-28 sm:flex-none">
                  Leave <Kbd>→</Kbd>
                </button>
                <button type="button" onClick={submit} disabled={busy || p2 === null || same} title="Set (Enter) — sent to Amazon at once"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 sm:w-44 sm:flex-none">
                  {busy ? 'Sending…' : p2 !== null ? `Set ${money(p2)}` : 'Set'} <Kbd light>⏎</Kbd>
                </button>
              </>
            )}
          </div>
        </div>
        {/* ONE reserved line: warnings while typing (red only under the floor), what was sent on a set card, else what a press does to
            the Due date — clipped, in full on hover, so nothing moves. */}
        <div className="mt-2 flex h-5 items-baseline gap-x-4 overflow-hidden whitespace-nowrap text-[13px]" title={warnings.map((w) => w.text).join(' · ') || undefined}>
          {setDone ? (
            <span className={'truncate ' + (setDone.amazon && !setDone.amazon.sent ? 'text-amber-700' : 'text-slate-500')} title={setDone.amazon?.message || undefined}>
              {money(card.our_price)} → <span className="font-medium text-slate-800">{money(setDone.price)}</span> — {setDone.amazon?.sent ? 'sent to Amazon' : setDone.amazon ? `NOT sent: ${setDone.amazon.message}` : 'saved'}
            </span>
          ) : warnings.length ? (
            warnings.map((w) => <span key={w.text} className={w.red ? 'font-medium text-red-600' : 'text-amber-700'}>{w.red ? '⚠ ' : ''}{w.text}</span>)
          ) : (
            <span className="truncate text-slate-400" title="A Set or a Leave moves the Amazon Due date 4 weeks out, keeping a later one">
              {parkedLong ? `Set or Leave keeps the later Due date, ${dayLabel(card.next_review!)}` : `Set or Leave moves the Amazon Due date to ${dayLabel(REVIEW_ON)}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// A faint key mark on a button (laptop only).
function Kbd({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <kbd className={'hidden rounded border px-1 font-mono text-[10px] leading-4 sm:inline ' + (light ? 'border-white/40 text-white/70' : 'border-slate-300 text-slate-400')}>
      {children}
    </kbd>
  );
}
