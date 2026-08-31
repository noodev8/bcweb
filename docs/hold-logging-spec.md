# Spec — Log the HOLD decision (and stop no-op prices reaching the channels)

Status: SPEC ONLY, not built. Raised 2026-08-31 from the Price Changes screen reading "2 held" out of 654.

## 1. The problem

A hold is a real pricing decision: *this price is right, leave it, look again in N days*. The operator makes it constantly.
It is currently recorded **nowhere**.

| Action | Route | What it writes |
|---|---|---|
| Apply a Shopify price | `pricing-apply` (W1) | `skusummary.shopifyprice` + a `price_change_log` row |
| Apply an Amazon price | `amz-apply` (W-A1) | an `amz_price_log` row |
| **Hold (Shopify, one)** | `pricing-park` (W2) | `skusummary.next_shopify_price_review` — **no log row** |
| **Hold (Shopify, bulk)** | `pricing-park-bulk` | same — **no log row** |
| **Hold (Amazon)** | `amz-review` | `skumap.next_amz_price_review` — **no log row** |

Consequences:

- The Price Changes summary and the Impact grid only ever see moves, so the screen implies every decision is a price change.
  It is not; a chunk of the team's work is simply off the board.
- Holds cannot be attributed. There is no way to tell a considered hold from a style nobody looked at.
- **Not recoverable.** `next_*_price_review` is a single value with no history. Only fixable forward.

What "2 held" actually counts today: log rows where `new_price = old_price` — someone went through Apply and typed the same
number. An accident, not a decision. Hence 2.

## 2. The fix, in one sentence

Make the three park routes write a log row with `new_price = old_price`, which the scorer **already** classifies as `LEVEL`
and renders as HOLDS.

`analytics-change-impact.js` needs **no change at all**. It already has:

```
COUNT(*) FILTER (WHERE kind = 'LEVEL')::int  AS level_changes
```

and it deliberately does not settle-gate that count — its own comment reads *"a hold isn't waiting on an outcome"*. The
plumbing was built for this; nothing has ever fed it.

## 3. What each route writes

### 3.1 `pricing-park.js` (W2) and `pricing-park-bulk.js`

Inside the existing `withTransaction`, alongside the review-date UPDATE, insert one row per style:

| column | value |
|---|---|
| `groupid` | the style |
| `channel` | `'SHP'` |
| `old_price` | `safeNumeric(skusummary.shopifyprice)` **as it stands now** |
| `new_price` | the same value — this is what makes it a HOLD |
| `change_date` / `changed_at` | `CURRENT_DATE` / `now()` |
| `reason_notes` | the operator's note if the park UI carries one, else NULL |
| `changed_by` | `req.user.display_name`, server-resolved as everywhere else |
| `google_pushed_at` | **`now()` — pre-stamped. See §4.** |

Read the current price in the same statement that stamps the review date (`RETURNING` already exists on W2), so the logged
`old_price` cannot drift from what was actually held.

**A style with a non-numeric or NULL `shopifyprice` still gets its review date stamped, but writes NO log row.** A hold on a
price we cannot read is not a decision we can score, and `safeNumeric` returning NULL must never become a `0.00` hold.

### 3.2 `amz-review.js`

Same shape into `amz_price_log`: `code`, `old_price` = `safeNumeric(amzfeed.amzprice)` (join on `code`), `new_price` = the
same, `log_date`/`changed_at`, `notes`, `changed_by`. Same NULL rule. `uploaded_at` stays NULL and §5 keeps it out of the file.

## 4. Google sweep — belt and braces

`scripts/google-price-sweep.js` finds SHP rows with `google_pushed_at IS NULL` and pushes that style's current price. Hold rows
would give it a queue of no-op pushes: harmless in effect (it would push the price already live) but wasteful and confusing.

Two guards, both cheap, and we want both:

1. **Pre-stamp `google_pushed_at = now()` on the hold row at insert** (§3.1). Nothing to send, so it is born sent. This alone
   fixes it and needs no redeploy of the cron script.
2. **Add `AND l.new_price IS DISTINCT FROM l.old_price` to the sweep's SELECT.** The safety net — it also catches the
   pre-existing accidental equal-price applies (the real "2 held"), which today do reach Google as no-ops.

## 5. Amazon basket — the same no-op guard, and it is worth having anyway

`routes/amz-basket.js` rebuilds the upload file from `amz_price_log WHERE uploaded_at IS NULL AND changed_at >= now() - 12h`.
It does **not** check the queued price against what is live, so a no-op can reach the Seller Central file. It already joins
`amzfeed a ON a.code = l.code`, so the live price is in hand.

Add to the WHERE:

```
AND ROUND(l.new_price, 2) IS DISTINCT FROM ROUND(<safeNumeric a.amzprice>, 2)
```

**`amzfeed.amzprice` is `character varying`** (schema landmine — it is a feed table). It MUST go through `utils/sql.js →
safeNumeric`; a bare `::numeric` will throw on the first junk row. `IS DISTINCT FROM` (not `<>`) so a SKU whose live price is
unreadable keeps its row rather than silently vanishing from the file.

**Why this is safe in both directions.** `amzfeed` refreshes on a lag, so the two failure modes are asymmetric:

- Feed stale *behind* the change → row looks like a real move → kept → at worst one redundant line in the file. Harmless.
- Feed already shows the new price → the change is already live on Amazon → dropping it is **correct**.

There is no case where a genuine, un-applied price change gets dropped.

Note when measuring: 213 rows in the last 90 days have `new_price` equal to the live `amzprice`, but most of those are
changes that were uploaded and took effect. That count is **not** a measure of waste. The basket window (unuploaded, last 12h)
is the only place the guard bites, and it was empty when this was written, so the real rate is unmeasured.

## 6. What the screen gains

- HOLDS becomes a true count in the summary strip and per operator in the Impact grid, with no scoring changes.
- The up/down/held split finally reflects the work actually done, so "we hold a lot" is visible instead of contradicted.
- Holds are attributed, so a considered hold reads as work rather than as absence.

## 7. Explicitly NOT in scope

- No back-fill. There is no history to recover (§1).
- No change to how raises or cuts are scored.
- No new table. `price_change_log` becomes a *decision* log rather than strictly a price-change log; that is the point, and
  §4/§5 are the two places that assumed otherwise.
