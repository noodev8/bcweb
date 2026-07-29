'use client';
/*
=======================================================================================================================================
Component: AmzImportSummary
=======================================================================================================================================
Purpose: Render an Update Amazon run — either as a FORECAST (preview: "what will happen") or a RECEIPT (after commit: "what happened").
         One component for both, because the server hands back the identical shape either way; only the wording changes. If these were
         two components they would drift, and the operator would be approving one description and receiving another.

The organising idea, and the reason this screen exists at all: the legacy PowerBuilder import discarded rows INVISIBLY. A missing file
loaded as zero rows with no message; unmatched SKUs vanished; dedupe collisions dropped real sales. Two of its five inputs had been
failing silently for a long time and there was no way to notice. So every number here is presented as an ACCOUNT that reconciles:

    rows in the file  =  usable  +  skipped (each with a named reason)

Nothing is rounded away, and "0 skipped" is stated rather than left blank — an empty space reads as "not checked", which is the exact
impression this module must never give.
=======================================================================================================================================
*/

import { useState } from 'react';
import {
  ArrowDownTrayIcon, ArrowUturnLeftIcon, BanknotesIcon, CubeIcon, ExclamationTriangleIcon,
  ChevronDownIcon, ChevronRightIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline';
import type { AmzImportSummary as Summary, AmzFileSummary } from '@/lib/api';

const money = (n: number) => `£${(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => (n || 0).toLocaleString('en-GB');

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Small building blocks                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function Disclosure({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        {open ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
        {label} ({num(count)})
      </button>
      {open && <div className="mt-2 rounded-md bg-slate-50 p-3 text-xs text-slate-600">{children}</div>}
    </div>
  );
}

function Card({ icon: Icon, title, accent, children }: {
  icon: React.ComponentType<{ className?: string }>; title: string; accent?: 'amber'; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-4 ${accent === 'amber' ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200 bg-white'}`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accent === 'amber' ? 'text-amber-600' : 'text-slate-400'}`} />
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Per-file accounting                                                                                                             */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function FileCard({ f }: { f: AmzFileSummary }) {
  const schemaChanged = f.newColumns.length > 0 || f.droppedColumns.length > 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{f.label}</div>
          {f.window && (
            <div className="mt-0.5 text-xs text-slate-500">{f.window.from} → {f.window.to}</div>
          )}
          {!f.window && <div className="mt-0.5 text-xs text-slate-400">snapshot — no dates</div>}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums text-slate-900">{num(f.usable)}</div>
          <div className="text-[11px] text-slate-400">of {num(f.rowsInFile)} rows</div>
        </div>
      </div>

      {/* The account. Always shown, including when nothing was skipped — silence is what the legacy import did. */}
      <div className="mt-3 border-t border-slate-100 pt-2">
        {f.skipped === 0
          ? <div className="flex items-center gap-1.5 text-xs text-slate-500"><CheckCircleIcon className="h-3.5 w-3.5 text-emerald-500" />every row accounted for</div>
          : (
            <Disclosure label="skipped" count={f.skipped}>
              <ul className="space-y-1.5">
                {f.skipReasons.map((r) => (
                  <li key={r.reason}>
                    <span className="font-medium text-slate-700">{num(r.count)}</span> — {r.label}
                    {r.examples.length > 0 && (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{r.examples.join(' · ')}</div>
                    )}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
      </div>

      {/* Amazon changing a report's shape is the failure that silently corrupted the legacy positional import. Normally empty. */}
      {schemaChanged && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
          <div className="font-medium">Amazon has changed this report</div>
          {f.newColumns.length > 0 && <div className="mt-0.5">New columns: {f.newColumns.join(', ')}</div>}
          {f.droppedColumns.length > 0 && <div className="mt-0.5">Columns gone: {f.droppedColumns.join(', ')}</div>}
          <div className="mt-1 text-amber-700">Import is unaffected — columns are matched by name — but worth a look.</div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Main                                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------------------ */

export default function AmzImportSummary({ summary }: { summary: Summary }) {
  const done = summary.committed;
  const s = summary.sales;
  const r = summary.returns;
  const c = summary.cancellations;
  const rec = summary.reconciliation;

  const nothingToDo =
    s.written === 0 && r.written === 0 && c.rows === 0 && summary.fees.updated === 0 && summary.stock.rowsInReport === 0;

  return (
    <div className="space-y-5">
      {/* --- What was read ------------------------------------------------------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Files read</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {summary.files.map((f) => <FileCard key={f.type} f={f} />)}
        </div>
      </section>

      {/* Uploading only some of the four is normal and supported, so say so rather than letting missing cards read as an error. */}
      {summary.files.length < 4 && (
        <p className="text-xs text-slate-500">
          {summary.files.length} of 4 reports uploaded. Anything not included is left completely untouched.
        </p>
      )}

      {/* --- What changes ------------------------------------------------------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {done ? 'What changed' : 'What will change'}
        </h2>

        {nothingToDo && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Nothing to do — everything in these files is already in the database. Re-uploading the same reports is safe and changes nothing.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card icon={ArrowDownTrayIcon} title="Sales">
            <div className="text-2xl font-semibold tabular-nums text-slate-900">
              {done ? '' : '+'}{num(s.written)}
            </div>
            <div className="text-[11px] text-slate-400">{num(s.units)} units · {money(s.value)}</div>
            <Disclosure label="products we don't know" count={s.unknownSku.length}>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {s.unknownSku.slice(0, 20).map((u) => <li key={u.sku}>{u.sku} — {u.units} units</li>)}
              </ul>
            </Disclosure>
          </Card>

          <Card icon={ArrowUturnLeftIcon} title="Returns">
            <div className="text-2xl font-semibold tabular-nums text-slate-900">
              {done ? '' : '+'}{num(r.written)}
            </div>
            <div className="text-[11px] text-slate-400">{num(r.units)} units reversed</div>
            <Disclosure label="condition returned in" count={Object.keys(r.dispositions || {}).length}>
              <ul className="space-y-0.5">
                {Object.entries(r.dispositions || {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([d, n]) => (
                    <li key={d} className={d === 'SELLABLE' ? 'text-slate-500' : 'font-medium text-amber-700'}>
                      {num(n)} — {d.toLowerCase().replace(/_/g, ' ')}
                    </li>
                  ))}
              </ul>
            </Disclosure>
          </Card>

          <Card icon={BanknotesIcon} title="FBA fees">
            <div className="text-2xl font-semibold tabular-nums text-slate-900">{num(summary.fees.updated)}</div>
            <div className="text-[11px] text-slate-400">{done ? 'updated' : 'to update'}</div>
            <Disclosure label="biggest moves" count={summary.fees.biggestMoves.length}>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {summary.fees.biggestMoves.map((m) => (
                  <li key={m.sku}>{m.sku} — £{m.from.toFixed(2)} → £{m.to.toFixed(2)}</li>
                ))}
              </ul>
            </Disclosure>
          </Card>

          <Card icon={CubeIcon} title="FBA stock">
            <div className="text-2xl font-semibold tabular-nums text-slate-900">{num(summary.stock.liveUnits)}</div>
            <div className="text-[11px] text-slate-400">sellable units</div>
          </Card>
        </div>
      </section>

      {/* --- Retractions: the only destructive step, so it is never a bare number ---------------------------------------- */}
      {c.rows > 0 && (
        <section>
          <Card icon={ExclamationTriangleIcon} title={done ? 'Cancelled orders removed' : 'Cancelled orders to remove'} accent="amber">
            <p className="text-xs text-amber-800">
              {num(c.rows)} sale {c.rows === 1 ? 'row' : 'rows'} ({num(c.units)} units, {money(c.value)}) {done ? 'were' : 'will be'} deleted:
              Amazon reports {c.rows === 1 ? 'this order' : 'these orders'} as Cancelled, so the sale never happened.
              The legacy import never removed these, so they had been sitting on the books.
            </p>
            <Disclosure label="show the orders" count={c.detail.length}>
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="text-slate-400">
                  <tr><th className="pr-3 font-normal">order</th><th className="pr-3 font-normal">sku</th><th className="pr-3 font-normal">date</th><th className="font-normal">value</th></tr>
                </thead>
                <tbody>
                  {c.detail.map((d) => (
                    <tr key={d.id}>
                      <td className="pr-3">{d.ordernum}</td>
                      <td className="pr-3">{d.code}</td>
                      <td className="pr-3">{d.solddate}</td>
                      <td>{money(d.soldprice * d.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Disclosure>
          </Card>
        </section>
      )}

      {/* --- Reconciliation: three buckets, because only the first is a to-do list --------------------------------------- */}
      {summary.stock.rowsInReport > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Reconciliation</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-lg font-semibold tabular-nums text-slate-900">{num(rec.unknownSkuCount)}</div>
              <div className="text-xs text-slate-500">on Amazon, unknown to us</div>
              <p className="mt-1 text-[11px] text-slate-400">Amazon holds these but we have no product record. The only list here worth acting on.</p>
              <Disclosure label="show" count={rec.unknownSku.length}>
                <ul className="space-y-0.5 font-mono text-[11px]">
                  {rec.unknownSku.slice(0, 50).map((u) => <li key={u.sku}>{u.sku} — {u.total} units</li>)}
                </ul>
              </Disclosure>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-lg font-semibold tabular-nums text-slate-400">{num(rec.virtualCount)}</div>
              <div className="text-xs text-slate-500">Amazon virtual SKUs</div>
              <p className="mt-1 text-[11px] text-slate-400">{'Amazon’s own generated bundle listings (amzn.gr.*). Expected — never ours to store.'}</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className={`text-lg font-semibold tabular-nums ${rec.goneFromAmazonCount ? 'text-slate-900' : 'text-slate-400'}`}>{num(rec.goneFromAmazonCount)}</div>
              <div className="text-xs text-slate-500">gone from Amazon</div>
              <p className="mt-1 text-[11px] text-slate-400">In our records but absent from this report — the listing has gone. Stock is zeroed, the SKU is kept.</p>
              <Disclosure label="show" count={rec.goneFromAmazon.length}>
                <ul className="space-y-0.5 font-mono text-[11px]">
                  {rec.goneFromAmazon.slice(0, 50).map((g) => <li key={g.code}>{g.code}</li>)}
                </ul>
              </Disclosure>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
