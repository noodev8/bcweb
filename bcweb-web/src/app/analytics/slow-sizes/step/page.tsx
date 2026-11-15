'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes/step?key=<list>[&when=week|later|all]  (A STOCK LADDER LIST — opened from a step box on Range)
=======================================================================================================================================
Purpose: The drill-down from Range's front screen (owner, 2026-11-15; design docs/stock-ladder.md → "Drill-down from each box"). Each
         step box, and the Overstocked tag, opens its own list here (lib/stockLadder → LIST_TEXT):
           arrived · sold        a list only, with a link to Amazon Pricing — the Buy Box already prices these sizes (New / Raise / Cut)
                                 and a second door to the same sizes was rejected on 13 Nov.
           overstocked · unsold90 · unsold180
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
import { getLadderList, type LadderListKey, type LadderListRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { CARD_LISTS, CHIPS, LIST_TEXT, inChip, isChip, isLadderList, stepListHref, type LadderChip } from '@/lib/stockLadder';

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
  const key: LadderListKey | null = isLadderList(keyParam) ? keyParam : null;
  const chip: LadderChip = isChip(whenParam) ? whenParam : 'due';
  const carded = key !== null && CARD_LISTS.includes(key);

  const q = useApiQuery(key ? ['ladder-list', key] : null, () => getLadderList(key as LadderListKey));
  const rows = q.data?.rows ?? [];
  const shown = rows.filter((r) => inChip(r.when, chip));
  const cardable = shown.filter((r) => r.when !== 'buybox');
  const count = (c: LadderChip) => rows.filter((r) => inChip(r.when, c)).length;
  const selfHref = key ? stepListHref(key, chip) : '/analytics/slow-sizes';
  const cardsHref = (at?: string) => `/amz/step-cards?step=${key}&when=${chip}${at ? `&at=${encodeURIComponent(at)}` : ''}`;
  const priceScreenHref = (code: string) => `/amz/sku/${encodeURIComponent(code)}?from=${encodeURIComponent(selfHref)}`;
  const rowHref = (r: LadderListRow) => (carded && r.when !== 'buybox' ? cardsHref(r.code) : priceScreenHref(r.code));
  const t = key ? LIST_TEXT[key] : null;

  return (
    <AppShell backHref="/analytics/slow-sizes" backLabel="Range"
      crumb={<span className="font-medium text-slate-800">{t ? t.name : 'Range list'}</span>}>
      {keyParam !== null && !key && <p className="text-sm text-slate-500">Unknown list — go back to <Link href="/analytics/slow-sizes" className="text-brand-700 hover:underline">Range</Link>.</p>}
      {t && key && (
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
