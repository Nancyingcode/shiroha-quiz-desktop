import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(desktop, '../..');
const husky = path.join(desktop, 'node_modules/husky/bin.js');

/** @param {import('node:child_process').SpawnSyncReturns<string>} result */
function expectSuccess(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shiroha git hooks-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const repository = path.join(temporary, 'repository');
  const project = path.join(repository, 'apps/desktop');
  await mkdir(path.join(project, 'scripts'), { recursive: true });
  await mkdir(path.join(repository, '.husky'));
  const globalConfig = path.join(temporary, 'gitconfig');
  await writeFile(globalConfig, '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  // 隔离开发机的签名、全局 hooks 和 Husky 初始化，避免测试创建的提交触及真实仓库设置。
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', HUSKY: '1',
    XDG_CONFIG_HOME: path.join(temporary, 'config'),
  });
  const git = (/** @type {string[]} */ args, cwd = repository) => spawnSync('git', args,
    { cwd, env, encoding: 'utf8', windowsHide: true });
  expectSuccess(git(['init', '--initial-branch=main']));
  expectSuccess(git(['config', 'user.name', 'Hook Fixture']));
  expectSuccess(git(['config', 'user.email', 'hook@example.invalid']));
  for (const name of ['pre-commit', 'commit-msg']) {
    await copyFile(path.join(root, '.husky', name), path.join(repository, '.husky', name));
  }
  for (const name of ['eslint.config.mjs', 'commitlint.config.mjs']) {
    await copyFile(path.join(desktop, name), path.join(project, name));
  }
  const pkg = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
  await writeFile(path.join(project, 'package.json'), JSON.stringify({
    private: true, type: 'module', scripts: {
      lint: 'eslint scripts --max-warnings 0', commitlint: pkg.scripts.commitlint,
    },
  }));
  await writeFile(path.join(repository, '.gitignore'), 'node_modules/\n');
  await symlink(path.join(desktop, 'node_modules'), path.join(project, 'node_modules'), 'junction');
  const install = (cwd = repository) => {
    expectSuccess(spawnSync(process.execPath, [husky], { cwd, env, encoding: 'utf8', windowsHide: true }));
    assert.equal(git(['config', '--get', 'core.hooksPath'], cwd).stdout.trim(), '.husky/_');
  };
  install();
  const probe = path.join(project, 'scripts/probe.mjs');
  await writeFile(probe, 'console.log("fixture");\n');
  expectSuccess(git(['add', '.']));
  return { temporary, repository, project, probe, git, install };
}

test('pre-commit rejects invalid JavaScript before the first commit without rewriting staged or working files', async t => {
  const f = await fixture(t);
  const staged = f.git(['show', ':apps/desktop/scripts/probe.mjs']).stdout;
  const invalid = 'var value = process.pid; console.log(value);\n';
  await writeFile(f.probe, invalid);
  const before = f.git(['status', '--porcelain=v1']).stdout;
  const result = f.git(['commit', '-m', 'chore: 初始化检查样例']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /no-var/);
  assert.equal(f.git(['rev-parse', '--verify', 'HEAD']).status, 128);
  assert.equal(await readFile(f.probe, 'utf8'), invalid);
  assert.equal(f.git(['show', ':apps/desktop/scripts/probe.mjs']).stdout, staged);
  assert.equal(f.git(['status', '--porcelain=v1']).stdout, before);
});

test('commit-msg rejects invalid messages and accepts Chinese Conventional Commits', async t => {
  const f = await fixture(t);
  for (const message of ['更新检查配置', 'unknown: 更新检查配置']) {
    const result = f.git(['commit', '-m', message]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /type-(?:empty|enum)/);
    assert.equal(f.git(['rev-parse', '--verify', 'HEAD']).status, 128);
  }
  expectSuccess(f.git(['commit', '-m', 'chore: 初始化检查样例']));
  await writeFile(f.probe, 'console.log("updated");\n');
  expectSuccess(f.git(['add', '.']));
  expectSuccess(f.git(['commit', '-m', 'fix(desktop): 更新检查样例']));
});

test('hooks validate the message file supplied by Git in a linked worktree with spaces and Chinese in its path', async t => {
  const f = await fixture(t);
  expectSuccess(f.git(['commit', '-m', 'chore: 初始化检查样例']));
  const linked = path.join(f.temporary, 'linked worktree 中文');
  expectSuccess(f.git(['worktree', 'add', '-b', 'hook-test', linked]));
  await symlink(path.join(desktop, 'node_modules'), path.join(linked, 'apps/desktop/node_modules'), 'junction');
  f.install(linked);
  await writeFile(path.join(linked, 'apps/desktop/scripts/probe.mjs'), 'console.log("linked");\n');
  expectSuccess(f.git(['add', '.'], linked));
  const result = f.git(['commit', '-m', '错误信息'], linked);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /type-empty/);
  expectSuccess(f.git(['commit', '-m', 'test(desktop): 验证工作树钩子'], linked));
});
