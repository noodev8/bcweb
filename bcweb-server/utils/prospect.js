/*
=======================================================================================================================================
Util: prospect
=======================================================================================================================================
Purpose: Small shared helpers for the Prospects screen (migrations/20261021_prospects.sql) — the shared notepad of possible NEW products
         found on Amazon. Pure functions, except purgeOldArchive (one DELETE on the caller's transaction).
=======================================================================================================================================
Exports:
  RATINGS             the gut-call ratings a line can carry (NULL = not rated)
  parseAsin(input)    -> 'B0ABC12345' | null — from a bare ASIN or any Amazon product URL
  textOrNull(v, max)  -> trimmed text, or null when blank
  parseCheck(body)    -> { size, asin, rank, price, sellers } | { error, message } — one check, all free text as typed (prospect-check-add
                         and the first check on prospect-save share it)
  OUTCOMES            what an archived line was decided as (migrations/20261026_prospect_archive.sql)
  ARCHIVE_MONTHS      how long an archived line is kept
  purgeOldArchive(c)  removes lines archived more than ARCHIVE_MONTHS ago — called on every add and every archive (no cron)
  moneyNum(text)      -> the number in a free-text price/cost ("£98" -> 98) | null
  returnOnCost(p, c)  -> { price, cost, profit, on_cost_pct } | null — a find's keep a pair on Amazon and its return on cost
=======================================================================================================================================
*/

const { amzProfit } = require('./amzProfit');

const RATINGS = ['diamond', 'good', 'sketchy'];

// ARCHIVE (owner, 2026-10-26): a decided line is kept so colleagues can see it was tested, but not for ever — "Maybe keep for 3-6
// months". 6 months covers a season. No cron: the purge rides on the writes that grow the list (add, archive), which the team does
// most days; a quiet week just means old lines linger a few days longer, which is harmless.
const OUTCOMES = ['ordered', 'dropped'];
const ARCHIVE_MONTHS = 6;

async function purgeOldArchive(client) {
  // The CASCADE takes the line's checks and comments with it — gone for good, like Delete.
  await client.query(`DELETE FROM prospect WHERE archived_at < now() - make_interval(months => $1)`, [ARCHIVE_MONTHS]);
}

const BAD_ASIN_MESSAGE = "Couldn't find an ASIN in that — paste the Amazon product link or the 10-character ASIN";

// Free text, as typed (owner, 2026-10-21: "All should be optional free text. Rank is 58k for example"). Blank = not given.
function textOrNull(v, max) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim().slice(0, max);
  return t || null;
}

function parseCheck(body) {
  const size = textOrNull(body.size, 10);
  const rank = textOrNull(body.rank, 30);
  const price = textOrNull(body.price, 30);
  const sellers = textOrNull(body.sellers, 30);
  // A check with nothing in it says nothing.
  if (rank === null && price === null && sellers === null) {
    return { error: 'MISSING_FIELDS', message: 'Enter a rank, price or number of sellers' };
  }
  const amazon = typeof body.amazon === 'string' ? body.amazon.trim() : '';
  const asin = amazon ? parseAsin(amazon) : null;
  if (amazon && !asin) return { error: 'BAD_ASIN', message: BAD_ASIN_MESSAGE };
  return { size, asin, rank, price, sellers };
}

// The team pastes whatever the address bar shows, so accept a bare ASIN or a URL in any of Amazon's shapes:
//   .../dp/B0ABC12345/...   .../gp/product/B0ABC12345   .../gp/aw/d/B0ABC12345 (mobile)   ...?asin=B0ABC12345
// An ASIN is 10 letters/digits. A bare 10-character value is taken as-is; inside a URL only the path forms above count, so a random
// 10-letter word in a long URL can't be mistaken for one.
function parseAsin(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  if (/^[A-Za-z0-9]{10}$/.test(s)) return s.toUpperCase();
  const m = s.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Za-z0-9]{10})(?=[/?#]|$)/i) || s.match(/[?&]asin=([A-Za-z0-9]{10})(?=&|#|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// A price or cost typed as free text ("£98", "98.00", "1,099") read as a number — the first number in it, commas dropped. null when
// there is none or it isn't above 0 (a blank or "?" must never become a £0 cost).
function moneyNum(text) {
  if (text === undefined || text === null) return null;
  const m = String(text).replace(/,/g, '').match(/\d+(\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// RETURN ON COST for a find (owner, 2026-10-27 — the one figure for "is this a good use of cash?"): what a pair keeps on Amazon at the
// price seen there, with THE Amazon formula (utils/amzProfit.js — VAT, 15% referral, FBA, digital, courier, wages, ÷1.2 for returns),
// over the cost. VAT is assumed (every find would be sold VAT-registered) and the FBA fee is the formula's own fallback (a find has no
// real one yet) — both on the cautious side, like the formula. null unless both a price and a cost can be read.
function returnOnCost(priceText, costText) {
  const price = moneyNum(priceText);
  const cost = moneyNum(costText);
  if (price === null || cost === null) return null;
  const { profit } = amzProfit({ price, cost, fbafee: null, tax: 1 });
  if (profit === null) return null;
  return { price, cost, profit, on_cost_pct: Math.round((profit / cost) * 1000) / 10 };
}

module.exports = {
  RATINGS, OUTCOMES, ARCHIVE_MONTHS, BAD_ASIN_MESSAGE, parseAsin, parseCheck, textOrNull, purgeOldArchive, moneyNum, returnOnCost,
};
