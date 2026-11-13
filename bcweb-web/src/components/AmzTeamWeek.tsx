'use client';
/*
=======================================================================================================================================
Component: AmzTeamWeek  (the "Team week" panel on the Amazon Pricing home, /amz — was the Buy Box screen; owner, 2026-11-12; docs/amz-buybox/PLAN.md point 12)
=======================================================================================================================================
What each person's Amazon price changes did to the Buy Box this week (or last). Server GET /amz-buybox-team; THE rules are
bcweb-server/utils/amzBuyBoxTeam.js (read its header before changing a word here). READ ONLY.
"MOVES TO LOOK AT TOGETHER" REMOVED (owner, 2026-11-13: "Remove 'Moves to look at together'"): the count on the line, the To look at
column and the list. The server still sends `look` (unused here); it is in git history if wanted back.

The HEADLINE is results (owner: "staff progress and what they have actually achieved. Will also motivate them"): Won back, Raises
kept and the extra profit on pairs sold at the raised price. Price changes are shown small, for context only, never as the score.
Seen by everyone (owner: "A,
seen by everyone. we can move it later if too much noise"). Collapsed to one line by default so it doesn't crowd the To do boxes.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { getAmzBuyBoxTeam } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);
function when(ts: string): string {
  const t = Date.parse(ts.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  if (!Number.isFinite(t)) return ts;
  return new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export default function AmzTeamWeek() {
  const { data } = useApiQuery(['amz-buybox-team'], () => getAmzBuyBoxTeam(), { revalidateIfStale: false, revalidateOnMount: true, revalidateOnReconnect: false });
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState<'this' | 'last'>('this');
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
                  <th className="py-1 text-right font-medium">Won back</th>
                  <th className="py-1 text-right font-medium">Raises kept</th>
                  <th className="py-1 text-right font-medium">Extra profit</th>
                  <th className="py-1 text-right font-medium">Price changes</th>
                  <th className="py-1 text-right font-medium">Not judged</th>
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
                        : p.raises_kept > 0 && p.kept_pairs === 0 ? <span className="text-xs text-slate-400">none sold yet</span>
                        : '—'}
                      {p.kept_pairs > 0 && <span className="text-xs text-slate-400"> · {p.kept_pairs} pairs</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400">{p.changes}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400">
                      {p.waiting + p.superseded + p.not_judged || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
