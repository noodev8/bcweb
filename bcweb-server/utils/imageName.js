/*
=======================================================================================================================================
Module: utils/imageName.js
=======================================================================================================================================
Purpose: Build the SEO-friendly product image filename, from the product title + groupid. A cleaned-up port of the legacy PowerBuilder
         routine, which formed "<title>-<groupid>-brookfield-comfort.jpg" and replaced spaces with hyphens. We go further (it's only for
         SEO/URLs, per the owner): lower-case, turn '&' into 'and', replace every run of non-[a-z0-9] with a single hyphen, trim stray
         hyphens, and always end in '.jpg' (the image is always re-encoded to JPEG).

         An optional `version` token is appended at the very end (before .jpg). Every upload passes a fresh one so the filename — and
         therefore the public URL — is unique per upload. That sidesteps the one.com CDN cache (an overwritten same-name file would be
         served stale until its TTL); with a new URL each time, the new image shows immediately and the old file is deleted.

         Examples:
           ("Birkenstock Gizeh EVA Sandals White", "0128221-GIZEH", "lm3k9x")
             -> "birkenstock-gizeh-eva-sandals-white-0128221-gizeh-brookfield-comfort-lm3k9x.jpg"
           ("Rieker Women's Boots & Shoes", "R-100")  // no version
             -> "rieker-women-s-boots-and-shoes-r-100-brookfield-comfort.jpg"
=======================================================================================================================================
*/

const SUFFIX = 'brookfield-comfort';

// Slugify to lower-case, hyphen-separated, [a-z0-9-] only.
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')          // keep the word, not the symbol
    .replace(/[^a-z0-9]+/g, '-')     // any run of non-alphanumeric -> single hyphen
    .replace(/^-+|-+$/g, '')         // trim leading/trailing hyphens
    .replace(/-+/g, '-');            // collapse repeats
}

/**
 * imageFilename(title, groupid, version?) -> "<slug(title)>-<slug(groupid)>-brookfield-comfort[-<version>].jpg".
 * If the title is blank we still produce a valid name from the groupid alone. `version` (optional) is appended for cache-busting
 * uniqueness. Always lower-case, always .jpg.
 */
function imageFilename(title, groupid, version) {
  const parts = [slugify(title), slugify(groupid), SUFFIX];
  if (version) parts.push(slugify(version));
  return `${parts.filter(Boolean).join('-')}.jpg`;
}

module.exports = { imageFilename, slugify };
