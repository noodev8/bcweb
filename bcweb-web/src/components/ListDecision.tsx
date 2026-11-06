'use client';
/*
=======================================================================================================================================
Components: ListDecision — the decision layer's three pieces, shared by Deep sellers and Clearance (owner, 2026-11-06)
=======================================================================================================================================
  DecisionViewSwitch  To decide | All. To decide (the default) = no decision yet, or due again (lib/listDecisions.ts → isDue); All =
                      every style with its chosen action, to run through them again and change your mind on any row. ?view=all
  DecisionBar         acts on the SELECTED rows (the list's Windows multi-select): pick an action, pick when to look again (the
                      action's default pre-picked), Set. Clear takes the decision back (the row shows its suggestion again).
                      Setting again overwrites, which is how you change your mind. Nothing else happens: no price moves.
  DecisionCell        the Action column. DECIDED = a solid dark tag with the action, and under it when it comes back ("back 1 Mar"),
                      or why it is back ("look again" / "deeper" — the measure grew since). UNDECIDED = the screen's suggestion as a
                      pale dashed tag (Deep sellers), or a dash (Clearance has no suggestion yet).
  Rules and wording: lib/listDecisions.ts; server: bcweb-server/utils/listDecision.js.
=======================================================================================================================================
*/

import { useState } from 'react';
import { clearListDecision, setListDecision, type DecisionList, type ListDecision } from '@/lib/api';
import { LIST_ACTIONS, actionOf, lookAgainChoices, shortDate, type LookAgain } from '@/lib/listDecisions';

const BTN = 'rounded-md border border-slate-300 bg-white px-2.5 py-0.5 text-sm font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white';

export function DecisionViewSwitch({ view, todo, all, onChange }: { view: 'todo' | 'all'; todo: number; all: number; onChange: (v: 'todo' | 'all') => void }) {
  const seg = (v: 'todo' | 'all', label: string, count: number) => (
    <button type="button" onClick={() => onChange(v)} aria-pressed={view === v}
      className={'px-2.5 py-0.5 text-sm font-medium tabular-nums transition ' +
        (view === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
      {label} · {count}
    </button>
  );
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
      {seg('todo', 'To decide', todo)}
      <span className="w-px bg-slate-300" aria-hidden />
      {seg('all', 'All', all)}
    </div>
  );
}

export function DecisionBar({ list, selected, decidedSelected, spring, today, onDone }: {
  list: DecisionList; selected: string[]; decidedSelected: number; spring: string | null; today: string | null;
  onDone: () => void;
}) {
  const [actionKey, setActionKey] = useState('');
  const [when, setWhen] = useState<LookAgain | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const action = actionKey ? actionOf(list, actionKey) : null;
  const none = selected.length === 0;

  const pick = (key: string) => {
    setActionKey(key);
    setWhen(actionOf(list, key)?.dflt ?? null);
    setMsg(null);
  };
  const label = (w: LookAgain) => (w === 'spring' ? `Spring${spring && today ? ` (${shortDate(spring, today)})` : ''}` : `${w} days`);

  const set = async () => {
    if (!action || when === null || none) return;
    setBusy(true); setMsg(null);
    const r = await setListDecision({ list, groupids: selected, action: action.key, ...(when === 'spring' ? { spring: true } : { days: when }) });
    setBusy(false);
    if (!r.success || !r.data) { setMsg({ ok: false, text: r.error || 'Could not save' }); return; }
    const skipped = r.data.skipped.length ? ` · ${r.data.skipped.length} no longer on the list` : '';
    setMsg({ ok: true, text: `${action.label} for ${r.data.saved} style${r.data.saved === 1 ? '' : 's'}${skipped}` });
    onDone();
  };
  const clear = async () => {
    if (none) return;
    setBusy(true); setMsg(null);
    const r = await clearListDecision({ list, groupids: selected });
    setBusy(false);
    if (!r.success || !r.data) { setMsg({ ok: false, text: r.error || 'Could not clear' }); return; }
    setMsg({ ok: true, text: `Cleared ${r.data.cleared}` });
    onDone();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={actionKey} onChange={(e) => pick(e.target.value)} disabled={none} aria-label="Action"
        className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-700 disabled:opacity-40">
        <option value="">Decide…</option>
        {LIST_ACTIONS[list].map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
      </select>
      {action && (
        <>
          <span className="text-sm text-slate-500">look again</span>
          {lookAgainChoices(action).map((w) => (
            <button key={String(w)} type="button" onClick={() => setWhen(w)} aria-pressed={when === w}
              className={'rounded-md border px-2 py-0.5 text-sm tabular-nums transition ' +
                (when === w ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
              {label(w)}
            </button>
          ))}
          <button type="button" onClick={set} disabled={busy || none || when === null} className={BTN}>
            Set{selected.length > 1 ? ` · ${selected.length}` : ''}
          </button>
        </>
      )}
      <button type="button" onClick={clear} disabled={busy || decidedSelected === 0} className={BTN}
        title="Take the decision back — the style is To decide again">
        Clear
      </button>
      {msg && <span className={'text-sm ' + (msg.ok ? 'text-emerald-700' : 'text-red-700')}>{msg.text}</span>}
    </div>
  );
}

export function DecisionCell({ list, d, due, measureNow, today, suggestion }: {
  list: DecisionList; d: ListDecision | undefined; due: boolean; measureNow: number; today: string | null;
  suggestion?: { label: string } | null;
}) {
  if (!d) {
    if (!suggestion) return <span className="text-slate-300">–</span>;
    return (
      <span title="Suggested — not decided yet"
        className="inline-block rounded border border-dashed border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-500">
        {suggestion.label}
      </span>
    );
  }
  const a = actionOf(list, d.action);
  const why = !due ? (today ? `back ${shortDate(d.look_again, today)}` : '')
    : measureNow > d.measure ? 'deeper' : 'look again';
  return (
    <div>
      <span title={`${d.decided_by || 'Someone'} · ${d.decided_at.slice(0, 10)}`}
        className="inline-block rounded bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-white">
        {a?.label ?? d.action}
      </span>
      {why && <div className={'mt-0.5 text-[11px] ' + (due ? 'font-medium text-amber-700' : 'text-slate-400')}>{why}</div>}
    </div>
  );
}
