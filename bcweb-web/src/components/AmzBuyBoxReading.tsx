'use client';
/*
=======================================================================================================================================
Component: AmzBuyBoxReading — the headline Buy Box % and how old the reading is (a title row's right side)
=======================================================================================================================================
Shared by the Amazon Pricing home (/amz) and Sizes at Amazon (/amz/buybox) — PLAN.md decision 24: the table moved behind a link, the
headline and the reading's age stayed in the home's title row. Moved out of the old Buy Box screen unchanged (2026-11-13).

The reading is the DATABASE (amz_buybox_now — the hourly cron, or Read this style on Sizes at Amazon): opening a screen never asks
Amazon. Amber when an hourly read looks missed: over 2 hours old during the hours it runs (UK 9am–8pm) — overnight it is naturally
~14 hours old by morning, no warning for that. While a read runs it shows its progress.
=======================================================================================================================================
*/

import { useEffect, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import type { AmzBuyBoxData } from '@/lib/api';

// pg timestamptz text ("2026-11-12 00:39:55.13+00") -> ms. A real instant, so Date is right here (not a date-only string).
export function toMs(ts: string | null | undefined): number | null {
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

export default function AmzBuyBoxReading({ data, msg }: { data: AmzBuyBoxData | undefined; msg?: string | null }) {
  // The clock for "n min ago" — ticks every 30 s. Taken in state, never during a render (react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const running = data?.running ?? null;
  const lastAllMs = toMs(data?.last_all?.finished_at);
  const lastRun = data?.last_run;
  const ukHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' }).format(now));
  const stale = lastAllMs !== null && now - lastAllMs > 2 * 3600 * 1000 && ukHour >= 9 && ukHour < 20;

  return (
    <div className="flex flex-col items-end gap-0.5 text-right">
      {data?.headline && data.headline.sizes > 0 && (
        <div className="flex items-baseline gap-2" title={`Our share of page views, averaged across the ${data.headline.sizes} sizes live at FBA`}>
          <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{data.headline.avg_share !== null ? `${Math.round(data.headline.avg_share)}%` : '—'}</span>
          <span className="text-sm text-slate-500">of page views show our offer</span>
        </div>
      )}
      <div className="text-sm text-slate-500">
        {running ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-brand-700">
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
            {running.scope && running.scope !== 'all'
              ? <>Reading {running.scope}…</>
              : <>Reading Amazon… {running.done ?? 0} of {running.total} sizes</>}
          </span>
        ) : data?.last_all ? (
          <span title={`${clock(lastAllMs)} — read every hour`}>
            Buy Box read <span className={stale ? 'font-medium text-amber-700' : 'text-slate-700'}>{ago(lastAllMs, now)}</span>
            {' '}· {data.last_all.total} sizes
            {stale && <span className="text-amber-700"> — the hourly read may have stopped</span>}
          </span>
        ) : data ? (
          <span>No Buy Box reading yet — the hourly read fills this in.</span>
        ) : null}
        {lastRun && lastRun.status === 'error' && !running && (
          <span className="ml-2 text-red-600" title={lastRun.error || ''}>Last read failed: {lastRun.error}</span>
        )}
        {msg && <span className="ml-2 text-xs">{msg}</span>}
      </div>
    </div>
  );
}
