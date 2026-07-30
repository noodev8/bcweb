# PostgreSQL MCP setup — per-machine (Windows)

## ⛔ Do not follow this document unless Andreas has explicitly asked for the MCP to be installed

**The Postgres MCP was removed in Jul 2026 and is not the way we talk to the database.**
Use `db/` in `C:\scripts` instead — `python db/query.py` to read, `python db/write.py` to
write. `C:\scripts\db\README.md` is the front door and covers everything the MCP did.

This file is kept only so that the install is easy to repeat **if Andreas asks for it**. It is
not a to-do. Do not act on it because the MCP appears to be missing — missing is the intended
state. If you think it should be reinstated, say so and wait for an answer.

Why it was removed: `@modelcontextprotocol/server-postgres` is deprecated upstream and
unmaintained; the config lives in a gitignored `.mcp.json` that must be hand-recreated per
machine and kept silently going missing; and it only ever worked inside an interactive Claude
Code session, not on the VPS and not under cron. The `db/` scripts work everywhere.

---

The rest of this document applies only once Andreas has asked for it.

The config lives in a **project-scoped `.mcp.json` at the repo root**. That file holds the DB
password in its connection string, so it is **gitignored and does NOT travel with the repo** —
you recreate it on each machine.

This doc is kept **identical in both repos** — `C:\scripts\docs\postgres-mcp-setup.md` and
`C:\bcweb\docs\postgres-mcp-setup.md`. Edit one, copy to the other.

> ⚠️ This connects to the **LIVE production database** — the same one the pricing tool and the
> Python scripts write to.

Windows only. Both machines the user runs (`C:\Users\aandr\`, `C:\Users\UserPC\`) are Windows,
and MCP config does not sync between them — set up each one separately.

---

## Instructions for the AI

When the user asks you to set up or restore the Postgres MCP on a machine:

1. **Check what's already there.** Look for `.mcp.json` at the repo root
   (`C:\scripts\.mcp.json` or `C:\bcweb\.mcp.json`).
   - If it contains a `postgres-brookfield` server, it's already set up — skip to step 4.
   - **If the file exists but has other servers in it, you must ADD to it, not overwrite it.**
     `C:\scripts\.mcp.json` normally holds the `klaviyo` server; replacing the file wholesale
     silently removes Klaviyo. Read it first, then merge.

2. **Get the password.** It is `DB_PASSWORD` in `C:\scripts\.env` (or `bcweb-server/.env` —
   same value). Never hard-code it into a committed file. If neither `.env` exists on this
   machine, ask the user.

3. **Write the config**, merging this server into any existing `mcpServers` object:

   ```json
   {
     "mcpServers": {
       "postgres-brookfield": {
         "command": "cmd",
         "args": [
           "/c",
           "npx",
           "-y",
           "@modelcontextprotocol/server-postgres",
           "postgresql://brookfield_prod_user:YOUR_PASSWORD@217.154.35.5:5432/brookfield_prod"
         ]
       }
     }
   }
   ```

   **Use the name `postgres-brookfield`.** `C:\scripts\.claude\settings.local.json` already
   allows `mcp__postgres-brookfield__query`; naming it plain `postgres` means re-approving every
   query. (A second historical name, `mcp__postgres-nook__query`, is also allowlisted — that was
   a separate unrelated database.)

   Confirm it stays local: `git check-ignore .mcp.json` should echo the filename. It is
   gitignored in both repos.

4. **Activation — the user must do this.** A running Claude Code session cannot hot-load a new
   MCP server.
   - Restart Claude Code in the repo directory.
   - On start it detects the project `.mcp.json` and asks the user to **approve** the project's
     MCP servers. Approve it. (Dismissing that dialog leaves the server unapproved and it will
     not appear.)
   - Verify with `claude mcp list`, or `/mcp` in-session, or `/doctor` (no MCP warnings).

5. **Smoke test:** run a trivial read via the MCP, e.g. `SELECT current_database(), now();`

## Connection details

| field    | value                                        |
|----------|----------------------------------------------|
| username | `brookfield_prod_user`                       |
| password | from `.env` → `DB_PASSWORD`                  |
| host     | `217.154.35.5`                               |
| port     | `5432`                                       |
| database | `brookfield_prod`                            |

Connection string format: `postgresql://username:password@host:port/database`

## Windows gotchas

- **Always `"command": "cmd"` with `"/c"` as the first arg.** Never `"command": "npx"` directly
  on Windows — it fails or throws warnings.
- **Do not add `"type": "stdio"` or an empty `"env": {}`** — unnecessary, and can cause warnings.
- If `/doctor` shows an MCP warning, it is almost always one of those two.

## Why project `.mcp.json` and not `~/.claude.json`

Either works, but a project `.mcp.json` is one small file, auto-loaded when Claude Code runs in
the repo, and trivial to recreate — versus hand-editing the large shared `~/.claude.json`, which
Claude Code rewrites on its own and where a hand-added block is easy to lose. It also mirrors how
`klaviyo` is configured in `C:\scripts`.

## If it goes missing (having previously been asked for)

Since Jul 2026 the answer is almost always "it is meant to be missing" — see the banner at the
top. If Andreas has asked for it and it still will not appear, work through these:

1. **`.mcp.json` is absent or has no `postgres-brookfield` block.** Most likely. Recreate per
   above.
2. **Wrong machine.** Config does not sync between `aandr` and `UserPC`. "It worked yesterday"
   often means it worked on the other machine.
3. **The approval dialog was dismissed** rather than approved on session start — the server
   exists in config but isn't enabled. Check `enabledMcpjsonServers` in
   `.claude\settings.local.json`; it should list the server (or
   `"enableAllProjectMcpServers": true` should be set).
4. **npx/network.** The server is fetched from npm on each start. Test with
   `npx -y @modelcontextprotocol/server-postgres --help`.

## What to use instead (the default)

Not having the MCP is not a blocker — this is the supported path, not a workaround:

- `python db/query.py "SELECT ..."` — read-only.
- `python db/write.py "UPDATE ..."` — writes, transactional, with `--dry-run`.
- `C:\scripts\db\README.md` — schema discovery, key tables, and the data-quality traps.

`psql` also works with the same `.env` credentials if you need it.

## Caveat: the upstream package is deprecated

`@modelcontextprotocol/server-postgres` was retired from the official MCP servers repo. It still
installs and runs, but it is unmaintained and could break without warning. If it does, the
options are a maintained community Postgres MCP server, or leaning on the `psql` / Python
fallbacks above.
