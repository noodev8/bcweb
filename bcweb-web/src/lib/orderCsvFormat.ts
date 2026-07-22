/*
=======================================================================================================================================
Module: src/lib/orderCsvFormat.ts
=======================================================================================================================================
Purpose: Which columns the TO PLACE order CSV carries, per supplier.

Why this isn't one fixed layout: the file is not ours once it leaves the app — it gets pushed into the SUPPLIER's ordering system, and
each of those is a different importer with its own idea of a valid file. Lunar's rejects the file when the trailing `code` column is
present (owner, 2026-07-22), so Lunar gets `barcode,qty` and nothing else. Everyone else keeps `code`, which is our own SKU reference
and useful to whoever reads the file back on either side.

The header row stays in both layouts (owner) — only the columns differ.

Adding the next exception is one line in SUPPLIER_COLUMNS. Keys are lower-cased supplier names so a stray capital or trailing space in
the route param can't silently drop a supplier back to the default layout — which would fail at the supplier, not here.
=======================================================================================================================================
*/

export type OrderCsvColumn = 'barcode' | 'qty' | 'code';

// What the supplier gets unless they're listed below: barcode, qty, and our SKU code.
const DEFAULT_COLUMNS: OrderCsvColumn[] = ['barcode', 'qty', 'code'];

const SUPPLIER_COLUMNS: Record<string, OrderCsvColumn[]> = {
  lunar: ['barcode', 'qty'],   // their system rejects a third column
};

export function csvColumnsFor(supplier: string): OrderCsvColumn[] {
  return SUPPLIER_COLUMNS[supplier.trim().toLowerCase()] ?? DEFAULT_COLUMNS;
}
