# Brookfield Comfort — Internal Platform (CLAUDE.md)

Guidance for Claude working in this repo. This file is the summary of record; `docs/API-RULES.md` holds the full API/client conventions. (The original build spec, `FRONTEND_SPEC.md`, has been retired — its essential domain knowledge and landmines are captured here.)

## What this is

A **modular internal platform** for Brookfield Comfort (UK footwear e-commerce — mostly Birkenstock, sold on Shopify & Amazon). Login → dashboard of modules. **v1 ships ONE module: "Shopify Pricing".** Architect for more modules (Amazon pricing, inventory, orders, analytics — shown as "coming soon" tiles) but **only build Shopify Pricing** unless asked. The shell (auth, dashboard, nav, API envelope, DB pool) is deliberately module-agnostic.

## Structure — two apps in one repo

```
bcweb-server/   Express API — owns the Postgres connection and ALL SQL. Runs on a VPS (PM2).
bcweb-web/      Next.js 15 (App Router, src/app, TS, Tailwind 3) front end. Deploys to Vercel.
docs/                API-RULES.md (conventions, authoritative), deploy.txt
```

The web app **never** connects to Postgres — only the server does. Web → HTTP (axios) → server → PostgreSQL (`brookfield_prod`, the same DB the owner's Python scripts use).

## Run locally (Windows)

```
# API on :3020 — reads bcweb-server/.env (DB_* + JWT_SECRET)
cd bcweb-server && npm run dev
# Web on :3000 — reads bcweb-web/.env (NEXT_PUBLIC_API_URL)
cd bcweb-web && npm run dev
```
Start the API first. Seed/reset a user: `node scripts/seed-user.js <username> <password> Andreas`.
Deployment: `docs/deploy.txt` (server → VPS/PM2 rsync; web → Vercel, public URL behind the app login).

## The Shopify Pricing domain (the important "why")

**Business context:** ~95% of Shopify sales are Birkenstock, which **cannot be re-ordered on demand** (ordered ~6 months ahead; stock in hand is all there is). So there is no "sold out → restock" lever — **the job is to squeeze maximum margin from stock already held.** A fast-selling style with thin stock is a **price-up / harvest** candidate (it'll sell through anyway; a low price just donates margin), NOT a restock flag.

**Process (always starts from a segment).** The segment page has a prominent **WINNERS | LOSERS** switch — two opposite jobs:
1. **Triage / WINNERS (shortlist):** top ~10 in-stock styles by units sold in the last 30 days on Shopify. Drop 0-stock styles (nothing to price; can't restock) and top the list back up; drop "parked" styles (a future `next_shopify_price_review`). Shopify only, positive sales only. → price **up** / harvest.
1b. **LOSERS:** the mirror — slow / stuck stock to price **down** ("cut to get it moving", might become a winner). Candidates = in stock, un-parked, SHP. Measure over **90 days** (a longer lens than winners' 30d, so a slow-but-alive style isn't mistaken for dead). `cover = weeks-to-clear = stock × (days/7) / u_win`. Membership = **DEAD** (`u_win = 0`) OR **SLOW** (`cover ≥ coverWeeks`, default 26 ≈ 6 months — the gate that keeps healthy sellers off the list). Order: **DEAD cluster first** (flagged "no recent sales"), then SLOW; within each, **most stock first** (stock at risk). Seasonality is the human's segment choice (not filtered here); size-residue is left in and parked with a long review. Route: `pricing-losers.js`.
2. **Drill-down (decide):** header (price/rrp/cost/stock/margin) + a **pricing timeline** (one row per distinct price sold at, oldest first, with units AND **pace = /wk**) + a collapsible **size curve**.
   - **Pace matters** because total units mislead across periods of different length. `per_wk = units / weeks`, `weeks = max(span_days, 7)/7`, `span_days = last_sale − first_sale` for that price. Floor at 1 week so a tiny era doesn't show a wild number. Computed **app-side**.
   - **Honest caveat:** for seasonal Birkenstock, units rising as price rose can be the season arriving, not the price working. The clean signal for going higher is a price step where **pace held**.
   - **Size curve** is a guardrail before a **cut** (don't misread a sold-out core, e.g. 38/39 gone, as dead demand). Show ALL sizes with 0 for sold-out.
3. **Set price + review:** user sets a new price AND a review period together. Suggested defaults by move: raise ~7d, cut ~14d, hold ~30d (suggest, let them change).

**Review cooldown (`next_shopify_price_review`, a date):** while it's a future date the style is hidden from triage. A review period is **optional** on a price change (owner decision — a "None" chip, mirroring the Add/Modify price editor): pick a period to park the style, or None to leave the review date untouched. `changed_by` = the logged-in user's display name. `reason_code` is left NULL; `reason_notes` carries an **optional** free-text note from the operator (blank if none).

## Writes (must be exact — wrap each in `withTransaction`)

- **W1 — apply price:** `reviewDays` is **optional** (if supplied must be an integer `>= 1`; omitted/None = leave the review date untouched). Bounds (server-side, never trust client): **block** `< cost`; **allow-but-flag** `> rrp`. (The `minshopifyprice`/`maxshopifyprice` bounds were removed per owner — unused.) Then, atomically: `UPDATE skusummary SET shopifyprice=$price_string[, next_shopify_price_review=CURRENT_DATE+$reviewDays]` (the review clause only when a period was given) **and** `INSERT price_change_log (groupid,'SHP',old,new,NULL,$note,changed_by)` (`$note` = optional operator note, else ''). **Do NOT set `shopifychange`** — after the transaction commits, W1 pushes the new price to Shopify **immediately** via the Admin API (`utils/shopify.js → pushIfLive`, same as the Add/Modify module). Setting the nightly-sync flag too would double-push. The push is best-effort (never rolls back the DB write); on failure the response carries `shopify:{pushed:false,…}` and the operator re-Applies (`productSet` is idempotent). No nightly fallback (owner decision: "pure direct push"). **Same for Google:** right after the Shopify push, W1 also pushes the new price to Google Merchant Center's Content API (`utils/googleMerchant.js → pushIfLive`, shelling out to `scripts/google-price-push/push_google_price.py` — same "reuse the Python auth path" pattern as the Amazon-upload helper). Otherwise Google Shopping/ads would show the old price until the next nightly `C:\scripts\merchant-feed\merchant_feed.py --upload` cron run (that script only regenerates + re-uploads the feed once a day, at 3:30am BST). Only fires when the style is live on Google (`skusummary.googlestatus=1 AND shopify=1`); best-effort, never rolls back the DB write; failure surfaces as `google:{pushed:false,…}` and the operator re-Applies. A groupid can map to several Google product ids (one `skumap.googleid` per size) — the helper loops over all of them.
- **W2 — park only:** `UPDATE skusummary SET next_shopify_price_review=CURRENT_DATE+$reviewDays`. No price change, no log row, `shopifychange` untouched.

## Schema landmines (legacy DB — respect these)

- **Price columns on `skusummary` (`shopifyprice`, `cost`, `rrp`, `minshopifyprice`, `maxshopifyprice`) are `character varying`, not numbers**, and can contain junk (real case: `maxshopifyprice='RRP'` in 37 rows). Read them via `utils/sql.js → safeNumeric(col)` (returns NULL on non-numeric), never a bare `::numeric` (it throws). **Write `shopifyprice` as a 2dp STRING** (e.g. `'36.95'`), rounded to 2dp.
- **Never read stock from `skusummary.stockvariants` / `variants`** (stale, can be a year old). Current sellable stock = `localstock` where `ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0`.
- **`localstock` holds in-stock rows only** — a sold-out size has no row. For the full size range use **`skumap`** (one row per variant; size = `RIGHT(code,2)`), LEFT JOIN the sellable stock, default 0.
- **Size = `RIGHT(code,2)`** (EU size, by design).
- **`skusummary.colour` is an overloaded segmentation tag** (e.g. "Mocha" filed under "Brown") — ambiguous. Use `title.shopifytitle` for a human-readable name.
- **Dates:** legacy `created`/`updated` on `skusummary` (and `updated` on other tables) are TEXT (`'YYYYMMDD HH24:MI:SS'`, Europe/London). A proper **`skusummary.created_at timestamptz DEFAULT now()`** was added for going-forward use — new inserts get it; the 272 pre-existing rows are NULL (not backfilled). Prefer `created_at` for real date logic; keep writing the legacy text stamps too for compatibility.

## Conventions (full detail in docs/API-RULES.md)

- **Every API response is HTTP 200 + a `return_code`** (`SUCCESS` or an error code like `MISSING_FIELDS`, `NOT_FOUND`, `UNAUTHORIZED`, `SERVER_ERROR`). **Never** 4xx/5xx for API-level errors. Success adds data fields; errors add `message`.
- **One route file per endpoint** in `routes/` (kebab verb-noun), each starting with a structured header block and heavily commented (explain *why*). `utils/apiLogger.js` logs every route.
- **JWT carries only `{ id }`.** `middleware/verifyToken.js` looks the user up per request → `req.user = { id, display_name }`. `changed_by` is always resolved server-side, never sent by the client. JWT config in `config/config.js`.
- **DB:** central pool in `database.js` (`const { query } = require('../database')`); `utils/transaction.js` `withTransaction` for W1/W2; parameterised queries only (no string interpolation of user input); no N+1.
- **Frontend API client (`src/lib/api.ts`) never throws on API-level errors** — returns `{ success, data?, error?, return_code? }`; only genuine network failures throw. Auth state in `src/contexts/AuthContext.tsx`.
- **No hard-coded secrets** — everything via `.env`; flag if a new var is needed.

## Endpoints

`POST /login` · `GET /pricing-segments` · `GET /pricing-triage?segment&days?&limit?` (WINNERS) · `GET /pricing-losers?segment&days?&limit?&coverWeeks?` (LOSERS) · `GET /pricing-drill?groupid&days?` · `GET /pricing-history?groupid&limit?` (drill report: recent price-change log, most-recent-N, lazy) · `GET /pricing-sales?groupid&limit?` (drill report: recent raw sales w/ sold price, most-recent-N, lazy) · `GET /pricing-find?term` · `POST /pricing-apply {groupid,newPrice,reviewDays}` (W1) · `POST /pricing-park {groupid,reviewDays}` (W2) · `GET /health`. All except login/health require `verifyToken`.

## Working notes / cautions

- The API points at the **LIVE production DB**. Reads are safe; **W1/W2 write real product rows.** When testing writes, wrap in a manual `BEGIN … ROLLBACK` rather than committing to a real style, unless the owner OKs a live apply-and-restore.
- Git is not initialised yet (owner's choice). Single `.gitignore` at repo root.
- Don't invent pricing logic — the process above is the source of truth. Out of scope for v1: Shopify API calls, Amazon/other channels, bulk edits, other modules.
