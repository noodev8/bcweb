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
export interface FindRow { groupid: string; title: string | null; segment: string | null; now: number | null; }
export interface ProductRow { groupid: string; title: string | null; }
export interface ProductSize { code: string; barcode: string | null; sizeDisplay: string | null; }
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
export interface ApplyData { groupid: string; new_price: string; old_price: number | null; next_review: string; warnings: string[]; }
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

export function getDrill(groupid: string, days?: number) {
  return request<DrillData>(
    { url: '/pricing-drill', method: 'GET', params: { groupid, days } },
    (b) => ({ header: b.header, timeline: b.timeline || [], sizes: b.sizes || [], days: b.days })
  );
}

export function findProducts(term: string) {
  return request<FindRow[]>({ url: '/pricing-find', method: 'GET', params: { term } }, (b) => b.results || []);
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

export function applyPrice(groupid: string, newPrice: number, reviewDays: number) {
  return request<ApplyData>(
    { url: '/pricing-apply', method: 'POST', data: { groupid, newPrice, reviewDays } },
    (b) => ({ groupid: b.groupid, new_price: b.new_price, old_price: b.old_price, next_review: b.next_review, warnings: b.warnings || [] })
  );
}

export function parkStyle(groupid: string, reviewDays: number) {
  return request<ParkData>(
    { url: '/pricing-park', method: 'POST', data: { groupid, reviewDays } },
    (b) => ({ groupid: b.groupid, next_review: b.next_review })
  );
}

export default api;
