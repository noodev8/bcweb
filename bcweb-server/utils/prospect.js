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
  parseCheck(body)    -> { size, asin, rank, price, sellers } | { error, message } — one check as typed (prospect-check-add and the
                         first check on prospect-save share it, so both read "2,140" and "£64.99" the same way)
=======================================================================================================================================
*/

const RATINGS = ['diamond', 'good', 'sketchy'];

const BAD_ASIN_MESSAGE = "Couldn't find an ASIN in that — paste the Amazon product link or the 10-character ASIN";

// '' / null / undefined = not given. Anything else must be a whole number in [min, max] — NaN when it isn't.
function wholeOrNull(v, min, max) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));   // "2,140" as typed off the Amazon page
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

function parseCheck(body) {
  const size = typeof body.size === 'string' && body.size.trim() ? body.size.trim().slice(0, 10) : null;
  const rank = wholeOrNull(body.rank, 1, 2147483647);
  const sellers = wholeOrNull(body.sellers, 0, 32767);
  const priceRaw = body.price === undefined || body.price === null || body.price === ''
    ? null : Number(String(body.price).replace(/[£,\s]/g, ''));
  const price = priceRaw === null ? null
    : (Number.isFinite(priceRaw) && priceRaw >= 0 && priceRaw < 100000 ? Math.round(priceRaw * 100) / 100 : NaN);
  if (Number.isNaN(rank) || Number.isNaN(sellers) || Number.isNaN(price)) {
    return { error: 'MISSING_FIELDS', message: 'Rank and sellers must be whole numbers, price a number' };
  }
  // A check with no numbers says nothing.
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

module.exports = { RATINGS, BAD_ASIN_MESSAGE, parseAsin, parseCheck };
