# Update Amazon — PowerBuilder → BCWEB

**Status: SHIPPED** — `1ce2664` on main, 2026-07-28. This is the working record of the
port, kept for the reasoning rather than as a live spec.

> ### Read this first — where the doc and the code differ
>
> The doc was written as the design evolved, and the profit model changed direction near
> the end. **The code is the truth.** Where they disagree, these are the final decisions:
>
> **The ÷1.2 returns adjustment STAYS, on the sale row.** `sales.profit` must read as
> *what the owner keeps on a unit sold* — it is the number he buys and prices on. A field
> showing profit-if-it-sticks is the wrong number for that job.
>
> **Return rows are a BARE reversal.** No per-return fees. The two designs are
> alternatives, never layers — applying both would charge returns twice.
>
> So §2.5b, §2.5c, §2.9 and the D4-final formula below all describe an intermediate design
> that was tried and reverted. They are left in place because the measurements are sound
> and worth keeping (see §2.11), but the **conclusions** in them are superseded.
>
> Still true and still useful: everything about file parsing, idempotency, the
> parallel-running guards, the cancellation retraction, and §2.10's "no backfill".

---

## 1. What the legacy actually does

Three functions behind the **UPDATE AMAZON** button:

| Function | Reads | Writes |
|---|---|---|
| `of_updateamzdatadb` | 5 files | wipes + rebuilds `amzfeed`; updates `skumap.fbafee`, `.amzorderdate2`, `.amzprofit`; saves `amzstockreport.csv` |
| `of_amzsalesload` | 2 of those files | inserts into `sales` (sales + return reversals) |
| `of_checkbarcodesdb` | `amzfeed` + local `.bmp` files | saves `Amazon-FNSKU-BARCODES.txt/csv` |

### It reads five files, not three

```
datafiles\order.txt     r002  Orders          -> 118981020662.txt
datafiles\stock.txt     r001  FBA Inventory   -> 118982020662.txt
datafiles\returns.txt   r006  FBA Returns     -> 118983020662.txt
datafiles\r004.txt            Fee report      -> 118984020662.txt  (sent in round 2)
datafiles\buybox.csv          Buy Box         -> never sent; dead, see 2.4
```

`FileOpen` on a missing file returns −1, the read loop exits immediately, and the
datastore stays empty — **silently**. Both of those last two have been failing quietly.
2.3 and 2.4 cover what that actually cost (less than I first thought, for the fee file).

### File identification — all four fingerprint cleanly

No filename dependency needed. First line, tab-delimited, is unambiguous:

| Report | Header starts | Cols | Sample rows |
|---|---|---|---|
| Orders | `amazon-order-id` `merchant-order-id` `purchase-date` | 34 | 774 |
| FBA Inventory | `sku` `fnsku` `asin` `product-name` `condition` `your-price` | 26 | 630 |
| FBA Returns | `return-date` `order-id` `sku` `asin` `fnsku` | 13 | 141 |
| Fee preview | `sku` `fnsku` `asin` `amazon-store` `product-name` `product-group` | 31 | 259 |

Orders/inventory/returns windows are **30 days** (2026-06-28 → 2026-07-28). The fee
report is a snapshot, not a window — no dates in it at all.

Note the inventory and fee reports share their first three columns. The discriminator is
column 4: `product-name` (inventory) vs `amazon-store` (fee). Both are checked.

### Field mapping the legacy relies on

Legacy imports positionally into a DataWindow, then reads by DW column name — so it
is **positional in disguise**. If Amazon inserts a column, every field after it
silently shifts. Columns actually used:

- **Orders** → 1 `amazon-order-id`, 3 `purchase-date`, 5 `order-status`, 7 `sales-channel`, 12 `sku`, 15 `quantity`, 17 `item-price`
- **Inventory** → 1 `sku`, 2 `fnsku`, 3 `asin`, 6 `your-price`, 9 `afn-listing-exists`, 11 `afn-fulfillable-quantity`, 14 `afn-total-quantity`
- **Returns** → 1 `return-date`, 2 `order-id`, 3 `sku`, 7 `quantity`, 12 `license-plate-number`

Verified against live data — `amzprice`=`your-price`, `amzlive`=`afn-fulfillable-quantity`,
`amztotal`=`afn-total-quantity` match exactly for every SKU I spot-checked, which also
confirms `gi_amzstockbuffer` is currently **0**.

---

## 2. Findings

### 2.1 Nine of `amzfeed`'s fifteen columns are write-only

I counted every reference in `bcweb-server/routes` + `utils`:

| Column | BCWEB refs | |
|---|---|---|
| `amzlive` | 48 | **live** |
| `amzprice` | 20 | **live** |
| `fbafee` | 18 | **live** |
| `amztotal` | 13 | **live** |
| `fnsku` | 12 | **live** |
| `sku` / `code` / `groupid` | — | **live** (keys) |
| `amzsold` `amzsold7` `amzsoldprice` `amzsolddate` `amzreturn` `buybox` `asin` | **0** | dead |

BCWEB's Amazon velocity comes from the `sales` table (`amz-winners.js:82` —
`channel='AMZ' AND solddate >= CURRENT_DATE - $2`), not from `amzfeed`.

**But "0 BCWEB refs" ≠ dead — REVISED.** You pointed me at `of_filteramzdisplay`, and it
settles it. Lines 220–230 read straight off `gdb_amzfeed`:

```
amzlive  amztotal  amzprice  amzsolddate  amzsold  amzsold7  amzreturn  amzsoldprice
fnsku  asin
```

So **nine of the fifteen columns are live to PowerBuilder** even though BCWEB never
touches them. They stay populated. The only genuinely dead one is `buybox` — declared as
`ls_buybox` in that function and then never read (2.4).

The useful half of the finding survives, though. The expensive thing was never the
columns, it was **how** they're computed: the nested `Find` loop at
`of_updateamzdatadb:330–374` re-scans the whole orders file once per SKU. Every one of
those five values is already sitting in `sales`, which the same button populates
moments earlier:

| `amzfeed` column | derived from `sales` |
|---|---|
| `amzsold` | `SUM(qty)` where `qty > 0` in window |
| `amzsold7` | same, last 7 days |
| `amzreturn` | `-SUM(qty)` where `qty < 0` in window |
| `amzsoldprice` | `soldprice` of the latest positive row |
| `amzsolddate` | `solddate` of that row |

Two grouped queries replace the O(n²) scan. PB keeps working, and the port still gets
its speedup — just from a different direction than I claimed.

One consequence to be aware of: `amzsold` currently counts *the downloaded window*
(2.2). Derived from `sales` it counts *a window we choose*. Those agree while you keep
downloading 30 days, and I'd fix the window at 30 days explicitly so the number PB shows
doesn't move if you ever pull a longer report. Flagged as **O2** in §5.

### 2.2 `amzsold` was never a real number anyway

It counts units in *whatever window you happened to download*. This sample is 30 days;
a 60-day download would have doubled it, with no marker saying so. Live `amzfeed`
confirms it: `min(amzsolddate)` = 20260627, exactly the download window edge. Good
riddance.

### 2.3 The fee report — REVISED, I had this backwards

I said the £3.39 fallback was making your margins optimistic. Your fee report says the
opposite, and by a smaller amount than I implied. Correcting it.

Actual fee distribution in `118984020662.txt` (`expected-domestic-fulfilment-fee-per-unit`,
259 GBP rows):

```
min 2.95 | p25 3.06 | median 3.08 | p75 3.10 | p90 3.36 | max 4.61
only 15 of 259 SKUs are above £3.39
```

£3.39 is the *MediumParcel2* rate. Most of your range is *SmallParcel3* at ~£3.06. So the
fallback is **pessimistic by roughly 30p**, not optimistic — margins on those SKUs are
understated, not overstated. Sorry: that was the wrong way round.

What's still true, and what's worth acting on:

- **It barely drifts.** Of 134 SKUs where the stored fee was a real value, the fresh file
  agrees with the stored one on all but 9. Your instinct that it doesn't change much is
  correct, and monthly is the right cadence.
- **57 in-stock SKUs are on the guess** (not 222 — the other 165 have no live stock, so
  nothing prices off them). Loading this file gives 94 of them a real fee.
- **The outliers are where it earns its keep.** `ELZ006-LAKE-*` come in at £4.48–£4.61,
  £1.20 over the guess. A handful of SKUs priced against a fee that's £1.20 light is a
  real hole, and it's the kind that only a fee file can find.
- **Coverage is by design, not a gap.** The report holds 260 of the 631 stock-report SKUs
  — but 202 of your 204 SKUs with live FBA stock are in it. The 371 absent are almost all
  zero-stock listings. So "missing from the fee file" is not an error condition; it means
  "nothing in FBA". Keep the last known fee for those.

Net: worth wiring in as a fourth upload, but as a correctness/outlier fix, not the
money-on-the-table item I billed it as. **The real Amazon margin problem is 2.5.**

### 2.4 `buybox` is 100% dead — 0 of 522 rows populated

Nobody writes it (file missing), nobody reads it. Delete.

### 2.5 THREE contradictory profit formulas — REVISED

`of_filteramzdisplay:255–277` has a third one I hadn't seen. It's the one on your screen.

| | `of_updateamzdatadb:526–548` | `of_amzsalesload:198–206` | `of_filteramzdisplay:255–277` |
|---|---|---|---|
| Referral | 15.3% | 15% | 15% |
| FBA | real per-SKU `fbafee` | flat £3 | **flat £3.05 — ignores `fbafee`** |
| VAT | `/6` when `tax=1` | `/6` when `tax=1` | `/1.2` when `tax=1` |
| Digital services fee | — | — | **2% of referral + 2% of FBA** |
| Storage | — | — | **£0.33** (3 months) |
| Courier | £0.80 DPD | — | £1.00 DPD |
| Wages | — | — | **£0.50** |
| Catch-all | — | £1.83 | — |
| Final | — | `÷ 1.2` | `÷ 1.2` |
| Writes | `skumap.amzprofit` (unread) | **`sales.profit`** — Analytics reads this | screen only |

Two things fall out of the third column that change my D4 recommendation:

1. **It's the only one that knows about the Digital Services Fee.** That's a real 2%
   Amazon surcharge on referral and FBA fees. `of_updateamzdatadb` — the one you picked —
   predates it and doesn't have it. Neither does it have storage or wages.
2. **It ignores `fbafee` entirely** and hardcodes £3.05. So the fee report we're wiring
   in (2.3) currently feeds a formula nobody looks at, while the screen you *do* look at
   uses a constant.

So "use the `of_updateamzdatadb` one" gets you the right *shape* (real per-SKU fee,
proper VAT) but drops three real costs the display already models. My revised
recommendation is a merge — see **D4-revised** in §5. It's one line either way; I just
don't want to quietly delete costs you'd been counting.

### 2.5b The `÷1.2` haircut — MY ANALYSIS OF THIS WAS WRONG, see 2.5c

You asked whether returns are genuinely factored in. They are, and I can put numbers on
it. `of_amzsalesload:300–346` inserts a reversal row per return: negative `qty`, and
`profit = -(original_profit / original_qty)` — a **full** reversal of that sale's profit.
Live `sales`, trailing 12 months, `channel='AMZ'`:

```
sales    5,196 rows   +5,211 units   +£22,130.52   (avg +£4.26)
returns    785 rows     −785 units   − £3,460.89   (avg −£4.41)
```

785 reversals against 5,211 units — a ~15% return rate, fully booked.

I concluded from that the `÷1.2` was a *second* charge for the same returns. **That was
wrong**, and it was asserted confidently and repeatedly. See 2.5c.

### 2.5c Correction: the haircut was not double-counting, it was the return-cost model

The reversal and the haircut were doing two DIFFERENT jobs, and both were needed:

- the **reversal** removes margin that was never earned — correct, and all it does
- the **`÷1.2`** charged for what the return itself COST — which nothing else did

The reason they don't overlap: a reversal makes a returned sale net to **zero**, taking
the haircut with it. So the haircut only ever effectively landed on the sales that
*stuck*. Per 100 units sold with 15 returned:

```
OLD  div 1.2 + bare reversal        391.71
NEW  no haircut + costed returns    383.50      -2.1%
```

Two systems within ~2% of each other. It was never a double charge; it was a crude but
well-calibrated proxy for exactly the cost 2.9 now models explicitly. Against the real
12 months, `÷1.2` removes £4,670.65 where the modelled return cost is £4,531.22 — **within
3.1%**.

**So what IS wrong with it, and why replace it at all?** Not its magnitude — its
*resolution*:

- **It is flat per SKU.** Real return rates across styles with 25+ units sold run from
  **5.4% to 33.0%**, a six-fold spread, all charged an identical 16.7%.
- **It scales with profit, not with returns.** Return costs are per-unit (admin fee, FBA
  fee, cost of goods). The haircut bills a high-margin style more than a low-margin one
  even when the high-margin style is never returned — backwards for exactly the styles
  the pricing modules are trying to find.
- **It cannot see write-offs.** A style coming back DEFECTIVE repeatedly looks identical
  to one coming back SELLABLE. That signal is a supplier/listing problem worth surfacing,
  and a flat multiplier structurally cannot.

For a portfolio total the owner's `÷1.2` was as good as the new model. For per-SKU pricing
decisions — which is what this platform exists to make — it was not.

### 2.6 The real breakeven formula is sitting in the legacy code — *superseded, see §5 D4*

`of_updateamzdatadb:543-548`:

```
tax=1:  floor = (fbafee + cost + unitprocessing) / 0.683333 + 0.80
tax=0:  floor = (fbafee + cost + unitprocessing) / 0.85     + 0.80
```

`0.683333` = `1 − 0.153 referral − 1/6 VAT`. That is a properly derived breakeven.

BCWEB's `/amz-apply` currently blocks only below `cost + fbafee` — which, as we
established previously, sits roughly 1.5× under true breakeven. **This formula is the
fix, and it has been in the legacy code the whole time.** I'd port it into the apply
guard as part of this job.

### 2.7 Three latent data bugs

None fired in this sample, so this is a "will bite eventually" list, not a "your data is
wrong today" list.

1. **Cancelled-after-Pending is never retracted.** `Pending` orders are inserted into
   `sales`; the dedupe key `(code, ordernum, qty>0)` means the row is never revisited.
   When that order cancels, the sale stays forever. This sample has 10 `Pending` and 17
   `Cancelled` — so it fires regularly, it's just invisible.
2. **Returns dedupe ignores `license-plate-number`.** It's read into `ls_licenseplate`
   at line 259 and then never used. The key is `(solddate, code, ordernum, qty)`, so two
   units of the same SKU returned on one order on one day → the second is dropped as a
   duplicate. 0 occurrences in this sample.
3. **Same code twice in one order records once.** Same dedupe key. 0 occurrences in this
   sample.

### 2.8 ~108 Amazon SKUs are invisible to you — mostly benign

`amzfeed` is built by looping `skumap` and looking each SKU up in the stock report —
so anything Amazon holds that `skumap` doesn't know about is **silently discarded**.

- Stock report: 630 SKUs
- `skumap` with a SKU: 537
- `amzfeed`: 522

So ~108 SKUs have FBA stock or listings you have no local record of, and ~15 `skumap`
SKUs have dropped off Amazon. Neither is reported anywhere.

Now that I've seen the fee file I can name part of that gap: **13 are `amzn.gr.*`** —
Amazon-generated virtual group SKUs, not real listings of yours. Those should be
classified and hidden, not shown as 13 problems. So the panel in 3.7 gets three buckets,
not two: *unknown to `skumap`* · *`amzn.gr.*` virtual* · *gone from Amazon*. Only the
first is a to-do list.

---

## 3. Proposed design

### 3.1 Screen

Its own dashboard tile, **Update Amazon** (D6). Drag-and-drop up to four files, or pick
them. Two stages:

```
  DROP FILES                     ->   PREVIEW / VALIDATE        ->  COMMIT
  identify by header                  per file: type, rows,         one transaction
  reject unknown layouts              window, what will change      per file
```

**Nothing is written until you press Apply.** The preview tells you, per file:
identified type · row count · date window covered · rows that will insert / update /
be skipped and why. You're never guessing what a run did.

### 3.2 Pipeline — REVISED, now three phases not three independent files

My previous version had orders and returns never touching `amzfeed`. 2.1 kills that:
PowerBuilder still reads the sales columns off `amzfeed`, so they must stay populated.
The pipeline becomes **ingest → derive → project**:

```
 PHASE 1  INGEST          each file, independently, into its own home
   Orders      -> sales           idempotent upsert on (order-id, order-item-id)
   Returns     -> sales           idempotent upsert on license-plate-number
   Fee report  -> skumap.fbafee   update in place, absent SKU = keep last known
   Inventory   -> amzfeed         wipe + reload of the stock columns

 PHASE 2  DERIVE          two grouped queries over sales (30d + 7d)

 PHASE 3  PROJECT         write derived values onto amzfeed for PowerBuilder
   amzsold  amzsold7  amzreturn  amzsoldprice  amzsolddate
```

Phase 3 is what keeps PB alive, and it's the piece I'd delete on the day PB goes.
Isolating it in one function means that's a one-line removal later.

**Your partial-run requirement still holds**, which was the point of the original split.
Phases 2–3 read `sales` and write only the five derived columns, so they're safe to run
after *any* upload combination:

| You upload | Result |
|---|---|
| Orders only | `sales` gains rows; derived columns refresh; stock untouched |
| Inventory only | stock columns refresh; derived columns re-projected from existing `sales` |
| Fee report only | `skumap.fbafee` + `amzfeed.fbafee` refresh; nothing else moves |
| All four | full equivalent of today's button |

The one ordering constraint: if orders and inventory arrive together, orders must land
before phase 2, or the derived columns lag by a run. The commit does them in the order
above regardless of drop order, so this is handled — but it's worth knowing that's
deliberate and not incidental.

`amzfeed`'s wipe-and-reload survives, with one change: it now rebuilds the **stock**
columns from the inventory file and then re-derives the sales columns, rather than
rebuilding everything from a five-file join. A wipe with no inventory file in the upload
is skipped entirely rather than emptying the table.

### 3.3 Column-drift guard

Per report type, a stored fingerprint: the exact expected header set. On upload:

- **Every required column present, by name** → proceed. Parse by name, not position, so
  Amazon adding or reordering columns is harmless.
- **A required column missing or renamed** → hard stop, name the column, write nothing.
- **New unrecognised columns** → proceed, but note them in the preview so you see Amazon
  changed something.

Stricter than today (which shifts silently) and less brittle (reordering no longer
matters).

### 3.4 Idempotency

You want to re-upload freely. Keys:

- **Sales** → `(amazon-order-id, order-item-id)`. `order-item-id` is column 34 and is
  unique per line; it fixes bug 2.7.3 outright.
- **Returns** → `license-plate-number`, Amazon's unique per-unit id; fixes 2.7.2.
- **Cancellations** → each run, any `sales` row whose order appears as `Cancelled` in
  the uploaded window gets retracted. Fixes 2.7.1.

Re-uploading the same file becomes a genuine no-op. Uploading an overlapping window
converges. That gives you the "peace of mind it's up to date" you described, properly.

### 3.5 What gets removed — REVISED

Shorter list than v1, because PB stays (D1).

**Gone:**
- the buy-box file (never loads) — `amzfeed.buybox` column left in place per D2
- the nested per-SKU orders scan (2.1) — replaced by two grouped queries, the actual win
- `amzstockreport.csv` — you confirmed it's not needed
- both `÷1.2` refund haircuts (2.5b)

**Kept, contrary to v1:**
- `amzsold` / `amzsold7` / `amzsoldprice` / `amzsolddate` / `amzreturn` / `asin` — all
  read by `of_filteramzdisplay`. Same values, cheaper derivation.

**Kept cheaply, pending a check:**
- `skumap.amzprofit` / `.amzorderdate2` — BCWEB ignores both, and
  `of_filteramzdisplay` recomputes profit locally rather than reading `amzprofit`. But
  I've only seen four PB functions, so I can't prove no *other* screen reads them. They
  cost one `UPDATE` to keep, so I'll keep writing them until you say otherwise (**O1**).

### 3.6 Barcodes — OUT OF SCOPE

Nothing barcode-related is built here. `of_checkbarcodesdb` is not ported, no FNSKU
list, no Code 128 generation. You'll keep running that module ad-hoc in PowerBuilder,
and the `.bmp`/Drive chain stays exactly as it is. This job does data ingest only.

Parked for a later task, with the findings that stand up when we get to it:

- The chain is `of_checkbarcodesdb` → `Amazon-FNSKU-BARCODES.txt` → desktop app → `.bmp`
  on Drive → PB matches an operator scan → label printer → label on the FBA box.
- The clunky step — producing the `.bmp` — is the one that doesn't need to exist. The
  sample `X000Q6ARLD.bmp` is 161×56px: a default **Code 128** render plus the FNSKU as
  text. That's generatable on demand from the FNSKU string alone.
- Doing so would remove the desktop app, the `.bmp` files and the Drive `assets` folder
  together, because the Drive folder exists only to answer *"have we made a barcode for
  this FNSKU yet?"* — a question that stops mattering once generation is instant.
- Scan-to-print stays in PB regardless (D5a); that's a printer conversation.

One thing to preserve for that task: this job **must not** disturb `amzfeed.fnsku`, since
`of_checkbarcodesdb` reads it. It's written from the inventory file exactly as today.

### 3.7 Reconciliation panel

Free, given we're already parsing both sides — show the 2.8 mismatches after a stock
upload: *in Amazon, not in `skumap`* and *in `skumap`, no longer on Amazon*. Read-only,
no auto-fix.

---

## 4. Decisions — settled

| | Decision | Effect on the build |
|---|---|---|
| **D1** | PowerBuilder stays, not ready to drop | Sales columns keep being written to `amzfeed`, derived from `sales` (2.1, 3.2 phase 3). `amzstockreport.csv` dropped — you confirmed it's unused. |
| **D2** | Stop writing dead columns, don't drop them | Only `buybox` qualifies now. Column stays, write path goes. |
| **D3** | Fee report in, monthly cadence | Fourth upload. Absent SKU = keep last known fee, never revert to £3.39. See 2.3 — my framing was wrong, the conclusion still holds. |
| **D4** | `of_updateamzdatadb` formula, no floor, no storage; keep the 2% digital fee; £1 DPD | Settled — final formula in **D4-final** below. |
| **D5** | **Out of scope.** Barcodes stay in PowerBuilder, run ad-hoc | Nothing barcode-related is built here — no list, no Code 128, no `of_checkbarcodesdb` port. Separate task later (3.6). |
| **D6** | Own tile, `Update Amazon` | Confirmed. |
| **D7** | Allow any window; you'll keep pulling 30 days | No cap. Big backfills are safe once 3.4 keying is in. |

### D4-final — settled

You picked the `of_updateamzdatadb` formula before I'd found the one in
`of_filteramzdisplay` (2.5). That third one is the number on your screen, and it carries
three costs the one you picked doesn't: the **2% Digital Services Fee**, **£0.33
storage**, **£0.50 wages**. Taking your answer literally deletes all three.

Two of your instructions are unambiguous and I've applied them: **no floor calculation**
(2.6 is dropped — `/amz-apply`'s guard stays as it is; the true-breakeven fix is a
separate conversation, not this job) and **`unitprocessing` ignored**. And yes — returns
are definitively reversed, so both `÷1.2`s go (2.5b, with numbers).

**The referral rate is settled by your own fee file: 15.0%, not 15.3%.**
`estimated-referral-fee-per-unit ÷ your-price` across all 260 rows:

```
0.1500 x188 | 0.1499 x42 | 0.1501 x21 | 0.1503 x8 | 0.1498 x1
```

That's 15% with penny-rounding noise, nothing else. The 15.3% in `of_updateamzdatadb` is
a stale rate and has been overstating costs slightly. Using 15%.

Also from the same file: `estimated-fee-total = referral + fulfilment` **exactly**, on
all 260 rows, with `estimated-variable-closing-fee` = 0.00 and order-handling blank. So
the fee preview accounts for referral and FBA only — it does *not* carry the Digital
Services Fee, which is why I can't settle that one from the data.

**Final formula.** One function, `utils/amzProfit.js`, used for `sales.profit` and the
values projected to PowerBuilder alike, so the three numbers stop disagreeing:

```
gross    = tax=1 ? price - price/6 - cost : price - cost
referral = price * 0.15                 (settled from the fee file, was 15.3%)
fba      = per-SKU fbafee               (real where known, last-known otherwise)
digital  = (referral + fba) * 0.02      Digital Services Fee
other    = 1.00 courier + 0.50 wages
profit   = (gross - referral - fba - digital - other) / 1.2
                                        ^^^^^^ AS SHIPPED. See the note at the top.
```

The `/1.2` was removed mid-design and then put back, deliberately. Paragraphs below that
argue for dropping it are superseded — §2.11 records why.

Storage dropped per your "no storage". Both `÷1.2` haircuts dropped per 2.5b.
Wages kept at £0.50 — you didn't call it out, and your stated principle (below) says
keep the conservative estimate. Say the word if you'd rather it went.

### The estimates are deliberately high — that's the design, not a bug

Your words: *"purposely estimated high so that if I can make a profit with these, I am
safe."* Worth writing down, because it changes how the number should be read and it's
exactly the kind of thing that gets "corrected" by someone later who doesn't know.

So `sales.profit` on Amazon is **a conservative floor, not an accounting figure.** The
principle I'll follow: **real data where we have it, deliberately pessimistic where
we're estimating.**

- `fbafee` and referral are real → use the true values, no padding.
- courier, wages, the 2% digital fee are estimates → left high on purpose.

One consequence to be clear about, since it cuts against your instinct: **removing the
`÷1.2` makes the number less conservative** — about 20% less. I'm still confident it
should go, because it isn't conservatism, it's a second charge for returns that are
already fully booked as reversal rows (2.5b, 785 of them last year). Padding an estimate
is deliberate; deducting the same real cost twice is just wrong, and it was hiding inside
a number you were reading as if it were honest. The conservatism you want lives in the
courier/wages/digital lines, which stay high.

If you want the *reported* number to stay where it is, that's a different lever — say so
and I'll leave a documented margin-of-safety multiplier in one place, rather than an
undocumented one buried in a refund haircut.

---

## 5. All decisions closed

| | Resolution |
|---|---|
| **O1** `skumap.amzprofit` / `.amzorderdate2` | Keep writing both. Costs one `UPDATE`, removes any risk of breaking an unexamined PB screen. |
| **O2** `amzsold` window | **Fixed at 30 days, always** — you compare it mentally across SKUs, so it must not move with the download length. Hard-coded, not derived from the file. |
| **O3** PB-retirement seams | Phase 3 isolated in one function, commented as such, so it lifts out cleanly. |
| **D5a** scan-to-print | Stays in PowerBuilder. |
| **D5b** barcode scope | Separate task. Not touched here (3.6). |

### The fee report is opportunistic, by design

Your rule: *"I can include it here once a month... if you see it, process it. If not, use
what is already there."* That's exactly what the pipeline does, and it falls out of the
per-file independence in 3.2 rather than needing special handling:

- **Fee file present** → `skumap.fbafee` updated for the SKUs it covers.
- **Fee file absent** → nothing fee-related runs. Existing values stand.
- **SKU absent from a present fee file** → keeps its last known fee. Never reverts to
  £3.39, never zeroes.

`3.39` survives only as the fallback for a SKU that has *never* had a real fee. The
preview names the number either way, so a run that quietly didn't include fees is
visible rather than silent — which is the failure mode that started all this (§1).

---

## 6. Built — 2026-07-28

Scope as agreed: **four files in, `sales` + `amzfeed` + `skumap.fbafee` out, own tile.**
No barcodes. Everything below is written, lint/tsc clean, and rehearsed end-to-end
against the live database inside `BEGIN … ROLLBACK`. **Nothing has been committed to git
and no real run has been made.**

| File | What it is |
|---|---|
| ~~`migrations/2026-07-28-amz-import-source-key.sql`~~ | `sales.source_key` + partial unique index. **Applied to prod 2026-07-28; the file was then deleted.** Recreate from `\d sales` if ever needed. |
| `utils/amzReports.js` | Header fingerprinting + parse-by-name for all four reports, drift guard. Pure, no DB. |
| `utils/amzProfit.js` | The D4-final formula. Single source of truth. |
| `utils/amzImport.js` | Upload classification + the PLAN (what would be written, and why not, per row). |
| `utils/amzImportApply.js` | The three write phases. Separated so they can be rehearsed against a rollback client. |
| `utils/amzImportShape.js` | Plan → the JSON the screen renders. Shared by preview and receipt so they can't drift. |
| `routes/amz-import-preview.js` | Stage 1. Reads only. |
| `routes/amz-import-commit.js` | Stage 2. One `withTransaction`. |
| `src/app/update-amazon/page.tsx` + `src/components/AmzImportSummary.tsx` | Drop → check → apply, and the account. |

### Rehearsal result (all four sample files, live DB, rolled back)

```
parsed        ORDERS+INVENTORY+RETURNS+FEES, 0 rejected
applied       +744 sales · +141 returns · -7 retracted · 113 fees · 522 stock rows · 522 amzfeed re-derived
timing        726ms for the whole commit body
re-run        plan wanted 0 sales / 0 returns -> inserted 0    (idempotency confirmed)
amzsold sum   747 before -> 747 after                          (derivation reproduces the legacy number exactly)
```

That last line is the important one: `amzsold` computed from `sales` by two grouped
queries lands on precisely the number the legacy per-SKU file scan produced, so
PowerBuilder sees no change.

**The 7 retractions are real.** Those are live sale rows for orders Amazon has since
cancelled — £295.50 of revenue currently on the books that shouldn't be. Bug 2.7.1,
found firing in production.

### Running alongside PowerBuilder

**Both can run. Neither will duplicate the other, in either order.** Verified from the
legacy source, not assumed:

| | Guard | Result |
|---|---|---|
| PB ran first, then BCWEB | BCWEB's legacy-shape guard, scoped to `source_key IS NULL` rows | skipped — 744 sales + 141 returns blocked in the rehearsal |
| BCWEB ran first, then PB | PB's own `WHERE NOT EXISTS (code, ordernum, qty>0)` (`of_amzsalesload:234-239`) has no channel or key filter, so it sees BCWEB's rows | skipped |
| Both touch `amzfeed` | PB wipes and rebuilds; BCWEB upserts and re-derives | converge on identical numbers (747 → 747) |
| Both touch `skumap.fbafee` | PB reads `r004.txt`, which has been failing to load | only BCWEB writes it in practice; PB's rebuild then *benefits* from the better fees |

**But one thing genuinely diverges: `sales.profit`.** PB writes the old formula (÷1.2,
flat £3 FBA); BCWEB writes D4-final. On a £49.95 sale that's £4.00 vs £4.89 — ~22%. Rows
get whichever formula imported them, with nothing recording which, so running both leaves
Analytics reading a blend.

**Recommended: run BCWEB for the import, and keep PowerBuilder for everything else.**
That is exactly what phase 3 (and now the `skumap` projection) exists to make possible —
PB's Amazon screen reads `amzfeed` + `skumap`, both of which BCWEB keeps current, so the
screen keeps working with the import stood down.

**The wrinkle:** `of_checkbarcodesdb` sits behind the *same* UPDATE AMAZON button (§1), so
pressing it for barcodes also re-runs the legacy import. That is harmless **provided
BCWEB runs first** — PB's guard then finds every row already present and inserts nothing,
while the barcode step still produces its file. So the working order is:

```
1. Update Amazon in BCWEB   (the real import)
2. UPDATE AMAZON in PB      (only when you want barcodes — its import will be a no-op)
```

### DECIDED 2026-07-28: PowerBuilder's import is being switched off

BCWEB becomes the only importer. PB stays in service for its screens until it is retired.
Consequences, all verified:

**Nothing is lost except barcodes.** Going through everything the legacy button did:
`amzfeed` rebuild ✓ · `skumap.fbafee` ✓ · `.amzorderdate2` ✓ · `.amzprofit` ✓ · `sales`
✓ · `amzstockreport.csv` (you confirmed it's unused) · **`of_checkbarcodesdb` ✗**. The
barcode step is behind the same button, so pressing UPDATE AMAZON is still how you get
the FNSKU file — and after a BCWEB run its import half finds everything already present
and inserts nothing. Safe to press whenever barcodes are wanted.

**One behavioural difference in `amzfeed`.** PB deleted the whole table and rebuilt it, so
a SKU that dropped off Amazon disappeared. BCWEB never deletes: it zeroes the stock and
keeps the row, and reports it in the "gone from Amazon" bucket. Safer (price history and
`fnsku` survive) but the table will no longer self-prune — worth a look at that bucket
occasionally rather than never.

**The `sales.profit` seam is now permanent, and it is the one thing worth deciding.**
Historic rows carry the old formula; everything from the switchover carries D4-final.
Measured over the trailing 12 months (5,062 rows with a readable cost):

```
stored (old formula)      £22,008.78
new formula               £28,122.64     +27.8%   <- the step Analytics would show
stored x 1.2              £26,410.54     within 6.5% of the new formula
```

**SUPERSEDED — see 2.9.** Modelling return costs changed this from +27.8% to about +8.5%,
which reverses the recommendation. Do nothing to history.

### 2.9 Returns cost money — investigated, then reverted (see 2.11)

> **SUPERSEDED.** The per-return cost model below was built, measured, and then removed in
> favour of keeping the `/1.2` on the sale row. The measurements are real and worth having;
> the design conclusion is not what shipped.


The owner asked whether the return calculation factors in return fees. It did not: the
reversal was `-(sale profit)`, exactly as the legacy code did it, which models a return as
**free**. Sale + return netted to zero. That is wrong three ways, and the returns report
already carried the data to fix the largest of them.

`detailed-disposition`, a column the parser was reading straight past:

```
SELLABLE          130        back on the shelf, resells
DEFECTIVE           7  ┐     12 units (8.5%) that never sell again — the whole cost of
CUSTOMER_DAMAGED    5  ┘     goods is gone, not just the margin.  £181.44 in 30 days.
```

The corrected reversal (`utils/amzProfit.js → returnProfit`):

```
reversal = -(sale margin)                     as before
           - refund admin   min(£5, 20% of referral)   Amazon keeps this on a refund
           - unrecovered FBA fee              not refunded; assumed so, the safe direction
           - cost of goods   when disposition <> SELLABLE
           - returns processing fee           STILL ZERO — rate unknown, see below
```

Worked example, £49.95 sale / £24.50 cost / £3.03 fee:

| | return row | sale + return nets to |
|---|---|---|
| old (bare reversal) | −£4.89 | **£0.00** — a return cost nothing |
| new, sellable | −£9.42 | −£4.53 |
| new, unsellable | −£33.92 | −£29.03 |

Deliberately NOT re-deducted: courier and wages. The reversal credits them back, which is
right for a sellable unit — it goes back on the shelf and the next sale of it is charged
£1.50 again. Re-deducting would bill twice for one physical journey.

Measured over the real trailing 12 months (766 return rows):

```
refund admin           £  965.15
unrecovered FBA fee    £2,380.33
write-offs @ 8.5%      £1,185.74      (historic rows have no disposition recorded)
                       ---------
extra cost per year    £4,531.22      previously modelled as zero
```

**Still open:** Amazon UK's returns-processing fee for apparel/shoes above a return-rate
threshold. The owner is at ~15% so it may well apply. `RETURNS_PROCESSING_FEE` is a named
constant set to `0.00` — inventing a rate would be fabrication, not conservatism. One line
to change once the figure is known.

### 2.10 Which means: leave history alone

The two corrections pull in opposite directions and very nearly cancel. Trailing 12 months:

| | old | new | |
|---|---|---|---|
| sales | £22,008.78 | £28,122.64 | +£6,113.86 (removing the ÷1.2) |
| returns | −£3,421.74 | −£7,952.96 | −£4,531.22 (return costs) |
| **net** | **£18,587.04** | **£20,169.68** | **+8.5%** |

So the switchover seam is ~8.5%, not the ~28% measured before returns were costed. That
makes **doing nothing the best option**, and it is worth being explicit about why every
alternative is now worse:

- `×1.2` on historic sales (the earlier recommendation) → a **−12%** step. Overshoots.
- `×1.2` on sales plus estimated return costs on history → +9.3%. No better than nothing.
- Full recompute → no seam, but restates history using TODAY's costs, which is not what
  those sales earned.

**Recommendation: no backfill.** ~8.5% is small enough to live with, and every correction
available makes the series worse rather than better. *(Still stands — and with the `/1.2`
restored the seam is smaller again, so the case for leaving history alone is stronger.)*

### 2.11 What actually shipped, and why the `÷1.2` came back

The deciding question, from the owner: *"does this make it safe to assume the profit on
the actual unit? I'm looking for my winners."*

That exposed the real problem with the intermediate design. Moving return costs out of the
sale row and onto return rows made the **ledger** more precise but made the **decision
number** worse: `sales.profit` became profit-*if-it-sticks*, which overstates what you keep
by the return rate, on the one field the owner actually buys and prices on.

Three findings settled it:

1. **The `÷1.2` was never double-counting.** A reversal makes a returned sale net to zero
   and takes the haircut with it, so the haircut only ever landed on sales that *stuck*.
   Per 100 units sold with 15 returned: old 391.71 vs the explicit model's 383.50 — 2.1%
   apart. I asserted the double-count confidently and repeatedly; it was wrong.
2. **It is well calibrated.** Over 12 months it removes £4,670.65 where the explicit
   per-return model charges £4,531.22 — **within 3.1%**.
3. **Its only real weakness is resolution.** It charges every SKU a flat 16.7% when actual
   return rates run **5.4% to 33.0%**. Measured effect on ranking: `L7514-14` sits 2nd by
   profit-if-it-sticks and 10th by expected keep. `L662G` shows £1.94/unit and keeps £0.38.

So: keep the `÷1.2` on the sale row, because a single readable "what I keep" number is
worth more than per-row precision. Resolution belongs in a **per-SKU expected-keep metric
on the pricing screens** — not built, and the right home for it if it is ever wanted:

```
expected keep = profit if it sticks  -  (that SKU's return rate x that SKU's return cost)
```

**Do not re-add per-return fees to `returnProfit()` without setting `RETURNS_DIVISOR` back
to 1 in the same change.** They are alternatives, not layers. The code says so too.

`detailed-disposition` is still parsed and still a required column even though it no longer
moves any money: stock coming back DEFECTIVE or CUSTOMER_DAMAGED never resells (8.5% of
returns, ~£2,200/yr), and a style doing it repeatedly is a supplier problem worth seeing on
the import summary.

Consequence of all this: the **returns-processing fee is no longer needed**. The `÷1.2`
covers return costs in aggregate, so the individual rates are moot and the constant was
removed rather than left at zero for someone to wire in later.

### Going live — done

1. ~~Apply the migration.~~ Applied 2026-07-28: `sales.source_key`, `uq_sales_source_key`,
   `idx_sales_channel_ordernum_code` all live.
2. Restart the API so the two new routes register.
3. PowerBuilder's UPDATE AMAZON import is being **switched off** — BCWEB is the only
   importer. PB stays in service for its screens until it is retired; press its button only
   when barcodes are wanted (its import half will find nothing to do).

Note the 7 cancelled-order retractions and 113 fee updates this module found were applied
by hand on 2026-07-28, so a first run will report them as already done.

### Deliberately not done

- Barcodes, in any form (D5b).
- Any change to `/amz-apply`'s price floor — D4 dropped the floor calculation, so the
  existing guard is untouched. The true-breakeven question is still open, separately.
- `amzfeed.buybox`, `amzsold` et al are **not** dropped — D2 was "stop writing only".
  `buybox` is now the one column nothing writes; the others are still maintained for PB.

---

## Appendix — verification evidence

All figures from the live DB and your four sample files on 2026-07-28.

```
amzfeed              522 rows | buybox populated 0 | fbafee='3.39' 222 | 49 distinct fbafee
                              | on 3.39 AND live stock: 57  (the ones that actually matter)
sales             17,788 rows | AMZ 9,813 | SHP 7,842 | CM3 133 | AMZ to 2026-07-26
sales AMZ 12m      5,196 sale rows +£22,130.52 | 785 return rows -£3,460.89
skumap             2,084 rows | 537 with a sku
stock report         630 rows | 631 distinct sku | afn-listing-exists=Yes 630 (no-op filter)
                              | live stock >0: 204 | amzn.gr.* virtual: 13
orders report        774 rows | Shipped 745, Cancelled 17, Pending 10, Shipping 2
                              | Amazon.co.uk 763, Non-Amazon 11
                              | quantity: 1 x756, 2 x2, 0 x16
returns report       141 rows | 2026-06-28 -> 2026-07-28
fee report           259 rows | all GBP | 260 distinct sku, all present in stock report
                              | covers 202 of 204 live-stock SKUs; 369 of 371 absent = 0 stock
                              | fee min 2.95 p50 3.08 p90 3.36 max 4.61 | >3.39: 15 of 259
                              | vs stored: 94 fallback->real, 134 unchanged, 9 drifted
                              | mean(fresh - stored) = -0.102   <- fallback is HIGH, not low
                              | referral/price = 0.1500 x188, 0.1499 x42, 0.1501 x21,
                              |                  0.1503 x8, 0.1498 x1  -> referral is 15.0%
                              | fee-total = referral + fulfilment exactly, all 260 rows
                              | closing fee 0.00 all rows; order-handling blank all rows
                              | -> no Digital Services Fee line in this report
BCWEB column refs    amzlive 48, amzprice 20, fbafee 18, amztotal 13, fnsku 12
                     amzsold/amzsold7/amzsoldprice/amzsolddate/amzreturn/buybox/asin: 0
PB column refs       of_filteramzdisplay:220-230 reads amzlive amztotal amzprice
                     amzsolddate amzsold amzsold7 amzreturn amzsoldprice fnsku asin
                     buybox: declared, never read  -> only truly dead column
collision checks     same code twice in one order: 0 | same return key twice: 0
stock buffer         gi_amzstockbuffer = 0 (file values pass through to amzfeed unchanged)
barcode sample       X000Q6ARLD.bmp 161x56 32bpp -> Code 128 + FNSKU text, label-sized
```

### Changes from v1

1. **2.3 reversed direction.** £3.39 is *above* the median real fee (£3.08), not below.
   Margins on fallback SKUs are understated, not overstated. Fee report still worth
   wiring in — for the £4.60 outliers and for correctness — but it isn't the headline.
2. **2.1 half-retracted.** `of_filteramzdisplay` reads nine of the "dead" columns. They
   stay. The speedup survives by deriving them from `sales` instead of scanning orders.
3. **2.5 gained a third formula**, the one on your screen — which ignores `fbafee` and
   is the only one carrying the Digital Services Fee. Reopens D4.
4. **The 15.3% referral rate is stale.** Your fee file puts it at exactly 15.0% on all
   260 rows. Settled from data, no answer needed.
