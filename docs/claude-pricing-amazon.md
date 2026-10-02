# Claude Pricing Playbook — Amazon

Claude reads this **whole file** at the start of every **Amazon** pricing session. Shopify has its own playbook (`docs/claude-pricing-shopify.md`); read its Learnings for context, but don't carry a Shopify lesson over without checking it against Amazon data — the economics differ.

Keep this file short. Decisions go in `docs/claude-pricing-amazon-decisions.md` (create on the first decision; never read whole: search by SKU code). When a learning repeats, merge it into an existing one instead of adding a line.

## Summary

- **Status: not started.** No Amazon pricing sessions yet. The rules below are the known mechanics; Instructions and Learnings fill in as sessions run.
- **The job:** same as Shopify — maximum margin from stock we already hold.
- **Grain is the SKU (size), not the style.** Amazon prices per size (`code`); one style can run at several prices.
- **Hard limits:** `/amz-apply` blocks below `cost + fbafee` and flags above RRP — but that floor is far below real breakeven (see Rules).
- **No live push.** An apply only logs to `amz_price_log`; the price reaches Amazon via the Seller Central upload file.

## Rules (owner-set, authoritative)

- Birkenstock can't be re-ordered. The job is maximum margin from the stock we already hold. Same re-orderable test as Shopify (Birkenstock never; other brands unless Can't get is set).
- Shopify and Amazon prices are independent. Never set an Amazon price by Shopify's, or vice versa.
- An Amazon SKU takes its style's portfolio status. The Amazon status list shows only AMZ- and BOTH-led styles.
- A brand's own pricing request stands.

## Mechanics (how Amazon differs from Shopify)

- **Real breakeven ≈ (cost + fbafee) × ~1.5.** VAT (÷1.2) and the ~15% referral fee do the damage, not the FBA fee. Worked example: Rieker 17659-23, cost £34.20 + fbafee £3.39 = guard £37.59; true breakeven ~£57. Never treat "passed the guard" as profitable.
- **Margin by price band (12m, whole book, Jul 2026):** under £45 10.9%, £45-60 4.7%, £60-75 9.3%, £75+ 13.6%. £45-60 is where fees eat everything.
- **`sales.profit` (AMZ) is "what we keep on a unit"** after fees and a flat ÷1.2 returns haircut; returns are bare reversal rows. Use it for profit/unit at each price, as on Shopify.
- **Live price/stock is `amzfeed`** (FBA-only, READ ONLY). Per-size `amzprice` can wander widely across one size run — check the run before concluding a style "doesn't sell".
- **Applying:** `POST /amz-apply` (logs to `amz_price_log`; optional `reviewDays` sets `skumap.next_amz_price_review`). Never write `amzfeed`. Review-only uses `/amz-review`. Test writes use BEGIN…ROLLBACK.
- **Stock that matters is FBA stock**, plus local stock that can still be picked to FBA.

## Instructions (how Claude should work)

_To be written from the first sessions. Start by asking the owner how an Amazon session should run (batch shape, which list, holds-as-applies or not)._

## Learnings (from results)

_None yet._

## Change log of this playbook

- 2026-10-02: created when the pricing playbook was split by channel. Mechanics seeded from the codebase notes; no sessions yet.
