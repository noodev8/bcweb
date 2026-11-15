/*
=======================================================================================================================================
Util: googleBenchmark   (THE copy — Google's per-size price benchmark and its history; owner 2026-11-15)
=======================================================================================================================================
Purpose: Google Merchant Center's price benchmark is the outside price for the Shopify price cards, the way the Buy Box is for Amazon
         (docs/shopify-cards/PLAN.md — read it first). Google only gives TODAY's figure, so this keeps a change-only history: tables
         google_benchmark_history / google_benchmark_run (migrations/20261115_google_benchmark.sql — its header has the rules).

WHAT GOOGLE GIVES: Merchant API Reports v1, view price_competitiveness_product_view → benchmark_price per offer: the click-weighted
         AVERAGE price other UK shops charge for the same product (GTIN match) — not the cheapest. Per offer = per SIZE for us (the feed
         sends one offer per size, offer id = skumap.googleid — not always the code: 0128181-MADRID-40's is 0128181-40). About 70% of
         our Google sizes have one (1,445 of 2,030 on 2026-11-15). The view insists on `id` and `report_country_code` in the SELECT.

WHERE IT RUNS: the `benchmark` part of the nightly scripts/google-jobs.js, after the feed and Google Ads (owner: no second cron line).

THE RULES (owner, 2026-11-15, decision 5):
  - CHANGE-ONLY, ONE ROW PER SIZE PER DAY: today's rows are deleted and written again against the state BEFORE today, so a second read
    the same day gives the same rows. A size whose benchmark is gone gets a NULL row (only if its last row wasn't already NULL).
  - 12 MONTHS, trimmed here as it writes. A row older than the cut-off goes only once a NEWER row is also at or before the cut-off, so
    the row in force at the cut-off stays and every day inside the window can be read. A last row that is NULL and older than the
    cut-off goes too (no rows = no benchmark, the same answer), and so do the old rows of a size gone from skumap.
  - A READ OF NOTHING WRITES NOTHING: if Google returns no benchmarks at all, that is a failed read, not "every benchmark went away" —
    it throws, so ~1,400 NULL rows can't be written by a Google hiccup.

Exports:
  readBenchmarks()                       -> Map offerId -> benchmark (GBP number), from Google
  recordBenchmarks(client, benchmarks)   -> { day, offers, sizes, changed, trimmed }  (call inside a transaction)
  CURRENT_SQL                            -> SELECT code, benchmark, since — each size's benchmark in force now (NULL ones left out)
=======================================================================================================================================
*/

const config = require('../config/config');
const { getAccessToken } = require('./googleAuth');
const { LONDON_TODAY_SQL } = require('./sql');

const REPORTS_URL = () => `https://merchantapi.googleapis.com/reports/v1/accounts/${config.google.merchantId}/reports:search`;
const KEEP_MONTHS = 12;
const PAGE_SIZE = 1000;
// Serialises two reads at the same moment, which would otherwise race on today's rows (delete + insert on the same keys).
const LOCK_KEY = 'google_benchmark';

const BENCHMARK_QUERY = `
  SELECT id, offer_id, report_country_code, benchmark_price
  FROM price_competitiveness_product_view
  WHERE report_country_code = 'GB'`;

/** Every UK benchmark Google holds for our offers, as Map offerId -> price (GBP). Throws on any API error (nothing half-read). */
async function readBenchmarks() {
  const token = await getAccessToken();
  const out = new Map();
  let pageToken;
  do {
    const resp = await fetch(REPORTS_URL(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: BENCHMARK_QUERY, pageSize: PAGE_SIZE, pageToken }),
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`Merchant API ${resp.status}: ${text.slice(0, 200)}`); }
    if (!resp.ok || json.error) throw new Error(`Merchant API ${resp.status}: ${json.error?.message || text.slice(0, 200)}`);
    for (const r of json.results || []) {
      const v = r.priceCompetitivenessProductView;
      const b = v?.benchmarkPrice;
      if (!v?.offerId || !b?.amountMicros || (b.currencyCode && b.currencyCode !== 'GBP')) continue;
      out.set(v.offerId, Math.round(Number(b.amountMicros) / 10000) / 100);
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Write today's benchmarks as change-only rows and trim to 12 months. Call inside a transaction.
 * @param client      transaction client
 * @param benchmarks  Map offerId -> price, from readBenchmarks()
 */
async function recordBenchmarks(client, benchmarks) {
  if (benchmarks.size === 0) throw new Error('Google returned no benchmarks — treated as a failed read, nothing written');

  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [LOCK_KEY]);
  const d = await client.query(`SELECT ${LONDON_TODAY_SQL}::text AS day`);
  const day = d.rows[0].day;

  // Today is written again from scratch against the state BEFORE today — the one-row-per-day rule.
  await client.query(`DELETE FROM google_benchmark_history WHERE day = $1`, [day]);

  const ids = [...benchmarks.keys()];
  const prices = ids.map((k) => benchmarks.get(k));
  const ins = await client.query(
    `WITH g AS (
       SELECT UNNEST($2::text[]) AS offer_id, UNNEST($3::numeric[]) AS benchmark
     ),
     cur AS (   -- today, by OUR code; a googleid on two live codes can't happen today, MAX keeps it one row if it ever does
       SELECT m.code, MAX(g.benchmark) AS benchmark
       FROM g JOIN skumap m ON m.googleid = g.offer_id AND COALESCE(m.deleted, 0) = 0
       GROUP BY m.code
     ),
     prev AS (
       SELECT DISTINCT ON (code) code, benchmark
       FROM google_benchmark_history WHERE day < $1::date
       ORDER BY code, day DESC
     ),
     rows AS (
       -- a new or changed benchmark
       SELECT c.code, c.benchmark FROM cur c LEFT JOIN prev p ON p.code = c.code
        WHERE p.code IS NULL OR p.benchmark IS DISTINCT FROM c.benchmark
       UNION ALL
       -- a benchmark that went away (once — not again while it stays away)
       SELECT p.code, NULL FROM prev p
        WHERE p.benchmark IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cur c WHERE c.code = p.code)
     )
     INSERT INTO google_benchmark_history (code, day, benchmark)
     SELECT code, $1::date, benchmark FROM rows`,
    [day, ids, prices]
  );
  const sizes = await client.query(
    `SELECT COUNT(DISTINCT m.code)::int AS n FROM skumap m WHERE m.googleid = ANY($1::text[]) AND COALESCE(m.deleted, 0) = 0`, [ids]);

  // 12 months (header: the row in force at the cut-off stays).
  const cut = `$1::date - make_interval(months => ${KEEP_MONTHS})`;
  const trim = await client.query(
    `DELETE FROM google_benchmark_history h
     WHERE h.day < ${cut}
       AND ( EXISTS (SELECT 1 FROM google_benchmark_history n WHERE n.code = h.code AND n.day > h.day AND n.day <= ${cut})
             OR (h.benchmark IS NULL AND NOT EXISTS (SELECT 1 FROM google_benchmark_history n WHERE n.code = h.code AND n.day > h.day))
             OR NOT EXISTS (SELECT 1 FROM skumap m WHERE m.code = h.code AND COALESCE(m.deleted, 0) = 0) )`,
    [day]
  );
  await client.query(`DELETE FROM google_benchmark_run WHERE day < ${cut}`, [day]);

  const result = { day, offers: benchmarks.size, sizes: sizes.rows[0].n, changed: ins.rowCount, trimmed: trim.rowCount };
  await client.query(
    `INSERT INTO google_benchmark_run (day, offers, sizes, changed) VALUES ($1, $2, $3, $4)
     ON CONFLICT (day) DO UPDATE SET offers = EXCLUDED.offers, sizes = EXCLUDED.sizes, changed = EXCLUDED.changed, read_at = now()`,
    [day, result.offers, result.sizes, result.changed]
  );
  return result;
}

// Each size's benchmark in force now (its latest row), with the day it took that value. A size whose latest row is NULL is left out.
const CURRENT_SQL = `
  SELECT code, benchmark, day AS since FROM (
    SELECT DISTINCT ON (code) code, benchmark, day
    FROM google_benchmark_history
    ORDER BY code, day DESC
  ) x
  WHERE benchmark IS NOT NULL`;

module.exports = { readBenchmarks, recordBenchmarks, CURRENT_SQL, KEEP_MONTHS };
