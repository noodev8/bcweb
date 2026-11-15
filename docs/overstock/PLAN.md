# Overstocked — plan and decisions

The record for pricing OVERSTOCKED sizes: the Stock ladder's Overstocked label (`utils/stockLadder.js`, `docs/stock-ladder.md`) turned
into a way to mark those sizes down. Decisions are numbered and dated and are not re-opened without the owner.

## Why (owner, 2026-11-15)

"The overstock screen is probably one of the most important. It means we control our inventory and cashflow better." Styles came
through their first 90 days and sold — "and I have got excited and bought too much". The order screens stop the buying; this is about
the stock already here: "give those sizes a chance to sell by dropping their price. What do I need to know? Which ones they are on a SKU
basis. Then I will decide how far down to take them."

The example is Milano (0034791-MILANO): the style sold all summer (sizes 39 / 40 about 5 pairs a month, May–August) while 37 and 38 ended
the season holding 5 and 9, and 35 / 36 hardly sold at all. Across the summer styles that sold 10+ pairs April–August 2026, 565 pairs
(£19.2k at cost, 554 Birkenstock) were still held in November; 180 of them in sizes that sold 0–1 all summer.

Shopify was the gap: Range's Overstocked tag only reached the 10 sizes at Amazon. A Shopify style card can't help — in 2026-11-15's 41
Overstocked styles NO style had every held size overstocked, so a style price cut would cut selling sizes too (CLAUDE.md: never cut a
style to clear its dead sizes). The owner's answer: "keep the same style in Shopify and price just the ones we needed to clear" — a SIZE
price (`utils/sizePrice.js`).

## Considered and set aside (2026-11-15)

- **A season-end forecast** (pairs held minus the style's pace × the size's share until its season ends) as a new Overstocked measure.
  Set aside: not every style has a season, and the owner: "are we over thinking this?" — the Overstocked figure already calculated is
  the right list for now. Its known blind spot: a size that never sold (Milano 35) is never "overstocked"; it climbs Unsold 90 / 180
  to Clearance instead.
- **Order quantities from the size share** (stop the over-buying at the source, Birkenstock ordered ~6 months ahead): the order screens'
  job, not this one.

## Decisions

1. **One Shopify card per STYLE, with a size price box for each of its Overstocked sizes beside the style price (owner, 2026-11-15:
   "yes that is what I meant").** The card comes due on the style's normal review date (`skusummary.next_shopify_price_review`), and
   Set / Leave set the next one — so Due, Daily and the Shopify list are unchanged, and the size prices come back for a look every time
   the style does (size prices have no review date of their own). Most of these styles have ONE overstocked size (that day about half
   were "1 of 4–8 sizes"), so in practice it is mostly a one-size card. The sizes at Amazon stay on the Amazon step cards, as built.
   That day: 71 SKUs, 232 pairs over, 41 styles (60 SKUs Birkenstock, all local; 10 at Amazon); 39 of the 41 styles parked, 29 of
   them coming due in November.

2. **An overstock size price STAYS in paid Google Shopping; a clearance one stays out (owner, 2026-11-15, option A).** The no-ads rule
   was made for clearance ("no ad spend on clearance stock"); an overstocked size is still selling, and the markdown is there to speed it
   up — taking its ads away at the same moment works against it. So a size price remembers where it was set (overstock card vs
   clearance / the drill) and the Google feed (`utils/merchantFeed.js` nightly, `utils/googleMerchant.js` 2-hourly) leaves only the
   clearance ones out of Shopping_ads. The ad shows the lower price (`sale_price`). Rejected: B, leave them out like clearance (no
   change, but the size loses its ads exactly when it should sell). The cost watched: a deep markdown pays the same per click on a
   thinner margin — the card's profit line at the box shows it before Set.

3. **An overstock size price box starts at TODAY'S STYLE PRICE (owner, 2026-11-15, option A)** — taken down by hand with the
   −£1 / −£2 / −£5 steps, profit line moving; nothing suggested, as the Amazon step cards (option A there too). Left at the style price,
   the size gets no size price. Owner: "I will decide how far down to take them." Rejected: B, a set first markdown (e.g. 10% off — a
   fixed rule, as the per-step cut rejected on 15 Nov); C, the drill's 50% of RRP (a clearance figure, far too deep for a selling size).
   A quick "usual first cut" button can come later if the presses show a habit.

4. **What the card shows (owner, 2026-11-15: "ok for now").** The Shopify card as it is (style price + steps, profit, Google, Amazon's
   dearest size, the reason line) plus, under the style price, one row per OVERSTOCKED size: size · Held (local + Amazon, "n at Amazon"
   beside it) · Over (pairs beyond 4 months' worth) · Sold 90d · a size price box with −£5 / −£2 / −£1 / +£1 · profit a pair at that
   box (red only for a loss). The other sizes stay behind the "sizes" link. Reason line e.g. "Overstocked — 2 sizes, 9 pairs over 4
   months' worth". Left out on purpose: 12-month sales, cost, money tied up (qty is shown, never a rule; cost is in the profit line).

5. **Set and Leave (owner, 2026-11-15: "yes").** SET saves everything changed in ONE transaction with the chosen review date: the style
   price if moved (W1, logged as now), each overstocked size whose box is below the style price as a size price (W-S1), and the style's
   review date even when only a size moved — then ONE push to Shopify. LEAVE: no price change, the review date moves (W2). A size box
   raised back to the style price or above ends that size's price (back to the style price). A size that already has a size price (e.g.
   from Clearance) starts its box at that price. The existing rule stands: a style price dropped to or below a size price ends it (the
   card's quiet note). The Set button is red "down" when only sizes go down.

6. **The overstock section shows only sizes overstocked NOW; a markdown never ends by itself; the reminder is on the NORMAL Shopify
   cards (owner, 2026-11-15: "if it is not overstocked anymore, then it shouldn't be in the overstock section but how would I know to
   bring it back in line" … "Perfect").** A size that sells down to 4 months' worth or less leaves the overstock cards; its size price
   stays (nothing raises a price behind the owner's back). The style still has its review date, so it comes due on the normal Shopify
   price cards, which already show every size price in force — there, a size price set as an overstock markdown on a size that is no
   longer overstocked gets a small "no longer overstocked" tag and a **Back to style price** button (ends it, logged as 'back'). Set /
   Leave there move the review date as normal. It still ends by itself on sell-out or the style price dropping to it, as now.
   Technically: the size price row records where it was set (decision 2 needs that too), and the Shopify cards' data asks the Stock
   ladder whether each size-priced size is still overstocked. Rejected: B, end it automatically when no longer overstocked (a price
   rise overnight after one sale, and a bounce: down, sells, up, stops, overstocked again).

7. **Where it opens (owner, 2026-11-15: "agree"):** Range's amber Overstocked tag opens the same Amazon | Shopify choice as Arrived /
   Unsold. Amazon = the step cards for the overstocked sizes at Amazon (Due); Shopify = the overstock cards, one per style (Due, the
   All | Due switch). The line under the doors: "71 SKUs = 71 on Shopify cards, 10 of them also at Amazon" (Shopify sells the pairs at
   Amazon too). No menu entry, no Daily figure — later, if the cards earn it.

## The build, in order (built 2026-11-15 — migration `20261115b_size_price_kind.sql` to apply before the server deploy)

1. **Size price kind** — `shopify_size_price.kind` ('clearance' | 'overstock', existing rows 'clearance'; the log too). `utils/sizePrice.js`
   takes it; the Google feed (`utils/merchantFeed.js`) and the 2-hourly send (`utils/googleMerchant.js`) leave only 'clearance' out of
   Shopping_ads (decision 2). Migration applied by the owner before the server deploy.
2. **The overstock cards** — `GET /pricing-all-list?step=overstocked` (styles with an overstocked size; each row's overstocked sizes:
   held, at Amazon, over, sold 90d, size price in force); one write route saving style price + size prices + review date in one
   transaction, then one Shopify push (decision 5); the card's overstock table (decision 4); the Overstocked choice (decision 7).
3. **The reminder on the normal Shopify cards** — "no longer overstocked" + Back to style price (decision 6).
