'use client';
/*
=======================================================================================================================================
Page: /shop-sale  (Shop Sale — record an item sold in the shop, CM3)
=======================================================================================================================================
Purpose: Replaces the PowerBuilder offline-sold window. Type the name, brand, groupid or code; pick the style from a plain text list;
         its picture shows as the check that it's the right shoe; pick the size, confirm the price, card or cash, Record. One item per
         record. Something that isn't a product is recorded as a MISC item (typed description + price).

KEPT DELIBERATELY PLAIN (owner, 2026-10-09 — "keep it simple"). Shop sales are rare. No picture grid of stock (only the one style
picked shows its image), no recent-sales list.

WE CAN SELL ANYTHING (owner). Every style and every size is offered, stock or not — a clearance pair kept off the website, or a wrong
count. When the system holds a free unit it comes off the count (routes/shop-sale-record.js); when it doesn't, the sale is booked
with no stock move.

WHICH SHELF (owner, 2026-10-09: "make sure our stock is kept up to date"). Whenever the system shows stock for the size, a "Taken
from" row offers each shelf PLUS "No location" — for a pair already taken off its shelf by hand, where taking another would
double-count. One shelf: it is preselected. More than one: nothing is preselected and one must be chosen, no shelf favoured, so a later
pick isn't sent to a shelf whose pair was already sold. The shelf (or "no location") is in the bclog line ('Shop' section),
searchable on the Log screen.

THE TITLE IS LEFT-ALIGNED like every other titled page, and the form sits left under it (not centred in a narrower column, which
left the two out of line).

PRICE STARTS AT RRP — the shop charges RRP (owner; docs/cm3-shop-plan.md §4.3). The website price is shown beside it, labelled, for
when a customer has looked it up on their phone. The box is free to edit: whatever was actually paid is what's booked.

There is no undo here: a mistake is fixed by hand (the sales row, and the count on Inventory if a unit came off).
Data is SWR via useApiQuery (no fetching in effects); the list is one call and the search is client-side.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { MagnifyingGlassIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getShopSaleList, recordShopSale, type ShopSaleStyle, type ShopPaytype } from '@/lib/api';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
// Rows listed for a search. Past this, type another word.
const MAX_RESULTS = 30;

// The "No location" choice in the Taken-from row. Not a real location name (they're all 'C1-…'/'C3-…').
const NO_STOCK = '__none__';

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);

function Picture({ imagename, alt }: { imagename: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!imagename || failed) return null;
  return (
    <div className="relative h-56 w-56 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
      <Image src={IMAGE_BASE + imagename} alt={alt} fill sizes="224px" onError={() => setFailed(true)} className="object-contain" />
    </div>
  );
}

export default function ShopSalePage() {
  const { data, error: loadError, isLoading, refresh } = useApiQuery(['shop-sale-list'], () => getShopSaleList());
  const styles = useMemo(() => data?.styles ?? [], [data]);

  const [term, setTerm] = useState('');
  const [groupid, setGroupid] = useState<string | null>(null);
  const [misc, setMisc] = useState(false);
  const [description, setDescription] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');
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

  const selected: ShopSaleStyle | null = styles.find((s) => s.groupid === groupid) ?? null;
  const size = selected?.sizes.find((z) => z.code === code) ?? null;
  const price = Number(priceText);
  const priceOk = priceText.trim() !== '' && Number.isFinite(price) && price > 0;
  // Any stock on the system = the Taken-from row is shown and must have an answer (a shelf, or No location).
  const hasStock = !!size && size.lines.length > 0;
  const canRecord = (misc ? description.trim() !== '' : !!size && (!hasStock || !!location)) && priceOk && !saving;

  function startOver() {
    setGroupid(null);
    setMisc(false);
    setDescription('');
    setCode(null);
    setLocation(null);
    setPriceText('');
    setPaytype('card');
    setError(null);
  }

  function pickStyle(s: ShopSaleStyle) {
    startOver();
    setGroupid(s.groupid);
    setPriceText(s.rrp !== null ? s.rrp.toFixed(2) : '');
    setDone(null);
  }

  function startMisc() {
    startOver();
    setMisc(true);
    setDescription(term.trim());
    setDone(null);
  }

  async function record() {
    if (!canRecord) return;
    setSaving(true);
    setError(null);
    const res = await recordShopSale(
      misc ? { description: description.trim(), price, paytype }
        : location === NO_STOCK ? { code: size!.code, noStock: true, price, paytype }
          : { code: size!.code, location: location ?? undefined, price, paytype }
    );
    setSaving(false);
    if (!res.success || !res.data) {
      setError(res.error || 'Could not record the sale');
      if (res.return_code === 'NO_STOCK') { setLocation(null); await refresh(); }
      return;
    }
    const what = misc ? description.trim() : `${selected?.groupid} ${selected?.title ?? ''}, size ${size?.size}`;
    setDone(`Recorded: ${what} — ${money(res.data.sale.price)} ${res.data.sale.paytype}`);
    startOver();
    setTerm('');
    await refresh();
  }

  const priceAndPay = (
    <>
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <label htmlFor="shop-price" className="mb-2 block text-sm font-medium text-slate-700">Price paid</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">£</span>
            <input
              id="shop-price"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              className="w-32 rounded-md border border-slate-300 py-2 pl-7 pr-3 text-base focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          {selected && <div className="mt-1 text-xs text-slate-500">RRP {money(selected.rrp)} · website {money(selected.price)}</div>}
        </div>

        <div>
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
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled={!canRecord}
          onClick={record}
          className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? 'Recording…' : 'Record sale'}
        </button>
        <button type="button" onClick={startOver} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
          Cancel
        </button>
      </div>
    </>
  );

  return (
    <AppShell title="Shop Sale">
      <div className="max-w-3xl space-y-5">
        {done && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircleIcon className="h-5 w-5 shrink-0" />
            {done}
          </div>
        )}

        {loadError && <p className="text-sm text-red-600">{loadError.message}</p>}

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
                          // One shelf: preselect it. Several: leave it to the operator.
                          onClick={() => { setCode(z.code); setLocation(z.lines.length === 1 ? z.lines[0].location : null); }}
                          className={`min-w-[3.5rem] rounded-md border px-3 py-2 text-center text-sm transition ${
                            on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-brand-500'}`}
                        >
                          <div className="font-semibold">{z.size}</div>
                          <div className={`text-xs ${on ? 'text-brand-100' : 'text-slate-400'}`}>{z.free}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {hasStock && (
                  <div>
                    <div className="mb-2 text-sm font-medium text-slate-700">Taken from</div>
                    <div className="flex flex-wrap gap-2">
                      {[...size!.lines, { location: NO_STOCK, units: 0 }].map((l) => {
                        const on = l.location === location;
                        return (
                          <button
                            key={l.location}
                            type="button"
                            onClick={() => setLocation(l.location)}
                            className={`rounded-md border px-3 py-1.5 text-sm transition ${
                              on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand-500'}`}
                          >
                            {l.location === NO_STOCK ? 'No location' : (
                              <>{l.location} <span className={on ? 'text-brand-100' : 'text-slate-400'}>({l.units})</span></>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {size && size.lines.length === 0 && (
                  <div className="text-sm text-slate-500">None in stock on the system — no stock is moved.</div>
                )}
              </div>
            </div>
            {priceAndPay}
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
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            {priceAndPay}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={term}
                onChange={(e) => { setTerm(e.target.value); setDone(null); }}
                placeholder={isLoading ? 'Loading…' : 'Name, brand, groupid or code'}
                className="w-full rounded-lg border border-slate-300 py-3 pl-10 pr-4 text-base focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
              Not a product? Record a misc item
            </button>
          </section>
        )}
      </div>
    </AppShell>
  );
}
