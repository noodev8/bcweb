# Segments — Working Spec (DRAFT)

> Design spec for the **Segment management** layer: a review/attention system that sits *on top of* the
> existing pricing tools and answers the operator's real daily question — *"of my ~29 segments, which one
> do I click and work on right now?"* Same "throw away when done" scratch-spec style as `add-modify-spec.md`.
> **Nothing here is built yet** — this captures the agreed model so it doesn't evaporate.

---

## 0. STATUS & NEXT UP  (read this first)

**Where we are:** **steps 1–5 (the whole backend) are DONE** (2026-07-09). Four tables live on prod: `segment` (29 active),
`area` (Shopify/Amazon/Remove, sort 1/2/3, default cadence 30/30/91d), `segment_area_state` (87 clocks = 29×3), and
`segment_worklog`. Six endpoints built, wired in server.js, verified over HTTP (dev user):
reads `GET /segments` + `GET /segment?name=`; writes `POST /segment-work` (log + optional review) and `POST /segment-rename`
(rewrite skusummary.segment + registry name atomically). Rename's carry-across (clocks + worklog survive because the id is stable)
proven via BEGIN..ROLLBACK; all error/guard paths checked over HTTP; all test data cleaned (worklog + review dates back to empty).
**WEB/UI DONE** (2026-07-09): heatmap overview `/segments` (Segment×Area grid, importance gutter, Revenue/Most-overdue sort,
"Only what's due" filter, coloured clickable cells; Shopify cell → `/pricing/[segment]`, others + name → detail) and detail
`/segments/[name]` (header stats, per-area clocks with a "Mark worked" form = optional note + review pills None/1w/2w/1m/2m/3m/6m,
work-log history, rename control). New: `src/lib/segmentUi.ts` (tones/labels/chips/sort), `src/lib/api.ts` (4 client fns + types),
dashboard "Segments" tile. Typechecks + lints clean; all three routes compile + serve 200 in Next dev. NOT visually click-tested
(Chrome extension wasn't connected) and NOT yet committed at time of writing / not deployed.

**Next up: nothing required — module is feature-complete.** Optional follow-ups: (a) deploy server to VPS + web to Vercel; (b) heat
🔥 fast-follow (spec §7); (c) the pricing-apply→segment auto-log tie-in (spec §6-D, still not wired — working Shopify via triage
does not yet advance the segment's Shopify clock; for now use "Mark worked").

**Steps 1–4 committed** (`79d723c`). **Step 5 not yet committed; nothing deployed to VPS.** Step-5 files: `routes/segment-work.js`,
`routes/segment-rename.js`, `server.js` (two more mounts). Earlier files: `routes/segments.js`, `routes/segment.js`,
`utils/segmentReconcile.js`, `utils/segmentDue.js` (shared AMBER_DAYS/classify/isoDate — isoDate avoids a BST UTC day-shift on DATE
columns), `scripts/setup-segments.js`.

**Prod/deploy note:** all four tables were created directly on the prod DB from local (creds point at prod). The VPS server
deploy doesn't create them — they exist. If the DB is ever rebuilt, re-run `node scripts/setup-segments.js` (idempotent).
**But the new route files + server.js mounts DO need deploying to the VPS** for `/segments` + `/segment` to answer in production.

Files added by step 1: `utils/segmentReconcile.js` (the reconcile, reusable by the future `GET /segments`),
`scripts/setup-segments.js` (idempotent DDL + first reconcile; `--dry-run` proves it against live data without persisting).

**Build order (suggested):**
1. ✅ **Registry + reconcile** — the `segment` table + a reconcile step that mirrors it from the DISTINCT list (§4, §6-A). *Done, live on prod.*
2. ✅ **Areas + clocks** — the `area` table (seeded Shopify / Amazon / Remove) and `segment_area_state` (cadence + next_review); reconcile seeds a clock per active segment×area (§4, §6-A). *Done, live on prod.*
3. ✅ **Overview read** — `GET /segments` returning the heatmap grid (rev/GP + per-area due state + last-worked), reconcile-first (§5). Also created `segment_worklog` (empty). *Done; server code needs VPS deploy.*
4. ✅ **Detail read** — `GET /segment?name=` (header stats incl. stock/styles + per-area clocks + lazy work-log history), plus shared `utils/segmentDue.js` (§5). *Done; server code needs VPS deploy.*
5. ✅ **Writes** — `POST /segment-work` (log + optional review, own tables) and `POST /segment-rename` (skusummary + registry, atomic, id-stable so history carries across) (§6). *Done; server code needs VPS deploy.*
6. **Fast-follow — heat** — the 🔥 velocity signal once the structure is proven (§3, deliberately deferred).

**Deploy (reminder, no action now):** web (Vercel) and server (VPS/PM2) deploy separately; the server step
is manual (`docs/deploy.txt`). New tables → run the DDL on the prod DB as part of the server deploy.

---

## 1. Purpose & the "why"

The operator splits the whole catalogue into segments — **each product sits in exactly one segment**
(`skusummary.segment`). Segment names *and* membership are **fluid**: products get reassigned, segments get
renamed, at any time. The strategy behind a segment is the human's (style, best-sellers, seasonal grouping…),
not something the app decides.

Work on a segment currently splits into three **areas**: **Shopify price**, **Amazon price**, and
**product range management** (remove losers from the catalogue). Today the operator keeps a Google Sheet:
segment name, revenue, gross profit, and a bare date per area. It never came naturally — because a bare date
means nothing on its own (3 months old is fine for *Accessories*, alarming for *IVES-WHITE*). Staring at 29
flat names with no signal, "which do I click?" has no answer.

**What this layer adds:** each area of each segment becomes a **review clock** — the same
`next_shopify_price_review` pattern already used per-product, lifted to the segment. A clock = **cadence**
(how often this area *should* be looked at) + **last-worked** (from a work-log). Due-ness = last-worked +
cadence, measured against the segment's own expected rhythm. That, weighted by importance (revenue), answers
the daily question and — via the log — also answers *who worked it, how often, how stale, what's hot.*

Two questions the old single date conflated, now separated:
- **Priority** — how much a segment *matters* (revenue / GP) and whether it's *hot* (sales velocity). 
- **Freshness** — how *overdue* an area is (last-worked vs cadence).

Out of scope (v1): changing how products get *assigned* to segments (still done in the DB / owner's tools),
bulk cross-segment edits, and the actual Amazon-price and Remove *work screens* (this layer routes to them /
logs them; the Shopify one already exists as triage).

## 2. Design decisions (all AGREED)

1. **Segment identity = a thin auto-synced registry.** Membership stays in `skusummary.segment` (unchanged —
   Python scripts unaffected). A `segment` table holds the stable `id` that cadence, clocks, and the log hang
   off. It **reconciles itself** against the DISTINCT list: new name in skusummary → auto-insert with default
   cadence; name gone from skusummary → mark `active=false` (never delete — keep history). This retires the
   manual Google-Sheet list.
2. **Rename is a first-class tool action, not a sheet edit.** A rename *already* has to rewrite every product's
   `segment` value in skusummary, so the tool owns it — and because it does, it carries the `id`'s cadence +
   log across. Renaming outside the tool (raw SQL / sheet) would orphan history; the tool path is the supported
   one. (Pure name-keying without a registry was rejected for exactly this reason.)
3. **Areas are data, not columns.** An `area` table (seeded Shopify / Amazon / Remove) — because the set of
   areas will change as the business progresses. Clocks live in `segment_area_state` keyed by
   `(segment_id, area_id)`. Adding a 4th area later = one new `area` row; every segment instantly gets a due
   badge for it (never-worked reads as overdue/unset). **No schema change, no backfill.**
4. **Cadence uses the same pills / spans as the pricing review** (weekly / monthly / quarterly / 6-monthly, etc.
   — mirror the existing review-period chips exactly). One pill chosen **for the segment defaults all its areas**
   to that cadence (set-one-get-three); an individual area can be **overridden** later. So cadence is stored
   per `(segment, area)` but seeded from a single segment-level choice.
5. **Rev / GP / heat are computed live** from sales grouped by segment — never stored, never hand-maintained.
   **Heat is a fast-follow** (§3), not v1: the structure ships with rev/GP + due badges first.
6. **The overview is a Segment × Area heatmap with an importance gutter** (§3), not a flat list. Existing
   triage/pricing screens sit underneath **unchanged** — a Shopify cell routes into them via `?segment=`.

## 3. The screen (AGREED — heatmap + importance gutter)

The segment overview is the **front door** to the pricing/work area (replaces landing on 29 flat names).
Segments down the side, areas across the top, each cell coloured by that clock's due state:

```
                        SHOPIFY   AMAZON   REMOVE
IVES-WHITE  £4.2k 41% 🔥 [ 4d! ]  [ 1d  ]  [  ok ]
ARIZONA     £9.9k 38%    [ 2d! ]  [ ok  ]  [ 6w! ]
MANDAL      £3.1k 44%    [ ok  ]  [ 5d! ]  [ 2d  ]
ACCESSORIES £1.1k 52%    [ ok  ]  [ ok  ]  [ ok  ]
```

- **Importance gutter (left):** Rev(30d) · GP% · heat, beside each segment — computed live. Rows **sort by
  importance (or by worst-overdue)** so high-value red floats to the top; the eye lands on "click me first"
  even though it's a grid, not a worklist.
- **Cells carry a number, not just colour:** days-overdue (or "ok") inside the cell, colour reinforcing —
  reads for the colour-blind and shows *how* overdue at a glance. Green ok / amber due-soon / red overdue /
  grey never-worked. Hover or click reveals who last worked it and when.
- **Two click targets:**
  - **A cell** → that area's work for that segment. Shopify cell → the **existing triage screen** filtered
    `?segment=` (loop closes: applying a price there auto-advances that cell's Shopify clock — §6). Amazon /
    Remove cells → their work screens when they exist; until then → the segment detail (log there manually).
  - **The segment name** → **segment detail** (§ below).
- **Toggles for a 29-row grid:** *hide all-green rows* (show only what's due), and sort *by revenue* vs
  *by most-overdue*.

**Segment detail** (click the name): header (rev / GP / stock / heat) + the three **area clocks**, each with
its cadence pill, next-review date, and its **work-log history** (who · when · note) — the attention history
made visible. Actions here: **Mark worked + set review** per area (§6), change a cadence pill, and **Rename**.

**Heat (fast-follow):** 🔥 = sales velocity, computed — proposed measure: 30d units (or revenue) vs the prior
30d, flag a meaningful jump. Deferred because it needs data tuning and must not hold up the structure. **Open:
confirm exact metric & threshold when built.**

## 4. Data model (NEW tables — DDL to run on prod)

Membership source of truth stays `skusummary.segment` (`character varying`, ~29 distinct, may be renamed).
Four small new objects:

| Table | Grain | Columns |
|-------|-------|---------|
| `segment` | 1 / segment | `id` PK, `name` (unique, = the skusummary.segment string), `active` bool, `created_at timestamptz default now()` |
| `area` | 1 / work area | `id` PK, `name` (Shopify / Amazon / Remove …), `default_cadence_days` int, `sort` int, `active` bool |
| `segment_area_state` | 1 / (segment, area) | `segment_id` FK, `area_id` FK, `cadence_days` int, `next_review_date` date NULL, PK `(segment_id, area_id)` |
| `segment_worklog` | 1 / work event | `id` PK, `segment_id` FK, `area_id` FK, `worked_by` text (display name, resolved server-side), `worked_at timestamptz default now()`, `note` text |

Notes / landmines:
- **`skusummary.segment` is `character varying(20)`** — so a segment name can be at most 20 chars. `segment-rename` rejects a longer
  `newName` up front (`NAME_TOO_LONG`) rather than letting the UPDATE throw mid-transaction. `segment.name` is TEXT but effectively
  capped at 20 by this. (Discovered when a 21-char test name overflowed.)
- **`segment.name` mirrors the DISTINCT list** — the reconcile step (§6-A) is the only thing that inserts/
  deactivates rows; don't hand-edit. Case/whitespace of the string must match skusummary exactly (it's the join key back to membership).
- **Cadence is per `(segment, area)`** but seeded from `area.default_cadence_days` and/or the segment's chosen
  pill (§2.4). Cadence values are **days** so they map cleanly to the pricing pills (7 / 30 / 91 / 182 …).
- **`next_review_date NULL` = never worked** → renders grey/overdue. "Mark worked" sets it to
  `CURRENT_DATE + cadence_days` (same arithmetic as `next_shopify_price_review`).
- **Due state** (computed at read time): `NULL` → never; `< CURRENT_DATE` → overdue (red, days = today − date);
  within a soon-window of CURRENT_DATE → amber; else green. Days-overdue shown in the cell.
- **Never delete** a `segment` row on reconcile — deactivate, so worklog history survives a segment that
  emptied out or got renamed away.
- Rev / GP / heat are **not** columns here — computed live by joining sales to `skusummary` grouped by segment
  (reuse the sales logic the pricing triage/losers already use; group by segment instead of style).

## 5. Endpoints (planned — CLAUDE.md envelope: HTTP 200 + return_code, one file per endpoint, verifyToken)

- `GET  /segments` — the overview grid. Runs reconcile first (§6-A), then returns one row per **active** segment:
  `{ name, revenue30, gpPct, heat?, areas: [{ area, dueState, daysOverdue, nextReview, lastWorkedBy, lastWorkedAt }] }`.
  Rev/GP computed live; `areas` ordered by `area.sort`.
- `GET  /segment?name=` — detail for one segment: header stats + per-area clock + recent worklog rows
  (most-recent-N, lazy — mirror `pricing-history`).
- `POST /segment-work {name, area, reviewDays?, note?}` — **W-seg-1.** In one `withTransaction`: INSERT a
  `segment_worklog` row (`worked_by` = `req.user.display_name`, resolved server-side, **never** from client);
  if `reviewDays` given, UPDATE `segment_area_state.next_review_date = CURRENT_DATE + reviewDays` (optional /
  "None" chip = leave clock untouched, mirroring W1). Creates the `segment_area_state` row if absent.
- `POST /segment-rename {oldName, newName}` — **W-seg-2.** In one `withTransaction`: `UPDATE skusummary SET
  segment=newName WHERE segment=oldName` (the membership rewrite) **and** `UPDATE segment SET name=newName
  WHERE name=oldName` — so cadence, clocks, and worklog (all keyed on `segment.id`) carry across. Reject if
  `newName` already exists as an active segment (would merge — out of scope / separate action).
- `POST /segment-cadence {name, area?, cadenceDays}` — set cadence for one area, or (no `area`) default all of
  the segment's areas to `cadenceDays`. (Could fold into `segment-work`; kept separate for clarity.)

**Reuse:** the Shopify cell just deep-links to the existing `/pricing?segment=` flow — no new work screen.

## 6. Writes & the reconcile (must be exact)

**A. Reconcile (idempotent, run at the top of `GET /segments`):**
- `INSERT INTO segment(name, active) SELECT DISTINCT segment, true FROM skusummary WHERE segment IS NOT NULL
  AND segment <> '' ON CONFLICT (name) DO UPDATE SET active=true` — new names appear, previously-emptied names
  that came back re-activate.
- `UPDATE segment SET active=false WHERE name NOT IN (SELECT DISTINCT segment FROM skusummary WHERE …)` —
  names no longer present go inactive (kept for history).
- Ensure a `segment_area_state` row per `(active segment × active area)` with cadence seeded from
  `area.default_cadence_days` and `next_review_date = NULL`.

**B. `POST /segment-work` (W-seg-1)** — log + optional review, single transaction (see §5). `worked_by`
server-resolved. `reviewDays` optional integer `>= 1`; omitted = clock untouched.

**C. `POST /segment-rename` (W-seg-2)** — membership rewrite + registry rename, single transaction (see §5).
This is the *only* supported rename path; doing it in the sheet/SQL orphans the clocks + log.

**D. Auto-log from real work (tie-in):** when a Shopify price is applied via `pricing-apply` (W1) for a style,
also stamp that style's segment's **Shopify** area as worked (advance its clock). So the clock moves from
*doing the work*, and "Mark worked" is only needed for areas without their own write yet (Amazon, Remove).
**Open:** decide whether W1 advances the Shopify clock unconditionally or only sets last-worked (no review
bump). Lean: set last-worked always; leave `next_review_date` to the operator's explicit review choice.

## 7. Open decisions (resolve when building the relevant piece)

- **Heat metric & threshold** (§3) — exact formula (30d vs prior-30d units? revenue? % jump?) and what counts
  as 🔥. Deferred with the heat fast-follow.
- **Auto-log review bump** (§6-D) — does applying a Shopify price advance the review date, or only last-worked?
- **Cadence pill spans** — confirm the exact set/values reused from the pricing review chips (map to days).
- **"Due-soon" (amber) window** — RESOLVED for v1: fixed **AMBER_DAYS = 3** (const in `routes/segments.js`). Revisit if a
  proportional-to-cadence window feels better (3 days is half a weekly cadence but trivial against 6-monthly).
- **Rev/GP channel scope** — RESOLVED: **all channels** (SHP + AMZ + CM3), not Shopify-only, so the importance gutter reflects a
  segment's total worth (~46% of units are Amazon; Amazon is one of the three areas). Computed live in `GET /segments`.
- **Merge / split segments** — renaming to an existing name (merge) and splitting one segment are explicitly
  *not* in v1; note if/when they're needed.
- **Remove / Amazon work screens** — this layer routes to and logs them; the screens themselves are separate
  modules (not built). Until they exist, those cells route to the segment detail for a manual "Mark worked".

## 8. Testing note

Same rule as the rest of the platform: the API points at the **LIVE prod DB**. New tables are additive (safe),
but `segment-rename` and the reconcile **write real `skusummary` rows** — exercise writes via a throwaway
script inside `BEGIN..ROLLBACK` (per CLAUDE.md), never commit a test rename to a real segment unless the owner
OKs an apply-and-restore. Reconcile is idempotent — safe to re-run — but verify the deactivate clause can't
false-positive on a transient empty read.
