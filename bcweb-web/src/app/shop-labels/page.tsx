'use client';
/*
=======================================================================================================================================
Page: /shop-labels  (Shop Labels — print price stickers for the shop, CM3)
=======================================================================================================================================
Purpose: Build a list of styles, then make an A4 PDF of price labels for an Avery L7160 sheet (3 × 7) and print it. Each label is the
         GROUPID and the price (src/lib/shopLabels.ts has the sheet and the label layout).

A BACK OFFICE SCREEN OF ITS OWN, not part of Shop Sale (2026-10-10): Shop Sale is a till — one style, record, done — while labels are
a list built up and printed in one go. It reuses Shop Sale's catalogue (routes/shop-sale-list.js) and its search, so no new route.

THE PRICE SWITCH (owner, 2026-10-10): "RRP only" is the default and is not remembered — every visit starts on it. "RRP + sale" prints
a style whose website price is under its RRP as the RRP struck through with the website price under it.

THE LIST is a per-browser convenience in localStorage (owner: "simplest is enough") — it survives a refresh, not a change of PC. It
holds only groupid + copies; the prices are read live from the catalogue, so a label always prints today's price. Adding a style
that's already on the list adds to its copies.

START AT LABEL N skips the labels already peeled off a part-used sheet; the preview shows the first sheet as it will print.
Data is SWR via useApiQuery (no fetching in effects).
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { MagnifyingGlassIcon, MinusIcon, PlusIcon, XMarkIcon, PrinterIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getShopSaleList, type ShopSaleStyle } from '@/lib/api';
import { SHEET, LABELS_PER_SHEET, labelFor, downloadLabelPdf, money, type PrintLabel } from '@/lib/shopLabels';

// Rows listed for a search. Past this, type another word.
const MAX_RESULTS = 30;
const STORE_KEY = 'shopLabels.list';
const MAX_COPIES = 999;

interface Entry { groupid: string; copies: number }

function readStore(): Entry[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter((e) => e && typeof e.groupid === 'string' && Number.isInteger(e.copies) && e.copies > 0)
      : [];
  } catch {
    return [];
  }
}

const fmt = (v: number | null) => (v === null ? '—' : money(v));

export default function ShopLabelsPage() {
  const { data, error: loadError, isLoading } = useApiQuery(['shop-sale-list'], () => getShopSaleList());
  const styles = useMemo(() => data?.styles ?? [], [data]);
  const byGroup = useMemo(() => new Map(styles.map((s) => [s.groupid, s])), [styles]);

  const [term, setTerm] = useState('');
  const [entries, setEntriesState] = useState<Entry[]>(readStore);
  const [withSale, setWithSale] = useState(false);
  const [startText, setStartText] = useState('1');
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setEntries(next: Entry[]) {
    setEntriesState(next);
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* storage unavailable — just don't remember */ }
  }

  // Every word typed must appear somewhere in the title, brand, groupid or a size code (as Shop Sale).
  const results = useMemo(() => {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return styles.filter((s) => {
      const hay = `${s.title ?? ''} ${s.brand ?? ''} ${s.groupid} ${s.codes}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [styles, term]);

  function add(s: ShopSaleStyle) {
    const at = entries.findIndex((e) => e.groupid === s.groupid);
    if (at >= 0) setEntries(entries.map((e, i) => (i === at ? { ...e, copies: Math.min(e.copies + 1, MAX_COPIES) } : e)));
    else setEntries([...entries, { groupid: s.groupid, copies: 1 }]);
  }
  function setCopies(groupid: string, copies: number) {
    if (!Number.isFinite(copies)) return;
    setEntries(entries.map((e) => (e.groupid === groupid ? { ...e, copies: Math.min(Math.max(Math.floor(copies), 1), MAX_COPIES) } : e)));
  }
  function remove(groupid: string) {
    setEntries(entries.filter((e) => e.groupid !== groupid));
  }

  // One label per copy, in list order. Rows with no usable price (or no longer in the catalogue) print nothing and are flagged.
  const labels = useMemo(() => {
    const out: PrintLabel[] = [];
    for (const e of entries) {
      const s = byGroup.get(e.groupid);
      const l = s ? labelFor(s.groupid, s.rrp, s.price, withSale) : null;
      if (l) for (let i = 0; i < e.copies; i++) out.push(l);
    }
    return out;
  }, [entries, byGroup, withSale]);

  const startNum = Number(startText);
  const startOk = Number.isInteger(startNum) && startNum >= 1 && startNum <= LABELS_PER_SHEET;
  const startAt = startOk ? startNum : 1;
  const sheets = labels.length === 0 ? 0 : Math.ceil((startAt - 1 + labels.length) / LABELS_PER_SHEET);
  const canMake = labels.length > 0 && startOk && !making && !!data;

  async function make() {
    if (!canMake) return;
    setMaking(true);
    setError(null);
    try {
      await downloadLabelPdf(labels, startAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the PDF');
    }
    setMaking(false);
  }

  // The first sheet as it will print: the skipped slots, then the labels.
  const firstSheet: (PrintLabel | 'used' | null)[] = Array.from({ length: LABELS_PER_SHEET }, (_, i) =>
    i < startAt - 1 ? 'used' : labels[i - (startAt - 1)] ?? null);

  return (
    <AppShell title="Shop Labels">
      <div className="grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* ---- Search and add ---- */}
        <section className="space-y-3">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={isLoading ? 'Loading…' : 'Name, brand, groupid or code'}
              className="w-full rounded-lg border border-slate-300 py-3 pl-10 pr-4 text-base focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          {loadError && <p className="text-sm text-red-600">{loadError.message}</p>}

          {results.length > 0 && (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {results.slice(0, MAX_RESULTS).map((s) => (
                <li key={s.groupid}>
                  <button
                    type="button"
                    onClick={() => add(s)}
                    className="flex w-full items-baseline justify-between gap-4 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="min-w-0 text-slate-800">
                      <span className="font-medium">{s.groupid}</span>
                      {s.title && <span className="ml-2 text-slate-500">{s.title}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-slate-600">
                      {fmt(s.rrp)}
                      <PlusIcon className="h-4 w-4 text-slate-400" />
                    </span>
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
        </section>

        {/* ---- The print list ---- */}
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">
              {labels.length} label{labels.length === 1 ? '' : 's'}
              {sheets > 0 && <span className="font-normal text-slate-500"> · {sheets} sheet{sheets === 1 ? '' : 's'}</span>}
            </h2>
            {entries.length > 0 && (
              <button type="button" onClick={() => setEntries([])} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
                Clear all
              </button>
            )}
          </div>

          {entries.length === 0 ? (
            <p className="text-sm text-slate-500">Search for a style and click it to add a label.</p>
          ) : (
            <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Groupid</th>
                  <th className="px-3 py-2 text-right">RRP</th>
                  <th className="px-3 py-2 text-right">Website</th>
                  <th className="px-3 py-2 text-center">Copies</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => {
                  const s = byGroup.get(e.groupid);
                  const l = s ? labelFor(s.groupid, s.rrp, s.price, withSale) : null;
                  return (
                    <tr key={e.groupid}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{e.groupid}</div>
                        {data && !s && <div className="text-xs text-red-600">No longer in the catalogue — not printed</div>}
                        {s && !l && <div className="text-xs text-red-600">No price — not printed</div>}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">{fmt(s?.rrp ?? null)}</td>
                      <td className={`px-3 py-2 text-right ${l?.was != null ? 'font-medium text-slate-900' : 'text-slate-500'}`}>
                        {fmt(s?.price ?? null)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            aria-label="One fewer"
                            disabled={e.copies <= 1}
                            onClick={() => setCopies(e.groupid, e.copies - 1)}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                          >
                            <MinusIcon className="h-4 w-4" />
                          </button>
                          <input
                            inputMode="numeric"
                            value={e.copies}
                            onChange={(ev) => setCopies(e.groupid, Number(ev.target.value))}
                            className="w-12 rounded border border-slate-300 px-1 py-1 text-center focus:border-brand-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            aria-label="One more"
                            onClick={() => setCopies(e.groupid, e.copies + 1)}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100"
                          >
                            <PlusIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" aria-label="Remove" onClick={() => remove(e.groupid)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="flex flex-wrap items-end gap-6">
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">Price</div>
              <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
                {([[false, 'RRP only'], [true, 'RRP + sale']] as const).map(([v, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setWithSale(v)}
                    className={`px-4 py-2 text-sm ${withSale === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="start-at" className="mb-2 block text-sm font-medium text-slate-700">Start at label</label>
              <input
                id="start-at"
                inputMode="numeric"
                value={startText}
                onChange={(e) => setStartText(e.target.value)}
                className={`w-20 rounded-md border px-3 py-2 text-base focus:outline-none focus:ring-1 ${
                  startOk ? 'border-slate-300 focus:border-brand-500 focus:ring-brand-500' : 'border-red-400 focus:ring-red-400'}`}
              />
            </div>
            <div>
              <button
                type="button"
                disabled={!canMake}
                onClick={make}
                className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <PrinterIcon className="h-4 w-4" />
                {making ? 'Making…' : 'Make PDF'}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">Avery L7160. Print at “Actual size”, not “Fit to page”.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* ---- Preview of the first sheet, to scale ---- */}
          {labels.length > 0 && (
            <div
              className="relative w-full max-w-sm border border-slate-300 bg-white shadow-sm"
              style={{ aspectRatio: `${SHEET.pageW} / ${SHEET.pageH}` }}
            >
              {firstSheet.map((slot, i) => {
                const col = i % SHEET.cols;
                const row = Math.floor(i / SHEET.cols);
                const pos = {
                  left: `${((SHEET.left + col * (SHEET.labelW + SHEET.colGap)) / SHEET.pageW) * 100}%`,
                  top: `${((SHEET.top + row * SHEET.labelH) / SHEET.pageH) * 100}%`,
                  width: `${(SHEET.labelW / SHEET.pageW) * 100}%`,
                  height: `${(SHEET.labelH / SHEET.pageH) * 100}%`,
                };
                return (
                  <div
                    key={i}
                    style={pos}
                    className={`absolute flex flex-col items-center justify-center rounded-sm border text-center leading-tight ${
                      slot === 'used' ? 'border-dashed border-slate-200 bg-slate-100' : 'border-slate-200'}`}
                  >
                    {slot && slot !== 'used' && (
                      <>
                        <div className="text-[8px] font-semibold text-slate-700">{slot.groupid}</div>
                        {slot.was !== null && <div className="text-[8px] text-slate-500 line-through">{money(slot.was)}</div>}
                        <div className="text-[12px] font-bold text-slate-900">{money(slot.price)}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
