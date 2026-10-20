'use client';
/*
=======================================================================================================================================
Page: /slider — Pricing Slider
=======================================================================================================================================
Purpose: The Pricing Slider home (owner, 2026-10-17). A slider is a GROUP of products whose price steps down by a % of RRP every N days
         until each one sells — then it HOLDS at that price (the diamond) — or reaches the group's floor. "The idea came from wanting to get
         NEW items moving so drop the price until we find our selling point", without dropping straight to the bottom, which found some
         diamonds but sold others at a loss.

         This page lists the groups — Active (active + paused) and Ended — with where each stands: sliding / found / at floor, moves due
         today, and the date the last sliding product would reach its floor. "New slider" creates one (components/SliderRulesForm.tsx)
         and opens it. Everything else — adding products, moving prices, reset to RRP — is on the group's page, /slider/[id].

         NO CRON (owner): every price move is a button press, the way the team prices today. A Shopify slider works per STYLE, an Amazon
         slider per SIZE, so a group is one channel.
         On the dashboard it is a tile in the Pricing card (a top-level card of its own broke the main row, 2026-10-17).
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PlusIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import SliderRulesForm from '@/components/SliderRulesForm';
import { ChannelLogo } from '@/components/ChannelBadge';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSliderGroups, SliderGroupSummary } from '@/lib/api';
import { GROUP_STATE_COLOR, GROUP_STATE_LABEL, fmtDay, rulesSummary } from '@/lib/sliderUi';

const NO_GROUPS: SliderGroupSummary[] = [];

// useSearchParams must sit inside a Suspense boundary for Next's build (App Router). Thin wrapper does that.
export default function SliderHomePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SliderHome />
    </Suspense>
  );
}

function SliderHome() {
  const router = useRouter();
  const q = useApiQuery('slider-groups', getSliderGroups);
  const groups = q.data?.groups ?? NO_GROUPS;
  const today = q.data?.today;
  const [tab, setTab] = useState<'live' | 'ended'>('live');
  // New slider lives in the URL (?new=1, owner 2026-10-20) so browser Back closes the form, and the back link does the same while it
  // is open. Closing replaces rather than pops, so a deep link to ?new=1 doesn't Back you off the site.
  const creating = useSearchParams().get('new') === '1';
  const setCreating = (on: boolean) => (on ? router.push('/slider?new=1', { scroll: false }) : router.replace('/slider', { scroll: false }));

  const live = useMemo(() => groups.filter((g) => g.state !== 'ended'), [groups]);
  const ended = useMemo(() => groups.filter((g) => g.state === 'ended'), [groups]);
  const shown = tab === 'live' ? live : ended;

  const tabBtn = (on: boolean) =>
    'rounded-md px-3 py-1.5 text-sm font-medium transition ' + (on ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100');

  return (
    <AppShell title="Pricing Slider" backHref={creating ? '/slider' : undefined} backLabel="Pricing Slider">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button type="button" onClick={() => setTab('live')} className={tabBtn(tab === 'live')}>Active · {live.length}</button>
          <button type="button" onClick={() => setTab('ended')} className={tabBtn(tab === 'ended')}>Ended · {ended.length}</button>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <PlusIcon className="h-4 w-4" /> New slider
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-4">
          <SliderRulesForm
            onSaved={(id) => { q.refresh(); router.push(`/slider/${id}`); }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {q.error ? (
          <p className="px-5 py-4 text-sm text-red-700">{q.error.message}</p>
        ) : q.isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-400">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">
            {tab === 'live' ? 'No sliders yet.' : 'No ended sliders.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">Slider</th>
                  <th className="px-4 py-2 text-right font-medium">Sliding</th>
                  <th className="px-4 py-2 text-right font-medium">Found</th>
                  <th className="px-4 py-2 text-right font-medium">At floor</th>
                  <th className="px-4 py-2 text-right font-medium">Due now</th>
                  <th className="px-4 py-2 font-medium" title="When the last sliding product reaches its floor, if every move is made on time and nothing sells">Reaches floor</th>
                  <th className="px-4 py-2 font-medium">Due date</th>
                  <th className="px-4 py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const overdue = g.due_date && today && g.due_date < today && g.state !== 'ended';
                  return (
                    <tr
                      key={g.id}
                      onClick={() => router.push(`/slider/${g.id}`)}
                      className="cursor-pointer border-b border-slate-100 text-slate-700 last:border-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-2.5">
                        <Link href={`/slider/${g.id}`} className="inline-flex items-center gap-2 font-medium text-slate-900 hover:text-brand-700 hover:underline">
                          <ChannelLogo channel={g.channel === 'SHP' ? 'shopify' : 'amazon'} />
                          {g.name}
                        </Link>
                        <div className="mt-0.5 text-xs text-slate-500">{rulesSummary(g)}</div>
                        {g.off_track > 0 && <div className="mt-0.5 text-xs text-amber-700">{g.off_track} priced by hand</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{g.counts.sliding}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{g.counts.found || ''}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">{g.counts.floor || ''}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className="font-semibold text-slate-900">{g.due_now || ''}</span>
                        {g.no_stock > 0 && <div className="text-xs text-slate-400" title="Due, but no stock — not cut until it can sell">{g.no_stock} no stock</div>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{fmtDay(g.floor_by, today)}</td>
                      <td className={`px-4 py-2.5 whitespace-nowrap ${overdue ? 'font-medium text-red-700' : ''}`} title={overdue ? 'Past its due date' : undefined}>
                        {fmtDay(g.due_date, today)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${GROUP_STATE_COLOR[g.state]}`}>{GROUP_STATE_LABEL[g.state]}</span>
                      </td>
                    </tr>
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
