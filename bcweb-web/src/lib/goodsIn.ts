/*
=======================================================================================================================================
Module: src/lib/goodsIn.ts
=======================================================================================================================================
Shared constants and input handling for the Goods In screen. The calls themselves live in api.ts with every other endpoint; this file
is only the things the screen and the routes have to agree on independently of a request.
=======================================================================================================================================
*/

/** The FBA staging bay. An Amazon-claimed unit goes here and NOT to the operator's chosen shelf — see utils/pick.js server-side. */
export const AMAZON_SHELF = 'C3-Amazon';

/**
 * Normalise what the gun typed: case, whitespace, and the trailing 'B' the barcode column carries (CLAUDE.md).
 *
 * Done here so a rack label can be recognised client-side before anything is sent, and repeated server-side in goods-in-book.js —
 * that route has to be correct for callers that never load this file.
 */
export function normaliseScan(raw: string): string {
  const v = raw.trim().toUpperCase();
  return /^\d+B$/.test(v) ? v.slice(0, -1) : v;
}
