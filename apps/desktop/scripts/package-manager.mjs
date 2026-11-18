import path from 'node:path';

/**
 * pnpm 在 Windows 上提供原生可执行文件，npm 则提供需要 Node 加载的 CLI 脚本。
 * @param {string} script
 * @param {string[]} [args]
 * @returns {{ command: string, args: string[] }}
 */
export function packageScript(script, args = []) {
  const executable = process.env.npm_execpath;
  if (!executable) { throw new Error('请通过 pnpm run 启动项目脚本。'); }
  const scriptArgs = ['run', script, ...args];
  return ['.js', '.cjs', '.mjs'].includes(path.extname(executable).toLowerCase())
    ? { command: process.execPath, args: [executable, ...scriptArgs] }
    : { command: executable, args: scriptArgs };
}
