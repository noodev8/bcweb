# Segments — Working Spec (DRAFT)

> Design spec for the **Segment management** layer: a review/attention system that sits *on top of* the
> existing pricing tools and answers the operator's real daily question — *"of my ~29 segments, which one
> do I click and work on right now?"* Same "throw away when done" scratch-spec style as `add-modify-spec.md`.
> **Nothing here is built yet** — this captures the agreed model so it doesn't evaporate.

---

## 0. STATUS & NEXT UP  (read this first)

> **⚠️ CHANGE 2026-07-11 — read §9 before touching segment clocks.** Both pricing clocks (Shopify **and** Amazon)
> move from a *manually-set* per-segment review date to a **derived** due state (computed from the products' own
> review dates — Shopify per-style, Amazon per-SKU). "Remove" is renamed **Housekeeping**, which is now the *only*
> area that keeps a manual review date. Everything below §0–§8 describes the *original* manual-clock model (still
> live on prod); §9 is the agreed change and supersedes it for the two pricing areas.
>
> **STATUS 2026-07-11 — the §9.2–§9.4 SHOPIFY-derived pass is BUILT (uncommitted, not deployed):** new
> `utils/segmentDerived.js`; `GET /segments` + `GET /segment` derive the Shopify cell (extra grouped query, merged in);
> `segment-work.js` ignores `reviewDays` for Shopify; web renders "X / Y waiting" + hides Shopify review pills. The
> Remove→Housekeeping rename: seed updated in `setup-segments.js`, **migration
> `migrations/2026-07-11-rename-remove-to-housekeeping.sql` written but NOT yet applied to prod** (still shows "Remove").
> Server `node --check` + web `tsc` clean; derived SQL validated against live prod; NOT click-tested. **Amazon-derived
> (§9.5) is still a LATER pass** (needs the per-SKU `next_amz_price_review` column + batch mark-reviewed write).
>
> **STATUS 2026-07-11 (later) — Housekeeping rename APPLIED to prod by the owner** (the `area` row is now 'Housekeeping';
> UI labels already shipped). Also polished: the derived-Shopify cell/tooltip now read **done/total** ("0 / 9" = none parked
> yet → "9 / 9" = all done) instead of remaining, and the stale "Never worked" line is hidden for derived cells (commit
> `7a25e7f` + follow-ups). **NEXT UP is the Amazon-derived pass — now fully specced in §10 below** (an implementation-ready
> build spec; §9.5 was the summary). Nothing in §10 is built yet.


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

---

## 9. CHANGE 2026-07-11 — derived pricing clock + Housekeeping rename  (AGREED; supersedes §3–§6 for the Shopify area)

### 9.1 The problem we're fixing

The manual clock (§4 `segment_area_state.next_review_date`, set via the "Mark worked" review pill) treats a
segment as *done* when the operator picks an end-of-session date. But a segment isn't a task — it's a **container
of per-product work**, and the products already carry their own precise review dates (`next_shopify_price_review`,
set every time a style is priced or parked in triage). Forcing one manual segment date on top of ~30 product
dates produces two failures the operator hit in practice:

- **Under-cover:** priced 5 of 30 styles in an hour, set the segment to +7d → the other 25 are hidden for a week
  though nothing was done to them.
- **Over-cover / mismatch:** a style is due in 2 days, but the segment got set to +14d → the segment buries a
  product that's due sooner.

Root cause: **two clocks pretending to be one.** The segment date is redundant — the product dates already hold
all the timing. Fix (agreed, Option A): **stop setting a Shopify segment date; derive the segment's due state
from its products.** No mismatch is possible because there's nothing to mismatch against.

### 9.2 The derived model (Shopify area)

A segment's Shopify status is **computed at read time** from the same pool triage/losers already draw from —
in-stock, un-parked, Shopify-live styles:

```
candidates  = styles in segment WHERE live on Shopify (ss.shopify=1)
                                  AND in stock (localstock #FREE, not deleted, qty>0)
outstanding = candidates WHERE un-parked (next_shopify_price_review IS NULL OR <= CURRENT_DATE)
parked      = candidates WHERE next_shopify_price_review > CURRENT_DATE
next_wake   = MIN(next_shopify_price_review) over parked   -- soonest a hidden style returns

dueState:
  outstanding > 0  → 'due'   (attention now — same red the overview already uses)   badge: "12 waiting"
  outstanding = 0  → 'ok'    (resting; nextReview = next_wake)                        badge: "back Fri"
```

This is the **union** of the winners pool (in-stock, sold-30d, un-parked) and the losers pool (in-stock,
un-parked, incl. DEAD 0-sales) — both draw from *in-stock + un-parked*, so counting that pool is the honest
"is there pricing work here" signal. It maps straight onto the existing `classifyDue` colours (`due`→red,
`ok`→green); no new UI vocabulary.

**Both failure cases dissolve by construction:** 5-of-30 → 25 still un-parked → segment stays `due` tomorrow;
product due in 2 days → it re-enters `outstanding` in 2 days → segment goes `due` then, and nothing can bury it.

**Rolling-worklist behaviour (confirmed):** the operator chips at a segment across sessions, parking styles one
at a time; the segment self-clears only when every in-stock style is parked into the future. The triage screen
keeps its **10 winners / 10 losers slice** and simply **refills from the remaining candidates as styles are
parked** (already how the `LIMIT` + un-parked filter behaves) — small and focused, never the full 30 at once.

### 9.3 What changes in code

- **`GET /segments`** — for the **Shopify** area, replace the `segment_area_state` clock read with the derived
  query above. Return the same area shape plus two new fields the tile uses: `outstanding` (int) and
  `instock` (int, the candidate count) so the cell can show **"12 / 30 waiting"** instead of "Nd late".
  One extra set-based query grouped by `ss.segment` (sketch):

  ```sql
  WITH instock AS (
    SELECT groupid, SUM(qty) AS stock FROM localstock
    WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
    GROUP BY groupid
  )
  SELECT ss.segment AS name,
         COUNT(*)                                                        AS instock_styles,
         COUNT(*) FILTER (WHERE ss.next_shopify_price_review IS NULL
                             OR ss.next_shopify_price_review <= CURRENT_DATE) AS outstanding,
         MIN(ss.next_shopify_price_review)
           FILTER (WHERE ss.next_shopify_price_review > CURRENT_DATE)   AS next_wake
  FROM skusummary ss
  JOIN instock i ON i.groupid = ss.groupid
  WHERE ss.shopify = 1
  GROUP BY ss.segment
  ```
  `dueState` = `off` (if flag set, kept — see below) else `outstanding>0 ? 'due' : 'ok'`; `nextReview` =
  `isoDate(next_wake)`.
- **`GET /segment`** (detail) — same derived Shopify block; the header can show "18 parked · 12 waiting · next
  back <date>".
- **`POST /segment-work`** — the Shopify area **no longer accepts `reviewDays`** (there's no segment clock to
  set). It may still log a note and toggle `off`. The review pills disappear from the Shopify "Mark worked" UI.
  (Amazon/Housekeeping keep their pills — see below.) Simplest: leave the endpoint as-is but have the **web UI
  hide the review pills for the Shopify area**; server-side, ignore `reviewDays` for Shopify if you want a hard
  guard. Decide when building — a UI-only change is the smaller footprint.
- **`segment_area_state` for the Shopify row** — becomes vestigial for timing; keep the row only for the `off`
  flag (a segment genuinely not sold on Shopify → `dueState:'off'`, short-circuits the derived count). Its
  `next_review_date`/`cadence_days` are simply no longer read for Shopify. **No migration, no data change** —
  purely a read-side switch.
- **Auto-log tie-in (§6-D) is now moot for the Shopify clock** — the clock *is* the product dates, so applying a
  price in triage already moves it (that write sets `next_shopify_price_review`). We may still write a
  `segment_worklog` row on apply for the "who worked it / when" history, but it no longer needs to advance any
  clock.

### 9.4 Rename "Remove" → "Housekeeping"

The third area becomes **Housekeeping** (curate what's in/out of the segment — a genuinely *periodic* audit that
is **not** tracked per-product). It **keeps the manual clock** exactly as built (§4/§6-B: cadence pill +
`next_review_date` + "Mark worked"). This is the one area where a segment-level date is the right tool, because
there's no underlying per-product date to derive from. Change: the seed `area.name = 'Remove'` → `'Housekeeping'`
(one `UPDATE area SET name='Housekeeping' WHERE name='Remove'`; id is stable so clocks/worklog carry across),
plus the label in `src/lib/segmentUi.ts` and any hard-coded "Remove" strings.

### 9.5 Amazon area — also derived, at SKU grain (AGREED)

Amazon uses the **same derived model** as Shopify — the concept is identical, only the grain differs: Amazon
prices/reviews **per SKU** (each size), not per groupid. So a segment's Amazon status is computed the same way,
counting **SKUs** instead of styles:

```
candidates  = SKUs in segment with a live amzfeed row (FBA, in stock)
outstanding = candidates that are un-parked (per-SKU review date null or <= CURRENT_DATE)
next_wake   = MIN(per-SKU review date) over parked SKUs
dueState    = off? 'off' : outstanding>0 ? 'due' : 'ok'    -- tile: "8 / 40 waiting"
```

**Prerequisite (not yet in the DB):** Amazon has no per-SKU review/park column today (CLAUDE.md: "no
review/park"; W-A1 only logs to `amz_price_log`). Deriving the Amazon clock needs a per-SKU review date to count
against — a new `next_amz_price_review` (date) at SKU grain (on `skumap`/the SKU row, or a small side table keyed
by `code`). This is the Amazon analogue of `next_shopify_price_review`.

**Going forward — batch "mark reviewed":** the operator wants to mark a *group* of SKUs reviewed in one action
(rather than one-at-a-time) to make Amazon's size-grain volume manageable. So the write that parks Amazon SKUs is
a **bulk set-review** (N SKUs → `next_amz_price_review = CURRENT_DATE + reviewDays` in one call), not only the
per-SKU path. Same derived read consumes it. (Design the exact endpoint when the Amazon area is built; the read
model above doesn't care how the dates got set.)

**Sequencing:** the per-SKU review column + batch-mark write are **their own build**, not part of this pass.
This pass ships Shopify-derived + Housekeeping rename (§9.2–§9.4). When Amazon's column lands, its cell switches
to the derived model identically. Until then the Amazon cell can render `off`/unknown rather than a stale manual
clock — **the manual `next_review_date` is retained ONLY for Housekeeping** (§9.4); Shopify and Amazon are both
derived.

### 9.6 Build order for this change (small, focused)

**This pass (Shopify derived + rename):**
1. `utils/segmentDue.js` (or a new `segmentDerived.js`) — a helper that, given the grouped counts, returns a
   derived `{ dueState, outstanding, instock, nextReview }` (same shape for Shopify now, Amazon later). Keeps
   overview + detail from drifting.
2. `GET /segments` — add the derived Shopify query + swap the Shopify area assembly to use it. Amazon +
   Housekeeping rows unchanged for now.
3. `GET /segment` — same derived Shopify block; enrich the header counts.
4. Rename Remove→Housekeeping (area row + UI labels).
5. Web: Shopify cell renders "X / Y waiting"; hide review pills on the Shopify "Mark worked"; keep them for
   Housekeeping. Triage screen unchanged (its refill-on-park behaviour is already the mechanism).

**Later pass (Amazon derived, §9.5):** add the per-SKU `next_amz_price_review` column + a **batch "mark
reviewed"** write, then point the Amazon cell at the same derived helper (SKU-grain counts). Not in this pass.

**Testing:** all reads (safe on prod). The only writes are the one-line area rename (do it inside
`BEGIN..ROLLBACK` first to confirm clocks/worklog carry, per §8) and the unchanged product parks via triage.

---

## 10. Amazon-derived clock — BUILD SPEC (AGREED; expands §9.5, ready to implement)

> This is the implementation-ready version of §9.5. It makes the **Amazon** area behave exactly like the
> derived Shopify area (§9.2): the segment's Amazon due-state is **computed from the SKUs' own review dates**,
> not a manual segment clock. The concept is identical; only the **grain differs** — Amazon prices/reviews
> **per SKU (`code`)**, so we count SKUs, not styles. Read §9.2–§9.3 first; everything there applies, s/style/SKU/,
> s/`next_shopify_price_review`/`next_amz_price_review`/, s/`localstock` stock/`amzfeed.amzlive` FBA stock/.
>
> **Parking Amazon SKUs — two paths (both AGREED):** (1) **applying a price auto-parks that SKU** (W-A1 sets the
> review date in the same write — like Shopify's W1, saves the operator a step; if they forget nothing breaks, the
> SKU just comes round again). (2) For SKUs the operator reviews but decides to **leave unchanged**, a **batch
> "mark reviewed"** write parks a whole selection at once. Both simply stamp `skumap.next_amz_price_review`;
> everything else is a read-side switch that reuses the Shopify plumbing.

### 10.1 What already exists and is reused unchanged

- `utils/segmentDerived.js → deriveShopify(counts, off)` is **grain-agnostic** — it takes `{ instock, outstanding, nextWake }` + the `off` flag and returns `{ dueState, outstanding, instock, nextReview }`. **Reuse it verbatim for Amazon.** (Optional tidy: rename it `derivePricingClock` and update the two existing Shopify call sites + the new Amazon one — body unchanged. Not required; a lower-effort implementer may just call `deriveShopify` for both.)
- The `off` flag on `segment_area_state` for the Amazon area **keeps its exact meaning** (operator says "this segment isn't sold on Amazon" → `dueState:'off'`, short-circuits the count). The existing Amazon `off` flags on prod carry across untouched — no migration to `segment_area_state`.
- The Amazon area's `next_review_date`/`cadence_days` become **vestigial** (exactly like Shopify's — §9.3). Keep the row for the `off` flag; stop reading its date. **No `segment_area_state` change, no backfill.**
- Frontend types already carry `outstanding`/`instock` on `SegmentAreaCell` (`src/lib/api.ts`), and `isDerived(cell)` in `src/lib/segmentUi.ts` is `cell.instock !== null`. So the moment the server populates those two fields for the Amazon cell, **every derived UI helper (`dueCellLabel`, `dueText`, `cellTitle`, `worstDueScore`) treats Amazon as derived automatically** — the "X / Y done" cell, hidden pills, hidden "Never worked" line all come for free. Only the channel nouns in `dueText` need a tweak (§10.5).

### 10.2 New data model — one column on `skumap` (the only schema addition; APPLIED to prod 2026-07-11)

Amazon has **no per-SKU review/park column today** (CLAUDE.md: "no review/park"). The review date **cannot** live on `amzfeed` (FBA-only, **READ ONLY** — refreshed nightly, any write is clobbered). It goes on **`skumap`**, the per-variant table keyed by `code` (the SKU grain), the Amazon analogue of `skusummary.next_shopify_price_review`:

```sql
-- Run in pgAdmin (owner did this 2026-07-11). Additive, nullable, safe: the Python scripts only touch NAMED skumap
-- columns (no SELECT * into a fixed shape), so a new trailing column is invisible to them. NULL = never parked.
ALTER TABLE skumap ADD COLUMN IF NOT EXISTS next_amz_price_review DATE;
```

- **`code` is unique in `skumap`** (verified: 1994 rows / 1994 distinct / 0 dup / 0 null) and **every in-stock `amzfeed` SKU has a matching `skumap` row** (238/238), so `amzfeed a JOIN skumap m ON m.code = a.code` is 1:1 and can't double-count — the reads read `m.next_amz_price_review` directly, no side table.
- **`NULL` = never parked = outstanding** (mirrors `next_shopify_price_review IS NULL`). No seeding — every in-stock SKU is outstanding until first priced/reviewed.
- No `scripts/setup-segments.js` change (that script owns the segment tables, not `skumap`). The column is a plain schema addition; on a DB rebuild re-run the one-line `ALTER`.

### 10.3 Reads — derive the Amazon cell (mirror the Shopify block)

**`GET /segments` (`routes/segments.js`)** — add a second grouped query beside the existing `shp` one, keyed by segment name:

```sql
-- Derived AMAZON clock — per segment: FBA-in-stock SKUs (candidates) and how many are still un-parked (outstanding).
-- Candidate pool = amzfeed.amzlive>0 (identical to the pool amz-winners/amz-losers draw from). Review date lives on skumap.
SELECT sk.segment AS name,
       COUNT(*)::int AS instock,
       COUNT(*) FILTER (WHERE m.next_amz_price_review IS NULL
                           OR m.next_amz_price_review <= CURRENT_DATE)::int AS outstanding,
       MIN(m.next_amz_price_review) FILTER (WHERE m.next_amz_price_review > CURRENT_DATE) AS next_wake
FROM amzfeed a
JOIN skusummary sk ON sk.groupid = a.groupid
JOIN skumap m ON m.code = a.code            -- 1:1 (code unique in skumap; every in-stock amzfeed SKU has a skumap row)
WHERE COALESCE(a.amzlive, 0) > 0
GROUP BY sk.segment
```

Build an `amazonByName` Map exactly like `shopifyByName`. Then in the assembly loop, extend the `derived` selection so **both** pricing areas derive (Housekeeping stays manual):

```js
const areaName = c.area.toLowerCase();
const derived =
  areaName === 'shopify' ? deriveShopify(shopifyByName.get(c.segment), c.off) :
  areaName === 'amazon'  ? deriveShopify(amazonByName.get(c.segment),  c.off) :
  null;                                   // Housekeeping (and any future manual area) keeps classifyDue
```

**`GET /segment` (`routes/segment.js`)** — add the single-segment version to the `Promise.all` (same shape with `JOIN skumap m ON m.code = a.code`, `WHERE sk.segment = $1 AND COALESCE(a.amzlive,0) > 0`), read `.rows[0]` into `amazonCounts` (all-zero fallback like `shopifyCounts`), and apply the same `areaName === 'amazon'` branch in the `areas.map`. The header line can gain an Amazon equivalent of the Shopify "18 parked · 12 waiting" if wanted (optional).

### 10.4 Reads — the `/amz/[segment]` work lists must hide parked SKUs (the rolling worklist)

For the derived clock to *move* — and for the winners/losers queues to refill as the operator works, exactly like Shopify triage — the Amazon list endpoints must **exclude parked SKUs**. Both already `JOIN skusummary sk` and `FROM amzfeed a`; add the `skumap` join + filter to **`routes/amz-winners.js`** and **`routes/amz-losers.js`**:

```sql
JOIN skumap m ON m.code = a.code
...
AND (m.next_amz_price_review IS NULL OR m.next_amz_price_review <= CURRENT_DATE)   -- un-parked only (mirrors triage's filter)
```

- **`amz-winners` / `amz-losers`: REQUIRED** — these are the actionable shortlists; parked SKUs must drop out so the list refills from remaining candidates (the `LIMIT` already tops it back up), and `outstanding` in §10.3 stays consistent with what the operator sees.
- **`amz-all` (`routes/amz-all.js`): DO NOT hide.** It's the reference view — keep showing every SKU, but (nice-to-have, not required) join `skumap` and return a `parkedUntil` field (`m.next_amz_price_review` when future) so the row can show a "parked until <date>" badge and offer an un-park. Minimal version: leave `amz-all` untouched for v1.

### 10.5 Writes — auto-park on apply (W-A1) + batch mark-reviewed (W-A2)

Both parks are the same one-line UPDATE of `skumap.next_amz_price_review`; the row always exists (§10.2), so a plain `UPDATE ... WHERE code = ...` (no upsert) is enough.

**(A) `POST /amz-apply` (W-A1) — auto-park the priced SKU.** Extend the existing route (`routes/amz-apply.js`): in the same `withTransaction` that inserts the `amz_price_log` row, also park the SKU. Applying a price *is* reviewing it, so it should drop off the winners/losers queue immediately — saves the operator the extra "mark reviewed" step (owner decision: "if the human misses it, it'll come round again anyway").

```sql
UPDATE skumap SET next_amz_price_review = CURRENT_DATE + $2::int WHERE code = $1
```

- Add an **optional `reviewDays`** to the payload (integer `>= 1`); when omitted, park with a **default (`AMZ_DEFAULT_REVIEW_DAYS = 14`**, a const in the route — a middle-of-the-road cadence; the client UI can later offer pills like Shopify's raise≈7 / cut≈14 / hold≈30). It **always parks** — there is no "None" for apply. Validate a supplied `reviewDays` the same way as W-seg-1 (`INVALID_REVIEW_DAYS`).
- This is the first time W-A1 writes a **product row** (`skumap`) — still never `amzfeed`. Keep it inside the existing transaction so a park can't land without its log row. Everything else in W-A1 (floor/RRP checks, `amz_price_log`, the basket response) is unchanged.

**(B) `POST /amz-review` (W-A2) — batch mark-reviewed.** One new route file `routes/amz-review.js`, mounted in `server.js`. For SKUs the operator looked at and decided to **leave unchanged** (no price applied) — park a whole selection at once. Set-based, one `withTransaction`, CLAUDE.md envelope.

```
POST /amz-review   (verifyToken)
Payload: { "codes": ["FLE030-IVES-WHITE-38", "...-39"], "reviewDays": 14 }
```

- **Validate:** `codes` a non-empty array of strings (cap length, e.g. ≤ 500 per call) → else `MISSING_FIELDS`. `reviewDays` integer `>= 1` → else `INVALID_REVIEW_DAYS`. (No "None" — this write's whole job is to set a review date; to leave SKUs alone the operator simply doesn't select them.)
- **One statement**, parameterised (no string interpolation of the array):

```sql
UPDATE skumap SET next_amz_price_review = CURRENT_DATE + $2::int WHERE code = ANY($1::text[])
```

- **Return:** `{ return_code:'SUCCESS', updated: <rowCount>, nextReview: '<YYYY-MM-DD>' }`.
- **Return codes:** `SUCCESS` · `MISSING_FIELDS` · `INVALID_REVIEW_DAYS` · `UNAUTHORIZED` · `SERVER_ERROR`.
- **Optional (defer):** also log a `segment_worklog` Amazon row ("Andreas reviewed N SKUs") for the detail's RECENT ACTIVITY. Needs resolving the segment(s) from the codes (join `amzfeed`→`skusummary.segment`; a batch could span segments → one row per distinct segment). **Lean: skip v1** — the derived cell doesn't read the worklog (§9.3). Same applies to logging W-A1 parks.

**Un-park (optional, defer with the `amz-all` badge):** a tiny `POST /amz-unreview {codes}` → `UPDATE skumap SET next_amz_price_review = NULL WHERE code = ANY($1::text[])`, so a mistakenly-parked SKU returns to the queue.

### 10.6 Frontend

- **`src/lib/api.ts`** — add the client fn (types already sufficient):
  ```ts
  export function markAmzReviewed(codes: string[], reviewDays: number) {
    return request<{ updated: number; nextReview: string }>(
      { url: '/amz-review', method: 'POST', data: { codes, reviewDays } },
      (b) => ({ updated: b.updated, nextReview: b.nextReview })
    );
  }
  ```
- **`src/lib/segmentUi.ts` → `dueText`** — the only helper with Shopify-specific words. Make the nouns area-aware so an Amazon cell reads in SKUs:
  ```ts
  const noun = cell.area.toLowerCase() === 'amazon' ? 'SKUs' : 'styles';
  const none = cell.area.toLowerCase() === 'amazon' ? 'no Amazon stock' : 'no Shopify stock';
  // ...use `noun` in the "X of Y ... done · Z waiting" string and `none` for the instock===0 case.
  ```
  `dueCellLabel` (`"9 / 9"`) and `cellTitle` need no change (no channel words).
- **Overview routing (`src/app/segments/page.tsx`, ~line 58)** — send the Amazon cell to its work screen (it exists at `/amz/[segment]`), like Shopify → `/pricing/[segment]`:
  ```js
  const a = cell.area.toLowerCase();
  if (a === 'shopify') router.push(`/pricing/${encodeURIComponent(name)}`);
  else if (a === 'amazon') router.push(`/amz/${encodeURIComponent(name)}`);
  else router.push(`/segments/${encodeURIComponent(name)}`);   // Housekeeping → detail
  ```
- **Detail `AreaCard` (`src/app/segments/[name]/page.tsx`)** — `derived` is already `cell.instock !== null`, so once the server sends Amazon counts the review pills, cadence, and "Never worked" line hide automatically (same as Shopify). Add an **"Open Amazon →"** deep-link mirroring the existing `isShopify` "Open pricing →":
  ```js
  const isAmazon = cell.area.toLowerCase() === 'amazon';
  // ...{isAmazon && <Link href={`/amz/${encodeURIComponent(segment)}`}>Open Amazon →</Link>}
  ```
  Keep the `off` toggle working for Amazon (mark N/A) — it already does.
- **Applying a price already parks** (W-A1, §10.5A) — a SKU the operator prices drops off the winners/losers queue on the next refetch with no extra action. The `AmzPriceSetter`/basket flow needs no change beyond (optionally) passing a chosen `reviewDays`; omitted = 14d default.
- **The mark-reviewed control on `/amz/[segment]`** (the substantive new UI, for SKUs left *unchanged*) — on the WINNERS/LOSERS (and optionally ALL) lists add row selection (checkboxes) + a **"Mark N reviewed"** action with park-period pills (reuse `SEGMENT_REVIEW_CHIPS`, or an Amazon-native set — confirm spans) → `markAmzReviewed(selectedCodes, days)`. On success, **refetch the lists** so parked SKUs drop out and the queue refills (rolling-worklist behaviour, §9.2). This handles the "reviewed it, leaving the price" case that apply doesn't cover.

### 10.7 Build order (small, focused — do in this order)

> **STATUS 2026-07-11 — steps 1–5 BUILT (uncommitted, not deployed); step 6 partly done.** `node --check` (all changed/new server
> files) + web `tsc --noEmit` both clean. NOT yet click-tested against live prod; writes NOT yet exercised via `BEGIN..ROLLBACK`.

1. **Schema** — ✅ DONE 2026-07-11: `ALTER TABLE skumap ADD COLUMN IF NOT EXISTS next_amz_price_review DATE` run on prod by the owner (§10.2). No setup-script change.
2. ✅ **Derived reads** — added the grouped Amazon query + `amazonByName` Map to `GET /segments` (routes/segments.js), the single-segment version to `GET /segment` (routes/segment.js, added to the `Promise.all` as `amz` → `amazonCounts`), and extended the `derived` selection so BOTH `shopify` and `amazon` areas call `deriveShopify` (Housekeeping stays manual). §10.3.
3. ✅ **Un-park filter** — added `JOIN skumap m ON m.code = a.code` + `AND (m.next_amz_price_review IS NULL OR <= CURRENT_DATE)` to `amz-winners` + `amz-losers` (§10.4). `amz-all` left untouched (v1).
4. ✅ **Writes** — `amz-apply` (W-A1) now auto-parks the priced SKU in the same transaction (`UPDATE skumap ... WHERE code`, optional `reviewDays`, default `AMZ_DEFAULT_REVIEW_DAYS=14`, new `INVALID_REVIEW_DAYS` code); new `routes/amz-review.js` (W-A2, batch mark-reviewed, `code = ANY($1::text[])`, ≤500/call, RETURNING the date) mounted in `server.js`. *Not yet exercised via BEGIN..ROLLBACK on prod.*
5. ✅ **Web** — `markAmzReviewed` client fn + optional `reviewDays` on `applyAmzPrice` (src/lib/api.ts); `dueText` nouns area-aware (SKUs vs styles, src/lib/segmentUi.ts); overview Amazon routing → `/amz/[segment]` (segments/page.tsx); detail "Open Amazon →" (segments/[name]/page.tsx); the mark-reviewed selection control (checkboxes + select-all + park-period pills `AMZ_REVIEW_CHIPS` 1w/2w/1m/2m) on WINNERS/LOSERS in `/amz/[segment]` (§10.6).
6. **Verify** — ✅ `node --check` server + `tsc` web clean. ⏳ click-test still pending: an Amazon cell shows "X / Y", applying a price OR marking a batch reviewed drops those SKUs from winners/losers and ticks the cell's done count up.

### 10.8 Open decisions (resolve when building)

- **RESOLVED — schema location:** `next_amz_price_review` lives on **`skumap`** (a trailing column), not a side table (owner decision 2026-07-11). Applied to prod.
- **RESOLVED — apply parks:** `POST /amz-apply` (W-A1) **does** auto-park the priced SKU (§10.5A) — pricing *is* reviewing; saves the operator a step (owner: "if the human misses it, it'll come round again anyway").
- **Apply park default** — W-A1 parks with `AMZ_DEFAULT_REVIEW_DAYS = 14` when the client sends no `reviewDays`. Confirm 14 is the right default (or wire move-aware pills into `AmzPriceSetter` like Shopify's 7/14/30).
- **Amazon park-period spans (batch)** — reuse `SEGMENT_REVIEW_CHIPS` (1w–6m) or an Amazon-native set? Confirm with the owner (Amazon moves faster; maybe 1w/2w/1m/2m).
- **`amz-all` treatment** — hide parked, or show with a "parked until" badge + un-park? Lean: v1 leave `amz-all` untouched; add the badge/un-park as a fast-follow (§10.5 optional).
- **Candidate pool** — §10.3 uses `amzlive>0` (FBA in stock), matching winners/losers. Confirm that's the right "is there Amazon pricing work here" denominator (an out-of-stock SKU has nothing to price, so excluding it is correct — mirrors Shopify's in-stock candidates).
