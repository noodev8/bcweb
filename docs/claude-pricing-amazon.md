# Claude Pricing Playbook — Amazon

Claude reads this **whole file** at the start of every **Amazon** pricing session. Shopify has its own playbook (`docs/claude-pricing-shopify.md`); read its Learnings for context, but don't carry a Shopify lesson over without checking it against Amazon data — the economics differ.

Keep this file short. Decisions go in `docs/claude-pricing-amazon-decisions.md` (create on the first decision; never read whole: search by SKU code). When a learning repeats, merge it into an existing one instead of adding a line.

## Summary

- **Status: first session 2026-10-02** (STEADY, due). Instructions and Learnings fill in as sessions run.
- **0 FBA = no reprice**, review-only 14d (out of season: until the season returns).
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

- **Session shape (owner, 2026-10-02):** one style at a time (all its due SKUs together). A hold on an in-stock SKU is a same-price `/amz-apply` with a note, as on Shopify.
- **Go with the data, not the mood** (owner, 2026-10-02: "forget my mood for the moment"). State the evidence and the call; don't steer by a push-lower/higher mood until the owner reinstates it.
- **0 FBA: don't reprice** (owner, 2026-10-02). A SKU with no FBA stock (local stock doesn't count: it can't sell on Amazon until picked) gets review-only (`/amz-review`: writes a same-price hold row for Analytics, which the upload basket filters out as a no-op): **14 days**, or if the style is out of season, until the season returns (summer: 1 Mar). This applies even to a loss-making price.
- **FBA stock = price it, full stop** (owner, 2026-10-02), in season or not. Season only sets the review date for parked 0-FBA SKUs.
- Only SKUs actually due are touched; a style's not-due sizes are left alone.

**Applying:** in-process, like Shopify W1: temp express app mounting `routes/amz-apply` (or `routes/amz-review`), JWT signed for `claude_dev` (app_users id 9). `/amz-apply` body `{code, newPrice, reviewDays, note}`; `/amz-review` body `{codes:[…], reviewDays}`.

## Learnings (from results)

- **Staff cuts in Aug-Sep on Amazon mostly bought pennies.** Several sizes were walked down one at a time to near breakeven (Summer White £29 = 12p/pair, Deanaaii £31 = ~£1, Blaise size 3 £28.49) and sold no faster than siblings left at the proven price. Check profit/pair at each step, not units.
- **Most of the due list is 0 FBA.** STEADY due on 2 Oct: ~200 of ~215 SKUs had no FBA stock; only 12 needed pricing.

## Change log of this playbook

- 2026-10-02: created when the pricing playbook was split by channel. Mechanics seeded from the codebase notes; no sessions yet.
