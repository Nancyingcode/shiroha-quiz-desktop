import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileString } from 'sass';
import { styleTargets } from './styles-targets.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));

/** @param {string} relative */
async function readLocalStyle(relative) {
  const directories = path.posix.dirname(relative).split('/');
  let parent = root;
  // 从工作树内逐层核对目录，避免 junction 将读取或替换重定向到其他位置。
  for (const directory of directories) {
    parent = path.join(parent, directory);
    if (!(await lstat(parent)).isDirectory()) {
      throw new Error(`样式目录必须是普通目录，不能是链接：${parent}`);
    }
  }

  const file = path.join(root, relative);
  try {
    if (!(await lstat(file)).isFile()) {
      throw new Error(`样式输入或产物必须是普通文件，不能是链接：${file}`);
    }
    return await readFile(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return null; }
    throw error;
  }
}

/** @param {string} source */
async function compileStyle(source) {
  const contents = await readLocalStyle(source);
  if (contents === null) { throw new Error(`缺少 SCSS 源码：${source}`); }
  const { css } = compileString(new TextDecoder('utf-8', { fatal: true }).decode(contents), {
    url: pathToFileURL(path.join(root, source)),
    style: 'expanded',
    sourceMap: false,
    charset: false,
  });
  const header = `/* 由 ${source} 生成。在 apps/desktop 运行 pnpm run styles:build 更新。 */`;
  return Buffer.from(`${header}\n${css.replace(/\r\n?/g, '\n').trimEnd()}\n`);
}

/** @param {string} output @param {Buffer} contents */
async function replaceCss(output, contents) {
  const file = path.join(root, output);
  const temporary = `${file}.${randomUUID()}.tmp`;
  // 独占的同目录临时文件让并发写入互不干扰，读者只会看到完整的 CSS。
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(contents).finally(() => handle.close());
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function synchronizeStyles({ write = false } = {}) {
  // 所有入口都通过编译和路径校验后才开始写，避免后一份语法错误时更新前一份产物。
  const compiled = await Promise.all(styleTargets.map(async ({ source, output }) => ({
    output,
    expected: await compileStyle(source),
    existing: await readLocalStyle(output),
  })));
  const pending = compiled.filter(({ expected, existing }) => !existing || !expected.equals(existing));
  if (!write && pending.length > 0) {
    const files = pending.map(({ output }) => output).join('、');
    throw new Error(`${files} 缺失或与 SCSS 源码不一致。请在 apps/desktop 运行 pnpm run styles:build。`);
  }
  for (const { output, expected } of pending) {
    await replaceCss(output, expected);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['--build', '--check'].includes(mode)) {
    throw new Error('用法：node scripts/styles.mjs --build 或 --check');
  }
  await synchronizeStyles({ write: mode === '--build' });
  const files = styleTargets.map(({ output }) => output).join('、');
  console.log(`${mode === '--build' ? '已生成' : '已核对'} ${files}`);
}
