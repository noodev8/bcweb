/*
=======================================================================================================================================
API Route: order_status_customer_list
=======================================================================================================================================
Method: GET
Purpose: The CUSTOMER ORDERS stage of the Order Status module — every Shopify customer order line currently being fulfilled, one row
         per unit, in the dense list the legacy PowerBuilder Status screen showed (Downloads/legacy-status.png, of_refreshdisplaydb.txt).

         This is the FULFILMENT side: what has the customer bought, and can we send it. The module's other two stages are the
         PROCUREMENT side (what are we buying from suppliers). They share a table and almost nothing else — see the warning at the top
         of utils/customerOrders.js about `orderdate` meaning two different things depending on ordertype.

SCOPE: ordertype = 1 only. Types 2/3 belong to /order-status-list and /order-status-to-place. Types 4 (Karen/PFG), 5 (AMZ-P) and 7
(Backorder) had filter buttons on the legacy screen but have ZERO rows in both orderstatus and orderstatus_archive, so they are not
carried over; if they ever come back this route simply won't show them, which is a visible failure rather than a silent one.

`batch = '-1'` rows are excluded — the legacy discard marker, which of_refreshdisplaydb.txt skipped on load and orderSync.js phase F
deletes outright.

GRAIN: `orderstatus` holds ONE ROW PER PHYSICAL UNIT with qty always 1 (CLAUDE.md landmine), so a 2-pair order is two rows sharing an
ordernum. They are returned flat and grouped client-side, because the customer / postcode / courier / note fields are per-ORDER while
the code / size / sourcing state are per-UNIT, and the dense list shows both at once.

NO FILTERING HERE: the status chips and the search box are client-side. The whole qualifying set is at most a few hundred rows and the
operator wants to glance at it, not paginate it — utils/listLimit.js caps it purely so a pathological day can't dump thousands of rows
into a browser. `total` + `truncated` are returned per API-RULES so a truncated list is visible rather than quietly short.

DATES — TWO TIMESTAMPS THAT ANSWER DIFFERENT QUESTIONS. Do not substitute one for the other:

  `created`    WHEN THE CUSTOMER ORDERED. Written once from the Shopify order's created_at (utils/orderSync.js, via wallClock()) and
               never touched again. This is the screen's "Ordered" column. It is always present and always to the second — verified
               across all 3,177 archived customer rows: every one a well-formed 'YYYYMMDD HH24:MI:SS', none blank, none null. It
               can't be absent, because the row exists only because the order does.
  `orderdate`  WHEN WE LAST ACTED. Phase E stamps it on allocation, /order-status-customer-fba blanks it, PowerBuilder can write the
               free text 'Do Not Order' into it. It equals `created` on only 2,017 of those 3,177 rows and is empty on 21. Returned
               raw because it feeds the state derivation, NOT because it is a date the screen should print.

  `createddate` (a pg DATE) is deliberately NOT returned: it is `created` at day precision — identical on the day for all 3,177
  archived rows — so returning both would invite exactly the mix-up above for no extra information. That also sidesteps the DATE
  trap: never hand a pg DATE to Date.toISOString(), because node-postgres parses it as local midnight and the UTC conversion shifts
  the day back one under BST (CLAUDE.md; utils/orderStatus.js LANDMINE 3).

Both returned columns are character varying and pass through raw for the client to format — no JS date parsing anywhere in this path.
=======================================================================================================================================
Request Query Params:
  limit  (integer, optional) — safety cap only; see utils/listLimit.js (default 100, max 500)

Success Response:
{
  "return_code": "SUCCESS",
  "total": 6,            // rows matching before the cap
  "truncated": false,
  "limit": 100,
  "lines": [
    {
      "ordernum": "BC18665",
      "code": "0034791-MILANO-44",
      "title": "Birkenstock Milano Black",
      "qty": 1,
      "created": "20260730 15:44:38",     // "Ordered" — when the CUSTOMER ordered; always present (see DATES below)
      "supplier": "Birkenstock",
      "customer": "Jonathan Fagence",
      "postcode": "N4 1JL",
      "orderdate": "20260730 15:44:38",   // raw; when WE last acted on the line — a state marker, NOT the customer's order time
      "fba": 0,                           // amz — units to come from FBA
      "courier": "5",
      "note": "",
      // One of: no_stock | waiting | sourcing | fba | picked | pending | parked.
      // "pending" = reserved against a shelf row, awaiting pick. "picked" = every held shelf row is emptied, i.e. the units are off
      // the shelf but Shopify hasn't reported the order fulfilled yet. See the PICKED note in utils/customerOrders.js — the two are
      // NOT the same flag and the second one doesn't live in orderstatus at all.
      "state": "pending"
    }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { parseListLimit } = require('../utils/listLimit');
const { CUSTOMER_ORDERTYPE, notDiscarded, rowState } = require('../utils/customerOrders');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const limit = parseListLimit(req.query.limit);

    // The title on orderstatus is captured from Shopify at insert time and is what the legacy screen showed; the join to
    // skumap -> title is a fallback for rows where it was never populated. LEFT JOINs so a SKU missing from skumap (a deleted or
    // renamed product) still shows its order line rather than dropping it off a fulfilment screen.
    //
    // NEWEST ORDER FIRST (owner, 2026-07-31). ordernum is 'BC' + a zero-padded counter, so lexical DESC is chronological DESC and no
    // date parsing is needed to sort by when the customer ordered.
    //
    // This REVERSES the legacy `setsort("ordernum A, code A")` and the oldest-first order the module's procurement stages use, and the
    // difference is not an inconsistency — it's the two screens answering different questions. TO PLACE / ON ORDER are work queues
    // where the oldest item is the most overdue and belongs at the top. This is a live list watched through the day: the thing you
    // came to check is almost always the order that just landed, and it was arriving at the BOTTOM of a long grid.
    //
    // It also improves what the safety cap drops. Under ASC a truncated list lost the NEWEST orders — the ones being actively worked.
    // Under DESC it loses the oldest, which are the stalest.
    //
    // `shopifysku` stays ASC within an order so a multi-line order's sizes read in a stable order. The client's group-header logic
    // (print the ordernum on a group's first visible row) only needs the rows of one order to be adjacent, which they still are.
    const result = await query(`
      SELECT o.ordernum,
             o.shopifysku                              AS code,
             COALESCE(NULLIF(TRIM(o.title), ''), t.shopifytitle) AS title,
             COALESCE(o.qty, 1)                        AS qty,
             o.created,
             o.supplier,
             o.shippingname                            AS customer,
             o.postcode,
             o.orderdate,
             COALESCE(o.amz, 0)                        AS fba,
             o.courier,
             COALESCE(o.notes, '')                     AS note,
             COALESCE(o.localstock, 0)     AS localstock,
             COALESCE(o.ukd, 0)            AS ukd,
             COALESCE(o.othersupplier, 0)  AS othersupplier,
             COALESCE(o.customerwaiting, 0) AS customerwaiting,
             COALESCE(o.batch, '')         AS batch,
             COALESCE(ls.held, 0)          AS held_rows,
             COALESCE(ls.picked, 0)        AS picked_rows,
             COUNT(*) OVER ()                          AS total
        FROM orderstatus o
        LEFT JOIN skumap sm ON sm.code = o.shopifysku
        LEFT JOIN title t   ON t.groupid = sm.groupid
        -- THE PICK SIGNAL. It is not in orderstatus and cannot be derived from it — see the PICKED note in utils/customerOrders.js.
        -- Phase E reserves a shelf row by stamping it with the ordernum and leaving qty = 1; taking the unit off the shelf drops that
        -- row to qty = 0 while it keeps its ordernum. So per (ordernum, code): how many rows are held, and how many are emptied.
        -- Aggregated in a subquery rather than joined row-for-row because a multi-unit line holds several shelf rows and a plain join
        -- would multiply the order lines by them.
        -- Keyed on (ordernum, code) because that is the exact key phase E allocates by (orderSync.js: WHERE ordernum = $2 AND
        -- shopifysku = $3), so the two can't disagree about which rows belong to which line.
        -- deleted = 0 matches the sellable-stock predicate used everywhere else (CLAUDE.md); '#FREE' is unallocated shelf stock and
        -- is never a pick.
        LEFT JOIN (
          SELECT ordernum, code,
                 COUNT(*)                                       AS held,
                 COUNT(*) FILTER (WHERE COALESCE(qty, 0) = 0)   AS picked
            FROM localstock
           WHERE ordernum <> '#FREE'
             AND COALESCE(deleted, 0) = 0
           GROUP BY ordernum, code
        ) ls ON ls.ordernum = o.ordernum AND ls.code = o.shopifysku
       WHERE o.ordertype = $1
         AND ${notDiscarded('o')}
       ORDER BY o.ordernum DESC, o.shopifysku
       LIMIT $2
    `, [CUSTOMER_ORDERTYPE, limit]);

    const total = result.rows.length ? Number(result.rows[0].total) : 0;

    // rowState() reads the four sourcing flags + customerwaiting + orderdate + the two pick counts; they are selected above purely to
    // feed it and are not returned individually, because every consumer wants the derived state and two consumers deriving it
    // separately is how the legacy screen and its reports drifted apart in the first place.
    const lines = result.rows.map((r) => ({
      ordernum: r.ordernum,
      code: r.code,
      title: r.title || null,
      qty: Number(r.qty) || 1,
      created: r.created || '',
      supplier: r.supplier || null,
      customer: r.customer || null,
      postcode: r.postcode || null,
      orderdate: r.orderdate || '',
      fba: Number(r.fba) || 0,
      courier: r.courier || null,
      note: r.note || '',
      state: rowState(r),
    }));

    return res.json({
      return_code: 'SUCCESS',
      total,
      truncated: total > lines.length,
      limit,
      lines,
    });
  } catch (err) {
    logger.error('[order-status-customer-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load customer orders' });
  }
});

module.exports = router;
