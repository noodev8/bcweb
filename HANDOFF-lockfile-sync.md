# Handoff: lockfile sync after `npm audit fix` (2026-08-21)

**This file is a note for the AI assistant on the *other* machine (the desktop).
Read it, do the steps, then this file can be deleted.**

## Context

This is the `bcweb` repo (`C:\bcweb`), a two-app monorepo: `bcweb-server/` (Express API)
and `bcweb-web/` (Next.js). Both apps have their own tracked `package-lock.json`.

**What happened:**

- On the **desktop**, the user deleted `package-lock.json` (one or both apps). That
  deletion was **never committed or pushed** — it is a local working-tree change only.
- On the **laptop**, `npm audit fix` was run in both apps to clear security advisories.
  That produced patch-only lockfile updates, committed alongside this file:
  - `bcweb-web` — 3 high advisories cleared: `brace-expansion` 5.0.8 -> 5.0.9 and
    1.1.16 -> 1.1.18, `nanoid` 3.3.16 -> 3.3.18, `js-yaml` 4.3.0 -> 4.3.1
  - `bcweb-server` — 1 high cleared: `brace-expansion` 5.0.8 -> 5.0.9

All of these were **dev/build-only** dependencies (pulled in via eslint and postcss);
none ship to production. `package.json` was **not** modified in either app, and no
`overrides` entries were added. Both apps reported 0 vulnerabilities afterwards.

## What to do on the desktop

1. Pull (the user may already have done this, since that is how they got this file):

       git pull

2. Restore any locally-deleted lockfile from git — do **not** regenerate it:

       git checkout -- bcweb-web/package-lock.json bcweb-server/package-lock.json

3. Install exactly what the lockfiles specify, in each app:

       cd C:\bcweb\bcweb-web
       npm ci
       cd C:\bcweb\bcweb-server
       npm ci

## Important

Use `npm ci`, **not** `npm install`. `npm install` re-resolves dependencies from
scratch and can silently drift off the pinned security patches above, reintroducing
the advisories. `npm ci` installs the lockfile verbatim — which is the entire point
of syncing a second machine.

## Verify

- `npm audit` in each app should report **0 vulnerabilities**.
- `git status` should show **no** modification to either `package-lock.json`.
- If a lockfile shows as modified with a huge whole-file diff, that is almost
  certainly line endings, not real content. Check that `git config core.autocrlf`
  matches on both machines rather than committing the churn.

## Housekeeping

Once the desktop is in sync and verified, delete this file and commit the deletion —
it is a one-shot handoff note, not permanent documentation.
