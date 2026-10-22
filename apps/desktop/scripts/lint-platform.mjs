import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const lint = new ESLint({
  cwd: root,
  overrideConfigFile: fileURLToPath(new URL('../eslint.platform.config.mjs', import.meta.url)),
});
const files = ['apps/web/platform/**/*.js', 'test/dual-platform/**/*.cjs'];
// 桌面桥接将在 B/C 阶段落地，目录出现后自动纳入同一浏览器边界检查。
if (existsSync(path.join(root, 'apps/desktop/frontend'))) files.push('apps/desktop/frontend/**/*.js');
const results = await lint.lintFiles(files);
const formatter = await lint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output) console.log(output);
if (results.some(result => result.errorCount || result.warningCount)) process.exitCode = 1;
