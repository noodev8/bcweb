# PostgreSQL MCP setup — per-machine (Windows)

The Postgres MCP server lets Claude query the Brookfield production DB (`brookfield_prod`)
directly, instead of going through a Python script or `psql`.

The config lives in a **project-scoped `.mcp.json` at the repo root**. That file holds the DB
password in its connection string, so it is **gitignored and does NOT travel with the repo** —
you recreate it on each machine. This is the single most common reason it "disappears": nothing
is broken, the file just isn't on this machine.

This doc is kept **identical in both repos** — `C:\scripts\docs\postgres-mcp-setup.md` and
`C:\bcweb\docs\postgres-mcp-setup.md`. Edit one, copy to the other.

> ⚠️ This connects to the **LIVE production database** — the same one the pricing tool and the
> Python scripts write to. Reads are safe; treat it as read-mostly. Do not run destructive SQL
> (UPDATE/DELETE/DROP) against it for exploration.

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

## If it goes missing

Work through these in order — the first two cover almost every case:

1. **`.mcp.json` is absent or has no `postgres-brookfield` block.** Most likely. Recreate per
   above. Note `C:\scripts\.mcp.json` has held only `klaviyo` since Apr 2026.
2. **Wrong machine.** Config does not sync between `aandr` and `UserPC`. "It worked yesterday"
   often means it worked on the other machine.
3. **The approval dialog was dismissed** rather than approved on session start — the server
   exists in config but isn't enabled. Check `enabledMcpjsonServers` in
   `.claude\settings.local.json`; it should list the server (or
   `"enableAllProjectMcpServers": true` should be set).
4. **npx/network.** The server is fetched from npm on each start. Test with
   `npx -y @modelcontextprotocol/server-postgres --help`.

## Fallbacks when the MCP isn't available

Not having it is inconvenient, not blocking. Both are already allowlisted:

- `psql` directly — `PGPASSWORD=... psql -h 217.154.35.5 -U brookfield_prod_user brookfield_prod -c "..."`
- A short Python script using `logging_utils.get_db_config()`, which reads the same `.env`.
  This is how the scheduled scripts do it and is the more reliable route.

## Caveat: the upstream package is deprecated

`@modelcontextprotocol/server-postgres` was retired from the official MCP servers repo. It still
installs and runs, but it is unmaintained and could break without warning. If it does, the
options are a maintained community Postgres MCP server, or leaning on the `psql` / Python
fallbacks above.
