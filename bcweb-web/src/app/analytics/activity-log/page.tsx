'use client';
/*
=======================================================================================================================================
Page: /analytics/activity-log  (Reports module — Activity Log)
=======================================================================================================================================
Purpose: A plain read of `bclog` — the "who did what, when" ledger that bcweb and the legacy PowerBuilder app both write. Search box plus
         three filters (window, section, who/where) and a newest-first table. READ ONLY, on purpose: a log you can edit is not a record.

         Deliberately nothing fancy — no summaries, no charts. It is where you go when you need to know whether something happened.

         Filtering is SERVER-SIDE (the table is thousands of rows), so every control is part of the query key. The search box is
         debounced so typing doesn't fire a request per keystroke. Previous rows stay on screen (dimmed) while a new filter loads, so the
         table doesn't flash empty on every change.

Guarded by AppShell. Consumes GET /analytics-activity-log.
=======================================================================================================================================
*/

import { useState } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { useDebounced } from '@/lib/useDebounced';
import { getActivityLog, ActivityLogRow } from '@/lib/api';

// Window choices. 0 = the whole log — a log is often searched precisely because you don't know when the thing happened.
const WINDOWS = [
  { days: 1, label: '24 hours' },   // a trailing window on created_at, not the calendar day — so not labelled "Today"
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'All' },
];
const LIMIT = 500;

const NO_ROWS: ActivityLogRow[] = [];
const NO_LIST: string[] = [];

export default function ActivityLogPage() {
  const [days, setDays] = useState(30);
  const [section, setSection] = useState('');
  const [who, setWho] = useState('');
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim(), 350);

  const { data, error: loadError, busy } = useApiQuery(
    ['activity-log', days, section, who, q],
    () => getActivityLog({ days, section, who, q, limit: LIMIT }),
    { keepPreviousData: true },
  );
  const rows = data?.rows ?? NO_ROWS;
  const sections = data?.sections ?? NO_LIST;
  const people = data?.people ?? NO_LIST;
  const total = data?.total ?? 0;
  const error = loadError?.message ?? null;

  const filtered = days !== 30 || section !== '' || who !== '' || term !== '';
  const clearAll = () => { setDays(30); setSection(''); setWho(''); setTerm(''); };

  const selectCls =
    'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400';

  return (
    <AppShell title="Bclog" backHref="/analytics" backLabel="Reports">
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search the log…"
            className="w-64 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              aria-pressed={days === w.days}
              className={
                'rounded-md px-3 py-1.5 text-sm font-medium transition ' +
                (days === w.days ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')
              }
            >
              {w.label}
            </button>
          ))}
        </div>

        <select value={section} onChange={(e) => setSection(e.target.value)} className={selectCls} title="Filter by section">
          <option value="">All sections</option>
          {sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* "Who or where": the column holds PowerBuilder machine names (WS1…) AND bcweb login names — both are honest values. */}
        <select value={who} onChange={(e) => setWho(e.target.value)} className={selectCls} title="Filter by person or workstation">
          <option value="">Anyone, anywhere</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        {filtered && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <XMarkIcon className="h-4 w-4" /> Clear
          </button>
        )}
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!data && busy && <p className="text-sm text-slate-400">Loading…</p>}

      {data && (
        <div aria-busy={busy} className={'transition-opacity duration-200 ' + (busy ? 'opacity-60' : 'opacity-100')}>
          <p className="mb-2 text-xs text-slate-400">
            {data.truncated
              ? `Newest ${rows.length.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} — narrow the filters to see older entries`
              : `${total.toLocaleString('en-GB')} ${total === 1 ? 'entry' : 'entries'}`}
          </p>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing in the log matches these filters.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-3 py-2.5 font-medium">Who / where</th>
                    <th className="px-3 py-2.5 font-medium">Section</th>
                    <th className="px-4 py-2.5 font-medium">Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 align-top last:border-0 hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-500">
                        {fmtDate(r.date)} <span className="ml-1 text-slate-400">{r.time}</span>
                      </td>
                      {/* Clicking a label sets that filter — quicker than finding it in the dropdown. */}
                      <td className="whitespace-nowrap px-3 py-2">
                        <button type="button" onClick={() => setWho(r.who)} className="text-slate-700 hover:text-brand-600 hover:underline">
                          {r.who || '—'}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button type="button" onClick={() => setSection(r.section)} className="text-slate-700 hover:text-brand-600 hover:underline">
                          {r.section || '—'}
                        </button>
                      </td>
                      <td className="break-words px-4 py-2 text-slate-800">{r.log}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

// 'YYYY-MM-DD' -> '14 Sep 2026'. Parsed by hand, NOT via new Date(): the string is already a London calendar date, and handing it to
// Date would read it as UTC midnight and risk shifting the day.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(d: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d || '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
