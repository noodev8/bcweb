'use client';
/*
=======================================================================================================================================
Component: InvLocations
=======================================================================================================================================
Purpose: The "go and fetch it" half of the Inventory screen (docs/inventory-spec.md §4). The size grid says we have three in a 38;
         this says which racks they are on.

SCOPE: ONE SIZE of one style. The operator picks a size in the grid above, then sees which racks hold it (owner). Showing every rack
       the whole style touches is noise — a popular style spans a dozen locations across eight sizes, and none of that helps you find
       the 38 the customer is waiting for. The parent does the size filtering; this component just renders what it is handed.

NO AREA FILTER HERE. The C1 / C3 / C3 Front / C3 Back / C3 Shop buttons on the legacy PowerBuilder screen are for ASSIGNING a location
when adding stock — that is phase 2 (localstock adjustments), not a filter on this read-only view (owner, explicitly). Do not add
filtering buttons to this table.

COLUMNS ARE Location / Qty / exception-tag ONLY (owner). No size column (every row is the same size, named in the header), no order
number, and no "State" heading. Anything beyond "where is it and how many" belongs to a drill-down, not to the screen you read while
a customer waits. `ordernum` still arrives on the row type — the PICKED tag is derived from it, and phase 2 will want it.

STATE COLOURS: AMZ is styled as present-but-flagged, NOT as unavailable. Per the order lifecycle doc (p5) a unit sitting in the
C3-Amazon bay can still be picked for a Shopify customer, so greying it out would hide real, takeable stock.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { MinusSmallIcon, PlusSmallIcon } from '@heroicons/react/24/outline';
import { InvLocationRow, InvLocationState } from '@/lib/api';

// FREE is deliberately absent: it is the normal state, so badging every row adds noise without information (owner). Only the
// EXCEPTIONS get a tag — a blank State cell means "free to take", which is the common case and reads faster for it.
const STATE_STYLES: Partial<Record<InvLocationState, { label: string; cls: string }>> = {
  // "Pick", not "Picked" (owner) — matches the tag on the Local column in the grid above, and it is how the warehouse says it.
  PICKED: { label: 'Pick', cls: 'bg-amber-50 text-amber-700' },
  // ONE Amazon tag, not the old reserved/bay pair (owner, 2026-07-20). The two differed only by location, and the location is right
  // there in the previous column — "Amazon bay" next to a Location of C3-Amazon was the same fact printed twice.
  AMZ: { label: 'Amazon', cls: 'bg-sky-50 text-sky-700' },
};

export default function InvLocations({ rows, sizeLabel, onAdjust }: {
  rows: InvLocationRow[];
  sizeLabel: string;
  // PHASE 2 (owner, 2026-07-23): when provided, each shelf line gets +/- to fix a wrong real-world count. It hands the WHOLE cluster
  // of localstock ids for that line up to the parent (a shelf line can be several rows), which calls the write endpoint. Absent =
  // the read-only lookup view. Every location is editable, including Amazon/picked — the operator is in control (owner).
  onAdjust?: (args: { code: string; location: string; delta: number; ids: string[] }) => Promise<void> | void;
}) {
  // While a +/- request is in flight, disable the controls so a double-tap can't fire two writes against the same line.
  const [pending, setPending] = useState(false);

  // COLLAPSE duplicate shelf lines for the user view. localstock stores stock inconsistently: two pairs on one shelf can be a single
  // row with qty=2, or two rows with qty=1, depending how they were scanned in. Showing "C3-Front-07 / 1" twice is noise — the
  // operator wants "C3-Front-07 / 2", one line per shelf.
  //
  // Grouped by location AND state, not location alone: if a shelf holds one free pair and one picked pair, those MUST stay separate.
  // Merging them would read as 2 available when only 1 is takeable — the one error this screen genuinely cannot afford.
  //
  // Every underlying localstock id is kept on the grouped row, plus the code — phase 2's +/- hands the whole cluster to the write
  // endpoint, which adds/removes against those exact rows.
  const grouped = useMemo(() => {
    const byKey = new Map<string, { key: string; code: string; location: string | null; state: InvLocationState; qty: number; ids: string[] }>();
    for (const r of rows) {
      const key = `${r.location ?? ''}|${r.state}`;
      const hit = byKey.get(key);
      if (hit) {
        hit.qty += r.qty;
        hit.ids.push(r.id);
      } else {
        byKey.set(key, { key, code: r.code, location: r.location, state: r.state, qty: r.qty, ids: [r.id] });
      }
    }
    return [...byKey.values()];
  }, [rows]);

  // Fire one +/- for a shelf line. Guards: needs a handler, a real location, and no other write in flight.
  async function adjust(g: { code: string; location: string | null; ids: string[] }, delta: number) {
    if (!onAdjust || pending || !g.location) return;
    setPending(true);
    try {
      await onAdjust({ code: g.code, location: g.location, delta, ids: g.ids });
    } finally {
      setPending(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="border-t border-slate-200 px-4 py-4 text-center text-sm text-slate-400">
        No <span className="font-medium text-slate-500">{sizeLabel}</span> in local stock.
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200">
      {/* No header row at all — the highlighted chip names the size, and the per-rack Qty column carries the counts. A "N units"
          summary line was a whole row for one number (owner, 2026-07-23). Straight to the racks. */}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Location</th>
            <th className="px-4 py-2 text-right font-medium">Qty</th>
            {/* Unlabelled: the column is empty for free stock (the common case) and only carries an exception tag when there is one.
                A "State" heading over mostly-blank cells reads as missing data rather than "nothing to flag". */}
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {grouped.map((r) => {
            const st = STATE_STYLES[r.state];
            return (
              <tr key={r.key} className="hover:bg-slate-50">
                {/* No size column: every row here is the same size, named once in the header above. */}
                <td className="whitespace-nowrap px-4 py-1.5 font-medium text-slate-800">{r.location || '—'}</td>
                <td className="px-4 py-1.5 text-right">
                  {onAdjust && r.location ? (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => adjust(r, -1)}
                        disabled={pending}
                        title={`Remove one ${sizeLabel} from ${r.location}`}
                        className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                      >
                        <MinusSmallIcon className="h-4 w-4" />
                      </button>
                      <span className="w-6 text-center font-medium tabular-nums text-slate-800">{r.qty}</span>
                      <button
                        type="button"
                        onClick={() => adjust(r, 1)}
                        disabled={pending}
                        title={`Add one ${sizeLabel} to ${r.location}`}
                        className="rounded border border-slate-200 p-0.5 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-40"
                      >
                        <PlusSmallIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="tabular-nums text-slate-700">{r.qty}</span>
                  )}
                </td>
                <td className="px-4 py-1.5">
                  {st && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
