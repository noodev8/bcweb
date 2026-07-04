# PostgreSQL MCP setup (bcweb) — per-machine

The Postgres MCP server lets Claude query the Brookfield production DB (`brookfield_prod`)
directly. The config lives in a **project-scoped `.mcp.json` at the repo root**. That file
holds the DB password in its connection string, so it is **gitignored and does NOT travel
with the repo** — you recreate it on each machine (laptop, desktop). These are the steps.

> ⚠️ This connects to the **LIVE production database** — the same one the pricing tool and the
> owner's Python scripts write to. Reads are safe; treat it as read-mostly. Do not run
> destructive SQL (UPDATE/DELETE/DROP) against it for exploration.

---

## Instructions for the AI (desktop machine)

When the user asks you to set up the Postgres MCP on a new machine, do this:

1. **Confirm the file doesn't already exist:** check for `C:\bcweb\.mcp.json`. If present and it
   contains a `postgres` server, it's already set up — skip to step 4 (activation).

2. **Get the password.** It is the `DB_PASSWORD` value in `bcweb-server/.env`
   (same value as `C:\scripts\.env`, per CLAUDE.md). Do NOT hard-code it into any committed
   file. If `bcweb-server/.env` doesn't exist yet on this machine, ask the user for the password.

3. **Create `C:\bcweb\.mcp.json`** with exactly this shape (Windows form — see notes below),
   substituting the real password for `YOUR_PASSWORD`:

   ```json
   {
     "mcpServers": {
       "postgres": {
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

   `.mcp.json` is already in `.gitignore`, so this stays local. Confirm with
   `git check-ignore .mcp.json` (it should echo the filename).

4. **Activation (the user must do this — a running Claude Code session cannot hot-load a new
   MCP server):**
   - Restart Claude Code in the `C:\bcweb` directory.
   - On start, Claude Code detects the project `.mcp.json` and asks the user to **approve** the
     project's MCP servers. Approve it.
   - Verify with `/mcp` (should list `postgres` as connected) or `/doctor` (no MCP warnings).

5. **Smoke test:** ask Claude to run a trivial read, e.g. `SELECT current_database(), now();`
   via the postgres MCP tools. A raw connectivity check without the MCP is:
   ```
   cd bcweb-server && node -e "const{Client}=require('pg');const c=new Client(process.env.PG||'postgresql://brookfield_prod_user:YOUR_PASSWORD@217.154.35.5:5432/brookfield_prod');c.connect().then(()=>c.query('select now()')).then(r=>{console.log('OK',r.rows[0]);return c.end()}).catch(e=>{console.error('FAIL',e.message);process.exit(1)})"
   ```

---

## Connection details

| field    | value                |
|----------|----------------------|
| username | `brookfield_prod_user` |
| password | (from `bcweb-server/.env` → `DB_PASSWORD`) |
| host     | `217.154.35.5`       |
| port     | `5432`               |
| database | `brookfield_prod`    |

Connection string format: `postgresql://username:password@host:port/database`

## Windows notes (important — these are the gotchas)

- **Always use `"command": "cmd"` with `"/c"` as the first arg.** Never `"command": "npx"`
  directly on Windows — it fails / throws warnings.
- **Do not add `"type": "stdio"` or an empty `"env": {}`** — unnecessary and can cause warnings.
- If `/doctor` shows an MCP warning, it's almost always one of the two mistakes above.

## Why project-scoped `.mcp.json` (not `~/.claude.json`)

Either works, but a project `.mcp.json` is one small file, auto-loaded when Claude Code runs in
this repo, and trivial to recreate — versus hand-editing the large shared `~/.claude.json`.
It mirrors how the `klaviyo` server is configured in the `c:/scripts` project.
