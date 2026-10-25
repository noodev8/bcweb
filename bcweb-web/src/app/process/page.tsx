'use client';
/*
=======================================================================================================================================
Page: /process — Process (owner's work in progress, 2026-10-25)
=======================================================================================================================================
Purpose: A READ-ONLY map of the business, read LEFT TO RIGHT as one row of big numbers:

    Prospects → New → Sold → Winner → Loser

  - PROSPECTS: one plain total. Opens /prospects (which links back here).
  - NEW: every size of every style created in the last 90 days (counted in sizes; styles underneath).
  - SOLD: sold on ANY channel (Amazon, Shopify, shop counter), net of returns — a size counts once however many channels it sold on.
  - WINNER: sold at £3+ a unit on ANY channel; Shopify's £3 is AFTER the fixed Google allowance (line = £3 + allowance). The low bar
    on purpose — these are NEW, the other screens measure staying power. A 30-day top-20% bar was rejected (0 on Amazon while good new
    Riekers were still building up).
  - UNSOLD: New minus Sold. Sold + Unsold = New; the pair sits together.
  - LOSER: every new size that is NOT a winner — not sold, or sold under £3 (owner: "even though we sold it, may as well be a loser").
    Winner + Loser = New.
  The caption under Sold / Winner / Loser is ONLY the % of New (owner: just the %) — the share is what should improve quarter on quarter ("future mindset comparison").

Tap New / Sold / Winner / Loser for its sizes below the row; each row shows all three channels and links to where you act on it.
The per-channel cards were removed (owner: "those boxes aren't helping"). The Monday job: load prospects, then fight the losers.

Rules (sold, £ a unit, the line) are server-side in bcweb-server/utils/processMap.js; this page only counts and lists.
Reached from one quiet line at the bottom of the dashboard (lib/features.ts → PROCESS_STRIP).

THE GOOGLE ALLOWANCE: fixed, re-measured quarterly BY BUTTON. Re-measure SHOWS the new figure beside the one in force; nothing changes
until Accept (owner: "display the new fixed number before it is accepted").
=======================================================================================================================================
*/

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import {
  getProcessOverview, measureProcessAllowance, acceptProcessAllowance,
  type ProcessChannel, type ProcessAllowanceMeasure, type ProcessOverview, type ProcessSizeRow,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

const CHANNELS: { id: ProcessChannel; label: string }[] = [
  { id: 'AMZ', label: 'Amazon' },
  { id: 'SHP', label: 'Shopify' },
  { id: 'CM3', label: 'Shop' },
];

type Pick = 'new' | 'sold' | 'unsold' | 'winner' | 'loser';

const SELF = '/process';

const isSold = (r: ProcessSizeRow) => CHANNELS.some((c) => r.channels[c.id].block !== 'not_sold');
const isWinner = (r: ProcessSizeRow) => CHANNELS.some((c) => ['once_good', 'multi_good'].includes(r.channels[c.id].block));
const FILTERS: Record<Pick, (r: ProcessSizeRow) => boolean> = {
  new: () => true,
  sold: isSold,
  unsold: (r) => !isSold(r),
  winner: isWinner,
  loser: (r) => !isWinner(r),
};
const PICK_LABEL: Record<Pick, string> = { new: 'New', sold: 'Sold', unsold: 'Unsold', winner: 'Winner', loser: 'Loser' };

function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}
function money2(v: number): string {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toFixed(2)}`;
}
// % of new — the owner's "future mindset comparison".
function pct(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : '—';
}
// 'YYYY-MM-DD' -> '25 Oct'. Parsed as parts, never through Date (a bare date string is read as UTC/local and can shift a day).
function shortDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${day} ${mon}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

const boxCls = 'inline-flex min-w-[10rem] flex-col rounded-xl border bg-white px-6 py-4 text-left shadow-sm transition';

export default function ProcessPage() {
  const q = useApiQuery('process-overview', () => getProcessOverview());
  const d = q.data;

  // The box whose sizes are listed below the row. null = none open.
  const [open, setOpen] = useState<Pick | null>(null);

  const count = (p: Pick) => (d ? d.rows.filter(FILTERS[p]).length : 0);
  const total = d ? d.rows.length : 0;

  const box = (p: Pick, caption: string) => {
    const isOpen = open === p;
    return (
      <button
        type="button"
        onClick={() => setOpen(isOpen ? null : p)}
        className={boxCls + ' ' + (isOpen ? 'border-brand-500 ring-1 ring-brand-500' : 'border-slate-200 hover:border-brand-500 hover:shadow-md')}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{PICK_LABEL[p]}</span>
        <span className="text-4xl font-semibold tabular-nums text-slate-900">{count(p)}</span>
        <span className="text-xs text-slate-400">{caption}</span>
      </button>
    );
  };

  return (
    <AppShell title="Process">
      {q.isLoading && <div className="py-10 text-center text-sm text-slate-400">Loading…</div>}
      {q.error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{q.error.message}</div>}

      {d && (
        <>
          <section className="flex flex-wrap gap-4">
            <Link
              href={`/prospects?from=${encodeURIComponent(SELF)}`}
              className={boxCls + ' border-slate-200 hover:border-brand-500 hover:shadow-md'}
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Prospects</span>
              <span className="text-4xl font-semibold tabular-nums text-slate-900">{d.prospects}</span>
              <span className="text-xs text-slate-400">on the list</span>
            </Link>
            {box('new', `${d.styles} styles`)}
            {/* Two PAIRS, each adding up to New (100%): Sold + Unsold, Winner + Loser (owner: "so the numbers add up"). Set closer
                together than the other boxes so each pair reads as one. */}
            <div className="flex gap-1.5">
              {box('sold', pct(count('sold'), total))}
              {box('unsold', pct(count('unsold'), total))}
            </div>
            <div className="flex gap-1.5">
              {box('winner', pct(count('winner'), total))}
              {box('loser', pct(count('loser'), total))}
            </div>
          </section>

          {open && <SizeList data={d} pick={open} onClose={() => setOpen(null)} />}

          <AllowanceBar data={d} onAccepted={() => q.refresh()} />
        </>
      )}
    </AppShell>
  );
}

// The fixed Google allowance behind Shopify's line, and its quarterly Re-measure: show the new figure first, change nothing until
// Accept. A MEASURE_CHANGED on Accept (late sales / a re-import moved it) re-measures and shows the new figure again.
function AllowanceBar({ data, onAccepted }: { data: ProcessOverview; onAccepted: () => void }) {
  const a = data.allowance;
  const [proposal, setProposal] = useState<ProcessAllowanceMeasure | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function remeasure() {
    setBusy(true); setMsg(null);
    const res = await measureProcessAllowance();
    setBusy(false);
    if (res.success && res.data) setProposal(res.data);
    else setMsg(res.error || 'Could not measure');
  }
  async function accept() {
    if (!proposal || proposal.perUnit === null) return;
    setBusy(true); setMsg(null);
    const res = await acceptProcessAllowance(proposal.perUnit, proposal.windowTo);
    if (res.success) {
      setProposal(null);
      setBusy(false);
      onAccepted();
      return;
    }
    if (res.return_code === 'MEASURE_CHANGED') {
      const again = await measureProcessAllowance();
      if (again.success && again.data) setProposal(again.data);
    }
    setBusy(false);
    setMsg(res.error || 'Could not save');
  }

  return (
    <div className="mt-8 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-slate-600">
          Google allowance <span className="font-semibold text-slate-900">{a ? money2(a.perUnit) : 'not set'}</span> a Shopify unit
        </span>
        {a && (
          <span className="text-xs text-slate-400">
            accepted {shortDate(a.acceptedOn)} by {a.acceptedBy} · re-measure due {shortDate(a.dueOn)}
          </span>
        )}
        {a?.due && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Due</span>}
        {!proposal && (
          <button
            type="button" onClick={remeasure} disabled={busy}
            className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
          >
            {busy ? 'Measuring…' : 'Re-measure'}
          </button>
        )}
      </div>

      {proposal && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
          {proposal.perUnit === null ? (
            <span className="text-slate-600">Nothing sold on Shopify in {shortDate(proposal.windowFrom)} – {shortDate(proposal.windowTo)}, so there is no figure.</span>
          ) : (
            <span className="text-slate-600">
              New figure <span className="font-semibold text-slate-900">{money2(proposal.perUnit)}</span>
              {a && <span className="text-slate-400"> (now {money2(a.perUnit)})</span>}
              <span className="text-xs text-slate-400">
                {' '}· {money(proposal.spend)} Google spend ÷ {proposal.units.toLocaleString('en-GB')} Shopify units,{' '}
                {shortDate(proposal.windowFrom)} – {shortDate(proposal.windowTo)}
              </span>
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {proposal.perUnit !== null && (
              <button
                type="button" onClick={accept} disabled={busy}
                className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Saving…' : `Accept ${money2(proposal.perUnit)}`}
              </button>
            )}
            <button
              type="button" onClick={() => { setProposal(null); setMsg(null); }} disabled={busy}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
            >
              Keep {a ? money2(a.perUnit) : 'as is'}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-red-700">{msg}</p>}
    </div>
  );
}

// The sizes behind a box, every channel side by side (owner's rule of thumb reads across them: keep a size that is good on ONE).
// Each channel cell links to where that channel is acted on: Amazon → the SKU's Amazon pricing; Shopify / the shop → the style's
// Shopify pricing (the shop sells local stock at the same price).
function SizeList({ data, pick, onClose }: { data: ProcessOverview; pick: Pick; onClose: () => void }) {
  // Losers (and Unsold) OLDEST first (owner, 2026-10-25) — longest without a win at the top. The sort is stable, so a style's sizes stay together
  // in size order. Everything else keeps the server's newest-first.
  const rows = data.rows.filter(FILTERS[pick]);
  if (pick === 'loser' || pick === 'unsold') rows.sort((a, b) => a.created.localeCompare(b.created));
  const from = encodeURIComponent(SELF);
  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-baseline justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {PICK_LABEL[pick]} <span className="font-normal text-slate-500">· {rows.length}</span>
        </h3>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">Close</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 text-left font-semibold">Style</th>
              <th className="px-2 py-2 text-left font-semibold">Size</th>
              <th className="px-2 py-2 text-left font-semibold">Created</th>
              {CHANNELS.map((c) => (
                <th key={c.id} className="px-2 py-2 text-right font-semibold">
                  {c.label}
                  <span className="block text-[10px] font-normal normal-case tracking-normal text-slate-400">
                    sold · £ a unit · {c.id === 'AMZ' ? 'FBA' : 'local'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-800">{r.title || r.groupid}</div>
                  <div className="text-xs text-slate-400">{r.groupid}{r.brand ? ` · ${r.brand}` : ''}</div>
                </td>
                <td className="px-2 py-2 tabular-nums">{r.size}</td>
                <td className="whitespace-nowrap px-2 py-2 text-slate-500">{shortDate(r.created)}</td>
                {CHANNELS.map((c) => {
                  const s = r.channels[c.id];
                  const good = s.block === 'once_good' || s.block === 'multi_good';
                  const href = c.id === 'AMZ'
                    ? `/amz/sku/${encodeURIComponent(r.code)}?from=${from}`
                    : `/pricing/style/${encodeURIComponent(r.groupid)}?from=${from}`;
                  return (
                    <td key={c.id} className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      <Link href={href} className="hover:underline">
                        <span className={s.net > 0 ? 'text-slate-800' : 'text-slate-300'}>{s.net}</span>
                        <span className={'mx-1 ' + (s.perUnit === null ? 'text-slate-300' : good ? 'font-semibold text-emerald-700' : 'text-amber-700')}>
                          {s.perUnit === null ? '—' : money2(s.perUnit)}
                        </span>
                        <span className="text-slate-400">{c.id === 'AMZ' ? r.fbaStock : r.localStock}</span>
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        Green = £3+ a unit (Shopify {money2(data.lines.SHP)}, £3 after Google). Tap a channel to price it.
      </p>
    </div>
  );
}
