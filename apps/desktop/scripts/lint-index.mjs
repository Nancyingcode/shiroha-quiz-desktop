import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const git = (/** @type {string[]} */ args) => execFileSync('git', ['--no-optional-locks', ...args], {
  cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
});
const changed = git(['diff', '--cached', '--no-ext-diff', '--no-renames', '--name-only', '-z']).split('\0').filter(Boolean);
const staged = git(['diff', '--cached', '--no-ext-diff', '--no-renames', '--name-only', '--diff-filter=AMT', '-z'])
  .split('\0').filter((file) => /\.(?:js|mjs|cjs)$/i.test(file));
const configPaths = [
  '.husky/pre-commit', 'apps/desktop/eslint.platform.config.mjs',
  'apps/desktop/eslint.rules.mjs', 'apps/desktop/eslint.migration.mjs', 'apps/desktop/package.json',
  'apps/desktop/scripts/lint-index.mjs',
];
if (staged.length || changed.some((file) => configPaths.includes(file))) {
  // 暂存内容必须使用相同的配置验证，否则工作区的临时配置可能掩盖提交中的问题。
  const changedConfig = [
    ...git(['diff', '--no-ext-diff', '--name-only', '-z', '--', ...configPaths]).split('\0').filter(Boolean),
    ...git(['ls-files', '--others', '-z', '--', ...configPaths]).split('\0').filter(Boolean),
  ];
  if (changedConfig.length) {
    throw new Error(`ESLint 配置或暂存检查脚本与索引不一致，请先处理未暂存修改：${changedConfig.join(', ')}`);
  }
}
const lint = new ESLint({
  cwd: root,
  overrideConfigFile: fileURLToPath(new URL('../eslint.platform.config.mjs', import.meta.url)),
});
const files = [];
for (const file of staged) {
  if (!await lint.isPathIgnored(path.join(root, file))) { files.push(file); }
}
if (files.length) {
  const modes = new Map();
  for (const entry of git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
    const separator = entry.indexOf('\t');
    const [mode, , stage] = entry.slice(0, separator).split(' ');
    if (stage === '0') { modes.set(entry.slice(separator + 1), mode); }
  }
  const results = [];
  for (const file of files) {
    const mode = modes.get(file);
    if (mode !== '100644' && mode !== '100755') {
      throw new Error(`无法检查暂存的非普通 JavaScript 文件：${file}`);
    }
    const source = git(['show', `:0:${file}`]);
    const [result] = await lint.lintText(source, { filePath: path.join(root, file) });
    results.push(result);
  }
  const output = await (await lint.loadFormatter('stylish')).format(results);
  if (output) { console.log(`暂存的 JavaScript 检查结果：\n${output}`); }
  console.log(`Checked ${results.length} staged JavaScript files.`);
  if (results.some((result) => result.errorCount || result.warningCount)) { process.exitCode = 1; }
} else {
  console.log('No staged handwritten JavaScript files to check.');
}
