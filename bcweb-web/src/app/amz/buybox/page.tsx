'use client';
/*
=======================================================================================================================================
Page: /amz/buybox  (SIZES AT AMAZON — the table; was the Buy Box screen until 2026-11-13, then "Buy Box by size" the same day)
=======================================================================================================================================
Purpose: Where we stand on every Amazon size — who Amazon features, at what price, our share of views — for looking things up and checking
         a reason. Server routes/amz-buybox.js (READ ONLY) + amz-buybox-read.js; THE rules are utils/amzBuyBox.js.

MOVED BEHIND A LINK (owner, 2026-11-13, PLAN.md decisions 23–24): the Buy Box screen became the AMAZON PRICING HOME (/amz — the mood,
         the New / Raise / Cut / Not selling tiles, Team week); this table went to its own page, opened from the home's "Sizes at Amazon
         →" (owner: "Move it behind a link"). "Buy Box" now names the reading, the % and this table — never a place to price. The
         headline % and the reading's age show here too (components/AmzBuyBoxReading).
         RENAMED "SIZES AT AMAZON" (owner, 2026-11-13, asking "Is 'Buy Box by Size' actually all sizes?"): it isn't every Amazon size —
         only the sizes with stock AT AMAZON (live, or on its way in: what the hourly read covers, utils/amzBuyBox.js → sizesToRead).
         Sold-out sizes and sizes never sent to FBA aren't on it; Find covers those.

WHAT YOU SEE IS THE DATABASE (owner, 2026-11-12): opening the page never asks Amazon — it shows the last stored reading and how old it is.
         The cron reads the whole list every hour; the one button is Read this style, on an open row (seconds — after a price change).

THE ANSWERS: every size IN STOCK AT AMAZON has ONE answer for the MOOD — New · Raise · Cut · Leave · Not selling (utils/amzBuyBoxDeck.js,
         via GET /amz-buybox-deck). The mood comes from the home's link (?mood=, Chilled when absent) and shows beside the tabs — it is
         chosen on the home, never here. Click an answer's tab for its sizes and its REASONS (the old groups, or why a card waits) — a
         reason narrows the list. Sizes not live at FBA have no answer — search finds them.

THE GROUPS (one size, one group — classify in utils/amzBuyBox.js; worked out from the stored reading + today's cost) are REASONS:
         Winning, room to go up · Losing, can match · Losing, can't match · No Buy Box · Winning, at the top · Alone.
         The Buy Box price includes postage. "Kept" = our profit a pair at the Buy Box price (at our own price where we hold it); "Walk-away" = the £3-a-pair price.
         SHARE OF VIEWS (owner, 2026-11-12): Amazon splits the Buy Box by customer group, each with a share of page views. "Buy Box"
         is the offer featured to the MOST views (its price is the one to match, postage included); "We're shown" is the % of views
         where we are featured — our own Buy Box %. Amazon's "expected winning price" is no longer read or shown (wrong both times
         it was checked — £31.43 on IVES-WHITE-06 was a rival's price minus 1p without its postage).
         "Room to go up" is measured to the next rival above us — a guess until the history shows how far up the Buy Box holds.

CLEAR (owner, 2026-11-12): no size ever drops off by itself. The × clears a row while working (this visit only, nothing stored; counts
         unchanged; Show all brings them back). No review dates on this page.

THIS PAGE WRITES NOTHING. The presses are on PRICING (/amz/buybox/deck), opened from the home. The row links to the size's Amazon price
         screen, where a price can be set as usual.

TAGS (colour restraint — small solid tags, no row tints): "following us" = a rival at our exact price to the penny (a repricer?) ·
         "Amazon" = Amazon Retail sells the size · "set £x" = a price was set AFTER the reading (amz_price_log) — hidden, SHOW_SET_SINCE ·
         "not eligible" (red) = Amazon won't consider OUR offer for the Buy Box at all (IsFeaturedMerchant false) — 0% whatever the
         price, so the fix is in Seller Central. Our price is always what AMAZON showed at the read — not amzfeed, which can lag a day.
=======================================================================================================================================
*/

import { Fragment, Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowPathIcon, ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzBuyBoxReading, { toMs } from '@/components/AmzBuyBoxReading';
import { MoodBadge } from '@/components/MoodSwitch';
import { getAmzBuyBox, getAmzBuyBoxDeck, startAmzBuyBoxRead, type AmzAnswer, type AmzBuyBoxGroup, type AmzBuyBoxHolder, type AmzBuyBoxRow, type AmzMood } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { ANSWERS, reasonLabel } from '@/lib/buyboxAnswers';
import { useAuth } from '@/contexts/AuthContext';

// Screen order = the order to work them: money left on the table first (owner, 2026-11-12), then what can be won back, then what to leave.
const GROUPS: { key: AmzBuyBoxGroup; label: string; rule: string; dot: string }[] = [
  { key: 'room', label: 'Winning, room to go up', rule: 'We have it, and the next rival is more than 2% above us — a guess until history shows how far up it holds', dot: 'bg-emerald-500' },
  { key: 'can_match', label: 'Losing, can match', rule: 'A rival has the Buy Box, and its price still keeps us £3 a pair', dot: 'bg-red-500' },
  { key: 'cant_match', label: "Losing, can't match", rule: 'A rival has it under our £3 walk-away price — hold, no race to the bottom', dot: 'bg-slate-400' },
  { key: 'tie', label: 'Tie at our price', rule: 'A rival at our exact price is shown instead of us — matching changes nothing; left as a tie for now (weeks of stock is on the row)', dot: 'bg-amber-400' },
  { key: 'dearer', label: 'Rival dearer', rule: 'A rival priced ABOVE us is shown instead — price isn’t the reason; Amazon’s choice', dot: 'bg-slate-400' },
  { key: 'no_bb', label: 'No Buy Box', rule: 'Nobody holds it — Amazon pulled it (often: seen cheaper elsewhere)', dot: 'bg-amber-500' },
  { key: 'top', label: 'Winning, at the top', rule: 'We have it, no room above', dot: 'bg-emerald-700' },
  { key: 'alone', label: 'Alone', rule: 'No other seller on the size — its price is the pricing standard’s job, not the Buy Box', dot: 'bg-sky-500' },
  { key: 'not_live', label: 'Not live at FBA', rule: 'No stock sellable at FBA now, only on its way in — Amazon can’t feature it, so no price fixes it; back in the groups when the stock lands', dot: 'bg-slate-300' },
  { key: 'unknown', label: 'No walk-away', rule: 'No cost on the style (no £3 price), or no price to match', dot: 'bg-slate-300' },
  { key: 'error', label: 'Not read', rule: 'Amazon refused the read for this size — hover the row for its reason', dot: 'bg-slate-300' },
];

const HOLDER: Record<AmzBuyBoxHolder, string> = {
  US: 'Us', US_SHARED: 'Us + shared', OTHER_FBA: 'Rival (FBA)', OTHER_MFN: 'Rival (self-post)', AMAZON: 'Amazon', NONE: 'Nobody',
};

// The amber "set £x" tag beside Our price (a price set after this reading). Hidden 2026-11-12 (owner: "hide it, will bring back if I
// need it") — flip to true to bring it back; the server still sends set_since and Pricing still uses it.
const SHOW_SET_SINCE = false;
const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);

function Tag({ children, title, tone = 'slate' }: { children: React.ReactNode; title: string; tone?: 'slate' | 'amber' | 'red' }) {
  const cls = tone === 'red' ? 'bg-red-100 text-red-700' : tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  return <span title={title} className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

const MOOD_KEYS: AmzMood[] = ['fierce', 'chilled', 'climb'];

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function AmzBuyBoxBySizePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <BuyBoxBySize />
    </Suspense>
  );
}

function BuyBoxBySize() {
  const { logout } = useAuth();
  const searchParams = useSearchParams();
  // The mood is chosen on the home and carried here in the link (header); Chilled when absent.
  const moodParam = searchParams.get('mood') as AmzMood | null;
  const mood: AmzMood = moodParam && MOOD_KEYS.includes(moodParam) ? moodParam : 'chilled';

  // While a read is running (ours, another person's or the cron's) the page follows its progress every 3 s and picks up the new
  // readings when it ends; otherwise nothing refetches by itself — the readings only change on a read.
  const { data, error: loadError, isLoading, refresh } = useApiQuery(['amz-buybox'], () => getAmzBuyBox(), {
    revalidateIfStale: false, revalidateOnReconnect: false,
    refreshInterval: (d) => (d?.running ? 3000 : 0),
  });
  const running = data?.running ?? null;
  // THE ANSWERS for the mood — the same key as the home's, so the counts match it.
  const { data: deck } = useApiQuery(['amz-buybox-answers', mood, data?.last_all?.finished_at ?? ''], () => getAmzBuyBoxDeck(mood), {
    revalidateIfStale: false, revalidateOnReconnect: false,
  });

  const [answer, setAnswer] = useState<AmzAnswer | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // CLEARED rows (owner, 2026-11-12): the × hides a row in THIS visit only — nothing stored, counts unchanged, Show all brings them back.
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());

  const answers = deck?.answers;
  // Default answer = the first with cards (New, Raise, Cut), else Leave.
  const shown: AmzAnswer = answer ?? ((['new', 'raise', 'cut'] as AmzAnswer[]).find((a) => (answers?.[a]?.ready ?? 0) > 0) ?? 'leave');
  const shownReasons = Object.entries(answers?.[shown]?.reasons ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  function pick(a: AmzAnswer, r: string | null = null) { setAnswer(a); setReason(r); setSearch(''); setOpen(null); }

  const rows = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all = data?.rows ?? [];
    const of = deck?.answer_of ?? {};
    const list = all.filter((r) => {
      if (cleared.has(r.code)) return false;
      if (terms.length) {
        const hay = `${r.code} ${r.title || ''} ${r.brand || ''}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      }
      const a = of[r.code];
      return !!a && a[0] === shown && (reason === null || a[1] === reason);
    });
    // Most pairs sold first — where the Buy Box matters most.
    return [...list].sort((a, b) => b.sold30 - a.sold30 || b.total - a.total || a.code.localeCompare(b.code));
  }, [data, deck, shown, reason, search, cleared]);
  const notLive = (data?.rows ?? []).filter((r) => !(r.live > 0)).length;

  async function read(groupid?: string) {
    setMsg(null);
    const res = await startAmzBuyBoxRead(groupid);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    if (!res.success && res.return_code !== 'BUSY') { setMsg(res.error || 'Could not start the read'); return; }
    if (res.return_code === 'BUSY') setMsg('A read is already running — following it.');
    await refresh();
  }

  return (
    <AppShell title="Sizes at Amazon" backHref="/amz" backLabel="Amazon Pricing"
      headerRight={<AmzBuyBoxReading data={data} msg={msg} />}>
      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {loadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}

      {data && (
        <section>
          {/* The mood (chosen on the home), the answer tabs, the in-stock count, search on the right. */}
          <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span title="The mood is chosen on Amazon Pricing"><MoodBadge mood={mood} /></span>
            <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
              {ANSWERS.map((a) => {
                const on = !search && shown === a.key;
                return (
                  <button key={a.key} type="button" onClick={() => pick(a.key)} title={a.rule}
                    className={'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm ' + (on ? 'bg-slate-100 font-medium text-slate-900 ring-1 ring-inset ring-slate-200' : 'text-slate-600 hover:bg-slate-50')}>
                    <span className={`inline-block h-2 w-2 rounded-full ${a.dot}`} /> {a.label}
                    <span className="font-semibold tabular-nums text-slate-900">{answers?.[a.key]?.total ?? ''}</span>
                  </button>
                );
              })}
            </div>
            <span className="text-sm text-slate-500">
              <span className="font-semibold tabular-nums text-slate-900">{deck?.in_stock ?? '…'}</span> in stock at Amazon
              {notLive > 0 && <span className="text-slate-400" title="Inbound only — no answer until the stock lands; search finds them"> · {notLive} on their way in</span>}
            </span>
            <div className="relative w-full sm:ml-auto sm:w-72">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2 h-5 w-5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search every size — name, brand or SKU"
                className="w-full rounded-md border border-slate-300 py-1.5 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-sm">
            {!search && shownReasons.length > 0 && (
              <>
                <button type="button" onClick={() => setReason(null)}
                  className={'rounded-full border px-2.5 py-0.5 ' + (reason === null ? 'border-slate-500 bg-white text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
                  All <span className="font-semibold tabular-nums">{answers?.[shown]?.total ?? 0}</span>
                </button>
                {shownReasons.map(([k, n]) => (
                  <button key={k} type="button" onClick={() => setReason(reason === k ? null : k)}
                    className={'rounded-full border px-2.5 py-0.5 ' + (reason === k ? 'border-slate-500 bg-white text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
                    {reasonLabel(k)} <span className="font-semibold tabular-nums text-slate-900">{n}</span>
                  </button>
                ))}
              </>
            )}
            <span className="ml-1 text-slate-400">
              {search ? `${rows.length} sizes match, across every size read.` : reason ? reasonLabel(reason) : ANSWERS.find((a) => a.key === shown)?.rule}
            </span>
            {cleared.size > 0 && (
              <span className="ml-auto text-slate-500">
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
                    ['Buy Box', 'The offer Amazon features to the MOST page views, its price (postage included) and its share of views', 'left'],
                    ['Rivals', 'Other offers on the size', 'right'],
                    ['Kept', 'Our profit a pair: at the Buy Box price if we matched it, or at our own price where we already hold the Buy Box', 'right'],
                    ['Walk-away', 'The price that keeps £3 a pair — never go under it', 'right'],
                    ['Next dearer', 'The cheapest rival priced above us — a raise stays a penny under it', 'right'],
                    ['We’re shown', 'Our Buy Box %: the share of page views where Amazon features OUR offer', 'right'],
                  ].map(([l, t, a]) => (
                    <th key={l} title={t} className={`sticky top-0 z-10 whitespace-nowrap bg-slate-50 px-2 py-1.5 font-medium shadow-[inset_0_-1px_0_rgb(226_232_240)] ${a === 'right' ? 'text-right' : 'text-left'} ${l === 'Size' ? 'pl-3' : ''}`}>{l}</th>
                  ))}
                  <th className="sticky top-0 z-10 w-8 bg-slate-50 shadow-[inset_0_-1px_0_rgb(226_232_240)]" aria-label="Clear" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-400">{search ? 'Nothing matches.' : cleared.size ? 'Nothing left here — Show all brings the cleared rows back.' : deck ? 'No sizes here.' : 'Loading…'}</td></tr>
                )}
                {rows.map((r) => (
                  <BuyBoxRow key={r.code} r={r} isOpen={open === r.code} showGroup
                    onToggle={() => setOpen(open === r.code ? null : r.code)} onReadStyle={() => r.groupid && read(r.groupid)} busy={!!running}
                    onClear={() => { setCleared((prev) => new Set(prev).add(r.code)); if (open === r.code) setOpen(null); }} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
          {SHOW_SET_SINCE && setSince !== null && <Tag tone="amber" title={`Set to ${money(setSince)} after this reading — open the row and Read this style to see where it stands now.`}>set {money(setSince)}</Tag>}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5">
          <span className={us ? 'font-medium text-emerald-700' : r.holder === 'NONE' ? 'text-amber-700' : 'text-slate-800'}>{HOLDER[r.holder]}</span>
          {r.bb_price !== null && <span className="ml-1.5 tabular-nums text-slate-600">{money(r.bb_price)}</span>}
          {r.lead_share !== null && r.lead_share < 99.5 && (
            <span className="ml-1 text-xs tabular-nums text-slate-400" title="Its share of page views — the rest are shown another offer">{Math.round(r.lead_share)}%</span>
          )}
          {r.rival_at_our_price && <Tag tone="amber" title="A rival sits at our exact price, to the penny — likely a repricer following us. Matching it starts a race.">following us</Tag>}
          {r.amazon_retail && <Tag title="Amazon itself sells this size">Amazon</Tag>}
          {r.our_eligible === false && <Tag tone="red" title="Amazon says our offer isn't eligible for the Buy Box (Featured Offer) — it can't be shown whatever the price. Check the listing in Seller Central, not the price.">not eligible</Tag>}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{r.rivals}</td>
        <td className={'whitespace-nowrap px-2 py-1.5 text-right tabular-nums ' + (r.kept !== null && r.walk !== null && (us ? r.our_price : r.target) !== null && (us ? r.our_price! : r.target!) < r.walk ? 'text-red-600' : 'text-slate-700')}>
          {money(r.kept)}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">{money(r.walk)}</td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">{us ? money(r.next_up) : ''}</td>
        <td className={'whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums ' + (r.our_share === null ? 'text-slate-400' : r.our_share >= 50 ? 'text-emerald-700' : r.our_share > 0 ? 'text-amber-700' : 'text-slate-500')}
          title={r.our_share === null ? 'Not known at this read' : undefined}>
          {r.our_share === null ? '—' : `${Math.round(r.our_share)}%`}
        </td>
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
              <Link href={`/amz/sku/${encodeURIComponent(r.code)}?from=${encodeURIComponent('/amz/buybox')}&back=${encodeURIComponent('Sizes at Amazon')}`} className="text-xs text-brand-700 hover:underline">
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
                    <th className="pb-1 text-left font-medium" title="Share of page views where Amazon features this offer — hover for the customer groups">Shown to</th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.offers].sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).map((o, i) => {
                    const f = r.featured.find((x) => x.seller === o.seller);
                    const groups = f ? f.segments.map((g) => `${g.who === 'DEFAULT' ? 'Default' : g.who === 'PRIME' ? 'Prime' : g.who === 'NON_PRIME' ? 'Non-Prime' : g.who} ${Math.round(g.pct)}%`).join(' · ') : '';
                    return (
                      <tr key={`${o.seller}-${i}`} className={o.us ? 'font-medium text-slate-900' : 'text-slate-600'}>
                        <td className="py-0.5 pr-6 font-mono text-xs" title={o.seller}>
                          {o.us ? 'Us' : o.seller}{!o.us && o.seller === r.rival_seller && <span className="ml-1 font-sans text-slate-400">cheapest rival</span>}
                          {o.elig === false && <span className="ml-1 font-sans text-red-600" title="Amazon won't consider this offer for the Buy Box">not eligible</span>}
                        </td>
                        <td className="py-0.5 pr-6">{o.fba ? 'FBA' : 'Self-post'}</td>
                        <td className="py-0.5 pr-6 text-right tabular-nums">{money(o.price)}</td>
                        <td className="py-0.5" title={groups || undefined}>
                          {f ? <span className="font-medium text-emerald-700">{Math.round(f.share)}% of views</span>
                            : r.featured.length === 0 && o.bb ? <span className="text-emerald-700">holds it</span> : ''}
                        </td>
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
