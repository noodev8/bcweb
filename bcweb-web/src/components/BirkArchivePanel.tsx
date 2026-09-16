'use client';
/*
=======================================================================================================================================
Component: BirkArchivePanel
=======================================================================================================================================
Purpose: What "Archive arrived" has taken off the Birkenstock order book, and the way back. Opens from the Birk Tracker toolbar; reads
         /birk-tracker-archive and writes /birk-tracker-restore.

WHY A PANEL AND NOT A FOURTH STATUS TAB (owner, 2026-09-16). The tab reads more naturally — "Still to come / On the way / Arrived /
Archived" — and it was the wrong answer. BirkTrackerBook derives its headline totals, both filter rails, the picker roll-ups and the
scan's scope from ONE array of live rows; an archived line belongs to none of those, so a tab would mean an exclusion added by hand to
every one of them, silently wrong wherever it was missed. The archive is a different question — "what did we clear?" rather than "what
is outstanding?" — and different questions get their own surface. The book's arithmetic is then untouched by this feature existing.
It also means the archive is only fetched when someone opens it, rather than on every load of a screen that is worked every week.

ONE PRESS IS ONE BATCH, and the batch is the unit on screen. The operator cleared a delivery; the thing they want back is that
delivery, not a list of 600 lines they have to pick through. Each batch says who, when, the scope they had filtered to at the time
('all' or 'order 0001927328'), and how much of it can still go back — and carries one Restore button. The lines are there underneath,
collapsed, for the other case.

THE TWO GRAINS (owner, 2026-09-16):
  RESTORE THE BATCH   the common case, and the reason an undo was asked for: wrong button, or the right button with the wrong filter.
  RESTORE SOME LINES  the press was right but one line turns out to be short after all. Putting the whole delivery back to fix one
                      size would return thirteen finished lines to a screen whose job is to show what is unfinished.
Selection is per batch — the checkboxes and the restore button live inside the batch they belong to — because a selection spanning
two clears is not a thing anyone means to make.

SOME LINES CANNOT GO BACK, AND THE SCREEN SAYS SO UP FRONT. The book is keyed on (ordernum, code), the archive deliberately is not, so
a style cleared this season and ordered again next season has its pair in use again; restoring would overwrite a live order line, which
the server refuses to do. Those rows are shown struck through and greyed, their checkbox disabled, with the batch header counting what
is left ("12 of 14 can go back"). A Restore button that fails when pressed would be worse than one never offered — and the operator
still needs to see that the line is in the archive, or "where did that line go?" has no answer at all.

`restored` AND `skipped` ARE BOTH NORMAL. The server re-checks at the moment of writing, so a line can become unrestorable between the
read and the press; it comes back in `skipped` with the row kept in the archive, and the notice says so rather than claiming a clean
run. Same treatment as the book's own over-invoice flags: report what happened, do not hide the awkward half.

NOTHING HERE IS A DELETE. There is no way to remove a row from the archive except by restoring it, on purpose: an archive with a
delete button is just the old behaviour with an extra click, and this exists because that behaviour lost things.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { ArrowUturnLeftIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { getBirkTrackerArchive, restoreBirkTrackerLines, type BirkArchiveBatch } from '@/lib/api';

// `archived_at` is a real ISO timestamp — the one date in this module that IS a date and can safely be parsed (the book's own
// `placed` / `invoice_date` are supplier display strings in two different formats and are never fed to a Date; see the route header).
function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// The scope as stored ('all', 'order 0001927328') turned into something that reads in a sentence.
function scopeLabel(scope: string): string {
  if (!scope || scope === 'all') return 'the whole book';
  return scope;
}

export default function BirkArchivePanel({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const { data, error, isLoading, refresh } = useApiQuery('birk-tracker-archive', getBirkTrackerArchive);

  // Which batch is expanded, and which of its lines are ticked. Selection is keyed by batch so opening another one cannot carry a
  // half-made selection across to it.
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Set<number>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const batches = useMemo(() => data?.batches ?? [], [data]);

  function toggleLine(batchId: string, id: number) {
    setPicked((prev) => {
      const next = new Set(prev[batchId] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [batchId]: next };
    });
  }

  // One path for both grains: the scope differs, the aftermath does not. `expected` counts only what CAN go back, which is the
  // number on the button the operator just pressed — the server is confirming the same figure the screen showed them.
  async function restore(batch: BirkArchiveBatch, ids: number[] | null) {
    setBusy(true);
    setNotice(null);
    const res = ids
      ? await restoreBirkTrackerLines({ scope: 'lines', ids, expected: ids.length })
      : await restoreBirkTrackerLines({ scope: 'batch', batch_id: batch.batch_id, expected: batch.restorable });
    setBusy(false);

    if (!res.success) {
      // CHANGED is a normal outcome, not a fault — someone else restored part of this batch while the panel sat open.
      setNotice({ tone: 'warn', text: res.error || 'Could not restore those lines' });
      await refresh();
      return;
    }

    const { restored, skipped } = res.data!;
    setPicked((prev) => ({ ...prev, [batch.batch_id]: new Set() }));
    await refresh();
    onRestored();   // the book itself has changed — the lines are back on it

    const parts = [`Put ${restored} ${restored === 1 ? 'line' : 'lines'} back on the book`];
    if (skipped.length) parts.push(`${skipped.length} could not go back — ordered again since (${skipped.slice(0, 2).map((s) => s.code).join(', ')}${skipped.length > 2 ? '…' : ''})`);
    setNotice({ tone: skipped.length ? 'warn' : 'ok', text: parts.join(' — ') });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Archive</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Lines cleared off the book. Nothing here is deleted — any of it can go back.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close the archive"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="space-y-3 px-4 py-3">
        {notice && (
          <div className={'rounded-md px-3 py-2 text-sm ' + (notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')}>
            {notice.text}
            <button onClick={() => setNotice(null)} className="ml-3 text-xs underline opacity-70">Dismiss</button>
          </div>
        )}

        {isLoading && <p className="py-6 text-center text-sm text-slate-500">Loading the archive…</p>}
        {error && <p className="py-6 text-center text-sm text-amber-800">{error.message}</p>}

        {!isLoading && !error && batches.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-600">Nothing has been archived yet.</p>
        )}

        {data?.truncated && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Showing the most recent batches only — the safety cap cut the rest.
          </div>
        )}

        {batches.map((b) => {
          const sel = picked[b.batch_id] ?? new Set<number>();
          const isOpen = open === b.batch_id;
          const selectable = b.rows.filter((r) => r.restorable).length;
          return (
            <article key={b.batch_id} className="rounded-lg border border-slate-200">
              {/* The batch header is the whole story of one press: who, when, over what, and how much of it can still come back. */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : b.batch_id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-sm text-slate-900">
                    <span className="font-semibold tabular-nums">{b.lines}</span>{' '}
                    {b.lines === 1 ? 'line' : 'lines'} from {scopeLabel(b.scope)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {when(b.archived_at)} · {b.archived_by} · {b.pairs} {b.pairs === 1 ? 'pair' : 'pairs'}
                    {b.restorable < b.lines && (
                      <span className="text-amber-700"> · {b.restorable} of {b.lines} can go back</span>
                    )}
                    <span className="ml-2 underline opacity-70">{isOpen ? 'hide lines' : 'show lines'}</span>
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => restore(b, null)}
                  disabled={busy || b.restorable === 0}
                  title={b.restorable === 0 ? 'Every line in this batch has been ordered again since' : undefined}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4" /> Restore all
                  {b.restorable > 0 && <span className="tabular-nums text-slate-400">{b.restorable}</span>}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-slate-200">
                  <ul className="divide-y divide-slate-100">
                    {b.rows.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={sel.has(r.id)}
                          disabled={!r.restorable || busy}
                          onChange={() => toggleLine(b.batch_id, r.id)}
                          className="h-4 w-4 rounded border-slate-300 disabled:opacity-30"
                          aria-label={`Restore ${r.code}`}
                        />
                        <span className={'min-w-0 flex-1 truncate font-mono text-xs ' + (r.restorable ? 'text-slate-700' : 'text-slate-400 line-through')}>
                          {r.code}
                        </span>
                        <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">{r.ordernum}</span>
                        <span className="shrink-0 tabular-nums text-xs text-slate-500">{r.requested}</span>
                        <span className="hidden w-24 shrink-0 truncate text-right text-xs text-slate-500 md:inline">{r.invoice_num}</span>
                        {!r.restorable && <span className="shrink-0 text-xs text-amber-700">ordered again</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2">
                    <p className="text-xs text-slate-500">
                      {sel.size > 0
                        ? `${sel.size} of ${selectable} selected`
                        : 'Tick lines to put back just those.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => restore(b, [...sel])}
                      disabled={busy || sel.size === 0}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ArrowUturnLeftIcon className="h-4 w-4" /> Restore selected
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
