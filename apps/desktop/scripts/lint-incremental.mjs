import { execFileSync } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const lint = new ESLint({
  cwd: root,
  overrideConfigFile: fileURLToPath(new URL('../eslint.platform.config.mjs', import.meta.url)),
});
// Git 列表包含未跟踪的新源码并遵守忽略规则；新路径不继承历史文件的迁移例外。
// 历史门禁外文件已迁移，增量检查不再排除它们。
const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
}).split('\0').filter((file) => /\.(?:js|mjs|cjs)$/i.test(file));
const files = [];
for (const file of candidates) {
  const target = path.join(root, file);
  if (await lint.isPathIgnored(target)) { continue; }
  // Git 索引仍包含未暂存的删除路径；其他文件访问错误不能当作删除忽略。
  try {
    await lstat(target);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') { continue; }
    throw error;
  }
  files.push(file);
}
if (!files.length) {
  throw new Error('No handwritten JavaScript files found for incremental lint.');
}
const results = await lint.lintFiles(files);
const formatter = await lint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output) {
  console.log(output);
}
console.log(`Checked ${files.length} complete handwritten JavaScript files (full target rules).`);
if (results.some((result) => result.errorCount || result.warningCount)) {
  process.exitCode = 1;
}
