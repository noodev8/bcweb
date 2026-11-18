/*
=======================================================================================================================================
Route: GET /brand-price-requests   (READ ONLY)
=======================================================================================================================================
Purpose: The brands that have asked for RRP on a channel (utils/brandPriceRequest.js, THE copy). Read once by the web app's
         BrandRrpNote, which shows a reminder on the price cards, the pricing lists and the size-price screens. Never a rule.
=======================================================================================================================================
Response:
{ "return_code": "SUCCESS",
  "requests": [ { "brand": "Strive", "channel": "AMZ", "request": "RRP", "note": "Brand asks for RRP on Amazon (…)" } ] }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { listBrandPriceRequests } = require('../utils/brandPriceRequest');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const requests = await listBrandPriceRequests(db);
    return res.json({ return_code: 'SUCCESS', requests });
  } catch (err) {
    logger.error('[brand-price-requests] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the brand price requests' });
  }
});

module.exports = router;
