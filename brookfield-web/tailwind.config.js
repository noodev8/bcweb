/** @type {import('tailwindcss').Config} */
// Tailwind CSS 3 (CLAUDE.md). Scans the App Router tree + shared components for class names.
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
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
