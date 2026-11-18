# API Rules

The conventions for all API work in BCWEB. Short on purpose — for a worked example, copy an existing route (`bcweb-server/routes/pricing-park.js` for a write, `routes/login.js` for auth) and the client (`bcweb-web/src/lib/api.ts`, whose header restates the client rules).

## Backend

- **Always HTTP 200 + a `return_code`.** `SUCCESS` or a descriptive, machine-readable error code; optional `message`. Never 4xx/5xx for API-level errors. Exception: an endpoint called by an outside service answers in that service's format (e.g. `routes/ebay-account-deletion.js` returns eBay's `{ challengeResponse }`).
- **Common codes:** `SUCCESS`, `MISSING_FIELDS`, `INVALID_*` (e.g. `INVALID_PRICE`), `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `SERVER_ERROR`. A route may add its own (`STALE`, `TOO_MANY`, …) — list every one in its header.
- **Validate every field server-side** — never trust the client. Missing → `MISSING_FIELDS`, bad value → `INVALID_*`, before anything is written.
- **One route file per endpoint** in `routes/` (kebab verb-noun), logged via `utils/apiLogger.js`.
- **Every route file has the structured header block:** API Route · Method · Purpose (the WHY, owner decisions with dates) · Request Payload · Success Response (fields commented) · Return Codes. Utils marked "THE copy" carry the same style of header — it is where a rule is documented. **Update the header in the same change as the code.**
- **Comments explain WHY, not just what.** Comment each major section of logic.

## Authentication

- JWT, config in `bcweb-server/config/config.js`. The token carries **only the user id**; look everything else up in the DB.
- One `verifyToken` in `middleware/verifyToken.js` — never a second copy.

## Frontend client

- **Client functions never throw on a non-SUCCESS `return_code`** — they return `{ success, data?, error?, return_code? }` and the caller decides what to show (toast, inline message, redirect). Only genuine network failures throw.

## Database

- Direct PostgreSQL, no ORM. Central pool in `bcweb-server/database.js`.
- Writes through `utils/transaction.js → withTransaction`. Parameterised queries only. **No N+1** — JOINs or set-based batches.
- The schema is the live DB (legacy; landmines in CLAUDE.md) — read it with `information_schema` or the migration headers in `bcweb-server/migrations/`.

## Secrets

- Never hard-code a password, key or token. Everything via `.env` (`bcweb-server/.env`, `bcweb-web/.env`) — say so when a new variable is needed.
