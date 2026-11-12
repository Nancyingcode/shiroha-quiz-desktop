import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import importX from 'eslint-plugin-import-x';
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
  'no-new-object': 'error',
  'object-shorthand': ['error', 'always'],
  'no-array-constructor': 'error',
  'array-callback-return': ['error', { checkForEach: false }],
  'prefer-rest-params': 'error',
  'prefer-spread': 'error',
  'prefer-arrow-callback': 'error',
  'no-useless-constructor': 'error',
  'dot-notation': 'error',
  'prefer-exponentiation-operator': 'error',
  'no-unneeded-ternary': 'error',
  'no-else-return': 'error',
  'no-new-wrappers': 'error',
  radix: 'error',
  'no-restricted-globals': ['error', 'isNaN', 'isFinite'],
  'prefer-object-spread': 'error',
  'default-param-last': 'error',
  'no-multi-assign': 'error',
  'one-var': ['error', 'never'],
  'arrow-body-style': ['error', 'as-needed'],
  'new-cap': 'error',
  camelcase: ['error', { properties: 'never' }],
  'class-methods-use-this': 'error',
  'prefer-destructuring': ['error', {
    VariableDeclarator: { array: false, object: true },
    AssignmentExpression: { array: false, object: false },
  }, { enforceForRenamedProperties: false }],
  'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
  'no-loop-func': 'error',
  'no-plusplus': 'error',
  'prefer-template': 'error',
  'no-unused-expressions': 'error',
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
  // 多行对象/解构必须逐项换行，禁止“首尾同行 + 续行缩进不齐”的排版。
  '@stylistic/object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
  '@stylistic/object-curly-newline': ['error', {
    ObjectExpression: { multiline: true, consistent: true },
    ObjectPattern: { multiline: true, consistent: true },
  }],
  '@stylistic/array-bracket-spacing': ['error', 'never'],
  '@stylistic/space-in-parens': ['error', 'never'],
  '@stylistic/eol-last': ['error', 'always'],
  '@stylistic/array-bracket-newline': ['error', 'consistent'],
  '@stylistic/template-curly-spacing': ['error', 'never'],
  '@stylistic/wrap-iife': ['error', 'any'],
  '@stylistic/implicit-arrow-linebreak': ['error', 'beside'],
  '@stylistic/generator-star-spacing': ['error', { before: false, after: true }],
  '@stylistic/spaced-comment': ['error', 'always'],
  '@stylistic/computed-property-spacing': ['error', 'never'],
  '@stylistic/function-call-spacing': ['error', 'never'],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/comma-style': ['error', 'last'],
  '@stylistic/arrow-spacing': 'error',
  '@stylistic/block-spacing': ['error', 'always'],
  '@stylistic/space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
  '@stylistic/function-paren-newline': ['error', 'multiline-arguments'],
  '@stylistic/operator-linebreak': ['error', 'before', { overrides: { '=': 'none' } }],
  '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
  '@stylistic/padded-blocks': ['error', 'never'],
  '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0, maxBOF: 0 }],
  '@stylistic/nonblock-statement-body-position': ['error', 'beside'],
  '@stylistic/quote-props': ['error', 'as-needed'],
  '@stylistic/no-confusing-arrow': ['error', { allowParens: true }],
  '@stylistic/no-mixed-operators': 'error',
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
  'apps/desktop/src-tauri/target/**', 'apps/desktop/src-tauri/gen/**',
  'apps/web/libs/**', 'apps/web/question-bank.js',
  'test/fixtures/**',
];

// 浏览器回调由 Playwright 序列化后执行；仅这些既有宿主文件允许回调内使用浏览器名称。
const browserCallbackFiles = [
  'benchmark', 'codebuddy-cli-smoke', 'codebuddy-login-smoke', 'dev-smoke',
  'document-smoke', 'harness-smoke', 'network-smoke', 'smoke',
].map((name) => `apps/desktop/scripts/${name}.mjs`);

// Playwright 回调在页面中执行；状态名称只供注入应用 IIFE 的测试桥接使用。
const webTestCallbackGlobals = {
  'test/web-ai-practice/cases.cjs': ['localStorage', 'document', 'Storage', 'window', 'DOMException'],
  'test/web-ai-practice/dialogs.cjs': ['document', 'MutationObserver'],
  'test/web-ai-practice/harness.cjs': ['sessionStorage', 'localStorage', 'window', 'document', 'state', 'practiceSession'],
  'test/web-ai-practice/saved-analysis.cjs': ['localStorage'],
  'test/web-ai-practice/submit-modes.cjs': ['Storage', 'window', 'DOMException'],
  'test/web-ai-practice/wrong-analysis.cjs': ['localStorage', 'window', 'Storage', 'DOMException'],
};

/** @param {{desktop?: boolean, debt?: boolean, semanticOnly?: boolean}} [options]
 * @returns {import('eslint').Linter.Config[]} */
export function createConfig({ desktop = false, debt = false, semanticOnly = false } = {}) {
  const relative = (/** @type {string} */ file) => (desktop ? file.replace(/^apps\/desktop\//, '') : file);
  const extensionPattern = (/** @type {string} */ file) => relative(file).replace(
    /\.(mjs|cjs|js)$/i,
    (suffix) => `.${[...suffix.slice(1)].map((letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`).join('')}`,
  );
  /** @type {import('eslint').Linter.Config[]} */
  const config = [
    { ignores: excludedFiles.map(relative) },
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'].map(extensionPattern),
      plugins: { '@stylistic': stylistic },
      languageOptions: { ecmaVersion: 'latest' },
      rules: semanticOnly ? semanticRules : { ...baseRules, ...semanticRules, ...styleRules },
    },
    {
      files: ['**/*.mjs'].map(extensionPattern),
      languageOptions: { sourceType: 'module', globals: nodeGlobals },
    },
    {
      files: ['**/*.cjs'].map(extensionPattern),
      languageOptions: {
        sourceType: 'commonjs',
        globals: { ...nodeGlobals, __dirname: 'readonly', __filename: 'readonly' },
      },
    },
    {
      files: ['**/*.js'].map(extensionPattern),
      ignores: ['apps/web/**', 'apps/desktop/**'].map(relative),
      languageOptions: {
        sourceType: 'commonjs',
        globals: { ...nodeGlobals, __dirname: 'readonly', __filename: 'readonly' },
      },
    },
    {
      files: [extensionPattern('apps/desktop/**/*.js')],
      ignores: [relative('apps/desktop/frontend/**')],
      languageOptions: { sourceType: 'module', globals: nodeGlobals },
    },
    {
      files: ['apps/web/**/*.js', 'apps/desktop/frontend/**/*.js'].map(extensionPattern),
      languageOptions: { sourceType: 'script', globals: browserGlobals },
    },
    {
      files: [relative('apps/web/app.js')],
      // 共享脚本先于入口加载；旧导出扩展可能不存在，入口以 typeof 检查后才调用。
      languageOptions: {
        globals: {
          ShirohaPlatform: 'readonly',
          ShirohaTraining: 'readonly',
          ShirohaDialogs: 'readonly',
          requestAnimationFrame: 'readonly',
          renderExportBankSelectorV23: 'readonly',
        },
      },
    },
    {
      // 每行只允许一条语句：先在已零命中的拆分模块试点，其余模块随业务修改逐个纳入。
      files: ['apps/web/quiz-core.js', 'apps/web/training.js', 'apps/web/practice-selection.js'].map(relative),
      rules: { '@stylistic/max-statements-per-line': ['error', { max: 1 }] },
    },
    {
      // 复杂度棘轮只覆盖基线为零的模块；已有超标的模块随业务拆分逐个纳入，避免一次性改造历史函数。
      files: [
        'apps/web/quiz-core.js', 'apps/web/platform/index.js', 'apps/web/platform/save-queue.js',
      ].map(relative),
      rules: {
        complexity: ['error', 15],
        'max-depth': ['error', 4],
        'max-params': ['error', 5],
        'max-nested-callbacks': ['error', 4],
        // 函数与文件规模同样按棘轮处理：这三个模块当前均无命中，阈值只在新增代码上生效。
        'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
        'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
      },
    },
    {
      // 模块图检查只覆盖真实使用 import/require 的文件；浏览器 classic script 没有模块边界，重复导入另行由核心规则覆盖。
      files: [
        'apps/desktop/**/*.mjs', 'test/dual-platform/**/*.cjs',
        'apps/web/platform/**/*.js', 'apps/desktop/frontend/bridge.js',
      ].map(relative),
      plugins: { 'import-x': importX },
      rules: {
        'import-x/no-unresolved': 'error',
        'import-x/no-cycle': ['error', { maxDepth: 10 }],
        'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
      },
    },
    {
      files: [relative('apps/desktop/frontend/bridge.js')],
      languageOptions: { sourceType: 'module' },
    },
    {
      files: browserCallbackFiles.map(relative),
      languageOptions: {
        globals: {
          window: 'readonly',
          document: 'readonly',
          localStorage: 'readonly',
          location: 'readonly',
          Worker: 'readonly',
        },
      },
    },
  ];
  for (const [file, names] of Object.entries(webTestCallbackGlobals)) {
    config.push({
      files: [relative(file)],
      languageOptions: { globals: Object.fromEntries(names.map((name) => [name, 'readonly'])) },
    });
  }
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
