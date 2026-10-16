/** @type {import('tailwindcss').Config} */
// Tailwind CSS 3 (CLAUDE.md). Scans the App Router tree, shared components AND src/lib for class names.
// src/lib MUST stay in: helpers there return class strings (segmentUi.ts → dueTone). Without it a class used ONLY there is purged —
// that is how the Segments green "ok" cells went white (2026-09-25): once no screen happened to use bg-green-100 too, it vanished.
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // A single brand accent so future modules inherit a consistent look. Slate-ish neutral platform chrome.
        brand: {
          50: '#eef2ff', 100: '#e0e7ff', 500: '#4f46e5', 600: '#4338ca', 700: '#3730a3',
        },
      },
      // AMZ Shipment's good-scan feedback (owner, 2026-10-16): the scanned line flashes green and its qty pops, so a packer looking at
      // the shoe sees it land out of the corner of an eye. Replayed per scan by re-keying the row.
      keyframes: {
        'scan-flash': { '0%': { backgroundColor: '#a7f3d0' }, '100%': { backgroundColor: 'transparent' } },
        'qty-bump': { '0%': { transform: 'scale(1.6)', color: '#047857' }, '100%': { transform: 'scale(1)' } },
      },
      animation: {
        'scan-flash': 'scan-flash 1.2s ease-out',
        'qty-bump': 'qty-bump 0.4s ease-out',
      },
    },
  },
  plugins: [],
};
