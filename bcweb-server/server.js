/*
=======================================================================================================================================
Module: server.js
=======================================================================================================================================
Purpose: Express application entry point for the Brookfield Comfort internal platform API (Shopify Pricing module, v1).
         Loads env, applies security middleware (helmet, CORS restricted to CLIENT_URL, rate-limit on login), wires the API logger,
         mounts one router per endpoint (owner convention: one file per route in routes/), and starts listening on PORT.

Run: `node server.js` (dev: `npm run dev` = nodemon; prod: pm2 — see docs/deploy.txt).
=======================================================================================================================================
*/

// Load environment variables from .env FIRST so every module below sees DB_*, JWT_*, PORT, CLIENT_URL, etc.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const apiLogger = require('./utils/apiLogger');
const logger = require('./utils/logger');

const app = express();

// Exactly one reverse proxy (nginx) sits between the internet and this process on the VPS, adding X-Forwarded-For. Trust exactly
// that one hop (not `true`/all hops) so req.ip resolves to the real client IP for rate-limiting, without letting a client spoof
// extra X-Forwarded-For entries to fake a different origin IP. Locally (no proxy) this setting is inert.
app.set('trust proxy', 1);

// -------------------------------------------------------------------------------------------------------------------------------
// Security & parsing middleware
// -------------------------------------------------------------------------------------------------------------------------------
app.use(helmet());                 // sensible security headers
app.use(express.json());           // parse JSON request bodies

// CORS restricted to the web origin(s) in CLIENT_URL (CLAUDE.md). CLIENT_URL may be a comma-separated list (local + Vercel).
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / non-browser tools (no Origin header, e.g. Postman, health checks) and any whitelisted web origin.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  }
}));

// Request/response logging on every route (API-RULES).
app.use(apiLogger);

// -------------------------------------------------------------------------------------------------------------------------------
// Rate limiter for the login endpoint only (CLAUDE.md) — throttles brute-force password guessing without limiting normal API use.
// -------------------------------------------------------------------------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                  // 20 login attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  // Keep the HTTP-200 + return_code contract even when rate-limited (API-RULES: never send raw 4xx for API-level outcomes).
  handler: (req, res) => res.json({ return_code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Please try again later.' })
});

// -------------------------------------------------------------------------------------------------------------------------------
// Routes — one router per file. Health is public; auth + pricing routers are added in later milestones.
// -------------------------------------------------------------------------------------------------------------------------------
app.use('/health', require('./routes/health'));
app.use('/login', loginLimiter, require('./routes/login'));

// Segments module — overview heatmap read (registry-backed; self-heals via reconcile). Requires verifyToken (inside the router).
app.use('/segments', require('./routes/segments'));
app.use('/segment', require('./routes/segment'));   // detail read: header stats + per-area clocks + recent work-log (lazy)
app.use('/segment-work', require('./routes/segment-work'));     // W-seg-1: log a work event + optionally set that area's review clock
app.use('/segment-rename', require('./routes/segment-rename')); // W-seg-2: rewrite skusummary.segment + registry name atomically

// Pricing routes (all require verifyToken, applied inside each router).
app.use('/pricing-segments', require('./routes/pricing-segments'));
app.use('/pricing-triage', require('./routes/pricing-triage'));
app.use('/pricing-losers', require('./routes/pricing-losers'));
app.use('/pricing-all', require('./routes/pricing-all'));           // ALL: the whole segment (unfiltered), recently-changed first
app.use('/pricing-drill', require('./routes/pricing-drill'));
app.use('/pricing-find', require('./routes/pricing-find'));
app.use('/pricing-apply', require('./routes/pricing-apply'));
app.use('/pricing-match-toggle', require('./routes/pricing-match-toggle')); // turn Shopify "match Amazon price" autopilot on/off for a style
app.use('/pricing-park', require('./routes/pricing-park'));
app.use('/pricing-park-bulk', require('./routes/pricing-park-bulk')); // bulk W2: batch "just set review" — park a selection of un-changed styles
app.use('/pricing-history', require('./routes/pricing-history')); // drill report: recent Shopify price changes (audit log, lazy)
app.use('/pricing-sales', require('./routes/pricing-sales'));     // drill report: recent raw Shopify sales w/ sold price (lazy)

// Add / Modify Product module (all routes require verifyToken, applied inside each router).
app.use('/product-search', require('./routes/product-search'));    // Stage 1: search
app.use('/product-get', require('./routes/product-get'));          // Stage 2a: load one product's header
app.use('/product-lookups', require('./routes/product-lookups'));  // edit Stage 1: dropdown option lists
app.use('/product-create', require('./routes/product-create'));    // create: brand-new product (header basics)
app.use('/product-update', require('./routes/product-update'));    // edit: save header attribute/enum fields + title
app.use('/product-price', require('./routes/product-price'));      // edit: save price fields (cost/rrp/tax/shopifyprice)
app.use('/product-sizes', require('./routes/product-sizes'));      // edit: save the size list (skumap) + re-push if live on Shopify
app.use('/product-image', require('./routes/product-image'));     // edit: upload/convert/SFTP the main image + set imagename
app.use('/product-shopify', require('./routes/product-shopify')); // toggle Shopify on/off; on enable, push the product via Admin API
app.use('/product-amazon', require('./routes/product-amazon'));   // produce the Amazon Seller Central upload .xlsm for one groupid

// Amazon Pricing module (SKU-grain; mirrors the Shopify Pricing flow — segment picker -> WINNERS|LOSERS lists -> per-SKU drill).
// Read side + the one write. All routes require verifyToken, applied inside each router. Amazon has no park/review concept and no live
// price push: a price change is logged to amz_price_log and reaches Amazon via the client-built one-file Seller Central upload.
app.use('/amz-segments', require('./routes/amz-segments'));  // Stage 0: segment picker (managed segments + SKU count)
app.use('/amz-winners', require('./routes/amz-winners'));    // Stage 1: WINNERS — top in-stock SKUs by units sold (price up / harvest)
app.use('/amz-losers', require('./routes/amz-losers'));      // Stage 1: LOSERS — dead/slow FBA stock at risk (price down / cut)
app.use('/amz-all', require('./routes/amz-all'));            // Stage 1: ALL — every managed SKU in the segment (browse/lookup)
app.use('/amz-drill', require('./routes/amz-drill'));        // Stage 2: one SKU's header + 6-week velocity + 60d price bands
app.use('/amz-history', require('./routes/amz-history'));    // drill report (lazy): recent amz_price_log changes for the SKU
app.use('/amz-sales', require('./routes/amz-sales'));        // drill report (lazy): recent raw Amazon sales (incl. returns) for the SKU
app.use('/amz-find', require('./routes/amz-find'));          // direct SKU search across all managed segments
app.use('/amz-apply', require('./routes/amz-apply'));        // W-A1: record a new Amazon price + auto-park the SKU (skumap.next_amz_price_review)
app.use('/amz-review', require('./routes/amz-review'));      // W-A2: batch mark-reviewed — park a selection of un-changed SKUs at once
app.use('/amz-basket', require('./routes/amz-basket'));      // rebuild today's upload basket from amz_price_log (survives browser close)
app.use('/amz-mark-uploaded', require('./routes/amz-mark-uploaded')); // confirm a Seller Central upload -> stamp those rows uploaded_at (clears them from the basket, team-wide)

// Inventory Management module (docs/inventory-spec.md). Read-only stock lookup: "have we got this, and where is it?".
// Slice 1 = the style list only; the client fetches it once and does the Contains / Does-not-contain filtering in the browser.
app.use('/inv-styles', require('./routes/inv-styles'));  // full style list + headline Local / Order / Total per style
app.use('/inv-stock', require('./routes/inv-stock'));    // one style's size grid (Order / Total / Local per size) + image

// Analytics module. Birk Tracker: a daily snapshot of Birkenstock core-size availability (Full = styles with all 3 core sizes in FREE
// stock; the Google-Ads push/scale-back gauge). GET reads the stored history; POST recomputes + upserts today's row (manual Update).
app.use('/birk-tracker', require('./routes/birk-tracker'));         // GET: stored daily snapshot history (trend)
app.use('/birk-tracker-update', require('./routes/birk-tracker-update')); // POST: recompute + upsert today's snapshot, prune >2yr
// Stock Position: living-catalogue gauge per channel (Shopify styles / Amazon SKUs). GET is read-only (today's live figures + stored
// history); POST "Update now" upserts today's two rows + prunes >2yr (mirrors the Birk Tracker read/update split).
app.use('/analytics-stock-position', require('./routes/analytics-stock-position'));
app.use('/analytics-stock-position-update', require('./routes/analytics-stock-position-update'));
app.use('/analytics-stock-position-list', require('./routes/analytics-stock-position-list')); // GET: the products behind one bucket (drill)
app.use('/analytics-new-additions', require('./routes/analytics-new-additions')); // GET: styles created in the last N days + their lifetime sales
// Price Changes: recent price moves across BOTH channels (before->after, who/when) + units sold since each change. Filterable by
// channel (all/shp/amz) and user; per-channel limit. Read-only.
app.use('/analytics-change-impact', require('./routes/analytics-change-impact'));
// Sales: the windowed sales ledger (raw lines + a net-profit summary). Filter by channel (all/shp/amz) and window (today/…/90d/custom),
// search to one product, returns included & netted. Read-only; the front end builds the CSV export from these rows.
app.use('/analytics-sales', require('./routes/analytics-sales'));
// Scratchpad: a free-form shared notepad on the New Additions screen (research-mode product notes). GET lists newest-first; add/delete
// are POSTs (add returns the new row; delete is idempotent). No edit path by design (add + delete only).
app.use('/analytics-scratchpad', require('./routes/analytics-scratchpad'));               // GET: all notes, newest first
app.use('/analytics-scratchpad-add', require('./routes/analytics-scratchpad-add'));       // POST {body}: insert a note
app.use('/analytics-scratchpad-delete', require('./routes/analytics-scratchpad-delete')); // POST {id}: remove a note

// Fallback for unknown routes — still return the return_code envelope, not a bare 404.
app.use((req, res) => {
  res.json({ return_code: 'NOT_FOUND', message: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

const PORT = process.env.PORT || 3020;
app.listen(PORT, () => {
  logger.info(`[server] Brookfield API listening on port ${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});
