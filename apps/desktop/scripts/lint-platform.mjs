import { globSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const webPilots = ['apps/web/ai-import-panel.js', 'apps/web/study-sessions.js'];
for (const file of ['apps', 'apps/web', ...webPilots]) {
  const target = path.join(root, file);
  const info = await lstat(target);
  if (info.isSymbolicLink()) { throw new Error(`无法检查链接：${target}`); }
  if (webPilots.includes(file) && !info.isFile()) { throw new Error(`无法检查非普通 JavaScript 文件：${target}`); }
}
const lint = new ESLint({
  cwd: root,
  overrideConfigFile: fileURLToPath(new URL('../eslint.platform.config.mjs', import.meta.url)),
});
const files = ['apps/web/platform/**/*.js', 'apps/web/training.js', ...webPilots, 'test/dual-platform/**/*.cjs'];
// 桌面桥接将在 B/C 阶段落地，仅纳入实际脚本，避免纯样式目录触发空 glob 错误。
files.push(...globSync('apps/desktop/frontend/**/*.js', { cwd: root }));
const results = await lint.lintFiles(files);
const formatter = await lint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output) {
  console.log(output);
}
if (results.some((result) => result.errorCount || result.warningCount)) {
  process.exitCode = 1;
}
