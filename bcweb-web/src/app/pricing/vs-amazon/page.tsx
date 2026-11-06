'use client';
/*
=======================================================================================================================================
Page: /pricing/vs-amazon  (Shopify vs Amazon — owner, 2026-10-07)
=======================================================================================================================================
Purpose: Every style live on Amazon, its ONE Shopify price beside Amazon's per-size spread, so a Shopify price that undercuts Amazon
         can be found and lifted. Amazon can suppress the Buy Box when it sees the item cheaper elsewhere; the owner's floor is
         "Shopify never below Amazon's HIGHEST live size" (the safe end — no Amazon size is then dearer than Shopify).

         NOT the retired match-Amazon autopilot (CLAUDE.md — prices are INDEPENDENT): nothing is automatic and Amazon is never touched.
         Each Apply is an ordinary W1 (POST /pricing-apply) — server bounds, live Shopify push, price_change_log row with changed_by
         resolved server-side. Every apply from this screen carries the note "Amazon Match" and a 10-day review (owner, 2026-10-07) —
         unless the style's review is already later, which is kept (see reviewDaysFor) — so the price log says where the change came
         from and the style comes back round to see what the change did.

Colour (gap vs Amazon):  RED   Shopify below Amazon's LOWEST live size
                         AMBER between Amazon's lowest and highest
                         GREEN at or above Amazon's highest — the target
Default order: red first, biggest shortfall at the top (sorted by gap, ascending). Headers re-sort (useTableSort, ?sort= in the URL).

Search: the Inventory Contains / Does not contain rule — plain substrings, stacked steps, ANDed — over title, groupid, segment, codes
        (internal size codes + Amazon SKUs) and supplier. Kept deliberately to the TEXT steps; Inventory's typed commands (STOCK, SIZE,
        WINTER…) belong to a stock screen, not this one. If the haystack rule in inventory/page.tsx changes, change it here too.
=======================================================================================================================================
*/

import { Fragment, Suspense, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, ChevronDownIcon, ChevronRightIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import PricingCrumb from '@/components/PricingCrumb';
import { SortableTh, useTableSort } from '@/components/SortableTh';
import { useAuth } from '@/contexts/AuthContext';
import { applyPrice, getVsAmazon, VsAmazonRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// Owner, 2026-10-07: every price set here is logged as "Amazon Match" and gets a 10-day review — UNLESS the style already has a
// later review date, which is kept. A style parked for months (e.g. Summer stock in October) was parked on purpose; lifting its price
// to Amazon's high is a Buy Box fix, not a sales test, and a short review would only drop it back onto the Stuck list as noise.
const MATCH_NOTE = 'Amazon Match';
const MATCH_REVIEW_DAYS = 10;

// Today + n as YYYY-MM-DD in the browser's local (UK) calendar — compared as a string with the stored review date.
function isoInDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// The review to send with an apply: null ("leave it") when the style's review is already later than our own; else the 10 days.
function reviewDaysFor(r: VsAmazonRow): number | null {
  return r.next_review && r.next_review > isoInDays(MATCH_REVIEW_DAYS) ? null : MATCH_REVIEW_DAYS;
}

const NO_ROWS: VsAmazonRow[] = [];

type Tier = 'red' | 'amber' | 'green' | 'unknown';
function tierOf(r: VsAmazonRow): Tier {
  if (r.price === null || r.amazon_highest === null) return 'unknown';
  if (r.amazon_lowest !== null && r.price < r.amazon_lowest) return 'red';
  if (r.price < r.amazon_highest) return 'amber';
  return 'green';
}
const TIER_BADGE: Record<Tier, string> = {
  red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-800',
  green: 'bg-emerald-100 text-emerald-700',
  unknown: 'bg-slate-100 text-slate-500',
};
const TIER_LABEL: Record<Exclude<Tier, 'unknown'>, string> = { red: 'Below Amz low', amber: 'Within Amz range', green: 'At/above Amz high' };

interface Step { op: 'has' | 'not'; term: string }

// Same haystack as Inventory (inventory/page.tsx → haystack): title, groupid, segment, codes, supplier — lowercased once per row.
function haystack(r: VsAmazonRow): string {
  return `${r.title || ''} ${r.groupid} ${r.segment || ''} ${r.codes || ''} ${r.supplier || ''}`.toLowerCase();
}

const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);

// Amazon's spread as "39.99 - 44.99" (owner's format); one figure when low and high are the same price.
function amzRange(r: VsAmazonRow): string {
  const lo = r.amazon_lowest, hi = r.amazon_highest;
  if (lo === null || hi === null) return money(hi ?? lo);
  return Math.round(lo * 100) === Math.round(hi * 100) ? hi.toFixed(2) : `${lo.toFixed(2)} - ${hi.toFixed(2)}`;
}

export default function VsAmazonPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <VsAmazonContent />
    </Suspense>
  );
}

function VsAmazonContent() {
  const { logout } = useAuth();
  const { data, error: loadError, isLoading, busy, refresh } = useApiQuery(['vs-amazon'], () => getVsAmazon());
  const all = data ?? NO_ROWS;

  // --- search: stacked Contains / Does not contain steps ---
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const containsRef = useRef<HTMLInputElement>(null);
  const [tierFilter, setTierFilter] = useState<Tier | null>(null);
  // CUT — rows taken off the view by their ✕ (owner, 2026-10-07: "a little x to cut"). The same plain hide as Inventory / Amazon Order:
  // no count and no per-row undo; Reset is the only way back. Session-only — nothing is written.
  const [cut, setCut] = useState<Set<string>>(new Set());

  function onFind(e: React.SyntheticEvent) {
    e.preventDefault();
    const next = [...steps];
    if (contains.trim()) next.push({ op: 'has', term: contains.trim() });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    setSteps(next);
    setContains(''); setNotContains('');
    containsRef.current?.focus();
  }

  // Enter in either box applies (no Find button — owner, same as Google Ads / Amazon Order).
  function onEnter(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    onFind(e);
  }

  function onCut(groupid: string) {
    setCut((prev) => new Set(prev).add(groupid));
    // A cut row can't stay ticked — the bulk button would act on a style that is no longer on screen.
    setSelected((prev) => { if (!prev.has(groupid)) return prev; const n = new Set(prev); n.delete(groupid); return n; });
  }

  // Reset = back to the opening view, re-read from the database: no steps, no cuts, no colour filter, nothing ticked.
  function onReset() {
    setSteps([]); setContains(''); setNotContains('');
    setCut(new Set()); setTierFilter(null); setSelected(new Set()); setSummary(null);
    containsRef.current?.focus();
    void refresh();
  }

  const indexed = useMemo(() => all.map((row) => ({ row, hay: haystack(row) })), [all]);
  const filtered = useMemo(() => {
    let out = cut.size ? indexed.filter((x) => !cut.has(x.row.groupid)) : indexed;
    for (const s of steps) {
      const t = s.term.toLowerCase();
      out = s.op === 'has' ? out.filter((x) => x.hay.includes(t)) : out.filter((x) => !x.hay.includes(t));
    }
    // Default order: biggest shortfall first (most negative gap); unknown gaps sink.
    return out
      .map((x) => x.row)
      .sort((a, b) => (a.gap === null ? 1 : b.gap === null ? -1 : a.gap - b.gap));
  }, [indexed, steps, cut]);

  const counts = useMemo(() => {
    const c = { red: 0, amber: 0, green: 0 };
    for (const r of filtered) { const t = tierOf(r); if (t !== 'unknown') c[t]++; }
    return c;
  }, [filtered]);
  const shown = useMemo(() => (tierFilter ? filtered.filter((r) => tierOf(r) === tierFilter) : filtered), [filtered, tierFilter]);

  const { sorted, sort, onSort } = useTableSort(shown, {
    style: (r) => r.groupid,
    stock: (r) => r.stock,
    rrp: (r) => r.rrp,
    price: (r) => r.price,
    hi: (r) => r.amazon_highest,
    gap: (r) => r.gap,
    amz: (r) => r.amz_30d,
  });

  // --- per-row price boxes, expansion, results ---
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busyRow, setBusyRow] = useState<string | null>(null);

  // --- bulk ---
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  function toggle(set: Set<string>, id: string): Set<string> {
    const n = new Set(set);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }

  // One W1 apply, the screen's fixed note + review. Returns a short outcome line for the row.
  async function applyOne(row: VsAmazonRow, price: number): Promise<{ ok: boolean; text: string } | 'logout'> {
    const res = await applyPrice(row.groupid, Math.round(price * 100) / 100, reviewDaysFor(row), MATCH_NOTE);
    if (res.return_code === 'UNAUTHORIZED') return 'logout';
    if (!res.success || !res.data) return { ok: false, text: res.error || 'Failed' };
    const bits = [`Set £${res.data.new_price}`, `review ${res.data.next_review ?? '—'}`];
    if (res.data.warnings.includes('ABOVE_RRP')) bits.push('above RRP');
    if (res.data.shopify && res.data.shopify.pushed === false) return { ok: false, text: `${bits.join(' · ')} · Shopify push FAILED — Apply again` };
    return { ok: true, text: bits.join(' · ') };
  }

  async function onApplyRow(row: VsAmazonRow) {
    const price = Number(draft[row.groupid]);
    if (!Number.isFinite(price) || price <= 0) { setRowMsg((m) => ({ ...m, [row.groupid]: { ok: false, text: 'Enter a price' } })); return; }
    setBusyRow(row.groupid);
    const out = await applyOne(row, price);
    setBusyRow(null);
    if (out === 'logout') { logout(); return; }
    setRowMsg((m) => ({ ...m, [row.groupid]: out }));
    if (out.ok) setDraft((d) => { const n = { ...d }; delete n[row.groupid]; return n; });
    await refresh();
  }

  // BULK — each ticked style to ITS OWN Amazon highest, one W1 per style (so each runs the bounds + live push). Already-there rows skip.
  async function onBulkToHigh() {
    const targets = sorted.filter((r) => selected.has(r.groupid));
    if (targets.length === 0) return;
    setSummary(null);
    setProgress({ done: 0, total: targets.length });
    let applied = 0, already = 0, failed = 0, pushIssues = 0;
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      if (r.amazon_highest === null) failed++;
      else if (r.price !== null && Math.round(r.price * 100) === Math.round(r.amazon_highest * 100)) already++;
      else {
        const out = await applyOne(r, r.amazon_highest);
        if (out === 'logout') { setProgress(null); logout(); return; }
        setRowMsg((m) => ({ ...m, [r.groupid]: out }));
        if (out.ok) applied++;
        else if (out.text.includes('push FAILED')) { applied++; pushIssues++; }
        else failed++;
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null);
    setSummary(`Set ${applied} to Amazon high${already ? ` · ${already} already there` : ''}${failed ? ` · ${failed} failed` : ''}${pushIssues ? ` · ${pushIssues} push issue${pushIssues > 1 ? 's' : ''}` : ''}`);
    setSelected(new Set());
    await refresh();
  }

  const allTicked = sorted.length > 0 && sorted.every((r) => selected.has(r.groupid));
  const selfUrl = '/pricing/vs-amazon';

  return (
    <AppShell backHref="/pricing" backLabel="Shopify Pricing" crumb={<PricingCrumb name="Shopify vs Amazon" channel="shopify" />}>
      {/* Search — the Google Ads / Amazon Order bar (owner, 2026-10-07): labelled boxes in a white panel, NO Find button (Enter applies;
          so does tabbing out of the form), and a plain Reset. The blur check fires only when focus leaves the form, so tabbing from
          Contains to Does-not-contain doesn't apply half a pair. */}
      <form
        onSubmit={onFind}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          if (!contains.trim() && !notContains.trim()) return;
          onFind(e);
        }}
        className="mb-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Contains</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input
                ref={containsRef}
                value={contains}
                onChange={(e) => setContains(e.target.value.toUpperCase())}
                onKeyDown={onEnter}
                autoFocus
                placeholder="e.g. IVES"
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
            <input
              value={notContains}
              onChange={(e) => setNotContains(e.target.value.toUpperCase())}
              onKeyDown={onEnter}
              placeholder="e.g. BLACK"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            type="button"
            onClick={onReset}
            title="Clear the search and cuts, and re-read from the database"
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
            Reset
          </button>
        </div>
      </form>

      {/* Active steps */}
      {steps.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          {steps.map((s, i) => (
            <span key={i} className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 ' + (s.op === 'has' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600')}>
              {s.op === 'not' && '¬ '}{s.term}
              <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Remove step"><XMarkIcon className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}

      {/* Tier chips */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {(['red', 'amber', 'green'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTierFilter(tierFilter === t ? null : t)}
            className={'rounded-full px-2.5 py-1 font-medium ' + TIER_BADGE[t] + (tierFilter === t ? ' ring-2 ring-offset-1 ring-slate-400' : tierFilter ? ' opacity-50' : '')}
          >
            {TIER_LABEL[t]} · {counts[t]}
          </button>
        ))}
        <span className="text-slate-400">Every Apply here logs “{MATCH_NOTE}” and sets a {MATCH_REVIEW_DAYS}-day review, unless the style’s review is already later.</span>
      </div>

      {/* Bulk bar — ALWAYS rendered, button greyed until something is ticked (owner, 2026-10-07): appearing on the first tick pushed
          the whole table down mid-click. Progress / outcome take the status slot on the same line. */}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm">
        <button
          type="button"
          onClick={onBulkToHigh}
          disabled={selected.size === 0 || !!progress}
          className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          Set to Amazon high
        </button>
        {/* The ticked count sits beside the button, not in it (owner). Shown only while something is ticked; otherwise the slot
            carries bulk progress, then the last bulk outcome. */}
        {progress ? <span className="text-slate-700">Applying {progress.done}/{progress.total}…</span>
          : selected.size > 0 ? <span className="text-slate-700">{selected.size} {selected.size === 1 ? 'style' : 'styles'}</span>
          : summary ? <span className="text-slate-700">{summary}</span>
          : null}
        <span className="ml-auto text-emerald-700/80">Apply updates the live Shopify store immediately</span>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {loadError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError.message}</div>}
      {!isLoading && !loadError && sorted.length === 0 && <p className="text-sm text-slate-400">No matches.</p>}

      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allTicked}
                    onChange={() => setSelected(allTicked ? new Set() : new Set(sorted.map((r) => r.groupid)))}
                    aria-label="Tick all"
                  />
                </th>
                <SortableTh compact label="Groupid" sortKey="style" sort={sort} onSort={onSort} firstDir="asc" />
                <SortableTh compact label="Stk" sortKey="stock" sort={sort} onSort={onSort} align="right" />
                <SortableTh compact label="RRP" sortKey="rrp" sort={sort} onSort={onSort} align="right" />
                <SortableTh compact label="Amz range" sortKey="hi" sort={sort} onSort={onSort} align="right" title="Amazon's lowest – highest price across sizes in stock there (sorts by highest)" />
                <SortableTh compact label="Gap" sortKey="gap" sort={sort} onSort={onSort} firstDir="asc" align="right" title="Shopify price minus Amazon highest" />
                <SortableTh compact label="SHP" sortKey="price" sort={sort} onSort={onSort} align="right" />
                <th className="whitespace-nowrap px-3 py-2 font-medium">Set price</th>
                <SortableTh compact label="Sold 30d" sortKey="amz" sort={sort} onSort={onSort} align="right" title="Units sold in the last 30 days, Shopify over Amazon (sorts by Amazon)" />
                <th className="px-1 py-2"><span className="sr-only">Cut</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const tier = tierOf(r);
                const isOpen = open.has(r.groupid);
                const msg = rowMsg[r.groupid];
                return (
                  <Fragment key={r.groupid}>
                    <tr className="align-top hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selected.has(r.groupid)} onChange={() => setSelected(toggle(selected, r.groupid))} aria-label={`Tick ${r.groupid}`} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-1">
                          <button type="button" onClick={() => setOpen(toggle(open, r.groupid))} className="mt-0.5 text-slate-400 hover:text-slate-700" aria-label="Sizes">
                            {isOpen ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                          </button>
                          {/* GROUPID leads, title second (owner, 2026-10-07): the groupid is what gets searched and is far shorter, which is
                              what lets the whole table fit the page. Title and last change truncate to the cell; full text on hover. */}
                          <div className="w-40 min-w-0">
                            <Link href={`/pricing/style/${encodeURIComponent(r.groupid)}?from=${encodeURIComponent(selfUrl)}`} className="break-all font-medium text-slate-800 hover:text-brand-700 hover:underline">
                              {r.groupid}
                            </Link>
                            {r.title && <div className="truncate text-xs text-slate-500" title={r.title}>{r.title}</div>}
                            {/* Last change lives under the name, not in its own column — it's reference, and as a column it pushed the
                                table off the page (owner, 2026-10-07). Full text on hover. */}
                            {r.last_change && (
                              <div
                                className="truncate text-xs text-slate-400"
                                title={`${r.last_change.date} · ${r.last_change.by || '—'}${r.last_change.note ? ` — ${r.last_change.note}` : ''}`}
                              >
                                Last: {r.last_change.date} · {r.last_change.by || '—'}{r.last_change.note ? ` · ${r.last_change.note}` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{r.stock}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{money(r.rrp)}</td>
                      {/* One column, "low - high" (owner, 2026-10-07); a single figure when every live size sits at one price. */}
                      <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">{amzRange(r)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={'rounded px-1.5 py-0.5 text-xs font-medium ' + TIER_BADGE[tier]}>
                          {r.gap === null ? '—' : `${r.gap > 0 ? '+' : ''}${r.gap.toFixed(2)}`}
                        </span>
                      </td>
                      {/* Current Shopify price sits right beside Set price, so old → new reads side by side (owner, 2026-10-07). */}
                      <td className="px-3 py-2 text-right font-medium text-slate-800">{money(r.price)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <input
                            value={draft[r.groupid] ?? ''}
                            onChange={(e) => setDraft((d) => ({ ...d, [r.groupid]: e.target.value }))}
                            inputMode="decimal"
                            placeholder="£"
                            className="-my-0.5 w-14 rounded border border-slate-300 px-2 py-0.5 text-right text-sm focus:border-brand-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={r.amazon_highest === null}
                            onClick={() => setDraft((d) => ({ ...d, [r.groupid]: r.amazon_highest!.toFixed(2) }))}
                            className="-my-0.5 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            =High
                          </button>
                          <button
                            type="button"
                            disabled={busyRow === r.groupid || !draft[r.groupid]}
                            onClick={() => onApplyRow(r)}
                            className="-my-0.5 rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                          >
                            {busyRow === r.groupid ? '…' : 'Apply'}
                          </button>
                        </div>
                        {msg && <div className={'mt-1 text-xs ' + (msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</div>}
                      </td>
                      {/* One column, two lines — as two columns the table ran off the page (owner, 2026-10-07). */}
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-slate-600">
                        <div>SHP <span className="font-medium text-slate-800">{r.shp_30d}</span></div>
                        <div>AMZ <span className="font-medium text-slate-800">{r.amz_30d}</span></div>
                      </td>
                      <td className="px-1 py-2">
                        <button
                          type="button"
                          onClick={() => onCut(r.groupid)}
                          title="Cut"
                          className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60">
                        <td />
                        <td colSpan={9} className="px-4 py-2">
                          <div className="flex flex-wrap gap-2 text-xs">
                            {r.sizes.map((s) => (
                              <span key={s.size} className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-600">
                                <span className="font-medium text-slate-800">{s.size}</span>
                                {/* Size · Amazon price (— if not on Amazon) · (stock here + at Amazon, combined) — owner, 2026-10-07. */}
                                {' · '}{s.amz_price === null ? '—' : `£${s.amz_price.toFixed(2)}`} ({s.qty + s.amz_live})
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
