# Maintenance notes

Things that aren't obvious from the code and would otherwise be re-derived (or worse, "tidied" away). Deployment procedure lives
in `deploy.txt`; conventions live in `API-RULES.md`. Nothing here is urgent — it's the *why* behind decisions that look wrong at
a glance.

---

## 1. Load-bearing decisions — DO NOT "fix" these

### `sharp: ^0.35.0` override in `bcweb-web/package.json` — keep it

`next@16.2.12` still declares optional `sharp: ^0.34.5`. The advisory (GHSA-f88m-g3jw-g9cj, CVE-2026-33327 / 33328 / 35590 /
35591) is `sharp <0.35.0` — **the whole 0.34.x line**, so next's own range is still vulnerable. Removing the override
reintroduces a high. Re-test only when a next 16.x ships a `sharp ^0.35` range.

### `brace-expansion` override — REMOVED, and must not come back

It was never a real fix. `brace-expansion@1.1.x` exports the function directly (`module.exports = expandTop`); `5.0.8` exports an
object (`{EXPANSION_MAX, EXPANSION_MAX_LENGTH, expand}`). `minimatch@3.1.5` does `var expand = require('brace-expansion')` then
calls `expand(pattern)` — so forcing 5.0.8 into minimatch's declared `^1.1.7` slot makes it throw
`TypeError: expand is not a function`. It silenced `npm audit` by **breaking** the library rather than patching it.

It only appeared to work on Next 15 by luck: minimatch 3.x short-circuits (`if (options.nobrace || !/\{...\}/.test(pattern))
return [pattern]`) and calls `expand()` only when a pattern **contains braces**. Nothing in the old config array had any
(`.next/**`, `node_modules/**`). `eslint-config-next@16`'s flat config declares `files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}']` —
braces — so it detonated on the first file match and `npm run lint` died outright.

There is no API-compatible patched version: the latest of every major below 5 is 1.1.16 / 2.1.2 / 3.0.2 / 4.0.1, and the advisory
(GHSA-mh99-v99m-4gvg) covers everything `<=5.0.7`. **The patch IS the breaking major.**

**Consequence, accepted deliberately:** `bcweb-web` reports 9 high **dev-only** advisories. `npm audit --omit=dev` is 0 — the
shipped bundle is clean. The whole chain is lint tooling (`eslint-plugin-import` / `-jsx-a11y` / `-react` → `minimatch` →
`brace-expansion@1.1.16`) that never reaches a browser, and exploiting it means feeding hostile glob patterns to your own linter.
This is the one place in this repo where "dev-only" is the honest answer rather than an excuse, **because there is no fix to
apply**. The real fix is upstream: `@eslint/config-array@0.21.2` still depends on EOL `minimatch ^3.1.5`.

### ESLint is pinned to 9 in `bcweb-web` while `bcweb-server` is on 10 — deliberate

`eslint-config-next@16` advertises peer `eslint >=9.0.0`, which looks like the Next 15-era blocker (peer `^7||^8||^9`) is gone.
It isn't: `eslint-config-next` depends on `eslint-plugin-react`, whose **latest** release (7.37.5) peers `eslint ...||^9.7` and
still calls the `context.getFilename()` API that ESLint 10 removed. With eslint 10 installed, `npm run lint` dies with
`TypeError: contextOrFilename.getFilename is not a function` while loading rule `react/display-name`. There is no newer
`eslint-plugin-react` to override to. Re-test when one ships ESLint 10 support.

---

## 2. Frontend data layer — no fetching in effects

`bcweb-web` fetches through **SWR** (`swr@2.4.2`) behind three shared hooks. There is **no data fetching in a `useEffect`
anywhere in the app**, and it should stay that way. New screens use `useApiQuery`.

| Hook | Use for |
|---|---|
| `src/lib/useApiQuery.ts` | every fetch |
| `src/lib/useScopedState.ts` | state that resets when a scope changes (replaces `useEffect(() => setX(init), [dep])`) |
| `src/lib/useDebounced.ts` | search-as-you-type |

Each file's header explains its own reasoning. The two points worth repeating here:

- **`useApiQuery` exists because `api.ts` deliberately never throws** (API-RULES: HTTP 200 + a `return_code` envelope) while SWR
  decides "error" by catching a throw. Something has to adapt between those contracts, once, rather than at 28 call sites. It also
  centralises `UNAUTHORIZED → logout()`, previously copy-pasted into every loader — one missed copy was a screen silently stuck on
  an expired JWT.
- **`revalidateOnFocus` is OFF on purpose.** The API points at the LIVE production DB and these are heavy aggregates over
  `skusummary` / `localstock`. Refetching every list when someone alt-tabs back would put real load on the DB the owner's Python
  scripts share. Opt in per call site if a screen genuinely needs it.

`useDebounced` **keeps** its `useEffect` on purpose: its `setState` runs inside a `setTimeout` callback, i.e. a later tick, which
is exactly the external-system case effects exist for. The lint rule objects to *synchronous* setState, not to that.

Every remaining `useEffect` in `src/` is a genuine external-system subscription: route guards, Escape / outside-click listeners, a
timer cleanup, an `IntersectionObserver`, and `useDebounced`'s timer.

### The lint rule has a blind spot — a green lint is NOT proof

`react-hooks/set-state-in-effect` missed **seven** effect-based fetches. The four picker pages hid theirs in an async IIFE (the
setState lands after the `await`), and `analytics/price-changes` calls setState *synchronously* before its await and **still**
slipped through, because the rule couldn't see through its `useCallback`.

Find them by grepping for `await get[A-Z]` in files that also contain `useEffect`.

### Identity gotcha this surfaced

`data?.rows ?? []` allocates a fresh array on every render and silently defeats every `useMemo` derived from it. Hence the
module-level `NO_ROWS`-style constants throughout. That bug class predated the SWR work — watch for it anywhere a default is
built inline.

---

## 3. Build and tooling gotchas

- **Turbopack emits CSS to `.next/static/chunks/*.css`, not `.next/static/css/`** as Next 15 did. It looks like the stylesheet
  vanished if you check the old path.
- **`next build` rewrites `tsconfig.json` itself.** It mandates `"jsx": "react-jsx"` (React automatic runtime), adds
  `.next/dev/types/**/*.ts` to `include`, and reflows every array onto multiple lines. Don't fight it — the next build redoes it.
- **`next-env.d.ts` is gitignored.** Next writes a different import path depending on the last command (`next build` →
  `./.next/types/routes.d.ts`, `next dev` → `./.next/dev/types/routes.d.ts`), so whichever variant were committed, the other would
  leave a permanently dirty tree. `tsconfig.json` includes both paths, so neither breaks anything.
- **`next build` no longer runs ESLint at all** (Next 16 removed `next lint`). Lint has to be run deliberately — a green build
  proves nothing about it.
- **A green build proves compilation, not behaviour.** A silently-empty Tailwind build still compiles. After any build-pipeline
  change, click-test that styling actually renders before believing it.

### Verification checklist for any dependency bump

```
bcweb-server:  npm run lint   AND a boot check (node -e "require('./server.js')" — must print the listening line)
bcweb-web:     npx tsc --noEmit   AND   npm run lint   AND   npm run build   — then `npm audit` in both
```

`npm run lint` earns its place in that list: it is what caught both landmines in §1. A green build would have hidden them.

---

## 4. OPEN: one Google price push stuck failing (found 2026-07-26, not yet diagnosed)

`0552683-ARIZONA` — £60.19 → £63.19, by Andreas, `2026-07-25 23:21` — is the only row in `price_change_log` with
`channel='SHP' AND google_pushed_at IS NULL` (1,324 of 1,325 stamped). Its price has therefore **not reached Google**.

It is not being skipped. The style qualifies for the sweep's queue (`googlestatus=1`, `shopify=1`, 9 mapped `googleid`s, all
`shopifyprice` values numeric), so `pushIfLive` is returning a failure and the sweep is correctly leaving it queued to retry. It
has been retrying on every run since.

A theory that did NOT hold, recorded so nobody re-runs it: this style has one odd `googleid` (size 43 is
`0552683-ARIZONA-43`; its eight siblings drop the leading zero), and 13 Google-live styles share that mixed-shape pattern. But
`0552681-ARIZONA` has the same defect, was changed one minute earlier, and pushed fine — so the leading zero is not the cause on
that evidence.

**To diagnose:** the real error goes to the sweep's stderr on the VPS. Read `/apps/scripts/logs/google-sweep.log`, or run it by
hand on the box — `node /apps/production/bcweb-server/scripts/google-price-sweep.js` — which will retry that one style and print
the reason. `pushIfLive` can fail as `GOOGLE_NOT_CONFIGURED` (ruled out — other styles pushed in the same run),
`GOOGLE_PUSH_FAILED` (whole run), or `pushed:true` with `failed > 0` (individual sizes rejected), which is the likely one.

---

## 5. Other things worth knowing

**ESLint 10 on the server adds `preserve-caught-error` to its recommended set.** It caught a real bug in `utils/googleAuth.js` (a
`JSON.parse` failure rethrown without `cause`, losing the parse position — now fixed). Expect it to flag more bare rethrows as
older files get touched. The fix is always the same shape: `throw new Error(msg, { cause: e })`. It's a genuine improvement, not
lint noise — don't disable it.

**`price_change_log` holds rows where `old_price = new_price`.** These are NOT a bug, and NOT review-date updates (`pricing-park`
writes no log row at all). They are **HOLDS**: Apply pressed with the price left unchanged, which is the only way to record *why*
a style was left alone, because park sets the review date but stores no note. Analytics → Price Changes counts them in its Holds
column. **Do not add an `old == new` guard to `pricing-apply`** — it would discard the note, which is the whole point of the
action. If a cleaner route is ever wanted, let `pricing-park` accept a note; be aware that would move holds out of
`price_change_log` and change what the activity summary counts.

**Watch for accidental double-Applies.** `1015399-BARBADOS` logged the same no-op twice, 18s and 57s after a genuine raise, same
note each time (ids 1772/1773, to be deleted). If that pattern recurs it inflates the Holds count with things that aren't really
analysis, and may mean Apply isn't confirming clearly enough that it worked.
