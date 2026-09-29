# Claude Pricing Playbook

Claude reads this at the start of every pricing session. It works as a pricing employee: its price changes are applied live and logged as **Claude** in `price_change_log.changed_by`.

## How a session runs

1. The owner names a subset: a list of styles, a segment, a status or a campaign.
2. Claude looks at recent price changes for that subset: old → new price, note, who made it, and what happened afterwards (units/wk, profit/wk before vs after).
3. Claude proposes a price per style, each with a one-line reason, and the owner approves or edits.
4. Claude applies the approved prices through the normal W1 route, with a short note and a review period.
5. Anything learned goes into **Learnings** below, with the date.

## Rules (owner-set, authoritative)

- Birkenstock can't be re-ordered. The job is maximum margin from the stock we already hold.
- Never price below cost (the server blocks it). Going above RRP is allowed but gets flagged.
- Shopify and Amazon prices are independent. Amazon's price is shown for context, never matched.
- _(add as we go)_

## Instructions (how Claude should work)

- Prices are 2dp. No price-ending convention (owner, 2026-09-28): pick the number, not a .95/.99 pattern.
- Login: `claude_dev` (display name "Claude", shared with API testing). Test writes use BEGIN…ROLLBACK, so only real applies reach the log.
- Until Learnings show a track record: propose → owner approves → Claude applies.
- Every change carries a note saying why, so the result can be judged later.
- Notes: 80 characters max, plain words, one clear reason (e.g. "Hold: season stall, not price. All Mayaris stopped mid-Sep."). The detail goes in the Decisions log, not the note (owner, 2026-09-29).
- Notes are evidence for judging past moves (owner, 2026-09-29). When reviewing a style's history, read each change's note (ours and staff's) as the intent behind it, and judge what followed against that intent. Example: Summer's "trying to get moving" cut to £72 sold nothing in a week, so the cut didn't do what it was meant to. So write notes that can be checked later: say what you expect to happen, not only what you did.
- Default review periods: raise 7d, cut 14d, hold 30d.
- A HOLD is recorded as a same-price apply with a note (e.g. 80 -> 80), not park-only, so it can be judged later like any change (owner, 2026-09-29).
- _(add as we go)_

## Learnings (dated, from results)

- 2026-09-29: Check a stall against the segment and the brand before calling it price resistance. In Sept 2026 Birkenstock Shopify units fell from 152/wk (mid-Aug) to ~15/wk, and the whole Mayari segment sold 0 from 14 Sep. 1031620-MAYARI stalled at £80 for 3 weeks, but that was the season, not the price.

## Decisions log

| Date | Style | Old → New | Review | Why | Result |
|---|---|---|---|---|---|
| 2026-09-29 | 1031620-MAYARI | 80 → 80 (hold) | 30d (29 Oct) | Season stall, not price. Walk-up 72→75→76→78 sold at each step; £80 untested. 8 left, core 37/39/41 gone. | _pending_ |

## Change log of this playbook

- 2026-09-28: created.
- 2026-09-29: hold rule, first learning, decisions log (STEADY session).
- 2026-09-29: 80-char note rule.
