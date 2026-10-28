import js from '@eslint/js';

const rules = {
  ...js.configs.recommended.rules,
  'no-var': 'error',
  'prefer-const': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
};

export default [
  {
    files: ['apps/web/platform/**/*.js', 'apps/web/training.js', 'apps/desktop/frontend/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', console: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', location: 'readonly',
        URL: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly',
        HTMLInputElement: 'readonly', DataTransfer: 'readonly', Event: 'readonly',
        AbortController: 'readonly', AbortSignal: 'readonly', fetch: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly', structuredClone: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
      },
    },
    rules,
  },
  {
    files: ['test/dual-platform/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'commonjs',
      globals: {
        process: 'readonly', console: 'readonly', Buffer: 'readonly', __dirname: 'readonly',
        URL: 'readonly', Blob: 'readonly', Response: 'readonly', DecompressionStream: 'readonly',
        atob: 'readonly', btoa: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
        structuredClone: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
      },
    },
    rules,
  },
];
