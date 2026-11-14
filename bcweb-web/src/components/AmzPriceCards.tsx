'use client';
/*
=======================================================================================================================================
Component: AmzPriceCards  (PRICE CARDS — Amazon sizes one card at a time; owner 2026-11-13)
=======================================================================================================================================
Purpose: Owner: "the usual price change screen but reduced to cards to make it easier and more fun for me to go through DUE", and "search
         for 'something' … see the count of the search, press it and get the cards one by one to act on … the card will have the due
         date etc but not hide anything as I want to take a look. From the card I can go to the full pricing screen for that SKU."
         Two pages, one component:
           DUE CARDS    /amz/due-cards     the Not selling · due sizes (the review half of THE one Amazon due rule, server
                                           utils/amzDue.js — never a Buy Box size, those have the Buy Box cards). Worked to zero:
                                           Set / Leave take the size off; the run wraps round to what's left.
           SEARCH CARDS /amz/search-cards  every size the Amazon Pricing search matches (?q=, server matchesSearch) — due, Buy Box
                                           move, not due, on its way in: NOTHING HIDDEN. Walked in order, start to end. A status line
                                           says which each one is; a not-due size's Leave is "Next" (looking writes nothing — its
                                           review date is not touched).
           ONE STYLE    /amz/search-cards?g=<groupid>&from=&back=  the search cards for one style exactly (server matchesStyle) —
                                           the product menu's Amazon Price card (components/ProductNavCards; owner, 2026-11-13, from
                                           New Additions: "choose a style … and go through the cards"). Back returns to ?from=.
         Data: GET /amz-all-list ?cards=1 (getAmzDueCards / getAmzSearchCards).

NO SUGGESTION of its own (owner: "no suggestion — I'll type the price or give me the options like we have on the amazon price
         screen. up, down, set"). On a search card a size with a Buy Box card in the chosen mood shows THAT card's suggestion (server
         utils/amzBuyBoxDeck.js → readDeck, the same rules) with "Use it", which only fills the box (owner: "keep the cards and the
         recommendations").

THE CARD (trimmed by the owner, 2026-11-14: "too many figures … noise. I am interested in matching the buy box or moving up or down
         as normal. Want to see what my current profit"): who (picture, groupid + size, name, brand, Full price screen →) → [search:
         status line, Buy Box suggestion] → the price (nudges −£1 −50p −30p / +30p +50p +£1; profit now, and at the typed price once it
         moves) → Buy Box (who leads, at what, our share; match keeps £x + Match) → one line of stock and sales → decide (review chips,
         Leave, Set). Nothing blocks: a loss shows red, over RRP is noted; no walk-away / break-even figures or warnings. profit_line =
         server profitLine — no second copy of the profit formula here.

SET = the normal W-A1 (POST /amz-apply), sent to Amazon at once, note "Due card" / "Search card", with the chosen review date.
LEAVE = POST /amz-review (the list's "no change — just set review"): the price stays, the review date moves; note "… — left". On to
         the next card at once while it saves; a failure brings the card back.
REVIEW CHIPS = THE one list (lib/reviewPeriods.ts: 3 · 7 · 14 · 30 + Season). Preselected 7 — the /amz-pricing skill's
         REVIEW_AFTER_PRICE_DAYS (utils/amzPricingStandard.js), the earliest a new price can be judged. The pick stays for the visit.

ORDER: styles in the server's order (most FBA stock first), each style's sizes together in size order — sister sizes side by side.
         THE LIST STAYS PUT while you work (a snapshot: no refetch on focus); Refresh reloads it.
FULL PRICE SCREEN: /amz/sku/<code> with ?from= this page + &at=<code>, so its Back lands on the same card.

KEYS (not while typing in the price box, except Enter / Esc / ↑ ↓): Enter = Set · → or L = Leave (Next) · ← = previous card · E = edit
         the price · in the box ↑ / ↓ = +30p / −30p.
=======================================================================================================================================
*/

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { applyAmzPrice, getAmzDueCards, getAmzSearchCards, markAmzReviewed, type AmzMood, type AmzPriceCard } from '@/lib/api';
import { REVIEW_PERIODS, seasonPark } from '@/lib/reviewPeriods';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { useAuth } from '@/contexts/AuthContext';
import { prettyPathLabel } from '@/lib/nav';

export type PriceCardsMode = 'due' | 'search';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
const NUDGES = [-1, -0.5, -0.3, 0.3, 0.5, 1];   // the price screen's steps (components/AmzPriceSetter)
const DEFAULT_REVIEW = 7;                        // header: the skill's REVIEW_AFTER_PRICE_DAYS
const NOTE = { due: 'Due card', search: 'Search card' } as const;
const END = '__end__';                           // search cards: past the last card
// Taken once at module load (react-hooks/purity): the Season chip and "n days ago".
const SEASON = seasonPark();
const TODAY_MS = new Date(new Date().toDateString()).getTime();

const noSubscribe = () => () => {};   // useSyncExternalStore for the "hydrated yet?" flag (nothing to subscribe to)
const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);
const r2 = (n: number) => Math.round(n * 100) / 100;
function profitAt(card: AmzPriceCard, price: number): number | null {
  const l = card.profit_line;
  return l && Number.isFinite(price) ? r2(l.per_pound * price + l.at_zero) : null;
}
// '12 Oct 2025' from YYYY-MM-DD (a calendar day, read as one — never through toISOString).
function dayOf(v: string): Date { const [y, m, d] = v.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
const dateLabel = (v: string) => dayOf(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function saleLabel(v: string): string {
  const days = Math.round((TODAY_MS - dayOf(v).getTime()) / 86400000);
  return days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
}
// Profit a pair: red when it is a loss — the only colour (owner, 2026-11-14: no walk-away warning).
const keepCls = (v: number | null) => (v !== null && v < 0 ? 'text-red-600' : 'text-slate-900');
function holderLabel(card: AmzPriceCard): string {
  switch (card.bb_holder) {
    case 'US': return 'We have it';
    case 'US_SHARED': return 'We share it';
    case 'AMAZON': return `Amazon at ${money(card.bb_lead)}`;
    case 'OTHER_FBA': return `An FBA seller at ${money(card.bb_lead)}`;
    case 'OTHER_MFN': return `A self-poster at ${money(card.bb_lead)}`;
    case 'NONE': return 'Nobody has it';
    default: return 'Not read';
  }
}
// Search cards' status line: is the size due, a Buy Box move, or not due (and till when)?
function statusOf(card: AmzPriceCard): { text: string; cls: string } {
  if (!card.parked) return { text: card.next_review ? `Due — review date was ${dateLabel(card.next_review)}` : 'Due — no review date yet', cls: 'text-slate-900' };
  if (card.bb_card) return { text: 'Selling — a Buy Box move (on the Buy Box cards)', cls: 'text-emerald-700' };
  if (card.due_by === 'buybox') return { text: 'Selling — the Buy Box decides it, no move today', cls: 'text-slate-600' };
  return { text: card.next_review ? `Not due — next review ${dateLabel(card.next_review)}` : 'Not due', cls: 'text-slate-600' };
}
// Size order inside a style (the code's suffix after the last '-', numeric when it can be).
const sizeKey = (code: string) => { const s = code.slice(code.lastIndexOf('-') + 1); return /^[0-9]+([.][0-9]+)?$/.test(s) ? Number(s) : Infinity; };

type Done = { kind: 'set'; price: number; sent: boolean; message: string | null } | { kind: 'left' };

export default function AmzPriceCards({ mode }: { mode: PriceCardsMode }) {
  const { logout } = useAuth();
  const q = (useUrlParam('q') ?? '').trim();
  const g = (useUrlParam('g') ?? '').trim();   // ONE STYLE (header): the product menu's Amazon Price card — beats q
  const moodParam = useUrlParam('mood');
  const mood: AmzMood = moodParam === 'fierce' || moodParam === 'climb' ? moodParam : 'chilled';
  const at = useUrlParam('at');   // the card to open on (the full price screen's Back)
  // CAME FROM ANOTHER SCREEN (the product menu passes ?from= / ?back=): Back returns there. Our own paths only.
  const fromRaw = useUrlParam('from');
  const from = fromRaw && fromRaw.startsWith('/') && !fromRaw.startsWith('//') ? fromRaw : null;
  const backLabel = useUrlParam('back') || (from ? prettyPathLabel(from) : 'Amazon Pricing');
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const backHref = from ?? (mode === 'search' && q ? `/amz?q=${encodeURIComponent(q)}` : '/amz');
  const fromQs = from ? `&from=${encodeURIComponent(from)}&back=${encodeURIComponent(backLabel)}` : '';
  const selfPath = mode === 'search'
    ? `/amz/search-cards?${g ? `g=${encodeURIComponent(g)}` : `q=${encodeURIComponent(q)}`}&mood=${mood}${fromQs}`
    : '/amz/due-cards';

  // A snapshot (header): nothing refetches by itself. Waits for the client (useUrlParam reads null until hydrated).
  const key = !hydrated ? null : mode === 'due' ? ['amz-price-cards', 'due']
    : g ? ['amz-price-cards', 'style', g, mood] : q ? ['amz-price-cards', 'search', q, mood] : null;
  const { data: raw, error: loadError, busy: isLoading, refresh } = useApiQuery(key,
    () => (mode === 'due' ? getAmzDueCards() : getAmzSearchCards(g ? { g } : { q }, mood)),
    { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnMount: true, revalidateOnReconnect: false });
  // FRESH ON EVERY OPEN (owner, 2026-11-13: Daily said 8 due, the screen showed 0 until Refresh — a copy from an earlier visit).
  // revalidateOnMount reads again on every open; until that read is in, nothing shows, so a card is never priced from the old copy.
  // Nothing refetches while you work (focus / reconnect off), so the list still stays put.
  const data = isLoading ? undefined : raw;

  // ORDER (header): styles in the server's order, each style's sizes together in size order.
  const cards = useMemo(() => {
    const rows = data?.rows ?? [];
    const styleRank = new Map<string, number>();
    rows.forEach((r) => { if (!styleRank.has(r.groupid)) styleRank.set(r.groupid, styleRank.size); });
    return [...rows].sort((a, b) => (styleRank.get(a.groupid)! - styleRank.get(b.groupid)!) || sizeKey(a.code) - sizeKey(b.code) || a.code.localeCompare(b.code));
  }, [data]);

  const [done, setDone] = useState<Map<string, Done>>(() => new Map());
  const [cur, setCur] = useState<string | null>(null);
  const [review, setReview] = useState<number>(DEFAULT_REVIEW);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'err' } | null>(null);

  const open = cards.filter((c) => !done.has(c.code));
  const want = cur ?? at;
  const current = want === END ? null : cards.find((c) => c.code === want) ?? (mode === 'due' ? open[0] : cards[0]) ?? null;
  const index = current ? cards.indexOf(current) : -1;

  // The next card after `code`: DUE wraps round to what's still to do (null = Due is clear); SEARCH walks on in order (END at the end).
  function nextAfter(code: string, doneNow: Map<string, Done>): string | null {
    const i = cards.findIndex((c) => c.code === code);
    if (mode === 'search') return cards[i + 1]?.code ?? END;
    const order = [...cards.slice(i + 1), ...cards.slice(0, i)];
    return order.find((c) => !doneNow.has(c.code))?.code ?? null;
  }

  async function setPrice(card: AmzPriceCard, price: number, used: boolean) {
    if (busy) return;
    setBusy(true); setMsg(null);
    const res = await applyAmzPrice(card.code, price, `${NOTE[mode]}${used ? ' (Buy Box suggestion)' : ''}`, review);
    setBusy(false);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success || !res.data) { setMsg({ text: `${card.code}: ${res.error || 'could not set the price'}`, tone: 'err' }); return; }
    const amazon = res.data.amazon;
    const nextDone = new Map(done).set(card.code, { kind: 'set', price, sent: !!amazon?.sent, message: amazon?.message ?? null });
    setDone(nextDone);
    const when = res.data.next_review ? ` · review ${dateLabel(res.data.next_review)}` : '';
    setMsg({
      text: `${card.code} set to ${money(price)} — ${amazon?.sent ? 'sent to Amazon' : amazon ? `saved, NOT sent: ${amazon.message}` : 'saved'}${when}`,
      tone: amazon && !amazon.sent ? 'warn' : 'ok',
    });
    setCur(nextAfter(card.code, nextDone));
  }

  // LEAVE (header): on to the next card at once while the review date saves; a failure brings the card back.
  async function leave(card: AmzPriceCard) {
    const nextDone = new Map(done).set(card.code, { kind: 'left' });
    setDone(nextDone);
    setCur(nextAfter(card.code, nextDone));
    const res = await markAmzReviewed([card.code], review, `${NOTE[mode]} — left`);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success) {
      setDone((p) => { const n = new Map(p); if (n.get(card.code)?.kind === 'left') n.delete(card.code); return n; });
      setMsg({ text: `Leave ${card.code}: ${res.error || 'not saved'} — the card is back`, tone: 'err' });
    } else {
      setMsg({ text: `${card.code} left at ${money(card.price)} · review ${res.data?.nextReview ? dateLabel(res.data.nextReview) : ''}`, tone: 'ok' });
    }
  }

  function previous() {
    if (current && index > 0) setCur(cards[index - 1].code);
    else if (!current && cards.length) setCur(cards[cards.length - 1].code);   // from the end panel, back to the last card
  }

  async function reload() {
    setDone(new Map()); setCur(null); setMsg(null);
    await refresh();
  }

  const setCount = cards.filter((c) => done.get(c.code)?.kind === 'set').length;
  const leftCount = cards.filter((c) => done.get(c.code)?.kind === 'left').length;
  const title = mode === 'due' ? 'Not selling · due' : g ? `Style ${g}` : `Search “${q}”`;

  return (
    <AppShell crumb={<span className="font-medium text-slate-800">{mode === 'due' ? 'Due cards' : 'Search cards'}</span>}>
      <div className="mx-auto flex max-w-[55rem] flex-col gap-2.5">
        {/* TOOLBAR — Back · what these cards are · progress count · Refresh. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={backHref} title={`Back to ${backLabel}`}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            ← Back
          </Link>
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          {mode === 'search' && <span className="text-xs text-slate-400" title="The mood chosen on Amazon Pricing">Buy Box suggestions in {mood[0].toUpperCase() + mood.slice(1)}</span>}
          <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-sm text-slate-500">
            {cards.length > 0 && (
              <span className="tabular-nums">{mode === 'due' ? `${setCount} set · ${leftCount} left · ${open.length} to go` : `${cards.length} sizes · ${setCount} set · ${leftCount} left`}</span>
            )}
            <button type="button" onClick={reload} aria-label="Refresh" title="Reload the sizes"
              className="inline-grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
              <ArrowPathIcon className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>

        {/* PROGRESS — a dot per card: hollow to do, green set, grey left, ringed current. Click to jump. */}
        {cards.length > 0 && (
          <div className="flex min-h-6 flex-wrap items-center gap-1.5">
            {cards.map((c) => {
              const d = done.get(c.code);
              const on = current?.code === c.code;
              return (
                <button key={c.code} type="button" onClick={() => setCur(c.code)} title={`${c.code}${d ? (d.kind === 'set' ? ` — set ${money(d.price)}` : ' — left') : ''}`}
                  className={'h-2.5 w-2.5 rounded-full ' + (d?.kind === 'set' ? 'bg-emerald-500' : d?.kind === 'left' ? 'bg-slate-300' : 'border border-slate-400 bg-white')
                    + (on ? ' ring-2 ring-slate-900 ring-offset-1' : '')} />
              );
            })}
          </div>
        )}

        {mode === 'search' && !q && !g && hydrated && <p className="text-sm text-slate-500">Type a search on <Link href="/amz" className="text-brand-700 hover:underline">Amazon Pricing</Link> first.</p>}
        {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
        {loadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}
        {data?.truncated && <p className="text-sm text-amber-700">Showing the first {cards.length} of {data.total} — narrow the search.</p>}

        {data && (current ? (
          <Card key={current.code} mode={mode} card={current} n={index + 1} of={cards.length} busy={busy} done={done.get(current.code) ?? null}
            review={review} onReview={setReview} onSet={(p, used) => setPrice(current, p, used)} onLeave={() => leave(current)} onPrev={previous}
            onNext={() => setCur(nextAfter(current.code, done))}
            priceScreenHref={`/amz/sku/${encodeURIComponent(current.code)}?from=${encodeURIComponent(`${selfPath}${selfPath.includes('?') ? '&' : '?'}at=${encodeURIComponent(current.code)}`)}`} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <div className="text-lg font-medium text-slate-900">
              {mode === 'due' ? (cards.length ? 'All done — Due is clear' : 'Nothing due')
                : cards.length ? (g ? 'End of the style' : 'End of the search')
                  : g ? `${g} has no sizes at Amazon` : `Nothing at Amazon matches “${q}”`}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {cards.length ? `${setCount} set · ${leftCount} left. ` : ''}
              {mode === 'due' ? 'A size comes back when its review date comes round.' : ''}
            </p>
            {mode === 'search' && cards.length > 0 && (
              <button type="button" onClick={() => setCur(cards[0].code)} className="mt-3 text-sm text-brand-700 hover:underline">Start again from the first card</button>
            )}
          </div>
        ))}

        {/* The last result as one quiet line, in a fixed slot so nothing above moves. */}
        <div className="flex h-6 min-w-0 items-center gap-2 whitespace-nowrap text-sm" title={msg?.text}>
          {msg && (
            <>
              {msg.tone === 'ok' && <span className="font-bold text-emerald-600">✓</span>}
              <span className={'min-w-0 truncate ' + (msg.tone === 'err' ? 'text-red-600' : msg.tone === 'warn' ? 'text-amber-700' : 'text-slate-600')}>{msg.text}</span>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Card({ mode, card, n, of, busy, done, review, onReview, onSet, onLeave, onPrev, onNext, priceScreenHref }: {
  mode: PriceCardsMode; card: AmzPriceCard; n: number; of: number; busy: boolean; done: Done | null;
  review: number; onReview: (d: number) => void;
  onSet: (price: number, usedSuggestion: boolean) => void; onLeave: () => void; onPrev: () => void; onNext: () => void;
  priceScreenHref: string;
}) {
  const now = card.price;
  const [priceStr, setPriceStr] = useState(done?.kind === 'set' ? done.price.toFixed(2) : now !== null ? now.toFixed(2) : '');
  const [imgFailed, setImgFailed] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);

  const price = Number.parseFloat(priceStr);
  const valid = Number.isFinite(price) && price > 0;
  const changed = valid && (now === null || Math.round(price * 100) !== Math.round(now * 100));
  const profit = valid ? profitAt(card, price) : null;
  // The Buy Box lead's price to match (postage included) — only when someone else leads.
  const matchAt = card.bb_lead !== null && card.bb_lead !== undefined && !['US', 'US_SHARED'].includes(card.bb_holder ?? '') ? Number(card.bb_lead) : null;
  const matchKeeps = matchAt !== null ? profitAt(card, matchAt) : null;
  const suggest = mode === 'search' ? card.bb_suggest ?? null : null;
  const usedSuggestion = suggest !== null && valid && Math.round(price * 100) === Math.round(suggest * 100);
  const nudge = (d: number) => {
    const base = Number.isFinite(price) ? price : now ?? 0;
    setPriceStr(Math.max(0.01, r2(base + d)).toFixed(2));
  };
  // A not-due search card is only looked at (header): its Leave is Next — nothing written, its review date kept.
  const lookOnly = mode === 'search' && card.parked;
  const forward = () => (done || lookOnly ? onNext() : onLeave());

  // KEYS (header). Re-bound each render so the handlers see this render's price.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const inBox = e.target === boxRef.current;
      const typing = !inBox && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement);
      if (typing) return;
      if (e.key === 'Enter') { e.preventDefault(); if (changed && !busy) onSet(price, usedSuggestion); return; }
      if (inBox) {
        if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0.3); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-0.3); }
        else if (e.key === 'Escape') boxRef.current?.blur();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') { e.preventDefault(); forward(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
      else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); boxRef.current?.focus(); boxRef.current?.select(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const reviewChips = [...REVIEW_PERIODS.map((d) => ({ days: d, label: `${d}d`, title: `Review in ${d} days` })),
    { days: SEASON.days, label: SEASON.label, title: SEASON.title }];
  const pill = 'inline-flex h-9 min-w-[3.25rem] items-center justify-center rounded-md border px-2 text-sm font-medium tabular-nums';
  const status = mode === 'search' ? statusOf(card) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* WHO */}
      <div className="flex items-center gap-4 border-b border-slate-100 px-5 py-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
          {card.imagename && !imgFailed && (
            <Image src={IMAGE_BASE + card.imagename} alt={card.title || card.code} fill sizes="80px" onError={() => setImgFailed(true)} className="object-contain" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold text-slate-900">{card.groupid}</span>
            <span className="rounded bg-slate-900 px-2 py-0.5 text-sm font-semibold text-white">{card.size}</span>
            <span className="text-xs tabular-nums text-slate-400">{n} of {of}</span>
          </div>
          <div className="mt-0.5 truncate text-sm text-slate-600">{card.title || '—'}<span className="ml-2 text-slate-400">{card.brand}</span></div>
          {status && <div className={'mt-1 text-sm font-medium ' + status.cls}>{status.text}</div>}
        </div>
        <Link href={priceScreenHref} className="shrink-0 text-sm text-brand-700 hover:underline" title="The full price screen for this SKU — sales and price history; its Back returns to this card">
          Full price screen →
        </Link>
      </div>

      {/* THE PRICE — [search: the Buy Box suggestion] the box with the nudges; profit a pair at the box; the marks it is judged against. */}
      <div className="px-5 py-4">
        {suggest !== null && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="text-slate-600">Buy Box suggests <b className="tabular-nums text-slate-900">{money(suggest)}</b></span>
            {card.bb_suggest_note && <span className="min-w-0 flex-1 truncate text-slate-400" title={card.bb_suggest_note}>{card.bb_suggest_note}</span>}
            <button type="button" onClick={() => setPriceStr(suggest.toFixed(2))} disabled={usedSuggestion}
              className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40">Use it</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {NUDGES.filter((d) => d < 0).map((d) => (
            <button key={d} type="button" onClick={() => nudge(d)} className={`${pill} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              −{d <= -1 ? `£${-d}` : `${Math.round(-d * 100)}p`}
            </button>
          ))}
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xl font-semibold text-slate-400">£</span>
            <input ref={boxRef} value={priceStr} onChange={(e) => setPriceStr(e.target.value)} inputMode="decimal" aria-label="New price"
              className="h-11 w-32 rounded-lg border border-slate-300 bg-white pl-7 pr-2 text-xl font-semibold tabular-nums text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          {NUDGES.filter((d) => d > 0).map((d) => (
            <button key={d} type="button" onClick={() => nudge(d)} className={`${pill} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              +{d >= 1 ? `£${d}` : `${Math.round(d * 100)}p`}
            </button>
          ))}
          {changed && (
            <button type="button" onClick={() => setPriceStr(now !== null ? now.toFixed(2) : '')} className="text-xs text-slate-500 underline hover:text-slate-700">
              back to {money(now)}
            </button>
          )}
        </div>
        {/* PROFIT (owner, 2026-11-14 trim: "want to see what my current profit") — now, and the typed price once it moves.
            Red under break-even; "over RRP" only when it is. No walk-away / break-even / RRP figures. */}
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
          <span>Now <b className="tabular-nums text-slate-900">{money(now)}</b> keeps <b className={'tabular-nums ' + keepCls(card.profit_now)}>{money(card.profit_now)}</b> a pair</span>
          {changed && <span>→ at {money(price)} keeps <b className={'tabular-nums ' + keepCls(profit)}>{money(profit)}</b></span>}
          {valid && card.rrp !== null && price > card.rrp && <span className="text-amber-700">over RRP {money(card.rrp)}</span>}
        </div>
        {/* BUY BOX (owner, 2026-11-14: "knowing clearly what the buy box is and whether I want to match or not"; "those two lines …
            together under the big price") — who leads and at what, what matching keeps, and Match, which only fills the box (Set
            still writes). No Match when we hold it. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          <span>Buy Box <b className="font-medium text-slate-900">{holderLabel(card)}</b>
            {card.bb_share !== null && card.bb_share !== undefined && <span className="text-slate-500"> · we&apos;re shown {Math.round(card.bb_share)}%</span>}</span>
          {matchAt !== null && (
            <span className="inline-flex items-center gap-3">
              <span>match keeps <b className={'tabular-nums ' + keepCls(matchKeeps)}>{money(matchKeeps)}</b></span>
              <button type="button" onClick={() => setPriceStr(matchAt.toFixed(2))}
                className="rounded-md border border-slate-300 bg-white px-3 py-0.5 text-sm font-medium text-slate-800 hover:bg-slate-50">Match {money(matchAt)}</button>
            </span>
          )}
        </div>
      </div>

      {/* STOCK AND SALES — one quiet line. */}
      <div className="border-y border-slate-100 px-5 py-2.5 text-sm text-slate-600">
        <span className={card.fba === 0 ? 'text-amber-700' : ''}>{card.fba} at Amazon{card.fba_inbound ? ` · +${card.fba_inbound} coming` : ''}</span>
        <span className="text-slate-300"> · </span>
        {card.last_sold
          ? <span>{card.units} sold in 30 days · {card.u12} in 12 months · last {saleLabel(card.last_sold)}</span>
          : <span>no Amazon sale yet</span>}
      </div>

      {/* DECIDE — the review date (Set and Leave both use it), Leave / Next, Set. One reserved line for a warning / what was done. */}
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-slate-500">Review in</span>
          {reviewChips.map((c) => (
            <button key={c.label} type="button" onClick={() => onReview(c.days)} title={c.title}
              className={`${pill} ` + (review === c.days ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
              {c.label}
            </button>
          ))}
          <span className="ml-auto inline-flex gap-2">
            <button type="button" onClick={onPrev} disabled={n <= 1} title="Previous card (←)"
              className="inline-flex h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">←</button>
            <button type="button" onClick={forward} disabled={busy && !done && !lookOnly}
              title={done || lookOnly ? 'Next card — nothing written (→)' : 'Keep the price, set the review date (→ or L)'}
              className="inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
              {done || lookOnly ? 'Next →' : 'Leave'}
            </button>
            <button type="button" onClick={() => valid && onSet(price, usedSuggestion)} disabled={busy || !changed}
              title={changed ? 'Save, send to Amazon and set the review date (Enter)' : 'Move the price first'}
              className="inline-flex h-11 items-center rounded-lg bg-emerald-600 px-6 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400">
              Set {valid ? money(price) : ''}
            </button>
          </span>
        </div>
        <div className="mt-2 h-5 truncate text-sm">
          {done?.kind === 'set' ? (
            <span className={done.sent ? 'text-emerald-700' : 'text-amber-700'}>Set to {money(done.price)} — {done.sent ? 'sent to Amazon' : `NOT sent${done.message ? `: ${done.message}` : ''} (it stays on Send to Amazon)`}</span>
          ) : done?.kind === 'left' ? (
            <span className="text-slate-500">Left at {money(now)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
