'use client';
/*
=======================================================================================================================================
Page: /amz/buybox  (Pricing — Buy Box)
=======================================================================================================================================
Purpose: Who holds the Buy Box on each of our Amazon sizes, and what to do about it (owner, 2026-11-12; docs/amz-buybox/PLAN.md).
         Server routes/amz-buybox.js (READ ONLY) + amz-buybox-read.js; THE rules are utils/amzBuyBox.js.

WHAT YOU SEE IS THE DATABASE (owner, 2026-11-12: "is the screen just a result of what we have in our database anyway?" — yes). Opening
         the screen never asks Amazon: it shows the last stored reading and says how old it is. The cron reads the whole list every hour
         (owner, 2026-11-12: "It runs every hour. Not sure I need to manually run it?" — Read all now and the "by cron" wording were
         taken off); the one button is Read this style, on an open row (seconds — after a price change). New / sold-out sizes need nothing: each read takes the sizes in FBA stock at the time.

THE GROUPS (one size, one group — classify in utils/amzBuyBox.js; worked out from the stored reading + today's cost):
         Losing, can match · Winning, room to go up · Losing, can't match · No Buy Box · Winning, at the top · Alone.
         The Buy Box price includes postage. "Kept" = our profit a pair at the Buy Box price; "Walk-away" = the £3-a-pair price.
         Amazon's own "expected winning price" is SHOWN, NEVER a target (the probe found it £5+ under prices we already win at).
         "Room to go up" is measured to the next rival above us — a guess until the history shows how far up the Buy Box holds.

CLEAR (owner, 2026-11-12): no size ever drops off by itself — "it takes away the fact that I can see our position on the screen
         without having to act". The × clears a row while working (this visit only, nothing stored; counts unchanged; Show all brings
         them back). And NO review dates on this screen: with an hourly reading, waiting 3–30 days to act on a lost Buy Box makes no
         sense (owner: "if we are updating EVERY hour, what is the point of not acting for a possible 3, 7 or 30 days?").

READ ONLY for now: no Match / Raise presses yet (PLAN.md step 3, after the owner has watched a few readings). The row links to the
         size's Amazon price screen, where a price can be set as usual.

TAGS (colour restraint — small solid tags, no row tints): "following us" = a rival at our exact price to the penny (a repricer?) ·
         "Amazon" = Amazon Retail sells the size · "set £x" = a price was set AFTER the reading (amz_price_log), so the row is out of
         date for it. Our price is always what AMAZON showed at the read — not amzfeed, which can lag a day (2026-11-12: 40 sizes looked
         "changed" because amzfeed still held the price from before changes Amazon had already taken).
=======================================================================================================================================
*/

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getAmzBuyBox, startAmzBuyBoxRead, type AmzBuyBoxGroup, type AmzBuyBoxHolder, type AmzBuyBoxRow, type AmzBuyBoxRun } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useAuth } from '@/contexts/AuthContext';

// Screen order = the order to work them: what can be won back, then money left on the table, then what to leave.
const GROUPS: { key: AmzBuyBoxGroup; label: string; rule: string; dot: string }[] = [
  { key: 'can_match', label: 'Losing, can match', rule: 'A rival has the Buy Box, and its price still keeps us £3 a pair', dot: 'bg-red-500' },
  { key: 'room', label: 'Winning, room to go up', rule: 'We have it, and the next rival is more than 2% above us — a guess until history shows how far up it holds', dot: 'bg-emerald-500' },
  { key: 'cant_match', label: "Losing, can't match", rule: 'A rival has it under our £3 walk-away price — hold, no race to the bottom', dot: 'bg-slate-400' },
  { key: 'no_bb', label: 'No Buy Box', rule: 'Nobody holds it — Amazon pulled it (often: seen cheaper elsewhere)', dot: 'bg-amber-500' },
  { key: 'top', label: 'Winning, at the top', rule: 'We have it, no room above', dot: 'bg-emerald-700' },
  { key: 'alone', label: 'Alone', rule: 'No other seller on the size — its price is the pricing standard’s job, not the Buy Box', dot: 'bg-sky-500' },
  { key: 'unknown', label: 'No walk-away', rule: 'No cost on the style (no £3 price), or no price to match', dot: 'bg-slate-300' },
  { key: 'error', label: 'Not read', rule: 'Amazon refused the read for this size — hover the row for its reason', dot: 'bg-slate-300' },
];

const HOLDER: Record<AmzBuyBoxHolder, string> = {
  US: 'Us', US_SHARED: 'Us + shared', OTHER_FBA: 'Rival (FBA)', OTHER_MFN: 'Rival (self-post)', AMAZON: 'Amazon', NONE: 'Nobody',
};

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);

// pg timestamptz text ("2026-11-12 00:39:55.13+00") -> ms. A real instant, so Date is right here (not a date-only string).
function toMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const iso = ts.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}
function ago(ms: number | null, now: number): string {
  if (ms === null) return 'never';
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
function clock(ms: number | null): string {
  if (ms === null) return '';
  return new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Tag({ children, title, tone = 'slate' }: { children: React.ReactNode; title: string; tone?: 'slate' | 'amber' | 'red' }) {
  const cls = tone === 'red' ? 'bg-red-100 text-red-700' : tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  return <span title={title} className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

export default function AmzBuyBoxPage() {
  const { logout } = useAuth();
  // The clock for "n min ago" — ticks every 30 s. Taken in state, never during a render (react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // While a read is running (ours, another person's or the cron's) the screen follows its progress every 3 s and picks up the new
  // readings when it ends; otherwise nothing refetches by itself — the readings only change on a read. The server writes the run
  // row BEFORE answering a press, so the refresh straight after it already sees `running`.
  const { data, error: loadError, isLoading, refresh } = useApiQuery(['amz-buybox'], () => getAmzBuyBox(), {
    revalidateIfStale: false, revalidateOnReconnect: false,
    refreshInterval: (d) => (d?.running ? 3000 : 0),
  });
  const running: AmzBuyBoxRun | null = data?.running ?? null;

  const [group, setGroup] = useState<AmzBuyBoxGroup | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // CLEARED rows (owner, 2026-11-12: "no to drop off but yes to being able to clear the screen and focus what I'm working on"): the ×
  // hides a row from the list in THIS visit only — nothing is stored, the group counts stay the true position, and Show all (or
  // reopening the page) brings every row back. The same soft cut as Fast sellers / New Additions.
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());

  const counts = data?.counts;
  // Default group = the first in screen order that has sizes.
  const shown: AmzBuyBoxGroup = group ?? (GROUPS.find((g) => (counts?.[g.key] ?? 0) > 0)?.key ?? 'can_match');

  const rows = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all = data?.rows ?? [];
    const list = all.filter((r) => {
      if (cleared.has(r.code)) return false;
      if (terms.length) {
        const hay = `${r.code} ${r.title || ''} ${r.brand || ''}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      }
      return r.group === shown;
    });
    // Most pairs sold first — where the Buy Box matters most.
    return [...list].sort((a, b) => b.sold30 - a.sold30 || b.total - a.total || a.code.localeCompare(b.code));
  }, [data, shown, search, cleared]);

  async function read(groupid?: string) {
    setMsg(null);
    const res = await startAmzBuyBoxRead(groupid);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success && res.return_code !== 'BUSY') { setMsg(res.error || 'Could not start the read'); return; }
    if (res.return_code === 'BUSY') setMsg('A read is already running — following it.');
    await refresh();
  }

  const lastAllMs = toMs(data?.last_all?.finished_at);
  const lastRun = data?.last_run;
  // Amber only when an hourly read looks missed: over 2 hours old during the hours it runs (UK 9am–8pm). Overnight it is
  // naturally ~14 hours old by morning — no warning for that.
  const ukHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' }).format(now));
  const stale = lastAllMs !== null && now - lastAllMs > 2 * 3600 * 1000 && ukHour >= 9 && ukHour < 20;

  return (
    <AppShell title="Buy Box">
      {/* THE READING LINE — how old the reading on screen is (owner, 2026-11-12: no "by cron", no Read all now — "It runs every hour").
          The whole list is read hourly by the cron; a style can be re-read from its open row. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="text-sm text-slate-700">
          {running ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-brand-700">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              {running.scope && running.scope !== 'all'
                ? <>Reading {running.scope}…</>
                : <>Reading Amazon… {running.done ?? 0} of {running.total} sizes</>}
            </span>
          ) : data?.last_all ? (
            <span title={`${clock(lastAllMs)} — read every hour`}>
              Read <span className={stale ? 'font-medium text-amber-700' : 'font-medium text-slate-900'}>{ago(lastAllMs, now)}</span>
              <span className="text-slate-500"> · {data.last_all.total} sizes</span>
              {stale && <span className="text-amber-700"> — the hourly read may have stopped</span>}
            </span>
          ) : (
            <span className="text-slate-500">No reading yet — the hourly read fills this in.</span>
          )}
          {lastRun && lastRun.status === 'error' && !running && (
            <span className="ml-2 text-red-600" title={lastRun.error || ''}>Last read failed: {lastRun.error}</span>
          )}
        </div>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {loadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}

      {data && (
        <>
          {/* THE GROUPS — the count is the job. */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {GROUPS.filter((g) => !['unknown', 'error'].includes(g.key) || (counts?.[g.key] ?? 0) > 0).map((g) => {
              const n = counts?.[g.key] ?? 0;
              const on = !search && shown === g.key;
              return (
                <button key={g.key} type="button" onClick={() => { setGroup(g.key); setSearch(''); setOpen(null); }} title={g.rule}
                  className={'rounded-lg border px-3 py-2 text-left shadow-sm ' + (on ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50')}>
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className={`inline-block h-2 w-2 rounded-full ${g.dot}`} /> {g.label}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums text-slate-900">{n}</div>
                </button>
              );
            })}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search every group — name, brand or SKU"
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <p className="text-sm text-slate-500">
              {search ? `${rows.length} sizes match, across all groups.` : GROUPS.find((g) => g.key === shown)?.rule}
            </p>
            {cleared.size > 0 && (
              <span className="text-sm text-slate-500">
                {cleared.size} cleared ·{' '}
                <button type="button" onClick={() => setCleared(new Set())} className="font-medium text-brand-700 hover:underline">Show all</button>
              </span>
            )}
          </div>

          {/* ONE SCROLLBAR (owner, 2026-11-12: "avoid double vertical scrollbars"): the table scrolls with the page — no inner scroll box
              — so its sticky headings stick to the top of the window. No overflow on this box or any parent, or the sticky th stops
              working (a scroll container captures it). */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  {[
                    ['Size', 'Our SKU — hover for the name', 'left'],
                    ['Brand', 'The style’s brand', 'left'],
                    ['FBA', 'Sellable at FBA now, + on its way in', 'right'],
                    ['Sold 30d', 'Net pairs sold on Amazon, last 30 days', 'right'],
                    ['Weeks left', 'Stock ÷ the last 30 days’ pace', 'right'],
                    ['Our price', 'Our price at the read, postage included', 'right'],
                    ['Buy Box', 'Who holds it, at what price (postage included)', 'left'],
                    ['Rivals', 'Other offers on the size', 'right'],
                    ['Kept', 'Our profit a pair if we matched the Buy Box price', 'right'],
                    ['Walk-away', 'The price that keeps £3 a pair — never go under it', 'right'],
                    ['Next above', 'The cheapest rival priced above us', 'right'],
                    ['Amazon exp.', 'Amazon’s “expected winning price” — shown only, never a target', 'right'],
                  ].map(([l, t, a]) => (
                    <th key={l} title={t} className={`sticky top-0 z-10 whitespace-nowrap bg-slate-50 px-2 py-1.5 font-medium shadow-[inset_0_-1px_0_rgb(226_232_240)] ${a === 'right' ? 'text-right' : 'text-left'} ${l === 'Size' ? 'pl-3' : ''}`}>{l}</th>
                  ))}
                  <th className="sticky top-0 z-10 w-8 bg-slate-50 shadow-[inset_0_-1px_0_rgb(226_232_240)]" aria-label="Clear" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-400">{search ? 'Nothing matches.' : cleared.size ? 'Nothing left here — Show all brings the cleared rows back.' : 'No sizes in this group.'}</td></tr>
                )}
                {rows.map((r) => (
                  <BuyBoxRow key={r.code} r={r} isOpen={open === r.code} showGroup={!!search}
                    onToggle={() => setOpen(open === r.code ? null : r.code)} onReadStyle={() => r.groupid && read(r.groupid)} busy={!!running}
                    onClear={() => { setCleared((prev) => new Set(prev).add(r.code)); if (open === r.code) setOpen(null); }} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}

function BuyBoxRow({ r, isOpen, showGroup, onToggle, onReadStyle, onClear, busy }: {
  r: AmzBuyBoxRow; isOpen: boolean; showGroup: boolean; onToggle: () => void; onReadStyle: () => void; onClear: () => void; busy: boolean;
}) {
  const us = r.holder === 'US' || r.holder === 'US_SHARED';
  // A price set AFTER this reading — the Buy Box columns are from before it, so Read this style to see where it stands now.
  const setSince = r.set_since !== null && (r.our_price === null || Math.abs(r.set_since - r.our_price) >= 0.005) ? r.set_since : null;
  const g = GROUPS.find((x) => x.key === r.group);
  return (
    <Fragment>
      <tr onClick={onToggle} title={r.error || undefined} className={'cursor-pointer ' + (isOpen ? 'bg-brand-50' : 'hover:bg-slate-50')}>
        <td className="whitespace-nowrap py-1.5 pl-3 pr-2 font-mono text-xs text-slate-700">
          <span className="inline-flex items-center gap-1">
            {isOpen ? <ChevronDownIcon className="h-3 w-3 text-slate-400" /> : <ChevronRightIcon className="h-3 w-3 text-slate-400" />}
            {showGroup && g && <span title={g.label} className={`inline-block h-2 w-2 rounded-full ${g.dot}`} />}
            <span title={r.title || undefined}>{r.code}</span>
          </span>
        </td>
        {/* Brand (owner, 2026-11-12): narrow and cut short with … so it doesn't take room from the figures; full name on hover. */}
        <td className="max-w-[7rem] truncate whitespace-nowrap px-2 py-1.5 text-xs text-slate-600" title={r.brand || undefined}>{r.brand || '—'}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
          {r.live}{r.total > r.live && <span className="text-slate-400"> +{r.total - r.live}</span>}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{r.sold30}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">{r.weeks_left ?? '—'}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
          {money(r.our_price)}
          {setSince !== null && <Tag tone="amber" title={`Set to ${money(setSince)} after this reading — open the row and Read this style to see where it stands now.`}>set {money(setSince)}</Tag>}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5">
          <span className={us ? 'font-medium text-emerald-700' : r.holder === 'NONE' ? 'text-amber-700' : 'text-slate-800'}>{HOLDER[r.holder]}</span>
          {r.bb_price !== null && <span className="ml-1.5 tabular-nums text-slate-600">{money(r.bb_price)}</span>}
          {r.rival_at_our_price && <Tag tone="amber" title="A rival sits at our exact price, to the penny — likely a repricer following us. Matching it starts a race.">following us</Tag>}
          {r.amazon_retail && <Tag title="Amazon itself sells this size">Amazon</Tag>}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{r.rivals}</td>
        <td className={'whitespace-nowrap px-2 py-1.5 text-right tabular-nums ' + (r.kept !== null && r.walk !== null && r.target !== null && r.target < r.walk ? 'text-red-600' : 'text-slate-700')}>
          {us ? '' : money(r.kept)}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">{money(r.walk)}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">{us ? money(r.next_up) : ''}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-400" title={r.foep_status || undefined}>{money(r.foep)}</td>
        <td className="py-1.5 pr-2 text-right">
          <button type="button" onClick={(e) => { e.stopPropagation(); onClear(); }}
            title="Clear from the list while you work — Show all brings it back" aria-label={`Clear ${r.code}`}
            className="rounded p-0.5 text-slate-300 hover:bg-slate-200 hover:text-slate-700">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-slate-50/70">
          <td colSpan={13} className="px-3 py-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 pl-4">
              <span className="text-sm font-medium text-slate-900">{r.title || r.code}</span>
              <Link href={`/amz/sku/${encodeURIComponent(r.code)}?from=${encodeURIComponent('/amz/buybox')}`} className="text-xs text-brand-700 hover:underline">
                Amazon price screen →
              </Link>
              {r.asin && (
                <a href={`https://www.amazon.co.uk/dp/${r.asin}`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">On Amazon ↗</a>
              )}
              <button type="button" onClick={(e) => { e.stopPropagation(); onReadStyle(); }} disabled={busy || !r.groupid}
                title="Ask Amazon about this style's sizes now (a few seconds) — after a price change"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <ArrowPathIcon className="h-3.5 w-3.5" /> Read this style
              </button>
              <span className="text-xs text-slate-400">read {new Date(toMs(r.read_at) ?? 0).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {r.error ? (
              <div className="pl-4 text-sm text-red-600">Amazon: {r.error}</div>
            ) : (
              <table className="ml-4 text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-400">
                    <th className="pb-1 pr-6 text-left font-medium">Offer</th>
                    <th className="pb-1 pr-6 text-left font-medium">Sent by</th>
                    <th className="pb-1 pr-6 text-right font-medium">Price</th>
                    <th className="pb-1 text-left font-medium">Buy Box</th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.offers].sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).map((o, i) => {
                    return (
                      <tr key={`${o.seller}-${i}`} className={o.us ? 'font-medium text-slate-900' : 'text-slate-600'}>
                        <td className="py-0.5 pr-6 font-mono text-xs" title={o.seller}>
                          {o.us ? 'Us' : o.seller}{!o.us && o.seller === r.rival_seller && <span className="ml-1 font-sans text-slate-400">cheapest rival</span>}
                        </td>
                        <td className="py-0.5 pr-6">{o.fba ? 'FBA' : 'Self-post'}</td>
                        <td className="py-0.5 pr-6 text-right tabular-nums">{money(o.price)}</td>
                        <td className="py-0.5">{o.bb ? <span className="text-emerald-700">holds it</span> : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}
