'use client';
/*
=======================================================================================================================================
Page: /process — Process (owner's work in progress, 2026-10-25)
=======================================================================================================================================
Purpose: A READ-ONLY map of the business in blocks — one big number per stage, each opening the list to act on, with the acting done on
the existing screens. The Monday-morning question: is there something to do — find more prospects, sort out the performers, good or
bad? If the team does its job, the numbers improve.

Reached from one quiet line at the bottom of the dashboard (lib/features.ts → PROCESS_STRIP), so the team's menu doesn't move while
the owner settles it.

FIRST VERSION = two blocks (Order / Price come later, as additions — the blocks are separate on purpose):
  - PROSPECTS: one plain total (owner: no rating split, no "new this month"). Opens /prospects.
  - NEW SIZES: every size of every style created in the last 90 days, in five blocks on EACH channel — Amazon, Shopify, shop counter
    (its own channel: the shop sells at RRP, "unfair to give it to Shopify"). Every size is on every channel, even one never sent there.
    Sold = net of returns; thin/good = £ a unit against the channel's line (£3; Shopify £3 + the fixed Google allowance). All the
    rules are server-side, in bcweb-server/utils/processMap.js — this page only groups and lists what comes back.
  - A block opens its sizes BELOW the grid (owner: "same page or its own page — let's see"); each row links to where you act on it.

THE GOOGLE ALLOWANCE: fixed, re-measured quarterly BY BUTTON. Re-measure SHOWS the new figure beside the one in force; nothing changes
until Accept (owner: "display the new fixed number before it is accepted").
=======================================================================================================================================
*/

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import {
  getProcessOverview, measureProcessAllowance, acceptProcessAllowance,
  type ProcessChannel, type ProcessBlock, type ProcessAllowanceMeasure, type ProcessOverview,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

const CHANNELS: { id: ProcessChannel; label: string }[] = [
  { id: 'AMZ', label: 'Amazon' },
  { id: 'SHP', label: 'Shopify' },
  { id: 'CM3', label: 'Shop' },
];

// What a box or list is called, and (on the list only — owner: less text on the boxes) the Monday action it leads to. `sold` = every
// sold block together: the channel's SOLD total, which opens its profit breakdown.
type Pick = ProcessBlock | 'sold';
const PICK_INFO: Record<Pick, { label: string; hint: string }> = {
  sold:       { label: 'Sold', hint: 'All sold sizes' },
  multi_thin: { label: '2+ thin', hint: 'Price up' },
  multi_good: { label: '2+ good', hint: 'Order more / feed' },
  once_thin:  { label: '1 thin', hint: 'Watch / nudge up' },
  once_good:  { label: '1 good', hint: 'Watch' },
  not_sold:   { label: 'Not sold', hint: 'Price down / Slider / drop' },
};
const SOLD_BLOCKS: ProcessBlock[] = ['multi_thin', 'multi_good', 'once_thin', 'once_good'];

const SELF = '/process';

function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}
// % of new, the owner's "future mindset comparison" — the share is what should improve quarter on quarter, not the count.
function pct(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : '—';
}
// £3 not £3.00; £10.77 as is.
function moneyShort(v: number): string {
  return Number.isInteger(v) ? `£${v}` : `£${v.toFixed(2)}`;
}
// The breakdown boxes are labelled with their RULE — "2+ sold · £3+" — not a word (owner: the words confused).
function pickLabel(p: Pick, lineValue: number): string {
  if (p === 'sold' || p === 'not_sold') return PICK_INFO[p].label;
  const line = moneyShort(lineValue);
  return `${p.startsWith('multi') ? '2+' : '1'} sold · ${p.endsWith('good') ? `${line}+` : `under ${line}`}`;
}
function money2(v: number): string {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toFixed(2)}`;
}
// 'YYYY-MM-DD' -> '25 Oct'. Parsed as parts, never through Date (a bare date string is read as UTC/local and can shift a day).
function shortDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${day} ${mon}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

export default function ProcessPage() {
  const q = useApiQuery('process-overview', () => getProcessOverview());
  const d = q.data;

  // Sizes sold on ANY channel — one count per size however many channels it sold on.
  const soldAny = d ? d.rows.filter((r) => CHANNELS.some((c) => r.channels[c.id].block !== 'not_sold')).length : 0;

  // WINNER (owner, 2026-10-25): a new size that sold at the channel's line or better — £3 a unit, Shopify £3 after Google — on ANY
  // channel (good on one = keep). Deliberately the low bar: these are NEW, and the other screens measure staying power. A 30-day
  // top-20% bar was looked at and rejected — it gave 0 on Amazon while good new Riekers were still building up.
  const winners = d
    ? d.rows.filter((r) => CHANNELS.some((c) => ['once_good', 'multi_good'].includes(r.channels[c.id].block))).length
    : 0;

  // The block whose sizes are listed below the grid. null = none open.
  const [open, setOpen] = useState<{ ch: ProcessChannel; block: Pick } | null>(null);

  return (
    <AppShell title="Process">
      {q.isLoading && <div className="py-10 text-center text-sm text-slate-400">Loading…</div>}
      {q.error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{q.error.message}</div>}

      {d && (
        <>
          {/* THE BIG TOTALS: prospects, and how many NEW sizes there are (owner: sizes big, styles under — every box below counts
              sizes). */}
          <section className="mb-8 flex flex-wrap gap-4">
            <Link
              href={`/prospects?from=${encodeURIComponent(SELF)}`}
              className="inline-flex min-w-[10rem] flex-col rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm transition hover:border-brand-500 hover:shadow-md"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Prospects</span>
              <span className="text-4xl font-semibold tabular-nums text-slate-900">{d.prospects}</span>
              <span className="text-xs text-slate-400">on the list</span>
            </Link>
            <div className="inline-flex min-w-[10rem] flex-col rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">New</span>
              <span className="text-4xl font-semibold tabular-nums text-slate-900">{d.rows.length}</span>
              <span className="text-xs text-slate-400">{d.styles} styles</span>
            </div>
            {/* Sold ANYWHERE: a size sold on two channels counts once (owner, 2026-10-25). Net of returns, as every box below. */}
            <div className="inline-flex min-w-[10rem] flex-col rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sold</span>
              <span className="text-4xl font-semibold tabular-nums text-slate-900">
                {soldAny}
              </span>
              <span className="text-xs text-slate-400">{pct(soldAny, d.rows.length)} of new · any channel</span>
            </div>
            <div className="inline-flex min-w-[10rem] flex-col rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Winner</span>
              <span className="text-4xl font-semibold tabular-nums text-slate-900">{winners}</span>
              <span className="text-xs text-slate-400">{pct(winners, d.rows.length)} of new · £3+ a unit</span>
            </div>
            {/* LOSER = every new size that isn't a winner: not sold anywhere, OR sold under £3 a unit (owner: "even though we sold it,
                may as well be a loser"). Winner + Loser = New. */}
            <div className="inline-flex min-w-[10rem] flex-col rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Loser</span>
              <span className="text-4xl font-semibold tabular-nums text-slate-900">{d.rows.length - winners}</span>
              <span className="text-xs text-slate-400">not sold or under £3</span>
            </div>
          </section>

          {/* NEW SIZES */}
          <section>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {CHANNELS.map((c) => (
                <ChannelGrid key={c.id} data={d} channel={c.id} label={c.label} open={open} onOpen={setOpen} />
              ))}
            </div>

            <AllowanceBar data={d} onAccepted={() => q.refresh()} />

            {/* Opening Sold only shows its breakdown — the list waits for one of the breakdown boxes (owner: "don't show the list yet"). */}
            {open && open.block !== 'sold' && <BlockList data={d} ch={open.ch} block={open.block} onClose={() => setOpen(null)} />}
          </section>
        </>
      )}
    </AppShell>
  );
}

// One channel: two big totals, SOLD | NOT SOLD (owner: "show what has sold and not sold totals first"). Opening Sold shows its
// breakdown — sold 2+ / once, thin / good against the channel's line — as four small boxes, numbers only.
function ChannelGrid({ data, channel, label, open, onOpen }: {
  data: ProcessOverview; channel: ProcessChannel; label: string;
  open: { ch: ProcessChannel; block: Pick } | null;
  onOpen: (v: { ch: ProcessChannel; block: Pick } | null) => void;
}) {
  const sum = data.summary[channel];
  const count = (p: Pick) => (p === 'sold' ? SOLD_BLOCKS.reduce((n, b) => n + sum[b].sizes, 0) : sum[p].sizes);
  const mine = open?.ch === channel ? open.block : null;
  const soldOpen = mine !== null && mine !== 'not_sold';

  const boxLabel = (p: Pick) => pickLabel(p, data.lines[channel]);
  const box = (p: Pick, big: boolean) => {
    const n = count(p);
    const isOpen = mine === p;
    return (
      <button
        type="button"
        onClick={() => onOpen(isOpen ? null : { ch: channel, block: p })}
        disabled={n === 0}
        className={
          'flex flex-col rounded-lg border text-left transition ' + (big ? 'p-3 ' : 'px-2 py-1.5 ') +
          (isOpen
            ? 'border-brand-500 bg-white ring-1 ring-brand-500'
            : n === 0
              ? 'border-slate-100 bg-slate-50 text-slate-400'
              : 'border-slate-200 bg-white hover:border-brand-500')
        }
      >
        <span className="text-xs text-slate-500">{boxLabel(p)}</span>
        <span className={(big ? 'text-3xl ' : 'text-lg ') + 'font-semibold tabular-nums text-slate-900'}>{n}</span>      </button>
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{label}</h3>
      <div className="grid grid-cols-2 gap-2">
        {box('sold', true)}
        {box('not_sold', true)}
      </div>
      {soldOpen && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {SOLD_BLOCKS.map((b) => <div key={b}>{box(b, false)}</div>)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            £ = profit a unit{channel === 'SHP' ? ` (£3 + ${money2(data.allowance?.perUnit ?? 0)} Google)` : ''}
          </p>
        </>
      )}
    </div>
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
    <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
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

// The sizes behind one block. Each row links to where it is acted on: Amazon → the SKU's Amazon pricing; Shopify and the shop → the
// style's Shopify pricing (the shop sells local stock at the same price).
function BlockList({ data, ch, block, onClose }: { data: ProcessOverview; ch: ProcessChannel; block: Pick; onClose: () => void }) {
  const rows = data.rows.filter((r) => (block === 'sold' ? r.channels[ch].block !== 'not_sold' : r.channels[ch].block === block));
  const chLabel = CHANNELS.find((c) => c.id === ch)?.label;
  const from = encodeURIComponent(SELF);
  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-baseline justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {chLabel} · {pickLabel(block, data.lines[ch])} <span className="font-normal text-slate-500">· {rows.length} · {PICK_INFO[block].hint}</span>
        </h3>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">Close</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 text-left font-semibold">Style</th>
              <th className="px-2 py-2 text-left font-semibold">Size</th>
              <th className="px-2 py-2 text-left font-semibold">Created</th>
              <th className="px-2 py-2 text-right font-semibold">Sold</th>
              <th className="px-2 py-2 text-right font-semibold">£ a unit</th>
              <th className="px-2 py-2 text-right font-semibold">£ earned</th>
              <th className="px-2 py-2 text-right font-semibold">{ch === 'AMZ' ? 'FBA' : 'Local'}</th>
              <th className="px-4 py-2 text-left font-semibold">Other channels</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = r.channels[ch];
              const href = ch === 'AMZ'
                ? `/amz/sku/${encodeURIComponent(r.code)}?from=${from}`
                : `/pricing/style/${encodeURIComponent(r.groupid)}?from=${from}`;
              return (
                <tr key={r.code} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={href} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">{r.title || r.groupid}</Link>
                    <div className="text-xs text-slate-400">{r.groupid}{r.brand ? ` · ${r.brand}` : ''}</div>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{r.size}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-500">{shortDate(r.created)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.net}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.perUnit === null ? '—' : money2(s.perUnit)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.sold > 0 ? money2(s.profit) : '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{ch === 'AMZ' ? r.fbaStock : r.localStock}</td>
                  {/* The owner's rule of thumb reads across channels — drop if rubbish on all, keep if good on one — so each row
                      shows where else the size stands. */}
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {CHANNELS.filter((c) => c.id !== ch).map((c) => {
                      const o = r.channels[c.id];
                      return (
                        <span key={c.id} className="mr-3 whitespace-nowrap">
                          {c.label}: {o.block === 'not_sold' ? '—' : `${o.net} sold${o.perUnit === null ? '' : ` @ ${money2(o.perUnit)}`}`}
                        </span>
                      );
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
