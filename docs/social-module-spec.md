# Social — Marketing module spec (v1)

**Status: PLAN. Nothing built.** Decisions below are made; the build is not started.

Supersedes the "no Graph API" call in `C:\scripts\social\README.md`. That call was
right when the goal was three manual posts a week. The goal has changed to
**post every day without it costing thirty minutes**, and at daily cadence the
manual route is the thing that fails, not the API.

The strategy documents (`README.md`, `arizona-pilot.md`, `graphic-prompt.md`) move
here as `docs/social/` when the build starts. They stay authoritative on **what to
post and how it is judged** — this spec only covers **the machine that posts it**.
The scoreboard does not change: **clicks to site, via UTM, in GA4.** Meta's numbers
are diagnostic, and this module must not quietly become a place where reach starts
looking like success.

## What v1 is

A **Marketing** tile → **Social**. Three screens.

1. **Compose** — upload a finished graphic, write a caption, pick the collection
   link, pick date/time, save. Nothing clever. No image editing, no templates, no
   rotation planner. You bring the graphic; bcweb handles everything after that.
2. **Queue** — scheduled / posted / failed, newest first. Edit or cancel anything
   not yet posted.
3. **Results** — posted rows with Meta's reach and engagement, refreshed nightly.

**Facebook only in v1.** Instagram is v2 and the schema is built for it from day
one so adding it is a publisher branch, not a migration.

### Deliberately out of scope

Graphic generation or editing. Paid spend. Comment/DM handling. TikTok, Pinterest,
anything not Meta. GA4 click figures pulled into bcweb — you read those in GA4.

## The awkward bit, stated once

**Facebook can schedule for us. Instagram cannot.** FB takes
`published=false` + `scheduled_publish_time` and holds the post itself. Instagram
publishing is two calls that must both fire *at post time*.

So v1 could lean on FB's native scheduling and skip the sweep entirely — and that
is exactly the shortcut that would have to be unpicked in v2. **We build our own
scheduler now**, sweep-driven, and hand FB a post at its due minute like any other
platform. One code path, and the queue in bcweb is the truth rather than a mirror
of something living inside Meta.

Pattern to copy: `scripts/google-price-sweep.js` (cron → find due rows → act →
stamp). Same shape, same crontab file.

## Phase 0 — Meta access — **DONE 2026-08-01**

This is the as-built record. `docs/social/meta-setup.md` was the click-by-click
walkthrough and describes a **route we abandoned** — it is disposable, ignore it.

**What exists:**

| Thing | Value |
|---|---|
| Facebook Page | **Brookfield Comfort**, id `103119731391855`, 3.3K followers |
| Instagram | linked professional account, 203 followers (phase 3) |
| Business portfolio | **Brookfield Comfort Main** |
| Meta app | **BCWEB Social**, Development mode, use case *Manage everything on your Page* |
| Credential | **system user token** — `bcweb-publisher`, Employee access |
| Granted | Page asset Full access; app asset Develop app |
| Scopes | `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` |

**Auth is a system user token, NOT a Page token from a user login.** This is the
important deviation from the original plan and it is a deliberate improvement:

- **It never expires.** No 60-day exchange, no refresh procedure, nothing to
  diarise.
- **It belongs to the business, not to a person.** It does not break when a
  personal Facebook password changes, and it survives the human leaving.
- **It is scoped to one asset.** `GET /me/accounts` returns Brookfield Comfort and
  nothing else — verified. Other Pages on the admin's personal account are
  invisible to it.

It can still be revoked (Business Settings → System users → Revoke tokens), so
**the sweep must fail loudly in the Queue rather than stopping quietly** — a
scheduler that goes silent is worse than no scheduler. That requirement is
unchanged.

`read_insights` is **not** granted and is not needed: per-post insights come under
`pages_read_engagement`. Page-level insights are not read by this module.

**Env vars** — already set in `bcweb-server/.env` (gitignored, verified):
`META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID`, `META_SYSTEM_USER_TOKEN`,
`META_GRAPH_VERSION` (`v26.0`). Still to add at Phase 1: `SOCIAL_ASSET_DIR`,
`SOCIAL_ASSET_BASE_URL`. Phase 3 adds `META_IG_USER_ID`.

**Verified by curl:** `GET /{page-id}?fields=name,fan_count` returns the Page and
~3.3K. **Publishing is NOT yet proven** — the scheduled-post-then-delete test was
deliberately deferred into the Phase 1 build, where a failure is easier to read.
**First publish attempt is the real gate**; if it fails on a permission
(`(#200) Requires pages_manage_posts` or similar), regenerate the system user
token with the scopes re-ticked before debugging anything in our code.

### If the token ever breaks

Business Settings → **Users → System users** → `bcweb-publisher` → **Generate
token** → app **BCWEB Social** → re-tick the three scopes → replace
`META_SYSTEM_USER_TOKEN` in the VPS `.env` → restart under PM2. Nothing else to
redo — the app, use case and asset assignments persist.

## Image hosting — VPS static

**Decision: uploads land on the VPS running the API**, in `SOCIAL_ASSET_DIR`,
served publicly at `SOCIAL_ASSET_BASE_URL` (e.g.
`https://<api-host>/social-assets/<uuid>.jpg`). No FTP, no second set of
credentials, no gap between "uploaded" and "reachable". one.com was the original
thought; it adds a failure mode between upload and publish for no benefit we can
name.

- Filename is a generated UUID, never the user's — no collisions, no path tricks.
- Accept JPEG/PNG, convert to **JPEG** on write (`sharp`, already a dependency).
- Enforce Instagram's rules **now**, in v1, even though v1 is FB-only: ≤8MB,
  aspect ratio between 4:5 and 1.91:1. Discovering in v2 that every stored asset is
  the wrong shape is an avoidable, annoying migration.
- Assets are immutable. Editing a queued post's image uploads a new file; the old
  one stays because a published post points at it.
- Public directory, no auth, static serve only — it must be, or Meta cannot fetch
  it. It holds marketing images we are actively publishing to the world, so there
  is nothing to leak. **Never serve anything else from it.**

## Schema

Three tables, `social_` prefix, in `brookfield_prod`. New tables — no legacy
landmines, so proper types throughout: real `numeric`, real `timestamptz`, and
none of the `character varying` price nonsense from `skusummary`.

**`social_asset`** — one row per uploaded image.
`id`, `filename`, `public_url`, `width`, `height`, `bytes`, `uploaded_by`,
`created_at timestamptz`.

**`social_post`** — one row per composed post, whatever it targets.
`id`, `caption text`, `link_url text` (bare URL, no UTM), `campaign text` (the
collection slug → `utm_campaign`), `angle text` (nullable, from the rotation),
`asset_id`, `scheduled_at timestamptz`, `created_by`, `created_at`, `updated_at`.

**`social_post_target`** — one row per post per platform. **This is what makes v2
cheap.**
`id`, `post_id`, `platform text` (`FB` | `IG`), `status text`
(`SCHEDULED` | `PUBLISHING` | `POSTED` | `FAILED` | `CANCELLED`),
`remote_id text` (FB post id / IG media id), `published_at timestamptz`,
`error text`, `attempts int`, `metrics jsonb`, `metrics_at timestamptz`.

Metrics as `jsonb` on purpose: Meta renames insight fields (IG `impressions` →
`views` being the recent one). Columns would have us migrating on their schedule.
Store the raw response, read known keys defensively, display "—" when absent.

Index `social_post_target (status, post_id)` for the sweep; the volume here is a
few posts a day, so nothing else needs tuning.

**The UTM is built at publish time, not stored.** `link_url` stays clean;
`utm_source` comes from the platform, `utm_medium` is always `social`,
`utm_campaign` is `campaign`. Same rule as `README.md`, now enforced by code
rather than by remembering.

## Routes

One file per endpoint, kebab verb-noun, HTTP 200 + `return_code` always, per
`docs/API-RULES.md`. `changed_by` resolved server-side from the JWT.

| Route | Does |
|---|---|
| `POST /social-asset-upload` | Multipart. Validate, convert, write to disk, insert `social_asset`, return the public URL. |
| `POST /social-post-create` | Insert post + one target row per selected platform. Validates `scheduled_at` is future. |
| `POST /social-post-update` | Edit caption/link/time/asset. **Only while every target is `SCHEDULED`.** |
| `POST /social-post-cancel` | Targets → `CANCELLED`. Never deletes a posted row. |
| `GET /social-posts` | Queue list. Filter by status, newest first. Post + its targets in one query — no N+1. |
| `GET /social-post` | Drill: full caption, asset, per-platform status, metrics, error. |
| `POST /social-post-publish-now` | Manual fire for one target. The escape hatch when the sweep has failed and you want the post out today. |

Writes wrapped in `withTransaction`. The Meta call happens **outside** the
transaction — same discipline as W1's Shopify push. A network call must never be
holding a DB transaction open.

## The publish sweep

`scripts/social-publish-sweep.js`, cron **every 5 minutes** (schedule lives in
`crontab.txt`, which stays the definitive source — do not restate it elsewhere).

1. Select targets where `status='SCHEDULED'` and `scheduled_at <= now()`.
2. Claim each with a conditional `UPDATE … SET status='PUBLISHING' WHERE
   status='SCHEDULED'` and check the row count. **If zero rows, skip it** — that
   is the whole defence against a slow run overlapping the next one and
   double-posting. Double-posting is the single worst failure this module has:
   public, visible, and not deletable from the customer's memory.
3. Build the UTM'd link, append it to the caption, publish:
   - **FB:** `POST /{page-id}/feed` — `message`, `link`, `published=true`. We are
     firing at the due minute, so no `scheduled_publish_time`.
   - **IG (v2):** `POST /{ig-user-id}/media` with `image_url` + `caption` →
     `creation_id`, then `POST /{ig-user-id}/media_publish`. Container expires in
     24h; treat a failure between the two calls as `FAILED`, never retry blind.
4. Success → `POSTED` + `remote_id` + `published_at`. Failure → increment
   `attempts`, store `error`. **Three attempts, then `FAILED` and stop.** No
   infinite retry against Meta.
5. Any `PUBLISHING` row older than 15 minutes → `FAILED` ("interrupted"). It is
   safer to surface a stuck post for a human than to retry one that may have
   landed.

**Anything `FAILED` is loud in the Queue** — count on the tile, red row, the error
text visible. Silent failure is the way a daily-posting habit dies.

## The metrics sweep

`scripts/social-metrics-sweep.js`, cron **daily**.

For each `POSTED` target published in the last 30 days, read insights
(`/{post-id}/insights` for FB), store the raw response in `metrics`, stamp
`metrics_at`. Fields we intend to show: **reach, impressions, engagement**. Verify
the exact metric names against the live Graph API at build time — do not trust any
list written here or anywhere else, Meta changes them.

Nothing else reads Meta. **Clicks stay in GA4.** The Results screen says so, in
words, on the screen — so the next person does not assume the reach number is the
scoreboard.

## Front end

`bcweb-web`, App Router, SWR via `src/lib/useApiQuery.ts`. **No fetching in
effects** — `docs/maintenance-notes.md`. Existing module patterns; nothing new
invented.

- Dashboard: **Marketing** tile → `/social`. Badge = count of `FAILED` targets.
- **Compose** — drop/select image with preview, caption textarea with character
  count, collection link (dropdown of known slugs + free text), platform toggles,
  date/time. The UTM'd URL is shown read-only before saving, so what goes out is
  never a surprise. Delivery footer offered as a one-click append, not forced.
- **Queue** — grouped Scheduled / Posted / Failed, newest first, per-platform
  status chip. Failed rows show the error and a Retry (= publish-now).
- **Results** — posted rows, reach and engagement, `metrics_at`. Sortable.
  Prominent line: *site clicks are measured in GA4, not here.*

## Build order

Each phase is independently useful and independently abandonable.

- **Phase 0** — Meta app, system user token. **DONE 2026-08-01.** Read access
  curl-proven; publish proven at the start of Phase 1.
- **Phase 1** — schema + upload + Compose + Queue + FB publish sweep. Post daily
  by hand into the queue for two weeks. This is the real test: not whether it
  works, but whether *you actually use it*.
- **Phase 2** — metrics sweep + Results.
- **Phase 3** — Instagram. Publisher branch + two env vars, given the schema
  above.
- **Later, only if Phase 1 sticks** — caption templates from the rotation angles,
  bulk-schedule a week, rotation planner. All premature until daily posting is a
  habit rather than an intention.

## Honest risks

- **Meta tokens break.** Not if, when. Loud failure + a written refresh procedure
  is the entire mitigation.
- **The bottleneck is graphics, not software.** This module removes the posting
  chore. It does nothing about producing an image a day, which is the part that
  actually caps the cadence. Do not expect the build to fix that.
- **The `README.md` stop-condition still applies.** Eight weeks of consistent
  posting with a flat-zero click line means stop — and a nicer posting tool is not
  a reason to move that gate.
