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
app.use('/pricing-park', require('./routes/pricing-park'));
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

// Amazon Pricing module (SKU-grain; read side. All routes require verifyToken, applied inside each router).
app.use('/amz-segments', require('./routes/amz-segments'));  // chips: managed segments + attention badge + 90d performance context
app.use('/amz-skus', require('./routes/amz-skus'));          // the SKU list for a segment (or all) with a suggested move per row
app.use('/amz-sku', require('./routes/amz-sku'));            // drill (lazy): one SKU's 6-week velocity + price-change history + price bands
app.use('/amz-apply', require('./routes/amz-apply'));       // W-A1: record a new Amazon price (amz_price_log only; never writes amzfeed)
// NOTE: /amz-pending + /amz-upload-file (phantom-diff basket) are written but NOT mounted — live data showed the phantom model
// surfaces months-old mismatches, not just this session's changes (see docs/amz-pricing-spec.md §3). The basket is session-scoped
// client-side for now; a persistent basket needs an explicit amz_price_log.uploaded_at flag (deferred decision).

// Fallback for unknown routes — still return the return_code envelope, not a bare 404.
app.use((req, res) => {
  res.json({ return_code: 'NOT_FOUND', message: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

const PORT = process.env.PORT || 3020;
app.listen(PORT, () => {
  logger.info(`[server] Brookfield API listening on port ${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});
