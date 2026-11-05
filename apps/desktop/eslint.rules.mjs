import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { styleDebt, semanticDebt } from './eslint.migration.mjs';

/** @type {import('eslint').Linter.RulesRecord} */
export const baseRules = {
  ...js.configs.recommended.rules,
  'no-var': 'error',
  'prefer-const': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
};

/** @type {import('eslint').Linter.RulesRecord} */
export const semanticRules = {
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-nested-ternary': 'error',
  'no-param-reassign': ['error', { props: false }],
  'no-duplicate-imports': 'error',
  'no-eval': 'error',
  'no-new-func': 'error',
  'guard-for-in': 'error',
  curly: ['error', 'all'],
};

/** @type {import('eslint').Linter.RulesRecord} */
export const styleRules = {
  '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
  '@stylistic/semi': ['error', 'always'],
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
  '@stylistic/arrow-parens': ['error', 'always'],
  '@stylistic/space-infix-ops': 'error',
  '@stylistic/space-before-blocks': 'error',
  '@stylistic/keyword-spacing': 'error',
  '@stylistic/comma-spacing': 'error',
  '@stylistic/key-spacing': 'error',
  '@stylistic/object-curly-spacing': ['error', 'always'],
  '@stylistic/array-bracket-spacing': ['error', 'never'],
  '@stylistic/space-in-parens': ['error', 'never'],
  '@stylistic/eol-last': ['error', 'always'],
};

/** @type {import('eslint').Linter.Globals} */
const nodeGlobals = Object.fromEntries([
  'process', 'console', 'Buffer', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'fetch', 'AbortController', 'AbortSignal', 'Request', 'Response', 'Headers', 'Blob', 'File',
  'FormData', 'DecompressionStream', 'CompressionStream', 'atob', 'btoa', 'structuredClone',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
].map((name) => [name, 'readonly']));

/** @type {import('eslint').Linter.Globals} */
const browserGlobals = Object.fromEntries([
  'window', 'document', 'navigator', 'console', 'localStorage', 'sessionStorage', 'location',
  'URL', 'Blob', 'File', 'FileReader', 'HTMLInputElement', 'DataTransfer', 'Event',
  'AbortController', 'AbortSignal', 'fetch', 'TextEncoder', 'TextDecoder', 'structuredClone',
  'setTimeout', 'clearTimeout',
].map((name) => [name, 'readonly']));

export const excludedFiles = [
  '**/node_modules/**', '**/dist/**', '**/.reports/**', '**/.git/**',
  'apps/desktop/src-tauri/**', 'apps/web/libs/**', 'apps/web/question-bank.js',
  'test/fixtures/**',
];

// 浏览器回调由 Playwright 序列化后执行；仅这些既有宿主文件允许回调内使用浏览器名称。
const browserCallbackFiles = [
  'benchmark', 'codebuddy-cli-smoke', 'codebuddy-login-smoke', 'dev-smoke',
  'document-smoke', 'harness-smoke', 'network-smoke', 'smoke',
].map((name) => `apps/desktop/scripts/${name}.mjs`);

/** @param {{desktop?: boolean, debt?: boolean, semanticOnly?: boolean}} [options] */
export function createConfig({ desktop = false, debt = false, semanticOnly = false } = {}) {
  const relative = (/** @type {string} */ file) => desktop ? file.replace(/^apps\/desktop\//, '') : file;
  /** @type {import('eslint').Linter.Config[]} */
  const config = [
    { ignores: excludedFiles.map(relative) },
    {
      files: ['**/*.{js,mjs,cjs}'],
      plugins: { '@stylistic': stylistic },
      languageOptions: { ecmaVersion: 'latest' },
      rules: semanticOnly ? semanticRules : { ...baseRules, ...semanticRules, ...styleRules },
    },
    {
      files: ['**/*.mjs'],
      languageOptions: { sourceType: 'module', globals: nodeGlobals },
    },
    {
      files: ['**/*.cjs'],
      languageOptions: {
        sourceType: 'commonjs',
        globals: { ...nodeGlobals, __dirname: 'readonly', __filename: 'readonly' },
      },
    },
    {
      files: ['**/*.js'],
      ignores: ['apps/web/**', 'apps/desktop/**'].map(relative),
      languageOptions: {
        sourceType: 'commonjs',
        globals: { ...nodeGlobals, __dirname: 'readonly', __filename: 'readonly' },
      },
    },
    {
      files: [relative('apps/desktop/**/*.js')],
      ignores: [relative('apps/desktop/frontend/**')],
      languageOptions: { sourceType: 'module', globals: nodeGlobals },
    },
    {
      files: ['apps/web/**/*.js', 'apps/desktop/frontend/**/*.js'].map(relative),
      languageOptions: { sourceType: 'script', globals: browserGlobals },
    },
    {
      files: [relative('apps/desktop/frontend/bridge.js')],
      languageOptions: { sourceType: 'module' },
    },
    {
      files: browserCallbackFiles.map(relative),
      languageOptions: {
        globals: {
          window: 'readonly', document: 'readonly', localStorage: 'readonly',
          location: 'readonly', Worker: 'readonly',
        },
      },
    },
  ];
  if (!debt && !semanticOnly) {
    for (const [file, rules] of [...Object.entries(styleDebt), ...Object.entries(semanticDebt)]) {
      config.push({
        files: [relative(file)],
        rules: Object.fromEntries(rules.map((rule) => [rule, 'off'])),
      });
    }
  }
  return config;
}
