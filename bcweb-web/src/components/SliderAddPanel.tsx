'use client';
/*
=======================================================================================================================================
Component: SliderAddPanel  (Pricing Slider — find products and put them in a group)
=======================================================================================================================================
Purpose: The "Add products" panel on /slider/[id]. Owner, 2026-10-17: "group a set of products by searching with contains/not contains
         and selecting as normal". GET /slider-candidates ships every product the channel can slide ONCE (Shopify: every live style;
         Amazon: every SKU) and this panel narrows it in the browser with THE STANDARD SEARCH — Inventory's / Collections' rules:
           - Contains / Does not contain, Enter or Find commits them as steps; steps stack and all must match. PLAIN SUBSTRING both ways
             (never whole-word — ¬WOMEN must drop "Womens …") over title, code, groupid, segment, size codes / Amazon SKU, supplier, brand.
           - A Find that would empty the list starts a NEW hunt (the steps are replaced) instead of showing nothing.
         Plus the portfolio STATUS chips (the stamped WINNERS / STEADY / NEW / LOSERS — NEW is why the slider exists) and In stock.

         Tick rows (or the header box for every row shown) and Add. START FROM: current price (the first move is a step down from today)
         or RRP (the first move lifts it back to RRP, e.g. off an old clearance price). A product already in ANOTHER slider on this
         channel is only taken if "Move them here" is ticked; the server refuses anything else it can't slide and says why
         (POST /slider-add). Adding never changes a price.
=======================================================================================================================================
*/

import { useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { SortableTh, useTableSort } from '@/components/SortableTh';
import { useApiQuery } from '@/lib/useApiQuery';
import { addToSlider, getSliderCandidates, SliderCandidate, SliderChannel } from '@/lib/api';
import { money } from '@/lib/sliderUi';

interface FilterStep { op: 'has' | 'not'; term: string }
const STATUSES = ['WINNERS', 'STEADY', 'NEW', 'LOSERS'] as const;
type Status = (typeof STATUSES)[number];

interface Indexed { row: SliderCandidate; hay: string }
interface Criteria { steps: FilterStep[]; status: Status | null; inStock: boolean }

function haystack(r: SliderCandidate): string {
  return `${r.title || ''} ${r.key} ${r.groupid} ${r.segment || ''} ${r.codes || ''} ${r.supplier || ''} ${r.brand || ''}`.toLowerCase();
}

// The one place the narrowing is defined, so the list and onFind's "would this find anything?" probe can never disagree.
function applyCriteria(rows: Indexed[], c: Criteria): Indexed[] {
  let out = rows;
  if (c.status) out = out.filter((x) => x.row.status === c.status);
  if (c.inStock) out = out.filter((x) => x.row.stock > 0);
  for (const s of c.steps) {
    const t = s.term.toLowerCase();
    out = s.op === 'has' ? out.filter((x) => x.hay.includes(t)) : out.filter((x) => !x.hay.includes(t));
  }
  return out;
}

const NO_ROWS: SliderCandidate[] = [];

interface Props {
  groupId: number;
  channel: SliderChannel;
  onAdded: () => void;
  onClose: () => void;
}

export default function SliderAddPanel({ groupId, channel, onAdded, onClose }: Props) {
  const q = useApiQuery(['slider-candidates', channel], () => getSliderCandidates(channel));
  const rows = q.data ?? NO_ROWS;
  const amz = channel === 'AMZ';

  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const [steps, setSteps] = useState<FilterStep[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [inStock, setInStock] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [startFrom, setStartFrom] = useState<'current' | 'rrp'>('current');
  const [move, setMove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const containsRef = useRef<HTMLInputElement>(null);

  const indexed = useMemo(() => rows.map((row) => ({ row, hay: haystack(row) })), [rows]);
  const criteria = useMemo(() => ({ steps, status, inStock }), [steps, status, inStock]);
  const matched = useMemo(() => applyCriteria(indexed, criteria).map((x) => x.row), [indexed, criteria]);

  const pctRrp = (r: SliderCandidate) => (r.price !== null && r.rrp ? Math.round((r.price / r.rrp) * 100) : null);
  const { sorted, sort, onSort } = useTableSort(matched, {
    key: (r) => r.key,
    status: (r) => r.status,
    price: (r) => r.price,
    rrp: (r) => r.rrp,
    pct: (r) => pctRrp(r),
    stock: (r) => r.stock,
    sold30: (r) => r.sold30,
    slider: (r) => r.slider?.name ?? null,
  });
  const th = { sort, onSort };

  // Ticks only count while their row is on screen and can join — a filter change never leaves an invisible row ticked for the Add.
  // A row already in THIS slider can't be ticked.
  const shownTickable = useMemo(() => sorted.filter((r) => r.slider?.group_id !== groupId), [sorted, groupId]);
  const pickedRows = useMemo(() => shownTickable.filter((r) => picked.has(r.key)), [shownTickable, picked]);
  const allPicked = shownTickable.length > 0 && pickedRows.length === shownTickable.length;
  const inOther = pickedRows.filter((r) => r.slider && r.slider.group_id !== groupId).length;

  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const next: FilterStep[] = [];
    if (contains.trim()) next.push({ op: 'has', term: contains.trim() });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    if (next.length > 0) {
      const narrowed = applyCriteria(indexed, { ...criteria, steps: [...steps, ...next] });
      setSteps(narrowed.length === 0 && steps.length > 0 ? next : [...steps, ...next]);
    }
    setContains(''); setNotContains(''); setPicked(new Set());
    containsRef.current?.focus();
  }

  function onReset() {
    setSteps([]); setStatus(null); setInStock(false); setPicked(new Set()); setContains(''); setNotContains(''); setMsg(null);
    q.refresh();
    containsRef.current?.focus();
  }

  async function onAdd() {
    if (pickedRows.length === 0) return;
    setBusy(true); setMsg(null);
    const r = await addToSlider(groupId, pickedRows.map((x) => x.key), startFrom, move);
    setBusy(false);
    if (!(r.success && r.data)) { setMsg({ text: r.error || 'Could not add', bad: true }); return; }
    const { done, moved, failed } = r.data;
    const parts = [`Added ${done.length}`];
    if (moved.length) parts.push(`${moved.length} moved from another slider`);
    if (failed.length) {
      const byErr = new Map<string, string[]>();
      for (const f of failed) byErr.set(f.error, [...(byErr.get(f.error) ?? []), f.key]);
      parts.push(`${failed.length} not added: ` + [...byErr].map(([err, keys]) => `${err} (${keys.join(', ')})`).join('; '));
    }
    setMsg({ text: parts.join(' · '), bad: failed.length > 0 });
    setPicked(new Set());
    q.refresh();
    if (done.length > 0) onAdded();
  }

  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';
  const toggle = (on: boolean) =>
    'rounded-md border px-3 py-1.5 text-sm font-medium transition ' +
    (on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50');

  return (
    <div className="rounded-lg border border-brand-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Add products</h2>
        <button type="button" onClick={onClose} title="Close" className="rounded text-slate-400 hover:text-slate-700"><XMarkIcon className="h-5 w-5" /></button>
      </div>

      {/* The standard Contains / Does not contain */}
      <form onSubmit={onFind} className="border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Contains</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input ref={containsRef} autoFocus value={contains} onChange={(e) => setContains(e.target.value.toUpperCase())} placeholder="e.g. CAPRICE" className={`${input} pl-10`} />
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
            <input value={notContains} onChange={(e) => setNotContains(e.target.value.toUpperCase())} placeholder="e.g. WOMEN" className={input} />
          </div>
          <button type="submit" className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">Find</button>
          <button type="button" onClick={onReset} title="Clear the search and re-read" className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <ArrowPathIcon className={`h-4 w-4 ${q.busy ? 'animate-spin' : ''}`} /> Reset
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => { setStatus((v) => (v === s ? null : s)); setPicked(new Set()); }} className={toggle(status === s)}>
              {s}
            </button>
          ))}
          <button type="button" onClick={() => { setInStock((v) => !v); setPicked(new Set()); }} className={toggle(inStock)} title={amz ? 'FBA stock sellable now' : 'Sellable local stock'}>
            In stock
          </button>
          <span className="ml-2 text-sm text-slate-500">
            <span className="font-semibold text-slate-800">{sorted.length}</span> {amz ? (sorted.length === 1 ? 'size' : 'sizes') : (sorted.length === 1 ? 'style' : 'styles')}
          </span>
          {steps.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5 text-sm">
              <span className="text-slate-300">›</span>
              <span className={s.op === 'has' ? 'rounded bg-brand-50 px-2 py-0.5 font-medium text-brand-700' : 'rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-500 line-through decoration-slate-400'}>
                {s.op === 'not' && <span className="mr-0.5 no-underline">¬</span>}{s.term}
              </span>
            </span>
          ))}
        </div>
      </form>

      {/* The add bar — ticked rows only */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3 text-sm">
        {pickedRows.length > 0 && <span className="text-slate-500">{pickedRows.length} ticked</span>}
        <span className="flex items-center gap-1.5">
          <span className="text-slate-500">Start from</span>
          <button type="button" onClick={() => setStartFrom('current')} className={toggle(startFrom === 'current')}>Current price</button>
          <button type="button" onClick={() => setStartFrom('rrp')} className={toggle(startFrom === 'rrp')} title="The first move puts it back to RRP; the first cut comes one interval later">RRP</button>
        </span>
        {inOther > 0 && (
          <label className="flex items-center gap-2 text-amber-800">
            <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            Move {inOther} from another slider
          </label>
        )}
        <button type="button" onClick={onAdd} disabled={busy || pickedRows.length === 0} className="rounded-md bg-brand-600 px-4 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? 'Adding…' : `Add ${pickedRows.length || ''}`.trim()}
        </button>
        {msg && <span className={msg.bad ? 'text-red-700' : 'text-slate-600'}>{msg.text}</span>}
      </div>

      {q.error ? (
        <p className="px-4 py-4 text-sm text-red-700">{q.error.message}</p>
      ) : q.isLoading ? (
        <p className="px-4 py-4 text-sm text-slate-400">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">Nothing matches.</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="w-8 py-2 pl-4 pr-0">
                  <input
                    type="checkbox"
                    aria-label="Tick every row shown"
                    checked={allPicked}
                    disabled={busy}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(shownTickable.map((r) => r.key)))}
                    className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                  />
                </th>
                <SortableTh {...th} sortKey="key" label={amz ? 'SKU' : 'Style'} firstDir="asc" />
                <SortableTh {...th} sortKey="status" label="Status" firstDir="asc" />
                <SortableTh {...th} sortKey="price" label="Price" align="right" />
                <SortableTh {...th} sortKey="rrp" label="RRP" align="right" />
                <SortableTh {...th} sortKey="pct" label="% RRP" align="right" />
                <th className="px-4 py-2 text-right font-medium" title="The price that keeps £0 after fees">Break-even</th>
                <SortableTh {...th} sortKey="stock" label={amz ? 'FBA' : 'Stock'} align="right" />
                <SortableTh {...th} sortKey="sold30" label="Sold 30d" align="right" />
                <SortableTh {...th} sortKey="slider" label="Slider" firstDir="asc" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const here = r.slider?.group_id === groupId;
                const p = pctRrp(r);
                return (
                  <tr key={r.key} className={`border-b border-slate-100 text-slate-700 last:border-0 ${here ? 'opacity-50' : 'hover:bg-slate-50'}`}>
                    <td className="w-8 py-2 pl-4 pr-0">
                      <input
                        type="checkbox"
                        aria-label={`Tick ${r.key}`}
                        checked={picked.has(r.key) && !here}
                        disabled={busy || here}
                        onChange={() => setPicked((s) => { const nx = new Set(s); if (nx.has(r.key)) nx.delete(r.key); else nx.add(r.key); return nx; })}
                        className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                      />
                    </td>
                    <td className="max-w-[24rem] px-4 py-2">
                      <div className="whitespace-nowrap font-medium text-slate-800">
                        {r.key}{amz && r.size && <span className="ml-2 text-xs font-normal text-slate-400">size {r.size}</span>}
                      </div>
                      {r.title && <div className="truncate text-xs text-slate-500" title={r.title}>{r.title}</div>}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{r.status || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(r.price)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.rrp === null ? <span className="text-red-600">none</span> : money(r.rrp)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{p === null ? '—' : `${p}%`}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{money(r.breakeven)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.stock}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.sold30}</td>
                    <td className="px-4 py-2 text-xs">
                      {here ? <span className="text-slate-500">In this slider</span> : r.slider ? <span className="text-amber-700">{r.slider.name}</span> : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
