import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', TextDecoder: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', window: 'readonly', document: 'readonly', localStorage: 'readonly', location: 'readonly', Blob: 'readonly', Worker: 'readonly' },
    },
    rules: { 'no-var': 'error', 'prefer-const': 'error', 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  { ignores: ['dist/**', 'src-tauri/**', '.reports/**'] },
];
