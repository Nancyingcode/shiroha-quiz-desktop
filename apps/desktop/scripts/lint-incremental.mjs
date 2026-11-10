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
const modes = new Map();
const entries = execFileSync('git', ['ls-files', '--stage', '-z'], {
  cwd: root, encoding: 'utf8', windowsHide: true,
});
for (const entry of entries.split('\0').filter(Boolean)) {
  const separator = entry.indexOf('\t');
  const [mode, , stage] = entry.slice(0, separator).split(' ');
  const file = entry.slice(separator + 1);
  if (!modes.has(file) || stage === '0') { modes.set(file, stage === '0' ? mode : 'unmerged'); }
}
const files = [];
for (const file of candidates) {
  const target = path.join(root, file);
  if (await lint.isPathIgnored(target)) { continue; }
  // Git 索引仍包含未暂存的删除路径；其他文件访问错误不能当作删除忽略。
  try {
    const stat = await lstat(target);
    const mode = modes.get(file);
    // Git 的符号链接在 Windows 可能以普通文件检出，文件系统类型不能代替索引类型。
    if (!stat.isFile() || (mode !== undefined && mode !== '100644' && mode !== '100755')) {
      throw new Error(`无法检查非普通 JavaScript 文件：${file}`);
    }
  } catch (error) {
    const { code } = /** @type {NodeJS.ErrnoException} */ (error);
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
