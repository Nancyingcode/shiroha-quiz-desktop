import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const lint = new ESLint({
  cwd: root,
  overrideConfigFile: fileURLToPath(new URL('../eslint.platform.config.mjs', import.meta.url)),
});
const files = ['apps/web/platform/**/*.js', 'apps/web/training.js', 'test/dual-platform/**/*.cjs'];
// 桌面桥接将在 B/C 阶段落地，仅纳入实际脚本，避免纯样式目录触发空 glob 错误。
files.push(...globSync('apps/desktop/frontend/**/*.js', { cwd: root }));
const results = await lint.lintFiles(files);
const formatter = await lint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output) console.log(output);
if (results.some(result => result.errorCount || result.warningCount)) process.exitCode = 1;
