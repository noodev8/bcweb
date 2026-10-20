'use client';
/*
=======================================================================================================================================
Component: SliderRulesForm  (Pricing Slider — create a group / edit its rules)
=======================================================================================================================================
Purpose: The one form for a slider group's rules, used by "New slider" on /slider and "Edit rules" on /slider/[id]. Saves through
         POST /slider-group-save; the server validates again (never trust the form).

THE TWO HELPERS THAT ANSWER "WILL IT BE DONE IN TIME?" (owner, 2026-10-17: "I don't want it to wait too long and the season is over"):
  - under the rules, live: "22 moves · floor in 42 days (28 Nov)". A product starting at RRP, every move pressed on the day it is due,
    nothing selling (lib/sliderUi.ts → fromRrp). Kept to one short line (owner: "no need for so much text inside the cards").
  - "Reach the floor by [date] → Work out step": the reverse, sets the step % (lib/sliderUi.ts → stepForDays).
  The due date is optional (owner: "no need to over complicate that part") — "Use 28 Nov" fills it with the date above.

CHANNEL is chosen once, on create: a Shopify group holds styles and an Amazon group SKUs, so it can't switch later.
FLOOR is the human's choice, unrestricted (owner: "they might just want to clear some rubbish too"); break-even is the protection on offer.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { saveSliderGroup, SliderChannel } from '@/lib/api';
import { ChannelLogo } from '@/components/ChannelBadge';
import { addDays, daysBetween, fmtDay, fromRrp, londonToday, stepForDays } from '@/lib/sliderUi';

export interface SliderRulesInitial {
  id: number;
  name: string;
  channel: SliderChannel;
  step_pct: number;
  every_days: number;
  floor_pct: number;
  floor_breakeven: boolean;
  stop_after_sales: number;
  due_date: string | null;
  notes: string | null;
}

interface Props {
  initial?: SliderRulesInitial;            // omitted = create
  onSaved: (id: number) => void;
  onCancel: () => void;
}

// Text state for the number boxes (so "2." can be typed), parsed on use.
const parse = (s: string) => (s.trim() === '' ? NaN : Number(s));

export default function SliderRulesForm({ initial, onSaved, onCancel }: Props) {
  const creating = !initial;
  const today = londonToday();
  const [name, setName] = useState(initial?.name ?? '');
  const [channel, setChannel] = useState<SliderChannel>(initial?.channel ?? 'SHP');
  // Defaults for a new group: the Caprice example the slider was designed on — 2% every 2 days, floor at half RRP, stop on the first sale.
  const [step, setStep] = useState(String(initial?.step_pct ?? 2));
  const [every, setEvery] = useState(String(initial?.every_days ?? 2));
  const [floor, setFloor] = useState(String(initial?.floor_pct ?? 50));
  const [breakeven, setBreakeven] = useState(initial?.floor_breakeven ?? true); // ticked for a new slider (owner, 2026-10-20) — untick to clear rubbish below cost
  const [stopAfter, setStopAfter] = useState(initial?.stop_after_sales ?? 1);
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [finishBy, setFinishBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepN = parse(step);
  const everyN = parse(every);
  const floorN = parse(floor);
  const run = useMemo(() => fromRrp(stepN, floorN, everyN), [stepN, floorN, everyN]);
  const runEnds = run ? addDays(today, run.days) : null;

  const finishStep = finishBy ? stepForDays(daysBetween(today, finishBy), floorN, everyN) : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await saveSliderGroup({
      ...(initial ? { id: initial.id } : { channel }),
      name: name.trim(),
      stepPct: stepN,
      everyDays: everyN,
      floorPct: floorN,
      floorBreakeven: breakeven,
      stopAfterSales: stopAfter,
      dueDate: dueDate || null,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!(r.success && r.data)) { setError(r.error || 'Could not save'); return; }
    onSaved(r.data.id);
  }

  const box = 'rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';
  const label = 'mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500';
  const chip = (on: boolean) =>
    'rounded-md border px-3 py-1.5 text-sm font-medium transition ' +
    (on ? 'border-slate-400 bg-slate-200 text-slate-900' : 'border-slate-300 text-slate-600 hover:bg-slate-50');

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[220px] flex-1">
          <label className={label}>Name</label>
          <input autoFocus={creating} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Caprice NEW" className={`w-full ${box}`} aria-label="Name" />
        </div>
        <div>
          <label className={label}>Channel</label>
          {creating ? (
            <div className="flex gap-2">
              {(['SHP', 'AMZ'] as SliderChannel[]).map((c) => (
                <button key={c} type="button" onClick={() => setChannel(c)} className={`${chip(channel === c)} inline-flex items-center gap-2`}>
                  <ChannelLogo channel={c === 'SHP' ? 'shopify' : 'amazon'} />
                  {c === 'SHP' ? 'Shopify · per style' : 'Amazon · per size'}
                </button>
              ))}
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 py-1.5 text-sm text-slate-700">
              <ChannelLogo channel={channel === 'SHP' ? 'shopify' : 'amazon'} />
              {channel === 'SHP' ? 'Shopify · per style' : 'Amazon · per size'}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <label className={label}>Step (% of RRP)</label>
          <input inputMode="decimal" value={step} onChange={(e) => setStep(e.target.value)} className={`w-24 ${box}`} aria-label="Step, percent of RRP" />
        </div>
        <div>
          <label className={label}>Every (days)</label>
          <input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} className={`w-20 ${box}`} aria-label="Every, days" />
        </div>
        <div>
          <label className={label}>Floor (% of RRP)</label>
          <input inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} className={`w-24 ${box}`} aria-label="Floor, percent of RRP" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700" title="Also never go below the price that keeps £0 after fees (the same profit formula sales are booked with)">
          <input type="checkbox" checked={breakeven} onChange={(e) => setBreakeven(e.target.checked)} aria-label="Never below break-even" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
          Never below break-even
        </label>
        <div>
          <label className={label}>Stop after</label>
          <div className="flex gap-1.5">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" onClick={() => setStopAfter(n)} className={chip(stopAfter === n)}>
                {n} sale{n === 1 ? '' : 's'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Will it be done in time? */}
      <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
        {/* From RRP, nothing selling. "Start from RRP" on a product below RRP spends one more interval on the lift. */}
        {run ? (
          <>
            <span className="font-semibold text-slate-800">{run.moves} move{run.moves === 1 ? '' : 's'}</span> · floor in{' '}
            <span className="font-semibold text-slate-800">{run.days} days</span> ({fmtDay(runEnds, today)})
          </>
        ) : (
          '—'
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span>Reach the floor by</span>
          <input type="date" value={finishBy} min={addDays(today, 1)} onChange={(e) => setFinishBy(e.target.value)} className={box} aria-label="Reach the floor by" />
          {finishBy && (finishStep !== null ? (
            <button type="button" onClick={() => setStep(String(finishStep))} className="text-sm font-medium text-slate-900 hover:underline">
              Use a step of {finishStep}%
            </button>
          ) : (
            <span className="text-amber-700">Not possible</span>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <label className={label}>Due date <span className="normal-case text-slate-400">(optional)</span></label>
          <div className="flex items-center gap-2">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={box} aria-label="Due date" />
            {runEnds && dueDate !== runEnds && (
              <button type="button" onClick={() => setDueDate(runEnds)} className="text-sm font-medium text-slate-900 hover:underline">
                Use {fmtDay(runEnds, today)}
              </button>
            )}
            {dueDate && <button type="button" onClick={() => setDueDate('')} className="text-sm text-slate-500 hover:text-slate-800">Clear</button>}
          </div>
        </div>
        <div className="min-w-[220px] flex-1">
          <label className={label}>Notes <span className="normal-case text-slate-400">(optional)</span></label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="What this slider is for" className={`w-full ${box}`} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={busy || !name.trim() || !run} className="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {busy ? 'Saving…' : creating ? 'Create slider' : 'Save rules'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-800">Cancel</button>
        {error && <span className="text-sm text-red-700">{error}</span>}
      </div>
    </form>
  );
}
