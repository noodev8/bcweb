'use client';
/*
=======================================================================================================================================
Page: /amz/buybox/deck  (Buy Box — Go through, 2026-11-12, a TRIAL)
=======================================================================================================================================
Purpose: Work the Buy Box groups that have a job ONE SIZE AT A TIME, each with one suggested move — Raise (Room to go up) or Match
         (Can match) — so a price is changed LOOKING at the Buy Box. It may become the main Amazon pricing screen or be folded away.
         Laptop first, keys for everything (owner: "95% of our price changes will be on laptop"); big buttons so it also works on a
         phone — deliberately not a swipe app ("dont take tinder too closely").
         Server routes/amz-buybox-deck.js, THE rules utils/amzBuyBoxDeck.js (which sizes, the suggestion, the order — read its header).

THE CARD: our price → the suggested price, why, our share of views, the lead offer, the next dearer rival (on screen "Next dearer", owner 2026-11-12 — "above" read as league-table position), walk-away, RRP, stock, pairs
         sold, profit a pair now and at the price in the box (typed prices priced from the server's profit line — no second copy of
         the formula). Warnings are advice, nothing blocks (as every pricing screen): under the walk-away, over the RRP, a move over 15%,
         a raise to or past the next rival, a match not under the lead.

SET = the normal W-A1 (POST /amz-apply), sent to Amazon at once; note "Buy Box Raise" / "Buy Box Match" (+ "own price" when the box
         was changed) so Team week and the logs say where it came from. REVIEW (owner, 2026-11-12): a Set parks the size REVIEW_DAYS (7)
         on the Amazon review date — unless its review is already later, which is kept (Fast sellers' shape) — so the Due list doesn't
         move it again blind. The deck itself ignores review dates: a parked size still comes back here after the next reading.
         Undo puts the price back but leaves the park.
         A size that is set leaves the deck until a reading has seen its new price (server rule). LEAVE = skip for this visit only,
         nothing stored (going back to a left card shows it live again). UNDO = sets the price back to what Amazon showed at the reading (another W-A1, note "Buy Box undo").

THE LIST STAYS PUT while you work: the deck is the snapshot from when the page opened (no refetch on focus); Refresh reloads it — sizes
         set since then have gone (they wait for a reading), anything left comes back.

KEYS (not while typing in the price box, except Enter / Esc): Enter = Set · → or L = Leave · ← = previous card · E = edit the price ·
         U = undo the last set.
=======================================================================================================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import StyleThumb from '@/components/StyleThumb';
import { applyAmzPrice, getAmzBuyBoxDeck, type AmzBuyBoxHolder, type AmzDeckCard, type AmzDeckKind, type AmzSendOutcome } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { useAuth } from '@/contexts/AuthContext';

const DECKS: { key: AmzDeckKind; label: string; verb: string; rule: string; dot: string }[] = [
  { key: 'room', label: 'Room to go up', verb: 'Raise', rule: 'We have the Buy Box and the next rival is more than 2% above — raise towards it, at most 5% a step', dot: 'bg-emerald-500' },
  { key: 'can_match', label: 'Can match', verb: 'Match', rule: 'A rival has the Buy Box at a price that still keeps us £3 a pair — a penny under it', dot: 'bg-red-500' },
];

const HOLDER: Record<AmzBuyBoxHolder, string> = {
  US: 'Us', US_SHARED: 'Us + shared', OTHER_FBA: 'Rival (FBA)', OTHER_MFN: 'Rival (self-post)', AMAZON: 'Amazon', NONE: 'Nobody',
};
// REVIEW (header): today + REVIEW_DAYS as YYYY-MM-DD in the UK calendar, taken once at module load (react-hooks/purity, as Fast sellers).
const REVIEW_DAYS = 7;
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
const STALE_SALE_DAYS = 14;   // "last sold" goes amber at this many days (or never) — beside the strip
const reviewDaysFor = (nextReview: string | null): number | null => (nextReview && nextReview > REVIEW_ON ? null : REVIEW_DAYS);

const BIG_MOVE = 0.15;
const OFFER_ROWS = 5;     // offers on the card (+ a "more" line): fits the card's fixed height, so the buttons never move   // a move over 15% gets a warning (amz-price-set.js refuses these without a flag; here it is advice)

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
  const deck: AmzDeckKind = gParam === 'can_match' ? 'can_match' : 'room';
  const meta = DECKS.find((d) => d.key === deck)!;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // A snapshot: nothing refetches by itself, so the deck doesn't reshuffle while you work. Refresh reloads it.
  const { data, error: loadError, isLoading, refresh } = useApiQuery(['amz-buybox-deck'], () => getAmzBuyBoxDeck(), {
    revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false,
  });

  const [done, setDone] = useState<Map<string, Done>>(() => new Map());
  const [cur, setCur] = useState<Partial<Record<AmzDeckKind, string>>>({});
  const [setOrder, setSetOrder] = useState<string[]>([]);   // codes set this visit, newest last — U undoes the last
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'err'; undo?: string } | null>(null);

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

  async function setPrice(card: AmzDeckCard, price: number, edited: boolean) {
    if (busy) return;
    setBusy(true); setMsg(null);
    const note = `Buy Box ${meta.verb}${edited ? ' (own price)' : ''}`;
    const res = await applyAmzPrice(card.code, price, note, reviewDaysFor(card.next_review));
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

  function leave(card: AmzDeckCard) {
    const nextDone = new Map(done).set(card.code, { kind: 'left' });
    setDone(nextDone);
    go(nextAfter(card.code, nextDone));
  }

  // UNDO = back to the price Amazon showed at the reading (another W-A1). The card goes back in the deck and becomes current.
  async function undo(code: string) {
    const card = data?.cards.find((c) => c.code === code);
    const d = done.get(code);
    if (!card || !d || d.kind !== 'set' || busy) return;
    setBusy(true); setMsg(null);
    const res = await applyAmzPrice(code, card.our_price, 'Buy Box undo');
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
  const leftOut = data?.left_out?.[deck];
  const setCount = cards.filter((c) => done.get(c.code)?.kind === 'set').length;
  const leftCount = cards.filter((c) => done.get(c.code)?.kind === 'left').length;

  return (
    <AppShell backHref="/amz/buybox" backLabel="Buy Box" crumb={<span className="font-medium text-slate-800">Go through</span>}>
      {/* ONE SCREEN, NO SCROLL on a laptop (owner, 2026-11-12: "squeeze things upwards"): no title row (the crumb names it), the
          result line sits in the deck row, and the card puts facts and offers side by side with the price and buttons on one line. */}
      <div className="mb-3 flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 lg:flex-nowrap">
        <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          {DECKS.map((d) => (
            <Link key={d.key} href={`/amz/buybox/deck?g=${d.key}`} title={d.rule}
              className={'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ' + (d.key === deck ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-600 hover:bg-slate-50')}>
              <span className={`inline-block h-2 w-2 rounded-full ${d.dot}`} /> {d.label}
              <span className="tabular-nums text-slate-900">{data?.counts?.[d.key] ?? ''}</span>
            </Link>
          ))}
        </div>
        <span className="shrink-0 text-sm text-slate-500" title="Every hour, by the cron">
          Reading {ago(readMs, now)}{data?.running ? ' · a read is running' : ''}
        </span>
        <button type="button" onClick={reload}
          title="Reload the deck — sizes set since have gone until a reading sees their new price; anything left comes back"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <ArrowPathIcon className="h-3.5 w-3.5" /> Refresh
        </button>
      {/* STEADY (owner, 2026-11-12: "im moving my cursor to chase it"): the result line is ONE line that truncates (full text on
          hover), in a header row that doesn't wrap on a laptop, so nothing below moves when it appears or changes. */}
      {msg && (
        <div title={msg.text} className={'flex h-8 min-w-0 items-center gap-3 whitespace-nowrap rounded-md px-3 text-sm ' + (msg.tone === 'err' ? 'bg-red-50 text-red-700' : msg.tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800')}>
          <span className="min-w-0 truncate">{msg.text}</span>
          {msg.undo && done.get(msg.undo)?.kind === 'set' && (
            <button type="button" onClick={() => undo(msg.undo!)} disabled={busy}
              className="inline-flex shrink-0 items-center gap-1 font-medium underline disabled:opacity-50">
              <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Undo
            </button>
          )}
        </div>
      )}
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {loadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}

      {data && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="w-full lg:max-w-2xl">
            {/* ONE card layout for every state, so the buttons never move (owner, 2026-11-12). Going back to a card you LEFT shows it
                live again (Leave is only a skip — Set or Leave it again); one you SET shows what was sent, with Undo in Set's place and
                Next in Leave's. */}
            {current ? (
              <Card key={current.code + (done.get(current.code)?.kind === 'set' ? ':set' : '')} card={current} verb={meta.verb} n={index + 1} of={cards.length} busy={busy}
                setDone={done.get(current.code)?.kind === 'set' ? (done.get(current.code) as Extract<Done, { kind: 'set' }>) : null}
                onSet={(p, edited) => setPrice(current, p, edited)} onLeave={() => leave(current)} onPrev={previous}
                onUndo={() => undo(current.code)} onNext={() => go(nextAfter(current.code, done))}
                onUndoLast={() => lastSet && undo(lastSet)} />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
                <div className="text-lg font-medium text-slate-900">{cards.length ? 'All done here' : 'Nothing to go through'}</div>
                <p className="mt-1 text-sm text-slate-500">
                  {cards.length ? `${setCount} set · ${leftCount} left. ` : ''}
                  A size that was set comes back after the next hourly reading if it is still in this group.
                </p>
              </div>
            )}
            {leftOut && (
              <p className="mt-2 text-xs text-slate-400">
                Not in the deck — sold nothing in 30 days: {leftOut.not_selling_recent ?? 0} sold in the last 3 months (wait — the review
                dates bring them back) · {leftOut.not_selling - (leftOut.not_selling_recent ?? 0)} not sold in 3+ months or never, a demand
                and price question for <Link href="/analytics/slow-sizes" className="text-brand-700 hover:underline">Range</Link>, not the Buy Box
                {leftOut.waiting > 0 && <> · {leftOut.waiting} with a price set since the reading (back after the next one)</>}
                {leftOut.not_eligible > 0 && <> · {leftOut.not_eligible} not eligible for the Buy Box (Seller Central)</>}
                {(leftOut.raised_waiting ?? 0) > 0 && <> · {leftOut.raised_waiting} raised, waiting for a sale at the new price</>}
                {(leftOut.cheaper_rival ?? 0) > 0 && <> · {leftOut.cheaper_rival} already 2%+ over a cheaper rival (raising would give views away)</>}
                {' '}— all on the <Link href="/amz/buybox" className="text-brand-700 hover:underline">Buy Box screen</Link>.
              </p>
            )}
          </div>

          {/* THE QUEUE (laptop): every card in the deck, in order — click one to jump to it. Hidden on a phone. */}
          {cards.length > 0 && (
            <div className="hidden w-80 shrink-0 rounded-lg border border-slate-200 bg-white text-sm shadow-sm lg:block">
              <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                {open.length} to go · {setCount} set · {leftCount} left
              </div>
              <ul className="max-h-[calc(100vh-15rem)] divide-y divide-slate-50 overflow-y-auto">
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
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

// The 30-day strip (header of the card's strip line). Day i of 30: i = 29 is today. Each square's hover names the day and the pairs;
// a price change that day draws a dark notch on the square's left edge and adds who / from → to to the hover.
function SalesStrip({ card }: { card: AmzDeckCard }) {
  const days = card.strip.sold.length;
  return (
    <span className="flex shrink-0 items-center gap-px" aria-label="Amazon pairs sold a day, last 30 days">
      {card.strip.sold.map((n, i) => {
        const ago = days - 1 - i;
        const moves = card.strip.moves.filter((m) => m.day === i);
        const when = ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`;
        const title = [`${when}: ${n > 0 ? `${n} sold` : n < 0 ? `${-n} returned` : 'none sold'}`,
          ...moves.map((m) => `price ${money(m.old_price)} → ${money(m.new_price)}${m.by ? ` (${m.by})` : ''}`)].join(' · ');
        return (
          <span key={i} title={title}
            className={'relative inline-block h-3.5 w-2 rounded-[1px] ' + (n >= 2 ? 'bg-emerald-700' : n === 1 ? 'bg-emerald-500' : 'bg-slate-200')}>
            {moves.length > 0 && <span className="absolute -left-px -top-0.5 h-[1.125rem] w-0.5 rounded bg-slate-800" />}
          </span>
        );
      })}
    </span>
  );
}

function Fact({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    // A fixed slot (label, value, room for one small line under it): a fact with a note is no taller than one without.
    <div title={title} className="h-[3.25rem] min-w-0">
      <div className="truncate text-xs text-slate-500">{label}</div>
      <div className="truncate font-medium tabular-nums text-slate-900">{children}</div>
    </div>
  );
}

function Card({ card, verb, n, of, busy, setDone, onSet, onLeave, onPrev, onUndo, onNext, onUndoLast }: {
  card: AmzDeckCard; verb: string; n: number; of: number; busy: boolean;
  setDone: Extract<Done, { kind: 'set' }> | null;   // set this visit: show what was sent, Undo where Set is, Next where Leave is
  onSet: (price: number, edited: boolean) => void; onLeave: () => void; onPrev: () => void;
  onUndo: () => void; onNext: () => void; onUndoLast: () => void;
}) {
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
  const room = card.deck === 'room';
  const parkedLong = !!card.next_review && card.next_review > REVIEW_ON;
  // The last sale goes amber once it is STALE_SALE_DAYS old, or never — the "stopped selling" signal beside the strip.
  const lastSoldStale = card.strip.last_sold_ago === null || card.strip.last_sold_ago >= STALE_SALE_DAYS;
  const same = p2 !== null && Math.abs(p2 - card.our_price) < 0.005;

  const warnings: { text: string; red?: boolean }[] = [];
  if (p2 !== null) {
    if (card.walk !== null && p2 < card.walk - 0.005) warnings.push({ text: `Under the £3 walk-away (${money(card.walk)})`, red: true });
    if (card.rrp !== null && p2 > card.rrp + 0.005) warnings.push({ text: `Over the RRP (${money(card.rrp)})` });
    if (Math.abs(p2 - card.our_price) / card.our_price > BIG_MOVE) warnings.push({ text: `A big move — ${pct(card.our_price, p2)}` });
    if (room && card.next_up !== null && p2 >= card.next_up - 0.005) warnings.push({ text: `At or above the next rival (${money(card.next_up)}) — it may take the Buy Box` });
    // Over a self-posting lead by up to 2% is the suggestion itself (a trial), so it isn't warned; past 2%, or level with any lead, is.
    if (!room && card.bb_price !== null && p2 >= card.bb_price - 0.005
        && !(card.holder === 'OTHER_MFN' && p2 <= Math.floor(card.bb_price * 102 + 1e-6) / 100 + 0.005 && p2 > card.bb_price + 0.005)) {
      warnings.push({ text: card.holder === 'OTHER_MFN'
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

  const lead = card.featured.find((f) => !f.us && f.price === card.bb_price);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-2.5">
        <StyleThumb imagename={card.imagename} alt={card.title || card.code} />
        <div className="min-w-0 flex-1">
          {/* Led by the GROUPID (owner, 2026-11-12), the size after it; the name and brand underneath. */}
          <div className="truncate font-mono font-semibold text-slate-900" title={card.code}>
            {card.groupid && card.code.startsWith(card.groupid)
              ? <>{card.groupid}<span className="font-normal text-slate-500">{card.code.slice(card.groupid.length)}</span></>
              : card.code}
          </div>
          <div className="truncate text-xs text-slate-600" title={card.title || undefined}>
            {card.title || '—'}<span className="ml-2 text-slate-400">{card.brand}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
            <Link href={`/amz/sku/${encodeURIComponent(card.code)}?from=${encodeURIComponent('/amz/buybox/deck?g=' + card.deck)}`} className="text-brand-700 hover:underline">Amazon price screen →</Link>
            {card.asin && <a href={`https://www.amazon.co.uk/dp/${card.asin}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">On Amazon ↗</a>}
          </div>
        </div>
        <div className="shrink-0 text-xs tabular-nums text-slate-400">{n} of {of}</div>
      </div>

      {/* THE MOVE — the one line to decide on; the reason beside it. */}
      <div className="px-4 pt-3">
        <div className="flex items-baseline gap-x-3 whitespace-nowrap">
          <span className={'shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ' + (room ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700')}>{verb}</span>
          <span className="text-2xl font-semibold tabular-nums text-slate-900">{money(card.our_price)} → {money(card.suggest)}</span>
          <span className="text-sm tabular-nums text-slate-500">{pct(card.our_price, card.suggest)}</span>
          <span className="min-w-0 truncate text-sm text-slate-500" title={card.suggest_note}>· {card.suggest_note}</span>
          {card.rival_at_our_price && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800" title="A rival at our exact price, to the penny — likely a repricer following us">following us</span>}
          {card.amazon_retail && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">Amazon sells this size</span>}
        </div>
        {/* THE 30-DAY STRIP (owner, 2026-11-12: "want to be able to glance") in the card's one reserved line: a square per day,
            oldest left, today right — filled = a pair sold that day, a dark notch = a price change (hover: when, who, from → to).
            A stop reads as a blank run on the right without reading anything. Then the last sale, amber at 14+ days or never. */}
        <div className="mt-1 flex h-5 items-center gap-2 overflow-hidden whitespace-nowrap text-sm text-slate-500">
          <span className="shrink-0 text-xs">Sales 30d</span>
          <SalesStrip card={card} />
          <span className={'shrink-0 text-xs ' + (lastSoldStale ? 'font-medium text-amber-700' : '')}>
            {card.strip.last_sold_ago === null ? 'never sold on Amazon' : `last sold ${card.strip.last_sold_ago === 0 ? 'today' : card.strip.last_sold_ago === 1 ? 'yesterday' : `${card.strip.last_sold_ago}d ago`}`}
          </span>
          {parkedLong && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
              title="Someone parked this size beyond the 7 days a Set gives — a Set keeps that date">
              parked to {dayLabel(card.next_review!)} — kept
            </span>
          )}
        </div>
      </div>

      {/* FACTS (left) and OFFERS (right), side by side on a laptop — stacked on a phone. */}
      {/* A FIXED-HEIGHT block on a laptop: facts in equal slots, offers capped at OFFER_ROWS — so the buttons stay put card to card. */}
      <div className="flex flex-col gap-3 px-4 py-3 sm:h-[8.75rem] sm:flex-row sm:gap-6 sm:overflow-hidden">
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Fact label="We're shown" title="Our share of page views at the reading — our Buy Box %">
            <span className={card.our_share === null ? 'text-slate-400' : card.our_share >= 50 ? 'text-emerald-700' : card.our_share > 0 ? 'text-amber-700' : 'text-slate-500'}>
              {card.our_share === null ? '—' : `${Math.round(card.our_share)}%`}
            </span>
          </Fact>
          {room ? (
            <Fact label="Next dearer" title="The cheapest rival priced above us — a raise stays a penny under it">{money(card.next_up)}</Fact>
          ) : (
            <Fact label="Lead" title={`The offer Amazon features to the most views, price incl. postage — ${HOLDER[card.holder]}${card.lead_share !== null ? `, ${Math.round(card.lead_share)}% of views` : ''}`}>
              {money(card.bb_price)}
            </Fact>
          )}
          <Fact label="Walk-away" title="The price that keeps £3 a pair — never go under it">{money(card.walk)}</Fact>
          <Fact label="RRP">{money(card.rrp)}</Fact>
          <Fact label="Sold 30d" title="Net pairs sold on Amazon, last 30 days">{card.sold30}</Fact>
          <Fact label="FBA" title="Sellable at FBA now, + on its way in">{card.live}{card.total > card.live && <span className="font-normal text-slate-400"> +{card.total - card.live}</span>}</Fact>
          <Fact label="Weeks left" title="FBA stock ÷ the last 30 days' pace — see the line under it for more coming">
            {card.weeks_left ?? '—'}
            {(card.on_order > 0 || card.at_home > 0) && (
              <span className="block truncate text-xs font-normal text-slate-500"
                title="On order = placed with the supplier, not yet arrived. At home = sellable local stock (could be sent to FBA).">
                {[card.on_order > 0 ? `+${card.on_order} on order` : null, card.at_home > 0 ? `${card.at_home} at home` : null].filter(Boolean).join(' · ')}
              </span>
            )}
          </Fact>
          <Fact label="Profit now" title="Profit a pair at our price at the reading">{money(card.profit_now)}</Fact>
        </div>
        {/* The offers, cheapest first — who else is on the size and who Amazon shows. */}
        <div className="shrink-0">
          <table className="text-xs">
            <tbody>
              {[...card.offers].sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).slice(0, OFFER_ROWS).map((o, i) => {
                const f = card.featured.find((x) => x.seller === o.seller);
                return (
                  <tr key={`${o.seller}-${i}`} className={o.us ? 'font-medium text-slate-900' : 'text-slate-600'}>
                    <td className="py-px pr-3 tabular-nums">{money(o.price)}</td>
                    <td className="py-px pr-3">{o.us ? 'Us' : f === lead && lead ? 'Lead' : 'Rival'}</td>
                    <td className="py-px pr-3">{o.fba ? 'FBA' : 'Self-post'}</td>
                    <td className="py-px text-emerald-700">{f ? `${Math.round(f.share)}%` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {card.offers.length > OFFER_ROWS && <div className="text-xs text-slate-400">+ {card.offers.length - OFFER_ROWS} more</div>}
        </div>
      </div>

      {/* THE DECISION — price, profit and the buttons on one line (wraps on a phone). */}
      <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            £
            <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" disabled={!!setDone}
              className="h-11 w-24 rounded-md border border-slate-300 px-2 text-lg tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </label>
          {setDone ? (
            <>
              <button type="button" onClick={onUndo} disabled={busy} title="U"
                className="inline-flex h-11 w-36 shrink-0 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <ArrowUturnLeftIcon className="h-4 w-4" /> {busy ? 'Sending…' : `Undo to ${money(card.our_price)}`}
              </button>
              <button type="button" onClick={onNext} disabled={busy} title="→ or L"
                className="h-11 w-24 shrink-0 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Next →
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={submit} disabled={busy || p2 === null || same} title="Enter"
            className="h-11 w-36 shrink-0 rounded-md bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? 'Sending…' : p2 !== null ? `Set ${money(p2)}` : 'Set'}
              </button>
              <button type="button" onClick={onLeave} disabled={busy} title="→ or L"
            className="h-11 w-24 shrink-0 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Leave
              </button>
            </>
          )}
          <button type="button" onClick={onPrev} disabled={busy || n <= 1} title="←"
            className="hidden h-11 shrink-0 rounded-md px-2 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-40 sm:inline-block">
            ← Prev
          </button>
        </div>
        {/* Profit at the box's price, then any warnings: ONE reserved line under the buttons (clipped, warnings in full on hover),
            so typing a price or a card with warnings never moves anything. */}
        <div className="mt-1.5 flex h-5 items-baseline gap-x-4 overflow-hidden whitespace-nowrap" title={warnings.map((w) => w.text).join(' · ') || undefined}>
          {setDone ? (
            <span className={'truncate text-sm ' + (setDone.amazon && !setDone.amazon.sent ? 'text-amber-700' : 'text-emerald-700')} title={setDone.amazon?.message || undefined}>
              Set {money(card.our_price)} → <span className="font-medium">{money(setDone.price)}</span> this visit — {setDone.amazon?.sent ? 'sent to Amazon' : setDone.amazon ? `NOT sent: ${setDone.amazon.message}` : 'saved'}
            </span>
          ) : (<>
          <span className="shrink-0 text-sm text-slate-600">
            {profitAt !== null ? <>keeps <span className="font-medium text-slate-900">{money(profitAt)}</span> a pair</> : valid ? '' : 'Not a price'}
            {room && !edited && card.gain_week !== null && card.gain_week > 0 && (
              <span className="text-slate-500" title="About this much more profit a week if it keeps selling at the same pace"> · +£{card.gain_week.toFixed(2)} a week</span>
            )}
          </span>
          {warnings.map((w) => <span key={w.text} className={'text-xs ' + (w.red ? 'text-red-600' : 'text-amber-700')}>{w.text}</span>)}
          </>)}
        </div>
        <p className="mt-1.5 hidden text-[11px] text-slate-400 sm:block">
          Enter set · → leave · ← previous · E edit · U undo the last set — sent to Amazon at once, review in 7 days (a later date kept).
        </p>
      </div>
    </div>
  );
}

