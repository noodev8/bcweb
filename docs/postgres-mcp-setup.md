# Postgres MCP — removed (Jul 2026)

There is no Postgres MCP server any more, and one should not be reinstated without asking
the owner first. This file exists so that a future session looking for the old setup
instructions finds the decision instead of a dead end.

## Why it went

- `@modelcontextprotocol/server-postgres` was deprecated upstream and unmaintained.
- Its config lived in a gitignored `.mcp.json` that had to be hand-recreated on every
  machine, and kept silently going missing as a result.
- It only worked inside an interactive Claude Code session — not on the VPS, not under cron.

## Query the database this way instead

`C:\scripts\db\query.py` — read-only ad-hoc queries, credentials from `C:\scripts\.env`:

```bash
python C:/scripts/db/query.py "SELECT count(*) FROM sales"
```

`C:\scripts\db\README.md` is the full front door: schema discovery, the key tables, and the
data-quality traps (retired `_delete` tables, the unusable `skusummary.variants` /
`stockvariants` columns, size-coverage denominators).

From Node in this repo, connect with `pg` using `DB_*` from `bcweb-server/.env` — the same
credentials, the same live `brookfield_prod` database.

> ⚠️ That is the **live production database**, shared with the pricing tool and the owner's
> Python scripts. `query.py` enforces a read-only transaction; a direct `pg` connection does
> not, so be careful what you run.
