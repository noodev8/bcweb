'use client';
/*
=======================================================================================================================================
Page: /finance  (Finance -> Month End)
=======================================================================================================================================
Purpose: Close the month's books and produce the two QuickFile import files. Replaces the PowerBuilder Finance window
         (CALCULATE Accounts + QUICKFILE Invoice). Spec: docs/finance-month-end-spec.md.

         DROP FILES + TYPE THREE FIGURES  ->  CALCULATE (writes nothing)  ->  GENERATE (three downloads)

WHAT THE OLD SCREEN GOT WRONG, AND WHAT THIS DOES INSTEAD
The PowerBuilder window was four grids of bare numbers with a red box wherever a value was zero — and a zero was ambiguous between
"nothing happened this month" and "the file was missing and nobody noticed" (`FileOpen` returns -1 on an absent file and the read
loop exits in silence). Three things follow from that:

  1. EVERY FIGURE CAN BE OPENED. The Amazon block drills into the per-type row breakdown that produced it. A number you can check
     beats a number you have to believe.
  2. THE CHECKS ARE PART OF THE SCREEN, not a colour. The reconciliation — every row in the file accounted for — is stated in words,
     and so is each thing that is missing. A missing PayPal file is now a sentence, not an absence.
  3. FILENAMES ARE MEANINGLESS. Files are identified server-side by their HEADER, so both rename rituals are gone: Amazon's
     'AMAZON-Sales.csv' and PayPal's exact-case 'Download.CSV' (whose script renamed it to '-done' after a run, so a re-run quietly
     produced a month with no PayPal fee in it).

STATE IS LOCAL AND DELIBERATELY UN-CACHED. Closing a month is an action, not a view; the module stores nothing server-side (owner,
2026-09-11), so the screen IS the month's state until the files are downloaded. There is nothing to re-fetch on mount, hence no SWR
here — which also keeps it clear of the no-fetching-in-effects rule (docs/maintenance-notes.md).

THE TYPED FIGURES LIVE IN LOCAL STATE, not in the calculate response. SumUp, shop cash and car are typed here, so editing one after
calculating must not force a re-upload of the Amazon file - or, worse, a second half-minute Shopify pull. They are sent with both
calls so the server can check them, but what the screen shows and what the files are built from is this form.

SHOPIFY IS NOT TYPED AND NOT EDITABLE (Phase 2). The server pulls it live from the API for the chosen month. That is what makes the
FIRST Calculate slow - about half a minute - so the button and the line beside it say so rather than appearing to have hung.

AND IT IS PULLED ONCE PER MONTH, NOT ONCE PER CALCULATE. The pull is held in `shopifyCache`, keyed by the month it was read for.
The common second run - a corrected Amazon file, or a typed figure changed - reuses it and returns instantly, because re-reading 540
Shopify orders to recalculate an Amazon file nobody asked about is half a minute of nothing. The cache is only ever bypassed two
ways, both explicit: the month changes (so the key no longer matches and a fresh pull happens on its own), or the operator presses
"re-read" on the Shopify block. Nothing here decides for itself that the cache has gone stale - a pull is a deliberate act.

The cached block is merged in CLIENT-side and never travels back up to the server. It carries the rebuilt transaction CSV, which is
128KB; posting that back on every recalculation to save a database round trip would be the wrong trade twice over.

THE MONTH IS SHOWN, NOT CHOSEN. The owner runs this in the first week of the month and it is always the month just gone (owner,
2026-09-11), so a dropdown was one decision per run that only ever had one answer. It is stated as a heading instead, with a quiet
"change" for the re-run case - which also keeps the EXPLICIT month that fixes PowerBuilder's January bug (spec section 9.1). Do not
derive the month server-side to "simplify" this: that derivation IS the bug.
=======================================================================================================================================
*/

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon, ArrowUpTrayIcon, CheckCircleIcon, DocumentTextIcon, ExclamationTriangleIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import {
  calculateFinanceMonth, buildFinanceQuickFile, FinanceMonth, FinanceRejectedFile, FinanceFile, FinanceShopify,
} from '@/lib/api';

const MAX_FILES = 2;

const money = (n: number | undefined | null) =>
  `£${(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The month just ended — what a month-end run is almost always for. Built from parts, never from date arithmetic on a Date. */
function lastMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();            // 0-based, so this IS last month's index once we treat 0 as December of y-1
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`;
}

/** 'YYYY-MM' -> 'August 2026'. */
function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

/** The last 24 months, newest first — enough to re-run an old month, short enough to scan. */
function monthOptions(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 1; i <= 24; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Save a CSV the browser already holds. No second request, so nothing to authenticate and nothing to go wrong mid-download. */
function downloadCsv(name: string, csv: string) {
  // The BOM matters: Excel opens a UTF-8 CSV without one as Windows-1252 and mangles the £ sign in every description.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------------------------------------------------------------

/** One figure in a block. `muted` is for the explanatory lines (Kids VAT) that are evidence rather than a total. */
function Figure({ label, value, muted, hint }: { label: string; value: string; muted?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1" title={hint}>
      <span className={`text-sm ${muted ? 'text-slate-400' : 'text-slate-600'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${muted ? 'text-slate-400' : 'font-medium text-slate-900'}`}>{value}</span>
    </div>
  );
}

function Block({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A typed money field. Kept as a STRING in state so a half-typed '-' or '' behaves, and coerced once on send. */
function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="text-sm text-slate-400">£</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none"
          placeholder="0.00"
        />
      </span>
    </label>
  );
}

export default function FinancePage() {
  const [month, setMonth] = useState<string>(lastMonth());
  const [changingMonth, setChangingMonth] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  // Distinct from `busy`: only true while we are actually waiting on Shopify, which is the slow part worth explaining.
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinanceMonth | null>(null);
  // The Shopify pull, kept between calculations. Keyed by month so changing the month can never show last month's figures.
  const [shopifyCache, setShopifyCache] = useState<{ month: string; data: FinanceShopify; readAt: Date } | null>(null);
  const [rejected, setRejected] = useState<FinanceRejectedFile[]>([]);
  const [generated, setGenerated] = useState<FinanceFile[] | null>(null);
  const [showRows, setShowRows] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Typed figures. See the header note on why these are not taken from the calculate response.
  const [sumupSales, setSumupSales] = useState('');
  const [sumupFees, setSumupFees] = useState('');
  const [cashSales, setCashSales] = useState('');
  const [car, setCar] = useState('');

  const num = (s: string) => {
    const n = Number(String(s).replace(/[£,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const manual = useMemo(() => ({
    sumupSales: num(sumupSales), sumupFees: num(sumupFees), cashSales: num(cashSales), car: num(car),
  }), [sumupSales, sumupFees, cashSales, car]);

  /** Changing the files or the month invalidates a calculation — a figure must never outlive the file it came from. */
  const resetResult = useCallback(() => {
    setResult(null);
    setRejected([]);
    setGenerated(null);
    setError(null);
    setShowRows(false);
  }, []);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of list) {
        if (!seen.has(`${f.name}:${f.size}`) && merged.length < MAX_FILES) merged.push(f);
      }
      return merged;
    });
    resetResult();
  }, [resetResult]);

  /**
   * Calculate the month.
   *
   * `refreshShopify` forces a fresh pull; without it, a cached pull FOR THIS MONTH is reused and the server is told to skip Shopify
   * entirely. That is what makes the second and third runs instant.
   */
  async function runCalculate(refreshShopify = false) {
    const reuse = !refreshShopify && shopifyCache?.month === month ? shopifyCache : null;

    setBusy(true);
    setPulling(!reuse);
    setError(null);
    setGenerated(null);

    const res = await calculateFinanceMonth({ files, month, manual, includeShopify: !reuse });

    setBusy(false);
    setPulling(false);
    if (!res.success || !res.data) {
      setError(res.error || 'Could not calculate the month');
      setResult(null);
      return;
    }

    // Merge the cached Shopify block back over the skipped one the server returned.
    const data = reuse ? { ...res.data, shopify: reuse.data } : res.data;
    setResult(data);
    setRejected(res.data.rejected);

    // Only a pull that actually succeeded is worth caching — caching a failure would make "re-read" the only way out of a bad
    // morning at Shopify, and the operator would have to know that.
    if (!reuse && res.data.shopify?.present) {
      setShopifyCache({ month, data: res.data.shopify, readAt: new Date() });
    }
  }

  async function runGenerate() {
    if (!result) return;
    setBusy(true);
    setError(null);
    // The Amazon file goes up again so kidsvatcharged.csv is cut from the original rows rather than rebuilt from a round trip.
    const res = await buildFinanceQuickFile({
      files,
      month,
      figures: { amazon: result.amazon, shopify: result.shopify, paypal: result.paypal, manual },
    });
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.error || 'Could not build the files');
      return;
    }
    setGenerated(res.data.files);
    // Both QuickFile files save straight away — they are the point of the screen. The kids file is a year-end document, so it is
    // offered rather than pushed: three simultaneous downloads is a browser prompt nobody reads.
    for (const f of res.data.files.filter((x) => x.name.startsWith('QuickFile'))) downloadCsv(f.name, f.csv);
  }

  const amz = result?.amazon;
  const shop = result?.shopify;
  const shopifyGross = (shop?.sales || 0) + (shop?.refund || 0);
  const shopifyVat = (shop?.salesVat || 0) + (shop?.refundVat || 0);

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Month End</h1>
          <p className="mt-1 text-sm text-slate-500">
            Drop the month&apos;s files in, add what only you know, and take the two QuickFile files.
          </p>
        </div>
        {/* Stated, not chosen - see the header note. The select appears only if the operator asks for it. */}
        <div className="text-right">
          {changingMonth ? (
            <select
              autoFocus
              value={month}
              onChange={(e) => { setMonth(e.target.value); setChangingMonth(false); resetResult(); }}
              onBlur={() => setChangingMonth(false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              {monthOptions().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          ) : (
            <>
              <div className="text-lg font-semibold tracking-tight text-slate-900">{monthLabel(month)}</div>
              <button
                type="button"
                onClick={() => setChangingMonth(true)}
                className="text-xs text-slate-400 underline decoration-slate-300 underline-offset-4 hover:text-slate-700"
              >
                change month
              </button>
            </>
          )}
        </div>
      </div>

      {/* --- Sources ------------------------------------------------------------------------------------------------------- */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-slate-900 bg-slate-50' : 'border-slate-300 bg-white'
        }`}
      >
        <ArrowUpTrayIcon className="mx-auto h-7 w-7 text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-700">Drop the Amazon and PayPal files here</p>
        <p className="mt-1 text-xs text-slate-500">
          Amazon Monthly Transaction · PayPal all-transactions export. Any filename — they are identified by what is in them.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Both optional. Shopify and the stock value are read without them.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((f, i) => (
            <li key={`${f.name}:${f.size}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <DocumentTextIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="flex-1 truncate text-sm text-slate-700">{f.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={() => { setFiles((prev) => prev.filter((_, x) => x !== i)); resetResult(); }}
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label={`Remove ${f.name}`}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Files the server could not identify. Named individually with the reason — this is the case the legacy screen turned into
          a silent zero, so it gets real estate rather than a toast. */}
      {rejected.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <ExclamationTriangleIcon className="h-4 w-4" />
            {rejected.length} file{rejected.length > 1 ? 's' : ''} could not be used
          </div>
          <ul className="mt-2 space-y-1.5">
            {rejected.map((rj) => (
              <li key={rj.filename} className="text-xs text-red-700">
                <span className="font-mono font-medium">{rj.filename}</span> — {rj.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- Typed figures ------------------------------------------------------------------------------------------------- */}
      <div className="mt-4 md:max-w-md">
        <Block title="Shop &amp; expenses">
          <MoneyInput label="SumUp sales" value={sumupSales} onChange={setSumupSales} />
          <MoneyInput label="SumUp fees" value={sumupFees} onChange={setSumupFees} />
          <MoneyInput label="Shop cash" value={cashSales} onChange={setCashSales} />
          <MoneyInput label="Car" value={car} onChange={setCar} />
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Shop and SumUp VAT is taken at a sixth of the gross, so children&apos;s footwear sold in the shop is over-declared. Agreed
            as acceptable at this volume.
          </p>
        </Block>
      </div>

      {/* --- Actions ------------------------------------------------------------------------------------------------------ */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {/* NOT gated on having uploaded anything. Shopify comes from the API and the stock from the database, so a run with no
            files is a real month — it just has no Amazon or PayPal figures, and the checks say so in words. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => runCalculate()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (pulling ? 'Reading Shopify…' : 'Calculating…') : 'Calculate'}
        </button>
        {result && (
          <button
            type="button"
            disabled={busy}
            onClick={runGenerate}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {busy ? 'Building…' : 'Generate QuickFile files'}
          </button>
        )}
        <span className="text-xs text-slate-500">
          {busy && pulling
            ? 'Walking every Shopify order for the month — this takes about half a minute.'
            : shopifyCache?.month === month
              ? 'Shopify is already read for this month, so this will be quick.'
              : 'Nothing is saved — the files you download are the record.'}
        </span>
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {/* --- The figures -------------------------------------------------------------------------------------------------- */}
      {result && (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Block
              title="Amazon"
              aside={amz?.present
                ? <span className="text-[11px] tabular-nums text-slate-400">{amz.rowCount} rows · {amz.window?.from} to {amz.window?.to}</span>
                : <span className="text-[11px] text-slate-400">no file</span>}
            >
              <Figure label="Sales" value={money(amz?.gross)} hint="What customers paid, including VAT" />
              <Figure label="VAT" value={money(amz?.vatDeclared)} hint="What is declared — zero-rated items excluded" />
              <Figure
                label="Kids VAT excluded"
                value={money(amz?.vatZeroRated)}
                muted
                hint="VAT Amazon charged on zero-rated children's footwear. Already removed from the VAT above."
              />
              <Figure label="Fees" value={money(amz?.fees)} />
              <Figure label="Reimbursements" value={money(amz?.reimbursements)} hint="FBA lost or damaged stock — income, no VAT" />
            </Block>

            <Block
              title="Shopify"
              aside={shop?.present ? (
                <span className="text-[11px] text-slate-400">
                  <span className="tabular-nums">{shop.orderCount}</span> orders · read{' '}
                  {shopifyCache?.month === month
                    ? shopifyCache.readAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                    : 'just now'}
                  {' · '}
                  {/* The one way to force a fresh pull. Quiet, because it is rarely the right thing: the figures are already a real
                      read of this month, and the only reason to repeat it is a refund landing mid-session. */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runCalculate(true)}
                    className="underline decoration-slate-300 underline-offset-2 hover:text-slate-700 disabled:opacity-40"
                  >
                    re-read
                  </button>
                </span>
              ) : (
                <span className="text-[11px] text-slate-400">not read</span>
              )}
            >
              <Figure label="Sales (net of refunds)" value={money(shopifyGross)} />
              <Figure
                label="VAT"
                value={money(shopifyVat)}
                hint="Derived from our own tax flag, because Shopify reports no tax at all on this shop's orders"
              />
              {shop?.zeroRated && shop.zeroRated.rows > 0 && (
                <Figure
                  label="Zero-rated excluded"
                  value={money(shop.zeroRated.value)}
                  muted
                  hint="Sales of zero-rated children's footwear, which carry no VAT"
                />
              )}
              <Figure label="Fees" value={shop && shop.fees !== null ? money(shop.fees) : '—'} />
            </Block>

            <Block title="Other sales">
              <Figure label="SumUp" value={money(manual.sumupSales)} />
              <Figure label="Shop cash" value={money(manual.cashSales)} />
            </Block>

            <Block title="Expenses">
              <Figure label="PayPal fees" value={result.paypal.present ? money(result.paypal.fees) : '—'} />
              <Figure label="SumUp fees" value={money(manual.sumupFees)} />
              <Figure label="Car" value={money(manual.car)} />
            </Block>
          </div>

          {/* --- Checks ----------------------------------------------------------------------------------------------------
              Stated in words, in one place, before the files are generated. The reconciliation line is the one that matters: it
              proves every row in the Amazon file was allocated somewhere. */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Checks</h2>
            <ul className="space-y-1.5">
              {result.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-sm">
                  {c.level === 'ok'
                    ? <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    : <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                  <span className={c.level === 'ok' ? 'text-slate-500' : 'text-slate-700'}>{c.message}</span>
                </li>
              ))}
            </ul>

            {amz?.present && (
              <button
                type="button"
                onClick={() => setShowRows((v) => !v)}
                className="mt-3 text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-slate-900"
              >
                {showRows ? 'Hide the rows behind these figures' : 'Show the rows behind these figures'}
              </button>
            )}
          </div>

          {/* --- The drill ------------------------------------------------------------------------------------------------ */}
          {showRows && amz?.byType && (
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
                    <th className="pb-2 font-semibold">Transaction type</th>
                    <th className="pb-2 text-right font-semibold">Rows</th>
                    <th className="pb-2 text-right font-semibold">Net</th>
                    <th className="pb-2 text-right font-semibold">VAT</th>
                    <th className="pb-2 text-right font-semibold">Fees</th>
                    <th className="pb-2 text-right font-semibold">Other</th>
                    <th className="pb-2 text-right font-semibold">Row total</th>
                  </tr>
                </thead>
                <tbody>
                  {amz.byType.map((t) => (
                    <tr key={t.type} className={`border-b border-slate-100 ${t.excluded ? 'text-slate-400' : 'text-slate-700'}`}>
                      <td className="py-1.5">
                        {t.type}
                        {t.excluded && <span className="ml-2 text-[11px] uppercase tracking-wider text-slate-400">excluded</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{t.rows}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(t.net)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(t.vat)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(t.fees)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(t.other)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {amz.reconciliation && (
                <p className="mt-3 text-xs text-slate-500">
                  Excluding {amz.reconciliation.excludedRows} transfer row{amz.reconciliation.excludedRows === 1 ? '' : 's'}
                  {' '}({money(amz.reconciliation.excludedTotal)} paid out to the bank), the file totals{' '}
                  {money(amz.reconciliation.fileTotal)} and {money(amz.reconciliation.allocated)} was allocated —
                  {amz.reconciliation.difference === 0 ? ' an exact match.' : ` ${money(amz.reconciliation.difference)} out.`}
                </p>
              )}

              {amz.unmatched && amz.unmatched.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-600">SKUs with no matching product — VAT assumed standard</p>
                  <ul className="mt-1.5 space-y-1">
                    {amz.unmatched.map((u) => (
                      <li key={u.sku} className="text-xs text-slate-500">
                        <span className="font-mono">{u.sku}</span>
                        {u.description ? ` — ${u.description}` : ''} · {money(u.value)}
                      </li>
                    ))}
                  </ul>
                  {amz.liquidationUnmatched && amz.liquidationUnmatched.rows > 0 && (
                    <p className="mt-2 text-[11px] text-slate-400">
                      A further {amz.liquidationUnmatched.rows} liquidation rows carry Amazon&apos;s own disposal identifiers rather
                      than our SKUs and can never be matched ({money(amz.liquidationUnmatched.vat)} of VAT).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* --- Stock value ----------------------------------------------------------------------------------------------
              Display only — not a QuickFile line. Replaces typing the figure into Brookfield-Finance.xls. Note this is a
              VALUATION, not the Analytics "Stock Position" gauge, which counts live products and will never agree with it. */}
          {result.stock && (
            <p className="mt-4 text-sm text-slate-500">
              Stock value <span className="font-medium tabular-nums text-slate-900">{money(result.stock.value)}</span>
              {' '}({result.stock.units.toLocaleString('en-GB')} units held)
            </p>
          )}

          {/* --- What was generated --------------------------------------------------------------------------------------- */}
          {generated && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900">
                <CheckCircleIcon className="h-5 w-5 text-slate-400" />
                Files for {monthLabel(month)}
              </div>
              <ul className="space-y-2">
                {generated.map((f) => (
                  <li key={f.name} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                    <DocumentTextIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="flex-1 text-sm text-slate-700">
                      {f.name}
                      {f.note && <span className="ml-2 text-xs text-slate-400">{f.note}</span>}
                      {f.rows.length > 0 && <span className="ml-2 text-xs text-slate-400">{f.rows.length} rows</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => downloadCsv(f.name, f.csv)}
                      className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                      Save
                    </button>
                  </li>
                ))}

                {/* The rebuilt Shopify Transaction report. It comes from the CALCULATE call, not this one - re-fetching a month of
                    orders to hand over a file the screen already holds would cost another half-minute. Offered rather than
                    auto-saved: it is a year-end document, not a QuickFile import. */}
                {shop?.csv && (
                  <li className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                    <DocumentTextIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="flex-1 text-sm text-slate-700">
                      Shopify Transaction.csv
                      <span className="ml-2 text-xs text-slate-400">{shop.rowCount} rows</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => downloadCsv('Shopify Transaction.csv', shop.csv as string)}
                      className="flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                      Save
                    </button>
                  </li>
                )}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                Import both QuickFile files under Account Settings → Import Data. Keep kidsvatcharged.csv with the month&apos;s other
                documents for the year end.
              </p>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
