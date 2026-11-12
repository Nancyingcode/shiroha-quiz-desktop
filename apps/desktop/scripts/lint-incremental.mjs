import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';
import fsPromises, { lstat, readdir, stat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
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
/** @param {string} target */
async function verifyOrdinaryPath(target) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`无法检查越界路径：${target}`);
  }
  let current = root;
  /** @type {import('node:fs').Stats | undefined} */
  let info;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    info = await lstat(current);
    if (info.isSymbolicLink()) { throw new Error(`无法检查链接：${current}`); }
  }
  const name = relative.split(path.sep).join('/');
  const mode = modes.get(name);
  if (!info?.isFile() || (mode !== undefined && mode !== '100644' && mode !== '100755')) {
    throw new Error(`无法检查非普通 JavaScript 文件：${name}`);
  }
}
const complete = process.argv.includes('--complete');
const desktop = fileURLToPath(new URL('..', import.meta.url));
const pathKey = (/** @type {string} */ file) => path.resolve(file);
/** @type {string[]} */
let desktopFiles = [];
/** @type {ESLint | undefined} */
let desktopLint;
if (complete) {
  for (const name of ['apps', 'apps/desktop']) {
    if ((await lstat(path.join(root, name))).isSymbolicLink()) { throw new Error(`无法检查链接：${name}`); }
  }
  for (const name of ['eslint.config.mjs', 'eslint.platform.config.mjs', 'eslint.rules.mjs', 'eslint.migration.mjs']) {
    const info = await lstat(path.join(desktop, name));
    const mode = modes.get(`apps/desktop/${name}`);
    if (!info.isFile() || (mode !== undefined && mode !== '100644' && mode !== '100755')) {
      throw new Error(`无法检查非普通 JavaScript 文件：apps/desktop/${name}`);
    }
  }
  const desktopEngine = new ESLint({ cwd: desktop, overrideConfigFile: path.join(desktop, 'eslint.config.mjs') });
  desktopLint = desktopEngine;
  // 发现阶段会读取文件；先拒绝链接和 Git 索引中的非普通类型，避免越界读取。
  const inspect = async (/** @type {string} */ target, isRoot = false) => {
    let info;
    try { info = await lstat(target); } catch (error) {
      if (error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code))) { return; }
      throw error;
    }
    if (info.isSymbolicLink()) {
      const isScript = /\.(?:js|mjs|cjs)$/i.test(target);
      const ignored = await lint.isPathIgnored(target) && await desktopEngine.isPathIgnored(target);
      if (isRoot || (isScript && !ignored)) { throw new Error(`无法检查链接：${target}`); }
      let linked;
      try { linked = await stat(target); } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return; }
        throw error;
      }
      if (linked.isDirectory()) {
        for (const extension of ['js', 'mjs', 'cjs']) {
          const probe = path.join(target, `__lint_probe__.${extension}`);
          if (!await lint.isPathIgnored(probe) || !await desktopEngine.isPathIgnored(probe)) {
            throw new Error(`无法检查链接：${target}`);
          }
        }
      }
      return;
    }
    if (info.isDirectory()) {
      for (const entry of await readdir(target)) { await inspect(path.join(target, entry)); }
    } else if (/\.(?:js|mjs|cjs)$/i.test(target)) {
      const ignored = await lint.isPathIgnored(target);
      const desktopIgnored = await desktopEngine.isPathIgnored(target);
      if (ignored && desktopIgnored) { return; }
      const name = path.relative(root, target).split(path.sep).join('/');
      const mode = modes.get(name);
      if (!info.isFile() || (mode !== undefined && mode !== '100644' && mode !== '100755')) {
        throw new Error(`无法检查非普通 JavaScript 文件：${name}`);
      }
    }
  };
  const scoped = [
    'apps/desktop/scripts', 'apps/desktop/test', 'apps/web/platform', 'apps/web/training.js',
    'apps/desktop/frontend', 'test/dual-platform',
  ];
  // 避免从软链接或 junction 组成的祖先进入检查范围。
  for (const name of scoped) {
    let parent = root;
    for (const part of name.split('/').slice(0, -1)) {
      parent = path.join(parent, part);
      try {
        if ((await lstat(parent)).isSymbolicLink()) { throw new Error(`无法检查链接：${parent}`); }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { break; }
        throw error;
      }
    }
    await inspect(path.join(root, name), true);
  }
  for (const name of await readdir(desktop)) {
    if (/\.config\.mjs$/.test(name) || ['eslint.rules.mjs', 'eslint.migration.mjs'].includes(name)) {
      await inspect(path.join(desktop, name));
    }
  }
  // 使用 ESLint 自己的目录与忽略规则发现旧入口范围；空处理器不解析或执行规则。
  const discover = async (/** @type {string} */ cwd, /** @type {string} */ config, /** @type {string[]} */ patterns) => {
    /** @type {string[]} */
    const found = [];
    const processor = {
      preprocess: (/** @type {string} */ _source, /** @type {string} */ filename) => { found.push(filename); return []; },
      postprocess: () => [],
    };
    const discovery = new ESLint({
      cwd,
      overrideConfigFile: config,
      overrideConfig: [{
        files: ['**/*.[jJ][sS]', '**/*.[mM][jJ][sS]', '**/*.[cC][jJ][sS]'], processor,
      }],
    });
    await discovery.lintFiles(patterns);
    return found;
  };
  const originalReadFile = fsPromises.readFile;
  /** @param {...unknown} args */
  const guardedReadFile = async (...args) => {
    const file = args[0];
    if (typeof file === 'string' && /\.(?:js|mjs|cjs)$/i.test(file)) {
      const name = path.relative(root, file).split(path.sep).join('/');
      const sourcePath = scoped.some((entry) => name === entry || name.startsWith(`${entry}/`))
        || /^apps\/desktop\/[^/]+\.mjs$/i.test(name);
      if (sourcePath) { await verifyOrdinaryPath(file); }
    }
    return Reflect.apply(originalReadFile, fsPromises, args);
  };
  // ESLint 10 当前通过 fs.promises.readFile 在处理器前读取；仅发现期间复核并恢复原函数。
  // 升级 ESLint 时由链接读取故障注入复核同步、回调和 Promise 读取路径。
  if (!Reflect.set(fsPromises, 'readFile', guardedReadFile)) { throw new Error('无法保护 ESLint 发现阶段读取'); }
  try {
    desktopFiles = await discover(desktop, path.join(desktop, 'eslint.config.mjs'), [
      'scripts', 'test', '*.config.mjs', 'eslint.rules.mjs', 'eslint.migration.mjs',
    ]);
    const platformFiles = await discover(root, path.join(desktop, 'eslint.platform.config.mjs'), [
      'apps/web/platform/**/*.js', 'apps/web/training.js', 'test/dual-platform/**/*.cjs',
      ...globSync('apps/desktop/frontend/**/*.js', { cwd: root }),
    ]);
    const existing = new Set(candidates.map((file) => pathKey(path.join(root, file))));
    for (const target of [...desktopFiles, ...platformFiles]) {
      const key = pathKey(target);
      if (!existing.has(key)) { candidates.push(path.relative(root, target)); existing.add(key); }
    }
  } finally {
    Reflect.set(fsPromises, 'readFile', originalReadFile);
  }
}
const files = [];
const desktopPaths = new Set(desktopFiles.map(pathKey));
for (const file of candidates) {
  const target = path.join(root, file);
  const platformIgnored = await lint.isPathIgnored(target);
  if (platformIgnored && !desktopPaths.has(pathKey(target))) { continue; }
  // Git 索引仍包含未暂存的删除路径；其他文件访问错误不能当作删除忽略。
  try {
    // Git 的符号链接在 Windows 可能以普通文件检出，文件系统类型不能代替索引类型。
    await verifyOrdinaryPath(target);
  } catch (error) {
    const { code } = /** @type {NodeJS.ErrnoException} */ (error);
    if (code === 'ENOENT' || code === 'ENOTDIR') { continue; }
    throw error;
  }
  if (!platformIgnored) { files.push(file); }
}
if (!files.length) {
  throw new Error('No handwritten JavaScript files found for incremental lint.');
}
const results = await lint.lintFiles(files);
if (complete && desktopLint) {
  /** @type {string[]} */
  const different = [];
  for (const target of desktopFiles) {
    const platformConfig = await lint.calculateConfigForFile(target);
    const desktopConfig = await desktopLint.calculateConfigForFile(target);
    if (!isDeepStrictEqual(platformConfig, desktopConfig)) { different.push(target); }
  }
  if (different.length) {
    results.push(...await desktopLint.lintFiles(different));
    console.log(`Checked ${different.length} files again with differing desktop configuration.`);
  }
}
const formatter = await lint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output) {
  console.log(output);
}
console.log(`Checked ${files.length} complete handwritten JavaScript files (full target rules).`);
if (results.some((result) => result.errorCount || result.warningCount)) {
  process.exitCode = 1;
}
