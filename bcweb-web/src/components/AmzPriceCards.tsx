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
           STEP CARDS   /amz/step-cards?step=<list>&when=<chip>[&at=<code>]  a Stock ladder list's sizes (owner, 2026-11-15,
                                           docs/stock-ladder.md): Overstocked · Unsold 90 · Unsold 180 · Clearance, opened by the
                                           list's PRICE THESE for what the list is showing (its chip: due · week · later · all). Never a
                                           Buy Box size (server). Walked in order like search; a not-due size's Leave is "Next". The
                                           reason line is the step's AIM (lib/stockLadder → stepAim) — no suggestion (owner, option A).
                                           Back = the list on the same chip.
           BUY BOX CARDS /amz/lost-cards?part=<cheaper|level|nobody>  where we don't have the Buy Box — one part of the Amazon
                                           Pricing strip (owner, 2026-11-21; server ?lost=, THE split utils/amzBuyBox.js → lostPart).
                                           Walked in the SERVER's order, no style grouping: cheaper is biggest price gap first (owner),
                                           the gap shown on the card's status line. Buy Box suggestion with Use it, as on search.
           NEW CARDS    /amz/new-cards[?cut=a,b|?only=a,b]&from=&back=  New Additions' BUY BOX button (owner, 2026-11-22: "the list of items
                                           that are on Amazon and just the sizes that have not sold anything yet"): its white tiles
                                           at Amazon, live or on the way (server ?new=1, utils/processMap.js → unsoldNewSkus), due or
                                           not. The screen's soft-cut styles (?cut=) are left out — the cards are what's on screen;
                                           with rows selected there, ?only= those styles (owner, 2026-11-23).
                                           Oldest-added style first (owner, 2026-11-22); the status line leads with the size's days left (owner, same day); walked like search, Buy Box suggestion with Use it.
         Data: GET /amz-all-list ?cards=1 (getAmzDueCards / getAmzSearchCards / getAmzStepCards).

NO SUGGESTION of its own (owner: "no suggestion — I'll type the price or give me the options like we have on the amazon price
         screen. up, down, set"). On a search card a size with a Buy Box card shows THAT card's suggestion (server
         utils/amzBuyBoxDeck.js → readDeck, the same rules) with "Use it", which only fills the box (owner: "keep the cards and the
         recommendations").

THE CARD is components/AmzCardFrame — THE one Amazon price card layout, shared with the Buy Box cards (owner, 2026-11-14: "the
         same layout and make it simpler"; read its header). Here: [search: status line, the Buy Box suggestion with Use it] · the box
         starts at today's price · the review chips · one line of stock and sales, then the last price change. The sellers pop-up and
         the last change come with ?cards=1 (offers / featured / last_change, 2026-11-14). profit_line = server profitLine — no second
         copy of the profit formula here.

SET = the normal W-A1 (POST /amz-apply), sent to Amazon at once, note "Due card" / "Search card", with the chosen review date.
LEAVE = POST /amz-review (the list's "no change — just set review"): the price stays, the review date moves; note "… — left". On to
         the next card at once while it saves; a failure brings the card back.
REVIEW CHIPS = THE one list (lib/reviewPeriods.ts: 3 · 7 · 14 · 30 + Season). Preselected 7 — the /amz-pricing skill's
         REVIEW_AFTER_PRICE_DAYS (utils/amzPricingStandard.js), the earliest a new price can be judged. The pick stays for the visit,
         EXCEPT Season: it goes back to 7 on the next card (owner, 2026-11-15) — a long wait is chosen per size, never carried over.

ORDER: styles in the server's order (most FBA stock first), each style's sizes together in size order — sister sizes side by side.
         THE LIST STAYS PUT while you work (a snapshot: no refetch on focus); Refresh reloads it.
FULL PRICE SCREEN: /amz/sku/<code> with ?from= this page + &at=<code>, so its Back lands on the same card.

KEYS: the frame's (Enter = Set · → or L = Leave (Next) · ← = previous card · E = edit the price · in the box ↑ / ↓ = ±30p).
=======================================================================================================================================
*/

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzCardFrame, { LastChangeLine, money } from '@/components/AmzCardFrame';
import { applyAmzPrice, getAmzDueCards, getAmzLostCards, getAmzNewCards, getAmzSearchCards, getAmzStepCards, isLostPart, markAmzReviewed, type AmzLostPart,
  type AmzPriceCard, type LadderListKey } from '@/lib/api';
import { LOST_TEXT } from '@/lib/buyboxAnswers';
import { CHIPS, LIST_TEXT, isChip, isLadderList, stepAim, stepListHref } from '@/lib/stockLadder';
import { REVIEW_PERIODS, seasonPark } from '@/lib/reviewPeriods';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { useAuth } from '@/contexts/AuthContext';
import { prettyPathLabel } from '@/lib/nav';

export type PriceCardsMode = 'due' | 'search' | 'step' | 'lost' | 'new';

const DEFAULT_REVIEW = 7;                        // header: the skill's REVIEW_AFTER_PRICE_DAYS
const NOTE = { due: 'Due card', search: 'Search card', step: 'Step card', lost: 'No Buy Box card', new: 'New Additions card' } as const;   // never "Buy Box …": Daily's done-today count leaves those notes out (the deck's own rows)
const END = '__end__';                           // search cards: past the last card
// Taken once at module load (react-hooks/purity): the Season chip and "n days ago".
const SEASON = seasonPark();
const TODAY_MS = new Date(new Date().toDateString()).getTime();

const noSubscribe = () => () => {};   // useSyncExternalStore for the "hydrated yet?" flag (nothing to subscribe to)
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
  const at = useUrlParam('at');   // the card to open on (the full price screen's Back)
  // STEP CARDS (header): the Stock ladder list and its chip.
  const stepParam = useUrlParam('step');
  const step = isLadderList(stepParam) ? stepParam : null;
  const whenParam = useUrlParam('when');
  const when = isChip(whenParam) ? whenParam : 'all';
  // BUY BOX CARDS (header): the part of the strip.
  const partParam = useUrlParam('part');
  const part = isLostPart(partParam) ? partParam : null;
  // NEW CARDS (header): New Additions' soft-cut styles, left out.
  const cutParam = useUrlParam('cut') ?? '';
  const onlyParam = useUrlParam('only') ?? '';   // NEW CARDS: New Additions' selected styles, when any are picked
  const router = useRouter();
  const walk = mode !== 'due';   // search and step cards walk start to end; due cards wrap round to what's left
  // The log note: "Step card · Unsold 90" says which list the price came from.
  const noteFor = mode === 'step' && step ? `${NOTE.step} · ${LIST_TEXT[step].name}` : mode === 'lost' && part ? `${NOTE.lost} · ${LOST_TEXT[part].label}` : NOTE[mode];
  // CAME FROM ANOTHER SCREEN (the product menu passes ?from= / ?back=): Back returns there. Our own paths only.
  const fromRaw = useUrlParam('from');
  const from = fromRaw && fromRaw.startsWith('/') && !fromRaw.startsWith('//') ? fromRaw : null;
  const backLabel = useUrlParam('back') || (from ? prettyPathLabel(from) : mode === 'step' && step ? LIST_TEXT[step].name : mode === 'new' ? 'New Additions' : 'Amazon Pricing');
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const backHref = from ?? (mode === 'step' && step ? stepListHref(step, when)
    : mode === 'search' && q ? `/amz?q=${encodeURIComponent(q)}` : mode === 'new' ? '/analytics/new-additions' : '/amz');
  const fromQs = from ? `&from=${encodeURIComponent(from)}&back=${encodeURIComponent(backLabel)}` : '';
  const selfPath = mode === 'search'
    ? `/amz/search-cards?${g ? `g=${encodeURIComponent(g)}` : `q=${encodeURIComponent(q)}`}${fromQs}`
    : mode === 'step' ? `/amz/step-cards?step=${step ?? ''}&when=${when}`
      : mode === 'lost' ? `/amz/lost-cards?part=${part ?? ''}`
        : mode === 'new' ? `/amz/new-cards?${onlyParam ? `only=${encodeURIComponent(onlyParam)}` : `cut=${encodeURIComponent(cutParam)}`}${fromQs}` : '/amz/due-cards';

  // A snapshot (header): nothing refetches by itself. Waits for the client (useUrlParam reads null until hydrated).
  const key = !hydrated ? null : mode === 'due' ? ['amz-price-cards', 'due']
    : mode === 'step' ? (step ? ['amz-price-cards', 'step', step, when] : null)
      : mode === 'lost' ? (part ? ['amz-price-cards', 'lost', part] : null)
      : mode === 'new' ? ['amz-price-cards', 'new']
      : g ? ['amz-price-cards', 'style', g] : q ? ['amz-price-cards', 'search', q] : null;
  const { data: raw, error: loadError, busy: isLoading, refresh } = useApiQuery(key,
    () => (mode === 'due' ? getAmzDueCards() : mode === 'step' ? getAmzStepCards(step as LadderListKey, when)
      : mode === 'lost' ? getAmzLostCards(part as AmzLostPart)
      : mode === 'new' ? getAmzNewCards()
      : getAmzSearchCards(g ? { g } : { q })),
    { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnMount: true, revalidateOnReconnect: false });
  // FRESH ON EVERY OPEN (owner, 2026-11-13: Daily said 8 due, the screen showed 0 until Refresh — a copy from an earlier visit).
  // revalidateOnMount reads again on every open; until that read is in, nothing shows, so a card is never priced from the old copy.
  // Nothing refetches while you work (focus / reconnect off), so the list still stays put.
  const data = isLoading ? undefined : raw;

  // ORDER (header): styles in the server's order, each style's sizes together in size order — BUT the Buy Box cards keep the server's
  // order exactly (cheaper = biggest price gap first, owner 2026-11-21; grouping by style would undo it).
  const cards = useMemo(() => {
    const cut = new Set(cutParam.split(',').filter(Boolean));
    const only = new Set(onlyParam.split(',').filter(Boolean));
    // NEW CARDS: the screen's selected styles, else everything less its soft cuts (both only ever set there)
    const rows = (data?.rows ?? []).filter((r) => !cut.has(r.groupid) && (only.size === 0 || only.has(r.groupid)));
    if (mode === 'lost') return rows;
    const styleRank = new Map<string, number>();
    rows.forEach((r) => { if (!styleRank.has(r.groupid)) styleRank.set(r.groupid, styleRank.size); });
    return [...rows].sort((a, b) => (styleRank.get(a.groupid)! - styleRank.get(b.groupid)!) || sizeKey(a.code) - sizeKey(b.code) || a.code.localeCompare(b.code));
  }, [data, mode, cutParam, onlyParam]);

  const [done, setDone] = useState<Map<string, Done>>(() => new Map());
  const [cur, setCur] = useState<string | null>(null);
  const [review, setReview] = useState<number>(DEFAULT_REVIEW);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'err' } | null>(null);

  const open = cards.filter((c) => !done.has(c.code));
  const want = cur ?? at;
  const current = want === END ? null : cards.find((c) => c.code === want) ?? (mode === 'due' ? open[0] : cards[0]) ?? null;
  const index = current ? cards.indexOf(current) : -1;

  // SEASON doesn't carry to the next card — back to 7 days (header); set during render, React's reset-on-change pattern.
  const [reviewFor, setReviewFor] = useState<string | null>(current?.code ?? null);
  if ((current?.code ?? null) !== reviewFor) { setReviewFor(current?.code ?? null); if (review === SEASON.days) setReview(DEFAULT_REVIEW); }

  // The next card after `code`: DUE wraps round to what's still to do (null = Due is clear); SEARCH walks on in order (END at the end).
  function nextAfter(code: string, doneNow: Map<string, Done>): string | null {
    const i = cards.findIndex((c) => c.code === code);
    if (walk) return cards[i + 1]?.code ?? END;
    const order = [...cards.slice(i + 1), ...cards.slice(0, i)];
    return order.find((c) => !doneNow.has(c.code))?.code ?? null;
  }

  async function setPrice(card: AmzPriceCard, price: number, used: boolean) {
    if (busy) return;
    setBusy(true); setMsg(null);
    const res = await applyAmzPrice(card.code, price, `${noteFor}${used ? ' (Buy Box suggestion)' : ''}`, review);
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
    const res = await markAmzReviewed([card.code], review, `${noteFor} — left`);
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
  const title = mode === 'due' ? 'Not selling · due'
    : mode === 'step' ? `${step ? LIST_TEXT[step].name : 'Range'} · ${CHIPS.find((c) => c.key === when)?.label ?? 'All'}`
      : mode === 'lost' ? (part ? `No Buy Box · ${LOST_TEXT[part].label} · ${LOST_TEXT[part].hint}` : 'No Buy Box')
      : mode === 'new' ? (onlyParam ? `New Additions · ${onlyParam.split(',').filter(Boolean).length === 1 ? onlyParam : `${onlyParam.split(',').filter(Boolean).length} selected styles`} · unsold sizes at Amazon` : 'New Additions · unsold sizes at Amazon')
      : g ? `Style ${g}` : `Search “${q}”`;

  return (
    <AppShell crumb={<span className="font-medium text-slate-800">{mode === 'due' ? 'Due cards' : mode === 'step' ? 'Step cards' : mode === 'lost' || mode === 'new' ? 'Buy Box cards' : 'Search cards'}</span>}>
      <div className="mx-auto flex max-w-[55rem] flex-col gap-2.5">
        {/* TOOLBAR — Back · what these cards are · progress count · Refresh. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={backHref} title={`Back to ${backLabel}`}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            ← Back
          </Link>
          {mode === 'step' && step ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{LIST_TEXT[step].name}</span>
              {/* ALL | DUE (owner, 2026-11-15 — as the Shopify step cards): flips ?when=, the cards re-read and start from the first.
                  Within a week / Later stay on the step list's chips. */}
              <span className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
                {(['all', 'due'] as const).map((w) => (
                  <button key={w} type="button" disabled={when === w}
                    onClick={() => { setCur(null); setDone(new Map()); router.replace(`/amz/step-cards?step=${step}&when=${w}${fromQs}`, { scroll: false }); }}
                    className={'h-7 rounded px-2.5 text-sm font-medium ' + (when === w ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-50')}>
                    {w === 'all' ? 'All' : 'Due'}
                  </button>
                ))}
              </span>
              {when !== 'all' && when !== 'due' && <span className="text-sm text-slate-500">{CHIPS.find((c) => c.key === when)?.label}</span>}
            </span>
          ) : (
            <span className="text-sm font-semibold text-slate-900">{title}</span>
          )}
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
          <Card key={current.code} mode={mode} step={step} card={current} n={index + 1} of={cards.length} busy={busy} done={done.get(current.code) ?? null}
            review={review} onReview={setReview} onSet={(p, used) => setPrice(current, p, used)} onLeave={() => leave(current)} onPrev={previous}
            onNext={() => setCur(nextAfter(current.code, done))}
            priceScreenHref={`/amz/sku/${encodeURIComponent(current.code)}?from=${encodeURIComponent(`${selfPath}${selfPath.includes('?') ? '&' : '?'}at=${encodeURIComponent(current.code)}`)}`} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <div className="text-lg font-medium text-slate-900">
              {mode === 'due' ? (cards.length ? 'All done — Due is clear' : 'Nothing due')
                : mode === 'step' ? (cards.length ? 'End of the list' : 'Nothing to price on this list')
                : mode === 'lost' ? (cards.length ? 'End of the list' : 'None in this part on the last reading')
                : mode === 'new' ? (cards.length ? 'End of the list' : 'No unsold new size is at Amazon')
                : cards.length ? (g ? 'End of the style' : 'End of the search')
                  : g ? `${g} has no sizes at Amazon` : `Nothing at Amazon matches “${q}”`}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {cards.length ? `${setCount} set · ${leftCount} left. ` : ''}
              {mode === 'due' ? 'A size comes back when its review date comes round.' : ''}
            </p>
            {walk && cards.length > 0 && (
              <button type="button" onClick={() => setCur(cards[0].code)} className="mt-3 text-sm text-brand-700 hover:underline">Start again from the first card</button>
            )}
          </div>
        ))}

        {/* The last result as one quiet line, in a fixed slot so nothing above moves. */}
        <div className="flex h-6 min-w-0 items-center gap-2 whitespace-nowrap text-sm" title={msg?.text}>
          {/* Errors and warnings only — no success line or tick (owner, 2026-11-15); the card's own note says what was sent. */}
          {msg && msg.tone !== 'ok' && (
            <>
              <span className={'min-w-0 truncate ' + (msg.tone === 'err' ? 'text-red-600' : msg.tone === 'warn' ? 'text-amber-700' : 'text-slate-600')}>{msg.text}</span>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Card({ mode, step, card, n, of, busy, done, review, onReview, onSet, onLeave, onPrev, onNext, priceScreenHref }: {
  mode: PriceCardsMode; step: LadderListKey | null; card: AmzPriceCard; n: number; of: number; busy: boolean; done: Done | null;
  review: number; onReview: (d: number) => void;
  onSet: (price: number, usedSuggestion: boolean) => void; onLeave: () => void; onPrev: () => void; onNext: () => void;
  priceScreenHref: string;
}) {
  const now = card.price;
  const [priceStr, setPriceStr] = useState(done?.kind === 'set' ? done.price.toFixed(2) : now !== null ? now.toFixed(2) : '');

  const price = Number.parseFloat(priceStr);
  const valid = Number.isFinite(price) && price > 0;
  const changed = valid && (now === null || Math.round(price * 100) !== Math.round(now * 100));
  // The Buy Box lead's price to match (postage included) — only when someone else leads.
  const matchAt = card.bb_lead !== null && card.bb_lead !== undefined && !['US', 'US_SHARED'].includes(card.bb_holder ?? '') ? Number(card.bb_lead) : null;
  const suggest = mode !== 'due' ? card.bb_suggest ?? null : null;   // step: its Buy Box sizes (2026-11-17)
  const usedSuggestion = suggest !== null && valid && Math.round(price * 100) === Math.round(suggest * 100);
  // A not-due search card is only looked at (header): its Leave is Next — nothing written, its review date kept.
  const lookOnly = mode !== 'due' && card.parked;   // search and step cards
  const forward = () => (done || lookOnly ? onNext() : onLeave());

  const reviewChips = [...REVIEW_PERIODS.map((d) => ({ days: d, label: `${d}d`, title: `Review in ${d} days` })),
    { days: SEASON.days, label: SEASON.label, title: SEASON.title }];
  const pill = 'inline-flex h-9 min-w-[3.25rem] items-center justify-center rounded-md border px-2 text-sm font-medium tabular-nums';
  // BUY BOX CARDS (header): a cheaper rival's gap leads the status line (the order the cards come in), and the size's REVIEW DATE
  // always shows (owner, 2026-11-21: "Do we have the current DUE date displayed?" — a summer style is parked to spring from here
  // with the Season chip). A selling size's date is not what makes it due (the Buy Box decides it), but it is still its date.
  const reviewText = card.next_review ? `review date ${dateLabel(card.next_review)}` : 'no review date';
  const status = mode === 'lost'
    ? { text: card.bb_gap != null && card.bb_gap > 0 ? `The Buy Box is ${money(card.bb_gap)} under our price · ${reviewText}` : card.due_by === 'buybox' ? `${statusOf(card).text} · ${reviewText}` : statusOf(card).text, cls: 'text-slate-900' }   // the review half's line already carries its date
    // NEW CARDS (header): the size's days left on New Additions leads the status line — the only addition to the standard card.
    : mode === 'new' && card.days_left != null ? { ...statusOf(card), text: `${card.days_left} day${card.days_left === 1 ? '' : 's'} left on New Additions · ${statusOf(card).text}` }
    : mode !== 'due' ? statusOf(card) : null;
  // STEP CARDS (header): the step's aim is the reason line; a Buy Box size shows the Buy Box suggestion instead.
  const aim = mode === 'step' && step ? stepAim(step, card.ladder_idle_days ?? 0, card.ladder_over ?? 0, card.ladder_over_why) : null;

  return (
    <AmzCardFrame
      code={card.code} groupid={card.groupid} size={card.size} title={card.title} brand={card.brand} imagename={card.imagename}
      counter={`${n} of ${of}`}
      links={[{ href: priceScreenHref, label: 'Full price screen →', title: 'The full price screen for this SKU — sales and price history; its Back returns to this card' }]}
      status={status && <span className={status.cls}>{status.text}</span>}
      reason={suggest !== null ? (
        <>
          <span className="text-slate-600">Buy Box suggests <b className="tabular-nums text-slate-900">{money(suggest)}</b></span>
          {card.bb_suggest_note && <span className="min-w-0 flex-1 truncate text-slate-400" title={card.bb_suggest_note}>{card.bb_suggest_note}</span>}
          <button type="button" onClick={() => setPriceStr(suggest.toFixed(2))} disabled={usedSuggestion}
            className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40">Use it</button>
        </>
      ) : aim ? <span className="text-slate-700">{aim}</span> : undefined}
      priceStr={priceStr} setPriceStr={setPriceStr}
      now={now} profitNow={card.profit_now} profitAt={(p) => profitAt(card, p)} rrp={card.rrp}
      holder={holderLabel(card)} share={card.bb_share ?? null} matchAt={matchAt} busy={busy || done?.kind === 'set'} onMatch={(m) => { if (!busy) onSet(m, false); }} offers={card.offers} featured={card.featured} rank={card.sales_rank ?? null}
      facts={<>
        <div>
          <span className={card.fba === 0 ? 'text-amber-700' : ''}>{card.fba} at Amazon{card.fba_inbound ? ` · +${card.fba_inbound} coming` : ''}</span>
          <span className="text-slate-300"> · </span>
          {card.last_sold
            ? <span>{card.units} sold in 30 days · {card.u12} in 12 months · last {saleLabel(card.last_sold)}</span>
            : <span>no Amazon sale yet</span>}
        </div>
        <LastChangeLine change={card.last_change} />
      </>}
      review={
        <>
          <span className="mr-1 text-sm text-slate-500">Review in</span>
          {reviewChips.map((c) => (
            <button key={c.label} type="button" onClick={() => onReview(c.days)} title={c.title}
              className={`${pill} ` + (review === c.days ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
              {c.label}
            </button>
          ))}
        </>
      }
      onPrev={onPrev} prevDisabled={n <= 1}
      secondary={{
        label: done || lookOnly ? 'Next →' : 'Leave', onClick: forward, disabled: busy && !done && !lookOnly,
        title: done || lookOnly ? 'Next card — nothing written (→)' : 'Keep the price, set the review date (→ or L)',
      }}
      primary={{
        // "Already £x" when the box holds today's price — nothing to send; Leave keeps it (owner, 2026-11-14: a grey Set read as broken).
        label: valid && !changed ? `Already ${money(price)}` : `Set ${valid ? money(price) : ''}`,
        onClick: () => { if (valid && changed && !busy) onSet(price, usedSuggestion); },
        disabled: busy || !changed, title: changed ? 'Save, send to Amazon and set the review date (Enter)' : 'Already the price on Amazon — Leave keeps it',
      }}
      note={done?.kind === 'set' ? (
        <span className={'truncate ' + (done.sent ? 'text-emerald-700' : 'text-amber-700')}>Set to {money(done.price)} — {done.sent ? 'sent to Amazon' : `NOT sent${done.message ? `: ${done.message}` : ''} (it stays on Send to Amazon)`}</span>
      ) : done?.kind === 'left' ? (
        <span className="text-slate-500">Left at {money(now)}</span>
      ) : null}
    />
  );
}
