/*
=======================================================================================================================================
Util: brandPriceRequest.js   (THE copy — brand price requests, owner 2026-11-18)
=======================================================================================================================================
A brand can ask us to sell at RRP on ONE channel (Strive on Amazon, Free Spirit on Shopify). Stored brand-wide, per channel, in
brand_price_request (migrations/20261118_brand_price_request.sql), set by hand: the owner says, Claude adds or removes a row.

A REMINDER, NEVER A RULE (owner: "don't want to force it"). Nothing blocks, changes or suggests a price because of it — the screens
show a note: the price cards (both channels), the pricing lists, and the size-price screens (clearance / overstock sizes — "just as a
reminder"). Amber when the price differs from the RRP. Only on the channel the brand named.

The screens read the whole list once (GET /brand-price-requests) and match on brand — it is a handful of rows, so no per-list SQL.
=======================================================================================================================================
*/

async function listBrandPriceRequests(db) {
  const r = await db.query(`
    SELECT brand, channel, request, note
    FROM brand_price_request
    ORDER BY brand, channel
  `);
  return r.rows;
}

module.exports = { listBrandPriceRequests };
