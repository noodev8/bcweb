'use client';
/*
=======================================================================================================================================
Component: UpdateShopifyTile
=======================================================================================================================================
Purpose: A dashboard menu card that RUNS the Shopify order update when clicked, instead of opening a screen (owner, 2026-09-24 — chosen
         over a small "Update Shopify" screen). It is the "Update orders" button from Sales / Customer Orders in the shape of a menu
         card: same POST /order-sync, same run handling (useUpdateOrders in UpdateOrdersButton.tsx — shared, not copied).

THE ONE CARD THAT DOES SOMETHING. Every other card on the menu only navigates, so this one says what it did right on its face: the
subtitle is swapped for "Updating…", then the run's headline (or the error), in place. There is nowhere else on the dashboard for a
result to go, and a card that ran silently would read as a dead link.
A stray click is cheap: a run is a "do it now" of what cron does anyway (the pipeline is idempotent), and the card locks while running.
=======================================================================================================================================
*/

import { useState } from 'react';
import { CloudArrowDownIcon } from '@heroicons/react/24/outline';
import { useUpdateOrders } from '@/components/UpdateOrdersButton';

export default function UpdateShopifyTile({ title, subtitle }: { title: string; subtitle: string }) {
  const [error, setError] = useState<string | null>(null);
  const { running, note, run } = useUpdateOrders({ onError: setError });

  // What the second line says: the run's state once there is one, otherwise the plain subtitle.
  const line = running ? 'Updating…' : error ?? note ?? subtitle;
  const tone = running ? 'text-slate-500' : error ? 'text-red-600' : note ? 'text-emerald-700' : 'text-slate-500';

  return (
    <button
      type="button"
      onClick={run}
      disabled={running}
      className="flex h-full w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:border-brand-500 hover:shadow-md disabled:cursor-wait"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <CloudArrowDownIcon className={'h-5 w-5 ' + (running ? 'animate-pulse' : '')} />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-snug text-slate-900">{title}</h3>
        <p className={'mt-0.5 text-xs leading-snug ' + tone}>{line}</p>
      </div>
    </button>
  );
}
