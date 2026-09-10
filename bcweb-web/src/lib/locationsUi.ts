/*
=======================================================================================================================================
Module: src/lib/locationsUi.ts
=======================================================================================================================================
How the Locations screen carves the warehouse into zones. The data shapes and the calls live in api.ts with every other endpoint; the
shelf's own presentation rules (a size chip and its three states) live in LocationsBoard, where they are read.

(It briefly also held a placeholder set of racks, so the UI could be built and judged before its routes existed. Those routes are
GET /locations-racks and POST /locations-stock now, so the fixture is gone.)

AREAS ARE THE LOCATION STRING'S PREFIX, mirroring utils/locations.js server-side. Duplicated rather than fetched because it is a
labelling rule, not a fact about the data: the racks arrive as a flat list in walking order and this is only how the screen chooses to
group them. KEEP THE TWO IN STEP — a prefix added there and not here lands its racks in 'Other'.
=======================================================================================================================================
*/

/** The area a rack belongs to. Case-insensitive: nothing constrains the column, and a stray 'C3-SHOP' exists alongside 'C3-Shop'. */
export function areaOf(location: string): string {
  const l = location.toLowerCase();
  if (l.startsWith('c1-')) return 'C1';
  if (l.startsWith('c3-front-')) return 'C3-Front';
  if (l.startsWith('c3-back-')) return 'C3-Back';
  if (l.startsWith('c3-amazon')) return 'C3-Amazon';
  if (l.startsWith('c3-shop')) return 'C3-Shop';
  return 'OTHER';
}

/** Area order: the busy shelving first, the Amazon bay and the stray bucket last (AREA_ORDER, utils/locations.js). */
export const AREA_ORDER = ['C3-Front', 'C3-Back', 'C1', 'C3-Shop', 'C3-Amazon', 'OTHER'] as const;

/** Written the way a person says it — only the catch-all reads badly as-is. */
export const AREA_LABEL: Record<string, string> = { OTHER: 'Other' };
