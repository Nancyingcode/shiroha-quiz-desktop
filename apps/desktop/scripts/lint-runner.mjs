import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{ name: string, command: string, args: string[] }} Check */

/**
 * @param {Check[]} checks
 * @param {{ cwd?: string, stdio?: 'inherit' | 'ignore', reportFailure?: (message: string) => void }} [options]
 * @returns {Promise<boolean>}
 */
export async function runChecks(checks, options = {}) {
  const reportFailure = options.reportFailure ?? console.error;
  const results = await Promise.all(checks.map((check) => new Promise((resolve) => {
    const child = spawn(check.command, check.args, {
      cwd: options.cwd,
      // Git 可能通过 stdin 提供提交信息，检查进程不得消费这段输入。
      stdio: ['ignore', options.stdio ?? 'inherit', options.stdio ?? 'inherit'],
      windowsHide: true,
    });
    /** @type {Error | undefined} */
    let spawnError;
    child.once('error', (error) => { spawnError = error; });
    child.once('close', (code, signal) => {
      if (spawnError) {
        reportFailure(`${check.name} 无法启动：${spawnError.message}`);
      } else if (code !== 0) {
        reportFailure(`${check.name} 检查失败：${signal || `退出码 ${code}`}`);
      }
      resolve(!spawnError && code === 0);
    });
  })));
  return results.every((result) => result === true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const npm = process.env.npm_execpath;
  if (!npm) { throw new Error('请通过 npm run lint 启动检查。'); }
  const scripts = ['lint:incremental', 'lint:fixtures', 'lint:docs', 'lint:css'];
  // 各项只读源码或使用隔离临时目录；全部成功后提交钩子才会继续检查暂存区。
  const checks = scripts.map((name) => ({ name, command: process.execPath,
    args: [npm, 'run', name, ...(name === 'lint:incremental' ? ['--', '--complete'] : [])] }));
  if (!await runChecks(checks)) { process.exitCode = 1; }
}
