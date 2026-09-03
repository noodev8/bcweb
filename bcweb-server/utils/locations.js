/*
=======================================================================================================================================
Module: utils/locations.js
=======================================================================================================================================
Purpose: One definition of "the warehouse's shelves", so the two screens that offer a rack to put a shoe on cannot drift apart.

THERE ARE TWO SOURCES AND THEY ARE NOT THE SAME QUESTION:

  `location`   — the ~71 racks that EXIST. A real table (location, barcode, pickorder, updated), maintained by the legacy app; every
                 rack carries its own scannable barcode ('LC-58') and a pickorder that is the order the racks are walked. This is the
                 authoritative list, and it is the one to ask when the question is "where COULD this go".
  `localstock` — the racks that currently HOLD something, as a side effect of holding it. Ask this when the question is "where IS it".

Getting these the wrong way round is a real bug with a quiet symptom: routes/inv-locations.js derives its picker from localstock and
its header states there is no config table. There is. The effect is that an EMPTY rack cannot be picked — C1 has 22 racks and only 5
were holding stock, so 17 real shelves were missing from the picker, and an empty shelf is precisely where a delivery gets put. That
route is left alone for now (its "add to a location" flow has always behaved this way and the Inventory module is not what changed);
the areaOf/AREA_ORDER it grew are lifted here so a fix there is a one-line switch of source rather than a second copy of this logic.

AREAS are the location string's prefix, which is how the warehouse is spoken about and how the legacy screen's C1/C3 buttons carve it
up. Case-insensitive because nothing constrains the column (a stray 'C3-SHOP' exists alongside 'C3-Shop'). 'OTHER' catches whatever
doesn't match so nothing is silently dropped — from the `location` table that is real-but-odd racks (C3-Office, C3-Socks, UKD-Tests),
from localstock it also catches non-racks like the stray 'Ordered' row, which is a marker, not a place.
=======================================================================================================================================
*/

function areaOf(location) {
  const l = String(location).toLowerCase();
  if (l.startsWith('c1-')) return 'C1';
  if (l.startsWith('c3-front-')) return 'C3-Front';
  if (l.startsWith('c3-back-')) return 'C3-Back';
  if (l.startsWith('c3-amazon')) return 'C3-Amazon';
  if (l.startsWith('c3-shop')) return 'C3-Shop';
  return 'OTHER';
}

// The order areas appear in the Inventory picker — the busy shelving first, the Amazon bay and stray bucket last. Goods In does NOT
// use this: it orders by the racks' own `pickorder`, which is the sequence the warehouse actually walks.
const AREA_ORDER = ['C3-Front', 'C3-Back', 'C1', 'C3-Shop', 'C3-Amazon', 'OTHER'];

module.exports = { areaOf, AREA_ORDER };
