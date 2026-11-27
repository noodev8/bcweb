'use client';
/*
=======================================================================================================================================
Component: ProspectAmazonSearch — the "Search Amazon" panel on /prospects (owner, 2026-11-27)
=======================================================================================================================================
Purpose: The search the team did by hand on Amazon ("Lunar boots women" → open each page → rank, price, sellers → check the supplier),
         in one list. Server: bcweb-server/routes/prospect-amazon-search.js (Amazon's own API — no scraping).
         Amazon returns SIZES (child ASINs); they are grouped by their PARENT (which can span colours — Lunar St Ives' white, black and
         beige share one, so the size table shows the colour), best rank first (owner: "most importantly
         rank"). RANK = the OVERALL group rank (Fashion), never the sub-category's (owner, 2026-11-27: "Margo boots is 89 in country
         boots and 865k in fashion. Its the fashion listing I need") — it sorts, heads the row and goes into Add. A style row: its best rank, the Buy Box price range, the sellers on its best-ranked size, the DUPLICATE /
         ON THE LIST badges, and — for a Rieker-group code on the Rieker stock list — the supplier style, cost, the sizes in stock and
         the return on cost. Click the row for its sizes. REVIEWS: Amazon's API has none, so "Open" goes to the page to look.
         "Add" opens the usual add form filled in from the best-ranked size (name, ASIN, rank, price, sellers, cost) — nothing is
         saved until Save, so the add form's own duplicate check and Reopen still apply.
         CAN'T GET IS LEFT OUT by the server (Rieker / Remonte listings surely not on the Rieker list — owner, 2026-11-27), so a page
         can come back thin; that is the point ("we are looking for diamonds in rough"). One quiet line says so when it empties a page.
         One page = 20 sizes (Amazon's maximum) — enough (owner, 2026-11-27: "top 20 is enough. the bottom ones are ranking too far
         out"); "More" stays as a quiet link under the list for the odd deeper look.
         No brand box (owner, 2026-11-27: "I just type a search") — the server still takes an optional brand, unused.
         HIDE (owner, 2026-11-27: "I will look at our list and come back to it rather than doing the whole search again") — Hide folds the
         results down to their one header line, Show opens them again as they were (cuts and all). A new search replaces them.
         CUT (owner, 2026-11-27: a Lunar search came back with Clarks on top — "a short cut at least to get them out of my way"): × on a
         row takes it off THIS search, like the list's ×. Nothing saved, no count, no undo (owner: "a refresh is enough") — a new search
         or a page refresh brings every row back.
         Fetched on the Search / More click (an event, not an effect).
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { ArrowTopRightOnSquareIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { AmazonSearchItem, AmazonSearchPage, searchAmazonProspects, SupplierStyle } from '@/lib/api';

export interface ProspectPrefill {
  name: string; asin: string; rank: string; price: string; sellers: string; size: string; cost: string;
}

const inputCls = 'rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';
const smallBtn = 'rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const primaryBtn = 'rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50';

const SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];
const money = (n: number | null) => (n === null ? '' : `£${n.toFixed(2)}`);
const fmtRank = (n: number) => n.toLocaleString('en-GB');
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const sellers = (i: AmazonSearchItem) => (i.fba === null ? '' : `${i.fba} FBA · ${i.fbm} FBM`);

interface Group {
  key: string;               // the parent ASIN, or the size's own when it has none
  sizes: AmazonSearchItem[]; // best rank first
  best: AmazonSearchItem;    // the best-ranked size — the row speaks for it
}

function groupItems(items: AmazonSearchItem[]): Group[] {
  const by = new Map<string, AmazonSearchItem[]>();
  for (const i of items) {
    const k = i.parent || i.asin;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(i);
  }
  const rankOf = (i: AmazonSearchItem) => i.group_rank?.rank ?? Number.MAX_SAFE_INTEGER;
  return [...by].map(([key, sizes]) => {
    const sorted = [...sizes].sort((a, b) => rankOf(a) - rankOf(b));
    return { key, sizes: sorted, best: sorted[0] };
  }).sort((a, b) => rankOf(a.best) - rankOf(b.best));
}

export default function ProspectAmazonSearch({ onAdd }: { onAdd: (p: ProspectPrefill) => void }) {
  const [q, setQ] = useState('');
  const [searched, setSearched] = useState<string | null>(null);   // the words of the search on screen
  const [hidden, setHidden] = useState(false);
  const [page, setPage] = useState<AmazonSearchPage | null>(null);
  const [items, setItems] = useState<AmazonSearchItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [cut, setCut] = useState<Set<string>>(() => new Set());   // group keys taken off this search

  async function run(more: boolean) {
    const s = more && searched ? searched : q.trim();
    if (!s) return;
    setBusy(true);
    setError(null);
    const res = await searchAmazonProspects(s, more ? page?.next_token ?? undefined : undefined);
    setBusy(false);
    if (!res.success || !res.data) { setError(res.error || 'Search failed'); return; }
    setSearched(s);
    setPage(res.data);
    // A size can come back on two pages if Amazon's order shifts between calls — keep the first.
    setItems((prev) => {
      const base = more ? prev : [];
      const seen = new Set(base.map((i) => i.asin));
      return [...base, ...res.data!.items.filter((i) => !seen.has(i.asin))];
    });
    if (!more) { setOpenKey(null); setCut(new Set()); setHidden(false); }
  }

  const allGroups = useMemo(() => groupItems(items), [items]);
  const groups = allGroups.filter((g) => !cut.has(g.key));
  // CUT DUPLICATES (owner, 2026-11-27: "a quick option to cut all duplicates") — the rows we already have on Amazon, off this search
  // like a × on each. Only shown while one is on screen (More can bring new ones, and the button back).
  const dupKeys = groups.filter((g) => g.sizes.some((i) => i.have)).map((g) => g.key);
  // A supplier list's date only when a row on screen matched it — a Lunar search saying "Rieker list 27 Nov" read as nonsense
  // (owner, 2026-11-27).
  const matched = new Set(groups.flatMap((g) => g.sizes.flatMap((i) => i.supplier?.styles.map((st) => st.supplier) ?? [])));
  const lists = page ? Object.entries(page.supplier_lists).filter(([sup]) => matched.has(sup)) : [];

  return (
    <div>
      <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); run(false); }}>
        <span className="shrink-0 text-sm font-semibold text-slate-900">Search Amazon</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. lunar boots women"
          className={`${inputCls} min-w-0 flex-1 basis-60`} />
        <button type="submit" disabled={busy || !q.trim()} className={`${primaryBtn} inline-flex shrink-0 items-center gap-1.5`}>
          <MagnifyingGlassIcon className="h-4 w-4" /> {busy && !items.length ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {searched && page && (
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>
              <span className="font-semibold text-slate-900">{groups.length} styles</span> from {items.length} of {page.total.toLocaleString('en-GB')} sizes
              on Amazon for &ldquo;{searched}&rdquo;
            </span>
            {lists.map(([s, d]) => <span key={s} className="text-slate-400">{s[0].toUpperCase() + s.slice(1)} list {fmtDate(d)}</span>)}
            {page.offers_error && <span className="text-amber-700" title={page.offers_error}>Prices and sellers not read this time — ranks only</span>}
            {!hidden && dupKeys.length > 0 && (
              <button type="button" onClick={() => setCut((prev) => new Set([...prev, ...dupKeys]))}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-100">
                Cut duplicates
              </button>
            )}
            <button type="button" onClick={() => setHidden(!hidden)}
              className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900">
              {hidden ? <>Show <ChevronDownIcon className="h-3.5 w-3.5" /></> : <>Hide <ChevronUpIcon className="h-3.5 w-3.5" /></>}
            </button>
          </div>
          {hidden ? null : groups.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500">
              {allGroups.length ? 'Every row cut.' : page.hidden ? 'Nothing here you can get.' : 'Nothing found.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {groups.map((g) => (
                <GroupRow key={g.key} g={g} open={openKey === g.key}
                  onToggle={() => setOpenKey(openKey === g.key ? null : g.key)} onAdd={onAdd}
                  onCut={() => setCut((prev) => new Set(prev).add(g.key))} />
              ))}
            </div>
          )}
          {!hidden && page.next_token && (
            <div className="border-t border-slate-100 px-3 py-1.5 text-right">
              <button type="button" onClick={() => run(true)} disabled={busy}
                className="text-xs text-slate-400 hover:text-slate-700 hover:underline disabled:opacity-50">
                {busy ? 'Loading…' : 'More'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupRow({ g, open, onToggle, onAdd, onCut }: {
  g: Group; open: boolean; onToggle: () => void; onAdd: (p: ProspectPrefill) => void; onCut: () => void;
}) {
  const b = g.best;
  const prices = g.sizes.map((i) => i.buybox ?? i.lowest).filter((n): n is number => n !== null);
  const lo = prices.length ? Math.min(...prices) : null;
  const hi = prices.length ? Math.max(...prices) : null;
  const have = g.sizes.find((i) => i.have)?.have ?? null;
  const listed = g.sizes.find((i) => i.listed)?.listed ?? null;
  const sup = g.sizes.find((i) => i.supplier)?.supplier ?? null;
  const roc = b.return_on_cost ?? g.sizes.find((i) => i.return_on_cost)?.return_on_cost ?? null;

  function add() {
    const price = b.buybox ?? b.lowest;
    const cost = sup && sup.styles.length === 1 ? sup.styles[0].cost : null;
    onAdd({
      name: b.title.slice(0, 200), asin: b.asin,
      rank: b.group_rank ? fmtRank(b.group_rank.rank) : '',
      price: price !== null ? price.toFixed(2) : '', sellers: sellers(b), size: (b.size || '').slice(0, 10),
      cost: cost !== null ? cost.toFixed(2) : '',
    });
  }

  return (
    <div className={open ? 'bg-sky-50/50' : ''}>
      <div className="flex items-start gap-3 px-3 py-2 text-sm">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          {open ? <ChevronDownIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate-900" title={b.title}>{b.title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {b.group_rank ? (
                <span><span className="font-semibold tabular-nums text-slate-800">#{fmtRank(b.group_rank.rank)}</span> {b.group_rank.category}</span>
              ) : <span>No rank</span>}
              {lo !== null && <span className="tabular-nums text-slate-700">{lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`}</span>}
              {b.fba !== null && <span title="Sellers on the best-ranked size">{sellers(b)}</span>}
              {have && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800" title={`We already have it on Amazon as ${have}`}>DUPLICATE</span>}
              {listed && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800" title={`“${listed.name}”`}>
                  {listed.archived ? 'TESTED BEFORE' : 'ON THE LIST'}
                </span>
              )}
            </span>
            {sup && <SupplierLine sup={sup} roc={roc} />}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <a href={`https://www.amazon.co.uk/dp/${b.asin}`} target="_blank" rel="noopener noreferrer" title="Open on Amazon — reviews are there"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Open <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
          </a>
          <button type="button" onClick={add} disabled={!!listed && !listed.archived} className={smallBtn}
            title={listed && !listed.archived ? 'Already on the list' : 'Open the add form filled in from the best-ranked size'}>
            Add
          </button>
          <button type="button" onClick={onCut} title="Cut from this search — a new search brings it back" aria-label={`Cut ${b.title}`}
            className="rounded p-0.5 text-slate-300 hover:bg-slate-200 hover:text-slate-700">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      {open && (
        <table className="mb-2 ml-9 text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-4 font-medium">Size</th>
              <th className="py-1 pr-4 font-medium">Colour</th>
              <th className="py-1 pr-4 text-right font-medium">Rank</th>
              <th className="py-1 pr-4 text-right font-medium">Buy Box</th>
              <th className="py-1 pr-4 font-medium">Sellers</th>
              <th className="py-1 pr-4 font-medium">ASIN</th>
            </tr>
          </thead>
          <tbody>
            {g.sizes.map((i) => (
              <tr key={i.asin} className="border-t border-slate-100 text-slate-700">
                <td className="py-1 pr-4">{i.size || '—'}</td>
                <td className="py-1 pr-4 text-slate-500">{i.colour || ''}</td>
                <td className="py-1 pr-4 text-right tabular-nums">{i.group_rank ? fmtRank(i.group_rank.rank) : '—'}</td>
                <td className="py-1 pr-4 text-right tabular-nums" title={i.buybox === null && i.lowest !== null ? 'No Buy Box — the lowest offer' : undefined}>
                  {i.buybox !== null ? money(i.buybox) : i.lowest !== null ? <span className="text-slate-400">{money(i.lowest)}</span> : '—'}
                </td>
                <td className="py-1 pr-4">{sellers(i)}</td>
                <td className="py-1 pr-4">
                  <a href={`https://www.amazon.co.uk/dp/${i.asin}`} target="_blank" rel="noopener noreferrer" className="font-mono text-slate-500 hover:underline">{i.asin}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// The supplier's side: style, cost, sizes as small dots — black = can get, empty = can't (two states, owner 2026-11-27),
// and the return on cost. "colour?" when the listing's colour couldn't be pinned: every colour of that style on the list is shown.
export function SupplierLine({ sup, roc }: { sup: { colour_sure: boolean; styles: SupplierStyle[] }; roc?: AmazonSearchItem['return_on_cost'] }) {
  return (
    <span className="mt-1 block space-y-0.5 text-xs text-slate-600">
      {sup.styles.map((s) => (
        <span key={s.style} className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium text-slate-800">{s.supplier[0].toUpperCase() + s.supplier.slice(1)} {s.style}</span>
          {!sup.colour_sure && <span className="text-amber-700" title="The listing's colour didn't match one on the list — every colour of this style is shown">colour?</span>}
          {s.cost !== null && <span>cost £{s.cost.toFixed(2)}</span>}
          <span className="inline-flex items-center gap-1" title="Black = can get, empty = can't">
            {SHOE_SIZES.map((z) => (
              <span key={z} className="inline-flex flex-col items-center leading-none">
                <span className={'h-2 w-2 rounded-full border border-slate-900 ' + (s.sizes[z] ? 'bg-slate-900' : 'bg-white')} />
                <span className="mt-0.5 text-[9px] text-slate-400">{z}</span>
              </span>
            ))}
          </span>
          {Object.keys(s.sizes).length === 0 && <span className="text-slate-400">none in stock</span>}
        </span>
      ))}
      {roc && sup.styles.length === 1 && (
        <span className="block font-medium text-slate-800" title={`Keeps £${roc.profit.toFixed(2)} a pair on Amazon at £${roc.price.toFixed(2)} — after VAT, referral, FBA, courier and wages, ÷1.2 for returns`}>
          Keeps £{roc.profit.toFixed(2)} a pair · {roc.on_cost_pct.toFixed(0)}% on cost
        </span>
      )}
    </span>
  );
}
