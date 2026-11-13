'use client';
/*
=======================================================================================================================================
Page: /amz  (AMAZON PRICING — the home; one Amazon pricing task, owner 2026-11-13, docs/amz-buybox/PLAN.md decisions 21–26)
=======================================================================================================================================
Owner: "Im not comfortable with the user having two separate areas for Amazon pricing. Im ok with different groups inside Amazon pricing
subject, but only one number on dashboard and one Amazon pricing task." So the old Buy Box screen BECAME this home (decision 23) — was
a redirect to the full list (/amz/all?by=all), and before 2026-10-26 a segment picker (git history).

ONE RULE FOR "DUE" (server utils/amzDue.js, decisions 21 + 26): a size the Buy Box answers — selling at FBA (an Amazon sale in 30 days)
or New — needs pricing when it has a CARD; every other size when its review date comes round. So every size is in exactly one tile,
and Daily shows TWO figures (decision 27, owner 2026-11-13: "remove the 1 number rule"): "Amazon due" = the Not selling · due tile
(worked down to zero), and a quieter "Buy Box moves" = the Chilled cards (New + Raise + Cut), which opens this page. A Buy Box size is
never due.

THE LAYOUT — the order the job is done in:
  Title row     "Amazon Pricing"; the headline Buy Box % and the reading's age (components/AmzBuyBoxReading); Send to Amazon
                (components/AmzBasketBar — moved here with the home, the basket of prices not yet on Amazon) + its confirm banner.
  Team week     one collapsed line, laptop only (components/AmzTeamWeek).
  1 Today's mood  three big mood cards (components/MoodSwitch → MoodCards). Starts on Chilled every load, nothing stored; the Price
                buttons carry it (?mood=). It changes the card tiles only — Daily always counts Chilled (decision 23).
  2 Price       THE DAILY JOB, four tiles worked to zero, each one big "Price →" (the count is in the tile — owner, 2026-11-13: "No
                need to have Price X on the buttons. We have the count inside the box"): New · Raise · Cut — the cards ready in this
                mood (/amz/buybox/deck — on screen "Pricing"); NOT SELLING · DUE — the review half's due sizes, into the DUE CARDS
                (/amz/due-cards — owner, 2026-11-13: "the usual price change screen but reduced to cards to make it easier and more fun
                … to go through DUE"). Nothing small under or beside them.
  3 Look up     THE SPECIALITIES, the same tile look (owner, 2026-11-13: "Maybe the search card box is a speciality. So is the 'or the
                list' and the '299 items' maybe they need their own card under the main cards"; named "Look up"):
                  Search            any text (brand, name, groupid, SKU — server utils/amzBuyBoxDeck.js → matchesSearch) typed where
                                    the tile's name goes; how many sizes match and how they split (due · Buy Box · not due); "Price →"
                                    into the SEARCH CARDS (/amz/search-cards?q=&mood= — components/AmzPriceCards: every match, nothing
                                    hidden). Touches nothing else. Nothing stored — empty on every load (?q= fills it: the search
                                    cards' Back carries it).
                  Not selling list  the full list of the review half (/amz/all?by=all&half=review — Due switch, bulk bar, review chips)
                                    — was "or the list" under the Not selling tile.
                  Sizes at Amazon   who Amazon shows on each size (/amz/buybox, decision 24), count = sizes sellable at FBA now (the
                                    page also holds those on their way in) — was the "n sizes in stock at Amazon →" link on step 2's
                                    heading. Find (top right) was removed the same day — a size is found with Search.
THIS PAGE WRITES NOTHING (Send to Amazon aside — the basket's own button).
=======================================================================================================================================
*/

import { useState } from 'react';
import Link from 'next/link';
import { useUrlParam } from '@/lib/useUrlParam';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzTeamWeek from '@/components/AmzTeamWeek';
import AmzBasketBar, { AmzUploadButton } from '@/components/AmzBasketBar';
import AmzBuyBoxReading from '@/components/AmzBuyBoxReading';
import { MoodCards } from '@/components/MoodSwitch';
import { getAmzBuyBox, getAmzBuyBoxDeck, getAmzNotSellingDue, getAmzSearchSummary, type AmzAnswer, type AmzMood } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useDebounced } from '@/lib/useDebounced';
import { ANSWERS } from '@/lib/buyboxAnswers';

// The answers with cards (step 2's first three tiles open them).
const DECK_ANSWERS: AmzAnswer[] = ['new', 'raise', 'cut'];
// Same look for every tile's button.
// Steps 2 and 3 share one grid, so the Look up tiles sit under the Price tiles at the same width.
const GRID = 'grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-3';
const PRICE_BTN = 'col-start-2 row-span-2 row-start-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-sm sm:col-start-1 sm:row-span-1 sm:row-start-auto sm:mt-3';

export default function AmazonPricingHome() {
  // The stored Buy Box reading (headline + age). While a read is running the header follows it every 3 s; otherwise nothing
  // refetches by itself — the readings only change on a read.
  const { data, error: loadError } = useApiQuery(['amz-buybox'], () => getAmzBuyBox(), {
    revalidateIfStale: false, revalidateOnMount: true, revalidateOnReconnect: false,
    refreshInterval: (d) => (d?.running ? 3000 : 0),
  });
  const [mood, setMood] = useState<AmzMood>('chilled');
  // SEARCH (header): the search card beside the box; nothing stored. Counted once typing settles, so each key press isn't a server
  // read. Starts from ?q= when coming Back from the search cards (their Back carries it); typing takes over.
  const urlQ = useUrlParam('q');
  const [typed, setSearch] = useState<string | null>(null);
  const search = typed ?? urlQ ?? '';
  const q = useDebounced(search.trim(), 300);
  const { data: found } = useApiQuery(q ? ['amz-search-summary', q] : null, () => getAmzSearchSummary(q), { keepPreviousData: true });
  // The card still shows the last search's numbers while the new one is counted — faded, its button waits.
  const counting = !!search.trim() && found?.q !== search.trim();
  // The answers for the mood (same server rules as the cards). Its OWN key, never the deck page's (that one is the snapshot the cards
  // work from), keyed on the mood and the reading so a finished read recounts.
  const { data: deck } = useApiQuery(['amz-buybox-answers', mood, data?.last_all?.finished_at ?? ''], () => getAmzBuyBoxDeck(mood), {
    revalidateIfStale: false, revalidateOnMount: true, revalidateOnReconnect: false,
  });
  // NOT SELLING · DUE — mood-independent (the review half goes by review dates).
  const { data: notSelling } = useApiQuery(['amz-not-selling-due'], () => getAmzNotSellingDue());

  const answers = deck?.answers;

  return (
    // BIG TITLE (owner, 2026-11-13: "make the Amazon Pricing text bigger so it fills it in") — the headline % and reading age on the
    // right are two lines tall; the large title fills that row instead of leaving a gap under a small one.
    <AppShell title="Amazon Pricing" bigTitle
      headerRight={
        <div className="flex flex-col items-end gap-2">
          <AmzBuyBoxReading data={data} />
          {/* Find was here — removed (owner, 2026-11-13); a size is found with Look up → Search. */}
          <div className="flex items-center gap-2">
            <AmzUploadButton />
          </div>
        </div>
      }>
      <AmzBasketBar />
      {loadError && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}

      <div className="flex flex-col gap-4">
        {/* TEAM WEEK: each person's Buy Box results, one collapsed line — a desk job, hidden on a phone. (Its own box carries a
            bottom margin, taken back here so the steps space evenly.) */}
        <div className="-mb-4 hidden sm:block"><AmzTeamWeek /></div>

        {/* STEP 1 — THE MOOD. */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <StepHead n={1} title="Today's mood" hint="Starts on Chilled every time — pick the one that fits the day." />
          <MoodCards mood={mood} onChange={setMood} />
        </section>

        {/* STEP 2 — PRICE: every size that needs pricing is behind exactly one of these four tiles. */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <StepHead n={2} title="Price" hint="Cards one at a time — Set or Leave. Not selling goes by review date." />
          <div className={GRID}>
            {ANSWERS.filter((a) => DECK_ANSWERS.includes(a.key)).map((a) => {
              const s = answers?.[a.key];
              const ready = s?.ready ?? 0;
              return (
                <Tile key={a.key} rule={a.rule} dot={a.dot} label={a.label} n={s ? ready : null}
                  under={`of ${s?.total ?? 0} in ${a.label}${a.key === 'new' ? ' · the mood doesn’t change it' : ''}`}
                  href={ready > 0 ? `/amz/buybox/deck?g=${a.key}&mood=${mood}` : null} btn="Price →"
                  btnTitle="One size at a time, one suggested move — in the mood chosen above" />
              );
            })}
            <Tile rule="Sold nothing on Amazon in 30 days, on its way in, or out of stock — another seller isn’t the reason. Priced from the list when its review date comes round."
              dot="bg-slate-400" label="Not selling · due" n={notSelling ?? null} under="by review date — in any mood"
              href={notSelling ? '/amz/due-cards' : null} btn="Price →"
              btnTitle="One size at a time — up / down, Set or Leave, a review date" />
          </div>
        </section>

        {/* STEP 3 — LOOK UP: the specialities (header), the same tiles under the daily ones. */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <StepHead n={3} title="Look up" hint="Search anything, the whole not-selling list, or who Amazon shows." />
          <div className={GRID}>
            <SearchTile search={search} onSearch={setSearch} found={found ?? null} counting={counting}
              href={found && found.total > 0 ? `/amz/search-cards?q=${encodeURIComponent(found.q)}&mood=${mood}` : null} />
            <Tile rule="The full list of the not-selling sizes — its Due switch, bulk moves and review dates" dot="bg-slate-400"
              label="Not selling list" n={notSelling ?? null} unit="due" under="bulk moves · review dates"
              href="/amz/all?by=all&half=review" btn="Open →" btnTitle="The list of these sizes — its Due switch, bulk moves and review dates" />
            <Tile rule="Who Amazon shows on each size — the sizes on their way in are there too (search)" dot="bg-slate-400"
              label="Sizes at Amazon" n={deck?.in_stock ?? null} unit="in stock" under="who Amazon shows on each size"
              href={`/amz/buybox?mood=${mood}`} btn="Open →" btnTitle="Who Amazon shows on each size" />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

// One tile: the count (big) and what it counts (`unit`), a line under it, and ONE button into the work — or "Nothing to price".
function Tile({ rule, dot, label, n, unit = 'to price', under, href, btn, btnTitle }: {
  rule: string; dot: string; label: string; n: number | null; unit?: string; under: string; href: string | null; btn: string; btnTitle: string;
}) {
  return (
    <div title={rule} className={'grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-xl border border-slate-200 px-4 py-3 sm:grid-cols-1 sm:gap-y-0.5'}>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} /> {label}
      </div>
      <div className="col-start-1 flex items-baseline gap-2 sm:mt-1">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-4xl">{n ?? '…'}</span>
        <span className="text-sm text-slate-600">{unit}</span>
      </div>
      <div className="col-start-1 hidden text-xs tabular-nums text-slate-400 sm:block">{under}</div>
      {href ? (
        <Link href={href} title={btnTitle} className={`${PRICE_BTN} bg-white font-semibold text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 hover:ring-slate-400`}>{btn}</Link>
      ) : (
        <span className={`${PRICE_BTN} bg-slate-50 text-slate-400 ring-1 ring-inset ring-slate-200`}>Nothing to price</span>
      )}
    </div>
  );
}

// THE SEARCH TILE: the same rows as a Price tile — the box in the name's place, the count, the split, the button.
function SearchTile({ search, onSearch, found, counting, href }: {
  search: string; onSearch: (v: string) => void; counting: boolean; href: string | null;
  found: { total: number; due: number; moves: number; notDue: number } | null;
}) {
  const typed = search.trim() !== '';
  const n = !typed ? null : found ? found.total : null;
  return (
    <div title="Any brand, style name or SKU — every size it matches, due or not, one card at a time"
      className="grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-xl border border-slate-200 px-4 py-3 sm:grid-cols-1 sm:gap-y-0.5">
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search — e.g. Caprice"
          aria-label="Search the Amazon sizes by brand, style or SKU"
          className="h-7 w-full rounded-md border border-slate-300 pl-8 pr-7 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        {typed && (
          <button type="button" onClick={() => onSearch('')} aria-label="Clear the search" title="Clear"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-slate-400 hover:text-slate-700">×</button>
        )}
      </div>
      <div className={'col-start-1 flex items-baseline gap-2 sm:mt-1' + (counting ? ' opacity-50' : '')}>
        <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-4xl">{n ?? (typed ? '…' : '—')}</span>
        <span className="text-sm text-slate-600">{n === 1 ? 'size' : 'sizes'}</span>
      </div>
      <div className={'col-start-1 hidden truncate text-xs tabular-nums text-slate-400 sm:block' + (counting ? ' opacity-50' : '')}>
        {typed && found && found.total > 0 ? `${found.due} due · ${found.moves} Buy Box · ${found.notDue} not due` : 'brand, name or SKU'}
      </div>
      {href && !counting ? (
        <Link href={href} title="Every size the search found, one card at a time — nothing hidden"
          className={`${PRICE_BTN} bg-white font-semibold text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 hover:ring-slate-400`}>Price →</Link>
      ) : (
        <span className={`${PRICE_BTN} bg-slate-50 text-slate-400 ring-1 ring-inset ring-slate-200`}>
          {!typed ? 'Type to search' : counting || !found ? 'Counting…' : 'Nothing matches'}
        </span>
      )}
    </div>
  );
}

// A numbered step heading: the number is the order the job is done in — mood, then price, then look up.
function StepHead({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="inline-grid h-6 w-6 shrink-0 place-items-center self-center rounded-full bg-slate-900 text-xs font-bold text-white">{n}</span>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {hint && <span className="hidden text-sm text-slate-400 sm:inline">{hint}</span>}
    </div>
  );
}
