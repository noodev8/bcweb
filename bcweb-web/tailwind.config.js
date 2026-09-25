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
    },
  },
  plugins: [],
};
