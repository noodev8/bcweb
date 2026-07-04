'use client';
/*
=======================================================================================================================================
Component: Timeline
=======================================================================================================================================
Purpose: The pricing timeline (CLAUDE.md Stage 2) — one row per distinct price the style has sold at, OLDEST FIRST, showing the
         selling period, units sold at that price, and the PACE (/wk). The whole pricing decision is one relationship: the price we
         charged vs how fast it sold, over time. We show BOTH units and pace because total units mislead across periods of different
         length. The current price's row is marked. We include the honest caveat from the domain notes (CLAUDE.md) so the reader interprets a rise
         correctly (units rising as price rose can be the season arriving, not the price working; the clean signal is a rise where
         pace held).
=======================================================================================================================================
*/

import { TimelineRow } from '@/lib/api';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  // iso is YYYY-MM-DD; render as DD MMM for compactness.
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]}`;
}

export default function Timeline({ rows }: { rows: TimelineRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
        No sales in the window yet. (A just-changed price shows no row until something sells at it.)
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Price</th>
              <th className="px-4 py-2 font-medium">Period</th>
              <th className="px-4 py-2 text-right font-medium">Units</th>
              <th className="px-4 py-2 text-right font-medium">Pace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className={r.is_current ? 'bg-brand-50/50' : ''}>
                <td className="px-4 py-2 font-semibold text-slate-800">
                  £{r.price.toFixed(2)}
                  {r.is_current && <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs font-medium text-brand-700">current</span>}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {fmtDate(r.first_at)} – {r.is_current ? 'now' : fmtDate(r.last_at)}
                </td>
                <td className="px-4 py-2 text-right text-slate-800">{r.units}</td>
                <td className="px-4 py-2 text-right font-medium text-slate-800">{r.per_wk}/wk</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        Pace makes eras of different length comparable. Careful: for seasonal styles, units rising as price rose can be the season
        arriving, not the price working — the cleaner signal for going higher is a price step where the pace <em>held</em>.
      </p>
    </div>
  );
}
