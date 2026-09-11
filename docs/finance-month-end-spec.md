# Finance — Month End module spec (v1)

**Status: PHASES 1 AND 2 BUILT 2026-09-11, uncommitted, not click-tested.** Five utils, two routes,
the `/finance` screen and its dashboard tile. Server lint, web tsc, web lint and `next build` all
clean. Verified end-to-end against live August 2026 data:

| Source | Verified against | Result |
|---|---|---|
| Amazon | the live transaction file + the PowerBuilder rules | 950 rows, reconciliation difference **exactly £0.00** |
| PayPal | a live export, side by side with `shopify_fees.py` | **£198.44 / 85 fees — identical** |
| Shopify | `month-export.py` run on the same month | rebuilt report is **byte-identical** (same MD5, 1,118 rows) |
| Shopify cache | a full run vs a skipped run + the cache | same figures, **identical files**, 3.8s → 0.1s |
| Stock | `stock_position.py` | £87,770.96 / 3,052 units — identical |

The one thing not done is a human clicking it.

Nothing is open. The Shopify VAT derivation (§3.3) and the `skumap.code` match were both
**confirmed by the owner, 2026-09-11**.

This document is authoritative for how
Brookfield's monthly accounts figures are derived and how the two QuickFile import files
are produced. Where it disagrees with the PowerBuilder Finance window, **this wins** —
§5 lists every place it deliberately departs from it and why.

The module replaces the PowerBuilder *Finance* window (`CALCULATE Accounts` +
`QUICKFILE Invoice`) and the `C:\scripts\month-end\` Python pack. Both stay in place
until this is reconciled against a live PB run for two consecutive months (§8).

---

## 0. What this is for

Once a month, the owner closes the books: pull the month's sales, VAT and fees from four
places, add three figures by hand, and produce two CSVs that import into QuickFile —
one sales invoice file, one purchase invoice file. That is the whole job. Everything in
this document exists to make those two files correct.

**It is stateless by decision (owner, 2026-09-11).** Nothing is stored: no tables, no
migration, no history. Upload, calculate, download, done. The accepted consequence is
that there is no record in BCWEB of what a run produced — the record is the files the
owner files away (§4.3).

---

## 1. What it replaces

Thirteen manual steps today. After Phase 2 (§8) the owner downloads one Amazon file, one
PayPal file, types three numbers, and presses two buttons.

| Today | After |
|---|---|
| Download PayPal export, rename to exactly `Download.CSV` | drop the file on the screen, any name |
| Download Amazon transactions, rename to `AMAZON-Sales.csv` | drop the file on the screen, any name |
| Run `month-export.py` in another project | Shopify pulled live from the API |
| Read 3 numbers off a console and retype them | gone |
| SumUp sales + fees, shop cash, car | **unchanged — still typed in** (§3.5) |
| PB *Calculate Accounts* | one screen, every figure drillable |
| PB *QuickFile Invoice* | one button |
| Move 3 files to Accounts Income by hand | download the year-end pack (§4.3) |
| Stock figure into `Brookfield-Finance.xls` | shown on screen (§3.6) |
| Two imports into QuickFile | **unchanged — unavoidable** |

---

## 2. Sources

| Source | How it arrives | Automatic? |
|---|---|---|
| Amazon | Seller Central → Payments → Reports Repository → Monthly Transaction CSV, uploaded | no — manual download |
| Shopify sales/refunds/VAT | Orders API, live | yes |
| Shopify fees | Balance Transactions API, live | yes |
| PayPal fees | PayPal *All transactions* CSV, uploaded | no — manual download |
| SumUp sales + fees | typed | no |
| Shop cash | typed | no |
| Car / other expenses | typed | no |
| Stock value | database | yes |

**Both uploads are OPTIONAL.** Shopify comes from the API and the stock valuation from the
database, so a run with nothing dropped on the screen is a real month — it simply has no Amazon
and no PayPal figures, and the checks say so in words. (Until 2026-09-11 the route refused an
empty upload and the screen disabled its only button, which made a perfectly good run
unreachable.) Uploading a file that is *not* recognised is a different matter and still stops the
run: the operator meant to include it, so a plausible-looking month with a silently empty Amazon
block is exactly the failure this module exists to end.

**Uploaded files are identified by header fingerprint, never by filename.** This is the
established pattern from the Update Amazon module (`docs/update-amazon-port.md`) and it
exists because PowerBuilder's `FileOpen` returns -1 on a missing file, the read loop
exits, and the grid silently stays at zero. Two rename rituals die with it: Amazon's
`AMAZON-Sales.csv` and PayPal's exact-case `Download.CSV`.

The Amazon file carries **nine preamble lines** before its header row. Strip by content,
not by counting to nine — the count already differs between the two PB functions that
read it (§9).

---

## 3. The rules

### 3.1 Amazon

Derived from the Monthly Transaction CSV. **Every row type is in scope**, but rows are
classified rather than swept into one bucket.

```
INCOME      types: Order, Refund, Liquidations, Order_Retrocharge
  net     = product sales + postage credits + gift wrap credits + promotional rebates
  VAT     = product sales tax + shipping credits tax + giftwrap credits tax
          + promotional rebates tax + marketplace withheld tax
          ... with each row's tax ZEROED if its product is zero-rated (§3.2)
  gross   = net + VAT

FEES        every row except Transfer
  fees    = selling fees + fba fees + other transaction fees
          + `other` on every row EXCEPT Adjustment (Service Fee subscriptions, refund admin)

REIMBURSEMENTS
  income  = `other` on Adjustment rows             (FBA lost/damaged stock, no VAT)

EXCLUDED
  Transfer rows entirely                           (payout to the bank, not a transaction)
```

Refunds are negative rows in the same file and net off naturally — there is no separate
refund line on the Amazon side, unlike Shopify.

Worked example, August 2026 (950 rows):

| | |
|---|---|
| Income net | 17,943.71 |
| VAT charged | 3,561.64 |
| **Income gross** | **21,505.35** |
| Fees | −7,208.93 |
| Reimbursements | +233.74 |

Every row is allocated and the arithmetic closes exactly: the non-Transfer rows' own `total`
column sums to **14,530.16**, and so does `net + VAT + fees + reimbursements`. That
zero difference is the reconciliation the screen shows (§6) — it is what catches a format
change on Amazon's side, and it is the reason `other` is swept into fees for every row
*except* Adjustment rather than being left unallocated.

The only difference from PowerBuilder is the reimbursement: −7,208.93 + 233.74 = −6,975.19,
which is PB's fee figure to the penny.

Deferred rows are booked on posted date, the same as Released. Amazon defers a slice of
every month (August: £6,314 gross) and releases it in the next; treating both the same
way every month self-corrects, and the alternative — tracking deferral across month
boundaries — is a ledger this module has deliberately not signed up for.

### 3.2 VAT and zero-rated (kids) items

Amazon charges VAT on children's footwear, which is zero-rated in the UK. The figure it
reports is therefore not the VAT that should be declared.

**The authority is `skusummary.tax`** (1 = VAT applies, 0 = zero-rated), reached via
`skumap.sku → groupid`. For each income row, if the product resolves to `tax = 0`, that
row contributes **zero** to the VAT total. Its net sales still count in full.

This replaces the PowerBuilder approach of matching `BOYS`/`GIRLS`/`CHILD`/`SCHOOL`/
`KIDS`/`CHILDRENS` in the item description plus four hard-coded codes
(`B430A-03` … `B430A-06`). The flag is maintained on the product; the description is not.

The screen still shows a **Kids VAT** figure — the VAT Amazon charged on zero-rated items
— but it is now *explanatory*, showing what was excluded. It is no longer an adjustment
added to a total after the fact.

**Unmatched SKUs are surfaced, never assumed silently.** August had four of 782 income
rows unmatched: three Amazon-generated `amzn.gr.*` SKUs and one real-looking
`233103-NVY-11.5-2512`. The screen names them with their value and states that standard
rating was assumed. (August had *no* `tax = 0` rows at all, which is why
`kidsvatcharged.csv` is empty and the PB box reads 0.00 — the mechanism is sound, the
month simply has nothing in it.)

### 3.3 Shopify

A Node port of `C:\scripts\month-end\month-export.py` and `shopify_fees.py`, living in
`bcweb-server/utils/financeShopify.js`. The Python stays where it is until Phase 2 signs
off; then it is retired.

**VAT is NOT taken from Shopify** — it cannot be. Every tax line this shop returns reads
`{"rate": 0.2, "title": "GB VAT", "price": "0.00"}`, and every order's `total_tax` is 0.00, so the
Taxes column of the rebuilt report totals £8.99 against £32,820 of August sales. It is derived
instead from `skusummary.tax`, exactly as the Amazon side does it: a sixth of each standard-rated
row's VAT-inclusive total, nil for a zero-rated one. August 2026: **£5,460.85 sales VAT,
−£849.88 refund VAT**, with 2 zero-rated rows (£60.00) excluded and **no unmatched SKUs**.

**Confirmed by the owner, 2026-09-11**, along with the `skumap.code` match below.

**The pull happens once per month, not once per Calculate.** It is the only slow thing on the
screen — about half a minute for ~540 orders — and the second run of a session is almost always a
corrected Amazon file or a changed typed figure, neither of which has anything to do with Shopify.
So the screen caches the pull, keyed by the month it was read for, and tells the server to skip
Shopify entirely on subsequent runs (`includeShopify=false`). Measured on August 2026: **3.8s →
0.1s**, with the generated QuickFile files byte-identical either way.

The cache is bypassed only two ways, both explicit: the month changes (the key stops matching, so a
fresh pull happens by itself), or the operator presses **re-read** on the Shopify block. Nothing
decides on its own that the figures have gone stale. A failed pull is never cached, so a bad
morning at Shopify is retried by simply pressing Calculate again.

Sales, refunds and VAT come from the **Orders API**, two passes:

1. orders created in the target month → sale and shipping rows
2. orders created in the 90 days before it but *updated* during it → refunds on older
   orders, which belong to this month

Refund rows are dated by the refund's date, not the order's. Shipping refunds offset the
original shipping row rather than appearing as returns. Prices are tax-inclusive, so the
tax is stripped out to get the net. This is all existing, working logic — port it
faithfully rather than rederiving it.

Fees come from the **Balance Transactions API** — `charge`, `refund` and `dispute` types
within the month, summing the `fee` field. Needs the `read_shopify_payments_payouts`
scope on `SHOPIFY_ACCESS_TOKEN`.

Four figures reach the screen: Sales, Sales VAT, Refund, Refund VAT — plus Fees.

### 3.4 PayPal

Sum the `Fee` column of the uploaded transaction CSV. Fees are negative in the file; the
total is presented positive. No renaming, no archiving to `-done`, no re-run trap.

### 3.5 Typed by hand

SumUp sales, SumUp fees, shop cash, car. **Deliberately left manual (owner, 2026-09-11)**
— shop and SumUp together are five or six sales a month. The SumUp API would remove the
worst remaining step (opening each payment to add up fees by hand) and should be revisited
if that volume ever grows, but it does not earn its setup today.

For the same reason, shop and SumUp VAT stays at **gross ÷ 6**, which assumes everything
is standard-rated. Strictly this over-declares on any kids' shoes sold in the shop; at
this volume the owner has accepted it. Revisit with the SumUp API, not before.

### 3.6 Stock value

Units and cost value of stock held, shown on the screen. Port the SQL from
`C:\scripts\month-end\stock_position.py`:

```
#FREE local stock (deleted = 0, ordernum = '#FREE')
  + amzfeed.amztotal
  valued at skusummary.cost per groupid
```

This is display only — it is not a QuickFile line, and it replaces typing the figure into
`Brookfield-Finance.xls`.

> **Name collision, do not confuse:** Analytics already has a *Stock Position* module. That
> one counts how many products are commercially **alive** (a living-catalogue gauge). This
> one is a **valuation** in pounds. Different measures, same words.

The PB window's *Sell through opening stock* button and the two blank fields beside
*Stock Value* are **dead and not ported** (owner, 2026-09-11).

---

## 4. Outputs

Both files use `28/<month>/<year>` for every date column — issue, receipt and paid.
The month comes from **the selector on the screen**, not from `today - 1 month`. That
alone fixes the January bug in §9.

Rows whose value is zero or null are omitted entirely.

### 4.1 QuickFile-Sales-Invoice.csv

Columns: `Issue Date, Client name, Description, Total gross amount, VAT Rate, VAT Amount, Paid Date, Paid bank account nominal code`

| Client | Description | Gross | VAT rate | VAT | Bank |
|---|---|---|---|---|---|
| Amazon UK | Amazon Sales | Amazon income gross | 20 | Amazon VAT (§3.2) | 1251 |
| Amazon UK | FBA Reimbursements | reimbursements | 0 | 0.00 | 1251 |
| Shopify Brookfield Comfort | Shopify Sales | Sales + Refund | 20 | Sales VAT + Refund VAT | 1253 |
| SumUp | Shop Card Sales | SumUp total | 20 | gross ÷ 6 | 1258 |
| Shop | Shop Cash Sales | cash total | 20 | gross ÷ 6 | 1230 |

The reimbursements row is new (§5). Amazon's `VAT Rate` stays "20" as a label even though
the effective rate across the gross is slightly under that whenever zero-rated items sell
— QuickFile takes the gross and the VAT amount explicitly, so the label does not drive
anything.

### 4.2 QuickFile-Purchase-Invoice.csv

Columns: `Receipt Date, Supplier name, Description, Total gross amount, VAT Rate, VAT Total, Purchase Nominal Code, Paid Date, Paid bank account nominal`

| Supplier | Description | Gross | VAT rate | VAT | Nominal | Bank |
|---|---|---|---|---|---|---|
| Amazon | Fees | Amazon fees, positive | 20 | gross ÷ 6 | 6003 | 1251 |
| Shopify | Fees | Shopify fees | 0 | 0.00 | 6003 | 1253 |
| PayPal | Fees | PayPal fees | 0 | 0.00 | 6003 | 1254 |
| Car | Travel | car total | 0 | 0.00 | 7400 | 1230 |
| SumUp | Fees | SumUp fees | 0 | 0.00 | 6003 | 1258 |

Amazon charges VAT on its fees and Shopify does not (confirmed, owner 2026-09-11) — hence
20% on one and 0% on the other.

### 4.3 The year-end pack

The owner keeps the month's source and derived files as year-end documentation. The screen
offers each as a download:

- `Shopify Transaction.csv` — the Orders-API rebuild, same format as the Shopify Admin
  *Analytics → Reports → Shopify Transaction* export
- `kidsvatcharged.csv` — the income rows whose product is `tax = 0`, with the VAT that was
  charged on them
- `QuickFile-Sales-Invoice.csv`, `QuickFile-Purchase-Invoice.csv`

The Amazon and PayPal source files are already on the owner's machine — they were uploaded
from it — so they are not handed back.

---

## 5. Deliberate departures from PowerBuilder

Decided 2026-09-11: **do the correct thing for the accounts regardless of how previous
months were treated.**

| # | PowerBuilder | Here | Why |
|---|---|---|---|
| 1 | `other` on every row is swept into **Fees** | classified by row type (§3.1) | The bucket mixes unlike things. In August it held a **+£233.74** FBA reimbursement, which reduced fees rather than counting as income — understating both income and costs — and then had VAT claimed on it at gross ÷ 6, on a reimbursement carrying none. |
| 2 | Kids VAT found by description keywords + 4 hard-coded codes | `skusummary.tax` | The flag is maintained on the product. A description is not, and a renamed listing silently drops out of the rule. |
| 3 | Kids VAT added to the Amazon VAT total after the fact | each row's VAT zeroed at source | Same arithmetic, but the total is right by construction and the kids figure becomes evidence rather than a correction. |
| 4 | Month derived as `today - 1 month` | month selector on the screen | Removes the January bug (§9) and makes a re-run of an older month possible. |
| 5 | Grid silently reads 0.00 when a file is missing | header fingerprinting + explicit checks | The failure mode PowerBuilder is famous for here. |
| 6 | `Real` (single-precision) accumulation | Decimal throughout | PB's August figures drift 7p on sales and 2p on fees across 950 rows. VAT happened to tie exactly. |

Departure 1 is the only one that changes a number the accountant will see. August, for
illustration: fees move from −6,975.19 to −7,208.93, and £233.74 appears as income.

**Everything else is kept as-is**, including: all row types in scope, `marketplace withheld
tax` counted as VAT, Transfers excluded, Deferred rows booked on posted date, the 28th as
the invoice date, and every nominal code in §4.

---

## 6. The screen

One page, `/finance`, behind the usual auth. Sources at the top, figures in the middle,
checks and actions at the bottom.

```
┌─ FINANCE · MONTH END ──────────────────────── [ August 2026 ▾ ] ─┐

  SOURCES
  Shopify      pulled live from API            1,204 rows      ✓
  Amazon       2026AugMonthlyTransaction.csv     950 rows      ✓
  PayPal       All-transactions export            41 fees      ✓
  SumUp        sales [        ]   fees [        ]
  Shop cash    [        ]
  Expenses     Car [        ]

  AMAZON                          SHOPIFY
  Sales            21,505.35      Sales              —
  VAT               3,561.64      Sales VAT          —
  Kids VAT ⓘ            0.00      Refund             —
  Fees             −7,208.93      Refund VAT         —
  Reimbursements     +233.74      Fees               —

  OTHER SALES                     EXPENSES
  SumUp                —          Car                —
  Shop cash            —          SumUp fees         —
                                  PayPal fees        —

  CHECKS
  ✓ 950 rows, every one accounted for
  ✓ file total ties to the sum of the parts
  ! 4 SKUs unmatched (£118.40) — standard rating assumed

  [ Generate QuickFile files ]   [ Year-end pack ]

  Stock value  £—  (— units)
└──────────────────────────────────────────────────────────────────┘
```

Design notes:

- **Every figure drills.** Clicking Amazon Sales shows the rows behind it, by type, with
  what was excluded and why. This is the substantive upgrade over PB, where a number is
  either right or a red box and there is no way to tell which.
- **Checks gate nothing** but are read before generating. The row reconciliation
  (`rows in file = income + fees + reimbursements + excluded`) is the one that matters:
  it is what catches a format change on Amazon's side.
- Follow the house neutral-slate palette. A warning is a warning because of what it says,
  not because it is a colour.

---

## 7. API

Two routes, one file each, per `docs/API-RULES.md`. Both return HTTP 200 with a
`return_code`. **Neither writes anything.**

### `POST /finance-calculate` — multipart/form-data

Files under `files` (Amazon and/or PayPal, identified by header), plus `month` (`YYYY-MM`)
and the typed figures. Pulls Shopify live, reads `skusummary.tax` and the stock valuation,
returns every figure with its supporting evidence: per-source row counts, the reconciliation,
unmatched SKUs, and the drill-down rows.

Return codes: `SUCCESS` · `NO_FILES` · `FILE_TOO_LARGE` · `UNRECOGNISED_FILE` ·
`DUPLICATE_FILE` · `SHOPIFY_UNAVAILABLE` · `UNAUTHORIZED` · `SERVER_ERROR`

`SHOPIFY_UNAVAILABLE` is not fatal — the rest of the screen fills in and the Shopify block
says so, the same way `month-export.py` guards its fees step today.

### `POST /finance-quickfile`

Takes the figures back and returns the requested file(s). It generates from what it is
given, never from a re-parse, so what downloads is exactly what was on the screen.

Return codes: `SUCCESS` · `MISSING_FIGURES` · `UNAUTHORIZED` · `SERVER_ERROR`

### Utils

| File | Owns |
|---|---|
| `utils/financeAmazon.js` | transaction CSV parse + classification (§3.1), the `tax` lookup (§3.2) |
| `utils/financeShopify.js` | Orders API + Balance Transactions port (§3.3), `Shopify Transaction.csv` |
| `utils/financePayPal.js` | PayPal CSV fee total (§3.4) |
| `utils/financeQuickFile.js` | both output files (§4) |

The only DB reads in the module are `skumap`/`skusummary` for the tax flag and the stock
valuation. No writes at all — so no `withTransaction`, and nothing for the live-production-DB
caution in `CLAUDE.md` to bite on.

---

## 8. Build phases

**Phase 1 — parity. BUILT 2026-09-11.** Amazon parse, PayPal parse, both QuickFile generators,
the screen with Shopify and the typed figures entered by hand.

  Reconciled against PowerBuilder on the August 2026 file before the screen was written, and the
  agreement is exact once §5's two known differences are allowed for:

  | | BCWEB | PowerBuilder |
  |---|---|---|
  | Sales (gross) | 21,505.35 | 21,505.42 *(float drift, §5.6)* |
  | VAT | 3,561.64 | 3,561.64 |
  | Fees | −7,208.93 | −6,975.19 *(= −7,208.93 + 233.74, §5.1)* |
  | Reimbursements | +233.74 | *folded into fees* |

  Still to do before the PB window is retired: run both in parallel for **two months** and confirm
  the QuickFile imports land identically.

**Phase 2 — Shopify. BUILT 2026-09-11.** `utils/financeShopify.js`, a port of `month-export.py`
and `shopify_fees.py`. Pulled live on every Calculate; the five figures are no longer typed.

  The acceptance test was byte-equality, and it passed: the rebuilt *Shopify Transaction* report
  for August 2026 has the same MD5 as the one `month-export.py` writes — 1,118 rows, 128,469 bytes,
  identical. Fees agree too (£646.16 across 388 charges, 81 refunds, 1 dispute).

  Three things the port found that the Python does not surface:

  1. **Shopify reports no VAT at all.** Every tax line is `{"rate": 0.2, "title": "GB VAT",
     "price": "0.00"}` and every order's `total_tax` is 0.00 — £8.99 across the whole month
     against £32,820 of sales. So the report's Taxes column cannot be what gets declared, and VAT
     has to be derived. See the open question in the status block above.
  2. **Shopify's SKU is `skumap.code`, not `skumap.sku`.** `skumap.sku` is the AMAZON column.
     Matching Shopify SKUs against it looks like it works and silently misses 595 of 1,118 rows;
     against `code` it misses none.
  3. **The two Shopify tokens are not interchangeable.** Orders accept either, but balance
     transactions need `SHOPIFY_ACCESS_TOKEN` (`read_shopify_payments_payouts`); the orders token
     returns 403. Both verified against the live shop.

**Phase 3 — if wanted.** Expenses as a repeating list with nominal codes rather than one
hard-coded Car line. SumUp API. Zero-rating on shop sales. None of these are committed.

**Before the PowerBuilder window is retired:** run both for two months and confirm the QuickFile
imports land identically. That is the only outstanding gate.

---

## 9. Inherited bugs — fixed here, and still live in PowerBuilder

Until PB is retired, these are live in the tool the owner is still using:

1. **January produces `28/00/2026`.** Both QuickFile generators do
   `li_month = month(today) - 1` then only decrement the year `IF ls_month = "12"` — which
   in January is `"00"`, never `"12"`. So January's files carry month `00` and the wrong
   year. `calculate-accounts` handles the rollover correctly; the two generators do not.
   Fixed here by selecting the month explicitly (§5.4).
2. **`ls_code` is never reset in `of_kidsvat`.** When a SKU lookup misses, the variable
   still holds the *previous* row's code, so a miss inherits it — and can false-trigger
   the `B430A-03..06` rule. Fixed here by the tax flag replacing the whole mechanism, and
   by surfacing unmatched SKUs rather than letting them fall through (§3.2).
3. **The two readers disagree on the preamble.** `of_amzaccounts` skips 10 lines,
   `of_kidsvat` skips 8 — so the kids pass imports two preamble rows as data. Harmless
   only because they are then deleted for not being Order/Refund. Fixed by detecting the
   header rather than counting lines (§2).
4. **PayPal's `Download.CSV` is renamed to `Download-done.CSV` after processing.** A
   re-run finds nothing and reports "PayPal fees not available in the results" — the run
   looks fine and the number is simply absent. Fixed by uploading the file (§3.4).

---

## 10. Open

Nothing blocking. Carried, not committed:

- **SumUp API** — would remove the last genuinely painful manual step (adding up fees
  payment by payment). Parked on volume, not on difficulty (§3.5).
- **Amazon SP-API Finances** — would remove the monthly file download. Significant setup
  for one file a month; not worth it today.
- **Zero-rating on shop and SumUp sales** — over-declares VAT at gross ÷ 6 if kids' shoes
  sell in the shop. Accepted at current volume (§3.5).
