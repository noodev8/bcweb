# Social — Marketing module spec (v1)

**Status: PLAN. Nothing built.** Decisions below are made; the build is not started.

Supersedes the earlier "no Graph API, publish by hand" call in
`docs/social/README.md`. That call was right when the goal was three manual posts
a week. The goal has changed to **post every day without it costing thirty
minutes**, and at daily cadence the manual route is the thing that fails, not the
API.

The strategy documents in `docs/social/` (`README.md`, `arizona-pilot.md`,
`graphic-prompt.md`, `CHANGELOG.md`) stay authoritative on **what to post and how
it is judged** — this spec only covers **the machine that posts it**.
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
`META_GRAPH_VERSION` (`v26.0`). Still to add at Phase 1:
`ONECOM_SOCIAL_REMOTE_DIR`, `SOCIAL_ASSET_BASE_URL` (the `ONECOM_SFTP_*`
credentials the upload needs are already there and in use). Phase 3 adds
`META_IG_USER_ID`.

**Publishing is PROVEN — gate cleared 2026-08-01.** Two posts were created with
`published=false` + `scheduled_publish_time` (so never visible to followers),
confirmed to exist, then deleted (`{"success":true}` both). `POST /{page-id}/feed`
and `POST /{page-id}/photos` **both succeeded**. No App Review was needed.

### The Page token — the sweep must derive one

**Do not call the publishing edges with `META_SYSTEM_USER_TOKEN` directly.** The
system user token is the *credential*; the Page endpoints want a **Page access
token** derived from it:

```
GET /{page-id}?fields=access_token   →  the Page token   (also via GET /me/accounts)
```

Both routes work and were verified. The derived token is `type: PAGE` and
**never expires**, and the grant carries `tasks=[ADVERTISE, ANALYZE,
CREATE_CONTENT, MESSAGING, MODERATE, MANAGE, VIEW_MONETIZATION_INSIGHTS]` —
`CREATE_CONTENT` is the one publishing needs. Derive it per sweep run and hold it
in memory; do not store it in `.env` (deriving is one cheap call and survives a
token regeneration without a redeploy).

**Known limitation, harmless for v1:** `GET /{page-id}/feed` fails with
`(#10) requires pages_read_engagement or Page Public Content Access` — **with the
Page token too**, despite the scope being granted. This is the app being in
Development mode. It does **not** affect publishing, which is a different
permission path and is proven above. Flagged because Phase 2's metrics sweep
reads insight edges: **verify `/{post-id}/insights` early in Phase 2** rather than
assuming read access, since the scoped read edges behave differently from the
publish edges here.

### If the token ever breaks

Business Settings → **Users → System users** → `bcweb-publisher` → **Generate
token** → app **BCWEB Social** → re-tick the three scopes → replace
`META_SYSTEM_USER_TOKEN` in the VPS `.env` → restart under PM2. Nothing else to
redo — the app, use case and asset assignments persist.

## Image hosting — one.com, reusing the product-image pipeline

**Decision (revised 2026-08-01): uploads go to one.com over SFTP**, into a
**dedicated social webroot**, served publicly at
`https://social.brookfieldcomfort.com/<uuid>.jpg`.

**Verified end-to-end 2026-08-01** — a 1200×628 JPEG uploaded to
`/webroots/d760f67f` came back over public HTTPS byte-identical, `200`,
`content-type: image/jpeg`. The probe file was deleted; the webroot is empty and
used by nothing else.

An earlier draft of this spec chose VPS static serving and dismissed one.com as
"a second set of credentials for no benefit we can name". **That was written
without checking the code and it is wrong.** The one.com path is already built,
shipped and running in production:

- `utils/sftp.js` — `putImage` / `getImage` / `deleteImage`, credentials from
  `config.onecom` (`ONECOM_SFTP_*`, already in `.env`).
- `routes/product-image.js` — multer memory upload → `sharp` convert → unique
  filename → `putImage` → public URL. **The Social upload route is a close copy of
  this file**, which is the single strongest reason to choose it.
- `images.brookfieldcomfort.com` serves valid TLS and is already fetched by the
  **Google Merchant feed**, so third-party crawler reachability — the actual
  requirement Meta imposes — is proven rather than assumed.

Choosing VPS static would mean writing an nginx `location` block, a new asset
directory, and a static-serve path, in order to reproduce something that already
works. It would also put the files inside reach of the `rsync -av --delete`
deploy, which has silently wiped a non-source directory on the VPS once already
(`venv`, 2026-07-10). one.com sidesteps that entirely and survives a VPS rebuild.

- Filename is a generated UUID, never the user's — no collisions, no path tricks.
- **The UUID also defeats one.com's Varnish cache.** That host sits behind a CDN,
  and `product-image.js` already works around it the same way: a re-used filename
  gets served stale, a fresh one appears immediately. Assets being immutable (see
  below) means we never overwrite, so this is free.
- **Social has its own webroot**, never mixed in with product shots.
  `ONECOM_SFTP_REMOTE_DIR` (`/webroots/5fc50976`) points at the product-image
  directory and must keep doing so — add `ONECOM_SOCIAL_REMOTE_DIR`
  (`/webroots/d760f67f`) and give `utils/sftp.js` an optional explicit-directory
  argument defaulting to the existing config value, so the product-image callers
  are untouched.
- **Upload straight into the webroot — do not create subdirectories under it.**
  These one.com webroot paths are **symlinks** (`sftp.exists()` returns `'l'`, not
  `'d'`), and `ssh2-sftp-client`'s recursive `mkdir` stats the parent, sees a
  non-directory and fails with `Bad path: … not a directory`. This was hit for
  real on 2026-08-01 while trying to create a `social/` subdirectory under the
  product webroot. A dedicated webroot removes the need entirely; if a
  subdirectory is ever genuinely wanted, create it by hand in the one.com control
  panel rather than fighting the client.
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

**The DATABASE is the schema of record, not this section and not a setup script.**
The one-off creation script was deleted once it had run (owner, 2026-08-01): a
setup script nobody re-runs when the schema really changes drifts out of step and
then misleads, which is worse than not having one. The summary below is a reading
aid — when it matters, check the live table.

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
| `POST /social-asset-upload` | Multipart. Validate, convert, SFTP to one.com, insert `social_asset`, return the public URL. Model it on `routes/product-image.js`. |
| `POST /social-post-create` | Insert post + one target row per selected platform. Validates `scheduled_at` is future. |
| `POST /social-post-update` | Edit caption/link/time/asset. **Only while every target is `SCHEDULED`.** |
| `POST /social-post-cancel` | Removes a queued post. **Never published → DELETED** (post + targets + orphaned asset + the one.com file). Published on any platform → post survives, pending targets → `CANCELLED`. Never touches a posted row. |
| `GET /social-posts` | Queue list. Filter by status, newest first. Post + its targets in one query — no N+1. |
| `GET /social-post` | Drill: full caption, asset, per-platform status, metrics, error. |
| `POST /social-post-publish-now` | Manual fire for one target. The escape hatch when the sweep has failed and you want the post out today. |

Writes wrapped in `withTransaction`. The Meta call happens **outside** the
transaction — same discipline as W1's Shopify push. A network call must never be
holding a DB transaction open.

### Activity goes to `bclog`, not a private table (owner, 2026-08-01)

Queue / Delete / Posted / permanently-FAILED each write one `bclog` row via
`utils/bclog.js`, section **`Social`** — the same shared log Inventory, Order Sync
and the Amazon import already write to, and that the legacy PowerBuilder app
reads. There is deliberately no `social_*` audit table: "who did what" is one
question and it should have one answer.

- **`bclog.workstation` holds the LOGIN NAME**, not a machine name — the legacy
  column keeps its name, bcweb writes `req.user.display_name` into it, exactly as
  `routes/inv-adjust.js` established.
- **Cron writes `Scheduler`**, so an automated post is never attributed to
  whoever happened to compose it.
- **Only the final give-up failure is logged**, not each retry — the Queue already
  shows retries loudly, and the shared log should not be buried in them.
- The in-transaction helper (`writeBcLog`) is used where the log must land or roll
  back *with* the thing it describes. `logActivity` is best-effort and is used
  after a publish, which has already happened and cannot be undone by a logging
  failure.

## The publish sweep

`scripts/social-publish-sweep.js`, cron **hourly, on the hour** — `0 * * * *`
(owner, 2026-08-01; a post a day does not need a sweep every few minutes). The
crontab on the server is the definitive source for the schedule.

Two consequences of that cadence, both deliberate:

- **Compose snaps its time picker to `:00`**, rolling forward to the next hour if
  snapping down would land in the past. Otherwise the screen would promise 09:20
  and the post would actually appear at 10:00. If the cadence ever changes, that
  snap is the other half of the decision.
- **The cron entry needs no GMT/BST adjustment.** The server runs on GMT and the
  fixed-time entries around it are hand-shifted by an hour; an hourly entry fires
  every hour regardless of zone, and needs no re-editing when BST ends.

**No output redirection**, matching every other entry on the box. That is a
positive choice, not an omission: this sweep's durable record is in the database —
`bclog` for every publish and every permanent failure, Meta's exact error text on
the target row, red rows in the Queue. `docs/maintenance-notes.md` records that
sweep failures have historically been invisible and that the fix is scripts
self-logging rather than bolting a redirect onto the schedule file; this one is
built that way.

1. Select targets where `status='SCHEDULED'` and `scheduled_at <= now()`.
2. Claim each with a conditional `UPDATE … SET status='PUBLISHING' WHERE
   status='SCHEDULED'` and check the row count. **If zero rows, skip it** — that
   is the whole defence against a slow run overlapping the next one and
   double-posting. Double-posting is the single worst failure this module has:
   public, visible, and not deletable from the customer's memory.
3. Build the UTM'd link, append it to the caption, publish:
   - **FB:** `POST /{page-id}/photos` — `url` (the one.com asset URL), `caption`,
     `published=true`. We are firing at the due minute, so no
     `scheduled_publish_time`. Derive the Page token first (see Phase 0).

     **Use `/photos`, not `/feed`.** An earlier draft specified `/feed` with
     `message` + `link`. That posts a *link* post: Facebook renders the link
     target's own OG image and **the graphic you uploaded never appears** — which
     defeats the entire point of a module built around "you bring the graphic".
     `/photos` puts the graphic front and centre and carries the UTM'd link in the
     caption text, where Facebook linkifies it. It also matches IG's
     image + caption shape, so v2 is a closer parallel. Both edges were gate-
     tested and both work; this is a product choice, not a capability limit.

     **`remote_id` caveat:** an unpublished/scheduled `/photos` call returns only a
     photo `id` (no `post_id`); a live `published=true` call returns both. Store
     `post_id` when present and fall back to `id`, and do not assume the id shape
     is stable between the two.
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

  **Backend BUILT 2026-08-01** (shipped `6db5c03`): the three tables are **applied
  to prod**, `utils/socialMeta.js`, `utils/socialPublish.js`,
  `scripts/social-publish-sweep.js`, and routes `social-asset-upload`,
  `social-post-create`, `social-posts`, `social-post-cancel`,
  `social-post-publish-now` — all mounted in `server.js`. Lint and syntax clean;
  integration-tested against the real DB and the real image host (UTM builder,
  Page-token derivation and caching, upload + public fetch, the conditional-claim
  double-post guard, stale reclaim, the queue's single-query shape).

  **Front end BUILT 2026-08-01** (shipped `6db5c03`): `app/social/page.tsx` (Compose |
  Queue tabs, one `useApiQuery` owning the data), `components/SocialCompose.tsx`,
  `components/SocialQueue.tsx`, the Social client functions in `lib/api.ts`, and a
  **Marketing** tile on the dashboard. `tsc --noEmit` and eslint both clean.

  **Still to do:** the crontab entry for the sweep (see `docs/deploy.txt`), the two
  new env vars on the VPS, click-testing, and a first live post. **The sweep has
  never fired a live post** — the Graph calls are gate-proven, but nothing has gone
  out end-to-end through the sweep. Results (Phase 2) is not built.
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
