/*
=======================================================================================================================================
Module: utils/feeDaily.js
=======================================================================================================================================
Purpose: Keeps fee_daily — real payment fees per day per source — for Reports → Revenue's Shopify expenses (2026-10-14).

         A source's rows are a CONTINUOUS run of days: every day it covers has a row, £0 included. So the route reads a source's
         covered range as MIN(day)..MAX(day), and can tell "no fees that day" (a £0 row) from "not known" (no row) — the days outside
         the range, which it estimates instead.

           SHOPIFY_PAYMENTS  topUpShopifyFees(): from the last stored day (re-read, it was likely partial) to today, via
                             utils/financeShopify.js → fetchFeesByDay. Run by "Update now" on Repricing's Status tab (owner,
                             2026-10-14) and, with an earlier start, by scripts/shopify-fees-backfill.js. Usually one API page.
           PAYPAL            storeDays() from scripts/paypal-fees-import.js, one export at a time (utils/financePayPal.js →
                             payPalFeesByDay). The export's own first..last day is the covered span.

         Writing a span replaces that span for that source (delete + insert, one transaction), so a re-run or an overlapping export
         is safe and a day whose fees were refunded away doesn't keep its old figure.
=======================================================================================================================================
*/

const { query } = require('../database');
const { withTransaction } = require('./transaction');
const { fetchFeesByDay } = require('./financeShopify');

// Where Shopify fees start if nothing is stored yet — before the Revenue page's two-year window opens (sales start Aug 2024).
const SHOPIFY_FEES_FROM = '2024-09-01';

// London's calendar date as YYYY-MM-DD (Shopify's processed_at days are shop-local, i.e. London).
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());

/**
 * Replace `source`'s rows for every day from..to (inclusive) with `days` ([{ day, fees, txns }]); days not listed get a £0 row.
 * Uses the caller's transaction client.
 */
async function storeDays(client, source, from, to, days) {
  await client.query('DELETE FROM fee_daily WHERE source = $1 AND day BETWEEN $2::date AND $3::date', [source, from, to]);
  const r = await client.query(`
    INSERT INTO fee_daily (day, source, fees, txns)
    SELECT g.day::date, $1, COALESCE(d.fees, 0), COALESCE(d.txns, 0)
    FROM generate_series($2::date, $3::date, INTERVAL '1 day') AS g(day)
    LEFT JOIN unnest($4::date[], $5::numeric[], $6::int[]) AS d(day, fees, txns) ON d.day = g.day::date
  `, [source, from, to, days.map((d) => d.day), days.map((d) => d.fees), days.map((d) => d.txns)]);
  return r.rowCount;
}

/**
 * Bring SHOPIFY_PAYMENTS up to today. `from` overrides the start (the backfill); otherwise it restarts at the last stored day.
 * Returns { from, to, days, fees, pages }. Throws on an API failure or a capped (incomplete) read — nothing is stored then.
 */
async function topUpShopifyFees(from) {
  let start = from;
  if (!start) {
    const r = await query(`SELECT MAX(day)::text AS last FROM fee_daily WHERE source = 'SHOPIFY_PAYMENTS'`);
    start = r.rows[0].last || SHOPIFY_FEES_FROM;
  }
  const got = await fetchFeesByDay(start);
  if (!got.complete) throw new Error(`Shopify fees read stopped after ${got.pages} pages without reaching ${start}`);
  const to = londonToday();
  const days = await withTransaction((client) => storeDays(client, 'SHOPIFY_PAYMENTS', start, to, got.days));
  const fees = Math.round(got.days.reduce((a, d) => a + d.fees, 0) * 100) / 100;
  return { from: start, to, days, fees, pages: got.pages };
}

module.exports = { storeDays, topUpShopifyFees, SHOPIFY_FEES_FROM };
