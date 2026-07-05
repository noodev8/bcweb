# Add / Modify Product — Working Spec (DRAFT)

> Scratch spec for the new "Add / Modify" module. Built in stages; **thrown away when done.**
> Reference only: `docs/current-add-modify.png` (legacy PowerBuilder screen — we are free to redesign).

## 1. Purpose

Find & edit existing products, and load brand-new products. A "product" = one **groupid** (a
style/colour), with N size variants. Downstream (later stages): generate Shopify flat-file CSV and
Amazon upload file.

## 2. Data model (confirmed from live DB — `brookfield_prod`)

One product spans several tables, all keyed on `groupid`:

| Table | Grain | Key columns this screen touches |
|-------|-------|--------------------------------|
| `skusummary` | 1 row / product | brand, colour, colourmap, segment, season, width, material, tax, cost, rrp, shopifyprice, minshopifyprice, maxshopifyprice, imagename, shopify (0/1), regular_groupid, narrow_groupid |
| `skumap` | 1 row / size variant | code, optionsize, uksize, eurosize, ean, sku, status, deleted |
| `title` | 1 row / product | shopifytitle, googletitle, googletitleb |
| `attributes` | 1 row / product | gender, producttype, tag1..tag10, alt (⚠ table has a junk schema — dozens of stray `information_schema`-style columns; real columns are just these) |

Lookup/reference tables present: `brand`, `category`, `producttype`, `segment_notes`.

**Landmines (in addition to CLAUDE.md):**
- Price/number columns on `skusummary` **and** `skumap` are `character varying` — read via `safeNumeric`, write as strings.
- `attributes` is a polluted table — only write the real columns, never `SELECT *`-derive schema from it.
- Size code = `groupid` + `-` + 2 size chars (EU). e.g. `0128221-GIZEH-35`.
- `optionsize` format seen: `"101--35 EU / 2.5 UK"` (an ordering prefix `101--` + a display string). Needs confirming.

## 3. Reference values (live DB)

- **brand** (16): Birkenstock, Cipriata, Dek, Free Spirit, Goor, Grafters, Lazy Dogz, Lunar, Mod Comfys, R21, Remonte, Rieker, Roamers, Scimitar, Skechers, Strive
- **season** (3): Any, Summer, Winter
- **width** (2): Narrow, Regular
- **material** (8): Birko-Flor, Cork Latex, Cotton, EVA, Leather, Patent, Shearling, Vegan
- **colour** (17): Beige, Black, Blue, Brown, Gold, Green, Grey, Navy, Nude, Pink, Purple, Red, Silver, Tan, Taupe, White, Yellow
- **segment** (~30): EVA-SEG, ARIZONA-GENERAL, GIZEH-SEG, … (free-ish tag)
- **gender / producttype**: live in `attributes` (e.g. Unisex / Sandals)

## 4. Legacy screen breakdown (what each control does)

- **GROUP ID** box + **Copy** + **CHECK** → search; results list below (matching groupids). Select → load.
- Dropdowns: Brand, Colour, Product Type, Gender, Segment. **Shopify Title** (editable) + generate (`<`) button.
- Season dropdown; Cost, RRP, Price; Tax checkbox; "AMZ Highest"; Log button.
- Image: thumbnail, Update Images, Set Image Name, imagename text + generate (`<`) button.
- Size grid: Code / Barcode(ean) / Size Display / UK Size; Add Row, Delete Row, Up, Down.
- Winner block: Win/Lose, SHOPIFY, STANDARD; Shopify checkbox.
- SAVE.

## 5. Title generation rule (as described — TO CONFIRM)

Pattern: `Gender - Brand - <details> - Colour`.
- Birkenstock: **omit gender**, append `"<Width> Fit"`.
- Example: `Birkenstock Gizeh EVA Sandals White Regular Fit`
  = Brand `Birkenstock` + Model `Gizeh` + Material `EVA` + ProductType `Sandals` + Colour `White` + `Regular Fit`.
- ⚠ "Model" (`Gizeh`) appears to come from the groupid suffix after `-`. Needs confirming.

## 6. Staging plan

- **Stage 1 — Search. ✅ BUILT.** Search `skusummary.groupid` (ILIKE), list matches in groupid sort order. No match = the cue to create (creation deferred to a later stage). Delivered:
  - Server: `GET /product-search?term=` (`routes/product-search.js`, registered in `server.js`). Returns `{ groupid, title }[]`, ordered by groupid, LIMIT 50. Smoke-tested: auth-guard, list, empty, MISSING_FIELDS.
  - Web: dashboard tile "Add / Modify Product" → `/products` (`app/products/page.tsx`); `searchProducts()` + `ProductRow` in `lib/api.ts`.
  - ⚠ Deploy: server change needs a VPS/PM2 push before it's live for the Vercel front end (`docs/deploy.txt`).
- **Stage 2a — Load & display header. ✅ BUILT.** Master-detail: results list stays left, click a row → header loads right (read-only). Confirmed navigation = keep-the-search; scope = display-only first (save is Stage 2b). Delivered:
  - Server: `GET /product-get?groupid=` (`routes/product-get.js`, registered). One query LEFT JOINing skusummary + title + attributes (all verified 1:1 on groupid); prices via `safeNumeric`; tax/shopify 0/1→bool. Smoke-tested: SUCCESS, NOT_FOUND, MISSING_FIELDS.
  - Web: `/products` reworked into master-detail; `getProduct()` + `ProductDetail` in `lib/api.ts`. Fields shown: Brand, Colour, Product Type, Gender, Segment, Season, Width, Material, Cost, RRP, Price, Tax, Shopify + title header.
- **Edit Stage 1 — attribute/enum fields editable + SAVE. ✅ BUILT.** Editable dropdowns: Brand, Colour, Product Type, Gender, Segment, Season. Width/Material stay read-only (no legacy control). Delivered:
  - Server: `GET /product-lookups` (brand/colour/producttype tables; segments = DISTINCT skusummary.segment; genders Womens/Mens/Unisex, seasons Summer/Winter/Any — both fixed lists). `POST /product-update` — atomic `withTransaction`: UPDATE skusummary (brand,colour,segment,season) + UPDATE-or-INSERT attributes (gender,producttype); `updated` stamped `YYYYMMDD HH24:MI:SS` Europe/London; does NOT touch shopifychange/price log (attributes only).
  - Web: master-detail panel; off-list current value folded into each dropdown; dirty-tracking + Save/Reset; success/error inline.
  - Verified: lookups, MISSING_FIELDS, NOT_FOUND via HTTP; write SQL via manual BEGIN..ROLLBACK on a live product (restored, nothing committed).
- **Edit Stage 2 — Title + generate. ✅ BUILT.** Editable Shopify Title (`title.shopifytitle`) folded into the same atomic `product-update` (now writes 3 tables: skusummary + attributes + title, each UPDATE-or-INSERT). **Generate** button ports the legacy PowerBuilder routine faithfully: emits placeholder template (`<Any detail>`, and `<Narrow/Regular> Fit` for Birkenstock), prepends gender unless Unisex, drops type when producttype=`<Other>`; uses brand/colour/producttype/gender only (NOT groupid/segment/season). Output whitespace-normalised to single spaces (the original had a double-space quirk; also trims stray spaces from empty fields). Verified: generator branches + title write via BEGIN..ROLLBACK.
- **Edit Stage 3 — Sizes editable. ✅ BUILT.** `POST /product-sizes` reconciles skumap to the submitted list (in order): renumber `optionsize` = `(pos+100)--<sizeDisplay>`; UPDATE existing by code (ean + optionsize); INSERT new (code=`groupid-<size>`) with legacy scaffold seeded from product cost + RRP (amzprice/max=RRP, amzmin=RRP*.70, fba from sibling/2.24, status='1'); HARD DELETE removed codes (owner decisions). Barcode stored as `ean`+`B`. Validations: ≥1 size, non-blank code (no spaces) + display, no dup code/barcode. Web: `SizeEditor` component — inline edit barcode + size display (code locked), Add (type EU size)/Remove/Up-Down reorder, own Save/Reset + dirty-tracking. UK size still hidden (existing preserved, new = blank). Verified via BEGIN..ROLLBACK: reorder/edit/add/delete + scaffold seeding, restored.
- **Later edit stages (NOT started):** Price/Cost/RRP/Tax (via pricing W1 route — shopifychange + price_change_log), Sizes (skumap add/edit/reorder). Open Q: changing colour/producttype/title feeds the Shopify listing but currently doesn't set shopifychange — decide if/when catalogue edits should flag a sync.
- **Stage 3 (display) — Sizes. ✅ BUILT.** Read-only size table on the detail panel: Code / Barcode / Size Display (UK size deliberately omitted until needed). Loaded as part of `product-get` (2nd fixed query on `skumap`, returned as `sizes[]`). Transforms (validated 100% consistent across 1994 rows): Barcode = `ean` minus trailing `B` (blank→null); Size Display = `optionsize` minus `^[0-9]+--` prefix; ordered by that numeric prefix; `deleted=0` filter. Add/edit/reorder is a later stage.
- Stage 4: Title & imagename generation.
- Stage 5: Winner flags, images.
- Stage 6+: Shopify flat-file CSV, Amazon upload file.

## 7. Open questions

(see chat — to be folded in as answered)
