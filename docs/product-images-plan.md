# Product images — plan (TEMP, 2026-10-13)

Working plan carried between machines. Delete once steps 1–2 ship and the decisions below are recorded in the code headers.

## Why

`utils/shopify.js` productSet sent `files = [main DB image]` on every push (W1 price apply, Add/Modify saves) from 2026-07-09. Shopify
treats `files` as the WHOLE gallery, so every repriced product lost its extra images: 171 of 196 repriced in-stock products were down
to one image (133 Birkenstock). Deleted Shopify media 404s — not recoverable.

**Done 2026-10-13 (deployed to VPS):**
- Push fix (bcweb `22bfd72`): on an edit, push reads the live Shopify gallery and sends it back by media id; a main-image upload replaces
  only slot 0. Nothing deletes images any more.
- `shopifyimages` table DROPPED; `C:\scripts\images\updateimages.py` + Drive creds + cron line removed (scripts `296502e`) — the
  "protection" never protected anything and PowerBuilder products are retired.

Root problem left: our DB knows only the main image (`skusummary.imagename`); the gallery exists only on Shopify. Fix = we own it.

## Decisions (owner, 2026-10-13)

- **BCWEB is the only place images are managed** once the Images panel exists. Safety net: a push NEVER deletes a Shopify image our DB
  doesn't know — it is kept at the end and flagged "added in Shopify" on the Missing Images screen. An image removed only in the
  Shopify UI comes back on the next push (DB wins); remove in BCWEB.
- **2048 px**, square, white padded, JPEG q≈80, **never enlarged** (an 800 source stays 800). One shared processing util for every
  upload: main + gallery, new product + existing. Replaces product-image.js's 800×800.
- **No thumbnails needed** — every BCWEB screen renders via next/image (Vercel optimizer resizes to `sizes`, cached a year,
  `next.config.js minimumCacheTTL`). New screens must use `<Image>` with a small `sizes`, never a plain `<img>` of the original.
- Storage on one.com (existing SFTP, `utils/sftp.js`). ~250–400 KB/image → ~700 MB for the catalogue, ~+400 MB/yr. Shopify copies
  images to its own CDN, so the storefront never loads from one.com.
- **Existing 800 mains are NOT enlarged.** During this exercise each product gets a NEW 2048 main sourced alongside its gallery.
- **"Done" for a product = main ≥ 1500 px AND ≥ 4 images** (main + 3). Below that it's on the Missing Images list.
- **SEO naming:** `<existing SEO base from utils/imageName.js>-<view>.jpg`, e.g. `birkenstock-arizona-birko-flor-black-0151181-sole.jpg`;
  alt text "<title> – sole view". The view word is taken from the source filename ONLY if it's on a whitelist (side, sole, top, front,
  back, heel, inside, detail, pair, look, worn, campaign); otherwise a position number (`-2`, `-3`). Keeps Birkenstock's useful view
  words, drops garbage (`Screenshot_2025-…`, uuids). View word stored in its own column.
- **No Birkenstock portal login** → no bulk fetch; staff source images manually, tracked on the Missing Images screen.

## Step 1 — table, shared processing, import

1. Migration: `product_images`
   - `groupid`, `position` (1 = main), `filename` (on one.com), `view` (whitelisted word or NULL), `alt`, `width`, `height`,
     `shopify_media_id` (NULL until pushed — lets a push send `{id}` instead of re-downloading/duplicating), `created_at`, `created_by`.
   - Main image: keep `skusummary.imagename` in step (Google feed, Inventory, every screen reads it). Writers update both — no triggers.
2. `utils/productImage.js` (name TBD): sharp → 2048 contain/white/flatten, `withoutEnlargement`, JPEG q80; returns buffer + dims;
   SEO filename + view whitelist. `routes/product-image.js` switches to it (new + existing products → 2048).
3. One-off import script (`scripts/import-shopify-galleries.js`): for every Shopify product, read media in order; for each image not
   already held: download (Shopify keeps originals at upload size), process (cap 2048), SFTP to one.com, insert row with
   `shopify_media_id`. Also measure current one.com mains for `width/height`. **Dry run first (read-only, prints what it would do),
   then a real run on the owner's OK.**
   - Must run BEFORE any push switches to "send our DB gallery", or pushes would wipe galleries again.
   - Staff uploads made in Shopify before the import get picked up by it.

## Step 2 — Missing Images screen (Back Office)

- One row per active product: thumbnail, title, image count, main size, flags (`low-res main`, `< 4 images`, `added in Shopify`).
- Filters: in stock, brand, status (Winners first). Default sort: Winners → stock → worst first.
- Progress: remaining count + done today (rows whose `created_at` is today and that now meet "done").
- Reads our table only (no live Shopify calls). Uses next/image with small `sizes`.
- Until the Images panel exists, staff upload in the Shopify UI; re-run the import to pull new images in.

## Later (not started)

3. Images panel on the product screen (multi upload, reorder, set main, delete) + switch push to send the DB gallery
   (`{id}` for known media, `originalSource` for new, unknown Shopify media kept at the end).
4. Google feed: `additional_image_link` (up to 10) in `C:\scripts\merchant-feed\merchant_feed.py`.

## Useful

- Live single-image audit: `python C:\scripts\seo\find_single_image_groupids.py --csv out.csv`.
- Shopify token can't read the Files library (`read_files` missing) — not needed for this plan.
