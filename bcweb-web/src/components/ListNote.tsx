/*
=======================================================================================================================================
Component: ListNote
=======================================================================================================================================
Purpose: The one-line caption above a WINNERS / LOSERS table (Shopify + Amazon) saying how much work the list holds.

Why: these lists used to be a fixed top 10, which told the operator nothing — clear a few and the list silently refilled, so "10" was
never the size of the job. They now return the whole qualifying set, so the count IS the job and it visibly shrinks as styles are priced
or parked. The only exception is the server's safety cap (utils/listLimit.js): if a segment ever overflows it, the note switches to
"showing X of Y" so a capped list is never mistaken for the whole of it. Nothing is said when a small list is fully shown beyond the
plain count — no jargon, no advice.
=======================================================================================================================================
*/

export default function ListNote({ shown, total, noun }: {
  shown: number;                 // rows actually rendered
  total: number | null;          // qualifying rows before the server cap (null = unknown; treat as "all shown")
  noun: string;                  // 'style' (Shopify) / 'SKU' (Amazon) — pluralised with a bare s
}) {
  const capped = total !== null && total > shown;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return (
    <p className="mb-2 text-xs text-slate-400">
      {capped
        ? <>Showing the first {plural(shown)} of {total} — work through these, then reload for the rest.</>
        : <>{plural(shown)} to work through.</>}
    </p>
  );
}
