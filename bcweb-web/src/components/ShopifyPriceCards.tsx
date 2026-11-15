'use client';
/*
=======================================================================================================================================
Component: ShopifyPriceCards  (SHOPIFY PRICE CARDS — Shopify styles one card at a time; owner 2026-11-15, docs/shopify-cards/PLAN.md)
=======================================================================================================================================
Purpose: Shopify pricing in the Amazon cards' way (components/AmzPriceCards), with Google's price benchmark as the outside price.
         Page: /pricing/cards — opened by the "Price cards" button on the Shopify pricing list (decision 1), which passes its Due switch:
           Due on  (default)  the DUE styles, worked to zero: Set / Leave take a style off; the run wraps round to what's left.
           Due off (?pending=1)  every style on the list, walked in order; a not-due style is only looked at — its Leave is "Next"
                              (nothing written, its review date kept), as on the Amazon search cards.
         ?step=<ladder step> (Range's Arrived choice, 2026-11-15): only the styles holding a SKU on that Stock ladder step (server
         pricing-all-list → step); everything else is the same cards. With a step the toolbar carries its own All | Due switch
         (owner, 2026-11-15: "allow us to filter by DUE as well") — it flips ?pending=1, nothing else; there is no list behind it.
         And a REASON LINE (owner, same day: "will I know why it is there?") — lib/stockLadder → shopifyStepReason, from the row's
         step_skus / step_idle_days.
         Data: GET /pricing-all-list?cards=1 (getShopifyCards) — the list's own rows and order, each with its card. The Due system is
         untouched: a Set here is the normal W1 and a Leave the normal W2, so Daily's "Shopify due" moves exactly as from the list.

ONE CARD PER STYLE (decision 4): Shopify prices per style, so Set changes the style price. The sizes are inside: the Google line opens
         the size list (size, stock, our price at the box, Google's benchmark). Size prices in force are always shown; when the box would
         end one (the style price going to or below it — server utils/sizePrice.js → styleDrop), a small quiet note says so. Never
         blocked (owner: "not even a warning as long as it is shown somewhere").

THE GOOGLE LINE: the benchmark spread across the sizes that have one ("n of N sizes"), and how many of those sizes are under / level /
         over Google AT THE BOX PRICE (a size price in force counts at its own price unless the box ends it). Level = within
         LEVEL_BAND either way. No suggestion and no Match button on the basic card (decision 2) — the roll-up rule from sizes to one style
         price is still open.
THE AMAZON LINE: Amazon's dearest live size — the owner's floor, shown, never obeyed (CLAUDE.md); amber "under it" when the box is.

SET   = POST /pricing-apply (W1) with the chosen review date, note "Shopify card"; the response says whether Shopify took it and which
        size prices it ended.
LEAVE = POST /pricing-park (W2): the price stays, the review date moves. On to the next card at once; a failure brings the card back.
REVIEW CHIPS = THE one list (lib/reviewPeriods.ts), preselected 7 as on the Amazon cards; Season goes back to 7 on the next card.
THE LIST STAYS PUT while you work (a snapshot, re-read on every open); Refresh reloads it.
KEYS: the frame's (Enter = Set · → or L = Leave (Next) · ← = previous card · E = edit the price · in the box ↑ / ↓ = ±£1).
=======================================================================================================================================
*/

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import ShopifyCardFrame from '@/components/ShopifyCardFrame';
import { LastChangeLine, money } from '@/components/AmzCardFrame';
import { applyPrice, getShopifyCards, parkStyle, type LadderStepKey, type ShopifyCardRow, type ShopifyCardSize, type SizePriceEnded } from '@/lib/api';
import { REVIEW_PERIODS, seasonPark } from '@/lib/reviewPeriods';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { LIST_TEXT, shopifyStepReason } from '@/lib/stockLadder';
import { useAuth } from '@/contexts/AuthContext';

const DEFAULT_REVIEW = 7;
const NOTE = 'Shopify card';
const LEVEL_BAND = 0.03;
const BENCHMARK_STALE_DAYS = 3;                  // as components/GoogleAdsFreshness → STALE_DAYS                         // within 3% of Google's benchmark = level
const END = '__end__';                           // walking all: past the last card
const STORE_PRODUCT_BASE = 'https://brookfieldcomfort.com/products/';
const SEASON = seasonPark();
// ?step= — the Stock ladder steps the cards can be narrowed to, by their screen name (lib/stockLadder → LIST_TEXT).
const STEP_TITLE: Record<LadderStepKey, string> = {
  arrived: LIST_TEXT.arrived.name, sold: LIST_TEXT.sold.name, unsold90: LIST_TEXT.unsold90.name,
  unsold180: LIST_TEXT.unsold180.name, clearance: LIST_TEXT.clearance.name,
};

const noSubscribe = () => () => {};
const r2 = (n: number) => Math.round(n * 100) / 100;
function dayOf(v: string): Date { const [y, m, d] = v.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
const dateLabel = (v: string) => dayOf(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// Whole days from a YYYY-MM-DD to today, both read as local calendar days.
function daysSince(v: string): number {
  const t = new Date(); const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((today.getTime() - dayOf(v).getTime()) / 86400000);
}
const shortDate = (v: string) => dayOf(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function profitAt(row: ShopifyCardRow, price: number): number | null {
  const l = row.card?.profit_line;
  return l && Number.isFinite(price) ? r2(l.per_pound * price + l.at_zero) : null;
}
// What a size sells at if the style is set to `box`: its own size price while that stays below the box, else the box.
const sellsAt = (s: ShopifyCardSize, box: number) => (s.own_price !== null && s.own_price < box ? s.own_price : box);
type Side = 'under' | 'level' | 'over';
function sideOf(ours: number, benchmark: number): Side {
  if (ours < benchmark * (1 - LEVEL_BAND)) return 'under';
  if (ours > benchmark * (1 + LEVEL_BAND)) return 'over';
  return 'level';
}

type Done =
  | { kind: 'set'; price: number; pushed: boolean; message: string | null; ended: SizePriceEnded[]; warnings: string[] }
  | { kind: 'left' };

export default function ShopifyPriceCards() {
  const { logout } = useAuth();
  const router = useRouter();
  const all = useUrlParam('pending') === '1';    // the list's Due switch OFF: every style, walked
  const at = useUrlParam('at');                  // the card to open on (the style drill's Back)
  const stepRaw = useUrlParam('step');
  const step: LadderStepKey | null = stepRaw && stepRaw in STEP_TITLE ? (stepRaw as LadderStepKey) : null;
  const fromRaw = useUrlParam('from');
  const from = fromRaw && fromRaw.startsWith('/') && !fromRaw.startsWith('//') ? fromRaw : null;
  const backHref = from ?? `/pricing/all?by=all${all ? '&pending=1' : ''}`;
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const selfPath = `/pricing/cards?${step ? `step=${step}&` : ''}${all ? 'pending=1&' : ''}${from ? `from=${encodeURIComponent(from)}&` : ''}`;

  const { data: raw, error: loadError, busy: isLoading, refresh } = useApiQuery(hydrated ? ['shopify-price-cards', step ?? ''] : null,
    () => getShopifyCards(step ?? undefined),
    { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnMount: true, revalidateOnReconnect: false });
  const data = isLoading ? undefined : raw;   // fresh on every open — never price from an old copy (as the Amazon cards)

  // The list's rows in the list's order; Due on = the due ones only.
  const cards = useMemo(() => (data?.rows ?? []).filter((r) => all || !r.parked), [data, all]);

  const [done, setDone] = useState<Map<string, Done>>(() => new Map());
  const [cur, setCur] = useState<string | null>(null);
  const [review, setReview] = useState<number>(DEFAULT_REVIEW);
  const [busy, setBusy] = useState(false);
  const [showSizes, setShowSizes] = useState(false);   // the size list stays open from card to card once opened
  const [msg, setMsg] = useState<string | null>(null);

  const open = cards.filter((c) => !done.has(c.groupid));
  const want = cur ?? at;
  const current = want === END ? null : cards.find((c) => c.groupid === want) ?? (all ? cards[0] : open[0]) ?? null;
  const index = current ? cards.indexOf(current) : -1;

  // SEASON doesn't carry to the next card (header) — React's reset-on-change pattern, during render.
  const [reviewFor, setReviewFor] = useState<string | null>(current?.groupid ?? null);
  if ((current?.groupid ?? null) !== reviewFor) { setReviewFor(current?.groupid ?? null); if (review === SEASON.days) setReview(DEFAULT_REVIEW); }

  function nextAfter(groupid: string, doneNow: Map<string, Done>): string | null {
    const i = cards.findIndex((c) => c.groupid === groupid);
    if (all) return cards[i + 1]?.groupid ?? END;
    const order = [...cards.slice(i + 1), ...cards.slice(0, i)];
    return order.find((c) => !doneNow.has(c.groupid))?.groupid ?? null;
  }

  async function setPrice(row: ShopifyCardRow, price: number) {
    if (busy) return;
    setBusy(true); setMsg(null);
    const res = await applyPrice(row.groupid, price, review, NOTE);
    setBusy(false);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success || !res.data) { setMsg(`${row.groupid}: ${res.error || 'could not set the price'}`); return; }
    const shop = res.data.shopify;
    const nextDone = new Map(done).set(row.groupid, {
      kind: 'set', price, pushed: !shop || shop.pushed, message: shop && !shop.pushed ? shop.message || shop.error || null : null,
      ended: res.data.size_prices_ended, warnings: res.data.warnings,
    });
    setDone(nextDone);
    setCur(nextAfter(row.groupid, nextDone));
  }

  async function leave(row: ShopifyCardRow) {
    const nextDone = new Map(done).set(row.groupid, { kind: 'left' });
    setDone(nextDone);
    setCur(nextAfter(row.groupid, nextDone));
    const res = await parkStyle(row.groupid, review);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success) {
      setDone((p) => { const n = new Map(p); if (n.get(row.groupid)?.kind === 'left') n.delete(row.groupid); return n; });
      setMsg(`Leave ${row.groupid}: ${res.error || 'not saved'} — the card is back`);
    }
  }

  function previous() {
    if (current && index > 0) setCur(cards[index - 1].groupid);
    else if (!current && cards.length) setCur(cards[cards.length - 1].groupid);
  }

  async function reload() {
    setDone(new Map()); setCur(null); setMsg(null);
    await refresh();
  }

  const setCount = cards.filter((c) => done.get(c.groupid)?.kind === 'set').length;
  const leftCount = cards.filter((c) => done.get(c.groupid)?.kind === 'left').length;

  return (
    <AppShell crumb={<span className="font-medium text-slate-800">Shopify price cards</span>}>
      <div className="mx-auto flex max-w-[55rem] flex-col gap-2.5">
        {/* TOOLBAR — Back · what these cards are · progress · Refresh. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={backHref} title="Back to the Shopify pricing list"
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            ← Back
          </Link>
          {step ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{STEP_TITLE[step]} styles</span>
              {/* ALL | DUE (header) — flips ?pending=1; the cards start again from the first of the new set. */}
              <span className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
                {([['all', true], ['due', false]] as const).map(([label, wantAll]) => {
                  const on = all === wantAll;
                  const count = data ? (wantAll ? data.rows.length : data.rows.filter((r) => !r.parked).length) : null;
                  return (
                    <button key={label} type="button" disabled={on}
                      onClick={() => { setCur(null); router.replace(`/pricing/cards?step=${step}&${wantAll ? 'pending=1&' : ''}${from ? `from=${encodeURIComponent(from)}` : ''}`, { scroll: false }); }}
                      className={'h-7 rounded px-2.5 text-sm font-medium ' + (on ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-50')}>
                      {label === 'all' ? 'All' : 'Due'}{count !== null && <span className="ml-1 tabular-nums">{count}</span>}
                    </button>
                  );
                })}
              </span>
            </span>
          ) : (
            <span className="text-sm font-semibold text-slate-900">{all ? 'Every style on the list' : 'Due styles'}</span>
          )}
          {/* GOOGLE FRESHNESS — hidden while the nightly read is current (owner, 2026-11-15: "hide it unless stale"); amber once the
              last read is BENCHMARK_STALE_DAYS old, as the Google Ads screen's freshness line. */}
          {data?.benchmarkDay && daysSince(data.benchmarkDay) >= BENCHMARK_STALE_DAYS && (
            <span className="text-sm text-amber-700">Google prices from {shortDate(data.benchmarkDay)} — the nightly read has stopped</span>
          )}
          <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-sm text-slate-500">
            {cards.length > 0 && (
              <span className="tabular-nums">{all ? `${cards.length} styles · ${setCount} set · ${leftCount} left` : `${setCount} set · ${leftCount} left · ${open.length} to go`}</span>
            )}
            <button type="button" onClick={reload} aria-label="Refresh" title="Reload the styles"
              className="inline-grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
              <ArrowPathIcon className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>

        {/* PROGRESS — a dot per card: hollow to do, green set, grey left, ringed current. Click to jump. */}
        {cards.length > 0 && (
          <div className="flex min-h-6 flex-wrap items-center gap-1.5">
            {cards.map((c) => {
              const d = done.get(c.groupid);
              const on = current?.groupid === c.groupid;
              return (
                <button key={c.groupid} type="button" onClick={() => setCur(c.groupid)} title={`${c.groupid}${d ? (d.kind === 'set' ? ` — set ${money(d.price)}` : ' — left') : ''}`}
                  className={'h-2.5 w-2.5 rounded-full ' + (d?.kind === 'set' ? 'bg-emerald-500' : d?.kind === 'left' ? 'bg-slate-300' : 'border border-slate-400 bg-white')
                    + (on ? ' ring-2 ring-slate-900 ring-offset-1' : '')} />
              );
            })}
          </div>
        )}

        {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
        {loadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}
        {data?.truncated && <p className="text-sm text-amber-700">Showing the first {data.rows.length} of {data.total} styles.</p>}

        {data && (current ? (
          <Card key={current.groupid} row={current} all={all} reason={step ? shopifyStepReason(step, {
            onStep: current.step_skus?.length ?? 0, held: current.step_held ?? 0,
            heldIdle: current.step_idle_days ?? null, styleLastSale: current.style_last_sale_days ?? null }) : null} n={index + 1} of={cards.length} busy={busy} done={done.get(current.groupid) ?? null}
            review={review} onReview={setReview} showSizes={showSizes} onShowSizes={setShowSizes}
            onSet={(p) => setPrice(current, p)} onLeave={() => leave(current)} onPrev={previous}
            onNext={() => setCur(nextAfter(current.groupid, done))}
            drillHref={`/pricing/style/${encodeURIComponent(current.groupid)}?from=${encodeURIComponent(`${selfPath}at=${encodeURIComponent(current.groupid)}`)}`} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <div className="text-lg font-medium text-slate-900">
              {all ? (cards.length ? 'End of the list' : 'No styles on the list') : cards.length ? 'All done — Due is clear' : 'Nothing due'}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {cards.length ? `${setCount} set · ${leftCount} left. ` : ''}
              {!all ? 'A style comes back when its review date comes round.' : ''}
            </p>
            {all && cards.length > 0 && (
              <button type="button" onClick={() => setCur(cards[0].groupid)} className="mt-3 text-sm text-brand-700 hover:underline">Start again from the first card</button>
            )}
          </div>
        ))}

        {/* Errors only, one quiet line in a fixed slot; the card's own note says what was saved. */}
        <div className="flex h-6 min-w-0 items-center whitespace-nowrap text-sm" title={msg ?? undefined}>
          {msg && <span className="min-w-0 truncate text-red-600">{msg}</span>}
        </div>
      </div>
    </AppShell>
  );
}

function Card({ row, all, reason, n, of, busy, done, review, onReview, showSizes, onShowSizes, onSet, onLeave, onPrev, onNext, drillHref }: {
  row: ShopifyCardRow; all: boolean; reason: string | null; n: number; of: number; busy: boolean; done: Done | null;
  review: number; onReview: (d: number) => void; showSizes: boolean; onShowSizes: (v: boolean) => void;
  onSet: (price: number) => void; onLeave: () => void; onPrev: () => void; onNext: () => void; drillHref: string;
}) {
  const now = row.price;
  const card = row.card;
  const [priceStr, setPriceStr] = useState(done?.kind === 'set' ? done.price.toFixed(2) : now !== null ? now.toFixed(2) : '');
  const price = Number.parseFloat(priceStr);
  const valid = Number.isFinite(price) && price > 0;
  const changed = valid && (now === null || Math.round(price * 100) !== Math.round(now * 100));
  const box = valid ? price : now ?? 0;
  const lookOnly = all && row.parked;   // walking all: a not-due style is only looked at (header)
  const forward = () => (done || lookOnly ? onNext() : onLeave());

  const sizes = card?.sizes ?? [];
  const benched = sizes.filter((s) => s.benchmark !== null);
  const bms = benched.map((s) => s.benchmark as number);
  const sides = benched.map((s) => sideOf(sellsAt(s, box), s.benchmark as number));
  const count = (k: Side) => sides.filter((x) => x === k).length;
  const ownPrices = sizes.filter((s) => s.own_price !== null);
  const ending = valid ? ownPrices.filter((s) => price <= (s.own_price as number) + 0.005) : [];
  const amz = card?.amazon_highest ?? null;

  const reviewChips = [...REVIEW_PERIODS.map((d) => ({ days: d, label: `${d}d`, title: `Review in ${d} days` })),
    { days: SEASON.days, label: SEASON.label, title: SEASON.title }];
  const pill = 'inline-flex h-9 min-w-[3.25rem] items-center justify-center rounded-md border px-2 text-sm font-medium tabular-nums';
  const status = all
    ? (row.parked
      ? <span className="text-slate-600">Not due — next review {row.next_review ? dateLabel(row.next_review) : ''}</span>
      : <span className="text-slate-900">{row.next_review ? `Due — review date was ${dateLabel(row.next_review)}` : 'Due — no review date yet'}</span>)
    : undefined;

  const links: { href: string; label: string; title: string; external?: boolean }[] = [
    { href: drillHref, label: 'Style drill →', title: 'The full Shopify price screen for this style — its Back returns to this card' }];
  if (card?.handle) links.push({ href: STORE_PRODUCT_BASE + card.handle, label: 'Shopify ↗', title: 'The product on the shop', external: true });

  return (
    <ShopifyCardFrame
      groupid={row.groupid} title={row.title} brand={row.brand} imagename={card?.imagename ?? null}
      counter={`${n} of ${of}`} links={links} status={status}
      reason={reason ? <span className="text-slate-700">{reason}</span> : undefined}
      priceStr={priceStr} setPriceStr={setPriceStr}
      now={now} profitAt={(p) => profitAt(row, p)} rrp={row.rrp}
      market={<>
        {/* GOOGLE — the spread, and where our sizes sit at the box price; the size list opens under it. */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="w-16 shrink-0 text-slate-500">Google</span>
          {benched.length ? (
            <span>
              others charge <b className="tabular-nums text-slate-900">{money(Math.min(...bms))}{bms.length > 1 && Math.min(...bms) !== Math.max(...bms) ? ` – ${money(Math.max(...bms))}` : ''}</b>
              <span className="text-slate-500"> ({benched.length} of {sizes.length} sizes)</span>
              <span className="text-slate-500"> · at {money(box)} we&apos;re under on {count('under')} · level on {count('level')} · over on {count('over')}</span>
            </span>
          ) : <span className="text-slate-500">no benchmark for this style</span>}
          {sizes.length > 0 && (
            <button type="button" onClick={() => onShowSizes(!showSizes)} className="text-brand-700 hover:underline">{showSizes ? 'hide sizes' : 'sizes'}</button>
          )}
        </div>
        {showSizes && sizes.length > 0 && (
          <table className="ml-[4.5rem] text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-0.5 pr-4 font-normal">Size</th>
                <th className="py-0.5 pr-4 font-normal">Stock</th>
                <th className="py-0.5 pr-4 text-right font-normal">Ours</th>
                <th className="py-0.5 pr-4 text-right font-normal">Google</th>
                <th className="py-0.5 font-normal" />
              </tr>
            </thead>
            <tbody>
              {sizes.map((s) => {
                const ours = sellsAt(s, box);
                const side = s.benchmark !== null ? sideOf(ours, s.benchmark) : null;
                return (
                  <tr key={s.code} className={s.stock + s.fba > 0 ? 'text-slate-700' : 'text-slate-400'}>
                    <td className="py-px pr-4 tabular-nums">{s.size}</td>
                    <td className="py-px pr-4 tabular-nums">{s.stock}{s.fba > 0 ? <span className="text-slate-400"> +{s.fba} FBA</span> : ''}</td>
                    <td className="py-px pr-4 text-right tabular-nums">{money(ours)}{ours !== box && <span className="text-slate-400"> size price</span>}</td>
                    <td className="py-px pr-4 text-right tabular-nums">{s.benchmark !== null ? money(s.benchmark) : '—'}</td>
                    <td className="py-px text-slate-500">{side ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {/* AMAZON — the dearest live size, shown, never obeyed. */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="w-16 shrink-0 text-slate-500">Amazon</span>
          {amz !== null
            ? <span>dearest live size <b className="tabular-nums text-slate-900">{money(amz)}</b>{valid && price < amz - 0.005 && <span className="text-amber-700"> · under it</span>}</span>
            : <span className="text-slate-500">no size live</span>}
        </div>
        {/* SIZE PRICES — always shown when there is one (decision 4). */}
        {ownPrices.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="w-16 shrink-0 text-slate-500">Size price</span>
            <span>{ownPrices.map((s) => `${s.size} at ${money(s.own_price)} (${s.stock + s.fba} in stock)`).join(' · ')}</span>
          </div>
        )}
      </>}
      facts={<>
        <div>Stock {row.stock} · sold {row.u30} in 30 days</div>
        <LastChangeLine change={card?.last_change} />
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
        label: valid && !changed ? `Already ${money(price)}` : `Set ${valid ? money(price) : ''}`,
        onClick: () => { if (valid && changed && !busy && done?.kind !== 'set') onSet(price); },
        disabled: busy || !changed || done?.kind === 'set',
        title: changed ? 'Save, send to Shopify and set the review date (Enter)' : 'Already the price — Leave keeps it',
      }}
      note={done?.kind === 'set' ? (
        <span className={'truncate ' + (done.pushed ? 'text-emerald-700' : 'text-amber-700')}>
          Set to {money(done.price)} — {done.pushed ? 'on Shopify' : `saved, Shopify NOT updated${done.message ? `: ${done.message}` : ''}`}
          {done.ended.length > 0 && <span className="text-slate-500"> · size price ended: {done.ended.map((e) => e.size).join(', ')}</span>}
          {done.warnings.length > 0 && <span className="text-amber-700"> · {done.warnings.join(' · ')}</span>}
        </span>
      ) : done?.kind === 'left' ? (
        <span className="text-slate-500">Left at {money(now)}</span>
      ) : ending.length > 0 ? (
        // Decision 4: a small, quiet note — not red, not a confirm. Set still works.
        <span className="text-slate-500">at this price the size {ending.map((s) => s.size).join(', ')} price ends</span>
      ) : null}
    />
  );
}
