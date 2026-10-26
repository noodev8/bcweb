'use client';
/*
=======================================================================================================================================
Component: GoogleAllowanceBar
=======================================================================================================================================
Purpose: The Google allowance on the Google Ads screen — Google spend per Shopify unit sold over 90 days, FIXED and re-measured
         quarterly BY BUTTON (bcweb-server/utils/googleAllowance.js). Moved here 2026-10-26 from the Today screen when it was removed
         (owner: "move it to the google ads screen"); it is a reference figure now — nothing calculates from it.

         Re-measure SHOWS the new figure beside the one in force and changes nothing until Accept (owner, 2026-10-25: "display the new
         fixed number before it is accepted"). A MEASURE_CHANGED on Accept (late sales / a re-import moved it since it was shown)
         re-measures and shows the new figure again, so what is accepted is always what was seen. "Due" = 90 days since the last Accept.
=======================================================================================================================================
*/

import { useState } from 'react';
import { acceptGoogleAllowance, getGoogleAllowance, measureGoogleAllowance, type GoogleAllowanceMeasure } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}
function money2(v: number): string {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toFixed(2)}`;
}
// 'YYYY-MM-DD' -> '25 Oct'. Parsed as parts, never through Date (a bare date string is read as UTC/local and can shift a day).
function shortDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${day} ${mon}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

export default function GoogleAllowanceBar() {
  const q = useApiQuery('google-allowance', () => getGoogleAllowance());
  const a = q.data ?? null;
  const [proposal, setProposal] = useState<GoogleAllowanceMeasure | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function remeasure() {
    setBusy(true); setMsg(null);
    const res = await measureGoogleAllowance();
    setBusy(false);
    if (res.success && res.data) setProposal(res.data);
    else setMsg(res.error || 'Could not measure');
  }
  async function accept() {
    if (!proposal || proposal.perUnit === null) return;
    setBusy(true); setMsg(null);
    const res = await acceptGoogleAllowance(proposal.perUnit, proposal.windowTo);
    if (res.success) {
      setProposal(null);
      setBusy(false);
      q.refresh();
      return;
    }
    if (res.return_code === 'MEASURE_CHANGED') {
      const again = await measureGoogleAllowance();
      if (again.success && again.data) setProposal(again.data);
    }
    setBusy(false);
    setMsg(res.error || 'Could not save');
  }

  // Still loading (or failed) — say nothing rather than "not set", which would be untrue.
  if (q.data === undefined) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-slate-600">
          Google cost per Shopify unit <span className="font-semibold text-slate-900">{a ? money2(a.perUnit) : 'not set'}</span>
        </span>
        {a && (
          <span className="text-xs text-slate-400">
            {a.spend !== null && a.units !== null && (
              <>{money(a.spend)} ÷ {a.units.toLocaleString('en-GB')} units, {shortDate(a.windowFrom)} – {shortDate(a.windowTo)} · </>
            )}
            accepted {shortDate(a.acceptedOn)} by {a.acceptedBy} · re-measure due {shortDate(a.dueOn)}
          </span>
        )}
        {a?.due && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Due</span>}
        {!proposal && (
          <button
            type="button" onClick={remeasure} disabled={busy}
            className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
          >
            {busy ? 'Measuring…' : 'Re-measure'}
          </button>
        )}
      </div>

      {proposal && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
          {proposal.perUnit === null ? (
            <span className="text-slate-600">Nothing sold on Shopify in {shortDate(proposal.windowFrom)} – {shortDate(proposal.windowTo)}, so there is no figure.</span>
          ) : (
            <span className="text-slate-600">
              New figure <span className="font-semibold text-slate-900">{money2(proposal.perUnit)}</span>
              {a && <span className="text-slate-400"> (now {money2(a.perUnit)})</span>}
              <span className="text-xs text-slate-400">
                {' '}· {money(proposal.spend)} Google spend ÷ {proposal.units.toLocaleString('en-GB')} Shopify units,{' '}
                {shortDate(proposal.windowFrom)} – {shortDate(proposal.windowTo)}
              </span>
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {proposal.perUnit !== null && (
              <button
                type="button" onClick={accept} disabled={busy}
                className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Saving…' : `Accept ${money2(proposal.perUnit)}`}
              </button>
            )}
            <button
              type="button" onClick={() => { setProposal(null); setMsg(null); }} disabled={busy}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
            >
              Keep {a ? money2(a.perUnit) : 'as is'}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-red-700">{msg}</p>}
    </div>
  );
}
