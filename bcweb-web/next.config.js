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
  },
};

module.exports = nextConfig;
