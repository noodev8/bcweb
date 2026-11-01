/*
=======================================================================================================================================
API Route: ebay_candidates
=======================================================================================================================================
Method: GET
Purpose: The "Not on eBay" view of the eBay listings screen (/ebay?view=not) — step 1 of the Add build (owner, 2026-11-01). Every style
         that could go on eBay and isn't there yet, each with a READINESS check against the listing rules (utils/ebayListingRules.js —
         the same rules the List button will use in step 2). READ ONLY: nothing is written to eBay or to the DB.

THE RULES (membership, readiness, what each row carries) live in utils/ebayCandidates.js → loadCandidates — one copy, shared with the
List button (routes/ebay-list.js), so what this view calls ready is exactly what gets listed. This route reads eBay live (to know what's
listed already) and returns every candidate. Order: most stock first, then groupid (as AMZ loaded).

Requires auth.
=======================================================================================================================================
Request: GET /ebay-candidates

Success Response:
{
  "return_code": "SUCCESS",
  "read_at": "…Z",
  "on_ebay_styles": 4,
  "summary": { "styles": 106, "ready": 80, "todo": 20, "missing": 6 },
  "rows": [ {
      "groupid": "40535-FRISCO-BLACK", "title": "…", "brand": "Free Spirit", "gender": "Womens", "producttype": "Sandals",
      "category": { "id": 62107, "name": "Women's Sandals" } | null, "department": "Women",
      "style": { "value": "Walking", "from": "title" } | null, "material": { "value": "Leather", "from": "stored" } | null,
      "type": null, "colour": "Black",
      "price": 59.95, "rrp": 70, "profit": 12.34, "photos": 4, "has_description": true, "title_length": 52,
      "local": 3, "fba": 1, "stock": 4,
      "sizes": [ { "code": "…-37", "uk_size": "4", "ean": "…", "local": 1, "fba": 0 } ],
      "missing": [], "todo": ["material"], "status": "ready" | "todo" | "missing"   (missing codes: utils/ebayCandidates.js)
  } ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"EBAY_NOT_CONFIGURED"   the eBay keys / refresh token are missing from .env
"EBAY_ERROR"            eBay couldn't be read (message says why) — without it we can't tell what is already listed
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { fetchActiveListings } = require('../utils/ebayListings');
const { loadCandidates, codesOnEbay } = require('../utils/ebayCandidates');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  // What is on eBay now — every SKU, fixed price and auction alike.
  let onEbayCodes;
  try {
    onEbayCodes = codesOnEbay(await fetchActiveListings());
  } catch (err) {
    const code = err.code === 'EBAY_NOT_CONFIGURED' ? 'EBAY_NOT_CONFIGURED' : 'EBAY_ERROR';
    logger.error('[ebay-candidates] eBay read failed:', err.message);
    return res.json({ return_code: code, message: err.message });
  }

  try {
    const { rows, onEbayStyles } = await loadCandidates({ onEbayCodes });
    const summary = {
      styles: rows.length,
      ready: rows.filter((x) => x.status === 'ready').length,
      todo: rows.filter((x) => x.status === 'todo').length,
      missing: rows.filter((x) => x.status === 'missing').length,
    };
    return res.json({ return_code: 'SUCCESS', read_at: new Date().toISOString(), on_ebay_styles: onEbayStyles, summary, rows });
  } catch (err) {
    logger.error('[ebay-candidates] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the styles not on eBay' });
  }
});

module.exports = router;
