# Brookfield Comfort — Internal Platform

A modular internal platform for Brookfield Comfort (UK footwear e-commerce). Login → dashboard of modules. **v1 ships one module: Shopify Pricing.** The shell (auth, dashboard, nav, API conventions) is reusable so future modules (Amazon pricing, inventory, orders, analytics) slot in later.

## Layout

```
bcweb-server/   Express API — owns the Postgres connection and all SQL. Runs on a VPS (PM2).
bcweb-web/      Next.js 15 (App Router, TS, Tailwind) front end. Deploys to Vercel.
docs/                API-RULES.md (house style), deploy.txt
```

The web app talks to the API over HTTP only — it never connects to Postgres directly.

## The Shopify Pricing module

The job: squeeze maximum margin from stock in hand (Birkenstock can't be restocked on demand).
Flow: **segment → triage (top sellers, 30d, in-stock, un-parked) → drill-down (price vs pace over time) → set price + required review cooldown.** Writes update the DB and set `shopifychange = 1`; an existing external nightly job pushes changed prices to Shopify (this tool never calls the Shopify API). See `CLAUDE.md` for the full domain summary, write rules, and schema landmines.

## Run locally (Windows)

```
# API (port 3020) — reads bcweb-server/.env (DB_* + JWT_SECRET)
cd bcweb-server && npm install && node scripts/seed-user.js andreas <password> Andreas && npm run dev

# Web (port 3000) — reads bcweb-web/.env (NEXT_PUBLIC_API_URL)
cd bcweb-web && npm install && npm run dev
```

Then open http://localhost:3000/login. Deployment: see `docs/deploy.txt`.

## Conventions (see docs/API-RULES.md)

- Every API response is **HTTP 200 + `return_code`** (`SUCCESS` or an error code) — never 4xx/5xx for API-level errors.
- JWT carries **only the user id**; `display_name` (→ `changed_by` on writes) is looked up per request.
- Frontend API client **never throws** on API errors — returns `{ success, data?, error?, return_code? }`.
- All writes are parameterised; the two pricing writes use a `withTransaction` wrapper.
