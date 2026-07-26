// =====================================================================================================================================
// ESLint flat config for the Next.js web app (ESLint 9 — see the pin note below). `next lint` no longer exists (removed in Next 16), so we
// run the ESLint CLI directly (`npm run lint`). As of eslint-config-next@16 the shared configs ship as NATIVE FLAT CONFIG ARRAYS
// (`export = Linter.Config[]`), so we import and spread them directly — the FlatCompat / @eslint/eslintrc bridge this file needed on
// Next 15 is gone. Each is a DEFAULT import because the dist is CJS using `export =`, which Node's ESM interop hands back as the array
// itself rather than a { default } wrapper — so spreading it is safe.
//
// WHY ESLINT IS PINNED TO 9 HERE (bcweb-server is on 10 — this mismatch is deliberate, do not "fix" it):
//   eslint-config-next@16 advertises peer eslint ">=9.0.0", but that is optimistic — it depends on eslint-plugin-react, whose LATEST
//   release (7.37.5) peers eslint "<=^9.7" and still calls the context.getFilename() API that ESLint 10 REMOVED. Installing eslint 10
//   makes `npm run lint` die outright with "TypeError: contextOrFilename.getFilename is not a function" while loading
//   rule 'react/display-name'. There is no newer eslint-plugin-react to override to. Re-test when one ships with eslint 10 support.
//   - next/core-web-vitals: React + Next rules incl. accessibility & the image/script best-practices (e.g. no-img-element).
//   - next/typescript: TypeScript-aware rules.
// =====================================================================================================================================

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const eslintConfig = [
  // Don't lint build output or dependencies.
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },

  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default eslintConfig;
