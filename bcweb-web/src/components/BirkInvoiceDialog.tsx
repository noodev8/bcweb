'use client';
/*
=======================================================================================================================================
Component: BirkInvoiceDialog
=======================================================================================================================================
Purpose: The review step of Birk Tracker's "Load invoice". The PDF has been parsed and matched against the order book by
         /birk-invoice-preview; this shows what applying it WOULD do, asks the handful of questions the match could not settle, and
         only then calls /birk-invoice-commit. Nothing is written until the operator presses the button.

THIS IS THE TERMINAL PROMPT, TURNED INTO A SCREEN. The live Python tool (C:\projects\birk-tracker\birk-tracker.py) walks the invoice
line by line and stops at a prompt whenever it cannot decide — [a]dd / [e]dit / [i]gnore, pick [1-n], [a]dd anyway — then asks
"Proceed? [y/N]" at the end. A web request cannot block on a question, so every question is asked at once and answered before
anything is sent. The four cases and their defaults are the same, and the defaults are chosen to match what the operator would have
typed at that prompt:
  update            included. One row matched; there was never a question.
  already_invoiced  EXCLUDED by default. The row already carries this invoice number, which nearly always means the same PDF is being
                    loaded twice — the Python defaults to ignoring it too, and the cost of wrongly including it (double-billing a line
                    in the book) is far higher than the cost of wrongly leaving it out (do it again).
  ambiguous         EXCLUDED until a row is picked. Several rows matched and crediting the wrong one puts two lines out at once.
  missing           included WHEN a code could be suggested, because the suggestion is derived from a real row for the same article
                    and is nearly always right; excluded when it could not be, since there is nothing to include.

WHY THE TOTAL IS SHOWN SO PROMINENTLY. The invoice prints its own "Sum of pos." count, and the parse has to agree with it. A silent
disagreement means a line was missed — the worst possible failure here, because everything else on screen would look perfectly
reasonable. When they disagree the dialog says so in red and the operator decides; it does not block, because a partial load that is
understood beats no load at all.

THE PAIRS COUNT ON THE BUTTON is what will actually be written, recomputed from the current answers — so unticking something changes
the number you are about to commit before you commit it.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { commitBirkInvoice, type BirkInvoiceAction, type BirkInvoiceEntry, type BirkInvoicePreview } from '@/lib/api';

// The operator's answer to one line. `code` is the row it will be applied to — chosen for an ambiguous line, typed or suggested for a
// missing one, and already known for the other two.
interface Answer { include: boolean; code: string }

function initialAnswer(e: BirkInvoiceEntry): Answer {
  if (e.kind === 'update') return { include: true, code: e.row?.code || '' };
  if (e.kind === 'already_invoiced') return { include: false, code: e.row?.code || '' };
  if (e.kind === 'ambiguous') return { include: false, code: '' };
  return { include: !!e.suggested_code, code: e.suggested_code || '' };
}

// The label says what will HAPPEN to the line, not what category it fell into — "Already invoiced" tells you why it is unticked;
// "Already on this invoice" (the first wording) read as a category name and left the operator to work out the consequence.
const KIND_LABEL: Record<BirkInvoiceEntry['kind'], string> = {
  update: 'Will add',
  already_invoiced: 'Already invoiced — skipping',
  ambiguous: 'Pick a row',
  missing: 'Not on the order',
};

const KIND_STYLE: Record<BirkInvoiceEntry['kind'], string> = {
  update: 'bg-emerald-50 text-emerald-800',
  already_invoiced: 'bg-slate-100 text-slate-600',
  ambiguous: 'bg-amber-50 text-amber-900',
  missing: 'bg-amber-50 text-amber-900',
};

export default function BirkInvoiceDialog({
  preview, onClose, onApplied,
}: {
  preview: BirkInvoicePreview;
  onClose: () => void;
  onApplied: (summary: string) => void;
}) {
  const { invoice, entries, parsed_pairs: parsedPairs, totals_agree: totalsAgree } = preview;
  const [answers, setAnswers] = useState<Answer[]>(() => entries.map(initialAnswer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (i: number, patch: Partial<Answer>) =>
    setAnswers((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  // What will actually be written. An entry counts only if it is ticked AND has a row to apply to — an ambiguous line with nothing
  // picked, or a missing one with the code cleared, is not a silent skip, it simply is not included.
  const actions = useMemo<BirkInvoiceAction[]>(() => {
    const out: BirkInvoiceAction[] = [];
    entries.forEach((e, i) => {
      const a = answers[i];
      if (!a.include || !a.code.trim()) return;
      out.push(
        e.kind === 'missing'
          ? { op: 'insert', code: a.code.trim(), ordernum: e.ordernum, qty: e.qty, size: e.size }
          : { op: 'update', code: a.code.trim(), ordernum: e.ordernum, qty: e.qty }
      );
    });
    return out;
  }, [entries, answers]);

  const pairs = actions.reduce((n, a) => n + a.qty, 0);
  const unanswered = entries.filter((e, i) => e.kind === 'ambiguous' && !answers[i].code.trim()).length;
  // The commonest way this dialog opens on a file that needs nothing done to it: the same PDF loaded twice.
  const allAlreadyInvoiced = entries.length > 0 && entries.every((e) => e.kind === 'already_invoiced');

  async function apply() {
    setBusy(true);
    setError(null);
    const res = await commitBirkInvoice({
      invoice_num: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      actions,
    });
    setBusy(false);
    if (!res.success) {
      setError(res.error || 'That invoice could not be applied');
      return;
    }
    const { updated, inserted, pairs: done, missing } = res.data!;
    onApplied(
      `Invoice ${invoice.invoice_number} applied — ${done} ${done === 1 ? 'pair' : 'pairs'} across ${updated} `
      + `${updated === 1 ? 'line' : 'lines'}${inserted ? `, ${inserted} added to the book` : ''}`
      + `${missing.length ? `, ${missing.length} line(s) no longer existed` : ''}`
    );
  }

  return (
    // A real modal: the backdrop takes the click, and the panel scrolls on its own so a 60-line invoice cannot push the buttons off
    // the bottom of the screen.
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl">
        {/* What was read off the paperwork. Shown first because everything below is only meaningful if this is the right invoice. */}
        <header className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">
              Invoice <span className="font-mono">{invoice.invoice_number}</span>
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              dated <span className="tabular-nums">{invoice.invoice_date}</span>
              {invoice.order_number && <> against order <span className="font-mono">{invoice.order_number}</span></>}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-sm text-slate-500">
              <span className="font-semibold tabular-nums text-slate-900">{parsedPairs}</span> pairs read
              {invoice.total_invoiced != null && <> of <span className="tabular-nums">{invoice.total_invoiced}</span> on the invoice</>}
            </p>
            <p className="text-xs text-slate-400">{entries.length} {entries.length === 1 ? 'line' : 'lines'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </header>

        {/* THE WHOLE INVOICE IS ALREADY IN. Without this the dialog opens with every line unticked and a footer reading "0 of 5
            lines, 0 pairs to add", which is accurate and explains nothing — the operator is left to infer from five repeated labels
            that the file has been loaded before. Said once, at the top, in the words they would use themselves. */}
        {allAlreadyInvoiced && (
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-700">
            <span className="font-medium">This invoice has already been loaded.</span> Every line on it is already counted against the
            order book, so nothing is ticked and applying it would change nothing. Close this unless a pair really was billed twice.
          </div>
        )}

        {/* The one disagreement that must never pass quietly — see the header note. */}
        {!totalsAgree && (
          <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              The lines read add up to <span className="font-semibold tabular-nums">{parsedPairs}</span> pairs, but the invoice says{' '}
              <span className="font-semibold tabular-nums">{invoice.total_invoiced ?? '—'}</span>. Something was not read correctly —
              check it against the PDF before applying.
            </p>
          </div>
        )}

        <div className="max-h-[55vh] overflow-y-auto px-5 py-3">
          <ul className="space-y-1.5">
            {entries.map((e, i) => {
              const a = answers[i];
              return (
                <li key={`${e.article}-${e.ordernum}-${e.size}-${i}`} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {/* Every line is tickable, including the ready ones: the operator may know a line belongs to a different
                        delivery, and un-ticking is how the Python's [i]gnore is expressed here. */}
                    <input
                      type="checkbox"
                      checked={a.include}
                      onChange={(ev) => set(i, { include: ev.target.checked })}
                      className="h-4 w-4 rounded border-slate-300"
                      aria-label={`Include ${e.article} size ${e.size}`}
                    />
                    <span className={'rounded px-1.5 py-0.5 text-xs font-medium ' + KIND_STYLE[e.kind]}>{KIND_LABEL[e.kind]}</span>
                    <span className="font-mono text-xs tabular-nums text-slate-500">{e.ordernum}</span>
                    <span className="font-mono text-xs text-slate-700">{a.code || e.article}</span>
                    <span className="text-xs tabular-nums text-slate-500">
                      size {e.size}{e.eu && <span className="text-slate-400"> (EU {e.eu})</span>}
                    </span>
                    <span className="ml-auto text-sm font-medium tabular-nums text-slate-800">
                      +{e.qty} {e.qty === 1 ? 'pair' : 'pairs'}
                    </span>
                  </div>

                  {/* The row this lands on, and the number it would BECOME. "+1 pair" on its own is an abstract promise; "1 -> 2 of
                      1 ordered" is the thing the operator is actually agreeing to, and for an already-invoiced line it is also the
                      argument for leaving it alone. */}
                  {e.row && (
                    <p className="mt-1 pl-7 text-xs text-slate-500">
                      {e.kind === 'already_invoiced' ? (
                        <>
                          This line was already counted from invoice <span className="font-mono">{e.row.invoicenum}</span> — the same
                          one you have just loaded. Tick it only if this pair really was billed twice: invoiced would go{' '}
                          <span className="tabular-nums">{e.row.invoiced ?? 0}</span> →{' '}
                          <span className="font-medium tabular-nums text-amber-700">{(e.row.invoiced ?? 0) + e.qty}</span> of{' '}
                          <span className="tabular-nums">{e.row.requested ?? '—'}</span> ordered.
                        </>
                      ) : (
                        <>
                          Invoiced <span className="tabular-nums">{e.row.invoiced ?? 0}</span> →{' '}
                          <span className="font-medium tabular-nums text-slate-700">{(e.row.invoiced ?? 0) + e.qty}</span> of{' '}
                          <span className="tabular-nums">{e.row.requested ?? '—'}</span> ordered
                          {e.row.invoicenum && <> — currently marked invoice <span className="font-mono">{e.row.invoicenum}</span></>}
                        </>
                      )}
                    </p>
                  )}

                  {/* AMBIGUOUS: pick the row. Deliberately buttons rather than a dropdown — there are two or three, and the numbers
                      on each are what the choice is made on, so they should all be readable at once. */}
                  {e.kind === 'ambiguous' && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5 pl-7">
                      {e.candidates.map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => set(i, { code: c.code, include: true })}
                          className={
                            'rounded border px-2 py-1 text-left font-mono text-xs ' +
                            (a.code === c.code ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white hover:bg-slate-50')
                          }
                        >
                          {c.code}
                          <span className="ml-2 text-slate-500">invoiced {c.invoiced ?? 0}{c.invoicenum ? ` · ${c.invoicenum}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* MISSING: the code to create. Editable, because the suggestion is only as good as the article's other rows — and
                      when none exist there is no suggestion at all and it has to be typed. */}
                  {e.kind === 'missing' && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-7">
                      <label className="text-xs text-slate-500">New code</label>
                      <input
                        value={a.code}
                        onChange={(ev) => set(i, { code: ev.target.value })}
                        placeholder="no suggestion — type the code"
                        className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                      <span className="text-xs text-slate-400">added with no ordered quantity</span>
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
            {actions.length === 0 ? (
              <span className="text-slate-500">
                {allAlreadyInvoiced ? 'Nothing to add — this invoice is already counted' : 'Nothing ticked, so nothing will change'}
              </span>
            ) : (
              <>
                <span className="font-semibold tabular-nums">{actions.length}</span> of {entries.length} lines,{' '}
                <span className="font-semibold tabular-nums">{pairs}</span> {pairs === 1 ? 'pair' : 'pairs'} to add
              </>
            )}
            {unanswered > 0 && <span className="ml-2 text-amber-700">{unanswered} still need a row picking</span>}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              {actions.length === 0 ? 'Close' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={busy || actions.length === 0}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {busy ? 'Applying…' : actions.length === 0 ? 'Nothing to apply' : `Apply ${pairs} ${pairs === 1 ? 'pair' : 'pairs'}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
