# Brookfield Comfort — Internal Platform (CLAUDE.md)

Guidance for Claude working in this repo. Conventions live in `docs/API-RULES.md` (authoritative). The code is stable and shipped — **read the code for how a feature works**; this file is the domain "why" and the DB landmines that aren't obvious from code. Build specs were retired once modules shipped (recoverable in git history if a big new job needs one).

## What this is

A **modular internal platform** for Brookfield Comfort (UK footwear e-commerce — mostly Birkenstock, sold on Shopify & Amazon). Login → dashboard of modules. Shipped modules: **Shopify Pricing, Amazon Pricing, Inventory, Order Status**. The shell (auth, dashboard, nav, API envelope, DB pool) is module-agnostic.

## Structure — two apps in one repo

```
bcweb-server/   Express API — owns the Postgres connection and ALL SQL. Runs on a VPS (PM2).
bcweb-web/      Next.js 15 (App Router, src/app, TS, Tailwind 3) front end. Deploys to Vercel.
docs/           API-RULES.md (authoritative conventions), deploy.txt, legacy PowerBuilder/DB reference.
```

The web app **never** connects to Postgres — only the server does. Web → HTTP (axios) → server → PostgreSQL (`brookfield_prod`, the same DB the owner's Python scripts use).

## Run locally (Windows)

```
cd bcweb-server && npm run dev   # API on :3020 — reads bcweb-server/.env (DB_* + JWT_SECRET)
cd bcweb-web    && npm run dev   # Web on :3000 — reads bcweb-web/.env (NEXT_PUBLIC_API_URL)
```
Start the API first. Seed/reset a user: `node scripts/seed-user.js <username> <password> Andreas`.
Deployment: `docs/deploy.txt` (server → VPS/PM2 rsync; web → Vercel, behind the app login).

## Domain "why" — Shopify/Amazon Pricing

**Business context:** ~95% of Shopify sales are Birkenstock, which **cannot be re-ordered on demand** (ordered ~6 months ahead; stock in hand is all there is). There is no "sold out → restock" lever — **the job is to squeeze maximum margin from stock already held.** A fast-selling style with thin stock is a **price-up / harvest** candidate, NOT a restock flag.

Work always starts from a **segment**, with a **WINNERS | LOSERS** switch:
- **WINNERS** — in-stock styles that sold recently (Shopify 30d), best sellers first; drop 0-stock and "parked" styles → price **up** / harvest.
- **LOSERS** — slow/stuck stock to price **down** (measured over 90d). Membership = DEAD (`u_win=0`) or SLOW (`cover ≥ coverWeeks`, default 26). DEAD cluster first, then SLOW; most stock first.
- **Lists are the whole qualifying set, not a top-N** (the tab count IS the job; it shrinks as cleared). `limit` survives only as a safety cap (`utils/listLimit.js`, default 100 / max 500); routes return `total` + `truncated`.
- **Drill-down** shows header + pricing timeline (one row per distinct price, with pace `/wk`) + size curve. Pace = `units / max(span_days,7)/7 weeks`, computed app-side. Size curve shows ALL sizes (0 for sold-out) as a guardrail before a cut.

**Review cooldown (`next_shopify_price_review`, a date):** while future, the style is hidden from triage. A review period is **optional** on a price change (a "None" chip leaves the review date untouched). Suggested review defaults: raise ~7d, cut ~14d, hold ~30d (suggestions, editable).

**Amazon** mirrors Shopify but at **SKU grain** (`code`, not `groupid`); reads `amzfeed` (FBA-only, **READ ONLY**) for live price/stock. **No live push** — apply only logs to `amz_price_log`; the price reaches Amazon via a client-built Seller Central upload file (rolling 12h team-wide basket, rebuilt from the log). Amazon "margin" is net (price − cost − FBA fee).

## Writes (exact — wrap each in `withTransaction`)

- **W1 — apply Shopify price** (`POST /pricing-apply`): `reviewDays` optional (integer ≥ 1, or omitted = leave review date untouched). Server-side bounds: **block `< cost`**, **allow-but-flag `> rrp`**. Atomically `UPDATE skusummary SET shopifyprice=$price_string[, next_shopify_price_review=CURRENT_DATE+$reviewDays]` + `INSERT price_change_log (groupid,'SHP',old,new,NULL,$note,changed_by)`. **Do NOT set `shopifychange`.** After commit, W1 pushes to **Shopify immediately** (`utils/shopify.js → pushIfLive`, best-effort, never rolls back the DB; on failure `shopify:{pushed:false}` and operator re-Applies — `productSet` is idempotent). **Google is DECOUPLED** — W1 does not push Google; a periodic sweep (`scripts/google-price-sweep.js`, ~every 2h) finds un-sent SHP changes (`price_change_log.google_pushed_at IS NULL`, Google-live styles) and pushes each style's current price once via in-process Node (`utils/googleMerchant.js`, `utils/googleAuth.js`). It writes a **`salePrice`-only supplemental override** (Merchant API `products/v1`) so the primary feed's `price`/RRP is preserved. Nightly `merchant_feed.py --upload` (3:30am BST) is the ultimate backstop. Add/Modify (`product-price`) still pushes Google inline.
- **W2 — park only** (`POST /pricing-park`): `UPDATE skusummary SET next_shopify_price_review=CURRENT_DATE+$reviewDays`. No price change, no log row.
- **Bulk** on WINNERS/LOSERS lists (`BulkActionBar`): a bulk price move **loops W1 per row client-side** (so each live push fires and per-item bounds apply); bulk review-only uses `/pricing-park-bulk`. Amazon bulk loops `/amz-apply` and reuses `/amz-review`.
- **W-A1 — apply Amazon price** (`POST /amz-apply`): logs to `amz_price_log` only (blocks `< cost+fbafee`, flags `> rrp`); optional `reviewDays` parks via `next_amz_price_review`. Never writes `amzfeed`.

## Schema landmines (legacy DB — respect these)

- **Price columns on `skusummary` (`shopifyprice`, `cost`, `rrp`, `minshopifyprice`, `maxshopifyprice`) are `character varying`, not numbers** and can hold junk (e.g. `maxshopifyprice='RRP'`). Read via `utils/sql.js → safeNumeric(col)` (NULL on non-numeric), never a bare `::numeric` (throws). **Write `shopifyprice` as a 2dp STRING** (e.g. `'36.95'`).
- **Never read stock from `skusummary.stockvariants`/`variants`** (stale). Current sellable stock = `localstock` where `ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0`. `localstock` holds in-stock rows only — for the full size range use **`skumap`** (one row per variant), LEFT JOIN sellable stock, default 0.
- **Size = `RIGHT(code,2)`** (EU size, by design).
- **`skusummary.colour` is an overloaded segmentation tag** (ambiguous). Use `title.shopifytitle` for a human name.
- **Dates:** legacy `created`/`updated` are TEXT (`'YYYYMMDD HH24:MI:SS'`, Europe/London). Prefer the newer `created_at timestamptz` / `changed_at timestamptz` for real date logic but keep writing the legacy text stamps too. Never hand a pg `DATE` to `toISOString()` (parsed as local midnight → BST shifts the day back one); cast to text in SQL.
- **Order Status:** `orderstatus.orderdate` is `character varying`; an un-placed row is `''` **or NULL** — always test `COALESCE(orderdate,'')=''`. `orderstatus` has **one row per physical unit** (`qty` always 1); quantities are `COUNT(*)`, +/− means insert/archive whole rows. Order cost = `skusummary.cost` via `safeNumeric`, never `skumap.cost` (blank/placeholder on many rows). Barcode = `skumap.ean` with the trailing `B` stripped. The module is two stages split on the `orderdate` marker: TO PLACE (`orderdate=''`, chosen, not yet bought) → ON ORDER (`orderdate<>''`, with the supplier). `utils/orderStatus.js` owns the predicates. Scope = supplier orders only (`ordertype` 2 local, 3 Amazon); customer orders (`ordertype=1`) never touched.

## Conventions (full detail in docs/API-RULES.md)

- **Every API response is HTTP 200 + a `return_code`** (`SUCCESS` or an error code). **Never** 4xx/5xx for API-level errors.
- **One route file per endpoint** in `routes/` (kebab verb-noun), structured header block, heavily commented (explain *why*). `utils/apiLogger.js` logs every route.
- **JWT carries only `{ id }`.** `middleware/verifyToken.js` → `req.user = { id, display_name }`. `changed_by` is resolved server-side, never sent by the client.
- **DB:** central pool in `database.js`; `utils/transaction.js → withTransaction` for writes; parameterised queries only; no N+1.
- **Frontend client (`src/lib/api.ts`) never throws on API-level errors** — returns `{ success, data?, error?, return_code? }`; only network failures throw. Auth in `src/contexts/AuthContext.tsx`.
- **No hard-coded secrets** — everything via `.env`; flag if a new var is needed.

## Working notes

- The API points at the **LIVE production DB.** Reads are safe; writes touch real product rows. When testing writes, wrap in a manual `BEGIN … ROLLBACK` unless the owner OKs a live apply-and-restore.
- Single `.gitignore` at repo root.
- Don't invent pricing logic — the domain notes above and the code are the source of truth.
