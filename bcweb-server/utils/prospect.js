/*
=======================================================================================================================================
Util: prospect
=======================================================================================================================================
Purpose: Small shared helpers for the Prospects screen (migrations/20261021_prospects.sql) — the shared notepad of possible NEW products
         found on Amazon. Pure functions, no DB.
=======================================================================================================================================
Exports:
  RATINGS             the gut-call ratings a line can carry (NULL = not rated)
  parseAsin(input)    -> 'B0ABC12345' | null — from a bare ASIN or any Amazon product URL
  textOrNull(v, max)  -> trimmed text, or null when blank
  parseCheck(body)    -> { size, asin, rank, price, sellers } | { error, message } — one check, all free text as typed (prospect-check-add
                         and the first check on prospect-save share it)
=======================================================================================================================================
*/

const RATINGS = ['diamond', 'good', 'sketchy'];

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

module.exports = { RATINGS, BAD_ASIN_MESSAGE, parseAsin, parseCheck, textOrNull };
