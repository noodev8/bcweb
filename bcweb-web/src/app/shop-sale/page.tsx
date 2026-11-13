'use client';
/*
=======================================================================================================================================
Page: /shop-sale  (Shop Sale — record a sale in the shop, CM3)
=======================================================================================================================================
Purpose: Replaces the PowerBuilder offline-sold window. Type the name, brand, groupid or code; pick the style from a plain text list;
         its picture shows as the check that it's the right shoe; pick the size and the shelf, Add to basket. Something that isn't a
         product is added as a MISC item (typed description + price). Then the basket: each line's price, the total, card or cash,
         Record sale — ONE sale, every line booked together (routes/shop-sale-record.js).

THE BASKET (owner, 2026-11-13: a customer bought 2 pairs and there was no way to build her basket, get a final price and check out "and
the ability to price the shoes differently if I was to give a discount for multi buy or on one shoe"). Two ways to price it:
  - a line's own price box — money off one pair;
  - the TOTAL box — type the deal price ("both for £150") and it is shared across the lines in proportion to their prices, to the
    penny (the last line takes the rounding). Each pair is booked at its share, so its profit and VAT are right on the Sales screen.
Recording is all or nothing: if one line can't be booked (a shelf emptied meanwhile) nothing is recorded and the message names it.
The basket lives in the page only — leaving the screen empties it (a sale is rung up in one go, nothing half-done is kept).

KEPT DELIBERATELY PLAIN (owner, 2026-10-09 — "keep it simple"). Shop sales are rare. No picture grid of stock (only the one style
picked shows its image), no recent-sales list.

WE CAN SELL ANYTHING (owner). Every style and every size is offered, stock or not — a clearance pair kept off the website, a pair taken
out of its location to show in the shop, or a wrong count. When the system holds a free unit it comes off the count; when it doesn't,
the sale is booked with no stock move.

WHICH SHELF (owner, 2026-10-09: "make sure our stock is kept up to date"). Whenever the system shows stock for the size, a "Taken
from" choice is shown. NO LOCATION IS THE MAIN OPTION AND THE DEFAULT (owner, 2026-11-13 — shoes are taken out of their locations to be
shown in the shop, so the pair sold is usually already out): a large first choice, "Already out of its location — the stock count isn't
changed". The shelves follow as small buttons ("or take it off a shelf"), for a pair fetched from its shelf, so that shelf's count drops.
Pairs already in the basket are taken off the shelf counts shown, so a second pair of the same size can't be sent to a shelf whose last
pair is already in the basket.

THE TITLE IS LEFT-ALIGNED like every other titled page, and the form sits left under it.

PRICE STARTS AT RRP — the shop charges RRP (owner; docs/cm3-shop-plan.md §4.3). The website price is shown beside it, labelled, for
when a customer has looked it up on their phone. Every box is free to edit: whatever was actually paid is what's booked.

There is no undo here: a mistake is fixed by hand (the sales rows, and the count on Inventory if a unit came off).
Data is SWR via useApiQuery (no fetching in effects); the list is one call and the search is client-side.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MagnifyingGlassIcon, CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getShopSaleList, recordShopSale, type ShopSaleStyle, type ShopSaleItem, type ShopPaytype } from '@/lib/api';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
// Rows listed for a search. Past this, type another word.
const MAX_RESULTS = 30;

// The "No location" choice in the Taken-from row. Not a real location name (they're all 'C1-…'/'C3-…').
const NO_STOCK = '__none__';

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);
const pennies = (v: number) => Math.round(v * 100);

// A line waiting in the basket. `location` is a real shelf, NO_STOCK, or null (none on the system).
interface BasketLine {
  key: number;
  label: string;        // groupid, or the misc description
  detail: string;       // title + size, or 'Misc'
  code: string | null;
  location: string | null;
  description: string | null;
  rrp: number | null;
  priceText: string;
}

function parsePrice(text: string): number | null {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// Shares `total` across the lines in proportion to their current prices, to the penny; the last line takes the rounding. Returns
// null when it can't be done fairly (a line without a price, or a total that would leave a line at £0).
function shareTotal(prices: number[], total: number): number[] | null {
  const sum = prices.reduce((n, p) => n + pennies(p), 0);
  const want = pennies(total);
  if (sum <= 0 || want < prices.length) return null;
  let given = 0;
  const out = prices.map((p, i) => {
    if (i === prices.length - 1) return want - given;
    const share = Math.max(1, Math.round((pennies(p) * want) / sum));
    given += share;
    return share;
  });
  if (out[out.length - 1] < 1) return null;
  return out.map((p) => p / 100);
}

function Picture({ imagename, alt }: { imagename: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!imagename || failed) return null;
  return (
    <div className="relative h-56 w-56 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
      <Image src={IMAGE_BASE + imagename} alt={alt} fill sizes="224px" onError={() => setFailed(true)} className="object-contain" />
    </div>
  );
}

const INPUT = 'rounded-md border border-slate-300 text-base focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

function PriceBox({ id, value, onChange, onCommit, className = 'w-32' }: {
  id?: string; value: string; onChange: (v: string) => void; onCommit?: () => void; className?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">£</span>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => { if (e.key === 'Enter' && onCommit) { e.preventDefault(); onCommit(); } }}
        className={`${INPUT} py-2 pl-7 pr-3 text-right ${className}`}
      />
    </div>
  );
}

export default function ShopSalePage() {
  const { data, error: loadError, isLoading, refresh } = useApiQuery(['shop-sale-list'], () => getShopSaleList());
  const styles = useMemo(() => data?.styles ?? [], [data]);

  // The item being picked.
  const [term, setTerm] = useState('');
  const [groupid, setGroupid] = useState<string | null>(null);
  const [misc, setMisc] = useState(false);
  const [description, setDescription] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');

  // The basket.
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [totalDraft, setTotalDraft] = useState<string | null>(null);   // non-null while the total box is being typed in
  const [paytype, setPaytype] = useState<ShopPaytype>('card');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Every word typed must appear somewhere in the title, brand, groupid or a size code.
  const results = useMemo(() => {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return styles.filter((s) => {
      const hay = `${s.title ?? ''} ${s.brand ?? ''} ${s.groupid} ${s.codes}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [styles, term]);

  // Pairs already in the basket, by code and by code + shelf — taken off the counts shown so the same pair isn't picked twice.
  const inBasket = useMemo(() => {
    const byCode = new Map<string, number>();
    const byShelf = new Map<string, number>();
    for (const l of basket) {
      if (!l.code || !l.location || l.location === NO_STOCK) continue;
      byCode.set(l.code, (byCode.get(l.code) ?? 0) + 1);
      byShelf.set(`${l.code}|${l.location}`, (byShelf.get(`${l.code}|${l.location}`) ?? 0) + 1);
    }
    return { byCode, byShelf };
  }, [basket]);
  const freeLeft = (c: string, free: number) => Math.max(0, free - (inBasket.byCode.get(c) ?? 0));
  const shelvesLeft = (c: string, lines: { location: string; units: number }[]) =>
    lines
      .map((l) => ({ location: l.location, units: l.units - (inBasket.byShelf.get(`${c}|${l.location}`) ?? 0) }))
      .filter((l) => l.units > 0);

  const selected: ShopSaleStyle | null = styles.find((s) => s.groupid === groupid) ?? null;
  const size = selected?.sizes.find((z) => z.code === code) ?? null;
  const shelves = size ? shelvesLeft(size.code, size.lines) : [];
  const itemPrice = parsePrice(priceText);
  // Any stock left on the system = the Taken-from row is shown and must have an answer (a shelf, or No location).
  const hasStock = shelves.length > 0;
  const canAdd = (misc ? description.trim() !== '' : !!size && (!hasStock || !!location)) && itemPrice !== null;

  const linePrices = basket.map((l) => parsePrice(l.priceText));
  const basketOk = basket.length > 0 && linePrices.every((p) => p !== null);
  const total = basketOk ? Math.round(linePrices.reduce((n: number, p) => n + (p ?? 0), 0) * 100) / 100 : null;
  // RRP total, only when every line has one (misc has none) — the "£x off" line under the total.
  const rrpTotal = basket.length > 0 && basket.every((l) => l.rrp !== null)
    ? Math.round(basket.reduce((n, l) => n + (l.rrp ?? 0), 0) * 100) / 100 : null;
  const canRecord = basketOk && totalDraft === null && !saving;

  function clearItem() {
    setGroupid(null);
    setMisc(false);
    setDescription('');
    setCode(null);
    setLocation(null);
    setPriceText('');
  }

  function pickStyle(s: ShopSaleStyle) {
    clearItem();
    setGroupid(s.groupid);
    setPriceText(s.rrp !== null ? s.rrp.toFixed(2) : '');
    setDone(null);
    setError(null);
  }

  function startMisc() {
    clearItem();
    setMisc(true);
    setDescription(term.trim());
    setDone(null);
    setError(null);
  }

  function pickSize(c: string, lines: { location: string; units: number }[]) {
    setCode(c);
    // No location is the default whenever the system shows stock (see the header); a shelf is a deliberate second choice.
    setLocation(shelvesLeft(c, lines).length > 0 ? NO_STOCK : null);
  }

  function addToBasket() {
    if (!canAdd || itemPrice === null) return;
    const line: BasketLine = misc
      ? { key: nextKey, label: description.trim(), detail: 'Misc', code: null, location: null, description: description.trim(), rrp: null, priceText: itemPrice.toFixed(2) }
      : {
        key: nextKey, label: selected!.groupid, detail: `${selected!.title ?? ''}${selected!.title ? ' · ' : ''}size ${size!.size}`,
        code: size!.code, location: hasStock ? location : null, description: null, rrp: selected!.rrp, priceText: itemPrice.toFixed(2),
      };
    setBasket((b) => [...b, line]);
    setNextKey((k) => k + 1);
    clearItem();
    setTerm('');
    setError(null);
  }

  function setLinePrice(key: number, text: string) {
    setBasket((b) => b.map((l) => (l.key === key ? { ...l, priceText: text } : l)));
  }

  function removeLine(key: number) {
    setBasket((b) => b.filter((l) => l.key !== key));
    setTotalDraft(null);
  }

  // The deal price: share the typed total across the lines by their current prices.
  function commitTotal() {
    if (totalDraft === null) return;
    const want = parsePrice(totalDraft);
    setTotalDraft(null);
    if (want === null || !basketOk || want === total) return;
    const shared = shareTotal(linePrices as number[], want);
    if (!shared) { setError(`Can't share ${money(want)} across ${basket.length} items`); return; }
    setError(null);
    setBasket((b) => b.map((l, i) => ({ ...l, priceText: shared[i].toFixed(2) })));
  }

  function emptyBasket() {
    setBasket([]);
    setTotalDraft(null);
    setPaytype('card');
    setError(null);
  }

  async function record() {
    if (!canRecord) return;
    setSaving(true);
    setError(null);
    const items: ShopSaleItem[] = basket.map((l, i) => {
      const price = linePrices[i] as number;
      if (!l.code) return { description: l.description ?? '', price };
      if (l.location === NO_STOCK) return { code: l.code, noStock: true, price };
      return { code: l.code, location: l.location ?? undefined, price };
    });
    const res = await recordShopSale({ items, paytype });
    setSaving(false);
    if (!res.success || !res.data) {
      setError(res.error || 'Could not record the sale');
      if (res.return_code === 'NO_STOCK') await refresh();
      return;
    }
    const b = res.data.basket;
    setDone(`Recorded: ${b.lines.length === 1 ? '1 item' : `${b.lines.length} items`} — ${money(b.total)} ${b.paytype}`);
    emptyBasket();
    clearItem();
    setTerm('');
    await refresh();
  }

  const priceBox = (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor="shop-price" className="mb-2 block text-sm font-medium text-slate-700">Price</label>
        <PriceBox id="shop-price" value={priceText} onChange={setPriceText} />
        {selected && <div className="mt-1 text-xs text-slate-500">RRP {money(selected.rrp)} · website {money(selected.price)}</div>}
      </div>
      <div className={selected ? 'pb-5' : ''}>
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={!canAdd}
            onClick={addToBasket}
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white"
          >
            Add to basket
          </button>
          <button type="button" onClick={clearItem} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <AppShell
      title="Shop Sale"
      // A plain way through to the sales list, opened on CM3 (the shop) — what's been booked (back link returns here).
      headerRight={
        <Link href="/analytics/sales?ch=cm3&from=/shop-sale&back=Shop%20Sale" className="text-sm text-brand-700 hover:underline">
          Sales →
        </Link>
      }
    >
      <div className="max-w-3xl space-y-5">
        {done && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircleIcon className="h-5 w-5 shrink-0" />
            {done}
          </div>
        )}

        {loadError && <p className="text-sm text-red-600">{loadError.message}</p>}

        {basket.length > 0 && (
          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-slate-900">Basket</h2>
              <button type="button" onClick={emptyBasket} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
                Empty basket
              </button>
            </div>

            <ul className="divide-y divide-slate-100">
              {basket.map((l) => (
                <li key={l.key} className="flex items-center gap-4 py-2.5">
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium text-slate-800">{l.label}</div>
                    <div className="truncate text-slate-500">
                      {l.detail}
                      {l.code && (
                        <span className="text-slate-400">
                          {' · '}{l.location === NO_STOCK ? 'no location, count unchanged' : l.location ? `off shelf ${l.location}` : 'none on the system'}
                        </span>
                      )}
                    </div>
                  </div>
                  {l.rrp !== null && <div className="hidden text-xs text-slate-400 sm:block">RRP {money(l.rrp)}</div>}
                  <PriceBox value={l.priceText} onChange={(v) => setLinePrice(l.key, v)} className="w-28" />
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    title="Take out of the basket"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-end justify-end gap-6 border-t border-slate-200 pt-4">
              <div className="text-right">
                <label htmlFor="shop-total" className="mb-2 block text-sm font-medium text-slate-700">Total to pay</label>
                <PriceBox
                  id="shop-total"
                  value={totalDraft ?? (total !== null ? total.toFixed(2) : '')}
                  onChange={(v) => setTotalDraft(v)}
                  onCommit={commitTotal}
                  className="w-32 font-semibold"
                />
                <div className="mt-1 text-xs text-slate-500">
                  {rrpTotal !== null && total !== null && total < rrpTotal
                    ? `RRP ${money(rrpTotal)} · ${money(rrpTotal - total)} off`
                    : basket.length > 1 ? 'Type a deal price — it is shared across the items' : ' '}
                </div>
              </div>

              <div className="pb-5">
                <div className="mb-2 text-sm font-medium text-slate-700">Paid by</div>
                <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
                  {(['card', 'cash'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPaytype(p)}
                      className={`px-4 py-2 text-sm capitalize ${paytype === p ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pb-5">
                <button
                  type="button"
                  disabled={!canRecord}
                  onClick={record}
                  className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {saving ? 'Recording…' : `Record sale${basket.length > 1 ? ` · ${basket.length} items` : ''}`}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </section>
        )}

        {selected ? (
          <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-5 sm:flex-row">
              <Picture key={selected.groupid} imagename={selected.imagename} alt={selected.title || selected.groupid} />
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{selected.groupid}</h2>
                  <div className="text-sm text-slate-500">{selected.title}{selected.brand ? ` · ${selected.brand}` : ''}</div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium text-slate-700">Size</div>
                  <div className="flex flex-wrap gap-2">
                    {selected.sizes.map((z) => {
                      const on = z.code === code;
                      return (
                        <button
                          key={z.code}
                          type="button"
                          onClick={() => pickSize(z.code, z.lines)}
                          className={`min-w-[3.5rem] rounded-md border px-3 py-2 text-center text-sm transition ${
                            on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500'}`}
                        >
                          <div className="font-semibold">{z.size}</div>
                          <div className={`text-xs ${on ? 'text-slate-300' : 'text-slate-400'}`}>{freeLeft(z.code, z.free)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {hasStock && (
                  <div>
                    <div className="mb-2 text-sm font-medium text-slate-700">Taken from</div>
                    <button
                      type="button"
                      onClick={() => setLocation(NO_STOCK)}
                      className={`flex w-full max-w-sm items-start gap-3 rounded-md border px-4 py-2.5 text-left transition ${
                        location === NO_STOCK ? 'border-slate-800 bg-slate-50' : 'border-slate-300 bg-white hover:border-slate-500'}`}
                    >
                      <span className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
                        location === NO_STOCK ? 'border-slate-800 bg-slate-800 ring-2 ring-inset ring-white' : 'border-slate-400'}`} />
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">No location</span>
                        <span className="block text-xs text-slate-500">Already out of its location — the stock count isn&apos;t changed</span>
                      </span>
                    </button>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500">or take it off a shelf:</span>
                      {shelves.map((l) => {
                        const on = l.location === location;
                        return (
                          <button
                            key={l.location}
                            type="button"
                            onClick={() => setLocation(l.location)}
                            className={`rounded-md border px-2.5 py-1 text-xs transition ${
                              on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'}`}
                          >
                            {l.location} <span className={on ? 'text-slate-300' : 'text-slate-400'}>({l.units})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {size && !hasStock && (
                  <div className="text-sm text-slate-500">None in stock on the system — no stock is moved.</div>
                )}
              </div>
            </div>
            {priceBox}
          </section>
        ) : misc ? (
          <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5">
            <div>
              <label htmlFor="shop-misc" className="mb-2 block text-sm font-medium text-slate-700">What was sold</label>
              <input
                id="shop-misc"
                autoFocus
                maxLength={50}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Socks"
                className={`${INPUT} w-full px-3 py-2`}
              />
            </div>
            {priceBox}
          </section>
        ) : (
          <section className="space-y-3">
            {basket.length > 0 && <div className="text-sm font-medium text-slate-700">Add another item</div>}
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={term}
                onChange={(e) => { setTerm(e.target.value); setDone(null); }}
                placeholder={isLoading ? 'Loading…' : 'Name, brand, groupid or code'}
                className={`${INPUT} w-full rounded-lg py-3 pl-10 pr-4`}
              />
            </div>

            {results.length > 0 && (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {results.slice(0, MAX_RESULTS).map((s) => (
                  <li key={s.groupid}>
                    <button
                      type="button"
                      onClick={() => pickStyle(s)}
                      className="flex w-full items-baseline justify-between gap-4 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="text-slate-800">
                        <span className="font-medium">{s.groupid}</span>
                        {s.title && <span className="ml-2 text-slate-500">{s.title}</span>}
                      </span>
                      <span className="shrink-0 text-slate-600">{money(s.rrp)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {results.length > MAX_RESULTS && (
              <p className="text-xs text-slate-500">Showing {MAX_RESULTS} of {results.length} — add another word.</p>
            )}
            {term.trim() !== '' && results.length === 0 && !isLoading && (
              <p className="text-sm text-slate-500">No product matches.</p>
            )}

            <button type="button" onClick={startMisc} className="text-sm text-brand-600 hover:underline">
              Not a product? Add a misc item
            </button>
          </section>
        )}
      </div>
    </AppShell>
  );
}
