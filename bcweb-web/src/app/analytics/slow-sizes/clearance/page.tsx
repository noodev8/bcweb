'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes/clearance[?show=ebay|amazon]  (THE CLEARANCE SCREEN — opened from Range's step 5 box)
=======================================================================================================================================
Purpose: Step 5 of the Stock ladder, worked by hand (owner, 2026-11-15 — design docs/stock-ladder.md → "The Clearance screen as a whole",
         Decisions 1–9). ONE list, one row per SKU, any brand, with the three channels side by side (owner: "yes, one list with the
         three channels"). Each channel cell is its own price and its own button, or a grey reason why that channel can't sell the SKU
         — never hidden. Channels are independent: changing one never touches another. Rules: server utils/clearanceList.js (THE copy).

OPENS ON ALL (Decision 2) — every Clearance SKU, parked or not; each channel shows its own review date. Chips are filters, not parts:
         All · Could go on eBay · Could go on Amazon · At Amazon (?show= in the URL). Could go on Amazon = not listed by us but Amazon's
         catalogue has the barcode — known only from the look-up, so pressing that chip runs it (count "?" until then).

THE CHANNELS:
  Shopify  ALWAYS a SIZE price (Decision 3) — POST /pricing-size-price-set, the drill's Size prices panel's save (server
           utils/sizePrice.js: below the style price, in stock, no review date; ends by itself on sell-out; left out of paid Shopping).
           A box on each row, and one on the style line that sets every Clearance size of the style in turn. Below cost is flagged
           red, never blocked. KEPT SIMPLE (Decision 7): Shopify price cards may replace this later.
  Amazon   PICK on the row (owner, 2026-11-15): a size's free shelf pairs flagged for Amazon (POST /amz-pick-allocate, Amazon
           Order's own pick write) — then gathered from /pick's Amazon tab. Not Birkenstock.
           a size we can't sell there says why (listed · none at FBA / not listed by us); LOOK UP ON AMAZON (a button, owner's request
           only) finds those sizes in Amazon's catalogue by barcode — ASIN + rank, whoever sells it (server utils/amzBarcodeLookup.js).
           READ ONLY here (Decision 6, owner: "I don't want to be going back and forth"): price + review date, or "no FBA stock". ONE
           button, Price on Amazon (n), sends the lot to the step cards (/amz/step-cards?step=clearance&when=all) — the count is the
           step list's own (Buy Box sizes are never carded, and are marked here).
  eBay     a brand eBay never carries (Birkenstock today) = a greyed-out List, no words · on a listing: its price, a box to change it (POST /ebay-size-price) and "listing →" to the eBay
           screen · List → opens the eBay listing form for the WHOLE style (Decision 4, /ebay?view=not&q=) · no take-off here — ending
           a listing stays on the eBay screen, where every size it holds is in view (Decision 5).

ROW (Decision 8): size · pairs (local + FBA) · last sold (or never) · the three channels. Style line: GROUPID first (owner, 2026-11-15),
         then name, brand, cost, RRP.
ORDER (Decision 9): longest unsold first, the server's order.
=======================================================================================================================================
*/

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { ArrowPathIcon } from '@heroicons/react/20/solid';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { money } from '@/components/AmzCardFrame';
import BrandRrpNote from '@/components/BrandRrpNote';
import RrpStepper from '@/components/RrpStepper';
import { allocateAmazonPick, amazonList, getClearanceList, getLadderList, lookupOnAmazon, setEbaySizePrice, setSizePrice, type AmzBarcodeHit, type ClearanceRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { CLEARANCE_HREF, LIST_TEXT } from '@/lib/stockLadder';

const SELF = CLEARANCE_HREF;
const n = (v: number) => v.toLocaleString('en-GB');
// '6 Dec' (or '6 Dec 2027' outside this year) from YYYY-MM-DD — a calendar day, never through toISOString.
function dateLabel(v: string, today?: string) {
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  const sameYear = today ? Number(today.slice(0, 4)) === y : false;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
const ahead = (review: string | null, today: string) => !!review && review.slice(0, 10) > today;

// COULD GO ON AMAZON (owner, 2026-11-15): not listed by us at all (no amzfeed row) but Amazon's catalogue HAS the product (found by
// barcode, ranked or not) — so List on Amazon can put our offer on it. Known only after a look-up: pressing the chip runs it.
type Show = 'all' | 'ebay' | 'amzcould' | 'amazon';
type Hits = Map<string, AmzBarcodeHit>;
const SHOWS: { key: Show; label: string; test: (r: ClearanceRow, hits: Hits) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'ebay', label: 'Could go on eBay', test: (r) => r.ebay.state === 'could' },
  { key: 'amzcould', label: 'Could go on Amazon', test: (r, hits) => r.amazon.listable && hits.get(r.code)?.found === true },
  { key: 'amazon', label: 'At Amazon', test: (r) => r.amazon.open },
];
const isShow = (v: string | null): v is Show => v === 'ebay' || v === 'amzcould' || v === 'amazon' || v === 'all';

export default function ClearancePage() {
  const router = useRouter();
  const showParam = useUrlParam('show');
  const show: Show = isShow(showParam) ? showParam : 'all';

  const q = useApiQuery(['clearance-list'], () => getClearanceList());
  // The Amazon step list for step 5 — only for its count (what the cards will walk) and which sizes the Buy Box answers.
  const amz = useApiQuery(['ladder-list', 'clearance'], () => getLadderList('clearance'));
  const rows = q.data?.rows ?? [];
  const today = q.data?.today ?? '';
  // LOOK UP ON AMAZON (owner, 2026-11-15: "at my request rather than slowing the screen down"): sizes not selling on Amazon, found in
  // Amazon's catalogue by barcode (server utils/amzBarcodeLookup.js). Answers kept for the visit, nothing stored.
  const [hits, setHits] = useState<Hits>(() => new Map());
  const [looking, setLooking] = useState(false);
  const [lookingFor, setLookingFor] = useState(0);   // how many sizes the running look-up asked about — for the "looking up" banner
  const [lookErr, setLookErr] = useState<string | null>(null);
  const shown = rows.filter((r) => SHOWS.find((s) => s.key === show)!.test(r, hits));
  // Only sizes NOT already on Amazon (owner, 2026-11-15: "only for those that are not already") and not Birkenstock ("exclude
  // Birkenstock") — the server's `listable`. A size we've listed, even with nothing at FBA, already has its Amazon listing.
  const unknown = (list: ClearanceRow[]) => list.filter((r) => r.amazon.listable && !hits.has(r.code)).map((r) => r.code);
  const toLook = unknown(shown);
  const notLookedUp = unknown(rows).length;
  const buyBox = new Set((amz.data?.rows ?? []).filter((r) => r.when === 'buybox').map((r) => r.code));
  const toCard = (amz.data?.rows ?? []).filter((r) => r.when !== 'buybox').length;

  async function lookUp(codes: string[]) {
    if (codes.length === 0 || looking) return;
    setLooking(true);
    setLookingFor(codes.length);
    setLookErr(null);
    const res = await lookupOnAmazon(codes);
    setLooking(false);
    if (!res.success || !res.data) { setLookErr(res.error || 'Could not look them up'); return; }
    const { results, failed } = res.data;
    setHits((prev) => { const next = new Map(prev); for (const h of results) if (h.found !== null) next.set(h.code, h); return next; });
    if (failed > 0) setLookErr(`Amazon refused ${failed} batch${failed === 1 ? '' : 'es'} — press again for the rest`);
  }
  const pairs = rows.reduce((t, r) => t + r.units, 0);

  // A price set here: the row changes in place, no re-read (the ladder read is slow and nothing else moved).
  function patch(code: string, change: (r: ClearanceRow) => ClearanceRow) {
    q.mutate((d) => (d ? { ...d, rows: d.rows.map((r) => (r.code === code ? change(r) : r)) } : d), { revalidate: false });
  }

  const styles: { groupid: string; rows: ClearanceRow[] }[] = [];
  for (const r of shown) {
    const last = styles.at(-1);
    if (last && last.groupid === r.groupid) last.rows.push(r);
    else styles.push({ groupid: r.groupid, rows: [r] });
  }

  return (
    <AppShell backHref="/analytics/slow-sizes" backLabel="Range"
      crumb={<span className="font-medium text-slate-800">Clearance</span>}>
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Clearance <span className="text-sm font-normal text-slate-500">{LIST_TEXT.clearance.rule}</span></h1>
          {q.data && (
            <p className="mt-0.5 text-sm text-slate-600">
              {n(rows.length)} SKUs · {n(pairs)} pairs, every brand. Each channel is priced on its own.
            </p>
          )}
        </div>

        {/* CHIPS (filters) + the one Amazon button. */}
        <div className="flex flex-wrap items-center gap-2">
          {SHOWS.map((s) => (
            <button key={s.key} type="button"
              onClick={() => {
                router.replace(s.key === 'all' ? SELF : `${SELF}?show=${s.key}`, { scroll: false });
                if (s.key === 'amzcould') lookUp(unknown(rows));   // the chip needs the look-up — run it for every size not yet asked
              }}
              className={'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium '
                + (show === s.key ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
              {s.label} <span className="tabular-nums">{!q.data ? '–'
                : s.key === 'amzcould' && looking ? '…'
                  : s.key === 'amzcould' && notLookedUp > 0 && hits.size === 0 ? '?'
                    : n(rows.filter((r) => s.test(r, hits)).length)}</span>
            </button>
          ))}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {lookErr && <span className="text-xs text-red-700">{lookErr}</span>}
            {toLook.length > 0 && (
              <button type="button" onClick={() => lookUp(toLook)} disabled={looking}
                title="Find each size not selling on Amazon in Amazon's catalogue by its barcode — the ASIN and sales rank, whoever sells it"
                className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {looking ? <><ArrowPathIcon className="mr-1.5 h-4 w-4 animate-spin" />Looking up…</> : `Look up on Amazon (${n(toLook.length)})`}
              </button>
            )}
            {amz.data && toCard === 0 ? (
              <span className="text-sm text-slate-400">Nothing to price on Amazon</span>
            ) : (
              <Link href="/amz/step-cards?step=clearance&when=all"
                title="Every Clearance size at FBA, one Amazon price card at a time (Buy Box sizes are never carded)"
                className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Price on Amazon ({amz.data ? n(toCard) : '…'}) →
              </Link>
            )}
          </span>
        </div>

        {q.error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
        {!q.data && !q.error && <p className="text-sm text-slate-400">Loading…</p>}
        {/* LOOKING UP — made plain (owner, 2026-11-15: "I nearly pressed refresh"): a spinner, how many, and to wait. No time estimate. */}
        {looking && (
          <div role="status" aria-live="polite"
            className="flex items-center gap-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-slate-700 shadow-sm">
            <ArrowPathIcon className="h-5 w-5 shrink-0 animate-spin text-brand-600" />
            <span>
              <span className="font-medium text-slate-900">Looking up {n(lookingFor)} size{lookingFor === 1 ? '' : 's'} on Amazon…</span>{' '}
              stay on this page, the list fills in when it&apos;s done.
            </span>
          </div>
        )}
        {q.data && shown.length === 0 && !(looking && show === 'amzcould') && (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-500">Nothing here.</div>
        )}

        {shown.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white">
            {/* FROZEN HEADINGS (owner, 2026-11-15): the headings stick to the top of the window as the PAGE scrolls — one scroll bar
                (owner: "I don't want 2 scroll bars"). So no overflow on this box: any overflow here would trap the sticky heading. */}
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 shadow-[inset_0_-1px_0_rgb(226_232_240)]">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2 text-right" title="Local + at Amazon, one number">Pairs</th>
                  <th className="px-3 py-2">Last sold</th>
                  <th className="px-3 py-2">Shopify <span className="normal-case tracking-normal text-slate-400">size price</span></th>
                  <th className="px-3 py-2">Amazon</th>
                  <th className="px-3 py-2">eBay</th>
                </tr>
              </thead>
              <tbody>
                {styles.map((g) => {
                  const h = g.rows[0];
                  return (
                    <Fragment key={g.groupid}>
                      <StyleLine row={h} rows={g.rows} onSet={(code, price) => patch(code, (r) => ({ ...r, shopify: { ...r.shopify, size_price: price } }))} />
                      {g.rows.map((r) => (
                        <tr key={r.code} className="border-t border-slate-100 align-top">
                          <td className="whitespace-nowrap px-3 py-1.5">
                            {/* The WHOLE CODE, not just the size (owner, 2026-11-15). */}
                            <span className="inline-block whitespace-nowrap rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-700">{r.code}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-900">{n(r.units)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-slate-600" title={`${n(r.idle_days)} days without a sale`}>
                            {r.last_sale ? dateLabel(r.last_sale) : <span className="text-slate-400">never</span>}
                          </td>
                          <td className="px-3 py-1.5"><ShopifyCell row={r} today={today}
                            onSet={(price) => patch(r.code, (x) => ({ ...x, shopify: { ...x.shopify, size_price: price } }))} /></td>
                          <td className="px-3 py-1.5"><AmazonCell row={r} today={today} buyBox={buyBox.has(r.code)} hit={hits.get(r.code)}
                            onPicked={(pending, taken) => patch(r.code, (x) => ({ ...x, amazon: { ...x.amazon, pick_pending: pending, pick_free: Math.max(0, x.amazon.pick_free - taken) } }))} /></td>
                          <td className="px-3 py-1.5"><EbayCell row={r}
                            onSet={(price) => patch(r.code, (x) => ({ ...x, ebay: { ...x.ebay, price } }))} /></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// THE STYLE LINE: name, brand, cost, RRP, and one Shopify box that sets every Clearance size of the style shown here (in turn — the
// route takes one size at a time).
function StyleLine({ row: h, rows, onSet }: { row: ClearanceRow; rows: ClearanceRow[]; onSet: (code: string, price: number) => void }) {
  const settable = rows.filter((r) => r.shopify.live);
  return (
    <tr className="border-t-2 border-slate-200">
      <td colSpan={3} className="px-3 pb-1 pt-3">
        {/* GROUPID LEADS, the title second (owner, 2026-11-15). */}
        <Link href={`/pricing/style/${encodeURIComponent(h.groupid)}?from=${encodeURIComponent(SELF)}`} className="font-mono text-base font-semibold text-slate-900 hover:underline" title={h.title}>{h.groupid}</Link>
        <div className="max-w-[28rem] truncate text-xs text-slate-500" title={h.title}>
          {h.title}{h.brand ? ` · ${h.brand}` : ''} · cost {money(h.cost)} · RRP {money(h.rrp)}
        </div>
        {/* The brand asked for RRP on a channel — clearance prices are under RRP by design, so a quiet reminder (owner, 2026-11-18) */}
        <BrandRrpNote brand={h.brand} channel="SHP" rrp={h.rrp} price={null} className="text-xs" />
        <BrandRrpNote brand={h.brand} channel="AMZ" rrp={h.rrp} price={null} className="text-xs" />
      </td>
      <td className="px-3 pb-1 pt-3 align-bottom">
        {settable.length > 1 && (
          <PriceBox label={`All ${settable.length} sizes`} rrp={h.rrp} hint={h.rrp ? h.rrp / 2 : null}
            onSubmit={async (price) => {
              for (const r of settable) {
                const res = await setSizePrice(r.code, price);
                if (!res.success) return `Size ${r.size}: ${res.error || 'not set'}`;
                onSet(r.code, res.data?.price ?? price);
              }
              return null;
            }} />
        )}
      </td>
      <td />
      <td />
    </tr>
  );
}

function ShopifyCell({ row: r, today, onSet }: { row: ClearanceRow; today: string; onSet: (price: number) => void }) {
  if (!r.shopify.live) return <span className="text-slate-400">not live on Shopify</span>;
  const now = r.shopify.size_price ?? r.shopify.style_price;
  const belowCost = now !== null && r.cost !== null && now < r.cost;
  return (
    <div className="flex flex-col gap-1">
      <div className="whitespace-nowrap">
        <span className="tabular-nums text-slate-900">{money(now)}</span>
        {r.shopify.size_price !== null && <span className="ml-1 text-[10px] font-medium uppercase text-slate-500" title={`Its own size price — the style is ${money(r.shopify.style_price)}`}>size</span>}
        {belowCost && <span className="ml-1.5 rounded bg-red-600 px-1 text-[10px] font-semibold uppercase text-white">below cost</span>}
        {ahead(r.shopify.review, today) && <span className="ml-1.5 text-xs text-slate-500">· review {dateLabel(r.shopify.review!, today)}</span>}
      </div>
      <PriceBox rrp={r.rrp} hint={r.rrp ? r.rrp / 2 : null}
        onSubmit={async (price) => {
          const res = await setSizePrice(r.code, price);
          if (!res.success) return res.error || 'Not set';
          onSet(res.data?.price ?? price);
          return null;
        }} />
    </div>
  );
}

// PRICE → (owner, 2026-11-15, option A): the size's own Amazon price screen, for any size we have on Amazon (an amzfeed row) — listed
// but not sent, on its way in, New, selling. A freshly landed size is the Buy Box's "New" for 30 days and never on the Clearance
// cards, and a size priced ahead of arrival is live at that price the moment its pairs land — so the clearance price can go on from
// here at any stage. Back returns to Clearance.
const amzPriceHref = (code: string) => `/amz/sku/${encodeURIComponent(code)}?from=${encodeURIComponent(CLEARANCE_HREF)}`;
const PriceLink = ({ code }: { code: string }) => (
  <Link href={amzPriceHref(code)} className="ml-1.5 text-xs font-medium text-brand-700 hover:underline">price →</Link>
);

function AmazonCell({ row: r, today, buyBox, hit, onPicked }: {
  row: ClearanceRow; today: string; buyBox: boolean; hit?: AmzBarcodeHit; onPicked: (pending: number, taken: number) => void;
}) {
  // A size Amazon hasn't got at all (the look-up said so) can't be listed, so there's nothing to pick it for.
  const pick = hit?.found === false ? null : <PickToAmazon row={r} onPicked={onPicked} />;
  // Why we can't sell it there: listed by us with nothing at FBA, or never listed by us (no amzfeed row). Under it, once looked up:
  // what Amazon's catalogue says about the barcode, whoever sells it.
  if (!r.amazon.open) {
    return (
      <div className="whitespace-nowrap">
        <span className="text-slate-400">{r.amazon.listed ? 'listed · none at FBA' : 'not listed by us'}</span>
        {r.amazon.listed && <PriceLink code={r.code} />}
        {hit && (
          <div className="text-xs">
            {hit.found ? (
              <>
                <span className="text-slate-700">{hit.rank ? `rank ${n(hit.rank)}` : 'on Amazon · no rank'}</span>{' '}
                <a href={`https://www.amazon.co.uk/dp/${hit.asin}`} target="_blank" rel="noopener noreferrer" title={hit.title ?? undefined}
                  className="font-mono text-brand-700 hover:underline">{hit.asin} ↗</a>
              </>
            ) : <span className="text-slate-500">not on Amazon at all</span>}
          </div>
        )}
        {r.amazon.listable && hit?.found !== false && <ListSizeOnAmazon row={r} />}
        {pick}
      </div>
    );
  }
  return (
    <div className="whitespace-nowrap">
      <span className="tabular-nums text-slate-900">{money(r.amazon.price)}</span>
      <PriceLink code={r.code} />
      {buyBox && <span className="ml-1.5 text-xs text-emerald-700" title="Sold on Amazon in 30 days — the Buy Box prices it, never a step card">Buy Box</span>}
      {ahead(r.amazon.review, today) && <span className="ml-1.5 text-xs text-slate-500">· review {dateLabel(r.amazon.review!, today)}</span>}
      <div className="text-xs text-slate-400">{n(r.amazon.fba)} at FBA</div>
      {pick}
    </div>
  );
}

function EbayCell({ row: r, onSet }: { row: ClearanceRow; onSet: (price: number) => void }) {
  const back = `&from=${encodeURIComponent(CLEARANCE_HREF)}&back=Clearance`;
  const listing = <Link href={`/ebay?q=${encodeURIComponent(r.groupid)}${back}`} className="text-xs font-medium text-brand-700 hover:underline">listing →</Link>;
  switch (r.ebay.state) {
    // A brand eBay never carries: a greyed-out List, no words (owner, 2026-11-15 — more brands may join Birkenstock later).
    case 'never':
      return (
        <span aria-disabled="true" title="Not sold on eBay"
          className="inline-flex h-8 cursor-not-allowed items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-300">
          List →
        </span>
      );
    case 'could':
      return (
        <Link href={`/ebay?view=not&q=${encodeURIComponent(r.groupid)}${back}`} title="Opens the eBay listing form for the whole style"
          className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
          List →
        </Link>
      );
    case 'style':
      return <div className="whitespace-nowrap"><span className="text-slate-400">style listed, not this size</span> {listing}</div>;
    case 'on':
      return (
        <div className="flex flex-col gap-1">
          <div className="whitespace-nowrap"><span className="tabular-nums text-slate-900">{money(r.ebay.price)}</span> {listing}</div>
          <PriceBox rrp={r.rrp} start={r.ebay.price} onSubmit={async (price) => {
            const res = await setEbaySizePrice(r.code, price);
            if (!res.success) return res.error || 'Not set';
            onSet(res.data?.new_price ?? price);
            return null;
          }} />
        </div>
      );
  }
}

// LIST THIS SIZE ON AMAZON (owner, 2026-11-15: "it sends the whole size range? Some have rank 43k while other sizes are much more") —
// ONE size per press, at RRP, Fulfilled by Amazon (POST /amz-list with codes — server utils/amzListing.js, THE copy). Only a size we
// haven't listed and not Birkenstock (`listable`); hidden once the look-up says Amazon hasn't the product at all. The rank beside it
// is the owner's call (Option B — no rule). Listed ≠ selling: it reaches the Amazon cards once pairs are at FBA.
// After a press the row stays as it was ("not listed by us") until the next read: our Amazon products only get the size (and so its
// price → link) from the next Update Orders — the message says so.
function ListSizeOnAmazon({ row: r }: { row: ClearanceRow }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function go() {
    setBusy(true);
    setMsg(null);
    const res = await amazonList(r.groupid, true, [r.code]);
    setBusy(false);
    const size = res.data?.sizes.find((z) => z.code === r.code);
    if (!res.success || !size) { setMsg({ ok: false, text: res.error || 'Not listed' }); return; }
    if (size.state === 'listed') { setMsg({ ok: true, text: `Listed at ${money(res.data!.price)} — price → shows after the next Update Orders` }); return; }
    setMsg({ ok: false, text: size.state === 'not_in_catalogue' ? "Not on Amazon's catalogue" : size.state === 'no_barcode' ? 'No barcode'
      : size.state === 'on_amazon' ? 'Already on Amazon' : size.message || 'Amazon refused it' });
  }
  if (msg?.ok) return <div className="mt-1 whitespace-normal text-xs text-emerald-700">{msg.text}</div>;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={go} disabled={busy} title="List this size on Amazon at RRP, Fulfilled by Amazon"
        className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {busy ? 'Listing…' : 'List on Amazon'}
      </button>
      {msg && <span className="whitespace-normal text-xs text-red-700">{msg.text}</span>}
    </div>
  );
}

// PICK TO AMAZON (owner, 2026-11-15, option A — "pick on the row"): flag this size's free shelf pairs for Amazon. The Amazon Order
// screen's own pick write (POST /amz-pick-allocate — one size per call, idempotent: it takes the asked TOTAL pending, so a double press
// adds nothing). The pairs then wait on /pick's Amazon tab to be gathered onto C3-Amazon for the shipment; undo is /pick's Unallocate.
// Starts at every free pair (Clearance = clear the lot). A picked pair can't go to a Shopify customer order — but once at FBA, Shopify
// and eBay still sell it (MCF). Birkenstock never: the server gives it no free pairs to pick.
function PickToAmazon({ row: r, onPicked }: { row: ClearanceRow; onPicked: (pending: number, taken: number) => void }) {
  const free = r.amazon.pick_free;
  const pending = r.amazon.pick_pending;
  const [qty, setQty] = useState(free);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const want = Math.min(Math.max(qty, 1), free);
  async function go() {
    setBusy(true);
    setErr(null);
    const res = await allocateAmazonPick(r.code, pending + want);
    setBusy(false);
    if (!res.success || !res.data) { setErr(res.error || 'Not picked'); return; }
    onPicked(res.data.pending_total, res.data.allocated);
    setQty(Math.max(0, free - res.data.allocated));
    if (res.data.short > 0) setErr(`${res.data.short} not on the shelf any more`);
  }
  const step = 'h-6 w-6 rounded border border-slate-300 bg-white text-xs font-semibold leading-none text-slate-700 hover:bg-slate-50 disabled:opacity-40';
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {pending > 0 && (
        <Link href={`/pick?from=${encodeURIComponent(CLEARANCE_HREF)}&back=Clearance`} className="font-medium text-emerald-700 hover:underline"
          title="Waiting on /pick's Amazon tab to be gathered for the shipment">{n(pending)} picked →</Link>
      )}
      {free > 0 && (
        <>
          <button type="button" className={step} disabled={busy || want <= 1} onClick={() => setQty(want - 1)} aria-label="One fewer">−</button>
          <span className="w-5 text-center tabular-nums text-slate-900">{want}</span>
          <button type="button" className={step} disabled={busy || want >= free} onClick={() => setQty(want + 1)} aria-label="One more">+</button>
          <button type="button" onClick={go} disabled={busy} title={`Pick ${want} of the ${free} free on the shelf for Amazon`}
            className="inline-flex h-6 items-center rounded-md border border-slate-300 bg-white px-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {busy ? 'Picking…' : 'Pick'}
          </button>
          <span className="text-slate-400">of {n(free)} on the shelf</span>
        </>
      )}
      {err && <span className="whitespace-normal text-red-700">{err}</span>}
    </div>
  );
}

// A price box + Set. onSubmit returns an error message, or null when it worked.
// `start` = the price now (the eBay box): shown in the box, so it reads as "change this"; Set only lights up once it differs.
// `hint` = the grey hint in an empty box (50% of RRP) and where − / + start from; `rrp` drives the 5% steps (components/RrpStepper).
function PriceBox({ label, rrp, hint = null, start, onSubmit }: {
  label?: string; rrp: number | null; hint?: number | null; start?: number | null; onSubmit: (price: number) => Promise<string | null>;
}) {
  const [text, setText] = useState(start != null ? start.toFixed(2) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const price = Math.round(Number(text) * 100) / 100;
  const valid = text.trim() !== '' && Number.isFinite(price) && price > 0 && (start == null || Math.abs(price - start) >= 0.005);

  async function go() {
    if (!valid || busy) return;
    setBusy(true);
    setMsg(null);
    const err = await onSubmit(price);
    setBusy(false);
    if (err) { setMsg({ ok: false, text: err }); return; }
    if (start == null) setText('');   // a prefilled box keeps the new price (the parent's `start` moves with it)
    setMsg({ ok: true, text: 'Set' });
  }

  return (
    // The label sits ABOVE the box (owner, 2026-11-15), so the style line's − box + % Set line up with the size rows' under it.
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs text-slate-500">{label}</span>}
      <div className="flex flex-wrap items-center gap-1.5">
      <RrpStepper text={text} rrp={rrp} fallback={hint} disabled={busy} onChange={(v) => { setText(v); setMsg(null); }}>
        <input inputMode="decimal" value={text} placeholder={hint !== null ? hint.toFixed(2) : undefined} aria-label={label ?? 'New price'}
          onChange={(e) => { setText(e.target.value); setMsg(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
      </RrpStepper>
      <button type="button" onClick={go} disabled={!valid || busy}
        className="h-7 rounded-md bg-brand-600 px-2.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40">
        {busy ? 'Setting…' : 'Set'}
      </button>
      {msg && <span className={'text-xs ' + (msg.ok ? 'text-emerald-700' : 'text-red-700')}>{msg.text}</span>}
      </div>
    </div>
  );
}
