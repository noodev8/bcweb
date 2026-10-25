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

Tap New / Sold / Unsold / Winner / Loser for its list below the row (see BoxList for what each shows).
The per-channel cards were removed (owner: "those boxes aren't helping"). The Monday job: load prospects, then fight the losers.

Rules (sold, £ a unit, the line) are server-side in bcweb-server/utils/processMap.js; this page only counts and lists.
Reached from one quiet line at the bottom of the dashboard (lib/features.ts → PROCESS_STRIP).

THE GOOGLE ALLOWANCE: fixed, re-measured quarterly BY BUTTON. Re-measure SHOWS the new figure beside the one in force; nothing changes
until Accept (owner: "display the new fixed number before it is accepted").
=======================================================================================================================================
*/

import { Fragment, useState } from 'react';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
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

  // THE CARDS STAY ON SCREEN, AND SO DO A LIST'S COLUMN HEADERS (owner, 2026-10-25: keep the columns while sorting, without a second
  // scrollbar). The cards row is sticky at the top of the page; a list's header row sticks just under it, so it needs the row's
  // height — measured, because the cards wrap onto more lines on a narrow screen. The list itself has no scroll box of its own:
  // an overflow container would capture the sticky header and bring the extra scrollbar back.
  const [cardsHeight, setCardsHeight] = useState(0);
  const cardsRef = (el: HTMLElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setCardsHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  };

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
          <section ref={cardsRef} className="sticky top-0 z-20 -mx-4 flex flex-wrap gap-4 bg-slate-100 px-4 py-3">
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

          {open && <BoxList key={open} data={d} pick={open} stickyTop={cardsHeight} onClose={() => setOpen(null)} />}

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

// THE LISTS behind the boxes (owner, 2026-10-25), laid out like the other list screens and sized to their content so they read down
// rather than across. No channel columns (owner: noise here; "where it sold — perhaps not yet") and no links out yet — the owner is
// still deciding whether this screen is a report or a place to act from ("I may not even want to see the list unless I go somewhere
// and do something with it").
//   NEW     by STYLE: Group ID (title in the tooltip) · Brand · Added · Sizes · Local · FBA; a row opens its sizes by CODE.
//   SOLD    by SIZE ("by size feels better"; a By style toggle was tried and removed): Code · Brand · Added · Sold.
//   UNSOLD  by size: Code · Brand · Added.
//   WINNER  by size: Code · Brand · Added · Sold · £ a unit.
//   LOSER   by size: Code · Brand · Added · Sold · £ a unit (the ones that sold, under £3).
//   Sold = units net of returns, every channel added together. £ a unit = the size's BEST channel (a winner is good on at least one).
//   Opening order: newest added first; Unsold and Loser OLDEST first — longest without a win at the top (owner chose that for Loser).
//   Local / FBA are HIDDEN on the by-size lists, not removed (owner: "do we need to know where the stock is? Perhaps not but don't
//   remove, just hide") — flip LIST_SHOWS_STOCK.
type ListSortKey = 'groupid' | 'brand' | 'added' | 'sizes' | 'sold' | 'perunit' | 'local' | 'fba';
type ListRow = { groupid: string; title: string | null; brand: string | null; created: string; sizes: ProcessSizeRow[] };

const LIST_SHOWS_STOCK = false;

// Units sold on every channel together, net of returns (a channel that netted below 0 counts 0).
const unitsSold = (r: ProcessSizeRow) => CHANNELS.reduce((n, c) => n + Math.max(r.channels[c.id].net, 0), 0);
// The best £ a unit across the channels it sold on; null = sold nowhere.
const bestPerUnit = (r: ProcessSizeRow): number | null => {
  const v = CHANNELS.map((c) => r.channels[c.id]).filter((c) => c.net > 0 && c.perUnit !== null).map((c) => c.perUnit as number);
  return v.length ? Math.max(...v) : null;
};

function BoxList({ data, pick, stickyTop, onClose }: { data: ProcessOverview; pick: Pick; stickyTop: number; onClose: () => void }) {
  const flat = pick !== 'new';
  const showSold = pick === 'sold' || pick === 'winner' || pick === 'loser';
  const showPerUnit = pick === 'winner' || pick === 'loser';
  const showStock = !flat || LIST_SHOWS_STOCK;
  const [openStyle, setOpenStyle] = useState<string | null>(null);
  // Every column sorts; tap again to reverse. Text columns start A→Z, numbers and dates high→low.
  const [sort, setSort] = useState<{ key: ListSortKey; desc: boolean }>({
    key: 'added', desc: !(pick === 'unsold' || pick === 'loser'),
  });
  const toggleSort = (key: ListSortKey) =>
    setSort((cur) => (cur.key === key ? { key, desc: !cur.desc } : { key, desc: !['groupid', 'brand'].includes(key) }));

  // Group into styles (New) or one row per code (the rest — each code its own "style" of one size, so the row, sort and columns are
  // shared), keeping the server's order (newest created first, then groupid, sizes in size order) as the tie-break.
  const rows = data.rows.filter(FILTERS[pick]);
  const list: ListRow[] = [];
  const byId = new Map<string, ListRow>();
  for (const r of rows) {
    const key = flat ? r.code : r.groupid;
    let st = byId.get(key);
    if (!st) {
      st = { groupid: key, title: r.title, brand: r.brand, created: r.created, sizes: [] };
      byId.set(key, st);
      list.push(st);
    }
    st.sizes.push(r);
  }

  const local = (st: ListRow) => st.sizes.reduce((n, r) => n + r.localStock, 0);
  const fba = (st: ListRow) => st.sizes.reduce((n, r) => n + r.fbaStock, 0);
  const sold = (st: ListRow) => st.sizes.reduce((n, r) => n + unitsSold(r), 0);
  const perUnit = (st: ListRow) => bestPerUnit(st.sizes[0]);
  const sortVal: Record<ListSortKey, (st: ListRow) => string | number> = {
    groupid: (st) => st.groupid,
    brand: (st) => (st.brand || '').toLowerCase(),
    added: (st) => st.created,
    sizes: (st) => st.sizes.length,
    sold,
    perunit: (st) => perUnit(st) ?? -Infinity,
    local,
    fba,
  };
  const val = sortVal[sort.key];
  list.sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return sort.desc ? -c : c;
  });

  const th = (key: ListSortKey, label: string, cls: string) => (
    <th className={'sticky z-10 bg-white shadow-[inset_0_-1px_0_rgb(226_232_240)] ' + cls} style={{ top: stickyTop }}>
      <button
        type="button" onClick={() => toggleSort(key)}
        className={'inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ' + (sort.key === key ? 'text-slate-800' : '')}
      >
        {label}{sort.key === key && <span className="text-[10px]">{sort.desc ? '▼' : '▲'}</span>}
      </button>
    </th>
  );

  return (
    <div className="mt-3 w-fit max-w-full rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-baseline justify-between gap-6 border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {PICK_LABEL[pick]}{' '}
          <span className="font-normal text-slate-500">· {flat ? `${rows.length} sizes` : `${list.length} styles · ${rows.length} sizes`}</span>
        </h3>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">Close</button>
      </div>
      <table className="text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {th('groupid', flat ? 'Code' : 'Group ID', 'w-64 px-4 py-2.5 font-medium')}
            {th('brand', 'Brand', 'px-3 py-2.5 font-medium')}
            {th('added', 'Added', 'px-3 py-2.5 font-medium')}
            {!flat && th('sizes', 'Sizes', 'px-2 py-2.5 text-right font-medium')}
            {showSold && th('sold', 'Sold', 'px-2 py-2.5 text-right font-medium')}
            {showPerUnit && th('perunit', '£ a unit', 'py-2.5 pl-2 pr-4 text-right font-medium')}
            {showStock && th('local', 'Local', 'px-2 py-2.5 text-right font-medium')}
            {showStock && th('fba', 'FBA', 'py-2.5 pl-2 pr-4 text-right font-medium')}
          </tr>
        </thead>
        <tbody>
          {list.map((st) => {
            const isOpen = openStyle === st.groupid;
            const pu = showPerUnit ? perUnit(st) : null;
            return (
              <Fragment key={st.groupid}>
                <tr
                  onClick={flat ? undefined : () => setOpenStyle(isOpen ? null : st.groupid)}
                  className={'border-b border-slate-100 ' + (flat ? 'hover:bg-slate-50/60' : 'cursor-pointer ' + (isOpen ? 'bg-brand-50' : 'hover:bg-slate-50/60'))}
                >
                  {/* Title in the tooltip (owner, 2026-10-25) — the code / groupid is what gets read, as on New Additions. */}
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-sm tracking-tight text-slate-900" title={st.title || 'Untitled'}>
                    {!flat && <ChevronRightIcon className={'mr-1 inline h-3 w-3 text-slate-400 transition-transform ' + (isOpen ? 'rotate-90' : '')} />}
                    {st.groupid}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{st.brand || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{shortDate(st.created)}</td>
                  {!flat && <td className="px-2 py-2 text-right tabular-nums text-slate-700">{st.sizes.length}</td>}
                  {showSold && (
                    <td className={'px-2 py-2 text-right tabular-nums ' + (sold(st) > 0 ? 'font-medium text-slate-900' : 'text-slate-300')}>{sold(st)}</td>
                  )}
                  {showPerUnit && (
                    <td className={'py-2 pl-2 pr-4 text-right tabular-nums ' + (pu === null ? 'text-slate-300' : 'text-slate-700')}>
                      {pu === null ? '—' : money2(pu)}
                    </td>
                  )}
                  {showStock && <td className="px-2 py-2 text-right tabular-nums text-slate-700">{local(st)}</td>}
                  {showStock && <td className="py-2 pl-2 pr-4 text-right tabular-nums text-slate-700">{fba(st)}</td>}
                </tr>
                {isOpen && !flat && st.sizes.map((r) => (
                  <tr key={r.code} className="border-b border-slate-100 bg-slate-50/50 text-xs">
                    <td className="py-1.5 pl-10 pr-4 font-mono text-slate-700" colSpan={4}>{r.code}</td>
                    {showStock && <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{r.localStock}</td>}
                    {showStock && <td className="py-1.5 pl-2 pr-4 text-right tabular-nums text-slate-700">{r.fbaStock}</td>}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
