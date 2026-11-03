---
name: descriptions-review
description: Run the Shopify descriptions review — fetch every product description from Shopify, clean it, and approve the new/changed ones into shopify_description.description, which the Google Merchant feed and eBay listing read. Use when the owner asks to "do the descriptions", "review descriptions", "run the description review", or the monthly descriptions job.
---

# Descriptions review

The approved plain-text description of each product lives in `shopify_description.description` (LIVE DB, `brookfield_prod`).
Two things read it, and neither ever calls Shopify:
- **Google Merchant feed** — nightly `merchant_feed.py`; an unapproved product goes out with its title.
- **eBay listing** (bcweb) — `utils/ebayCandidates.js`; a style with no approved description is blocked ("description") on Not on eBay.

The tool is `D:\projects\scripts\merchant-feed\descriptions.py` (README beside it). It is NOT in this repo.

## Running it

Run from the **scripts** checkout (`D:\projects\scripts` on the main PC; repo `noodev8/scripts` — on another machine find it
beside this repo, and `git pull` it first). The script reads that folder's `.env` for the DB and `SHOPIFY_ACCESS_TOKEN`.
Use the real Python: `PYTHON_BIN` in `bcweb-server/.env` on this machine — never bare `python` on Windows (the Microsoft
Store placeholder). If neither the folder, the `.env` nor Python is there, stop and tell the owner what's missing.

```
cd D:\projects\scripts
& "<PYTHON_BIN>" merchant-feed\descriptions.py review
```

`review` fetches every product's HTML (two Shopify calls), upserts `description_html`, and writes the proposals to
`D:\projects\scripts\merchant-feed\logs\description_review.md`. `--no-fetch` reviews the stored HTML without calling Shopify.
Reading/fetching is safe; **approving writes the live table** — only approve what the owner has agreed to.

## Steps

1. Run `review`. Report the one-line result (N to approve, M with words to check). If 0, say so and stop.
2. Read `description_review.md`. Each entry is `### <groupid> - NEW|CHANGED [- CHECK: words]` and the proposed text.
3. Sort the entries for the owner — **show only what needs a decision**, one small decision at a time:
   - **Fine** — reads well, no flags, or flags that are harmless in context ("Free Spirit", "pressure-free cuff", "sale" inside
     a word). Batch these: "N look fine — approve them?"
   - **Check** — a flagged word that really is a claim Google rejects: delivery / dispatch promises, "free returns", discounts,
     "% off", "click here", "order by 2pm". Quote the sentence and propose a fixed text.
   - **Thin** — the proposal fell back to `<title>. Stock Code: …` (cleaned body under 40 characters). Fine to approve as is;
     note that a proper description written **in Shopify** would help the website too.
4. Approve as agreed:
   - `approve <groupid> [<groupid> ...]` — the proposals as written
   - `approve <groupid> --text "Hand-written text"` — one style with your fixed text (single groupid only)
   - `approve --all` — only if the owner says approve everything
5. Re-run `review --no-fetch` to confirm 0 left (or list what was deliberately left), and give a short summary.

## Rules worth knowing

- The cleaner keeps the **"Stock Code: …"** line on purpose — shoppers search by style code. Don't strip it in a `--text` fix.
- An approval stores which Shopify version was reviewed (`approved_html`); a later edit in Shopify shows as CHANGED next time,
  and until then the last approved text keeps going out.
- The pending list covers **every Shopify product that is one of our styles** (has a `skusummary` row), Google-live or not
  (owner, 2026-11-03 — it was Google-live only, which could leave an off-Google style blocked on eBay). The gift card has no
  style and never appears. The feed still only SENDS Google-live products; approving an off-Google one just stores its text.
- A better fix is in Shopify, not in `--text`: a hand-written text drifts from the website. Use `--text` for Google-only problems.
- Product type / Google category (`merchant_product_type`, same folder) is a separate review — not part of this skill.
