'use client';
/*
=======================================================================================================================================
Page: /ebay — eBay listings (owner, 2026-11-01: "Start with read only")
=======================================================================================================================================
Purpose: CHECKING — every listing live on eBay right now, read from eBay (GET /ebay-listings → server utils/ebayListings.js), each line
         matched to our code and to the stock we hold, with the checks the server runs (checkLine). READ ONLY: no button here writes to
         eBay or to the DB. The first of three eBay listing builds: Checking (this), then Add with stock kept in step by Update Orders,
         then Remove.

WHAT A ROW SHOWS (kept plain — owner, 2026-11-01: "The screen is too busy"): our CODE first, large — clicking it opens the listing on eBay (no link icon, no separate size — the code carries
it); eBay's title as a TOOLTIP only; the brand in its own column; eBay's price beside our Shopify price; the profit one sale at eBay's price would book (THE EBY formula,
Royal Mail even for FBA — server utils/ebayProfit.js); what eBay has available against our STOCK (column "Stock", was "Can sell") —
ONE number, local sellable + FBA live (owner: "Just show what we can sell"; FBA pairs go on eBay, MCF ships them); sold on this
SOLD 30D — our own eBay sales of the code in the last 30 days, net (owner, 2026-11-01; was eBay's since-listed count), watchers, the postage, and when it renews (Good 'Til Cancelled, monthly). No view counts: eBay only gives them with a permission the login lacks.
FIXED PRICE ONLY (owner, 2026-11-01: "We are going to not use auction ... Fixed price only"): the server leaves auctions out and counts
them; the screen says how many, to be dealt with by hand in Seller Hub.
A variation listing (one listing per style, sizes inside — the planned Add) is one row with its sizes underneath on a click.

DUD SIZES (owner, 2026-11-01: "a lower price for that size", "by hand to start", 90 days): a BCWEB listing (made by the List button)
always opens, even with one size, into the SIZES PANEL — per size: stock, Sold 30d, last net sale, IDLE days (the Slow movers measure,
server utils/onShelf.js; 90+ tinted amber), its eBay price, a price box with the profit beside it, and Set (POST /ebay-size-price —
price only, eBay only; Shopify stays per style). The "Slow sizes (90d+)" filter shows the BCWEB listings with such a size.

THE CHECKS — the server's codes, worded here (FLAG below). NO CHECKS COLUMN (owner, 2026-11-01: "save the space for OK 99% of the
time"): a listing that needs a look gets a warning icon after its code (hover = what's wrong) and a tinted row; a clean row shows nothing.
  red    Not in BCWEB · Birkenstock · more on eBay than our stock (stock isn't kept in step yet — a Shopify sale leaves eBay's count;
         the On eBay number turns red too)
  amber  size in stock not on eBay (a BCWEB listing — added at the next Update Orders; one that stays was skipped: no UK size /
         barcode, or its UK size is taken) · postage isn't £4.50 — the rule is £4.50 Tracked 48 on every listing, like Shopify (owner, 2026-11-01; was free postage, so
         the trial's fixed-price listings show it until they are re-listed through Add)
  info   sold out / we can sell more — NOT shown: the On eBay and Stock numbers already say it
"Needs a look" = any red or amber; those listings sort first, and the Needs a look filter shows only them.

TWO VIEWS (Add build step 1, 2026-11-01): On eBay (this file — Checking) | Not on eBay (NotOnEbay.tsx — styles that could be listed,
with a readiness check). ?view=not opens the second; the switch itself doesn't touch the URL. Each view fetches only when shown.

REFRESH, LIKE FAST SELLERS: each load is a live eBay call, so the list changes only when Refresh is pressed (or the page is opened) —
SWR's own refetches are off for this key. The time of the read shows beside the button.
=======================================================================================================================================
*/

import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowPathIcon, ChevronRightIcon, ExclamationTriangleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useUrlParam } from '@/lib/useUrlParam';
import NotOnEbay from './NotOnEbay';
import { mutate } from 'swr';
import { useApiQuery } from '@/lib/useApiQuery';
import { endEbayListing, getEbayListings, getEbayProfitPreview, setEbaySizePrice, type EbayFlag, type EbayListing, type EbayListingLine } from '@/lib/api';

const NO_LISTINGS: EbayListing[] = [];

type Level = 'problem' | 'check' | 'info';
const FLAG: Record<EbayFlag, { label: string; level: Level; title: string }> = {
  unknown: { label: 'Not in BCWEB', level: 'problem', title: 'The listing’s SKU (Custom label) is blank or not one of our codes — a sale of it would never reach our orders.' },
  birkenstock: { label: 'Birkenstock', level: 'problem', title: 'Birkenstock must never be on eBay (distribution rules and VeRO).' },
  oversell: { label: 'More on eBay than in stock', level: 'problem', title: 'eBay could sell a pair we haven’t got. Stock isn’t kept in step with eBay yet — end the listing or lower its quantity in Seller Hub.' },
  size_not_listed: { label: 'Size in stock not on eBay', level: 'check', title: 'It is added to this listing at the next Update Orders. If this stays, the size was skipped — it has no UK size or barcode in BCWEB, or its UK size is already on the listing.' },
  postage_rule: { label: 'Postage isn’t £4.50', level: 'check', title: 'The rule is £4.50 Tracked 48 on every listing, like Shopify — the trial’s fixed-price listings are free postage until they are re-listed through Add.' },
  sold_out: { label: 'Sold out — hidden', level: 'info', title: 'eBay shows 0 available. The listing stays live but hidden until stock is added.' },
  more_held: { label: 'More in stock', level: 'info', title: 'We have more in stock than this listing offers — fine if on purpose.' },
};
const needsLook = (flags: EbayFlag[]) => flags.some((f) => FLAG[f]?.level === 'problem' || FLAG[f]?.level === 'check');

// eBay's postage service codes, as the team says them. Anything else shows its code.
const SERVICE: Record<string, string> = {
  UK_RoyalMailTracked: 'Tracked 48',
  UK_RoyalMailNextDay: 'Tracked 24',
  UK_RoyalMail48: 'RM 48',
  UK_RoyalMail24: 'RM 24',
  UK_RoyalMailSecondClassStandard: '2nd class',
  UK_RoyalMailFirstClassStandard: '1st class',
  UK_CollectInPerson: 'Collection',
};

type Filter = 'all' | 'look' | 'slow';

// A size is SLOW (a dud to consider pricing down) at this many idle days — THE Slow movers measure, from the server (owner, 2026-11-01).
const SLOW_DAYS = 90;
const isSlow = (x: EbayListingLine) => x.idle_days !== null && x.idle_days >= SLOW_DAYS;
const slowCount = (l: EbayListing) => (l.bcweb ? l.lines.filter(isSlow).length : 0);

function money(v: number | null | undefined) {
  return v === null || v === undefined ? '—' : `£${v.toFixed(2)}`;
}
function signedMoney(v: number | null) {
  if (v === null) return '—';
  return v < 0 ? `−£${Math.abs(v).toFixed(2)}` : `£${v.toFixed(2)}`;
}
function londonTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}
function londonDay(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}

type View = 'on' | 'not';

export default function EbayListingsPage() {
  // ?view=not opens Not on eBay; undefined = no click yet, so the URL decides (as the dashboard's ?g=).
  const urlView = useUrlParam('view') === 'not' ? 'not' : 'on';
  const [chosen, setChosen] = useState<View | undefined>(undefined);
  const view = chosen ?? urlView;

  return (
    <AppShell title="eBay listings">
      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1" role="tablist">
        {([['on', 'On eBay'], ['not', 'Not on eBay']] as [View, string][]).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view === k}
            onClick={() => setChosen(k)}
            className={'rounded-md px-4 py-1.5 text-sm font-medium transition ' + (view === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'on' ? <OnEbay /> : <NotOnEbay />}
    </AppShell>
  );
}

function OnEbay() {
  // Manual only — see REFRESH in the header.
  const { data, error, isLoading, busy, refresh } = useApiQuery(['ebay-listings'], () => getEbayListings(), {
    revalidateIfStale: false, revalidateOnReconnect: false,
  });
  const listings = data?.listings ?? NO_LISTINGS;

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);   // the variation listing whose sizes are showing

  const counts = useMemo(() => ({
    all: listings.length,
    look: listings.filter((l) => needsLook(l.flags)).length,
    slow: listings.filter((l) => slowCount(l) > 0).length,
  }), [listings]);

  const visible = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return listings.filter((l) => {
      if (filter === 'look' && !needsLook(l.flags)) return false;
      if (filter === 'slow' && slowCount(l) === 0) return false;
      if (terms.length === 0) return true;
      const hay = `${l.title} ${l.item_id} ${l.lines.map((x) => `${x.sku || ''} ${x.brand || ''}`).join(' ')}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [listings, filter, search]);

  const s = data?.summary;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => refresh()}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowPathIcon className={'h-4 w-4 ' + (busy ? 'animate-spin' : '')} />
          {busy ? 'Reading eBay…' : 'Refresh'}
        </button>
        <p className="text-sm text-slate-500">
          {data ? <>Live on eBay, read at {londonTime(data.read_at)}. Checked against our stock (local + FBA).</> : 'Live on eBay, checked against our stock (local + FBA).'}
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Reading eBay…</p>}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>}
      {data?.truncated && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">eBay had more listings than one read takes — some aren’t shown.</div>
      )}

      {data && s && (
        <>
          {/* The figures: what's live, and how much needs a look. */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label="Live listings" value={s.listings} sub={s.skipped > 0 ? `fixed price · ${s.skipped} auction${s.skipped === 1 ? '' : 's'} not shown (Seller Hub)` : 'fixed price'} />
            <Figure label="Needs a look" value={s.problems + s.checks} sub={`${s.problems} problem${s.problems === 1 ? '' : 's'} · ${s.checks} postage`} tone={s.problems > 0 ? 'red' : s.checks > 0 ? 'amber' : undefined} />
            <Figure label="Watchers" value={s.watchers} sub="across all listings" />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {([['all', 'All'], ['look', 'Needs a look'], ['slow', `Slow sizes (${SLOW_DAYS}d+)`]] as [Filter, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                className={'rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition ' +
                  (filter === k ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50')}
              >
                {label} <span className={'tabular-nums ' + (filter === k ? 'text-white/80' : 'text-slate-400')}>{counts[k]}</span>
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-64">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2 h-5 w-5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, code or brand"
                className="w-full rounded-md border border-slate-300 py-1.5 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* ONE SCROLL BAR — the page's (owner, 2026-11-01: "I dont like the double scroll bar"). No inner scroll box: the headings
              stick to the top of the window instead. overflow-x-clip, not overflow-auto, because a scroll container would stop the
              sticky headings; below md the box scrolls sideways so the columns still fit a phone. */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:overflow-x-clip">
            {visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                {listings.length === 0 ? 'Nothing is live on eBay.' : filter === 'look' ? 'Nothing needs a look.' : filter === 'slow' ? `No size on a BCWEB listing has sat ${SLOW_DAYS} days or more.` : 'No listing matches.'}
              </p>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <Th className="pl-3 text-left" title="Our code — click it to open the listing on eBay; hover for eBay's title">Code</Th>
                    <Th className="text-left">Brand</Th>
                    <Th className="text-right" title="eBay's price">eBay</Th>
                    <Th className="text-right" title="Our Shopify price for the style">Shopify</Th>
                    <Th className="text-right" title="Profit on one sale at eBay's price (EBY formula — Royal Mail, fees ex VAT).">Profit</Th>
                    <Th className="text-center" title="Available on eBay now">On eBay</Th>
                    <Th className="text-center" title="Our stock: local + FBA live">Stock</Th>
                    <Th className="text-center" title="Our eBay sales in the last 30 days (net)">Sold 30d</Th>
                    <Th className="text-center">Watch</Th>
                    <Th className="text-left">Postage</Th>
                    <Th className="pr-3 text-left" title="Good 'Til Cancelled listings renew monthly">Renews</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l) => {
                    const multi = l.lines.length > 1;
                    // A BCWEB listing always opens (its sizes can be priced one by one); another listing opens only when it has sizes.
                    const opens = multi || l.bcweb;
                    const isOpen = open === l.item_id;
                    return (
                      <Fragment key={l.item_id}>
                        <ListingRow listing={l} multi={multi} opens={opens} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : l.item_id)} />
                        {isOpen && l.bcweb && (
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <td colSpan={11} className="px-4 pb-4 pt-1"><SizesPanel listing={l} /></td>
                          </tr>
                        )}
                        {isOpen && !l.bcweb && multi && l.lines.map((x, i) => <SizeRow key={x.sku || i} line={x} />)}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: 'red' | 'amber' }) {
  const valueClass = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={'text-2xl font-semibold tabular-nums ' + valueClass}>{value}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  );
}

// Sticky heading cell — sticks to the top of the window as the page scrolls.
function Th({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <th title={title} className={'sticky top-0 z-10 whitespace-nowrap bg-slate-50 px-2 py-1.5 font-medium shadow-[inset_0_-1px_0_rgb(226_232_240)] ' + className}>
      {children}
    </th>
  );
}

// What's wrong, as ONE icon after the code: red for a problem, amber for the postage check; hover lists them. Nothing when clean.
function issueLevel(flags: EbayFlag[]): 'problem' | 'check' | null {
  if (flags.some((f) => FLAG[f]?.level === 'problem')) return 'problem';
  if (flags.some((f) => FLAG[f]?.level === 'check')) return 'check';
  return null;
}
function Issue({ flags, notListed = [] }: { flags: EbayFlag[]; notListed?: string[] }) {
  const level = issueLevel(flags);
  if (!level) return null;
  const shown = flags.filter((f) => FLAG[f] && FLAG[f].level !== 'info');
  const text = shown.map((f) => `${FLAG[f].label}${f === 'size_not_listed' && notListed.length ? ` (${notListed.join(', ')})` : ''} — ${FLAG[f].title}`).join('\n');
  return (
    <span title={text} aria-label={shown.map((f) => FLAG[f].label).join(', ')} className="inline-flex cursor-help">
      <ExclamationTriangleIcon className={'h-4 w-4 ' + (level === 'problem' ? 'text-red-600' : 'text-amber-500')} />
    </span>
  );
}

function priceRange(values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null);
  if (v.length === 0) return '—';
  const lo = Math.min(...v), hi = Math.max(...v);
  return lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
}

function ListingRow({ listing: l, multi, opens, isOpen, onToggle }: { listing: EbayListing; multi: boolean; opens: boolean; isOpen: boolean; onToggle: () => void }) {
  const one = l.lines[0] as EbayListingLine | undefined;
  const level = issueLevel(l.flags);
  const oversell = l.flags.includes('oversell');
  const sum = (k: 'ebay_available' | 'sold_30d' | 'local' | 'fba') => l.lines.reduce((a, x) => a + (x[k] || 0), 0);
  const groupid = one?.groupid || null;
  const codeLabel = multi ? (groupid || `${l.lines.length} sizes`) : (one?.sku || 'no SKU');
  const service = l.postage.service ? (SERVICE[l.postage.service] || l.postage.service) : '—';
  const postageTitle = [l.postage.policy, l.postage.dispatch_days !== null ? `Dispatch ${l.postage.dispatch_days} day${l.postage.dispatch_days === 1 ? '' : 's'}` : null,
    l.returns.within ? `Returns ${l.returns.within}, ${(l.returns.paid_by || '').toLowerCase()} pays` : null].filter(Boolean).join(' · ');
  const profit = multi ? null : one?.profit ?? null;

  return (
    <tr
      onClick={opens ? onToggle : undefined}
      aria-expanded={opens ? isOpen : undefined}
      className={'border-b border-slate-100 align-top ' + (opens ? 'cursor-pointer hover:bg-slate-50 ' : '') + (level === 'problem' ? 'bg-red-50/50' : level === 'check' ? 'bg-amber-50/50' : '')}
    >
      {/* CODE FIRST, eBay's title as a tooltip (owner, 2026-11-01: "Lead with CODE instead of TITLE", "Use a tooltip for the title"). */}
      <td className="whitespace-nowrap py-2 pl-3 pr-2" title={`${l.title} — click the code to open it on eBay`}>
        <div className="flex items-center gap-1.5">
          {opens && <ChevronRightIcon className={'h-4 w-4 shrink-0 text-slate-400 transition-transform ' + (isOpen ? 'rotate-90' : '')} />}
          {/* The CODE is the link (owner, 2026-11-01: "dont have the link sign against the code (we will click the code)") — it opens
              the listing on eBay; the title is its tooltip. */}
          {l.url ? (
            <a href={l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className={'font-mono text-[15px] font-semibold tracking-tight hover:text-brand-700 hover:underline ' + (groupid ? 'text-slate-900' : 'text-red-700')}>{codeLabel}</a>
          ) : <span className={'font-mono text-[15px] font-semibold tracking-tight ' + (groupid ? 'text-slate-900' : 'text-red-700')}>{codeLabel}</span>}
          <Issue flags={l.flags} notListed={l.not_listed} />
        </div>
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-slate-600">{one?.brand || '—'}</td>
      <td className="whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums text-slate-800">{priceRange(l.lines.map((x) => x.ebay_price))}</td>
      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-500">{multi ? '' : money(one?.shopify_price)}</td>
      <td className={'whitespace-nowrap px-2 py-2 text-right tabular-nums ' + (profit !== null && profit < 0 ? 'text-red-600' : 'text-slate-700')}>{multi ? '' : signedMoney(profit)}</td>
      <td className={'px-2 py-2 text-center font-medium tabular-nums ' + (oversell ? 'text-red-600' : '')}>{sum('ebay_available')}</td>
      <td className="px-2 py-2 text-center tabular-nums">{sum('local') + sum('fba')}</td>
      <td className="px-2 py-2 text-center tabular-nums">{sum('sold_30d') || <span className="text-slate-300">·</span>}</td>
      <td className="px-2 py-2 text-center tabular-nums">{l.watchers || <span className="text-slate-300">·</span>}</td>
      <td className="whitespace-nowrap px-2 py-2" title={postageTitle}>
        <span className={l.postage.free ? 'text-emerald-700' : 'text-slate-700'}>{l.postage.free ? 'Free' : money(l.postage.cost)}</span>
        <span className="text-slate-500"> · {service}</span>
      </td>
      <td className="whitespace-nowrap py-2 pl-2 pr-3">
        {l.ends ? <span className="text-slate-600">{londonDay(l.ends)}</span> : '—'}
      </td>
    </tr>
  );
}

// One size of a variation listing, under its listing row.
function SizeRow({ line: x }: { line: EbayListingLine }) {
  return (
    <tr className="border-b border-slate-100 bg-slate-50/60 text-[13px]">
      <td className="py-1.5 pl-10 pr-2">
        <span className="inline-block min-w-[2.75rem] rounded bg-white px-2 py-0.5 text-center font-mono text-xs font-medium text-slate-700 ring-1 ring-slate-200">{x.size || '—'}</span>
        <span className="ml-2 font-mono text-xs text-slate-500">{x.sku || 'no SKU'}</span>
        <span className="ml-1.5 align-middle"><Issue flags={x.flags} /></span>
      </td>
      <td />
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{money(x.ebay_price)}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-500">{money(x.shopify_price)}</td>
      <td className={'whitespace-nowrap px-2 py-1.5 text-right tabular-nums ' + (x.profit !== null && x.profit < 0 ? 'text-red-600' : 'text-slate-700')}>{signedMoney(x.profit)}</td>
      <td className={'px-2 py-1.5 text-center tabular-nums ' + (x.flags.includes('oversell') ? 'font-medium text-red-600' : '')}>{x.ebay_available}</td>
      <td className="px-2 py-1.5 text-center tabular-nums">{x.local + x.fba}</td>
      <td className="px-2 py-1.5 text-center tabular-nums">{x.sold_30d || <span className="text-slate-300">·</span>}</td>
      <td colSpan={3} />
    </tr>
  );
}

// =====================================================================================================================================
// THE SIZES PANEL of a BCWEB listing — dud sizes priced one by one (owner, 2026-11-01: "a lower price for that size", "by hand to
// start", highlight 90 days). Each size: stock, our eBay sales in 30 days, last NET sale (any channel), IDLE DAYS (the Slow movers
// measure — server utils/onShelf.js), its eBay price and the profit at it, and a price box. Sizes idle SLOW_DAYS+ are tinted amber.
// Set sends that size's price to eBay at once (POST /ebay-size-price — price only, the stock sync's quantity is untouched) and shows
// it here until the next Refresh reads it back from eBay. Shopify's price is per style and is not touched.
// =====================================================================================================================================
function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function SizesPanel({ listing: l }: { listing: EbayListing }) {
  const [ended, setEnded] = useState<string | null>(null);   // the message once ended here
  if (ended) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
        <span className="font-medium text-emerald-700">{ended}</span> Press Refresh to update the list — the style is back on Not on eBay.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-3">
      <table className="min-w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="py-1.5 pr-3 text-left font-medium">Size</th>
            <th className="py-1.5 pr-3 text-left font-medium">Code</th>
            <th className="py-1.5 pr-3 text-center font-medium" title="Our stock: local + FBA live">Stock</th>
            <th className="py-1.5 pr-3 text-center font-medium" title="Our eBay sales in the last 30 days (net)">Sold 30d</th>
            <th className="py-1.5 pr-3 text-left font-medium" title="Last net sale, any channel">Last sold</th>
            <th className="py-1.5 pr-3 text-right font-medium" title={`Days since the later of the last sale and the oldest pair held arriving (as Slow movers). ${SLOW_DAYS}+ is highlighted.`}>Idle</th>
            <th className="py-1.5 pr-3 text-right font-medium">eBay price</th>
            <th className="py-1.5 text-left font-medium">New price</th>
          </tr>
        </thead>
        <tbody>
          {l.lines.map((x) => <SizePriceRow key={x.sku || x.size} line={x} />)}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400">A size&apos;s price changes on eBay only — Shopify stays per style. Set it back to the listing price to undo.</p>
        <EndListing listing={l} onEnded={setEnded} />
      </div>
    </div>
  );
}

function SizePriceRow({ line: x }: { line: EbayListingLine }) {
  const [now, setNow] = useState<number | null>(x.ebay_price);         // eBay's price, or the one just set here
  const [text, setText] = useState(x.ebay_price !== null ? x.ebay_price.toFixed(2) : '');
  const [previewPrice, setPreviewPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const price = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(price) && price > 0;
  const changed = valid && (now === null || Math.abs(price - now) >= 0.005);
  const slow = isSlow(x);

  // Profit at the typed price — the server's formula (with the buyer's £4.50 postage); eBay's figure while nothing is typed.
  const preview = useApiQuery(
    previewPrice !== null && x.groupid ? ['ebay-profit', x.groupid, previewPrice] : null,
    () => getEbayProfitPreview(x.groupid as string, previewPrice as number),
  );
  const profit = previewPrice !== null ? (preview.data ?? null) : x.profit;

  function onType(v: string) {
    setText(v);
    setMsg(null);
    if (timer.current) clearTimeout(timer.current);
    const n = Number(v);
    timer.current = setTimeout(() => setPreviewPrice(v.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null), 400);
  }

  async function set() {
    if (!x.sku || !changed) return;
    setBusy(true);
    setMsg(null);
    const res = await setEbaySizePrice(x.sku, Math.round(price * 100) / 100);
    setBusy(false);
    if (res.success && res.data) {
      setNow(res.data.new_price);
      setText(res.data.new_price.toFixed(2));
      setMsg({ ok: true, text: 'Set on eBay' });
      return;
    }
    setMsg({ ok: false, text: res.error || 'Could not set the price' });
  }

  return (
    <tr className={'border-b border-slate-100 last:border-0 ' + (slow ? 'bg-amber-50' : '')}>
      <td className="py-1.5 pr-3">
        <span className="inline-block min-w-[2.75rem] rounded bg-slate-100 px-2 py-0.5 text-center font-mono text-xs font-medium text-slate-700">{x.size || '—'}</span>
      </td>
      <td className="py-1.5 pr-3 font-mono text-xs text-slate-500">{x.sku || 'no SKU'}</td>
      <td className="py-1.5 pr-3 text-center tabular-nums">{x.local + x.fba}</td>
      <td className="py-1.5 pr-3 text-center tabular-nums">{x.sold_30d || <span className="text-slate-300">·</span>}</td>
      <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">{x.last_sale ? shortDate(x.last_sale) : <span className="text-slate-400">never</span>}</td>
      <td className={'whitespace-nowrap py-1.5 pr-3 text-right tabular-nums ' + (slow ? 'font-semibold text-amber-700' : 'text-slate-600')}>
        {x.idle_days === null ? <span className="text-slate-300">·</span> : `${x.idle_days}d`}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums text-slate-800">
        {money(now)}
        {x.own_price !== null && now === x.own_price && <span className="ml-1 text-[10px] font-medium uppercase text-amber-700" title="This size has its own price">own</span>}
      </td>
      <td className="whitespace-nowrap py-1.5">
        <div className="flex items-center gap-2">
          <input inputMode="decimal" value={text} onChange={(e) => onType(e.target.value)} disabled={!x.sku}
            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          <button type="button" onClick={set} disabled={!changed || busy}
            className="h-8 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40">
            {busy ? 'Setting…' : 'Set'}
          </button>
          <span className={'text-xs tabular-nums ' + (profit !== null && profit < 0 ? 'text-red-600' : 'text-slate-500')} title="Profit on one sale at this price, with the buyer's £4.50 postage">
            {valid ? (preview.busy && previewPrice !== null ? '…' : `profit ${signedMoney(profit)}`) : ''}
          </span>
          {msg && <span className={'text-xs ' + (msg.ok ? 'text-emerald-700' : 'text-red-700')}>{msg.text}</span>}
        </div>
      </td>
    </tr>
  );
}

// REMOVE (owner, 2026-11-01): end the whole BCWEB listing — POST /ebay-end. One inline confirm (no browser dialog). The style shows on
// Not on eBay again and can be re-listed (a new eBay listing number). No stock moves; orders already placed are not affected.
function EndListing({ listing: l, onEnded }: { listing: EbayListing; onEnded: (msg: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const code = l.lines[0]?.groupid || l.item_id;

  async function end() {
    setBusy(true);
    setErr(null);
    const res = await endEbayListing(l.item_id);
    setBusy(false);
    if (res.success && res.data) {
      // Not on eBay reads eBay only on Refresh; drop its cached read so the style shows there when it's next opened.
      mutate(['ebay-candidates'], undefined, { revalidate: false });
      onEnded(res.data.already_ended ? `${code} had already ended on eBay — recorded.` : `${code} ended on eBay.`);
      return;
    }
    setConfirming(false);
    setErr(res.error || 'Could not end the listing');
  }

  if (!confirming) {
    return (
      <div className="flex items-center gap-2">
        {err && <span className="text-xs text-red-700">{err}</span>}
        <button type="button" onClick={() => setConfirming(true)}
          className="h-8 rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50">
          End listing
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 ring-1 ring-red-200">
      <span>End <strong className="font-mono">{code}</strong> on eBay? It comes off eBay now; you can list it again from Not on eBay.</span>
      <button type="button" disabled={busy} onClick={end}
        className="h-8 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
        {busy ? 'Ending…' : 'Yes, end it'}
      </button>
      <button type="button" disabled={busy} onClick={() => setConfirming(false)}
        className="h-8 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        Cancel
      </button>
    </div>
  );
}
