import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('..', import.meta.url));
/** @param {import('node:test').TestContext} t @param {NodeJS.ProcessEnv} [environment] */
export async function repositoryFixture(t, environment = process.env) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shiroha lint fixture-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, 'apps/desktop');
  await mkdir(path.join(project, 'scripts'), { recursive: true });
  await mkdir(path.join(temporary, 'apps/web'), { recursive: true });
  await mkdir(path.join(temporary, 'test/new-slice'), { recursive: true });
  await writeFile(path.join(temporary, 'apps/web/app.js'), "console.log('valid');\n");
  for (const name of ['eslint.rules.mjs', 'eslint.migration.mjs', 'eslint.platform.config.mjs']) {
    await copyFile(path.join(desktop, name), path.join(project, name));
  }
  for (const name of ['lint-incremental.mjs', 'lint-debt.mjs']) {
    await copyFile(path.join(desktop, 'scripts', name), path.join(project, 'scripts', name));
  }
  await symlink(path.join(desktop, 'node_modules'), path.join(project, 'node_modules'), 'junction');
  const localVariables = spawnSync('git', ['rev-parse', '--local-env-vars'], {
    cwd: temporary, env: environment, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(localVariables.status, 0, localVariables.stderr);
  const names = new Set(localVariables.stdout.split(/\r?\n/).filter(Boolean).map((key) => key.toUpperCase()));
  const fixtureEnvironment = { ...environment };
  // Hook 继承的仓库定位变量不能影响临时仓库，避免意外操作调用者的仓库。
  for (const key of Object.keys(fixtureEnvironment)) {
    if (names.has(key.toUpperCase()) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/i.test(key)) {
      delete fixtureEnvironment[key];
    }
  }
  const init = spawnSync('git', ['init'], { cwd: temporary, env: fixtureEnvironment, encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr);
  const run = (/** @type {string} */ script, /** @type {string[]} */ args = []) => spawnSync(
    process.execPath,
    [path.join(project, 'scripts', script), ...args],
    { cwd: os.tmpdir(), env: fixtureEnvironment, encoding: 'utf8', windowsHide: true },
  );
  const git = (/** @type {string[]} */ args) => spawnSync('git', args, { cwd: temporary, env: fixtureEnvironment, encoding: 'utf8', windowsHide: true });
  return { temporary, run, git };
}
