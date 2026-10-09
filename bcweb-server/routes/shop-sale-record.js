/*
=======================================================================================================================================
API Route: shop_sale_record
=======================================================================================================================================
Method: POST
Purpose: Record ONE item sold in the shop (CM3). Replaces the PowerBuilder offline-sold window. Two kinds:

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
                        Same peel as inv-adjust: decrement a multi-unit row, soft-delete (deleted = 1) a single; row-locked.
  A MISC ITEM (`description`) — something that isn't a product (socks, a one-off). Booked as PowerBuilder did: groupid 'misc', and the
                        typed text as both code and productname. No stock move.

The Shopify stock sync picks a lower count up on its own; this route never pushes.

THE SALES ROW — shaped exactly like the PowerBuilder CM3 rows already in the table, so the channel's history stays continuous:
  channel      'CM3'
  ordernum     the row's OWN id as text. PowerBuilder did SELECT max(id)+1 and hoped; here the id is drawn from sales_id_seq first
               and used for both columns in the same INSERT, so two tills can't collide.
  solddate     today in Europe/London; ordertime 'HH24:MI' London.
  qty          always 1 — one item per record. Two pairs = record twice.
  paytype      'card' | 'cash' — the two values the legacy rows hold.
  collectedvat soldprice / 6 when standard-rated; 0 when skusummary.tax = 0 (zero-rated children's footwear). Misc is standard-rated.
  profit       soldprice − VAT − cost. The legacy shop formula: NO fee/postage/haircut terms, because a shop sale has none of those.
               NOT utils/shopifyProfit.js — that is a Shopify parcel's economics. NULL when cost is junk/blank (skusummary.cost is a
               legacy varchar) rather than a wrong figure.
               MISC has no cost on file, so cost is taken as HALF the price — PowerBuilder's own fallback for an unknown cost (cost = price / 2)
               — giving profit = price / 3. A stated estimate, in line with the ~36% the past misc rows carry.
  rrp          the style's current RRP, stamped so it survives a later re-price (same as SHP/AMZ since 2026-09-26). NULL for misc.
  productname  title.shopifytitle, else the code. brand from skusummary ('' for misc, as before). discount 0.

AUDIT — one bclog row, section 'Shop', login name in workstation (the inv-adjust convention). It names the code AND the shelf the
unit came off, so hunting a missing pick on the Log screen (search the code) shows the shop sale that took it. #id = the sales row.
  "Shop Sale #40800: D0772-16-40 from C1-04 £90.00 card"  |  "Shop Sale #40801: D0772-16-40 (no stock) £90.00 card"
  "Shop Sale #40803: D0772-16-40 (no location) £90.00 card"   <- noStock chosen while the system showed stock
  "Shop Sale #40802: misc Socks £12.00 cash"
=======================================================================================================================================
Request Payload:
{
  "code": "D0772-16-40",      // a size code — OR —
  "location": "C1-04",        // the shelf the pair came off — send when the size is free on more than one shelf
  "noStock": true,            // optional — book the sale with NO stock move, whatever the system holds
  "description": "Socks",     // a misc item's description (used when no code is sent)
  "price": 90,                // required — what the customer paid, VAT inclusive, > 0
  "paytype": "card"           // required — 'card' | 'cash'
}

Success Response:
{
  "return_code": "SUCCESS",
  "sale": { "id": 40800, "code": "D0772-16-40", "price": 90.00, "paytype": "card", "solddate": "2026-10-09", "ordertime": "14:05" },
  "takenFrom": "C1-04"        // the shelf a unit came off; null = no stock move (none on the system, or misc)
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"   // no code or description, price not a positive amount, or paytype not card/cash
"NOT_FOUND"        // code isn't in skumap
"NO_STOCK"         // the named shelf has no free unit of this size any more — nothing written
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
const VAT_DIVISOR = 6;
// sales.code is varchar(50) in practice for every writer; a misc description lands in it, so keep it to that.
const MISC_MAX = 50;

const round2 = (n) => Math.round(n * 100) / 100;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const noStock = body.noStock === true;
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, MISC_MAX) : '';
    const price = round2(Number(body.price));
    const paytype = typeof body.paytype === 'string' ? body.paytype.trim().toLowerCase() : '';

    if (!code && !description) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Choose a size, or type what was sold' });
    }
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `Enter the price paid (more than £0, at most £${MAX_PRICE})` });
    }
    if (!PAYTYPES.includes(paytype)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Payment must be card or cash' });
    }

    const changedBy = req.user.display_name;

    const result = await withTransaction(async (client) => {
      let row;          // the sales row's values that differ between a product and misc
      let takenFrom = null;

      if (code) {
        const metaRes = await client.query(
          `SELECT m.groupid, s.brand, s.tax, t.shopifytitle AS title,
                  ${safeNumeric('s.cost')} AS cost,
                  ${safeNumeric('s.rrp')}  AS rrp
           FROM skumap m
           JOIN skusummary s ON s.groupid = m.groupid
           LEFT JOIN title t ON t.groupid = s.groupid
           WHERE m.code = $1
           LIMIT 1`,
          [code]
        );
        if (metaRes.rows.length === 0) return { error: 'NOT_FOUND' };
        const meta = metaRes.rows[0];

        // One free unit off the count: from the named shelf, else (size on one shelf or none) wherever it is. Smallest row first so a
        // stray qty=1 clears before a multi-unit row is nibbled. Row-locked so two operators can't take the same unit.
        const unitRes = noStock ? { rows: [] } : await client.query(
          `SELECT id, qty, location FROM localstock
           WHERE code = $1 AND ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
             AND ($2 = '' OR location = $2)
           ORDER BY qty ASC, id
           LIMIT 1
           FOR UPDATE`,
          [code, location]
        );
        if (!noStock && location && unitRes.rows.length === 0) return { error: 'NO_STOCK' };
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
        const vat = meta.tax === null || Number(meta.tax) !== 0 ? price / VAT_DIVISOR : 0;
        const cost = meta.cost === null ? null : Number(meta.cost);
        row = {
          code, groupid: meta.groupid, name: meta.title || code, brand: meta.brand, rrp: meta.rrp,
          vat, profit: cost === null ? null : round2(price - vat - cost),
        };
      } else {
        const vat = price / VAT_DIVISOR;
        row = {
          code: description, groupid: 'misc', name: description, brand: '', rrp: null,
          vat, profit: round2(price - vat - price / 2),   // cost guessed at half the price — see the header
        };
      }

      const saleRes = await client.query(
        `INSERT INTO sales (id, code, solddate, groupid, ordernum, ordertime, qty, soldprice, channel, paytype,
                            collectedvat, productname, brand, profit, discount, rrp)
         SELECT n.id, $1, (now() AT TIME ZONE 'Europe/London')::date, $2, n.id::text,
                to_char(now() AT TIME ZONE 'Europe/London', 'HH24:MI'), 1, $3, 'CM3', $4, $5, $6, $7, $8, 0, $9
         FROM (SELECT nextval('sales_id_seq') AS id) n
         RETURNING id, solddate::text AS solddate, ordertime`,
        [row.code, row.groupid, price, paytype, round2(row.vat), String(row.name).slice(0, 200), row.brand, row.profit, row.rrp]
      );
      const sale = saleRes.rows[0];

      const what = !code ? `misc ${description}`
        : takenFrom ? `${code} from ${takenFrom}`
          : noStock ? `${code} (no location)` : `${code} (no stock)`;
      await writeBcLog(client, { who: changedBy, section: 'Shop', log: `Shop Sale #${sale.id}: ${what} £${price.toFixed(2)} ${paytype}` });

      return {
        sale: { id: sale.id, code: row.code, price, paytype, solddate: sale.solddate, ordertime: sale.ordertime },
        takenFrom,
      };
    });

    if (result.error === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'That size code is not set up' });
    }
    if (result.error === 'NO_STOCK') {
      return res.json({ return_code: 'NO_STOCK', message: `No free pair of that size left on ${location} — pick again` });
    }
    return res.json({ return_code: 'SUCCESS', ...result });
  } catch (err) {
    logger.error('[shop-sale-record] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to record the sale' });
  }
});

module.exports = router;
