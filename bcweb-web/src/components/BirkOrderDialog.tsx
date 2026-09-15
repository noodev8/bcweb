'use client';
/*
=======================================================================================================================================
Component: BirkOrderDialog
=======================================================================================================================================
Purpose: The review step of Birk Tracker's "Load order". The portal's .xlsx has been read and matched against the book by
         /birk-order-preview; this shows what loading it WOULD do and only then calls /birk-order-commit. Nothing is written until the
         operator presses the button.

THE LEGACY GRID, TURNED INTO A REVIEW. PowerBuilder's Bulk Upload filled the book's grid with the file and the operator pressed Save —
the review was reading eighty flat rows. Here it is one card per STYLE, because an order confirmation is read by style ("4 Gizeh
Pearl White, 38–40 at four each") and a size run is one line of chips rather than eight rows.

WHAT IS ASKED, AND THE DEFAULTS:
  new       ticked. The ordinary case.
  changed   ticked. Birkenstock revised the confirmation; the file is the newer truth about the ORDER. The old -> new values are
            spelt out on the card, because "changed" alone would ask the operator to take it on trust. Invoiced / arrived are never
            touched by a load (see routes/birk-order-commit.js).
  same      not actionable. A style whose every size is already in the book, as the file has it, has nothing to tick.
The tick is per STYLE, not per size: dropping one size of a confirmed order is not a thing that happens, and eighty checkboxes would
bury the two or three styles that actually need a look.

THE STYLE IS EDITABLE ONLY WHEN THE SYSTEM HAD TO INVENT IT ('rule' or 'guess' — the article is in neither skumap nor the book). Those
codes will be the ones Add/Modify has to create the product under, so it is worth a glance before they are written. When skumap or
the book already knows the article, the code is theirs and editing it would only create a second spelling of a live product.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { commitBirkOrder, type BirkOrderCommitLine, type BirkOrderLine, type BirkOrderPreview, type BirkOrderStyle } from '@/lib/api';

// A style is safe to rename only when nothing else in the system already spells it — see the header.
const editableStyle = (g: BirkOrderStyle) => g.style_source === 'rule' || g.style_source === 'guess';
const actionable = (g: BirkOrderStyle) => g.lines.some((l) => l.kind !== 'same');
// Upper case, no spaces: the shape of every clean code in the book (the ones with material names in them are the legacy's mistake).
const cleanStyle = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, '');

const CHIP: Record<BirkOrderLine['kind'], string> = {
  new: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  changed: 'border-amber-300 bg-amber-50 text-amber-900',
  same: 'border-slate-200 bg-slate-50 text-slate-500',
};

// "requested 9 -> 4, cost 37.5 -> 37.50" — only the fields that actually differ.
function changes(l: BirkOrderLine): string {
  if (!l.existing) return '';
  const e = l.existing;
  const out: string[] = [];
  const diff = (label: string, was: string | number | null, now: string | number | null, money = false) => {
    if (now == null || now === '') return;
    const same = money && was !== '' && was != null ? Number(was) === Number(now) : String(was ?? '') === String(now);
    if (!same) out.push(`${label} ${was === '' || was == null ? '—' : was} → ${now}`);
  };
  diff('ordered', e.requested, l.requested);
  diff('cost', e.cost, l.cost, true);
  diff('RRP', e.rrp, l.rrp, true);
  diff('due', e.due, l.due);
  diff('placed', e.placedate, l.placedate);
  diff('BK size', e.bksize, l.bksize);
  diff('EAN', e.ean, l.ean);
  return out.join(', ');
}

export default function BirkOrderDialog({
  preview, onClose, onApplied,
}: {
  preview: BirkOrderPreview;
  onClose: () => void;
  onApplied: (summary: string) => void;
}) {
  const { styles, orders, not_in_file: notInFile } = preview;
  const [include, setInclude] = useState<boolean[]>(() => styles.map(actionable));
  const [styleText, setStyleText] = useState<string[]>(() => styles.map((g) => g.style));
  const [showNotInFile, setShowNotInFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo<BirkOrderCommitLine[]>(() => {
    const out: BirkOrderCommitLine[] = [];
    styles.forEach((g, i) => {
      if (!include[i]) return;
      const style = editableStyle(g) ? cleanStyle(styleText[i]) : g.style;
      if (!style) return;
      for (const l of g.lines) {
        if (l.kind === 'same') continue;
        out.push({
          op: l.kind === 'new' ? 'insert' : 'update',
          ordernum: g.ordernum,
          // An edited style re-spells the code; an untouchable one keeps the server's code exactly, legacy spelling and all.
          code: editableStyle(g) ? `${g.article}-${style}-${l.size}` : l.code,
          placedate: l.placedate, bksize: l.bksize, requested: l.requested, cost: l.cost, rrp: l.rrp, due: l.due, ean: l.ean,
        });
      }
    });
    return out;
  }, [styles, include, styleText]);

  const pairs = lines.reduce((n, l) => n + l.requested, 0);
  const inserts = lines.filter((l) => l.op === 'insert').length;
  const updates = lines.length - inserts;
  const blankStyle = styles.some((g, i) => include[i] && editableStyle(g) && !cleanStyle(styleText[i]));
  const allSame = styles.every((g) => !actionable(g));
  const newToSkumap = styles.filter((g) => g.lines.some((l) => !l.in_skumap)).length;
  const offTable = styles.flatMap((g) => g.lines).filter((l) => !l.bksize).length;
  const foreign = preview.currencies.filter((c) => c !== 'GBP');
  const placed = [...new Set(styles.map((g) => g.placedate).filter(Boolean))];
  const due = [...new Set(styles.map((g) => g.due).filter(Boolean))];

  async function apply() {
    setBusy(true);
    setError(null);
    const res = await commitBirkOrder({ lines });
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'That order could not be loaded');
      return;
    }
    const { inserted, updated, pairs: done, conflicts, missing } = res.data!;
    onApplied(
      `Order ${orders.join(', ')} loaded — ${done} ${done === 1 ? 'pair' : 'pairs'}, ${inserted} ${inserted === 1 ? 'line' : 'lines'} added`
      + `${updated ? `, ${updated} updated` : ''}`
      + `${conflicts.length ? `, ${conflicts.length} already in the book and left alone` : ''}`
      + `${missing.length ? `, ${missing.length} no longer existed` : ''}`
    );
  }

  return (
    // Same modal shape as BirkInvoiceDialog: the panel scrolls on its own so a long order cannot push the buttons off the screen.
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl">
        <header className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">
              {orders.length === 1 ? 'Order ' : 'Orders '}
              <span className="font-mono">{orders.join(', ')}</span>
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {placed.length > 0 && <>placed <span className="tabular-nums">{placed.join(', ')}</span></>}
              {due.length > 0 && <> · due <span className="font-medium text-slate-700">{due.join(', ')}</span></>}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-sm text-slate-500">
              <span className="font-semibold tabular-nums text-slate-900">{preview.pairs}</span> pairs confirmed
            </p>
            <p className="text-xs text-slate-400">
              {styles.length} {styles.length === 1 ? 'style' : 'styles'} · {preview.lines_read} sizes
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </header>

        {allSame && (
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-700">
            <span className="font-medium">This order is already in the book</span>, exactly as this file has it. There is nothing to load.
          </div>
        )}

        {/* The notes worth reading before loading. Each one only when it applies — a standing "0 skipped" tells nobody anything. */}
        {(foreign.length > 0 || newToSkumap > 0 || offTable > 0 || preview.skipped_unconfirmed > 0) && (
          <ul className="space-y-1 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            {foreign.length > 0 && (
              <li className="flex gap-2"><ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                Priced in {foreign.join(', ')}, not GBP — cost and RRP are loaded as the file has them.</li>
            )}
            {newToSkumap > 0 && (
              <li>{newToSkumap} {newToSkumap === 1 ? 'style has' : 'styles have'} codes not in the product list yet — marked below. The
                book takes them, but scanning in needs the product created in Add/Modify under the same code.</li>
            )}
            {offTable > 0 && (
              <li>{offTable} {offTable === 1 ? 'size is' : 'sizes are'} off the Birkenstock size table, so {offTable === 1 ? 'it has' : 'they have'} no
                BK size — an invoice will not match {offTable === 1 ? 'it' : 'them'} automatically.</li>
            )}
            {preview.skipped_unconfirmed > 0 && (
              <li>{preview.skipped_unconfirmed} {preview.skipped_unconfirmed === 1 ? 'size confirms' : 'sizes confirm'} nothing and {preview.skipped_unconfirmed === 1 ? 'is' : 'are'} left out.</li>
            )}
          </ul>
        )}

        {/* Rows the book has for this order that the file does not. Never deleted — a line dropped from a revision is a question for
            Birkenstock, and the row may already carry an invoice. Collapsed, because it is a footnote to the load rather than part of it. */}
        {notInFile.length > 0 && (
          <div className="border-b border-slate-200 px-5 py-2.5 text-sm text-slate-600">
            <button type="button" onClick={() => setShowNotInFile((v) => !v)} className="underline decoration-dotted underline-offset-2">
              {notInFile.length} {notInFile.length === 1 ? 'line' : 'lines'} in the book for this order {notInFile.length === 1 ? 'is' : 'are'} not in this file
            </button>
            <span className="text-slate-400"> — left as they are</span>
            {showNotInFile && (
              <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 font-mono text-xs text-slate-500 sm:grid-cols-2">
                {notInFile.map((r) => (
                  <li key={r.ordernum + r.code}>
                    {r.code} <span className="text-slate-400">ordered {r.requested ?? '—'}, invoiced {r.invoiced}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="max-h-[55vh] overflow-y-auto px-5 py-3">
          <ul className="space-y-1.5">
            {styles.map((g, i) => {
              const canTick = actionable(g);
              const editable = editableStyle(g);
              const stylePairs = g.lines.reduce((n, l) => n + l.requested, 0);
              const changed = g.lines.filter((l) => l.kind === 'changed');
              const code = editable ? cleanStyle(styleText[i]) : g.style;
              return (
                <li key={`${g.ordernum}-${g.article}`} className={'rounded-lg border p-2.5 ' + (canTick ? 'border-slate-200' : 'border-slate-100 bg-slate-50/60')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <input
                      type="checkbox"
                      checked={include[i]}
                      disabled={!canTick}
                      onChange={(ev) => setInclude((prev) => prev.map((v, j) => (j === i ? ev.target.checked : v)))}
                      className="h-4 w-4 rounded border-slate-300 disabled:opacity-40"
                      aria-label={`Load ${g.material} ${g.colour}`}
                    />
                    <span className="font-mono text-xs text-slate-700">{g.article}-{code || '?'}</span>
                    <span className="min-w-0 truncate text-slate-800">
                      {g.material}
                      {g.colour && <span className="text-slate-500"> · {g.colour}</span>}
                      {g.width && g.width !== 'Regular' && <span className="font-medium text-slate-700"> · {g.width}</span>}
                    </span>
                    <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-slate-500">
                      {g.cost ?? '—'} / {g.rrp ?? '—'}
                    </span>
                    <span className="w-16 text-right text-sm font-medium tabular-nums text-slate-800">
                      {stylePairs} {stylePairs === 1 ? 'pair' : 'pairs'}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-1 pl-7">
                    {g.lines.map((l) => (
                      <span
                        key={l.size}
                        title={l.kind === 'changed' ? changes(l) : l.kind === 'same' ? 'already in the book' : !l.in_skumap ? 'not in the product list yet' : undefined}
                        className={'rounded border px-1.5 py-0.5 text-xs tabular-nums ' + CHIP[l.kind]}
                      >
                        {l.size}<span className="text-slate-400">×</span>{l.requested}
                        {!l.in_skumap && l.kind !== 'same' && <span className="ml-0.5 text-amber-600">•</span>}
                      </span>
                    ))}
                    {!canTick && <span className="self-center text-xs text-slate-400">already in the book</span>}
                  </div>

                  {/* A revision, spelt out per size — see the header. A new quantity below what is already invoiced is called out:
                      it will turn the line red on the book, and the operator should know that is coming. */}
                  {changed.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 pl-7 text-xs text-amber-900">
                      {changed.map((l) => (
                        <li key={l.size}>
                          <span className="font-medium tabular-nums">{l.size}</span>: {changes(l)}
                          {l.existing && l.requested < l.existing.invoiced && (
                            <span className="font-medium text-red-700"> — already invoiced {l.existing.invoiced}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {editable && canTick && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-7">
                      <label className="text-xs text-slate-500" htmlFor={`style-${i}`}>New style</label>
                      <input
                        id={`style-${i}`}
                        value={styleText[i]}
                        onChange={(ev) => setStyleText((prev) => prev.map((v, j) => (j === i ? ev.target.value : v)))}
                        className="w-40 rounded border border-slate-300 px-2 py-1 font-mono text-xs uppercase focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                      <span className="text-xs text-slate-400">
                        {g.style_source === 'guess' ? 'guessed from the name — check it' : 'not in the product list yet'}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {error && <p className="border-t border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700">{error}</p>}

        <footer className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-5 py-3">
          <p className="text-sm text-slate-600">
            {lines.length === 0 ? (
              <span className="text-slate-500">{allSame ? 'Nothing to load — already in the book' : 'Nothing ticked, so nothing will change'}</span>
            ) : (
              <>
                <span className="font-semibold tabular-nums">{inserts}</span> {inserts === 1 ? 'size' : 'sizes'} to add
                {updates > 0 && <>, <span className="font-semibold tabular-nums">{updates}</span> to update</>}
              </>
            )}
            {blankStyle && <span className="ml-2 text-amber-700">a style is blank</span>}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              {lines.length === 0 ? 'Close' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={busy || lines.length === 0 || blankStyle}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {busy ? 'Loading…' : lines.length === 0 ? 'Nothing to load' : `Load ${pairs} ${pairs === 1 ? 'pair' : 'pairs'}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
