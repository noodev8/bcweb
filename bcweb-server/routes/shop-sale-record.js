/*
=======================================================================================================================================
API Route: shop_sale_record
=======================================================================================================================================
Method: POST
Purpose: Record ONE SHOP SALE (CM3) — a BASKET of one or more items, one payment (owner, 2026-11-13: a customer bought 2 pairs and there
         was no way to build her basket, get a final price and check out). Replaces the PowerBuilder offline-sold window.

THE BASKET IS ALL OR NOTHING. Every line is booked in ONE transaction; a line that can't be booked (a shelf emptied meanwhile, a code
gone) rolls the whole basket back and the response names the line (`index`) — half a sale booked would be worse than none.
Every line shares ONE ordernum — the first line's own sales id — so the Sales screen counts the basket as ONE order (it counts
DISTINCT ordernum) and the lines can be found together.

EACH LINE CARRIES ITS OWN PRICE. A multi-buy deal or money off one pair is just a lower price on the line(s) — the screen shares a
typed basket total across the lines by price. The booked `soldprice` is what was paid for THAT pair, so its profit and VAT are right.
`discount` (the legacy integer column, PowerBuilder's CM3 rows hold 10 / 15 / 20 …) is stamped as the whole % off RRP; 0 at or above
RRP or with no RRP on file.

Two kinds of line:

  A PRODUCT (`code`)  — a size from the catalogue. The sale is booked, and one free unit comes off the count in the same transaction
                        when the system holds one (owner, 2026-10-09: "make sure our stock is kept up to date"):
                          `location` sent  -> the unit comes off THAT shelf (the screen asks when the size is on more than one).
                                              None free there any more -> NO_STOCK, nothing written; the screen refreshes.
                          no `location`    -> only when the size is on ONE shelf (taken from there) or none (no stock move — the
                                              sale is still booked: "got to be free to sell", e.g. a clearance pair kept off the
                                              website, or a wrong count). No shelf is favoured.
                          `noStock: true`  -> book the sale, touch NO stock, even though the system shows some (owner,
                                              2026-10-09: "I might be holding one that I've already taken out of a location" — the
                                              count was already corrected, so taking another would double-count).
                        Same peel as inv-adjust: decrement a multi-unit row, soft-delete (deleted = 1) a single; row-locked. Two pairs
                        of one size off one shelf in the same basket work — the second line sees the first line's peel.
  A MISC ITEM (`description`) — something that isn't a product (socks, a one-off). Booked as PowerBuilder did: groupid 'misc', and the
                        typed text as both code and productname. No stock move.

The Shopify stock sync picks a lower count up on its own; this route never pushes.

THE SALES ROW — one per line, shaped exactly like the PowerBuilder CM3 rows already in the table, so the channel's history stays
continuous:
  channel      'CM3'
  ordernum     the basket's number = the FIRST line's own id as text. The id is drawn from sales_id_seq in the INSERT itself
               (PowerBuilder did SELECT max(id)+1 and hoped), so two tills can't collide.
  solddate     today in Europe/London; ordertime 'HH24:MI' London.
  qty          always 1 — one row per item. Two pairs = two lines.
  paytype      'card' | 'cash' — the two values the legacy rows hold; one for the whole basket.
  collectedvat soldprice / 6 when standard-rated; 0 when skusummary.tax = 0 (zero-rated children's footwear). Misc is standard-rated.
  profit       soldprice − VAT − cost. The legacy shop formula: NO fee/postage/haircut terms, because a shop sale has none of those.
               NOT utils/shopifyProfit.js — that is a Shopify parcel's economics. NULL when cost is junk/blank (skusummary.cost is a
               legacy varchar) rather than a wrong figure.
               MISC has no cost on file, so cost is taken as HALF the price — PowerBuilder's own fallback for an unknown cost (cost = price / 2)
               — giving profit = price / 3. A stated estimate, in line with the ~36% the past misc rows carry.
  rrp          the style's current RRP, stamped so it survives a later re-price (same as SHP/AMZ since 2026-09-26). NULL for misc.
  discount     whole % off RRP (see above).
  productname  title.shopifytitle, else the code. brand from skusummary ('' for misc, as before).

AUDIT — one bclog row PER LINE (bclog.log is 250 characters, a basket line-up wouldn't fit), section 'Shop', login name in workstation
(the inv-adjust convention). It names the code AND the shelf the unit came off, so hunting a missing pick on the Log screen (search the
code) shows the shop sale that took it. #id = the sales row; a basket of 2+ says which basket and which line.
  "Shop Sale #40800: D0772-16-40 from C1-04 £90.00 card"
  "Shop Sale #40801 (basket 40800, 2 of 2): 0043691-GIZEH-40 (no stock) £76.50 card"
  "Shop Sale #40803: D0772-16-40 (no location) £90.00 card"   <- noStock chosen while the system showed stock
  "Shop Sale #40802: misc Socks £12.00 cash"
=======================================================================================================================================
Request Payload:
{
  "items": [
    { "code": "D0772-16-40",      // a size code — OR —
      "location": "C1-04",        // the shelf the pair came off — send when the size is free on more than one shelf
      "noStock": true,            // optional — book the line with NO stock move, whatever the system holds
      "description": "Socks",     // a misc item's description (used when no code is sent)
      "price": 81                 // required — what the customer paid for THIS item, VAT inclusive, > 0
    }
  ],
  "paytype": "card"               // required — 'card' | 'cash', for the whole basket
}
The old one-item body ({ code | description, location?, noStock?, price, paytype } with no `items`) is still taken as a basket of one, so a
screen and a server deployed at different times both work.

Success Response:
{
  "return_code": "SUCCESS",
  "basket": {
    "ordernum": "40800", "paytype": "card", "total": 157.50, "solddate": "2026-11-13", "ordertime": "14:05",
    "lines": [ { "id": 40800, "code": "D0772-16-40", "price": 81.00, "takenFrom": "C1-04" },    // takenFrom null = no stock move
               { "id": 40801, "code": "0043691-GIZEH-40", "price": 76.50, "takenFrom": null } ]
  },
  "sale": { ... the first line, the old one-item shape ... }, "takenFrom": "C1-04"
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"   // empty basket, a line with no code or description or a price that isn't a positive amount, or paytype not card/cash
"NOT_FOUND"        // a line's code isn't in skumap — nothing written (`index` = the line)
"NO_STOCK"         // a line's named shelf has no free unit of that size any more — nothing written (`index` = the line)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { safeNumeric } = require('../utils/sql');
const { writeBcLog } = require('../utils/bclog');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

const PAYTYPES = ['card', 'cash'];
// A sanity cap, not a business rule: the dearest thing in the building is well under this, so anything above is a typo (an extra 0).
const MAX_PRICE = 1000;
// A sanity cap on one basket — a shop sale is a pair or two; past this it's a mistake, not a customer.
const MAX_ITEMS = 20;
const VAT_DIVISOR = 6;
// sales.code is varchar(50) in practice for every writer; a misc description lands in it, so keep it to that.
const MISC_MAX = 50;

const round2 = (n) => Math.round(n * 100) / 100;

// A tagged error rolls the WHOLE basket back (withTransaction re-throws after ROLLBACK) — returning early from the callback would
// COMMIT the lines already written.
class BasketError extends Error {
  constructor(code, index, message) {
    super(message);
    this.code = code;
    this.index = index;
  }
}

// Reads one basket line from the body. Returns { item } or { error }.
function readItem(raw) {
  const b = raw || {};
  const item = {
    code: typeof b.code === 'string' ? b.code.trim() : '',
    location: typeof b.location === 'string' ? b.location.trim() : '',
    noStock: b.noStock === true,
    description: typeof b.description === 'string' ? b.description.trim().slice(0, MISC_MAX) : '',
    price: round2(Number(b.price)),
  };
  if (!item.code && !item.description) return { error: 'choose a size, or type what was sold' };
  if (!Number.isFinite(item.price) || item.price <= 0 || item.price > MAX_PRICE) {
    return { error: `enter the price paid (more than £0, at most £${MAX_PRICE})` };
  }
  return { item };
}

// Books ONE line on the basket's transaction. `basket` = the first line's sales id (null while booking the first line itself), used as
// every line's ordernum. Throws BasketError for a line that can't be booked.
async function bookItem(client, it, index, { paytype, basket, changedBy, count }) {
  let row;
  let takenFrom = null;

  if (it.code) {
    const metaRes = await client.query(
      `SELECT m.groupid, s.brand, s.tax, t.shopifytitle AS title,
              ${safeNumeric('s.cost')} AS cost,
              ${safeNumeric('s.rrp')}  AS rrp
       FROM skumap m
       JOIN skusummary s ON s.groupid = m.groupid
       LEFT JOIN title t ON t.groupid = s.groupid
       WHERE m.code = $1
       LIMIT 1`,
      [it.code]
    );
    if (metaRes.rows.length === 0) throw new BasketError('NOT_FOUND', index, `${it.code} is not set up`);
    const meta = metaRes.rows[0];

    // One free unit off the count: from the named shelf, else (size on one shelf or none) wherever it is. Smallest row first so a
    // stray qty=1 clears before a multi-unit row is nibbled. Row-locked so two operators can't take the same unit.
    const unitRes = it.noStock ? { rows: [] } : await client.query(
      `SELECT id, qty, location FROM localstock
       WHERE code = $1 AND ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
         AND ($2 = '' OR location = $2)
       ORDER BY qty ASC, id
       LIMIT 1
       FOR UPDATE`,
      [it.code, it.location]
    );
    if (!it.noStock && it.location && unitRes.rows.length === 0) {
      throw new BasketError('NO_STOCK', index, `no free pair of ${it.code} left on ${it.location} — pick again`);
    }
    if (unitRes.rows.length > 0) {
      const unit = unitRes.rows[0];
      // Legacy text stamp ('YYYYMMDD HH24:MI:SS', London), same as every other localstock writer.
      const stampRes = await client.query(`SELECT to_char(now() AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS') AS stamp`);
      const stamp = stampRes.rows[0].stamp;
      if (Number(unit.qty) > 1) {
        await client.query(`UPDATE localstock SET qty = qty - 1, updated = $1 WHERE id = $2`, [stamp, unit.id]);
      } else {
        await client.query(`UPDATE localstock SET deleted = 1, updated = $1 WHERE id = $2`, [stamp, unit.id]);
      }
      takenFrom = unit.location;
    }

    // tax = 0 is the only zero-rated value; anything else (1, or a NULL on an old row) is standard.
    const vat = meta.tax === null || Number(meta.tax) !== 0 ? it.price / VAT_DIVISOR : 0;
    const cost = meta.cost === null ? null : Number(meta.cost);
    const rrp = meta.rrp === null ? null : Number(meta.rrp);
    row = {
      code: it.code, groupid: meta.groupid, name: meta.title || it.code, brand: meta.brand, rrp: meta.rrp,
      vat, profit: cost === null ? null : round2(it.price - vat - cost),
      discount: rrp && rrp > 0 && it.price < rrp ? Math.round(((rrp - it.price) / rrp) * 100) : 0,
    };
  } else {
    const vat = it.price / VAT_DIVISOR;
    row = {
      code: it.description, groupid: 'misc', name: it.description, brand: '', rrp: null,
      vat, profit: round2(it.price - vat - it.price / 2),   // cost guessed at half the price — see the header
      discount: 0,
    };
  }

  const saleRes = await client.query(
    `INSERT INTO sales (id, code, solddate, groupid, ordernum, ordertime, qty, soldprice, channel, paytype,
                        collectedvat, productname, brand, profit, discount, rrp)
     SELECT n.id, $1, (now() AT TIME ZONE 'Europe/London')::date, $2, COALESCE($10::text, n.id::text),
            to_char(now() AT TIME ZONE 'Europe/London', 'HH24:MI'), 1, $3, 'CM3', $4, $5, $6, $7, $8, $9, $11
     FROM (SELECT nextval('sales_id_seq') AS id) n
     RETURNING id, ordernum, solddate::text AS solddate, ordertime`,
    [row.code, row.groupid, it.price, paytype, round2(row.vat), String(row.name).slice(0, 200), row.brand, row.profit,
      row.discount, basket === null ? null : String(basket), row.rrp]
  );
  const sale = saleRes.rows[0];

  const what = !it.code ? `misc ${it.description}`
    : takenFrom ? `${it.code} from ${takenFrom}`
      : it.noStock ? `${it.code} (no location)` : `${it.code} (no stock)`;
  const inBasket = count > 1 ? ` (basket ${sale.ordernum}, ${index + 1} of ${count})` : '';
  await writeBcLog(client, {
    who: changedBy, section: 'Shop',
    log: `Shop Sale #${sale.id}${inBasket}: ${what} £${it.price.toFixed(2)} ${paytype}`,
  });

  return { id: sale.id, ordernum: sale.ordernum, solddate: sale.solddate, ordertime: sale.ordertime, code: row.code, price: it.price, takenFrom };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [body];
    const many = rawItems.length > 1;
    const paytype = typeof body.paytype === 'string' ? body.paytype.trim().toLowerCase() : '';

    if (rawItems.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'The basket is empty' });
    }
    if (rawItems.length > MAX_ITEMS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `At most ${MAX_ITEMS} items in one sale` });
    }
    const items = [];
    for (let i = 0; i < rawItems.length; i++) {
      const r = readItem(rawItems[i]);
      if (r.error) {
        return res.json({ return_code: 'MISSING_FIELDS', message: many ? `Item ${i + 1}: ${r.error}` : cap(r.error), index: i });
      }
      items.push(r.item);
    }
    if (!PAYTYPES.includes(paytype)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Payment must be card or cash' });
    }

    const changedBy = req.user.display_name;

    let lines;
    try {
      lines = await withTransaction(async (client) => {
        const out = [];
        let basket = null;
        for (let i = 0; i < items.length; i++) {
          const line = await bookItem(client, items[i], i, { paytype, basket, changedBy, count: items.length });
          if (basket === null) basket = line.id;
          out.push(line);
        }
        return out;
      });
    } catch (err) {
      if (err instanceof BasketError) {
        const message = many ? `Nothing recorded — item ${err.index + 1}: ${err.message}` : cap(err.message);
        return res.json({ return_code: err.code, message, index: err.index });
      }
      throw err;
    }

    const first = lines[0];
    return res.json({
      return_code: 'SUCCESS',
      basket: {
        ordernum: first.ordernum, paytype, total: round2(lines.reduce((n, l) => n + l.price, 0)),
        solddate: first.solddate, ordertime: first.ordertime,
        lines: lines.map((l) => ({ id: l.id, code: l.code, price: l.price, takenFrom: l.takenFrom })),
      },
      // The old one-item shape, for a screen that still sends one item.
      sale: { id: first.id, code: first.code, price: first.price, paytype, solddate: first.solddate, ordertime: first.ordertime },
      takenFrom: first.takenFrom,
    });
  } catch (err) {
    logger.error('[shop-sale-record] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to record the sale' });
  }
});

module.exports = router;
