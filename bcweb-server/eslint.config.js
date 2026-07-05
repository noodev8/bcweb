// =====================================================================================================================================
// ESLint flat config for the Express API (ESLint 9). Plain Node.js / CommonJS — no React/TypeScript. We start from @eslint/js's
// recommended rules and layer on Node globals (so `require`, `module`, `process`, `__dirname`, etc. aren't flagged as undefined).
// Run with `npm run lint`. This config file itself is CommonJS (the package has no "type":"module").
// =====================================================================================================================================

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Don't lint dependencies or runtime logs.
  { ignores: ['node_modules/**', 'logs/**'] },

  // Base recommended rule set.
  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Unused vars are a warning, not an error; allow intentionally-unused args/vars prefixed with _ (e.g. Express `next`, `_req`).
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
