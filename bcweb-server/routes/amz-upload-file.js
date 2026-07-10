/*
=======================================================================================================================================
API Route: amz_upload_file
=======================================================================================================================================
Method: GET
Purpose: Generate the ONE Amazon price upload file from the whole pending set (docs/amz-pricing-spec.md §3). The web server can't write
         the operator's Downloads folder, so instead of appending rows to a file on disk we build the entire tab-separated file on
         demand and hand it back; the browser saves it, the operator uploads it to Seller Central when it suits, and after the overnight
         amzfeed refresh those rows drop out of "pending" automatically. One file, never one-per-SKU (the owner's requirement).

To keep the platform's HTTP-200 + return_code envelope (and JWT auth via the normal client) we return the file as a JSON payload
{ filename, content } and let the browser turn it into a download — rather than streaming an attachment that would sit outside the
envelope. Content is tab-separated, Amazon's expected columns:
   sku <TAB> price <TAB> minimum-seller-allowed-price <TAB> maximum-seller-allowed-price
   - sku   = amzfeed.sku (the Amazon SKU), NOT our code.
   - min   = blank.
   - max   = the style's RRP (skusummary.rrp), blank if unknown.
=======================================================================================================================================
Success Response:
{ "return_code": "SUCCESS", "filename": "AMZ-Price-Upload.txt", "count": 3, "content": "sku\tprice\t...\nAD-0XF8D-48L\t39.79\t\t45.00\n..." }
=======================================================================================================================================
Return Codes: "SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { getPending } = require('../utils/amzPending');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const rows = await getPending();
    const header = 'sku\tprice\tminimum-seller-allowed-price\tmaximum-seller-allowed-price';
    const lines = rows.map((r) => `${r.amz_sku}\t${r.new_price.toFixed(2)}\t\t${r.rrp != null ? r.rrp.toFixed(2) : ''}`);
    const content = [header, ...lines].join('\n') + '\n';
    return res.json({ return_code: 'SUCCESS', filename: 'AMZ-Price-Upload.txt', count: rows.length, content });
  } catch (err) {
    logger.error('[amz-upload-file] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to build upload file' });
  }
});

module.exports = router;
