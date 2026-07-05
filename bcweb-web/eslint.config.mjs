// =====================================================================================================================================
// ESLint flat config for the Next.js web app (ESLint 9). `next lint` is deprecated (removed in Next 16), so we run the ESLint CLI
// directly (`npm run lint`). eslint-config-next ships in the legacy "extends" format, so we bridge it into flat config with FlatCompat.
//   - next/core-web-vitals: React + Next rules incl. accessibility & the image/script best-practices (e.g. no-img-element).
//   - next/typescript: TypeScript-aware rules.
// =====================================================================================================================================

import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  // Don't lint build output or dependencies.
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default eslintConfig;
