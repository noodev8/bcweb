import type { MetadataRoute } from 'next'

// Makes BCWEB installable as its own app (Chrome ⋮ → Cast, save and share → Install).
// Opens in its own window with the "bc." icon, straight onto the dashboard.
// No service worker on purpose: every screen is live data, nothing should be cached offline.
// Icons are made from src/app/icon.png (public/app-icons; maskable = logo on a navy square).
// A new icon needs NEW file names (-v2, -v3…): Chrome keeps the old image under the old name, even through a reinstall.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Brookfield Comfort',
    short_name: 'BCWEB',
    description: 'Brookfield Comfort internal platform',
    id: '/dashboard',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#01374f',
    icons: [
      { src: '/app-icons/icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icons/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icons/maskable-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/app-icons/maskable-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
