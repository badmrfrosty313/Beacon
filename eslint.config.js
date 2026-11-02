import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// OFFLINE: BEACON must never make network requests. These APIs are banned in application
// code so a regression is caught at lint time, not in production. (Tests may reference them
// by name to prove they are never called.)
const NETWORK_MESSAGE = 'BEACON is offline-first: network access is not allowed (see SECURITY.md).';
const bannedGlobals = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
  name,
  message: NETWORK_MESSAGE,
}));

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'src-tauri/target', 'src-tauri/gen'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2021,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-globals': ['error', ...bannedGlobals],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: NETWORK_MESSAGE },
        { object: 'window', property: 'fetch', message: NETWORK_MESSAGE },
        { object: 'globalThis', property: 'fetch', message: NETWORK_MESSAGE },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node-side config files.
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
