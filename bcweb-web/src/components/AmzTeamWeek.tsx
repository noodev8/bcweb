'use client';
/*
=======================================================================================================================================
Component: AmzTeamWeek  (the "Team week" panel on the Amazon Pricing home, /amz — was the Buy Box screen; owner, 2026-11-12; docs/amz-buybox/PLAN.md point 12)
=======================================================================================================================================
What each person's Amazon price changes did to the Buy Box this week (or last), and the moves to look at together. Server
GET /amz-buybox-team; THE rules are bcweb-server/utils/amzBuyBoxTeam.js (read its header before changing a word here). READ ONLY.

The HEADLINE is results (owner: "staff progress and what they have actually achieved. Will also motivate them"): Won back, Raises
kept and the extra profit on pairs sold at the raised price. Price changes are shown small, for context only, never as the score.
The list is worded as what the SYSTEM would have done otherwise, never as a mark against someone. Seen by everyone (owner: "A,
seen by everyone. we can move it later if too much noise"). Collapsed to one line by default so it doesn't crowd the To do boxes.
=======================================================================================================================================
*/

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { getAmzBuyBoxTeam, type AmzTeamLook, type AmzTeamWhy } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);

const WHY: Record<AmzTeamWhy, { tag: string; say: (l: AmzTeamLook) => string }> = {
  held: { tag: 'Already 100%', say: () => 'We were already shown to every view, so the Buy Box was ours. The system would have left the price, unless this was a call on demand (not selling).' },
  under: { tag: 'Under the lead', say: (l) => `Cut to more than 1% under the lead price (${money(l.before.lead_price)}). Matching it would have done; the rest is margin given away.` },
  tie: { tag: 'Tie', say: () => 'A rival was tied at our price. Going under starts the race with the copier, so the system leaves ties for now.' },
  not_live: { tag: 'Not live at FBA', say: () => 'Nothing was live at FBA, so Amazon couldn’t feature the offer at any price.' },
  walk: { tag: 'Under walk-away', say: (l) => `Under the £3-a-pair walk-away price (${money(l.walk)}).` },
};

function when(ts: string): string {
  const t = Date.parse(ts.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  if (!Number.isFinite(t)) return ts;
  return new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export default function AmzTeamWeek() {
  const { data } = useApiQuery(['amz-buybox-team'], () => getAmzBuyBoxTeam(), { revalidateIfStale: false, revalidateOnReconnect: false });
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState<'this' | 'last'>('this');
  const [showLook, setShowLook] = useState(false);
  if (!data) return null;

  const week = data.weeks[which];
  const people = week.people.filter((p) => p.changes > 0 || p.holds > 0);
  const thisWeek = data.weeks.this;

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
        {open ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
        <span className="font-medium text-slate-900">Team this week</span>
        {thisWeek.people.filter((p) => p.changes > 0).map((p) => (
          <span key={p.name} className="text-slate-600">
            {p.name}: <span className="font-semibold tabular-nums text-slate-900">{p.won_back}</span> won back ·{' '}
            <span className="font-semibold tabular-nums text-slate-900">{p.raises_kept}</span> raises kept
            {p.kept_profit > 0 && <span className="text-emerald-700"> (+{money(p.kept_profit)})</span>}
          </span>
        ))}
        {thisWeek.look.length > 0 && <span className="text-slate-500">· {thisWeek.look.length} moves to look at together</span>}
        {!thisWeek.people.some((p) => p.changes > 0) && <span className="text-slate-500">no price changes yet</span>}
      </button>

      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs">
              {(['this', 'last'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setWhich(k)}
                  className={'rounded px-2.5 py-1 ' + (which === k ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-600 hover:bg-slate-50')}>
                  {k === 'this' ? 'This week' : 'Last week'}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-500">
              Credited only when the price itself explains the Buy Box result. Sales aren’t credited to anyone.
              {data.history_from && <> Buy Box readings start {when(data.history_from)}; earlier changes can’t be judged.</>}
            </span>
          </div>

          {people.length === 0 ? (
            <p className="text-slate-400">No Amazon price changes this week.</p>
          ) : (
            <table className="mb-3 w-full max-w-4xl text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-1 text-left font-medium">Person</th>
                  <th className="py-1 text-right font-medium" title="Shown to more views after a cut that reached the lead price">Won back</th>
                  <th className="py-1 text-right font-medium" title="Raised, and still shown to the same views or more">Raises kept</th>
                  <th className="py-1 text-right font-medium" title="Extra profit on the pairs sold at the raised price since (today's cost and FBA fee)">Extra profit</th>
                  <th className="py-1 text-right font-medium" title="For context only, not the score">Price changes</th>
                  <th className="py-1 text-right font-medium">To look at</th>
                  <th className="py-1 text-right font-medium" title="Waiting for the next reading, or made before the Buy Box readings began / on a size with no rival">Not judged</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.name} className="border-b border-slate-100">
                    <td className="py-1.5 font-medium text-slate-900">{p.name}</td>
                    <td className="py-1.5 text-right text-base font-semibold tabular-nums text-slate-900">{p.won_back}</td>
                    <td className="py-1.5 text-right text-base font-semibold tabular-nums text-slate-900">{p.raises_kept}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">
                      {p.kept_profit > 0 ? <span className="text-emerald-700">+{money(p.kept_profit)}</span>
                        : p.raises_kept > 0 && p.kept_pairs === 0 ? <span className="text-xs text-slate-400" title="Counted from booked sales at the raised price — none yet">none sold yet</span>
                        : '—'}
                      {p.kept_pairs > 0 && <span className="text-xs text-slate-400"> · {p.kept_pairs} pairs</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400" title={`${p.cuts} down · ${p.raises} up · ${p.holds} held at the same price`}>{p.changes}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-700">{p.to_look || '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400"
                      title={`${p.waiting} waiting for the next reading · ${p.superseded} changed again first · ${p.not_judged} before the readings began or no rival`}>
                      {p.waiting + p.superseded + p.not_judged || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {week.look.length > 0 && (
            <>
              <button type="button" onClick={() => setShowLook(!showLook)} className="mb-2 inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                {showLook ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                Moves to look at together · {week.look.length}
              </button>
              {showLook && (
                <div className="overflow-x-auto">
                  <p className="mb-2 text-xs text-slate-500">Changes the system would have made differently, judged on the Buy Box reading just before. Some will be right calls; they’re here to talk through.</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="py-1 text-left font-medium">When</th>
                        <th className="py-1 text-left font-medium">Who</th>
                        <th className="py-1 text-left font-medium">Size</th>
                        <th className="py-1 text-right font-medium">Price</th>
                        <th className="py-1 pl-4 text-left font-medium" title="Our share of views, and the lead offer's price, just before the change">Before</th>
                        <th className="py-1 text-right font-medium" title="Our share of views once Amazon showed the new price">After</th>
                        <th className="py-1 pl-4 text-left font-medium">Why it’s here</th>
                      </tr>
                    </thead>
                    <tbody>
                      {week.look.map((l) => (
                        <tr key={l.id} className="border-b border-slate-100 align-top">
                          <td className="whitespace-nowrap py-1.5 text-slate-500">{when(l.changed_at)}</td>
                          <td className="py-1.5 text-slate-700">{l.by}</td>
                          <td className="py-1.5">
                            <Link href={`/amz/sku/${encodeURIComponent(l.code)}`} title={l.title || undefined} className="font-mono text-xs text-slate-900 hover:underline">{l.code}</Link>
                          </td>
                          <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-slate-700">{money(l.old_price)} → {money(l.new_price)}</td>
                          <td className="whitespace-nowrap py-1.5 pl-4 tabular-nums text-slate-600">shown {pct(l.before.share)} · lead {money(l.before.lead_price)}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-600">{l.after ? pct(l.after.share) : <span className="text-slate-400">waiting</span>}</td>
                          <td className="py-1.5 pl-4">
                            {l.why.map((w) => (
                              <span key={w} title={WHY[w].say(l)} className="mr-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">{WHY[w].tag}</span>
                            ))}
                            {l.result === 'won_back' && <span className="mr-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800" title="It still won views back">won back</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
