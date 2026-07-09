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
export interface TriageRow { rank: number; groupid: string; title: string | null; units: number; stock: number; }
export interface LoserRow {
  rank: number; groupid: string; title: string | null;
  stock: number; u30: number; u90: number;
  cover_weeks: number | null;   // weeks-to-clear at 90d pace; null when dead (no sales in window)
  is_dead: boolean;             // true = 0 sales in the window
}
// ALL: the whole segment, unfiltered, most-recently-changed first. last_change/next_review are YYYY-MM-DD or null.
export interface AllRow {
  groupid: string; title: string | null; price: number | null; stock: number;
  last_change: string | null; next_review: string | null;
}
export interface DrillHeader {
  groupid: string; title: string | null;
  now: number | null; cost: number | null; rrp: number | null; minp: number | null; maxp: number | null;
  margin: number | null; margin_pct: number | null;
  stock: number; colour: string | null; width: string | null; season: string | null;
  next_review: string | null;
}
export interface TimelineRow {
  price: number; units: number; first_at: string | null; last_at: string | null;
  span_days: number; weeks: number; per_wk: number; is_current: boolean;
}
export interface SizeRow { size: string; qty: number; }
export interface DrillData { header: DrillHeader; timeline: TimelineRow[]; sizes: SizeRow[]; days: number; }
// Drill reports (lazy — fetched only when their section is opened). Both bounded by most-recent-N rows; `truncated` = more exist.
export interface PriceHistoryRow { change_date: string | null; old_price: number | null; new_price: number | null; note: string; changed_by: string | null; }
export interface PriceHistoryData { rows: PriceHistoryRow[]; limit: number; truncated: boolean; }
export interface SaleRow { solddate: string | null; ordertime: string | null; size: string | null; qty: number; soldprice: number | null; }
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
export interface ProductDetail {
  groupid: string;
  brand: string | null; colour: string | null; segment: string | null; season: string | null;
  width: string | null; material: string | null; gender: string | null; producttype: string | null;
  imagename: string | null;
  title: string | null;
  cost: number | null; rrp: number | null; price: number | null;
  tax: boolean; shopify: boolean;
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

export function getDrill(groupid: string, days?: number) {
  return request<DrillData>(
    { url: '/pricing-drill', method: 'GET', params: { groupid, days } },
    (b) => ({ header: b.header, timeline: b.timeline || [], sizes: b.sizes || [], days: b.days })
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

// =============================================================================================================================
// Segments module — the review/attention layer over the pricing tools (docs/segments-spec.md).
// =============================================================================================================================
export type DueState = 'never' | 'overdue' | 'due-soon' | 'ok' | 'off';

// One clock cell = one work area (Shopify / Amazon / Remove …) of one segment. Shared by the overview grid and the detail page.
export interface SegmentAreaCell {
  area: string;
  cadenceDays: number;
  dueState: DueState;
  daysOverdue: number;            // >0 only when overdue; 0 otherwise
  nextReview: string | null;      // YYYY-MM-DD, or null when never worked / no review set
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

export default api;
