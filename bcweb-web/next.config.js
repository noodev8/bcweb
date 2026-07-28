/** @type {import('next').NextConfig} */
// Minimal Next.js config. The API base URL is provided via NEXT_PUBLIC_API_URL (.env) and read in src/lib/api.ts — the web app
// never talks to Postgres directly (CLAUDE.md), only to the Express API over HTTP.
const nextConfig = {
  reactStrictMode: true,
  // next/image refuses to optimise images from hosts it doesn't know, so whitelist our product-image server. Filenames come from
  // skusummary.imagename and are served at https://images.brookfieldcomfort.com/<imagename>.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.brookfieldcomfort.com' },
    ],
    // How long an optimised thumbnail is kept, and the max-age handed to the browser with it. Next takes the GREATER of this and the
    // origin's own Cache-Control — and images.brookfieldcomfort.com sends none, so without this line the default 4 hours applies and
    // every product picture is re-fetched and re-optimised (a billed transformation) several times a day. The /inventory browse paints
    // a whole catalogue of them, so that cold-cache churn is also what makes image loads fail in bursts.
    //
    // A YEAR, because PRODUCT IMAGE FILENAMES ARE IMMUTABLE: every upload mints a fresh version token and a new filename
    // (bcweb-server/routes/product-image.js), then deletes the old file. A given URL's bytes never change, so "the picture changed"
    // and "the same URL" cannot both be true — a replaced image is a NEW url and appears immediately. There is no stale-picture risk
    // to trade against the TTL, which is why this is the conventional immutable-asset value rather than a cautious few days.
    minimumCacheTTL: 31536000,
  },
};

module.exports = nextConfig;
