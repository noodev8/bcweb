/*
=======================================================================================================================================
Module: utils/screenPath.js
=======================================================================================================================================
Purpose: Turn a browser pathname into the stable route key stored in `screen_view.path`.

         normaliseScreenPath('/pricing/style/ABC123')  ->  '/pricing/style/:id'
         normaliseScreenPath('/analytics/sales?x=1')   ->  '/analytics/sales'
         normaliseScreenPath('/nonsense/../../etc')    ->  null   (rejected, see below)

WHY THIS EXISTS AT ALL. The whole value of screen_view is being able to GROUP BY path. Store what the browser actually had in the
address bar and every drill-down is a unique string — a thousand rows for /pricing/style/<groupid> that never add up to "the Shopify
pricing drill was opened a thousand times". Collapsing the variable segment is the difference between a table you can query and a
table you can only scroll. It is done SERVER-SIDE deliberately: the client is not the right place to decide what the canonical name
of a route is, and a client that sends its own key can send anything.

WHY A WHITELIST AND NOT A REGEX TIDY-UP. `path` is written from a request body, so it is user input; anything unrecognised is
rejected outright rather than stored. That keeps the table's vocabulary closed — every value in it is a route this app actually has —
and means a malformed or hand-crafted POST can't quietly seed it with junk that a future GROUP BY then has to explain. The cost is
that A NEW SCREEN MUST BE ADDED HERE or its opens are silently dropped; that is the intended trade (a missing row is recoverable by
adding the route, a polluted vocabulary is not), but it is the one maintenance obligation this module carries.

KEEP IN STEP with the front end's routes. When a module ships, add its route here.
=======================================================================================================================================
*/

// Static routes — matched exactly. One line per screen the app has.
const STATIC = new Set([
  '/dashboard',
  '/inventory',
  '/segments',
  '/customer-orders',
  '/pick',
  '/order-status',
  '/goods-in',
  '/amazon-order',
  '/locations',
  '/finance',
  '/birk-tracker',
  '/birkenstock',
  '/products',
  '/product',
  '/pricing',
  '/pricing/find',
  '/amz',
  '/update-amazon',
  '/google-ads',
  '/social',
  '/brands',
  '/analytics',
  '/analytics/sales',
  '/analytics/birk-availability',
  '/analytics/stock-position',
  '/analytics/new-additions',
  '/analytics/price-changes',
  '/analytics/ad-efficiency',
  '/analytics/ad-daily',
  '/analytics/activity-log',
  '/analytics/winners',
]);

// Dynamic routes — a fixed prefix plus exactly one variable segment, stored as the prefix + '/:id'. Listed longest-prefix first so a
// deeper pattern is tested before a shallower one that would also match it.
const DYNAMIC = [
  '/pricing/style',
  '/pricing',            // /pricing/[segment]
  '/amz/sku',
  '/amz',                // /amz/[segment]
  '/segments',           // /segments/[name]
  '/order-status',       // /order-status/[supplier]
  '/product',            // /product/[groupid]
];

function normaliseScreenPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null;

  // Drop the query string and hash before anything else. Neither says WHICH screen, and the query carries search terms and filter
  // values that have no business being in a usage table (see the migration's note on not keeping it).
  let path = raw.split('?')[0].split('#')[0];

  // Trailing slash is the same screen. Strip it, but never turn '/' into ''.
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  // Cheap sanity gate before any matching: a path with a traversal segment or an implausible length is not one of ours.
  if (path.length > 200 || path.includes('..')) return null;

  if (STATIC.has(path)) return path;

  for (const prefix of DYNAMIC) {
    if (!path.startsWith(prefix + '/')) continue;
    const rest = path.slice(prefix.length + 1);
    // Exactly ONE segment may follow. Anything deeper is a route we don't know about, and guessing at it is how the vocabulary rots.
    if (rest.length > 0 && !rest.includes('/')) return prefix + '/:id';
  }

  return null;
}

module.exports = { normaliseScreenPath };
