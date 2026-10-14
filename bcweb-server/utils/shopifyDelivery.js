/*
=======================================================================================================================================
Module: utils/shopifyDelivery.js
=======================================================================================================================================
Purpose: Keeps shopify_delivery — what customers paid for delivery, per Shopify order — for Reports → Revenue (2026-10-14). See
         migrations/20261014b_shopify_delivery.sql for why it exists (sales holds product lines only).

           topUpDelivery()          orders CHANGED since the last read (MAX(loaded_at), less a day of overlap) — catches new orders and
                                    a delivery refunded later on an old one. Run by "Update now" on Repricing's Status tab.
           topUpDelivery(createdMin) every order created since that ISO date — the backfill (scripts/shopify-delivery-backfill.js).

         Upsert per order, so re-reading is always safe. utils/financeShopify.js → fetchDeliveryOrders does the Shopify side.
=======================================================================================================================================
*/

const { query } = require('../database');
const { withTransaction } = require('./transaction');
const { fetchDeliveryOrders } = require('./financeShopify');

async function topUpDelivery(createdMin) {
  let opts;
  if (createdMin) {
    opts = { createdMin };
  } else {
    const r = await query(`SELECT (MAX(loaded_at) - INTERVAL '1 day') AS since FROM shopify_delivery`);
    if (!r.rows[0].since) throw new Error('shopify_delivery is empty — run scripts/shopify-delivery-backfill.js first');
    opts = { updatedMin: r.rows[0].since.toISOString() };
  }
  const orders = await fetchDeliveryOrders(opts);
  if (orders.length) {
    await withTransaction((client) => client.query(`
      INSERT INTO shopify_delivery (order_id, order_day, charged, refunded, loaded_at)
      SELECT * , now() FROM unnest($1::bigint[], $2::date[], $3::numeric[], $4::numeric[])
      ON CONFLICT (order_id) DO UPDATE
        SET order_day = EXCLUDED.order_day, charged = EXCLUDED.charged, refunded = EXCLUDED.refunded, loaded_at = now()
    `, [orders.map((o) => o.id), orders.map((o) => o.day), orders.map((o) => o.charged), orders.map((o) => o.refunded)]));
  }
  return { orders: orders.length, charged: orders.reduce((a, o) => a + o.charged - o.refunded, 0) };
}

module.exports = { topUpDelivery };
