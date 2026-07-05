# Add / Modify Product — Working Spec (DRAFT)

> Scratch spec + progress log for the "Add / Modify" module. Built in stages; **thrown away when done.**
> References: `docs/current-add-modify.png` (legacy PowerBuilder screen) and `docs/add-modify-save-powerbuilder.txt`
> (the legacy SAVE code — authoritative for how new/updated products are written).

---

## 0. STATUS & NEXT UP  (read this first)

**Where we are:** the *edit an existing product* flow is functionally complete and committed on `main`
(up to commit `0d3d6f7`). You can search a groupid, load it master-detail, and edit + save the header
attributes, the title (with Generate), and the full size list.

**⚠ Deploy:** everything is **local only**. The 5 new endpoints below need a **VPS/PM2 deploy**
(`docs/deploy.txt`) before the Vercel front end can use them.

**Next up (not built), in suggested order:**
1. **Price edit** — Cost, RRP, Tax on `skusummary`; **Shopify price must go through the pricing W1
   route** (`pricing-apply`: `shopifychange=1` + `price_change_log`, bounds, review period) per the owner.
   Legacy price handling (min/max shopify price, `maxshopifyprice='RRP'` default, RRP≥cost validation) is
   in the PB save reference. This is the one edit stage with real write rules — treat carefully.
2. **New-product creation** — the LOAD-NEW half of the PB save (ref lines ~218–383): generate the `handle`
   (slugify `title-groupid`, keep only `[0-9a-z-]`, collapse `--`, uniqueness check), then INSERT across
   `skusummary` + `title` + `attributes` + `skumap` with the legacy defaults. The `/products` search already
   surfaces "no match → create" as the entry point.
3. **Remaining legacy controls** (smaller): Winner block → `skusummary.shopify` (Shopify on/off) + Win/Lose;
   Image actions (Update Images, Set Image Name); Copy button (clone to a new groupid); price-change Log view.
4. **Downstream (later):** Shopify flat-file CSV export, Amazon upload file.

**Open decisions to resolve when relevant:**
- **shopifychange on catalogue edits:** colour/producttype/title feed the Shopify listing, but `product-update`
  / `product-sizes` do NOT set `shopifychange`, so the nightly sync won't push them. Decide if/when catalogue
  edits should flag a sync.
- **Required-field validation:** the PB save *requires* brand/colour/producttype/gender/rrp/cost/season and
  per-size cost/price. Our edit endpoints are permissive (no required fields). Decide whether to enforce —
  especially important for new-product creation.
- **UK size** is hidden (existing rows preserved, new sizes get blank `uksize`). Bring back / auto-derive when needed.
- New sizes get a blank per-size `shopifyprice` (legacy didn't set it either).

---

## 1. Purpose

Find & edit existing products, and load brand-new products. A "product" = one **groupid** (a style/colour),
with N size variants.

## 2. Data model (confirmed from live DB — `brookfield_prod`)

One product spans four tables, all keyed on `groupid` (title & attributes verified 1:1 on groupid):

| Table | Grain | Columns this screen touches |
|-------|-------|--------------------------------|
| `skusummary` | 1 / product | brand, colour, colourmap, segment, season, width, material, tax, cost, rrp, shopifyprice, minshopifyprice, maxshopifyprice, imagename, shopify (0/1), supplier |
| `skumap` | 1 / size variant | code, optionsize, uksize, ean, cost, amz* prices, deleted, status, fba, supplier, … |
| `title` | 1 / product | shopifytitle, googletitle, googletitleb, last_shopify_sync |
| `attributes` | 1 / product | gender, producttype, tag1..tag10, alt (⚠ junk schema — dozens of stray `information_schema`-style columns; only these are real) |

Lookup tables: `brand` (brand, supplier), `colour` (colour), `producttype` (producttype). Also `category`, `segment_notes`.

**Landmines (in addition to CLAUDE.md):**
- Price/number columns on `skusummary` **and** `skumap` are `character varying` — read via `safeNumeric`, write as 2dp strings.
- `attributes` is a polluted table — only write the real columns, never `SELECT *` / derive schema from it.
- Size code = `groupid` + `-` + EU size (e.g. `0128221-GIZEH-35`). Code is locked (never rewritten on edit).
- `optionsize` = `"<seq+100>--<display>"` (e.g. `101--35 EU / 2.5 UK`). The `<seq>` prefix IS the sort order;
  the save renumbers it by row position. **Confirmed** across all 1994 rows.
- `ean` carries a **trailing `B`** (legacy Excel guard — see memory `ean-trailing-b`): strip for display, re-append on write.
- `updated` stamp format = `YYYYMMDD HH24:MI:SS`, Europe/London wall-clock.

## 3. Reference values (live DB)

- **brand** lookup (16): Birkenstock, Cipriata, Dek, Free Spirit, Goor, Grafters, Lazy Dogz, Lunar, Mod Comfys, R21, Remonte, Rieker, Roamers, Scimitar, Skechers, Strive
- **colour** lookup (17): Beige, Black, Blue, Brown, Gold, Green, Grey, Navy, Nude, Pink, Purple, Red, Silver, Tan, Taupe, White, Yellow
- **producttype** lookup (5): `<Other>`, Boots, Sandals, Shoes, Trainers
- **segment**: DISTINCT `skusummary.segment` (~29), alphabetical
- **gender** (fixed): Womens, Mens, Unisex · **season** (fixed): Summer, Winter, Any
- Lookup tables can be incomplete vs live data → the UI folds a product's current off-list value into its dropdown.

## 4. Title generation (CONFIRMED — from PB code)

Ported faithfully in `generateTitle` (web). Uses **brand / colour / producttype / gender only** (NOT groupid/segment/season).
Emits editable placeholders `<Any detail>` (the model/detail the user fills in) and, for Birkenstock, `<Narrow/Regular> Fit`.
Rules: Birkenstock → no gender, add the width-fit reminder; non-Birkenstock → prepend gender unless Unisex;
producttype `<Other>` → drop the type. Output normalised to single spaces.
(Earlier guess that the model came from the groupid suffix was **wrong** — it's a manual placeholder.)

## 5. Endpoints built (this module)

- `GET  /product-search?term=` — search `skusummary.groupid` (ILIKE), groupid order, cap 25 + `limited` flag.
- `GET  /product-get?groupid=` — header (skusummary + title + attributes) **+ `sizes[]`** from skumap (2nd fixed query).
- `GET  /product-lookups` — dropdown option lists (brand/colour/producttype tables; distinct segments; fixed gender/season).
- `POST /product-update` — atomic save of header attributes + title: skusummary(brand,colour,segment,season) +
  attributes(gender,producttype) + title(shopifytitle), each UPDATE-or-INSERT. Does NOT touch shopifychange/price log.
- `POST /product-sizes` — atomic reconcile of skumap to the submitted list: renumber `optionsize` by position;
  UPDATE existing by code; INSERT new (`code=groupid-<size>`) with legacy scaffold seeded from product cost + RRP;
  HARD DELETE removed codes. Barcode → `ean`+`B`. Validates ≥1 size, non-blank code/display, no dup code/barcode.

Web: `app/products/page.tsx` (master-detail + header edit) and `components/SizeEditor.tsx` (size grid).
Client fns in `lib/api.ts`. Dashboard tile "Add / Modify Product" → `/products`.

## 6. Stage log

- **Stage 1 — Search.** ✅ `product-search` + `/products` search screen + dashboard tile.
- **Stage 2a — Load & display header (read-only).** ✅ `product-get` + master-detail panel + image (next/image).
- **Stage 2b/Edit-1 — Header attributes editable + SAVE.** ✅ Brand/Colour/Product Type/Gender/Segment/Season dropdowns; `product-lookups` + `product-update`.
- **Edit-2 — Title + Generate.** ✅ Title folded into `product-update`; Generate button (PB port); "Title" label; Width/Material removed from UI.
- **Edit-3 — Sizes editable.** ✅ `product-sizes` reconcile + `SizeEditor` (edit barcode/display, add/remove/reorder). Size Display font aligned.

All writes verified against a live product via manual `BEGIN..ROLLBACK` (nothing committed), per CLAUDE.md.

## 7. Testing note

Write paths are exercised with a throwaway Node script using the server pool inside `BEGIN..ROLLBACK`
(see how prior stages were tested). HTTP smoke tests use a temp seeded user, deleted afterwards.
The API points at the LIVE prod DB — never commit a test write to a real product.
