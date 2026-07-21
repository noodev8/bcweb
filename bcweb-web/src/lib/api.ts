/*
=======================================================================================================================================
Module: src/lib/api.ts
=======================================================================================================================================
Purpose: The single axios instance + typed client functions for talking to the bcweb-server API. Implements the API-RULES
         frontend contract exactly:
           - Every server response is HTTP 200 with a `return_code`. So we branch on return_code, NOT on HTTP status.
           - Client functions NEVER throw on API-level errors (non-SUCCESS return_code). They return a structured
             ApiResult<T> = { success, data?, error?, return_code? } and let the calling component decide (toast / inline / redirect).
           - Only genuine network failures (server unreachable, timeout) throw / are caught into a NETWORK_ERROR result here.
         The axios instance attaches the stored JWT as `Authorization: Bearer <token>` (CLAUDE.md).
=======================================================================================================================================
*/

import axios, { AxiosRequestConfig } from 'axios';

// -------------------------------------------------------------------------------------------------------------------------------
// Token storage. We keep the JWT in localStorage (CLAUDE.md "persist token in localStorage/cookie"). AuthContext is the primary
// manager; these helpers exist so the axios interceptor can read the token without importing React.
// -------------------------------------------------------------------------------------------------------------------------------
const TOKEN_KEY = 'bc_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null; // SSR guard
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(TOKEN_KEY);
}

// -------------------------------------------------------------------------------------------------------------------------------
// The shared axios instance. baseURL comes from NEXT_PUBLIC_API_URL (.env / Vercel env).
// -------------------------------------------------------------------------------------------------------------------------------
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3020',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Attach the JWT to every request if present.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// -------------------------------------------------------------------------------------------------------------------------------
// Result envelope returned to callers. success=false carries error + return_code; success=true carries data.
// -------------------------------------------------------------------------------------------------------------------------------
export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  return_code?: string;
}

// Core request helper. Runs the call, then translates the return_code envelope into an ApiResult. Never throws for API errors;
// only network/timeout failures land in the catch and become a NETWORK_ERROR result (we choose to surface, not rethrow, so pages
// have one uniform shape to handle — matching the "let the caller decide" philosophy without red console noise).
// The response body is untyped JSON (the return_code envelope + arbitrary data fields), so `any` here is deliberate: each caller's
// `pick` narrows it to a typed shape. This is the one sanctioned `any` in the client, hence the scoped disable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function request<T>(config: AxiosRequestConfig, pick: (body: any) => T): Promise<ApiResult<T>> {
  try {
    const res = await api.request({ ...config });
    const body = res.data || {};
    if (body.return_code === 'SUCCESS') {
      return { success: true, data: pick(body), return_code: 'SUCCESS' };
    }
    return { success: false, error: body.message || 'Request failed', return_code: body.return_code || 'UNKNOWN' };
  } catch {
    // Genuine network failure (server down, DNS, timeout). No return_code envelope available (and we don't need the error object).
    return { success: false, error: 'Network error - please check your connection', return_code: 'NETWORK_ERROR' };
  }
}

// =============================================================================================================================
// Domain types (mirror the server response shapes in routes/*)
// =============================================================================================================================
export interface Segment { segment: string; styles: number; }
export interface TriageRow { rank: number; groupid: string; title: string | null; units: number; stock: number; price: number | null; match_amazon: boolean; }
export interface LoserRow {
  rank: number; groupid: string; title: string | null; price: number | null;
  stock: number; u30: number; u90: number;
  cover_weeks: number | null;   // weeks-to-clear at 90d pace; null when dead (no sales in window)
  is_dead: boolean;             // true = 0 sales in the window
  match_amazon: boolean;        // auto-matched to Amazon — badged; review-only (switch matching off to price/cut manually)
}
// ALL: the whole segment, unfiltered, most-recently-changed first. last_change/next_review are YYYY-MM-DD or null.
export interface AllRow {
  groupid: string; title: string | null; price: number | null; stock: number;
  last_change: string | null; next_review: string | null;
}
// --- Amazon Pricing module (SKU-grain; mirrors the Shopify flow — segment picker -> WINNERS|LOSERS -> per-SKU drill) -----------
// Stage 0: one managed segment (has live amzfeed SKUs) + its SKU count.
export interface AmzSegment { segment: string; skus: number; }
// Stage 1 WINNERS: top in-stock SKUs by units sold in the window (candidates to price UP / harvest).
export interface AmzWinnerRow {
  rank: number; code: string; amz_sku: string; groupid: string; size: string; title: string | null;
  price: number | null; fba: number; u7: number; units: number; last_sold: string | null;
}
// Stage 1 LOSERS: dead (no sale in 14d) / slow (cover >= coverWeeks) FBA stock at risk (candidates to price DOWN / cut).
export interface AmzLoserRow {
  rank: number; code: string; amz_sku: string; groupid: string; size: string; title: string | null;
  price: number | null; fba: number; u7: number; u30: number; u90: number; u14: number;
  cover_weeks: number | null;   // weeks-to-clear at the cover-window pace; null when no sales in the window
  is_dead: boolean;             // true = no Amazon sale in the last 14 days
  last_sold: string | null; days_since_sale: number | null;
}
// Stage 1 ALL: every managed SKU in the segment, most-recently-changed first (browse/lookup view).
export interface AmzAllRow {
  code: string; groupid: string; size: string; title: string | null;
  price: number | null; fba: number; last_change: string | null; last_sold: string | null;
}
// Stage 2 drill: header economics + the two evidence datasets. Margin here is NET (price - cost - FBA fee).
export interface AmzDrillHeader {
  code: string; amz_sku: string; groupid: string; segment: string | null; size: string; title: string | null;
  imagename: string | null;             // product image filename (served from images.brookfieldcomfort.com); null = no image
  price: number | null; cost: number | null; fbafee: number | null; rrp: number | null;
  floor: number | null;                 // cost + FBA fee (breakeven)
  margin: number | null; margin_pct: number | null;
  fba_live: number; fba_inbound: number;
  match_amazon: boolean;                 // read-only: the parent STYLE auto-matches its Shopify price to Amazon lowest in-stock
}
// VelocityWeek is the shared weekly-pace shape both drills return (drill-evidence-spec §4). Zero-filled, oldest→newest. profit is NET
// (from sales.profit). Rendered by the shared VelocityBars component.
export interface VelocityWeek { week_start: string; units: number; avg_price: number | null; profit: number; }
export type AmzWeek = VelocityWeek;
// PriceBand is the shared units-by-price shape both drills return (drill-evidence-spec §3/§4). profit_per_unit is NET per unit at that
// price (Amazon: price-cost-FBA; Shopify: from sales.profit). Rendered by the shared PriceBands component.
export interface PriceBand { price: number | null; units: number; profit_per_unit: number | null; first: string; last: string; }
export type AmzBand = PriceBand;
export interface AmzDrillData { header: AmzDrillHeader; weeks: AmzWeek[]; bands: AmzBand[]; }
// Drill reports (lazy — fetched only when their section is opened). Both bounded by most-recent-N rows; `truncated` = more exist.
export interface AmzHistoryRow { log_date: string; old_price: number | null; new_price: number | null; direction: string; notes: string; changed_by: string | null; }
export interface AmzHistoryData { rows: AmzHistoryRow[]; limit: number; truncated: boolean; }
export interface AmzSaleRow { solddate: string | null; size: string | null; qty: number; soldprice: number | null; profit: number | null; }
export interface AmzSalesData { rows: AmzSaleRow[]; limit: number; truncated: boolean; }
export interface AmzFindRow {
  code: string; amz_sku: string; groupid: string; segment: string | null; size: string; title: string | null;
  price: number | null; fba: number;
}
// Apply result (W-A1). Writes amz_price_log only; the price reaches Amazon via the client-built upload file, not this call.
// amz_sku + rrp let the session basket build that file straight from this response.
export interface AmzApplyResult { log_id: number; code: string; amz_sku: string; new_price: number; old_price: number | null; rrp: number | null; next_review: string | null; warnings: string[]; }

export interface DrillHeader {
  groupid: string; title: string | null;
  now: number | null; cost: number | null; rrp: number | null; minp: number | null; maxp: number | null;
  margin: number | null; margin_pct: number | null;   // GROSS (now - cost); net reasoning lives in the timeline profit/wk
  stock: number; colour: string | null; width: string | null; season: string | null;
  imagename: string | null;             // product image filename (served from images.brookfieldcomfort.com); null = no image
  next_review: string | null;
  match_amazon: boolean;                // true = Shopify price is auto-matched to Amazon (manual setter hidden; apply refused)
  amazon_lowest: number | null;         // Amazon's cheapest in-stock size = the match target (null if none in stock)
}
export interface TimelineRow {
  price: number; units: number;
  profit: number | null;                // NET era total (from sales.profit), null if the era has no profit data
  profit_wk: number | null;             // NET £/wk = margin × pace in one number — the "best price" ranking
  first_at: string | null; last_at: string | null;
  span_days: number; weeks: number; per_wk: number; is_current: boolean;
}
export interface SizeRow { size: string; qty: number; }
export interface DrillData { header: DrillHeader; timeline: TimelineRow[]; weeks: VelocityWeek[]; bands: PriceBand[]; sizes: SizeRow[]; days: number; }
// Drill reports (lazy — fetched only when their section is opened). Both bounded by most-recent-N rows; `truncated` = more exist.
export interface PriceHistoryRow { change_date: string | null; changed_time: string | null; old_price: number | null; new_price: number | null; note: string; changed_by: string | null; }
export interface PriceHistoryData { rows: PriceHistoryRow[]; limit: number; truncated: boolean; }
export interface SaleRow { solddate: string | null; ordertime: string | null; size: string | null; qty: number; soldprice: number | null; profit: number | null; }
export interface SalesData { rows: SaleRow[]; limit: number; truncated: boolean; }
export interface FindRow { groupid: string; title: string | null; segment: string | null; now: number | null; }
export interface ProductRow { groupid: string; title: string | null; }
export interface ProductSize { code: string; barcode: string | null; sizeDisplay: string | null; uksize: string | null; }
export interface ProductLookups {
  brands: string[]; colours: string[]; productTypes: string[]; segments: string[]; genders: string[]; seasons: string[];
}
// Editable header fields. Mirrors the POST /product-update payload (minus groupid).
export interface ProductEditFields {
  brand: string; colour: string; segment: string; season: string; gender: string; producttype: string; title: string;
}
// Suggested price prefill from the birktracker order book — present only for an UNPRICED Birkenstock style with a match.
export interface BirkPriceHint { rrp: number | null; cost: number | null; }
export interface ProductDetail {
  groupid: string;
  brand: string | null; colour: string | null; segment: string | null; season: string | null;
  width: string | null; material: string | null; gender: string | null; producttype: string | null;
  imagename: string | null;
  title: string | null;
  cost: number | null; rrp: number | null; price: number | null;
  tax: boolean; shopify: boolean;
  birkPrice?: BirkPriceHint | null;   // order-book RRP/cost suggestion (see BirkPriceHint); absent/null when not applicable
  sizes: ProductSize[];   // one row per variant (skumap)
}
export interface LoginData { token: string; display_name: string; }
export interface ApplyData { groupid: string; new_price: string; old_price: number | null; next_review: string | null; warnings: string[]; shopify?: ShopifyPushResult | null; google?: GooglePushResult | null; }
export interface ParkData { groupid: string; next_review: string; }

// =============================================================================================================================
// Client functions — one per endpoint. All return ApiResult<...>.
// =============================================================================================================================

export function login(username: string, password: string) {
  return request<LoginData>(
    { url: '/login', method: 'POST', data: { username, password } },
    (b) => ({ token: b.token, display_name: b.display_name })
  );
}

export function getSegments() {
  return request<Segment[]>({ url: '/pricing-segments', method: 'GET' }, (b) => b.segments || []);
}

export function getTriage(segment: string, days?: number, limit?: number) {
  return request<{ segment: string; days: number; rows: TriageRow[] }>(
    { url: '/pricing-triage', method: 'GET', params: { segment, days, limit } },
    (b) => ({ segment: b.segment, days: b.days, rows: b.rows || [] })
  );
}

export function getLosers(segment: string, days?: number, limit?: number, coverWeeks?: number) {
  return request<{ segment: string; days: number; coverWeeks: number; rows: LoserRow[] }>(
    { url: '/pricing-losers', method: 'GET', params: { segment, days, limit, coverWeeks } },
    (b) => ({ segment: b.segment, days: b.days, coverWeeks: b.coverWeeks, rows: b.rows || [] })
  );
}

// ALL list for a segment — every style, unfiltered, most-recently-changed first (browse/lookup view).
export function getAll(segment: string) {
  return request<{ segment: string; rows: AllRow[] }>(
    { url: '/pricing-all', method: 'GET', params: { segment } },
    (b) => ({ segment: b.segment, rows: b.rows || [] })
  );
}

// Amazon Pricing — Stage 0: the segment picker (managed segments + SKU count). Mirrors getSegments().
export function getAmzSegments() {
  return request<AmzSegment[]>({ url: '/amz-segments', method: 'GET' }, (b) => b.segments || []);
}

// Amazon Pricing — Stage 1 WINNERS: top in-stock SKUs by units sold in `days` (default 30). Mirrors getTriage().
export function getAmzWinners(segment: string, days?: number, limit?: number) {
  return request<{ segment: string; days: number; rows: AmzWinnerRow[] }>(
    { url: '/amz-winners', method: 'GET', params: { segment, days, limit } },
    (b) => ({ segment: b.segment, days: b.days, rows: b.rows || [] })
  );
}

// Amazon Pricing — Stage 1 LOSERS: dead/slow FBA stock at risk. Mirrors getLosers().
export function getAmzLosers(segment: string, days?: number, limit?: number, coverWeeks?: number) {
  return request<{ segment: string; days: number; coverWeeks: number; rows: AmzLoserRow[] }>(
    { url: '/amz-losers', method: 'GET', params: { segment, days, limit, coverWeeks } },
    (b) => ({ segment: b.segment, days: b.days, coverWeeks: b.coverWeeks, rows: b.rows || [] })
  );
}

// Amazon Pricing — Stage 1 ALL: every managed SKU in the segment, most-recently-changed first. Mirrors getAll().
export function getAmzAll(segment: string) {
  return request<{ segment: string; rows: AmzAllRow[] }>(
    { url: '/amz-all', method: 'GET', params: { segment } },
    (b) => ({ segment: b.segment, rows: b.rows || [] })
  );
}

// Amazon Pricing — Stage 2 drill: one SKU's header + 6-week velocity + 60d price bands. Mirrors getDrill().
export function getAmzDrill(code: string) {
  return request<AmzDrillData>(
    { url: '/amz-drill', method: 'GET', params: { code } },
    (b) => ({ header: b.header, weeks: b.weeks || [], bands: b.bands || [] })
  );
}

// Amazon Pricing — drill report (lazy): recent amz_price_log changes for one SKU. Mirrors getPriceHistory().
export function getAmzHistory(code: string, limit?: number) {
  return request<AmzHistoryData>(
    { url: '/amz-history', method: 'GET', params: { code, limit } },
    (b) => ({ rows: b.rows || [], limit: b.limit, truncated: !!b.truncated })
  );
}

// Amazon Pricing — drill report (lazy): recent raw Amazon sales (incl. returns) for one SKU. Mirrors getSales().
export function getAmzSales(code: string, limit?: number) {
  return request<AmzSalesData>(
    { url: '/amz-sales', method: 'GET', params: { code, limit } },
    (b) => ({ rows: b.rows || [], limit: b.limit, truncated: !!b.truncated })
  );
}

// Amazon Pricing — direct SKU search across all managed segments. Mirrors findProducts().
export function findAmzSkus(term: string) {
  return request<AmzFindRow[]>({ url: '/amz-find', method: 'GET', params: { term } }, (b) => b.results || []);
}

// Amazon Pricing — record a new price for one SKU (W-A1). Audit-only write; the price reaches Amazon via the client upload file, not
// this call. Optionally parks the SKU (skumap.next_amz_price_review) so it drops off the winners/losers queue — reviewDays mirrors
// Shopify W1: null/omitted = "None" (leave the review date untouched, SKU stays in the list); an integer >= 1 parks until today+N.
// Returns amz_sku + rrp (so the session basket can build the upload file straight from the response) + next_review (null when None).
export function applyAmzPrice(code: string, newPrice: number, note?: string, reviewDays?: number | null) {
  return request<AmzApplyResult>(
    // Only send reviewDays when it's a real period, so a "None" never reaches the server as a stray value (matches updateProductPrice).
    { url: '/amz-apply', method: 'POST', data: { code, newPrice, note, ...(reviewDays != null ? { reviewDays } : {}) } },
    (b) => ({ log_id: b.log_id, code: b.code, amz_sku: b.amz_sku, new_price: b.new_price, old_price: b.old_price, rrp: b.rrp ?? null, next_review: b.next_review ?? null, warnings: b.warnings || [] })
  );
}

// Amazon Pricing — rebuild the upload basket from the audit log (amz_price_log), so it survives a browser close / machine restart. Returns
// the whole team's price changes in the last 12h (latest price per SKU, any operator), each carrying the fields the upload file needs — so
// whoever is at the desk can upload a colleague's pending change. The item shape matches AmzBasketItem so the context can hydrate from it.
export interface AmzBasketFetchItem { id: number; code: string; amz_sku: string | null; size: string; title: string | null; segment: string | null; old_price: number | null; new_price: number; rrp: number | null; }
// The last confirmed Seller Central upload (any operator): when, who, how many SKUs — so the UI can reassure "already uploaded" even when
// the basket is empty. null if nothing has ever been marked uploaded.
export interface AmzLastUpload { at: string; by: string | null; count: number; }
export function getAmzBasket() {
  return request<{ items: AmzBasketFetchItem[]; lastUpload: AmzLastUpload | null }>(
    { url: '/amz-basket', method: 'GET' },
    (b) => ({ items: (b.items || []) as AmzBasketFetchItem[], lastUpload: (b.lastUpload ?? null) as AmzLastUpload | null })
  );
}

// Amazon Pricing — confirm a downloaded file has been uploaded to Seller Central. `ids` are the amz_price_log row ids the file covered
// (latest pending row per SKU); the server stamps those + older same-code pending rows as uploaded, clearing them from the basket team-wide.
export function markAmzUploaded(ids: number[]) {
  return request<{ updated: number }>(
    { url: '/amz-mark-uploaded', method: 'POST', data: { ids } },
    (b) => ({ updated: b.updated })
  );
}

// Amazon Pricing — batch "mark reviewed" (W-A2). Parks a selection of SKUs left UNCHANGED (no price applied) so they drop off the
// winners/losers queue and the derived Amazon segment clock advances. Returns how many rows were parked + the review date set.
export function markAmzReviewed(codes: string[], reviewDays: number) {
  return request<{ updated: number; nextReview: string | null }>(
    { url: '/amz-review', method: 'POST', data: { codes, reviewDays } },
    (b) => ({ updated: b.updated, nextReview: b.nextReview ?? null })
  );
}

export function getDrill(groupid: string, days?: number) {
  return request<DrillData>(
    { url: '/pricing-drill', method: 'GET', params: { groupid, days } },
    (b) => ({ header: b.header, timeline: b.timeline || [], weeks: b.weeks || [], bands: b.bands || [], sizes: b.sizes || [], days: b.days })
  );
}

export function findProducts(term: string) {
  return request<FindRow[]>({ url: '/pricing-find', method: 'GET', params: { term } }, (b) => b.results || []);
}

// Drill report: recent Shopify price changes for a style (audit log). Lazy — called when the "Price history" section is opened.
export function getPriceHistory(groupid: string, limit?: number) {
  return request<PriceHistoryData>(
    { url: '/pricing-history', method: 'GET', params: { groupid, limit } },
    (b) => ({ rows: b.rows || [], limit: b.limit, truncated: !!b.truncated })
  );
}

// Drill report: recent raw Shopify sales for a style, each with its sold price. Lazy — called when the "Recent sales" section is opened.
export function getSales(groupid: string, limit?: number) {
  return request<SalesData>(
    { url: '/pricing-sales', method: 'GET', params: { groupid, limit } },
    (b) => ({ rows: b.rows || [], limit: b.limit, truncated: !!b.truncated })
  );
}

// Add / Modify Product — Stage 1 search. Matches a groupid fragment against skusummary; results come back in groupid sort order.
// `limited` is true when the server trimmed the set (more matches exist) so the page can prompt the user to narrow the search.
export function searchProducts(term: string) {
  return request<{ results: ProductRow[]; limited: boolean }>(
    { url: '/product-search', method: 'GET', params: { term } },
    (b) => ({ results: b.results || [], limited: !!b.limited })
  );
}

// Add / Modify Product — Stage 2a. Load one product's full header (skusummary + title + attributes) for the edit panel. Read-only.
export function getProduct(groupid: string) {
  // Server returns the header (product) and sizes separately; fold them into one ProductDetail for the caller.
  return request<ProductDetail>(
    { url: '/product-get', method: 'GET', params: { groupid } },
    (b) => ({ ...b.product, sizes: b.sizes || [] }) as ProductDetail
  );
}

// Edit Stage 1 — dropdown option lists for the attribute fields.
export function getProductLookups() {
  return request<ProductLookups>({ url: '/product-lookups', method: 'GET' }, (b) => b.lookups as ProductLookups);
}

// Create a brand-new product (header basics). Sends the same fields as an edit; server rejects if the groupid already exists or the
// generated handle clashes (return_code ALREADY_EXISTS / HANDLE_TAKEN). On success returns the (upper-cased) groupid + its handle.
export function createProduct(groupid: string, fields: ProductEditFields) {
  return request<{ groupid: string; handle: string }>(
    { url: '/product-create', method: 'POST', data: { groupid, ...fields } },
    (b) => ({ groupid: b.groupid, handle: b.handle })
  );
}

// Edit Stage 1 — save the attribute/enum fields (brand, colour, segment, season -> skusummary; gender, producttype -> attributes).
export function updateProduct(groupid: string, fields: ProductEditFields) {
  return request<{ groupid: string; saved: ProductEditFields; shopify?: ShopifyPushResult }>(
    { url: '/product-update', method: 'POST', data: { groupid, ...fields } },
    (b) => ({ groupid: b.groupid, saved: b.saved as ProductEditFields, shopify: b.shopify })
  );
}

// Upload/replace a product's main image (multipart). The server converts it to 800x800 JPEG, SFTPs it to the image host, and updates
// skusummary.imagename — returning the new filename + public URL. `title` (the on-screen title) seeds the SEO filename server-side.
// NOTE: Content-Type is set to multipart/form-data so axios keeps the FormData intact (the shared instance defaults to JSON) and adds
// the multipart boundary itself.
export interface ProductImageData { groupid: string; imagename: string; url: string; shopify?: ShopifyPushResult; }
export function uploadProductImage(groupid: string, file: File, title?: string) {
  const form = new FormData();
  form.append('image', file);
  form.append('groupid', groupid);
  if (title) form.append('title', title);
  return request<ProductImageData>(
    { url: '/product-image', method: 'POST', data: form, headers: { 'Content-Type': 'multipart/form-data' } },
    (b) => ({ groupid: b.groupid, imagename: b.imagename, url: b.url, shopify: b.shopify })
  );
}

// Save the price fields (cost, rrp, tax, base shopify price) on skusummary. Enforces legacy rules server-side (cost>0, rrp>0, rrp>=cost)
// and pushes live to Shopify (Admin API) when the product is on. Logs a price_change_log ('SHP') row whenever the Shopify price actually
// changes; `extras.note` (optional) rides on that row, `extras.reviewDays` (optional int >= 1) parks the style until today+N. Returns the
// numbers actually written (shopify price defaults to rrp if left blank), whether a log row was written, and the review date (if any).
export interface ProductPriceFields { cost: string; rrp: string; tax: boolean; shopifyPrice: string; }
export interface ProductPriceExtras { reviewDays?: number | null; note?: string; }
export interface ProductPriceSaved { cost: number; rrp: number; tax: boolean; price: number; }
export function updateProductPrice(groupid: string, fields: ProductPriceFields, extras?: ProductPriceExtras) {
  return request<{ groupid: string; saved: ProductPriceSaved; logged: boolean; next_review: string | null; shopify?: ShopifyPushResult; google?: GooglePushResult }>(
    {
      url: '/product-price',
      method: 'POST',
      data: {
        groupid,
        ...fields,
        // Only send the extras that are actually set, so an unused review/note never reaches the server as a stray value.
        ...(extras?.reviewDays != null ? { reviewDays: extras.reviewDays } : {}),
        ...(extras?.note ? { note: extras.note } : {}),
      },
    },
    (b) => ({
      groupid: b.groupid,
      saved: b.saved as ProductPriceSaved,
      logged: Boolean(b.logged),
      next_review: (b.next_review ?? null) as string | null,
      shopify: b.shopify,
      google: b.google,
    })
  );
}

// Save the size list (skumap). Client sends the full desired list in order; server reconciles (reorder/update/insert/delete).
export function updateProductSizes(groupid: string, sizes: { code: string; sizeDisplay: string; barcode: string; uksize: string }[]) {
  return request<{ groupid: string; sizes: ProductSize[]; shopify?: ShopifyPushResult }>(
    { url: '/product-sizes', method: 'POST', data: { groupid, sizes } },
    (b) => ({ groupid: b.groupid, sizes: b.sizes || [], shopify: b.shopify })
  );
}

// Toggle a product's Shopify listing on/off. Turning ON pushes the product to Shopify via the Admin API (create-or-update) and, only
// if that push succeeds, sets shopify=1; the response carries `push` (what happened on Shopify). Turning OFF just clears the flag
// (non-destructive — it does not unpublish). `status` lets a caller create as a DRAFT for testing; omitted -> server default ACTIVE.
// Non-SUCCESS return_codes the caller should surface: PRICE_REQUIRED, NO_SIZES, SHOPIFY_NOT_CONFIGURED, SHOPIFY_PUSH_FAILED,
// SHOPIFY_USER_ERRORS, NOT_FOUND.
export interface ShopifyPushData { productId: string; handle: string; variantCount: number; isNew: boolean; }
export interface ShopifyToggleData { groupid: string; shopify: boolean; push?: ShopifyPushData; }

// Outcome of the automatic "re-push to Shopify on save" that the edit routes (update/price/sizes/image) run when a product is live.
// null/absent means "not live or Shopify off — nothing pushed"; pushed=false means the DB save succeeded but the Shopify push failed.
export interface ShopifyPushResult { pushed: boolean; isNew?: boolean; variantCount?: number; error?: string; message?: string; }

// Outcome of the automatic "re-push price to Google Merchant Center on save" that pricing-apply and product-price run when a product
// is live on Google. null/absent means "not live on Google, Google not configured, or no googleid yet — nothing pushed"; pushed=false
// means the DB save stands but the whole push failed (updated/failed/total cover PARTIAL success — a groupid can have several
// googleids, one per size). Unlike Shopify, a failed Google push isn't urgent to retry — the nightly merchant_feed.py --upload cron
// is still an eventual fallback.
export interface GooglePushResult { pushed: boolean; updated?: number; failed?: number; total?: number; error?: string; message?: string; }
export function setProductShopify(groupid: string, shopify: boolean, status?: 'ACTIVE' | 'DRAFT') {
  return request<ShopifyToggleData>(
    { url: '/product-shopify', method: 'POST', data: { groupid, shopify, ...(status ? { status } : {}) } },
    (b) => ({ groupid: b.groupid, shopify: b.shopify, push: b.push })
  );
}

// Produce the Amazon Seller Central upload file (.xlsm) for one product. The server shells out to a Python helper that injects rows
// into the SHOES.xlsm template and returns the file base64-encoded (kept in the standard envelope). Side effect (mirrors the batch
// script): stamps skumap sku/status and skips variants already on Amazon. Caller decodes `file` to a Blob to trigger a download.
// Non-SUCCESS codes to surface: NOT_FOUND, NO_BRAND, INVALID_RRP, NO_SIZES, NO_ROWS, GENERATE_FAILED.
export interface AmazonUploadData {
  groupid: string; filename: string; variants: number; skipped: number; skumapUpdated: number; file: string;
}
export function generateAmazonUpload(groupid: string) {
  return request<AmazonUploadData>(
    { url: '/product-amazon', method: 'POST', data: { groupid } },
    (b) => ({
      groupid: b.groupid, filename: b.filename, variants: b.variants,
      skipped: b.skipped, skumapUpdated: b.skumapUpdated, file: b.file,
    })
  );
}

// reviewDays null = "None" (leave the review date untouched). note optional -> price_change_log.reason_notes.
export function applyPrice(groupid: string, newPrice: number, reviewDays: number | null, note?: string) {
  return request<ApplyData>(
    { url: '/pricing-apply', method: 'POST', data: { groupid, newPrice, reviewDays, note } },
    (b) => ({ groupid: b.groupid, new_price: b.new_price, old_price: b.old_price, next_review: b.next_review, warnings: b.warnings || [], shopify: b.shopify ?? null, google: b.google ?? null })
  );
}

export function parkStyle(groupid: string, reviewDays: number) {
  return request<ParkData>(
    { url: '/pricing-park', method: 'POST', data: { groupid, reviewDays } },
    (b) => ({ groupid: b.groupid, next_review: b.next_review })
  );
}

// Turn the Shopify "match Amazon price" autopilot on/off for a style. This flips the flag only — the price itself is (re)matched by the
// amz-match cron at its next afternoon sync. amazon_lowest = the current match target (Amazon lowest in stock), null if none in stock.
export interface MatchAmazonData { groupid: string; match_amazon: boolean; amazon_lowest: number | null; }
export function setMatchAmazon(groupid: string, enabled: boolean) {
  return request<MatchAmazonData>(
    { url: '/pricing-match-toggle', method: 'POST', data: { groupid, enabled } },
    (b) => ({ groupid: b.groupid, match_amazon: b.match_amazon, amazon_lowest: b.amazon_lowest ?? null })
  );
}

// Bulk W2 — park a whole SELECTION of styles at once (batch "just set review", no price change). The Shopify mirror of markAmzReviewed.
// Returns how many rows were parked + the review date set. A bulk PRICE change instead loops applyPrice() per style (so each style's
// live Shopify + Google push still runs), which is why there's no bulk-apply endpoint here.
export function parkStyleBulk(groupids: string[], reviewDays: number) {
  return request<{ updated: number; next_review: string | null }>(
    { url: '/pricing-park-bulk', method: 'POST', data: { groupids, reviewDays } },
    (b) => ({ updated: b.updated, next_review: b.next_review ?? null })
  );
}

// =============================================================================================================================
// Segments module — the review/attention layer over the pricing tools (docs/segments-spec.md).
// =============================================================================================================================
// No 'never' state — a never-worked MANUAL area is reported as 'overdue' (daysOverdue 0), so it reads as "needs attention now".
// 'due' is the DERIVED Shopify state (spec §9): styles still need pricing. Reuses the overdue RED, but its own state so the cell
// can render "X / Y waiting" instead of "Nd late". Manual clocks (Housekeeping, Amazon-for-now) never emit 'due'.
export type DueState = 'overdue' | 'due-soon' | 'ok' | 'off' | 'due';

// One clock cell = one work area (Shopify / Amazon / Housekeeping …) of one segment. Shared by the overview grid and the detail page.
export interface SegmentAreaCell {
  area: string;
  cadenceDays: number;
  dueState: DueState;
  daysOverdue: number;            // >0 only when overdue; 0 otherwise (and always 0 for derived Shopify)
  nextReview: string | null;      // YYYY-MM-DD; for derived Shopify 'ok' = when the soonest parked style returns
  outstanding: number | null;     // DERIVED (Shopify) only: in-stock styles still un-parked; null for manual clocks
  instock: number | null;         // DERIVED (Shopify) only: in-stock live styles (the candidate pool); null for manual clocks
  lastWorkedBy: string | null;
  lastWorkedAt: string | null;    // ISO timestamp
}
export interface SegmentOverviewRow {
  name: string;
  revenue30: number;              // live, all-channel revenue over the window
  gpPct: number | null;           // gross-profit %, null when no revenue
  heat: number | null;            // deferred fast-follow — null for now
  areas: SegmentAreaCell[];       // ordered by area sort
}
export interface SegmentWorklogEntry { area: string; workedBy: string | null; workedAt: string | null; note: string; }
export interface SegmentDetail {
  name: string;
  active: boolean;
  days: number;
  stats: { revenue30: number; gpPct: number | null; stock: number; styles: number; heat: number | null };
  areas: SegmentAreaCell[];
  worklog: SegmentWorklogEntry[];
  limit: number;
  truncated: boolean;
}

// Overview heatmap — one row per active segment (importance gutter + per-area due state). Sorted by revenue server-side.
export function getSegmentsOverview(days?: number) {
  return request<{ days: number; segments: SegmentOverviewRow[] }>(
    { url: '/segments', method: 'GET', params: { days } },
    (b) => ({ days: b.days, segments: b.segments || [] })
  );
}

// Detail for one segment — header stats + clocks + recent work-log (lazy/truncated).
export function getSegmentDetail(name: string, opts?: { days?: number; limit?: number }) {
  return request<SegmentDetail>(
    { url: '/segment', method: 'GET', params: { name, days: opts?.days, limit: opts?.limit } },
    (b) => ({
      name: b.name, active: b.active, days: b.days,
      stats: b.stats, areas: b.areas || [], worklog: b.worklog || [],
      limit: b.limit, truncated: !!b.truncated,
    })
  );
}

// W-seg-1: log a work event against one area, optionally setting that clock's review date and/or its "off" (N/A) flag.
// reviewDays null = "None" (leave the clock untouched). off undefined = leave the flag untouched.
export function logSegmentWork(name: string, area: string, reviewDays: number | null, note?: string, off?: boolean) {
  return request<{ name: string; area: string; workedBy: string; workedAt: string | null; nextReview: string | null; off: boolean }>(
    {
      url: '/segment-work', method: 'POST',
      data: { name, area, ...(reviewDays != null ? { reviewDays } : {}), ...(note ? { note } : {}), ...(off !== undefined ? { off } : {}) },
    },
    (b) => ({ name: b.name, area: b.area, workedBy: b.workedBy, workedAt: b.workedAt, nextReview: b.nextReview, off: !!b.off })
  );
}

// W-seg-2: rename a segment (rewrites product membership + registry name atomically; clocks/log carry across).
export function renameSegment(oldName: string, newName: string) {
  return request<{ oldName: string; newName: string; productsMoved: number }>(
    { url: '/segment-rename', method: 'POST', data: { oldName, newName } },
    (b) => ({ oldName: b.oldName, newName: b.newName, productsMoved: b.productsMoved })
  );
}

// =============================================================================================================================
// Analytics module — Birk Tracker (daily snapshot of Birkenstock core-size availability; the Google-Ads push/scale-back gauge).
// =============================================================================================================================
// One daily snapshot row. full = Birk styles with all 3 core sizes (38/39/40) in FREE stock (the decision number);
// styles = all in-range Birk styles (grid offers 38/39/40, the ceiling); full_pct = full/styles (trend gauge).
// units7 = trailing 7-day all-channel Birk units sold ending on that date, computed live from `sales` (not stored).
// total_free = ALL Birk FREE units on hand that day (the whole tank); core_free = FREE units at core sizes 38/39/40. Both STORED,
// nullable (pre-totals rows are null). cover_weeks = total_free / units7 (whole tank / weekly burn) — the push/scale-back gauge; null
// when stock level or recent sales are unknown.
export interface BirkSnapshot {
  date: string; full: number; styles: number; full_pct: number; units7: number;
  total_free: number | null; core_free: number | null; cover_weeks: number | null;
}

// Read the stored history (default last 90 days) + the latest row for the headline. Oldest -> newest.
export function getBirkTracker(days?: number) {
  return request<{ days: number; latest: BirkSnapshot | null; rows: BirkSnapshot[] }>(
    { url: '/birk-tracker', method: 'GET', params: { days } },
    (b) => ({ days: b.days, latest: b.latest ?? null, rows: b.rows || [] })
  );
}

// "Update" button — recompute the current snapshot, upsert today's row (latest run of the day wins), prune rows older than 2 years.
export function updateBirkTracker() {
  return request<{ latest: BirkSnapshot; pruned: number }>(
    { url: '/birk-tracker-update', method: 'POST' },
    // The POST recomputes stock (full/styles/total_free/core_free) only; units7 & cover (live sales reads) aren't returned here —
    // default them. The page reloads via GET /birk-tracker straight after, which carries the real units7 + cover.
    (b) => ({
      latest: {
        ...b.latest,
        units7: b.latest?.units7 ?? 0,
        total_free: b.latest?.total_free ?? null,
        core_free: b.latest?.core_free ?? null,
        cover_weeks: b.latest?.cover_weeks ?? null,
      },
      pruned: b.pruned ?? 0,
    })
  );
}

// =============================================================================================================================
// Analytics module — Stock Position (living-catalogue gauge per channel; the inventory-growth trend).
// =============================================================================================================================
// One snapshot row per channel. Four buckets that sum to `total` (the channel's universe); ALIVE = total - dormant:
//   in_stock_selling  — in stock now AND sold in last 6 months
//   in_stock_no_sale  — in stock now, no sale in 6 months
//   oos_sold_recently — out of stock but sold in last 6 months
//   dormant           — no stock AND no sale in 6 months (the "gone quiet" pile — NOT alive)
// Shopify counts STYLES (groupid, shopify=1); Amazon counts SKUs (amzfeed.code). `date` is the snapshot day (YYYY-MM-DD).
export interface StockPositionRow {
  date: string;
  in_stock_selling: number;
  in_stock_no_sale: number;
  oos_sold_recently: number;
  dormant: number;
  alive: number;
  total: number;
}

export interface StockPositionData {
  days: number;
  today: { shp: StockPositionRow; amz: StockPositionRow };
  history: { shp: StockPositionRow[]; amz: StockPositionRow[] };  // each oldest -> newest
}

// Load the Stock Position gauge. GET is read-only: it computes today's LIVE figures (the panels stay fresh) and returns the stored
// trend (default last 90 days). Recording a trend point is the separate "Update now" call below.
export function getStockPosition(days?: number) {
  return request<StockPositionData>(
    { url: '/analytics-stock-position', method: 'GET', params: { days } },
    (b) => ({
      days: b.days,
      today: b.today,
      history: { shp: b.history?.shp || [], amz: b.history?.amz || [] },
    })
  );
}

// "Update now" button — recompute both channels and upsert today's two rows (latest run of the day wins), prune rows older than 2
// years. Returns the freshly-computed `today`; the page reloads via GET afterwards to pick up the new history point.
export function updateStockPosition() {
  return request<{ today: { shp: StockPositionRow; amz: StockPositionRow }; pruned: number }>(
    { url: '/analytics-stock-position-update', method: 'POST' },
    (b) => ({ today: b.today, pruned: b.pruned ?? 0 })
  );
}

// One product row behind a bucket. `code`/`size` are Amazon-only (SKU grain); Shopify rows carry just groupid. stock = current units
// (Shopify FREE stock / Amazon FBA); last_sold = most recent sale date on that channel (null = never) — how long it's been quiet.
export interface StockListItem {
  code?: string;
  groupid: string;
  size?: string;
  title: string | null;
  price: number | null;
  stock: number;
  last_sold: string | null;
}
export type StockBucket = 'in_stock_selling' | 'in_stock_no_sale' | 'oos_sold_recently' | 'dormant';

// Drill: the actual products behind one bucket of one channel (e.g. everything Dormant on Amazon).
export function getStockPositionList(channel: 'SHP' | 'AMZ', bucket: StockBucket) {
  return request<{ channel: string; bucket: string; count: number; rows: StockListItem[] }>(
    { url: '/analytics-stock-position-list', method: 'GET', params: { channel, bucket } },
    (b) => ({ channel: b.channel, bucket: b.bucket, count: b.count ?? 0, rows: b.rows || [] })
  );
}

// One newly-added Shopify style with its lifetime sales performance. `created` = effective creation date; sales figures are lifetime
// (≈ since-add, as these are new products): units sold, revenue (qty×soldprice) and net profit. stock = current FREE stock.
export interface NewAdditionRow {
  groupid: string;
  title: string | null;
  created: string | null;
  price: number | null;
  rrp: number | null;
  stock: number;
  units: number;
  revenue: number;
  profit: number;
}

export interface NewAdditionsData { days: number; count: number; rows: NewAdditionRow[]; }

// Load the New Additions report — Shopify styles created in the last `days` (default 30), newest first, each with lifetime sales.
export function getNewAdditions(days?: number) {
  return request<NewAdditionsData>(
    { url: '/analytics-new-additions', method: 'GET', params: { days } },
    (b) => ({ days: b.days, count: b.count ?? 0, rows: b.rows || [] })
  );
}

// One scratchpad note — a free-form product jotting on the New Additions screen. `body` is the loose note text; `created_by` is who
// wrote it (server-resolved); `created_at` is an ISO timestamp.
export interface ScratchpadNote {
  id: number;
  body: string;
  created_by: string | null;
  created_at: string | null;
}

// Load all scratchpad notes, newest first.
export function getScratchpad() {
  return request<ScratchpadNote[]>(
    { url: '/analytics-scratchpad', method: 'GET' },
    (b) => (b.rows || []) as ScratchpadNote[]
  );
}

// One recent price change (Analytics -> Price Changes). Unified across channels: `channel` is 'SHP' | 'AMZ'. Shopify rows are style-grain
// (groupid, no amzCode/size); Amazon rows are SKU-grain (amzCode + size, groupid resolved via amzfeed). `oldPrice`/`newPrice` are the
// before/after. `unitsSince` = units sold from the change date to today (same channel + key); `daysSince` = whole days since the change
// (0 = same-day, treat unitsSince as indicative). `changedAt` is an ISO instant; `note` is the operator's free-text reason (may be '').
export interface PriceChangeRow {
  channel: 'SHP' | 'AMZ';
  groupid: string | null;
  amzCode: string | null;
  size: string | null;
  title: string | null;
  oldPrice: number | null;
  newPrice: number | null;
  note: string;
  changedBy: string | null;
  changedAt: string | null;
  daysSince: number | null;
  unitsSince: number;
}

export interface PriceChangesData {
  channel: 'all' | 'shp' | 'amz';
  user: string | null;
  limit: number;
  count: number;
  users: string[];          // distinct operators across both logs, for the "filter by user" dropdown
  rows: PriceChangeRow[];
}

// Load the Price Changes report — the latest `limit` price moves for the selected `channel` (default all), optionally filtered to one
// `user`, newest first, each with units sold since the change. `channel`: 'all' | 'shp' | 'amz'.
export function getPriceChanges(
  channel: 'all' | 'shp' | 'amz' = 'all',
  user?: string | null,
  limit?: number,
) {
  return request<PriceChangesData>(
    { url: '/analytics-change-impact', method: 'GET', params: { channel, user: user || undefined, limit } },
    (b) => ({
      channel: (b.channel as 'all' | 'shp' | 'amz') || 'all',
      user: b.user ?? null,
      limit: b.limit ?? 50,
      count: b.count ?? 0,
      users: b.users || [],
      rows: b.rows || [],
    })
  );
}

// --- Analytics -> Sales (windowed sales ledger + net-profit summary) -----------------------------------------------------------
// (Named SalesReport* to avoid colliding with the drill's own SaleRow/SalesData/getSales for pricing-sales.)
// One sale line. `channel` includes the minor 'CM3' alongside 'SHP'/'AMZ'. Returns are negative-`qty` (and negative-`profit`) lines.
// `marginPct` is that line's profit over its revenue (soldprice*qty); null when revenue is 0.
export interface SalesReportRow {
  solddate: string | null;   // 'YYYY-MM-DD'
  ordertime: string | null;  // 'HH:MM' (may be null on legacy rows)
  channel: 'SHP' | 'AMZ' | 'CM3';
  code: string | null;       // full SKU code
  size: string | null;       // EU size (RIGHT(code,2))
  groupid: string | null;    // style key
  productname: string | null;
  ordernum: string | null;
  qty: number;               // negative on a return
  soldprice: number | null;  // per unit
  profit: number | null;     // net, downstream-computed; negative on a return
  marginPct: number | null;
}
// Headline totals over the WHOLE window (never bounded by the row cap). Units split sold / returned / net (mirrors the legacy footer).
export interface SalesReportSummary {
  unitsSold: number;
  unitsReturned: number;
  unitsNet: number;
  orders: number;
  revenue: number;
  profit: number;            // the hero number
  marginPct: number | null;
  products: number;          // distinct styles in the matched set (product mode: >1 = total spans multiple products)
}
// Short windows carry the line list; long windows (7/30/90d) are summary-only (totals, no rows).
export type SalesWindow = 'today' | 'yesterday' | '3d' | '7d' | '30d' | '90d';
export interface SalesReportData {
  channel: 'all' | 'shp' | 'amz';
  window: SalesWindow;
  searchActive: boolean;     // true = product mode (window ignored, all-time match capped at 50); false = window pulse mode
  summaryOnly: boolean;      // true = long window: totals only, no rows fetched (UI hides the table and explains)
  from: string | null;       // resolved bounds (echoed for display) — window bounds in pulse mode, item's first→last sale in product mode
  to: string | null;
  search: string | null;
  summary: SalesReportSummary;
  rows: SalesReportRow[];
  limit: number;
  count: number;
  truncated: boolean;        // true when more rows exist than the cap (UI notes it; export still covers the loaded rows)
}

// Load the Sales report — sale lines for the selected channel + window plus a product search, with the net-profit summary. Returns
// included. Short windows (today/yesterday/3d) carry the lines; long windows (7/30/90d) come back summary-only (totals, no rows).
export function getSalesReport(params: {
  channel?: 'all' | 'shp' | 'amz';
  window?: SalesWindow;
  search?: string | null;
  limit?: number;
}) {
  return request<SalesReportData>(
    {
      url: '/analytics-sales',
      method: 'GET',
      params: {
        channel: params.channel || 'all',
        window: params.window || 'today',
        search: params.search || undefined,
        limit: params.limit,
      },
    },
    (b) => ({
      channel: (b.channel as 'all' | 'shp' | 'amz') || 'all',
      window: (b.window as SalesWindow) || 'today',
      searchActive: !!b.searchActive,
      summaryOnly: !!b.summaryOnly,
      from: b.from ?? null,
      to: b.to ?? null,
      search: b.search ?? null,
      summary: (b.summary as SalesReportSummary) || { unitsSold: 0, unitsReturned: 0, unitsNet: 0, orders: 0, revenue: 0, profit: 0, marginPct: null, products: 0 },
      rows: (b.rows as SalesReportRow[]) || [],
      limit: b.limit ?? 500,
      count: b.count ?? 0,
      truncated: !!b.truncated,
    })
  );
}

// Add a scratchpad note. Returns the newly-created note so the caller can prepend it without a re-fetch.
export function addScratchpadNote(body: string) {
  return request<ScratchpadNote>(
    { url: '/analytics-scratchpad-add', method: 'POST', data: { body } },
    (b) => b.note as ScratchpadNote
  );
}

// Delete a scratchpad note by id. `deleted` is false if it was already gone (idempotent).
export function deleteScratchpadNote(id: number) {
  return request<{ deleted: boolean }>(
    { url: '/analytics-scratchpad-delete', method: 'POST', data: { id } },
    (b) => ({ deleted: !!b.deleted })
  );
}

// =============================================================================================================================
// Inventory Management (docs/inventory-spec.md) — read-only stock lookup.
// =============================================================================================================================

// One style with its headline stock numbers, rolled up across all sizes.
//   local   = SUM(localstock.qty), ALL states — includes stock already picked for an order (it is still on the shelf).
//   onOrder = COUNT of not-yet-arrived order lines (local + Amazon).
//   total   = local + Amazon-held (live at Amazon + inbound + boxed + in transit).
export interface InvStyleRow {
  groupid: string;
  title: string | null;
  segment: string | null;
  imagename: string | null;
  local: number;
  // {size: localQty} for the sizes this style currently has in LOCAL stock (only in-stock sizes present). Powers the "Size XX"
  // filter and the per-size count it shows. Keys are the code's size suffix as stored, so they can carry a leading zero ("05") —
  // the client normalises numerically when matching, so a typed "5" still finds "05".
  localSizes: Record<string, number>;
  onOrder: number;
  total: number;
}

// The WHOLE style list in one call. Deliberately unfiltered: ~280 styles, so the Inventory screen fetches once on mount and does all
// its Contains / Does-not-contain narrowing client-side — no round-trip per FIND, and Reset is instant.
export function getInvStyles() {
  return request<{ count: number; rows: InvStyleRow[] }>(
    { url: '/inv-styles', method: 'GET' },
    (b) => ({
      count: b.count ?? 0,
      // Default localSizes to {} per row so the client never has to guard for a missing map on an older payload.
      rows: ((b.rows as InvStyleRow[]) || []).map((r) => ({ ...r, localSizes: r.localSizes || {} })),
    })
  );
}

// The twelve places a unit can be (docs/inventory-spec.md §3b, from order-status-lifecycle.docx p6/p7).
// The compact local/onOrder/total figures are DERIVED from these server-side, so the two views always reconcile.
export interface InvBuckets {
  free: number;          // HERE: unallocated, unpicked
  picked: number;        // HERE: committed to an order, still on the shelf
  amzAlloc: number;      // HERE: allocated to Amazon (in practice always the C3-Amazon bay). Reserved-vs-bay was merged 2026-07-20 —
                         // the only difference was the location, which the locations table prints anyway. STILL pickable for a
                         // Shopify customer (lifecycle doc p5) — never present it as unavailable.
  onOrderLocal: number;  // INCOMING: ordertype 2, not arrived
  onOrderAmz: number;    // INCOMING: ordertype 3, not arrived
  arrivedLocal: number;  // INCOMING: ordertype 2, arrived, not yet shelved
  arrivedAmz: number;    // INCOMING: ordertype 3, arrived (held 7 days)
  amzLive: number;       // AT AMAZON: sellable FBA stock
  amzInbound: number;    // AT AMAZON: booked in, not yet live
  boxed: number;         // AT AMAZON: in a box awaiting DPD
  transit: number;       // AT AMAZON: collected by DPD within the last 2 days
}

// One size's stock position. `total` = local + Amazon-held; `local` includes stock already picked for an order.
export interface InvSizeRow {
  code: string;
  eu: string;          // RIGHT(code,2) — drives ordering; NOT a display value (on a UK-sized brand it is the UK size)
  uksize: string | null;
  // The human-entered customer-facing label from skumap.optionsize ("38 EU / 5 UK", or just "5 UK" on a UK-sized brand). This is
  // what the grid prints. Free text, so the UI keeps a fallback — but 100% populated across the catalogue as of 2026-07-20.
  sizeDisplay: string | null;
  local: number;
  onOrder: number;
  total: number;
  buckets: InvBuckets;
  amazonTotal: number;   // The re-order figure — everything at OR heading to Amazon, incl. earmarked stock still in our building.
                         // Excludes amzshipment: boxed units are still in localstock as allocated 'amz', so they are already counted.
  demand: number;        // ordertype 1: a CLAIM on stock, not stock. Never add this into a stock figure.
  // Birkenstock pre-order book (birktracker): requested MINUS arrived, since an arrived unit is already counted in Local.
  // A separate notion of incoming from orderstatus, which knows nothing about these seasonal POs. NOT part of Total — we do not
  // have these units yet.
  birkOnOrder: number;
}

// One physical localstock row — which rack a unit is on, and what state it is in.
//   FREE         = unallocated and unpicked
//   PICKED       = committed to a customer order, but still on the shelf until packed
//   AMZ          = allocated to Amazon. Still pickable for a Shopify customer (order-status-lifecycle.docx p5) — do NOT present
//                  this as unavailable. The rack vs C3-Amazon-bay distinction lives in `location`, not in the state.
export type InvLocationState = 'FREE' | 'PICKED' | 'AMZ';

export interface InvLocationRow {
  id: string;            // stable key; phase 2 edits these rows in place
  code: string;
  eu: string;
  uksize: string | null;
  location: string | null;
  qty: number;
  ordernum: string | null;
  state: InvLocationState;
}

export interface InvStockData {
  groupid: string;
  title: string | null;
  imagename: string | null;
  handle: string | null;   // Shopify product-URL slug (brookfieldcomfort.com/products/<handle>); null when the style has no handle
  price: number | null;   // live Shopify price; null when the legacy varchar column holds junk/blank
  rrp: number | null;     // recommended retail, same caveat
  totals: {
    local: number; onOrder: number; total: number;
    amazonTotal: number; demand: number; birkOnOrder: number; buckets: InvBuckets;
  };
  sizes: InvSizeRow[];
  locations: InvLocationRow[];
}

// One style's stock position at size grain. Sizes come from skumap, so sold-out sizes are present reading 0.
export function getInvStock(groupid: string) {
  return request<InvStockData>(
    { url: '/inv-stock', method: 'GET', params: { groupid } },
    (b) => ({
      groupid: b.groupid,
      title: b.title ?? null,
      imagename: b.imagename ?? null,
      handle: b.handle ?? null,
      price: typeof b.price === 'number' ? b.price : null,
      rrp: typeof b.rrp === 'number' ? b.rrp : null,
      totals: b.totals || {
        local: 0, onOrder: 0, total: 0, amazonTotal: 0, demand: 0, birkOnOrder: 0,
        buckets: {
          free: 0, picked: 0, amzAlloc: 0,
          onOrderLocal: 0, onOrderAmz: 0, arrivedLocal: 0, arrivedAmz: 0,
          amzLive: 0, amzInbound: 0, boxed: 0, transit: 0,
        },
      },
      sizes: (b.sizes as InvSizeRow[]) || [],
      locations: (b.locations as InvLocationRow[]) || [],
    })
  );
}

// One sale line on the Inventory panel's recent-sales list. ALL channels merged (SHP / AMZ / CM3) — see routes/inv-sales.js for why
// there is no channel filter. Returns are included and flagged rather than hidden; their `profit` is normally negative.
export interface InvSaleRow {
  solddate: string | null;
  ordertime: string | null;
  channel: string | null;
  sizeDisplay: string | null;
  qty: number;
  soldprice: number | null;
  profit: number | null;
  isReturn: boolean;
}

export interface InvSalesData {
  groupid: string;
  rows: InvSaleRow[];
  limit: number;
  truncated: boolean;     // more sales exist than were returned; UI says "showing last N"
}

// Recent sales for one style. Lazily fetched — only when the operator opens the panel, so the initial stock load stays fast.
export function getInvSales(groupid: string, limit?: number) {
  return request<InvSalesData>(
    { url: '/inv-sales', method: 'GET', params: { groupid, ...(limit ? { limit } : {}) } },
    (b) => ({
      groupid: b.groupid,
      rows: (b.rows as InvSaleRow[]) || [],
      limit: Number(b.limit) || 0,
      truncated: !!b.truncated,
    })
  );
}

// =============================================================================================================================
// Order Status module — manage open supplier orders in orderstatus (local=2, amazon=3). See docs/order-status-lifecycle.docx.
// =============================================================================================================================
export interface OrderStatusSupplierRow { supplier: string; open_batches: number; open_units: number; oldest_days: number; }

export function getOrderStatusSuppliers() {
  return request<OrderStatusSupplierRow[]>(
    { url: '/order-status-suppliers', method: 'GET' },
    (b) => (b.suppliers as OrderStatusSupplierRow[]) || []
  );
}

export interface OrderStatusLine {
  ordernum: string; code: string; groupid: string | null; title: string | null; size: string;
  arrived: boolean; ponumber: string | null;
}
export interface OrderStatusBatch {
  ordertype: 2 | 3; createddate: string; days: number | null; ponumbers: string[];
  total: number; arrived: number; waiting: number; lines: OrderStatusLine[];
}

export function getOrderStatusList(supplier: string) {
  return request<OrderStatusBatch[]>(
    { url: '/order-status-list', method: 'GET', params: { supplier } },
    (b) => (b.batches as OrderStatusBatch[]) || []
  );
}

// Re-flag a set of orderstatus rows local <-> amazon (whole batch or a hand-picked subset of its lines).
export function switchOrderType(ordernums: string[], newOrderType: 2 | 3) {
  return request<{ updated: number }>(
    { url: '/order-status-switch-type', method: 'POST', data: { ordernums, newOrderType } },
    (b) => ({ updated: Number(b.updated) || 0 })
  );
}

// +/- the unit count for one SKU/size group. ordernums = every ordernum currently in that group (from OrderStatusBatch.lines);
// delta > 0 duplicates one of them (new units land in the same batch); delta < 0 archives+removes up to |delta| units, waiting
// ones first and falling back to arrived ones once waiting runs out.
export function adjustOrderStatusQty(ordernums: string[], delta: number) {
  return request<{ added: number; removed: number; qty: number; arrived: number; waiting: number }>(
    { url: '/order-status-adjust-qty', method: 'POST', data: { ordernums, delta } },
    (b) => ({
      added: Number(b.added) || 0, removed: Number(b.removed) || 0,
      qty: Number(b.qty) || 0, arrived: Number(b.arrived) || 0, waiting: Number(b.waiting) || 0,
    })
  );
}

// Archive + delete an explicit selection of orderstatus rows (whole batch or a subset), any arrival status.
export function archiveOrderStatus(ordernums: string[]) {
  return request<{ archived: number }>(
    { url: '/order-status-archive', method: 'POST', data: { ordernums } },
    (b) => ({ archived: Number(b.archived) || 0 })
  );
}

export default api;
