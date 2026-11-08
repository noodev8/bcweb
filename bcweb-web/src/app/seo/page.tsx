'use client';
/*
=======================================================================================================================================
Page: /seo — SEO TRACKER (owner, 2026-11-07; the "SEO" tile in the dashboard's Google group)
=======================================================================================================================================
Purpose: "is it working, and are we motivated to continue?" — before the Birkenstock work list (/seo/styles, one click on). Owner:
"ultimately we want purchases, and then probably visits before the purchase". The goal (docs/seo/PLAN.md): more Shopify sales we
didn't pay Google for. (The team's visits target is kept internally — never shown here.)

Order of the page = order of importance:
  1. FREE SALES — every sale not from an ad (owner's choice: Google free, AI, other search, Direct, Email, Social, Other site; THE
     list is utils/orderSource.js → NOT_FREE). Last 28 days and the YEAR SO FAR, each against the same days a year earlier.
  2. VISITS — Shopify sessions (owner chose them over GA4's ~2×): a day over the last 7 days, as a plain number — NO TARGET on screen
     (owner: "We can set our targets internally"); 28 days vs a year earlier; orders per 100 visits.
  3. AI — the fastest-growing source, year so far vs last year.
  4. GOOGLE'S VIEW — Search Console free clicks / position, an early sign, never the score.
  5. Where sales and visits came from (28 days) and MONTH BY MONTH, this year beside last. Plain tables — no charts (owner, on Range:
     "No bar charts … Just totals").
Our own data first (shopify_order_source, shopify_sessions_daily), Google's last. Colour only as small up/down text. READ ONLY.
Server: GET /seo-tracker.
=======================================================================================================================================
*/

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSeoTracker } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');
const gbp = (v: number) => `£${n(v)}`;
const day = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};

// "▲ 12%" / "▼ 8%" against last year. `lowerIsBetter` for position.
function Change({ now, ly, lowerIsBetter = false }: { now: number | null; ly: number | null; lowerIsBetter?: boolean }) {
  if (now == null || ly == null || ly === 0) return <span className="text-xs text-slate-400">no figure last year</span>;
  const pct = Math.round(((now - ly) / ly) * 100);
  if (pct === 0) return <span className="text-xs text-slate-500">same as last year</span>;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return (
    <span className={'text-xs font-medium ' + (good ? 'text-emerald-700' : 'text-rose-700')}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% on last year
    </span>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

// A big figure with last year's beside it.
function Figure({ label, now, ly, nowRaw, lyRaw, lowerIsBetter }: {
  label: string; now: string; ly: string; nowRaw: number | null; lyRaw: number | null; lowerIsBetter?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-3xl font-semibold tabular-nums text-slate-900">{now}</p>
      <p className="text-sm tabular-nums text-slate-500">last year {ly}</p>
      <Change now={nowRaw} ly={lyRaw} lowerIsBetter={lowerIsBetter} />
    </div>
  );
}

export default function SeoTrackerPage() {
  const q = useApiQuery('seo-tracker', () => getSeoTracker());
  const t = q.data;

  return (
    <AppShell title="SEO tracker">
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {t && (
        <div className="space-y-5">
          <p className="text-sm text-slate-500">
            Sales and visits we didn’t pay Google for — each against the same days a year earlier, so the seasons don’t mislead.
            Figures to {day(t.sales.d28.now.to)}.
          </p>

          {/* 1. FREE SALES — the one that matters. */}
          <Card title="Free sales" sub="Every sale not from an ad — Google free, AI, other search, direct, email, social, other sites">
            <div className="grid gap-6 sm:grid-cols-2">
              <Figure
                label="Last 28 days"
                now={`${n(t.sales.d28.now.orders)} orders · ${gbp(t.sales.d28.now.gbp)}`}
                ly={`${n(t.sales.d28.ly.orders)} · ${gbp(t.sales.d28.ly.gbp)}`}
                nowRaw={t.sales.d28.now.gbp} lyRaw={t.sales.d28.ly.gbp}
              />
              <Figure
                label={`Year so far (from ${day(t.sales.ytd.now.from)})`}
                now={`${n(t.sales.ytd.now.orders)} orders · ${gbp(t.sales.ytd.now.gbp)}`}
                ly={`${n(t.sales.ytd.ly.orders)} · ${gbp(t.sales.ytd.ly.gbp)}`}
                nowRaw={t.sales.ytd.now.gbp} lyRaw={t.sales.ytd.ly.gbp}
              />
            </div>
            {t.sales.unknown_share != null && (
              <p className="mt-4 text-xs text-slate-400">
                Not counted: paid ads, and orders we can’t trace ({Math.round(t.sales.unknown_share * 100)}% of web orders in the last
                28 days — the shopper declined tracking).
              </p>
            )}
          </Card>

          {/* 2. VISITS — the step before a sale. */}
          {/* Just the number — no target on screen (owner, 2026-11-07: "Dont indicate a target on that screen … We can set our targets
              internally"). */}
          <Card title="Visits" sub="Shopify sessions">
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-sm text-slate-500">A day, last 7 days</p>
                {/* Total and FREE (not from an ad) side by side — owner, 2026-11-07: "add free visits a day next to the total". */}
                <div className="flex items-baseline gap-5">
                  <div>
                    <p className="text-3xl font-semibold tabular-nums text-slate-900">{t.visits.avg7.toFixed(0)}</p>
                    <p className="text-xs text-slate-500">all visits</p>
                  </div>
                  <div>
                    <p className="text-3xl font-semibold tabular-nums text-slate-900">{t.visits.avg7_free.toFixed(0)}</p>
                    <p className="text-xs text-slate-500">free (not from an ad)</p>
                  </div>
                </div>
              </div>
              <Figure label="Last 28 days" now={n(t.visits.d28.now)} ly={n(t.visits.d28.ly)} nowRaw={t.visits.d28.now} lyRaw={t.visits.d28.ly} />
              <Figure
                label="Orders per 100 visits (28 days)"
                now={t.visits.per100.now == null ? '—' : t.visits.per100.now.toFixed(1)}
                ly={t.visits.per100.ly == null ? '—' : t.visits.per100.ly.toFixed(1)}
                nowRaw={t.visits.per100.now} lyRaw={t.visits.per100.ly}
              />
            </div>
            <p className="mt-4 text-xs text-slate-400">
              Paid and free Google visits can be told apart from {day(t.paid_split_from)}, when the Google Ads tracking code was set.
            </p>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* 3. AI */}
            <Card title="AI (ChatGPT and others)" sub={`Year so far, from ${day(t.ai.ytd.from)}`}>
              <div className="grid grid-cols-2 gap-6">
                <Figure label="Visits" now={n(t.ai.ytd.now.visits)} ly={n(t.ai.ytd.ly.visits)} nowRaw={t.ai.ytd.now.visits} lyRaw={t.ai.ytd.ly.visits} />
                <Figure
                  label="Orders"
                  now={`${n(t.ai.ytd.now.orders)} · ${gbp(t.ai.ytd.now.gbp)}`}
                  ly={`${n(t.ai.ytd.ly.orders)} · ${gbp(t.ai.ytd.ly.gbp)}`}
                  nowRaw={t.ai.ytd.now.orders} lyRaw={t.ai.ytd.ly.orders}
                />
              </div>
              <p className="mt-4 text-xs text-slate-400">Google’s own AI summaries count as Google, not here.</p>
            </Card>

            {/* 4. GOOGLE'S VIEW */}
            <Card title="Google’s view" sub={t.google ? `Search Console, free results only — 28 days to ${day(t.google.to)}` : 'Search Console'}>
              {t.google ? (
                <div className="grid grid-cols-2 gap-6">
                  <Figure label="Free clicks" now={n(t.google.now.clicks)} ly={n(t.google.ly.clicks)} nowRaw={t.google.now.clicks} lyRaw={t.google.ly.clicks} />
                  <Figure
                    label="Average position"
                    now={t.google.now.position == null ? '—' : t.google.now.position.toFixed(1)}
                    ly={t.google.ly.position == null ? '—' : t.google.ly.position.toFixed(1)}
                    nowRaw={t.google.now.position} lyRaw={t.google.ly.position} lowerIsBetter
                  />
                </div>
              ) : <p className="text-sm text-slate-400">Search Console couldn’t be read just now.</p>}
              <p className="mt-4 text-xs text-slate-400">An early sign only — sales and visits above are the score.</p>
            </Card>
          </div>

          {/* 5. WHERE FROM (28 days) */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Where sales came from" sub="Last 28 days">
              <table className="w-full text-sm">
                <tbody>
                  {t.sales.by_source.map((r) => (
                    <tr key={r.came_from} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pr-3 text-slate-700">
                        {r.came_from}
                        {r.free && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">free</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{n(r.orders)}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">{gbp(r.gbp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Where visits came from" sub="Last 28 days">
              <table className="w-full text-sm">
                <tbody>
                  {t.visits.by_source.map((r) => (
                    <tr key={r.came_from} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pr-3 text-slate-700">{r.came_from}</td>
                      <td className="py-1.5 text-right tabular-nums">{n(r.visits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          {/* MONTH BY MONTH — this year beside last. */}
          <Card title="Month by month" sub="Free sales and all visits, this year beside last year">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="py-1.5 pr-3 text-left font-medium">Month</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Free orders</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-slate-400">last year</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Free £</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-slate-400">last year</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Visits</th>
                    <th className="py-1.5 text-right font-medium text-slate-400">last year</th>
                  </tr>
                </thead>
                <tbody>
                  {t.months.map((m) => (
                    <tr key={m.month} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pr-3 text-slate-700">{m.label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{m.now ? n(m.now.orders) : ''}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">{n(m.ly.orders)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{m.now ? gbp(m.now.gbp) : ''}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">{gbp(m.ly.gbp)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{m.now ? n(m.now.visits) : ''}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">{n(m.ly.visits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-400">This month runs to yesterday, so it is short of a full month.</p>
          </Card>

          {/* On to the work. */}
          <Link
            href="/seo/styles"
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:bg-slate-50"
          >
            <span>
              <span className="block font-semibold text-slate-900">Work list — Birkenstock styles</span>
              <span className="block text-sm text-slate-500">What to work on: each style’s pages, description length, Google searches and profit.</span>
            </span>
            <ChevronRightIcon className="h-5 w-5 text-slate-400" />
          </Link>
        </div>
      )}
    </AppShell>
  );
}
