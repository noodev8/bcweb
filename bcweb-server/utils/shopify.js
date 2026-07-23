/*
=======================================================================================================================================
Module: utils/shopify.js
=======================================================================================================================================
Purpose: The ONE place the bcweb server talks to the Shopify Admin API. Mirrors utils/sftp.js: a thin wrapper, credentials from
         config.shopify (env only — no hard-coded secrets), a clear Error if the config is incomplete so the calling route can return a
         meaningful return_code instead of a raw fetch failure.

         This replaces the legacy "Full/Standard product CSV" upload. The core is upsertProduct(groupid): it reads the product + its
         sizes/title/price/image from OUR database (the source of truth) and pushes them to Shopify with the GraphQL `productSet`
         mutation — a single, idempotent create-or-update of a product WITH all its option values and variants. Because productSet is
         keyed on `handle` and is idempotent, the SAME call:
           - creates a brand-new product (the old "Full" CSV), and
           - reconciles an existing product's variant list when a size is added/removed (the old "Standard" CSV).

         Identity mapping (proven by the existing Python scripts in C:\scripts):
           - product  <-> skusummary.handle
           - variant  <-> skumap.code  (= the Shopify variant SKU, e.g. '0151181-ARIZONA-36')
           - size     <-> Option1 "Size", value = the size display string ('36 EU / 3.5 UK')
           - price/rrp <-> skusummary.shopifyprice / rrp  (Shopify price / compareAtPrice)
           - barcode  <-> skumap.ean with the legacy trailing 'B' stripped
         After a successful push we cache each returned variant id back into skumap.variantlink ('<id>V'), exactly like
         price_update2.py's update_variant_links_in_database, so downstream lookups stay fast.

         Scope note: this does NOT set inventory quantities. Stock is riskier (overselling) and is already owned by
         update_shopify_inventory.py; productSet here only establishes the product/variants/price/barcode/title/image. Ongoing PRICE
         re-sync is a separate, deferred decision — the price sent here is just the initial one a variant must have to exist.

         Nothing in this module runs until a route calls it. Wiring it into the "enable Shopify" toggle / product-sizes is the next step.
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');
const config = require('../config/config');
const logger = require('./logger');

// Public image host that backs images.brookfieldcomfort.com (the same URL the site + Google feed use). imagename is a bare filename.
const IMAGE_BASE = 'https://images.brookfieldcomfort.com';

// A coded error we can throw and let the route map to a return_code (mirrors the { e.code } pattern used across the routes).
function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// True when all the creds needed for a call are present. Routes use this to short-circuit with SHOPIFY_NOT_CONFIGURED.
function isConfigured() {
  const { shop, accessToken } = config.shopify;
  return Boolean(shop && accessToken);
}

// Throw a clear, actionable error if we're missing creds (named like the .env vars) BEFORE we attempt any network call.
function requireConfig() {
  const { shop, accessToken, apiVersion } = config.shopify;
  const missing = [];
  if (!shop) missing.push('SHOPIFY_SHOP');
  if (!accessToken) missing.push('SHOPIFY_ACCESS_TOKEN');
  if (missing.length) {
    throw coded('SHOPIFY_NOT_CONFIGURED', `Shopify not configured — missing ${missing.join(', ')} in .env`);
  }
  return { shop, accessToken, apiVersion };
}

/*
 * shopifyGraphQL(queryStr, variables)
 * Low-level POST to the Admin GraphQL endpoint. Copies the resilience the Python scripts use: retry on HTTP 429 (rate limit) with a
 * short backoff. Throws on transport failure or GraphQL top-level errors (the schema-level "errors" array). Returns response.data.
 * userErrors (the mutation's own validation errors) are left for the caller to inspect — they are data, not transport failures.
 */
async function shopifyGraphQL(queryStr, variables = {}) {
  const { shop, accessToken, apiVersion } = requireConfig();
  const url = `https://${shop}.myshopify.com/admin/api/${apiVersion}/graphql.json`;
  const headers = {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json'
  };
  const payload = JSON.stringify({ query: queryStr, variables });

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: payload });
    } catch (err) {
      // Network/DNS/timeout — genuine transport failure. Surface a coded error the route can report.
      throw coded('SHOPIFY_PUSH_FAILED', `Shopify request failed: ${err.message}`);
    }

    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 5;
      logger.info(`[shopify] rate limited (429), retrying in ${retryAfter}s (attempt ${attempt}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw coded('SHOPIFY_PUSH_FAILED', `Shopify HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = await res.json();
    if (json.errors) {
      // Schema-level errors (bad query, wrong field, throttled cost) — not per-record validation.
      throw coded('SHOPIFY_PUSH_FAILED', `Shopify GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
    }
    return json.data;
  }
  throw coded('SHOPIFY_PUSH_FAILED', 'Shopify rate limit retries exhausted');
}

/*
 * buildProductSetInput(product, sizes, { status, isNew, productId })
 * PURE mapping from our DB shape to a ProductSetInput. No network — unit-testable in isolation. Faithful to the legacy CSV:
 *   - one Option: "Size"; its values are the size-display strings in saved order.
 *   - one variant per size: SKU = code (on inventoryItem), price = the product price, compareAtPrice = rrp (only if > price),
 *     barcode = the (already 'B'-stripped) barcode, inventory policy DENY, taxable false, requires shipping, weight 0 kg, tracked.
 *   - product-level image attached from imagename (if any).
 *
 * NEW vs EDIT — the ONE real difference (owner's legacy "Full" vs "Standard" CSV):
 *   - NEW (isNew): include descriptionHtml = "Stock Code: <groupid>" — the placeholder the owner replaces with a real description in
 *     the Shopify UI. This mirrors the Full CSV's Body (HTML) column.
 *   - EDIT (!isNew): OMIT descriptionHtml entirely so the owner's hand-written Shopify description is preserved (the Standard CSV had
 *     no Body (HTML) column). Also pass productId as `id` so productSet UPDATES that product rather than trying to create a duplicate.
 * Everything else (title, image, sizes, price, barcode, vendor, type) is sent in both, exactly like the two CSVs.
 * Caller is responsible for the price>0 guard; this function assumes a valid price string is passed.
 */
function buildProductSetInput(product, sizes, { status = 'ACTIVE', isNew = true, productId = null } = {}) {
  const priceStr = Number(product.price).toFixed(2);
  const hasRrp = product.rrp !== null && product.rrp !== undefined && Number(product.rrp) > Number(product.price);
  const compareAt = hasRrp ? Number(product.rrp).toFixed(2) : null;

  const productOptions = [
    { name: 'Size', values: sizes.map((s) => ({ name: s.sizeDisplay })) }
  ];

  const variants = sizes.map((s) => {
    const variant = {
      optionValues: [{ optionName: 'Size', name: s.sizeDisplay }],
      price: priceStr,
      taxable: false,
      inventoryPolicy: 'DENY',
      inventoryItem: {
        sku: s.code,
        tracked: true,
        requiresShipping: true,
        measurement: { weight: { value: 0, unit: 'KILOGRAMS' } }
      }
    };
    if (compareAt) variant.compareAtPrice = compareAt;
    if (s.barcode) variant.barcode = s.barcode;
    return variant;
  });

  const input = {
    handle: product.handle,
    title: product.title,
    vendor: product.brand || undefined,
    productType: product.producttype || undefined,
    status,
    productOptions,
    variants
  };

  // EDIT: target the existing product by id so productSet updates it (not creates a duplicate).
  if (productId) input.id = productId;

  // NEW only: seed the placeholder description. On EDIT we deliberately send nothing here so the owner's real Shopify description stays.
  if (isNew) input.descriptionHtml = `Stock Code: ${product.groupid}`;

  // Attach the main product image (bare filename -> public URL). productSet replaces media, so this is idempotent on re-push.
  if (product.imagename) {
    input.files = [{ originalSource: `${IMAGE_BASE}/${product.imagename}`, contentType: 'IMAGE', alt: product.title || '' }];
  }

  return input;
}

const PRODUCT_BY_HANDLE_QUERY = `
  query productByHandle($q: String!) {
    products(first: 5, query: $q) { nodes { id handle } }
  }
`;

/*
 * findProductIdByHandle(handle)
 * Returns the Shopify product GID for an exact handle, or null if the store has no such product. Used to decide NEW vs EDIT (and to
 * pass the id into productSet for an update). Handles are unique, but `query:"handle:..."` is a search, so we confirm an EXACT match
 * rather than trusting the first fuzzy hit.
 */
async function findProductIdByHandle(handle) {
  const data = await shopifyGraphQL(PRODUCT_BY_HANDLE_QUERY, { q: `handle:${handle}` });
  const nodes = (data.products && data.products.nodes) || [];
  const exact = nodes.find((n) => n.handle === handle);
  return exact ? exact.id : null;
}

const PRODUCT_SET_MUTATION = `
  mutation productSet($input: ProductSetInput!) {
    productSet(input: $input) {
      product {
        id
        handle
        variants(first: 250) { nodes { id sku } }
      }
      userErrors { field message code }
    }
  }
`;

/*
 * upsertProduct(groupid, { status })
 * The main entry point. Reads the product from OUR DB, builds the input, calls productSet, then caches variant ids back into
 * skumap.variantlink. Throws a coded error on any problem so the route can map it to a return_code:
 *   NOT_FOUND | NO_SIZES | PRICE_REQUIRED | SHOPIFY_NOT_CONFIGURED | SHOPIFY_PUSH_FAILED | SHOPIFY_USER_ERRORS
 * Returns { productId, handle, variantCount, isNew } on success (isNew = it was created, not updated).
 *
 * NOTE: DB and Shopify cannot share one transaction (different systems). The DB is already the source of truth by the time this runs;
 * this pushes that truth outward. If the push fails the DB is untouched and the caller can safely retry (productSet is idempotent).
 */
async function upsertProduct(groupid, { status = 'ACTIVE' } = {}) {
  requireConfig(); // fail fast with SHOPIFY_NOT_CONFIGURED before doing DB work

  // Header — same tables/derivations as product-get. safeNumeric guards the legacy VARCHAR price columns (NULL on junk).
  const header = await query(`
    SELECT
      ss.handle,
      ss.brand,
      ss.imagename,
      a.producttype,
      t.shopifytitle                     AS title,
      ${safeNumeric('ss.shopifyprice')}  AS price,
      ${safeNumeric('ss.rrp')}           AS rrp
    FROM skusummary ss
    LEFT JOIN title t      ON t.groupid = ss.groupid
    LEFT JOIN attributes a ON a.groupid = ss.groupid
    WHERE ss.groupid = $1
  `, [groupid]);

  if (header.rows.length === 0) throw coded('NOT_FOUND', `No product with groupid ${groupid}`);
  const h = header.rows[0];

  // Price guard — a variant cannot exist without a price, and we must never push a live product at 0.00 (the open "unpriced product"
  // decision). Refuse rather than create something mispriced.
  if (h.price === null || Number(h.price) <= 0) {
    throw coded('PRICE_REQUIRED', 'Set a Shopify price greater than 0 before pushing this product to Shopify');
  }
  if (!h.handle) throw coded('NOT_FOUND', `Product ${groupid} has no handle`);
  if (!h.title) throw coded('NOT_FOUND', `Product ${groupid} has no title`);

  // Sizes — same read as product-get (barcode 'B'-stripped, size display de-prefixed, in saved order).
  const sizeRes = await query(`
    SELECT
      code,
      NULLIF(regexp_replace(ean, 'B$', ''), '')    AS barcode,
      regexp_replace(optionsize, '^[0-9]+--', '')  AS sizedisplay
    FROM skumap
    WHERE groupid = $1 AND COALESCE(deleted, 0) = 0
    ORDER BY (split_part(optionsize, '--', 1))::int
  `, [groupid]);

  if (sizeRes.rows.length === 0) throw coded('NO_SIZES', `Product ${groupid} has no sizes to push`);
  const sizes = sizeRes.rows.map((s) => ({
    code: s.code,
    barcode: s.barcode || null,
    sizeDisplay: s.sizedisplay || null
  }));

  const product = {
    groupid,
    handle: h.handle,
    title: h.title,
    brand: h.brand || null,
    producttype: h.producttype || null,
    imagename: h.imagename || null,
    price: Number(h.price),
    rrp: h.rrp === null ? null : Number(h.rrp)
  };

  // Ground truth for NEW vs EDIT: does the store already have this handle? If so we UPDATE it (and must NOT resend the description,
  // which the owner curates in the Shopify UI). If not, this is a fresh create and we seed the "Stock Code: <groupid>" placeholder.
  const existingId = await findProductIdByHandle(product.handle);
  const isNew = !existingId;

  const input = buildProductSetInput(product, sizes, { status, isNew, productId: existingId });
  const data = await shopifyGraphQL(PRODUCT_SET_MUTATION, { input });

  const result = data.productSet;
  if (result.userErrors && result.userErrors.length) {
    // Per-record validation failures (e.g. duplicate handle owned by another product, bad option). Surface them verbatim.
    throw coded('SHOPIFY_USER_ERRORS', result.userErrors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; '));
  }

  const shopProduct = result.product;
  const returnedVariants = (shopProduct.variants && shopProduct.variants.nodes) || [];

  // Cache variant ids back into skumap.variantlink ('<numericId>V'), matched by SKU = code. Best-effort: a failure here does not
  // undo a successful Shopify push (the product is live; the cache just repopulates on the next lookup).
  let linked = 0;
  for (const v of returnedVariants) {
    if (!v.sku) continue;
    const numericId = String(v.id).split('/').pop();
    try {
      const upd = await query(`UPDATE skumap SET variantlink = $1 WHERE code = $2`, [`${numericId}V`, v.sku]);
      linked += upd.rowCount || 0;
    } catch (err) {
      logger.error(`[shopify] failed to cache variantlink for ${v.sku}: ${err.message}`);
    }
  }

  logger.info(`[shopify] upsert ${groupid}: ${isNew ? 'CREATED' : 'updated'} product ${shopProduct.id}, ${returnedVariants.length} variants, ${linked} links cached`);
  return { productId: shopProduct.id, handle: shopProduct.handle, variantCount: returnedVariants.length, isNew };
}

const PRODUCT_DELETE_MUTATION = `
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) { deletedProductId userErrors { field message } }
  }
`;

/*
 * deleteByHandle(handle)
 * Delete a product from the Shopify store by its handle (used by the "Delete product" flow — a product being removed from our catalogue
 * must not be left live on Shopify). Idempotent-ish: if the store has no product with that handle we return { deleted:false } rather than
 * erroring, so deleting a product that was never pushed is a no-op. Throws a coded error (SHOPIFY_USER_ERRORS / SHOPIFY_PUSH_FAILED /
 * SHOPIFY_NOT_CONFIGURED) on a real failure so the caller can ABORT and leave our DB untouched (never orphan a live listing).
 * Returns { deleted, id }.
 */
async function deleteByHandle(handle) {
  requireConfig(); // SHOPIFY_NOT_CONFIGURED before any network call
  if (!handle) return { deleted: false, id: null };
  const id = await findProductIdByHandle(handle);
  if (!id) return { deleted: false, id: null }; // nothing on Shopify to delete
  const data = await shopifyGraphQL(PRODUCT_DELETE_MUTATION, { input: { id } });
  const result = data.productDelete;
  if (result.userErrors && result.userErrors.length) {
    throw coded('SHOPIFY_USER_ERRORS', result.userErrors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; '));
  }
  logger.info(`[shopify] deleted product ${result.deletedProductId} (handle ${handle})`);
  return { deleted: true, id: result.deletedProductId };
}

/*
 * pushIfLive(groupid, { status })
 * The one helper every "save" route uses to keep Shopify in step: if the product is flagged live (skusummary.shopify = 1) and Shopify
 * is configured, re-push the whole product (productSet is whole-product, so one call reconciles whatever field just changed — title,
 * price, sizes, barcodes, image; never the description on an edit). Best-effort by design: it NEVER throws, so a Shopify hiccup can't
 * fail or roll back a DB save that already succeeded. Returns:
 *    null                                           -> not live, or Shopify not configured (nothing to do; caller shows nothing)
 *    { pushed: true, isNew, variantCount }          -> pushed OK
 *    { pushed: false, error, message }              -> live but the push failed (caller surfaces it; the DB save still stands)
 * Call it AFTER the DB write has committed.
 */
async function pushIfLive(groupid, { status = 'ACTIVE' } = {}) {
  if (!isConfigured()) return null;
  const r = await query(`SELECT shopify FROM skusummary WHERE groupid = $1`, [groupid]);
  if (!r.rows.length || r.rows[0].shopify !== 1) return null;
  try {
    const res = await upsertProduct(groupid, { status });
    return { pushed: true, isNew: res.isNew, variantCount: res.variantCount };
  } catch (err) {
    logger.error(`[shopify] pushIfLive failed for ${groupid}: ${err.code || ''} ${err.message}`);
    return { pushed: false, error: err.code || 'SHOPIFY_PUSH_FAILED', message: err.message };
  }
}

module.exports = { isConfigured, buildProductSetInput, upsertProduct, shopifyGraphQL, findProductIdByHandle, deleteByHandle, pushIfLive };
