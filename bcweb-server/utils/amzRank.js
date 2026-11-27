/*
=======================================================================================================================================
Util: amzRank — THE copy of "this size ranks well, we have none, and we can get it" (owner, 2026-11-27)
=======================================================================================================================================
Purpose: Re-buying goes by our own sales, which has a blind spot: a style we already buy whose sizes ran out sells nothing, so when the
         season turns and Amazon's rank climbs, our figures never show it (owner: "An item will move up in rank in a few months and might
         go under our radar … Our order screen should not only rank by sales but indicate a solid ranking of something we have no stock
         of, but Rieker have"). So Amazon Order flags such a size.

THE RANK: Amazon's Fashion Best Sellers Rank (amzBuyBox.js → readRanks, the Buy Box's own reading — sizes carry the PARENT's rank, a
         family figure) for EVERY amzfeed listing, 0-stock ones included, stored in amz_rank_now (migrations/20261127c). Read by the
         hourly WHOLE-LIST Buy Box read (amzBuyBox.js → executeRun calls readAllRanks; ~26 calls of 20, ~15 s). Best-effort: a failed
         read never fails the Buy Box read, and the last good ranks stay. TODAY ONLY — no history, no trend (owner, 2026-11-14).

THE BANDS (owner, 2026-11-27: "we usually go by 200k but clearly more excited and urgent for under 100k"):
         RANK_SOLID  200,000 — a size at or under it qualifies
         RANK_URGENT 100,000 — at or under it, the tag is the strong one
THE FLAG (computed on the screen, lib side, from these numbers): on Amazon, rank 1..RANK_SOLID, NO stock anywhere (local, at / to
         FBA, on order — the order list's local_stock and fba_total are both 0) and NOT Can't get (utils/noSupply.js — which the Rieker
         list keeps for Rieker / Remonte). Shown and listable only; nothing fills an order from it.
=======================================================================================================================================
Exports:
  RANK_SOLID, RANK_URGENT
  readAllRanks()   -> { asins, read } — reads and stores the rank of every amzfeed ASIN (replaces amz_rank_now)
=======================================================================================================================================
*/

const { query } = require('../database');
const { withTransaction } = require('./transaction');
const sp = require('./amzSpApi');
const logger = require('./logger');

const RANK_SOLID = 200000;
const RANK_URGENT = 100000;

async function readAllRanks() {
  // Required here, not at the top: amzBuyBox.js calls this from its own run, so a top-level require would be circular.
  const { readRanks } = require('./amzBuyBox');
  const { rows } = await query(`SELECT DISTINCT UPPER(TRIM(asin)) AS asin FROM amzfeed WHERE COALESCE(TRIM(asin), '') <> ''`);
  const asins = rows.map((r) => r.asin);
  if (!asins.length) return { asins: 0, read: 0 };
  const ranks = await readRanks(asins, sp.marketplaceId());   // a failed batch leaves its ASINs out of the Map
  if (!ranks.size) { logger.error('amzRank: no ranks read — kept the last ones'); return { asins: asins.length, read: 0 }; }
  const got = [...ranks];
  await withTransaction(async (client) => {
    await client.query(`
      INSERT INTO amz_rank_now (asin, sales_rank, read_at)
      SELECT x.asin, x.r, now() FROM unnest($1::text[], $2::int[]) AS x(asin, r)
      ON CONFLICT (asin) DO UPDATE SET sales_rank = EXCLUDED.sales_rank, read_at = EXCLUDED.read_at`,
    [got.map(([a]) => a), got.map(([, r]) => r)]);
    // A listing no longer in amzfeed drops out.
    await client.query(`DELETE FROM amz_rank_now WHERE NOT (asin = ANY($1))`, [asins]);
  });
  return { asins: asins.length, read: got.length };
}

module.exports = { RANK_SOLID, RANK_URGENT, readAllRanks };
