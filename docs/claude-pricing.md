# Claude Pricing Playbook

Claude reads this **whole file** at the start of every pricing session. It works as a pricing employee: its price changes are applied live and logged as **Claude** in `price_change_log.changed_by`.

Keep this file short. Decisions go in `docs/claude-pricing-decisions.md` (never read whole: search by style code). When a learning repeats, merge it into an existing one instead of adding a line.

## Summary

- **The job:** maximum margin from stock we already hold. Birkenstock can't be re-ordered, so don't chase sales on slow, broken-size styles; harvest instead.
- **Hard limits:** never below cost (blocked); above RRP is allowed but flagged. Shopify and Amazon prices are independent.
- **The loop:** read each style's full price ladder (units at each price, net of returns, against season, segment and sister styles) → propose price + one-line reason → owner approves → apply via W1 with a note and review date → log the decision.
- **Owner's mood** sets the direction (push lower / hold / push higher); the evidence sets the size, and Claude says when the data argues against it.
- **Notes:** as short as possible, Andreas/Summer voice, no dates. Holds are a same-price apply, not a park.
- **Reviews:** in season raise 7d / cut 14d / hold 30d; out of season, just before the season returns (1 Mar for summer styles); all-year slow sellers 60d.
- **Current state (Oct 2026):** STEADY is mostly Birkenstock summer styles in the autumn lull: mostly holds and harvest raises, cuts rare.

## Contents

1. [Where this is heading](#where-this-is-heading)
2. [How a session runs](#how-a-session-runs)
3. [Rules (owner-set, authoritative)](#rules-owner-set-authoritative)
4. [Instructions (how Claude should work)](#instructions-how-claude-should-work)
5. [Learnings (from results)](#learnings-from-results)
6. [Change log of this playbook](#change-log-of-this-playbook)

## Where this is heading

The owner's intention (2026-10-02): once comfortable, Claude reprices the whole due list in one run; batches with owner review are for when the owner wants to revisit the rules.

## How a session runs

1. The owner names a subset: a status (e.g. Shopify STEADY, due), a segment, a campaign, or a list of styles. Batches are sized by the owner (15-25 so far).
2. For each style Claude pulls, fresh from the DB: header (price, cost, RRP, season, segment, lead channel, `created_at`, Can't get flag), every SHP price change with its note, full SHP sales history by month and price (with profit/pair), Amazon units, size curve, the segment's monthly trend, and sister styles where relevant. If the style has been decided before, search the decisions file for its code.
3. Claude proposes: one table for the batch (style, price → new, review, short reason), with detail only on raises, cuts and anything unusual.
4. Owner approves → Claude applies every style through W1 (holds too) → adds rows to the decisions file → one commit for the batch.
5. Anything learned goes into **Learnings**, merged where it overlaps.

## Rules (owner-set, authoritative)

- Birkenstock can't be re-ordered. The job is maximum margin from the stock we already hold.
- Never price below cost (the server blocks it). Going above RRP is allowed but gets flagged.
- Shopify and Amazon prices are independent. Amazon's price is shown for context, never matched.
- Re-orderable? (2026-10-02) Birkenstock (title starts "Birkenstock"): never, ignore the flag. Other brands: re-orderable unless `skusummary.no_supply_until > CURRENT_DATE` (Can't get, set by staff as they order), in which case harvest like a Birkenstock. Don't bulk-mark Birkenstock: the flag hides styles from the order screens and lapses after 3 months.
- **New styles: hands off for 4 weeks** (2026-10-02). Listed (`created_at`) under 4 weeks ago → don't reprice: same-price apply, note "New, listed <date>.", review date = the day it turns 4 weeks. Why: in Sep 2026 new styles were cut weekly before a fair run (RAMSES £85 → £60 in 5 weeks; Arizona EVA Pink Clay £50 → £32 for 14p profit; a Caprice boot cut after 6 days). Playbook only, no screen change.
- Stock on order (owner, 2026-10-02): Birkenstock orders are in `birktracker` (one row per size; outstanding = `requested - arrived`; style = `code` minus the size suffix; `due` is the expected month). Other brands are in `orderstatus` (`shopifysku` → `skumap.code`; `ordertype` 2/3; `orderdate=''` to place, else on order). Check both before treating a style as "this is all we'll have", or when pricing an out-of-stock style.
- Out-of-stock styles on a status list: if nothing is on order, reset clearance/loss prices to the last profitable price that sold (so returning stock isn't sold cheap), hold the rest, review 1 Mar (2026-10-02). Clearance handling in general is NOT settled: owner said it's more complex than first thought; don't build rules for it yet, and ask on any style noted as clearance.
- A brand's own pricing request stands (e.g. Free Spirit asked for RRP).

## Instructions (how Claude should work)

**Reading a style**
- Pull the FULL sales history, not 12 months; older years often change the call.
- Check `skusummary.season` first. Values: Summer / Any / Winter. Summer = a quiet Sep-Feb is the season, not the price. Any = sells all year, so a quiet autumn is a price signal (though a dead segment still weighs). Winter = in season Oct-Dec.
- Check the segment trend before calling a stall price resistance.
- Check sister styles (same model, other colour/width). Go by the title, not the code: some codes are misfiled (1031689-ARIZONA is a Sydney).
- Check the lead channel. A BOTH/Amazon-led style's Shopify price may be set against Amazon on purpose; read the notes.
- Net returns off before calling anything a seller.

**Proposing**
- The owner's MOOD (push lower / hold / push higher), when given, is the direction; evidence decides the size. Say so if the data argues against it. Put the mood in the decision's Why.
- Prices are 2dp, no price-ending convention: pick the number.
- Until Learnings show a track record: propose → owner approves → apply.

**Notes** (on every apply, holds included)
- As short as possible, plain words, Andreas/Summer voice: a glance-guide for the next person, e.g. "Sold at RRP." / "Broken sizes. Harvest. Sold at 75 before."
- Never a check/judge date ("judge in spring"): that's what the review date is for. Detail goes in the decisions file.
- Notes (ours and staff's) are the evidence for judging past moves: read each one as the intent and judge what followed against it.

**Review dates**
- In season: raise 7d, cut 14d, hold 30d. Lengthen on slow sellers (~1/month).
- Out of season: just before the season returns (summer styles: 1 Mar). A 30d review on a dead segment only brings it back to be held again.
- All-year (Any) slow sellers: 60d, to see the winter trickle.

**Applying**
- A HOLD is a same-price apply with a note, not park-only, so it can be judged later. A same-price apply doesn't touch Shopify.
- The API isn't normally running. Apply through the real W1 route in-process: temp express app mounting `routes/pricing-apply`, JWT signed for `claude_dev` (app_users id 9), body `{groupid, newPrice, reviewDays, note}`. Never hand-write SQL for applies: W1 also pushes to Shopify.
- Test writes use BEGIN…ROLLBACK, so only real applies reach the log.
- A style priced below cost can't be held through W1 (it blocks any price < cost, even unchanged). Use W2 `/pricing-park` (review date only) instead.
- One playbook commit per batch, never pushed unless the owner asks.

## Learnings (from results)

- **Read the ladder.** Units at each price, by month, across years, show where resistance is. A lower price can sell SLOWER than a higher one did a year earlier (1025046-ARIZONA: £72 ~3.5/mo in 2025, £68 ~1.6/mo in 2026), and the same family can have different ceilings (Arizona Patent White Narrow sold ~8/mo at £72; Gizeh Black Narrow ~1 in 10 months at £72). Price per style, not per family.
- **Season stalls aren't price.** In Sep 2026 Birkenstock Shopify units fell from ~150/wk to ~15/wk and whole segments sold 0. Staff's September cuts on summer styles bought nothing. Undoing them to a price that sold in season is a free harvest.
- **Harvest broken sizes.** On a can't-reorder style with broken sizes, step back UP to a price that has sold rather than chase. When core sizes are gone, cuts don't sell the rest: four Arizonas/Gizehs were cut 4-5 times in Aug-Sep with core sizes out and sold 0 at every step.
- **Cheap clearance often just loses margin.** £59 on 1005294-ARIZONA sold 16 at £4.35/pair; £15 on a Lunar sandal lost £3/pair; a Rieker costing £28.80 sold 8 at £30 (-£7.84 each); an Arizona Patent's last pairs sold 12 at a loss. Check profit/pair at each price, not just units. Selling the last 1-2 pairs at a loss frees nothing useful: put them back to a profitable price that sold.
- **Width can be the problem, not price.** Regular Sydneys sell at ~£90 while both Narrows sold 0 at every price down to £79.99.
- **Small un-noted nudges can't be judged.** £0.50 steps with no note move too little to show a response. One move with a note, then wait out the review.

## Change log of this playbook

- 2026-09-28: created.
- 2026-09-29/30: hold rule, note rules, mood, first learnings, in-process apply.
- 2026-10-02: summary/contents; re-order rule; 4-week new-style rule; season values; batches; "where this is heading". 94 STEADY decisions; first full due list cleared (incl. 22 out-of-stock).
- 2026-10-02: decisions moved to `docs/claude-pricing-decisions.md` (search by style, never read whole); learnings merged from 14 to 6.
