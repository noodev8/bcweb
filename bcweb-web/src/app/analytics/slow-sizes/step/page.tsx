'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes/step?key=<list>[&when=week|later|all]  (A STOCK LADDER LIST — opened from a step box on Range)
=======================================================================================================================================
Purpose: The drill-down from Range's front screen (owner, 2026-11-15; design docs/stock-ladder.md → "Drill-down from each box"). Each
         step box, and the Overstocked tag, opens its own list here (lib/stockLadder → LIST_TEXT):
           arrived               NO LIST — a choice of two doors (owner, 2026-11-15: the list "doesn't mean much"; the aim on this step
                                 is the FIRST SALE): Amazon's NEW cards (the Buy Box deck's New tab, as it is — same door, not a
                                 second one) or the SHOPIFY PRICE CARDS narrowed to the styles holding an Arrived SKU (?step=arrived,
                                 any brand), opened walking all of them: nearly every Shopify style carries a review date, so Due alone
                                 would show next to nothing (that day 35 styles, 0 due). Each door shows its count.
           sold                  a list only, with a link to Amazon Pricing — the Buy Box already prices these sizes (New / Raise / Cut)
                                 and a second door to the same sizes was rejected on 13 Nov.
           unsold90              A CHOICE too (owner, 2026-11-15, option A): Amazon = the step's PRICE CARDS on Due (/amz/step-cards,
                                 All | Due switch there; owner: "I was expecting amazon to be price cards too, rather than the list" —
                                 the list stays at &side=amazon, a quiet link under the doors and the cards' fallback Back) | Shopify = the price cards for the styles with EVERY held size on step 3 or later (server
                                 pricing-all-list → step; a style still selling a size is never cut — size prices on the card are
                                 still to build), opened on DUE (most are season-parked; that day 46 styles, 2 due), All a switch away.
           unsold180             THE SAME CHOICE as Unsold 90 (owner, 2026-11-15: "Next is Unsold 180"). A style is carded on Shopify on
                                 ONE stuck step only, the step of its freshest size (server pricing-all-list → step). That day 39 SKUs
                                 = 6 on Amazon cards + 9 on Shopify cards (6 styles, 0 due) + 24 in styles with a fresher size.
           overstocked (and the Unsold 90 / 180 Amazon side)
                                 list first, then PRICE THESE (n) opens the Amazon price cards (/amz/step-cards) for what the list
                                 is showing.
           clearance             NOT HERE since 2026-11-15: Range's step 5 box opens the Clearance screen (../clearance — every SKU,
                                 Shopify | Amazon | eBay side by side; lib/stockLadder → stepListHref). ?key=clearance still renders.

WHO IS ON IT (owner: "leave Birkenstock and Shopify out of these decisions for now"): the step's SKUs live at Amazon, Birkenstock left
         out — server utils/stockLadderList.js, THE copy. The line under the title says how many of the step's SKUs that is.

CHIPS, not a summary screen (owner, 2026-11-15): Due · Within a week · Later · All, each with its count; the list opens on Due (owner:
         look, "click on a section (within 7 days) and price up anyway, or see the whole lot or just leave it"). Due = THE one Amazon
         rule (server utils/amzDue.js) — unchanged; pricing early from Within a week / Later sets a new review date as normal. Buy Box
         sizes show under All only, marked "Buy Box", and never get a step card. ?when= in the URL, written by the chip's handler.

ROWS: one per size, styles together (the server's order: longest wait first; Overstocked most pairs over first). A card list's row
         opens the step cards on that size; a Buy Box row, and every row of Arrived / Sold 90, opens the full Amazon price screen.
         Stock = local + at Amazon, one number (the ladder's), with "n at Amazon" beside it.

READ ONLY — the cards do the writing.
=======================================================================================================================================
*/

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { money } from '@/components/AmzCardFrame';
import { getAllList, getAmzBuyBoxDeck, getLadderList, getStockLadder, type LadderListKey, type LadderListRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { CARD_LISTS, CHIPS, CHOICE_STEPS, LIST_TEXT, inChip, isChip, isLadderList, stepChoiceHref, stepListHref, type LadderChip } from '@/lib/stockLadder';

const n = (v: number) => v.toLocaleString('en-GB');
// '12 Nov 2026' from YYYY-MM-DD (a calendar day, read as one — never through toISOString).
function dateLabel(v: string) {
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function LadderListPage() {
  const router = useRouter();
  const keyParam = useUrlParam('key');
  const whenParam = useUrlParam('when');
  const sideParam = useUrlParam('side');
  const key: LadderListKey | null = isLadderList(keyParam) ? keyParam : null;
  const chip: LadderChip = isChip(whenParam) ? whenParam : 'due';
  const carded = key !== null && CARD_LISTS.includes(key);
  // A CHOICE step opens its two doors; Unsold 90's Amazon door is the list (&side=amazon). Arrived has no list.
  const choice = key !== null && CHOICE_STEPS.includes(key) && (key === 'arrived' || sideParam !== 'amazon');

  // Arrived too: the choice's tally counts its Amazon sizes.
  const q = useApiQuery(key ? ['ladder-list', key] : null, () => getLadderList(key as LadderListKey));
  const rows = q.data?.rows ?? [];
  const shown = rows.filter((r) => inChip(r.when, chip));
  const cardable = shown;   // every row, Buy Box sizes included (owner 2026-11-17: "I want to price in cards")
  const count = (c: LadderChip) => rows.filter((r) => inChip(r.when, c)).length;
  const selfHref = key ? stepListHref(key, chip) : '/analytics/slow-sizes';
  const cardsHref = (at?: string) => `/amz/step-cards?step=${key}&when=${chip}${at ? `&at=${encodeURIComponent(at)}` : ''}`;
  const priceScreenHref = (code: string) => `/amz/sku/${encodeURIComponent(code)}?from=${encodeURIComponent(selfHref)}`;
  const rowHref = (r: LadderListRow) => (carded ? cardsHref(r.code) : priceScreenHref(r.code));
  const t = key ? LIST_TEXT[key] : null;

  return (
    <AppShell backHref={key && !choice && CHOICE_STEPS.includes(key) ? stepChoiceHref(key) : '/analytics/slow-sizes'}
      backLabel={key && !choice && CHOICE_STEPS.includes(key) ? LIST_TEXT[key].name : 'Range'}
      crumb={<span className="font-medium text-slate-800">{t ? t.name : 'Range list'}</span>}>
      {keyParam !== null && !key && <p className="text-sm text-slate-500">Unknown list — go back to <Link href="/analytics/slow-sizes" className="text-brand-700 hover:underline">Range</Link>.</p>}
      {key && choice && <StepChoice step={key} amzRows={rows} amzLoaded={!!q.data} />}
      {t && key && !choice && (
        <div className="flex flex-col gap-3">
          {/* TITLE — the step and who is on the list. */}
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t.name} <span className="text-sm font-normal text-slate-500">{t.rule}</span></h1>
            {q.data && (
              <p className="mt-0.5 text-sm text-slate-600">
                {n(rows.length)} of {n(q.data.stepSkus)} SKUs on this step — the ones live at Amazon. Birkenstock and shop-only stock are left out for now.
              </p>
            )}
          </div>

          {/* CHIPS + the action — Price these (card lists) or the way to Amazon Pricing (Arrived, Sold 90). */}
          <div className="flex flex-wrap items-center gap-2">
            {CHIPS.map((c) => (
              <button key={c.key} type="button" onClick={() => router.replace(stepListHref(key, c.key), { scroll: false })}
                className={'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium '
                  + (chip === c.key ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
                {c.label} <span className="tabular-nums">{q.data ? n(count(c.key)) : '–'}</span>
              </button>
            ))}
            <span className="ml-auto">
              {carded ? (
                cardable.length > 0 ? (
                  <Link href={cardsHref()}
                    className="inline-flex h-9 items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
                    Price these ({n(cardable.length)})
                  </Link>
                ) : (
                  <span className="text-sm text-slate-400">Nothing to price here</span>
                )
              ) : (
                <Link href="/amz" className="text-sm font-medium text-brand-700 hover:underline" title="The Buy Box prices these sizes — its cards are on Amazon Pricing">
                  Amazon Pricing →
                </Link>
              )}
            </span>
          </div>

          {q.error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
          {!q.data && !q.error && <p className="text-sm text-slate-400">Loading…</p>}
          {q.data && shown.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">
              {chip === 'due' ? 'Nothing due on this step.' : 'Nothing here.'}
            </div>
          )}

          {shown.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Brand</th>
                    <th className="px-3 py-2 text-right" title="Days since the last sale on any channel (or since it arrived, if it never sold)">Days without a sale</th>
                    <th className="px-3 py-2 text-right" title="Local + at Amazon, one number">In stock</th>
                    {key === 'overstocked' && <th className="px-3 py-2 text-right" title="Pairs beyond 4 months' worth at its 12-month pace">Over</th>}
                    <th className="px-3 py-2 text-right">Amazon price</th>
                    <th className="px-3 py-2">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => {
                    const newStyle = i > 0 && shown[i - 1].groupid !== r.groupid;
                    return (
                        <tr key={r.code} onClick={() => router.push(rowHref(r))}
                          className={'cursor-pointer hover:bg-slate-50 ' + (newStyle ? 'border-t border-slate-200' : '')}>
                          <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-900">
                            <Link href={rowHref(r)} onClick={(e) => e.stopPropagation()} className="hover:underline">{r.code}</Link>
                          </td>
                          <td className="max-w-[22rem] truncate px-3 py-1.5 text-slate-700" title={r.title ?? undefined}>{r.title ?? '—'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.brand ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{n(r.ladder_idle_days)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-900">
                            {n(r.ladder_units)} <span className="text-xs text-slate-400">· {n(r.fba)} at Amazon</span>
                          </td>
                          {key === 'overstocked' && <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{n(r.ladder_over)}</td>}
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{money(r.price)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5">
                            {r.when === 'due' ? <span className="font-medium text-slate-900">Due</span>
                              : r.when === 'buybox' ? <span className="text-emerald-700">Buy Box{r.bb_card ? ' · card' : ''}</span>
                                : <span className="text-slate-600">{r.next_review ? dateLabel(r.next_review) : '—'}</span>}
                          </td>
                        </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

// THE CHOICE — two doors, Amazon | Shopify (header). Per step: what the Amazon door is, and which way the Shopify cards open.
//   arrived   Amazon = the Buy Box deck's New tab (its ready cards); Shopify opens on All (that day every Arrived style was parked).
//   unsold90  Amazon = the step cards on Due (counts from the step list's rows: due, and every cardable size); Shopify opens on Due (season parks hold) — the cards' All | Due switch flips it.
const CHOICE_TEXT: Partial<Record<LadderListKey, { lead: string; shopAll: boolean; neither: string }>> = {
  // `neither` names the third part by what it is waiting for (owner, 2026-11-15: "on neither" was "confusing … I had to read it 3
  // times"; "wait for Shopify size prices" was worse). Say the plain fact: on Unsold 90, the sizes whose style still sells others.
  arrived: { lead: 'waiting for their first sale', shopAll: true, neither: 'not on Shopify' },
  unsold90: { lead: 'with no sale for 91 to 180 days', shopAll: false, neither: 'in styles still selling other sizes' },
  // Unsold 180 (2026-11-15): a style is carded on the step of its FRESHEST size, so here "neither" also holds styles with an Unsold 90
  // size (carded there) — said plainly as a size that sold more recently.
  unsold180: { lead: 'with no sale for 181 days to 9 months', shopAll: false, neither: 'in styles with a size that sold more recently' },
  // Overstocked (docs/overstock/PLAN.md decision 7): selling sizes holding too much — the Shopify door is the OVERSTOCK cards (a size
  // price per overstocked size beside the style price); "neither" = styles not on the Shopify list (not live there, or no shop stock).
  overstocked: { lead: "selling, but holding more than 4 months' worth", shopAll: false, neither: 'not on the Shopify list' },
};
// THE TALLY (owner, 2026-11-15: "fine as long as we see numbers on the screen that add up"): the step's SKUs split three ways, so the
// line under the doors sums to the step's total — at Amazon (live at FBA, Birkenstock left out: the step list's rows) + Shopify only
// (in a style on the Shopify cards, not at Amazon — server pricing-all-list → step_skus) + on neither (the rest: why, per step). A
// SKU at Amazon whose style is on the Shopify cards counts once, under Amazon. The doors stay short (owner: "a little too full of
// text"): what they open on, big, and one line under it.
function StepChoice({ step, amzRows, amzLoaded }: { step: LadderListKey; amzRows: LadderListRow[]; amzLoaded: boolean }) {
  const text = CHOICE_TEXT[step];
  const ladder = useApiQuery('analytics-stock-ladder', () => getStockLadder());
  const deck = useApiQuery(step === 'arrived' ? ['amz-buybox-deck'] : null, () => getAmzBuyBoxDeck());
  const shop = useApiQuery(['pricing-all-list', step], () => getAllList(step));
  if (!text) return null;
  const self = stepChoiceHref(step);
  // The SKUs this choice is about: a step's box, or (Overstocked, a label on steps 1–2) the ladder's overstocked count.
  const onStep = step === 'overstocked'
    ? (ladder.data ? { skus: ladder.data.overstocked.skus } : undefined)
    : ladder.data?.steps.find((s) => s.key === step);
  const shopDue = shop.data ? shop.data.rows.filter((r) => !r.parked).length : null;
  const amzDue = amzRows.filter((r) => r.when === 'due').length;
  const amzCardable = amzRows.length;   // Buy Box sizes are step-carded too (owner 2026-11-17)
  // The tally (above): only once all three reads are in.
  const amzCodes = new Set(amzRows.map((r) => r.code));
  const shopOnly = shop.data ? shop.data.rows.flatMap((r) => r.step_skus ?? []).filter((c) => !amzCodes.has(c)).length : null;
  const tally = onStep && amzLoaded && shopOnly !== null
    ? { total: onStep.skus, amz: amzCodes.size, shop: shopOnly, neither: onStep.skus - amzCodes.size - shopOnly } : null;
  const door = 'flex flex-1 flex-col rounded-xl border-2 border-slate-300 bg-white px-5 py-5 transition hover:border-slate-400 hover:bg-slate-50';
  const big = 'mt-2 text-3xl font-semibold tabular-nums text-slate-900';
  const unit = 'text-base font-normal text-slate-500';
  const small = 'mt-1 text-sm text-slate-600';
  const fig = (v: number) => <span className="font-semibold tabular-nums text-slate-900">{n(v)}</span>;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{LIST_TEXT[step].name} <span className="text-sm font-normal text-slate-500">{LIST_TEXT[step].rule}</span></h1>
        <p className="mt-0.5 text-sm text-slate-600">
          {onStep ? <>{fig(onStep.skus)} SKUs {text.lead}.</> : 'Loading…'}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        {step === 'arrived' ? (
          <Link href="/amz/buybox/deck?g=new" className={door}>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Amazon</span>
            <span className="mt-0.5 text-lg font-semibold text-slate-900">New cards</span>
            <span className={big}>{deck.data ? n(deck.data.counts.new ?? 0) : '–'} <span className={unit}>ready</span></span>
            <span className={small}>Landed in the last 30 days</span>
          </Link>
        ) : (
          <Link href={`/amz/step-cards?step=${step}&when=due&from=${encodeURIComponent(self)}&back=${encodeURIComponent(LIST_TEXT[step].name)}`} className={door}>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Amazon</span>
            <span className="mt-0.5 text-lg font-semibold text-slate-900">Price cards</span>
            <span className={big}>{amzLoaded ? n(amzDue) : '–'} <span className={unit}>due</span></span>
            <span className={small}>{amzLoaded ? `of ${n(amzCardable)} sizes` : ''}</span>
          </Link>
        )}
        <Link href={`/pricing/cards?step=${step}&${text.shopAll ? 'pending=1&' : ''}from=${encodeURIComponent(self)}`} className={door}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Shopify</span>
          <span className="mt-0.5 text-lg font-semibold text-slate-900">Price cards</span>
          <span className={big}>
            {text.shopAll
              ? <>{shop.data ? n(shop.data.total) : '–'} <span className={unit}>styles</span></>
              : <>{shopDue !== null ? n(shopDue) : '–'} <span className={unit}>due</span></>}
          </span>
          <span className={small}>
            {shop.data ? (text.shopAll ? `${n(shopDue ?? 0)} due` : `of ${n(shop.data.total)} styles`) : ''}
          </span>
        </Link>
      </div>
      {/* THE TALLY — sums to the step's SKUs. */}
      {tally && (
        <p className="text-sm text-slate-600">
          {fig(tally.total)} SKUs = {fig(tally.amz)} on Amazon cards + {fig(tally.shop)} on Shopify cards + {fig(tally.neither)} {text.neither}
        </p>
      )}
      {step !== 'arrived' && (
        <Link href={stepListHref(step)} className="self-start text-sm text-slate-500 hover:text-slate-700 hover:underline">The Amazon sizes as a list →</Link>
      )}
      {(deck.error || shop.error) && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{(deck.error ?? shop.error)?.message}</div>
      )}
    </div>
  );
}
