'use client';
/*
=======================================================================================================================================
Component: AmzBuyBoxReading — how old the Buy Box reading is (a title row's right side)
=======================================================================================================================================
Shared by the Amazon Pricing home (/amz) and Sizes at Amazon (/amz/buybox) — PLAN.md decision 24. The headline % moved OUT of the
title row into its own strip on the home (components/AmzBuyBoxStrip, owner 2026-11-21: option A), and the "· n sizes" after the age
went with it (it counted every size read, incl. inbound — 347 beside the strip's 281 read as a mistake).

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
      <div className="text-sm text-slate-500">
        {running ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-brand-700">
            <ArrowPathIcon className="h-4 w-4 animate-spin" />
            {running.scope && running.scope !== 'all'
              ? <>Reading {running.scope}…</>
              : <>Reading Amazon… {running.done ?? 0} of {running.total} sizes</>}
          </span>
        ) : data?.last_all ? (
          <span>
            Buy Box read <span className={stale ? 'font-medium text-amber-700' : 'text-slate-700'}>{ago(lastAllMs, now)}</span>
            {stale && <span className="text-amber-700"> — the hourly read may have stopped</span>}
          </span>
        ) : data ? (
          <span>No Buy Box reading yet — the hourly read fills this in.</span>
        ) : null}
        {lastRun && lastRun.status === 'error' && !running && (
          <span className="ml-2 text-red-600">Last read failed: {lastRun.error}</span>
        )}
        {msg && <span className="ml-2 text-xs">{msg}</span>}
      </div>
    </div>
  );
}
