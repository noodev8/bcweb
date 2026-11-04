# Skills for this repo

A skill is a folder here with a `SKILL.md`: a short description (how the right skill gets picked — keep each one distinct) and the
steps to follow. The **rules and the writes live in code** (a util / script the skill calls); the skill says how to run them and
how to talk them through with the owner. They travel with the repo (`git pull`); the `.gitignore` lets `.claude/skills/` through.

House rules:
- **One job per skill**, a description that doesn't overlap another's.
- **A skill that writes goes through a guarded script** (dry run by default, `--commit`) — never hand-written SQL.
- **Record what goes wrong** (in the skill's memory note) so each improvement has a reason; update `Reviewed` below when it's changed.
- **Retire** a skill when its process changes: delete the folder and its line here (git history keeps it).

| Skill | What it's for | Writes? | Calls | Reviewed |
|---|---|---|---|---|
| `/amz-pricing` | Amazon pricing standard — a verdict + suggested price per size, judged against its sister sizes; can set one price the owner agreed | Only an agreed price (one `amz_price_log` row → upload basket) | `bcweb-server/scripts/amz-pricing-check.js` (read only), `scripts/amz-price-set.js`; rules `utils/amzPricingStandard.js` | 2026-11-04 |
| `/descriptions-review` | Shopify descriptions review — clean them and approve new/changed ones for the Google feed and eBay | Yes — approvals into `shopify_description` | `D:\projects\scripts\merchant-feed\descriptions.py` (scripts repo) | 2026-11-03 |
