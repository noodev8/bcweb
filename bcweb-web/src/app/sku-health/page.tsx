'use client';
/*
=======================================================================================================================================
Page: /sku-health — the Admin screen's three numbers (owner, 2026-11-03: "keep it simple, very simple").
  - Sellers (90 days): SKUs that sold on any channel in 90 days — the number to grow.
  - In stock now: SKUs with stock, locally or at FBA.
  - Not sold in 12 months: SKUs in the size map with no sale in a year — the number to bring down. Not called "dead" on screen.

Layout (owner, 2026-11-03: "too many numbers spread everywhere and not sure which dates im looking at"):
  - One line under the title says the boxes are LIVE, with today's date, and whether this week has been saved.
  - Each box: the live number, ONE comparison (against the last saved week, dated), and a small line of the saved weeks with the first
    and last dates under it — the trend is read from the shape, not from a column of deltas.
  - The week-by-week figures are still there but folded away ("Show the weekly figures"), dates written out ("Mon 26 Oct 2026"),
    the change shown only as a small arrow and number in its own column, one metric per column group.
Save snapshot writes THIS week's row (keyed on the Monday); pressing it again in the same week updates that row.
Kept off the Daily hero so staff are not confused. A failed load shows a message, never a broken page.
=======================================================================================================================================
*/

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { getSkuHealth, getSkuHealthHistory, saveSkuHealth, SkuHealthRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

type Key = 'sellers90' | 'inStock' | 'notSold12m';

const METRICS: { key: Key; label: string; hint: string; goodWhenUp: boolean; goal: string }[] = [
  { key: 'sellers90', label: 'Sellers (90 days)', hint: 'SKUs that sold in the last 90 days, any channel', goodWhenUp: true, goal: 'Aim: up' },
  { key: 'inStock', label: 'In stock now', hint: 'SKUs with stock, locally or at FBA', goodWhenUp: true, goal: 'Aim: up' },
  { key: 'notSold12m', label: 'Not sold in 12 months', hint: 'SKUs with no sale in a year', goodWhenUp: false, goal: 'Aim: down' },
];

const fmt = (n: number) => n.toLocaleString('en-GB');

// 'YYYY-MM-DD' -> 'Mon 26 Oct 2026' / '26 Oct'. Built from the parts (never new Date('YYYY-MM-DD'), which is UTC midnight).
function dateOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const longDate = (iso: string) =>
  dateOf(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = (iso: string) => dateOf(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// This week's Monday as YYYY-MM-DD (the key the Save button writes).
function thisMonday(): string {
  const t = new Date();
  const back = (t.getDay() + 6) % 7;
  const m = new Date(t.getFullYear(), t.getMonth(), t.getDate() - back);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}

function tone(d: number, goodWhenUp: boolean) {
  if (d === 0) return 'text-slate-400';
  return d > 0 === goodWhenUp ? 'text-emerald-700' : 'text-red-700';
}
function Change({ d, goodWhenUp }: { d: number; goodWhenUp: boolean }) {
  if (d === 0) return <span className="text-slate-400">no change</span>;
  return <span className={tone(d, goodWhenUp)}>{d > 0 ? '▲' : '▼'} {fmt(Math.abs(d))}</span>;
}

// A small line of the saved weeks, oldest left. Weeks with no figure (in stock before saving started) are skipped.
function Spark({ points, goodWhenUp }: { points: { date: string; v: number }[]; goodWhenUp: boolean }) {
  if (points.length < 2) {
    return <p className="mt-4 text-xs text-slate-400">The trend line starts once a few weeks are saved.</p>;
  }
  const W = 300, H = 56, pad = 4;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const first = points[0], last = points[points.length - 1];
  const colour = last.v === first.v ? '#94a3b8' : last.v > first.v === goodWhenUp ? '#047857' : '#b91c1c';
  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" preserveAspectRatio="none" role="img"
        aria-label={`Weekly trend from ${first.v} to ${last.v}`}>
        <path d={d} fill="none" stroke={colour} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.v)} r={6} fill="transparent">
            <title>{`Week of ${longDate(p.date)}: ${fmt(p.v)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{shortDate(first.date)} · {fmt(first.v)}</span>
        <span>{shortDate(last.date)} · {fmt(last.v)}</span>
      </div>
    </div>
  );
}

export default function SkuHealthPage() {
  const live = useApiQuery('sku-health', getSkuHealth);
  const history = useApiQuery('sku-health-history', getSkuHealthHistory);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showWeeks, setShowWeeks] = useState(false);

  const d = live.data;
  const rows: SkuHealthRow[] = history.data ?? []; // newest first
  const oldestFirst = [...rows].reverse();
  const monday = thisMonday();
  const thisWeek = rows.find((r) => r.date === monday) ?? null;
  // The comparison for the live boxes: the newest saved week BEFORE this one (this week's own row is today's figure, near enough).
  const lastWeek = rows.find((r) => r.date < monday) ?? null;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  async function onSave() {
    setSaving(true);
    setNote(null);
    const r = await saveSkuHealth();
    setSaving(false);
    if (!r.success) {
      setNote(r.error || 'Could not save the snapshot.');
      return;
    }
    setNote(r.data?.updated ? 'This week’s row has been updated.' : 'This week saved.');
    await Promise.all([live.refresh(), history.refresh()]);
  }

  return (
    <AppShell title="SKU health" backHref="/dashboard?g=reports" backLabel="Dashboard">
      {/* WHEN: one line, so the reader always knows the boxes are today's live figures. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">Live today</span> — {today}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {note ??
              (thisWeek
                ? `This week (from ${shortDate(monday)}) saved${thisWeek.savedBy ? ` by ${thisWeek.savedBy}` : ''}`
                : `This week (from ${shortDate(monday)}) not saved yet`)}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : thisWeek ? 'Update this week' : 'Save this week'}
          </button>
        </div>
      </div>

      {live.error ? (
        <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-red-700">{live.error.message}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {METRICS.map((m) => {
            const value = d?.[m.key];
            const before = lastWeek?.[m.key];
            const points = oldestFirst
              .filter((r) => r[m.key] !== null)
              .map((r) => ({ date: r.date, v: r[m.key] as number }));
            return (
              <div key={m.key} className="rounded-xl border border-slate-200 bg-white px-6 py-5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-slate-700">{m.label}</div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">{m.goal}</div>
                </div>
                <div className="mt-2 text-4xl font-semibold tabular-nums text-slate-900">
                  {value === undefined ? '–' : fmt(value)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {value !== undefined && before !== null && before !== undefined && lastWeek ? (
                    <>
                      <Change d={value - before} goodWhenUp={m.goodWhenUp} /> since week of {shortDate(lastWeek.date)}
                    </>
                  ) : (
                    m.hint
                  )}
                </div>
                <Spark points={points} goodWhenUp={m.goodWhenUp} />
                {before !== null && before !== undefined && lastWeek && (
                  <div className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">{m.hint}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Boxes are today&rsquo;s live figures. Each line is one point per week (the figure on that Monday); stock was not kept before
        saving started, so its line begins with the first saved week.
      </p>

      <div className="mt-8">
        <button
          type="button"
          onClick={() => setShowWeeks((s) => !s)}
          className="text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          {showWeeks ? '▾ Hide the weekly figures' : `▸ Show the weekly figures (${rows.length} weeks)`}
        </button>

        {showWeeks &&
          (history.error ? (
            <p className="mt-2 rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-red-700">{history.error.message}</p>
          ) : rows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No weeks saved yet.</p>
          ) : (
            <div className="mt-2 max-w-3xl overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Week starting</th>
                    {METRICS.map((m) => (
                      <th key={m.key} colSpan={2} className="px-4 py-2 text-right font-medium">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const prev = rows[i + 1]; // newest first, so the week before is the next row down
                    return (
                      <tr key={r.date} className="border-t border-slate-100">
                        <td className="whitespace-nowrap px-4 py-1.5 text-slate-700">
                          {longDate(r.date)}
                          {r.savedBy && r.savedBy !== 'backfill' && (
                            <span className="ml-2 text-xs text-slate-400">saved by {r.savedBy}</span>
                          )}
                        </td>
                        {METRICS.map((m) => {
                          const v = r[m.key];
                          const p = prev?.[m.key];
                          return [
                            <td key={`${m.key}v`} className="py-1.5 pl-4 text-right tabular-nums text-slate-900">
                              {v === null ? <span className="text-slate-300">–</span> : fmt(v)}
                            </td>,
                            <td key={`${m.key}d`} className="w-16 py-1.5 pl-2 pr-4 text-right text-xs tabular-nums">
                              {v !== null && p !== null && p !== undefined ? (
                                v === p ? (
                                  <span className="text-slate-300">·</span>
                                ) : (
                                  <span className={tone(v - p, m.goodWhenUp)}>
                                    {v > p ? '▲' : '▼'}
                                    {fmt(Math.abs(v - p))}
                                  </span>
                                )
                              ) : null}
                            </td>,
                          ];
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </AppShell>
  );
}
