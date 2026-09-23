'use client';
/*
=======================================================================================================================================
Page: /segments/[name]  (Segments module — segment detail)
=======================================================================================================================================
Purpose: The screen behind clicking a segment. Header stats, then the only two edits a segment needs (owner, 2026-09-23):
           - RENAME, inline on the heading (pencil -> input -> Save). Rewrites the tag on every product (POST /segment-rename).
           - APPLIES / NOT APPLICABLE per work area, as a switch on each area row (POST /segment-work with off=true|false).
         Everything else was cut in the same pass: the per-area "Update" form (note, review chips, "Log work"), the Open pricing /
         Open Amazon links, and the recent-activity log. Segment work is no longer logged at all (routes/segment-work.js).
         Consumes GET /segment.
=======================================================================================================================================
*/

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSegmentDetail, setSegmentAreaOff, renameSegment, SegmentAreaCell } from '@/lib/api';
import { dueTone, dueText, fmtMoney } from '@/lib/segmentUi';

export default function SegmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name);

  const { data: detail, error: loadError, isLoading: loading, refresh: reload } = useApiQuery(
    ['segment-detail', name],
    () => getSegmentDetail(name),
  );
  const error = loadError?.message ?? null;

  // No AppShell title: the heading is rendered here because it carries the rename control, and AppShell's title is a plain string.
  // Back to the SEGMENT tab explicitly — bare /segments opens Top earners (the default tab since 2026-09-23).
  return (
    <AppShell backHref="/segments?by=segment" backLabel="Repricing">
      <div className="space-y-6">
        <SegmentName current={name} onRenamed={(newName) => router.replace(`/segments/${encodeURIComponent(newName)}`)} />

        {loading && <p className="text-sm text-slate-400">Loading…</p>}
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {detail && (
          <>
            {!detail.active && (
              <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500">
                This segment is inactive — no products currently carry this tag.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Revenue 30d" value={fmtMoney(detail.stats.revenue30)} />
              <Stat label="Gross profit" value={detail.stats.gpPct !== null ? `${detail.stats.gpPct}%` : '—'} />
              <Stat label="In stock" value={detail.stats.stock.toLocaleString('en-GB')} />
              <Stat label="Styles" value={String(detail.stats.styles)} />
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Work areas</h2>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
                {detail.areas.map((cell) => (
                  <AreaRow key={cell.area} segment={name} cell={cell} onChanged={reload} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

// The page heading, editable in place. Renames the tag on every product in the segment and carries its clocks across (spec §2.2);
// the server enforces the 20-character cap and uniqueness, the input just mirrors the cap.
function SegmentName({ current, onRenamed }: { current: string; onRenamed: (newName: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = value.trim();
  const canSave = !busy && !!trimmed && trimmed !== current;

  function cancel() {
    setEditing(false); setValue(current); setErr(null);
  }

  async function save() {
    if (!canSave) return;
    setBusy(true); setErr(null);
    const res = await renameSegment(current, trimmed);
    setBusy(false);
    if (res.success) { setEditing(false); onRenamed(trimmed); }
    else setErr(res.error || 'Rename failed');
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{current}</h1>
        <button
          type="button"
          onClick={() => { setValue(current); setEditing(true); }}
          title="Rename segment"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <PencilSquareIcon className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          maxLength={20}
          className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-xl font-semibold tracking-tight text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button
          onClick={save}
          disabled={!canSave}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={cancel} disabled={busy} className="rounded-md px-3 py-2 text-sm text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">Renames the tag on every product in this segment. Max 20 characters.</p>
      {err && <div className="mt-1.5 text-xs text-red-600">{err}</div>}
    </div>
  );
}

// One work area: its name, its status, and a switch for whether it applies to this segment at all. Off = "not applicable" (e.g. a
// segment not sold on Amazon); the server hides it from review and keeps its clock underneath, so switching back on resumes it.
function AreaRow({ segment, cell, onChanged }: { segment: string; cell: SegmentAreaCell; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const applies = cell.dueState !== 'off';

  async function toggle() {
    setSaving(true); setErr(null);
    const res = await setSegmentAreaOff(segment, cell.area, applies);
    setSaving(false);
    if (res.success) onChanged();
    else setErr(res.error || 'Failed to save');
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <span className={'w-28 text-base font-semibold ' + (applies ? 'text-slate-800' : 'text-slate-400')}>{cell.area}</span>
      {applies ? (
        <span className={'rounded-full border px-2.5 py-0.5 text-xs font-medium ' + dueTone(cell.dueState)}>{dueText(cell)}</span>
      ) : (
        <span className="text-sm text-slate-400">Not applicable</span>
      )}
      {err && <span className="text-xs text-red-600">{err}</span>}

      <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-slate-500">
        Applies
        <button
          type="button"
          role="switch"
          aria-checked={applies}
          aria-label={`${cell.area} applies to this segment`}
          onClick={toggle}
          disabled={saving}
          className={
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ' +
            (applies ? 'bg-brand-600' : 'bg-slate-300')
          }
        >
          <span className={'inline-block h-5 w-5 rounded-full bg-white shadow transition ' + (applies ? 'translate-x-5' : 'translate-x-0.5')} />
        </button>
      </label>
    </div>
  );
}
