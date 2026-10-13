/*
=======================================================================================================================================
Module: utils/productImage.js
=======================================================================================================================================
Purpose: The ONE place a product image is processed and described, for every writer — main or gallery, upload or import — so size,
         format and naming can't drift between them. Plan + decisions: docs/product-images-plan.md (owner, 2026-10-13).

         processImage(buffer)  -> { buffer, width, height }  JPEG, square, white padded, longest side capped at 2048 and NEVER enlarged:
                                  an 800 source stays 800 (enlarging adds no detail, only a bigger file that still looks soft when
                                  zoomed). Shopify recommends 2048 for zoom; it copies the file to its own CDN and serves each device a
                                  resized copy, and BCWEB screens go through next/image — so 2048 costs storage, not page speed.
         viewFromName(name)    -> a whitelisted view word ('sole') found in a SOURCE filename, or null. Birkenstock's asset names carry
                                  useful words (1015090_sole, 71051_campaign-2); everything else (Screenshot_2025-…, uuids) is garbage
                                  we must not bake into an SEO filename, hence a whitelist rather than "keep the original name".
         imageAlt(title, view) -> "<title> – sole view" / "<title>".
         isDone(count)         -> the Missing Images "done" rule: >= 2 images (owner, 2026-10-13: "we are just looking at where there
                                  are only single images to start"). Main size is NOT part of it — existing 800 mains stay live and
                                  are replaced only when someone sources a new picture anyway; isLowResMain() is an optional flag.
=======================================================================================================================================
*/

const sharp = require('sharp');

const MAX_SIDE = 2048;
const JPEG_QUALITY = 80;
const WHITE = { r: 255, g: 255, b: 255 };

// "Done" = MIN_IMAGES or more. Raise it (4 was discussed) once the single-image products are cleared.
const MIN_IMAGES = 2;
// Optional flag only, never part of "done". 1500 not 2048: supplier images are rarely exactly 2048, and 1600–2000 is visually as good.
const MIN_MAIN_SIDE = 1500;

// Order doesn't matter — the FIRST word of the source name that is on the list wins.
const VIEW_WORDS = new Set(['side', 'sole', 'top', 'front', 'back', 'heel', 'inside', 'detail', 'pair', 'look', 'worn', 'campaign']);

// Process any decodable image into our stored form. Throws on an undecodable file (callers map that to INVALID_IMAGE / skip).
async function processImage(input) {
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  // EXIF rotation swaps width/height but not the longest side, so this is correct before .rotate() is applied.
  const longest = Math.max(meta.width || 0, meta.height || 0);
  if (!longest) throw new Error('Image has no dimensions');
  const side = Math.min(MAX_SIDE, longest);

  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()                                                   // honour EXIF orientation before resizing
    .resize(side, side, { fit: 'contain', background: WHITE })  // square at min(2048, longest): pads, never enlarges
    .flatten({ background: WHITE })                             // drop alpha (JPEG) -> white
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, width: info.width, height: info.height };
}

// Dimensions of an image as it is (no processing) — used to measure files we already hold.
async function measureImage(input) {
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  return { width: meta.width || null, height: meta.height || null };
}

// The view word in a source filename, or null. Our OWN filenames carry the product title ("…-side-zip-boots-…-brookfield-comfort.jpg"),
// so a title word would be misread as a view — those are skipped outright.
function viewFromName(name) {
  const base = String(name || '').split('?')[0].split('/').pop().toLowerCase();
  if (!base || base.includes('brookfield-comfort')) return null;
  const words = base.replace(/\.[a-z0-9]+$/, '').split(/[^a-z]+/);
  return words.find((w) => VIEW_WORDS.has(w)) || null;
}

function imageAlt(title, view) {
  const t = String(title || '').trim();
  return view ? `${t} – ${view} view`.trim() : t;
}

function isDone(count) {
  return Number(count || 0) >= MIN_IMAGES;
}

function isLowResMain(mainSide) {
  return Number(mainSide || 0) < MIN_MAIN_SIDE;
}

module.exports = { processImage, measureImage, viewFromName, imageAlt, isDone, isLowResMain, MAX_SIDE, MIN_MAIN_SIDE, MIN_IMAGES, VIEW_WORDS };
