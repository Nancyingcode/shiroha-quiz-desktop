import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';
import { baseRules, semanticRules, styleRules } from '../eslint.rules.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(desktop, '../..');
const auditedRules = new Set(['no-plusplus', 'prefer-template']);

function linter() {
  return new ESLint({
    cwd: root,
    overrideConfigFile: path.join(desktop, 'eslint.platform.config.mjs'),
  });
}

function suppressionLinter() {
  /** @type {import('eslint').Linter.RulesRecord} */
  const unrelatedRules = Object.fromEntries(
    Object.keys({ ...baseRules, ...semanticRules, ...styleRules })
      .filter((rule) => !auditedRules.has(rule)).map((rule) => [rule, 'off']),
  );
  return new ESLint({
    cwd: root,
    overrideConfigFile: path.join(desktop, 'eslint.platform.config.mjs'),
    overrideConfig: { rules: unrelatedRules },
  });
}

test('focused suppression analysis matches full-rule results', async () => {
  const source = [
    'let index = 0;',
    '// eslint-disable-next-line no-plusplus -- 类型兼容；移除条件：调用方只传数字',
    'index++;',
    'const value = 1;',
    '// eslint-disable-next-line prefer-template -- 类型兼容；移除条件：值不再可替换',
    "console.log('value: ' + value, index);",
    '',
  ].join('\n');
  const full = linter();
  const focused = suppressionLinter();
  for (const file of ['apps/web/app.js', 'apps/desktop/scripts/prepare-web.mjs', 'test/dual-platform/ai-harness.test.cjs']) {
    const filePath = path.join(root, file);
    const [fullResult] = await full.lintText(source, { filePath });
    const [focusedResult] = await focused.lintText(source, { filePath });
    const relevant = (/** @type {import('eslint').Linter.LintMessage[]} */ messages) => messages.filter(
      (message) => message.ruleId && auditedRules.has(message.ruleId),
    );
    const expected = relevant(fullResult.suppressedMessages);
    assert.equal(expected.length, 2, file);
    assert.deepEqual(relevant(focusedResult.suppressedMessages), expected, file);
    const fullConfig = await full.calculateConfigForFile(filePath);
    const focusedConfig = await focused.calculateConfigForFile(filePath);
    for (const rule of auditedRules) {
      assert.deepEqual(focusedConfig?.rules?.[rule], fullConfig?.rules?.[rule], `${file}: ${rule}`);
    }
  }
});

test('coercion exceptions stay local, explained and cannot increase', async () => {
  /** @type {Record<string, Record<string, number>>} */
  const limits = {
    'apps/desktop/frontend/adapter.js': { 'prefer-template': 2 },
    'apps/desktop/frontend/harness.js': { 'prefer-template': 1 },
    'apps/web/ai-question-sessions.js': { 'no-plusplus': 6 },
    'apps/web/ai-results.js': { 'prefer-template': 1 },
    'apps/web/app.js': { 'prefer-template': 18 },
    'apps/web/backup-data.js': { 'prefer-template': 1 },
    'apps/web/bank-page.js': { 'prefer-template': 2 },
    'apps/web/exam-page.js': { 'no-plusplus': 1 },
    'apps/web/import-preview.js': { 'prefer-template': 3 },
    'apps/web/ocr-import.js': { 'prefer-template': 2 },
    'apps/web/platform/browser-network.js': { 'prefer-template': 2 },
    'apps/web/practice-page.js': { 'prefer-template': 2, 'no-plusplus': 8 },
    'apps/web/saved-questions-page.js': { 'prefer-template': 2 },
    'apps/web/study-sessions.js': { 'no-plusplus': 2 },
    'apps/web/text-parser.js': { 'prefer-template': 4, 'no-plusplus': 1 },
    'apps/web/training-review-page.js': { 'prefer-template': 3 },
    'apps/web/webdav-panel.js': { 'prefer-template': 1 },
  };
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(listed.status, 0, listed.stderr);
  // 这里只统计两条规则的例外，完整规则仍由独立的全文件 lint 检查。
  const lint = suppressionLinter();
  const files = [];
  for (const file of listed.stdout.split('\0').filter((name) => /\.(?:js|mjs|cjs)$/i.test(name))) {
    if (!await lint.isPathIgnored(path.join(root, file))) { files.push(file); }
  }
  for (const result of await lint.lintFiles(files)) {
    const file = path.relative(root, result.filePath).replaceAll('\\', '/');
    for (const rule of ['prefer-template', 'no-plusplus']) {
      const suppressed = result.suppressedMessages.filter((message) => message.ruleId === rule);
      const limit = limits[file]?.[rule] ?? 0;
      assert(suppressed.length <= limit, `${file}: ${rule} 例外 ${suppressed.length} 超过 ${limit}`);
      for (const message of suppressed) {
        assert(message.suppressions.every(({ kind, justification }) => kind === 'directive'
          && justification.includes('类型') && justification.includes('移除')), `${file}:${message.line} 缺少原因或移除条件`);
      }
    }
  }
});
