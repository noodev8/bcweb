'use client';
/*
=======================================================================================================================================
Component: RowsToggle
=======================================================================================================================================
Purpose: The "show all / show fewer" control under a long report table (drill Recent sales, Shopify + Amazon).

Why: those reports load the most-recent-N rows (50) and used to render every one of them. On a hot style that is a wall of sale lines
between the operator and the rest of the drill — and the whole point of the report is the LATEST activity, which is the first handful.
So the table renders a short preview (PREVIEW_ROWS) and this offers the rest on one click. The data is already in the browser, so
expanding is instant — this is purely about how much is on screen, not about a second fetch.

Shared by both drills so the wording and behaviour can't drift apart.
=======================================================================================================================================
*/

// How many rows a report shows before the operator asks for the rest. 10 ≈ the recent activity you actually read at a glance.
export const PREVIEW_ROWS = 10;

export default function RowsToggle({ total, showingAll, onToggle, noun = 'sales' }: {
  total: number;              // rows loaded (i.e. what "show all" will reveal)
  showingAll: boolean;
  onToggle: () => void;
  noun?: string;              // 'sales' / 'changes' — reads as "Show all 43 sales"
}) {
  if (total <= PREVIEW_ROWS) return null;   // nothing hidden — no control at all
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-2 w-full rounded-md border border-slate-200 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
    >
      {showingAll ? `Show fewer` : `Show all ${total} ${noun}`}
    </button>
  );
}
