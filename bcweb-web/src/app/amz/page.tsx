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
  Title row     "Amazon Pricing"; the headline Buy Box % and the reading's age (components/AmzBuyBoxReading); Find; Send to Amazon
                (components/AmzBasketBar — moved here with the home, the basket of prices not yet on Amazon) + its confirm banner.
  Team week     one collapsed line, laptop only (components/AmzTeamWeek).
  1 Today's mood  three big mood cards (components/MoodSwitch → MoodCards). Starts on Chilled every load, nothing stored; the Price
                buttons carry it (?mood=). It changes the card tiles only — Daily always counts Chilled (decision 23).
  2 Price       New · Raise · Cut — the cards ready in this mood, each "Price n →" into the cards (/amz/buybox/deck — on screen
                "Pricing"); and NOT SELLING · DUE — the review half's due sizes, "Price n →" into the full list narrowed to them
                (/amz/all?by=all&half=review — its Due switch, bulk bar and review chips). Leave sits quietly beside them. One bar
                under them adds up to the sizes in stock at FBA.
  Link          "n sizes in stock at Amazon →" at the right of step 2's heading opens Sizes at Amazon (/amz/buybox — the table, moved
                behind a link, decision 24). It was a separate "Sizes at Amazon →" link under the bar until the owner asked for the count
                to be the link (2026-11-13: "make it the link instead"). The count is the sizes sellable at FBA now; the page also holds
                those on their way in (found by search). An "All sizes →" link to the full list (/amz/all?by=all) was taken off the same
                day (owner: "Would prefer the all buy box sizes only"). A size off the cards is found with Find, as before.
THIS PAGE WRITES NOTHING (Send to Amazon aside — the basket's own button).
=======================================================================================================================================
*/

import { useState } from 'react';
import Link from 'next/link';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzTeamWeek from '@/components/AmzTeamWeek';
import AmzBasketBar, { AmzUploadButton } from '@/components/AmzBasketBar';
import AmzBuyBoxReading from '@/components/AmzBuyBoxReading';
import { MoodCards } from '@/components/MoodSwitch';
import { getAmzBuyBox, getAmzBuyBoxDeck, getAmzNotSellingDue, type AmzAnswer, type AmzMood } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { ANSWERS } from '@/lib/buyboxAnswers';

// The answers with cards (step 2's first three tiles open them).
const DECK_ANSWERS: AmzAnswer[] = ['new', 'raise', 'cut'];
// Same look for every tile's button.
const PRICE_BTN = 'col-start-2 row-span-2 row-start-1 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-sm sm:col-start-1 sm:row-span-1 sm:row-start-auto sm:mt-3';

export default function AmazonPricingHome() {
  // The stored Buy Box reading (headline + age). While a read is running the header follows it every 3 s; otherwise nothing
  // refetches by itself — the readings only change on a read.
  const { data, error: loadError } = useApiQuery(['amz-buybox'], () => getAmzBuyBox(), {
    revalidateIfStale: false, revalidateOnReconnect: false,
    refreshInterval: (d) => (d?.running ? 3000 : 0),
  });
  const [mood, setMood] = useState<AmzMood>('chilled');
  // The answers for the mood (same server rules as the cards). Its OWN key, never the deck page's (that one is the snapshot the cards
  // work from), keyed on the mood and the reading so a finished read recounts.
  const { data: deck } = useApiQuery(['amz-buybox-answers', mood, data?.last_all?.finished_at ?? ''], () => getAmzBuyBoxDeck(mood), {
    revalidateIfStale: false, revalidateOnReconnect: false,
  });
  // NOT SELLING · DUE — mood-independent (the review half goes by review dates).
  const { data: notSelling } = useApiQuery(['amz-not-selling-due'], () => getAmzNotSellingDue());

  const answers = deck?.answers;

  return (
    <AppShell title="Amazon Pricing"
      headerRight={
        <div className="flex flex-col items-end gap-2">
          <AmzBuyBoxReading data={data} />
          <div className="flex items-center gap-2">
            <Link href="/amz/find" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-brand-500">
              <MagnifyingGlassIcon className="h-4 w-4 text-slate-400" /> Find
            </Link>
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
          <StepHead n={2} title="Price" hint="Cards one at a time — Set or Leave. Not selling goes by review date."
            right={
              // THE LINK to Sizes at Amazon (owner, 2026-11-13: "make it the link instead" — the count says what the page holds).
              <Link href={`/amz/buybox?mood=${mood}`} title="Who Amazon shows on each size — the sizes on their way in are there too (search)"
                className="font-medium text-brand-700 hover:underline">
                <span className="font-semibold tabular-nums">{deck?.in_stock ?? '…'}</span> sizes in stock at Amazon →
              </Link>
            } />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-3">
            {ANSWERS.filter((a) => DECK_ANSWERS.includes(a.key)).map((a) => {
              const s = answers?.[a.key];
              const ready = s?.ready ?? 0;
              return (
                <Tile key={a.key} rule={a.rule} dot={a.dot} label={a.label} n={s ? ready : null}
                  under={`of ${s?.total ?? 0} in ${a.label}${a.key === 'new' ? ' · the mood doesn’t change it' : ''}`}
                  href={ready > 0 ? `/amz/buybox/deck?g=${a.key}&mood=${mood}` : null} btn={`Price ${ready} →`}
                  btnTitle="One size at a time, one suggested move — in the mood chosen above" />
              );
            })}
            <Tile rule="Sold nothing on Amazon in 30 days, on its way in, or out of stock — another seller isn’t the reason. Priced from the list when its review date comes round."
              dot="bg-slate-400" label="Not selling · due" n={notSelling ?? null} under="by review date — in any mood"
              href={notSelling ? '/amz/all?by=all&half=review' : null} btn={`Price ${notSelling ?? 0} →`}
              btnTitle="The list of these sizes — its Due switch, bulk moves and review dates" />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

// One Price tile: the count to price (big), "of n" under it, and a button into the work — or "Nothing to price".
function Tile({ rule, dot, label, n, under, href, btn, btnTitle }: {
  rule: string; dot: string; label: string; n: number | null; under: string; href: string | null; btn: string; btnTitle: string;
}) {
  return (
    <div title={rule} className="grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-xl border border-slate-200 px-4 py-3 sm:grid-cols-1 sm:gap-y-0.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} /> {label}
      </div>
      <div className="col-start-1 flex items-baseline gap-2 sm:mt-1">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-4xl">{n ?? '…'}</span>
        <span className="text-sm text-slate-600">to price</span>
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

// A numbered step heading: the number is the order the job is done in — mood, then price.
function StepHead({ n, title, hint, right }: { n: number; title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="inline-grid h-6 w-6 shrink-0 place-items-center self-center rounded-full bg-slate-900 text-xs font-bold text-white">{n}</span>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {hint && <span className="hidden text-sm text-slate-400 sm:inline">{hint}</span>}
      {right && <span className="ml-auto text-sm text-slate-500">{right}</span>}
    </div>
  );
}
