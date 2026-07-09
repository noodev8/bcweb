'use client';
/*
=======================================================================================================================================
Page: /segments/[name]  (Segments module — segment detail)
=======================================================================================================================================
Purpose: The screen behind clicking a segment (docs/segments-spec.md §3). Header stats + the per-area review clocks with a
         "Mark worked" action (log the work + optionally set the next review), the recent work-log history, and a rename control.
         Consumes GET /segment; writes via POST /segment-work and POST /segment-rename.
=======================================================================================================================================
*/

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ClockIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { getSegmentDetail, logSegmentWork, renameSegment, SegmentDetail, SegmentAreaCell } from '@/lib/api';
import { SEGMENT_REVIEW_CHIPS, dueTone, dueText, fmtMoney, fmtDate, fmtDateTime } from '@/lib/segmentUi';

export default function SegmentDetailPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const params = useParams<{ name: string }>();
  const name = decodeURIComponent(params.name);

  const [detail, setDetail] = useState<SegmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await getSegmentDetail(name);
    if (res.success && res.data) { setDetail(res.data); setError(null); }
    else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load segment');
    }
    setLoading(false);
  }, [name, logout]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <AppShell title={name} subtitle="Segment" backHref="/segments" backLabel="All segments">
      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {detail && (
        <div className="space-y-6">
          {!detail.active && (
            <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500">
              This segment is inactive — no products currently carry this tag. Its history is kept for reference.
            </div>
          )}

          {/* Header stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Revenue 30d" value={fmtMoney(detail.stats.revenue30)} />
            <Stat label="Gross profit" value={detail.stats.gpPct !== null ? `${detail.stats.gpPct}%` : '—'} />
            <Stat label="In stock" value={detail.stats.stock.toLocaleString('en-GB')} />
            <Stat label="Styles" value={String(detail.stats.styles)} />
          </div>

          {/* Area clocks */}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Work areas</h2>
            <div className="space-y-3">
              {detail.areas.map((cell) => (
                <AreaCard key={cell.area} segment={name} cell={cell} onWorked={reload} />
              ))}
            </div>
          </div>

          {/* Work-log history */}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent activity</h2>
            {detail.worklog.length === 0 ? (
              <p className="text-sm text-slate-400">No work logged yet.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <tbody>
                    {detail.worklog.map((w, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="whitespace-nowrap px-4 py-2 text-slate-400">{fmtDateTime(w.workedAt)}</td>
                        <td className="px-3 py-2"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{w.area}</span></td>
                        <td className="px-3 py-2 font-medium text-slate-700">{w.workedBy || '—'}</td>
                        <td className="px-4 py-2 text-slate-500">{w.note || <span className="text-slate-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.truncated && (
                  <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">Showing the last {detail.limit} events.</div>
                )}
              </div>
            )}
          </div>

          {/* Rename */}
          <RenameCard current={name} onRenamed={(newName) => router.replace(`/segments/${encodeURIComponent(newName)}`)} />
        </div>
      )}
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

// One work area: its clock summary + a collapsible "Mark worked" form (log the work, optionally set the next review).
function AreaCard({ segment, cell, onWorked }: { segment: string; cell: SegmentAreaCell; onWorked: () => void }) {
  const [open, setOpen] = useState(false);
  const [reviewDays, setReviewDays] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isShopify = cell.area.toLowerCase() === 'shopify';

  async function save() {
    setSaving(true); setErr(null);
    const res = await logSegmentWork(segment, cell.area, reviewDays, note.trim() || undefined);
    setSaving(false);
    if (res.success) { setOpen(false); setReviewDays(null); setNote(''); onWorked(); }
    else setErr(res.error || 'Failed to save');
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-base font-semibold text-slate-800">{cell.area}</span>
        <span className={'rounded-full border px-2.5 py-0.5 text-xs font-medium ' + dueTone(cell.dueState)}>{dueText(cell)}</span>
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <ClockIcon className="h-3.5 w-3.5" /> every {cell.cadenceDays}d
        </span>
        <span className="text-xs text-slate-400">
          {cell.lastWorkedAt ? <>Last: {cell.lastWorkedBy || '—'} · {fmtDate(cell.lastWorkedAt)}</> : 'Never worked'}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {isShopify && (
            <Link href={`/pricing/${encodeURIComponent(segment)}`} className="text-sm font-medium text-brand-600 hover:underline">
              Open pricing →
            </Link>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {open ? 'Cancel' : 'Mark worked'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="mb-1 text-sm font-medium text-slate-700">
            Note <span className="font-normal text-slate-400">(optional)</span>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="What did you do / decide?"
            className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />

          <div className="mb-1 text-sm font-medium text-slate-700">
            Next review <span className="font-normal text-slate-400">(optional — when this area is due again)</span>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setReviewDays(null)}
              className={'rounded-full border px-3.5 py-1.5 text-sm ' + (reviewDays === null ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}
            >
              None
            </button>
            {SEGMENT_REVIEW_CHIPS.map((c) => (
              <button
                key={c.days}
                onClick={() => setReviewDays(c.days)}
                className={'rounded-full border px-3.5 py-1.5 text-sm ' + (reviewDays === c.days ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}
              >
                {c.label}
              </button>
            ))}
          </div>

          {err && <div className="mb-3 text-xs text-red-600">{err}</div>}

          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : reviewDays === null ? 'Log work' : 'Log work + set review'}
          </button>
        </div>
      )}
    </div>
  );
}

// Rename a segment. Rewrites product membership + registry name; the tool owns rename so cadence/log carry across (spec §2.2).
function RenameCard({ current, onRenamed }: { current: string; onRenamed: (newName: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const newName = value.trim();
    if (!newName || newName === current) return;
    setBusy(true); setErr(null);
    const res = await renameSegment(current, newName);
    setBusy(false);
    if (res.success) onRenamed(newName);
    else setErr(res.error || 'Rename failed');
  }

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-medium text-slate-600">Rename segment</summary>
      <p className="mt-2 text-xs text-slate-400">
        Renames the tag on every product in this segment and keeps its clocks and history. Max 20 characters.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20}
          placeholder={current}
          className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button
          onClick={submit}
          disabled={busy || !value.trim() || value.trim() === current}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? 'Renaming…' : 'Rename'}
        </button>
      </div>
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
    </details>
  );
}
