'use client';
/*
=======================================================================================================================================
Page: /amz/fast  (Amazon Pricing — Fast sellers)
=======================================================================================================================================
Purpose: Every Amazon size that sold in the last 30 days (net of returns), with HOW FAST it sold — fastest first (owner, 2026-10-22).
         Two day counts from the server (routes/amz-fast-sellers.js → utils/sellSpeed.js, which owns the rules):
           Priced→sold   days from the price the last sale went at going live, to that sale
           Shipped→sold  days from the last FBA shipment carrying the size, to that sale (the archive keeps 60 days)
         The job is PRICING: a size that sells within days at a thin price can take more. The case that asked for it: Rieker
         X9165-00-38, priced to the Buy Box and sold at £1.91 a unit the same day, 4 days after shipping.

         Not ordering — Amazon Order's Simmer preset is the "order 1 to try it" view; this list shows every size that sold, whatever its
         margin or stock, and has no links to the order screens (CLAUDE.md: pricing stays apart from ordering).

THE LIST (owner's calls): no speed cutoff — sort and judge by eye; any margin, any stock; NO review cooldown — a size priced here stays
         on the list, and the Last priced column (any screen's change: when, who, and the note in its tooltip) says it has been done.
         Sizes with nothing to measure from sit after the measured ones on either count.

THE PRICE BOX (click a row): − / + move 10p, the box can be typed, Set writes it — POST /amz-apply (W-A1), into the team's upload basket
         like every Amazon pricing screen; nothing goes to Amazon until the file is uploaded. It starts from the queued price when there
         is one, so a second nudge builds on the first. No "£3 price" (owner, 2026-10-22): that is Simmer's bar for thin sizes about to
         be ordered; here the aim is as much as a fast seller will take, so RRP is shown as the ceiling instead. The note on the log row is "Fast sellers", so other screens can say where a change came from.

REVIEW (owner, 2026-10-22): a price set here reviews the size 7 days from the day it is set — UNLESS its review is already later, which
         is kept (the same shape as Shopify vs Amazon's 10-day rule). The box names which before Set. The review hides the size from the
         Amazon segment lists, not from this one.

SLIDER: a size in a Pricing Slider carries its badge, and the price box the warning — pricing it here takes it out at the next Move.

WHERE (owner, 2026-10-22): a tile in the dashboard's Pricing group, "for now — not through Amazon": no link on the /amz home, and no back
         link (the logo returns to the group, as for every dashboard tile). The route stays under /amz for the upload basket's provider.

UPDATE (owner, 2026-10-22): the list changes only when the Update button is pressed. SWR's own refetches (on coming back to the page,
         on reconnect) are switched off for this key, so the rows don't reshuffle under someone working down them; prices set here show
         at once from local state (setHere) and are read back from the server at the next Update. Opening the page fresh loads it.
=======================================================================================================================================
*/

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, MagnifyingGlassIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzBasketBar, { AmzUploadButton } from '@/components/AmzBasketBar';
import SliderBadge, { SliderWarning, useSliderMarks } from '@/components/SliderBadge';
import { getAmzFastSellers, applyAmzPrice, AmzFastRow, AmzFastLastPriced, SliderMark } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useAuth } from '@/contexts/AuthContext';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

const NOTE = 'Fast sellers';
const REVIEW_DAYS = 7;

// Today + n as YYYY-MM-DD in the browser's local (UK) calendar — compared as a string with the stored review date. Taken ONCE at module
// load, never during a render (react-hooks/purity — the same reason Amazon Order fixes its six-month cutoff at load): a day-grain
// boundary doesn't need a fresher clock than "when the page was opened".
function isoInDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const TODAY = isoInDays(0);
const REVIEW_ON = isoInDays(REVIEW_DAYS);

// The review to send with Set: null ("leave it") when the size's review is already later than ours; else the 7 days. See REVIEW above.
function reviewDaysFor(nextReview: string | null): number | null {
  return nextReview && nextReview > REVIEW_ON ? null : REVIEW_DAYS;
}

const NO_ROWS: AmzFastRow[] = [];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}
// 'YYYY-MM-DD' -> '6 Oct', read off the string (never through Date — a date-only string parses as UTC midnight).
function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}
function days(n: number | null): string {
  return n === null ? '—' : `${n}d`;
}

type SortKey = 'code' | 'units_30d' | 'last_sold' | 'priced_to_sold' | 'shipped_to_sold' | 'unit_profit' | 'price' | 'rrp' | 'fba_live' | 'last_priced';
interface Column { key: SortKey; label: string; title: string; align: 'left' | 'right'; asc: boolean }
// `asc` = the direction a first click sorts: the day counts fastest first, the figures biggest first, dates newest first.
const COLUMNS: Column[] = [
  { key: 'code', label: 'Size', title: 'Our SKU — hover for the product name', align: 'left', asc: true },
  { key: 'units_30d', label: 'Sold (30)', title: 'Units sold on Amazon, last 30 days, net of returns', align: 'right', asc: false },
  { key: 'last_sold', label: 'Last sold', title: 'Date of the last Amazon sale', align: 'right', asc: false },
  { key: 'priced_to_sold', label: 'Priced→sold', title: 'Days from the price the last sale went at going live (uploaded) to that sale', align: 'right', asc: true },
  { key: 'shipped_to_sold', label: 'Shipped→sold', title: 'Days from the last FBA shipment of this size to the last sale (shipments kept 60 days)', align: 'right', asc: true },
  { key: 'unit_profit', label: 'Unit profit', title: "Profit per unit on the last Amazon sale", align: 'right', asc: false },
  { key: 'price', label: 'Price', title: 'Live Amazon price — or the queued one, waiting for upload', align: 'right', asc: false },
  { key: 'rrp', label: 'RRP', title: "The style's RRP (skusummary.rrp) — the ceiling for a price rise", align: 'right', asc: false },
  { key: 'fba_live', label: 'FBA', title: 'Sellable FBA stock now (amzlive); hover for live + inbound', align: 'right', asc: false },
  { key: 'last_priced', label: 'Last priced', title: 'The newest price change from any screen — hover for its note', align: 'left', asc: false },
];

function sortValue(r: AmzFastRow, key: SortKey, queued: number | null, lastPriced: AmzFastLastPriced | null): string | number | null {
  switch (key) {
    case 'price': return queued ?? r.price;
    case 'last_priced': return lastPriced ? lastPriced.on : null;
    default: return r[key];
  }
}

export default function AmzFastSellersPage() {
  const { logout, displayName } = useAuth();
  const { add } = useAmzBasket();
  const sliderMarks = useSliderMarks();

  // Manual only — see UPDATE in the header. Cached data is shown as it is until refresh() runs.
  const { data, error: loadError, isLoading, busy, refresh } = useApiQuery(['amz-fast-sellers'], () => getAmzFastSellers(), {
    revalidateIfStale: false, revalidateOnReconnect: false,
  });
  const rows = data?.rows ?? NO_ROWS;
  // Unit profit at or under Simmer's £3 line reads amber — a thin fast seller is the likeliest to take a rise.
  const thinLine = data?.warm_min_unit_profit ?? 3;

  // Set this visit, by code — the price now queued and the Last priced line, so a row reads "done" at once without a reload (the
  // next load reads both back from the log). Review dates likewise, so a second Set judges the rule against the date just written.
  const [setHere, setSetHere] = useState<Record<string, { price: number; last: AmzFastLastPriced; nextReview: string | null }>>({});

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('priced_to_sold');
  const [asc, setAsc] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = terms.length === 0 ? rows : rows.filter((r) => {
      const hay = `${r.code} ${r.title || ''} ${r.brand || ''} ${r.groupid}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    // Nulls last whichever way round — a size with nothing to measure isn't the fastest or the slowest. Then the server's order
    // (its index) breaks ties, so an equal count keeps the default ranking.
    const index = new Map(rows.map((r, i) => [r.code, i]));
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sortKey, setHere[a.code]?.price ?? a.queued_price, setHere[a.code]?.last ?? a.last_priced);
      const vb = sortValue(b, sortKey, setHere[b.code]?.price ?? b.queued_price, setHere[b.code]?.last ?? b.last_priced);
      if (va === null && vb === null) return index.get(a.code)! - index.get(b.code)!;
      if (va === null) return 1;
      if (vb === null) return -1;
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return c !== 0 ? (asc ? c : -c) : index.get(a.code)! - index.get(b.code)!;
    });
  }, [rows, search, sortKey, asc, setHere]);

  // UPDATE — refetch, then drop this visit's local overlays: the fresh rows carry those prices, review dates and Last priced themselves.
  async function onUpdate() {
    await refresh();
    setSetHere({});
  }

  function onSort(col: Column) {
    if (col.key === sortKey) setAsc((v) => !v);
    else { setSortKey(col.key); setAsc(col.asc); }
  }

  async function onSetPrice(r: AmzFastRow, price: number): Promise<{ error: string | null; aboveRrp: boolean }> {
    const nextReview = setHere[r.code]?.nextReview ?? r.next_review;
    const res = await applyAmzPrice(r.code, price, NOTE, reviewDaysFor(nextReview));
    if (res.return_code === 'UNAUTHORIZED') { logout(); return { error: 'Session expired', aboveRrp: false }; }
    if (!res.success || !res.data) return { error: res.error || 'Couldn’t set the price', aboveRrp: false };
    const d = res.data;
    add({ id: d.log_id, code: d.code, amz_sku: d.amz_sku, size: r.size, title: r.title, segment: r.segment, old_price: d.old_price, new_price: d.new_price, rrp: d.rrp });
    setSetHere((prev) => ({
      ...prev,
      [r.code]: {
        price: d.new_price,
        last: { on: TODAY, by: displayName, note: NOTE, price: d.new_price, uploaded: false },
        nextReview: d.next_review ?? nextReview,
      },
    }));
    return { error: null, aboveRrp: d.warnings.includes('ABOVE_RRP') };
  }

  return (
    <AppShell title="Fast sellers" headerRight={<AmzUploadButton />} wide>
      <AmzBasketBar />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, brand or SKU"
            className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button
          type="button"
          onClick={onUpdate}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowPathIcon className={'h-4 w-4 ' + (busy ? 'animate-spin' : '')} />
          {busy ? 'Updating…' : 'Update'}
        </button>
        <p className="text-sm text-slate-500">
          Amazon sizes sold in the last 30 days{data ? ` — ${visible.length}${visible.length !== rows.length ? ` of ${rows.length}` : ''}` : ''}.
          Fastest first: days from the price going live, and from the last FBA shipment, to the last sale.
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {loadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}

      {data && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} title={c.title} className={`whitespace-nowrap px-2 py-1.5 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.key === 'code' ? 'pl-3' : ''}`}>
                    <button type="button" onClick={() => onSort(c)} className="inline-flex items-center gap-0.5 hover:text-slate-800">
                      {c.label}
                      {sortKey === c.key && (asc ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 && (
                <tr><td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-slate-400">Nothing matches.</td></tr>
              )}
              {visible.map((r) => {
                const here = setHere[r.code];
                const queued = here?.price ?? r.queued_price;
                const last = here?.last ?? r.last_priced;
                const mark = sliderMarks.amz(r.code);
                const isOpen = open === r.code;
                return (
                  <Fragment key={r.code}>
                    <tr onClick={() => setOpen(isOpen ? null : r.code)} className={'cursor-pointer ' + (isOpen ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                      <td className="whitespace-nowrap py-1.5 pl-3 pr-2 font-mono text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? <ChevronDownIcon className="h-3 w-3 text-slate-400" /> : <ChevronRightIcon className="h-3 w-3 text-slate-400" />}
                          <span title={r.title || undefined}>{r.code}</span>
                          <SliderBadge mark={mark} />
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{r.units_30d}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600"
                        title={r.last_sold_price !== null ? `Sold at ${money(r.last_sold_price)}` : undefined}>
                        {shortDate(r.last_sold)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums text-slate-800"
                        title={r.priced_on ? `Price live ${shortDate(r.priced_on)}` : 'No logged price change before this sale (the log keeps a year)'}>
                        {days(r.priced_to_sold)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums text-slate-800"
                        title={r.shipped_on ? `Shipped ${shortDate(r.shipped_on)}` : 'No FBA shipment in the 60-day archive before this sale — it went to Amazon earlier than that'}>
                        {days(r.shipped_to_sold)}
                      </td>
                      <td className={'whitespace-nowrap px-2 py-1.5 text-right tabular-nums ' + (r.unit_profit !== null && r.unit_profit <= thinLine ? 'text-amber-700' : 'text-slate-700')}>
                        {money(r.unit_profit)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-700"
                        title={queued !== null ? `Queued for upload — live is ${money(r.price)}` : 'Live'}>
                        {money(queued ?? r.price)}
                        {queued !== null && <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">queued</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-700">{money(r.rrp)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-700" title={`Live + inbound ${r.fba_total}`}>{r.fba_live}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600" title={last ? `${money(last.price)}${last.note ? ` — ${last.note}` : ''}` : 'No price change logged in the last year'}>
                        {last ? <>{shortDate(last.on)}<span className="text-slate-400"> · {last.by || '—'}</span></> : '—'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={COLUMNS.length} className="px-3 py-3">
                          <div className="flex flex-wrap items-start gap-x-10 gap-y-3 pl-4">
                            <PriceBox
                              row={r}
                              queued={queued}
                              nextReview={here?.nextReview ?? r.next_review}
                              sliderMark={mark}
                              onSetPrice={(price) => onSetPrice(r, price)}
                            />
                            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-sm">
                              <dt className="text-slate-500">Product</dt><dd className="text-slate-900">{r.title || '—'}</dd>
                              <dt className="text-slate-500">Last sold</dt><dd className="text-slate-900">{money(r.last_sold_price)} on {shortDate(r.last_sold)}</dd>
                              <dt className="text-slate-500">Price live</dt><dd className="text-slate-900">{shortDate(r.priced_on)}</dd>
                              <dt className="text-slate-500">Shipped</dt><dd className="text-slate-900">{shortDate(r.shipped_on)}</dd>
                            </dl>
                            <Link href={`/amz/sku/${encodeURIComponent(r.code)}?from=${encodeURIComponent('/amz/fast')}`} className="self-end text-sm text-brand-700 hover:underline">
                              Full price screen →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

/*
 * PRICE BOX — one size's Amazon price, as Amazon Order's detail row (− / + 10p, a typed box, Set or Enter writes, Escape puts it back).
 * Kept here rather than shared: the two screens' boxes differ in their review rule and may keep diverging. After a Set the box
 * already holds the price just written, which is now the queued price, so it reads as unchanged until the next nudge.
 */
interface PriceBoxProps {
  row: AmzFastRow;
  queued: number | null;
  nextReview: string | null;
  sliderMark: SliderMark | null;
  onSetPrice: (price: number) => Promise<{ error: string | null; aboveRrp: boolean }>;
}
function PriceBox({ row, queued, nextReview, sliderMark, onSetPrice }: PriceBoxProps) {
  const current = queued ?? row.price;
  const [draft, setDraft] = useState(current !== null ? current.toFixed(2) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const n = Number(draft);
  const price = draft.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  const changed = price !== null && (current === null || Math.abs(price - current) >= 0.005);
  const belowFloor = price !== null && row.floor !== null && price < row.floor;
  const reviewDays = reviewDaysFor(nextReview);

  function nudge(delta: number) {
    const base = price ?? current ?? 0;
    setDraft(Math.max(0.01, Math.round((base + delta) * 100) / 100).toFixed(2));
    setMsg(null);
  }
  async function submit() {
    if (!changed || price === null || busy) return;
    setBusy(true); setMsg(null);
    const res = await onSetPrice(price);
    setBusy(false);
    setMsg(res.error ? { tone: 'err', text: res.error }
      : res.aboveRrp ? { tone: 'warn', text: `Set to ${money(price)} — above RRP` }
      : { tone: 'ok', text: `Set to ${money(price)} → basket` });
  }

  const stepBtn = 'flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40';
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <SliderWarning mark={sliderMark} />
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Amazon price</div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => nudge(-0.1)} disabled={busy} aria-label="10p down" title="10p down" className={stepBtn}>
          <MinusIcon className="h-4 w-4" />
        </button>
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-400">£</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            disabled={busy}
            onChange={(e) => { setDraft(e.target.value.replace(/[^0-9.]/g, '')); setMsg(null); }}
            onBlur={() => { if (price !== null) setDraft(price.toFixed(2)); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { setDraft(current !== null ? current.toFixed(2) : ''); setMsg(null); }
            }}
            aria-label="Amazon price"
            className={'h-8 w-24 rounded-md border pl-5 pr-2 text-right text-sm font-semibold tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500 '
              + (belowFloor ? 'border-red-400' : 'border-slate-300')}
          />
        </div>
        <button type="button" onClick={() => nudge(0.1)} disabled={busy} aria-label="10p up" title="10p up" className={stepBtn}>
          <PlusIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!changed || busy}
          className="ml-1 h-8 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? 'Setting…' : 'Set'}
        </button>
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
        <div>
          Live {money(row.price)}
          {queued !== null && <span> · queued {money(queued)}</span>}
          {row.rrp !== null && <span> · RRP {money(row.rrp)}</span>}
          {row.floor !== null && <span className="text-slate-400"> · floor {money(row.floor)}</span>}
        </div>
        <div>
          {reviewDays !== null
            ? <>Review in {reviewDays} days ({shortDate(REVIEW_ON)})</>
            : <>Review stays {shortDate(nextReview)} (already later than {REVIEW_DAYS} days)</>}
        </div>
        {belowFloor && <div className="text-red-600">Below the floor (cost + FBA fee) — you&rsquo;d sell at a loss.</div>}
        {msg && (
          <div className={msg.tone === 'err' ? 'text-red-600' : msg.tone === 'warn' ? 'text-amber-700' : 'text-emerald-700'}>{msg.text}</div>
        )}
      </div>
    </div>
  );
}
