import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
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
  const git = (/** @type {string[]} */ args, cwd = repository, /** @type {string | undefined} */ input = undefined) => spawnSync(
    'git',
    args,
    { cwd, env, encoding: 'utf8', windowsHide: true, input },
  );
  expectSuccess(git(['init', '--initial-branch=main']));
  expectSuccess(git(['config', 'user.name', 'Hook Fixture']));
  expectSuccess(git(['config', 'user.email', 'hook@example.invalid']));
  for (const name of ['pre-commit', 'commit-msg']) {
    await copyFile(path.join(root, '.husky', name), path.join(repository, '.husky', name));
  }
  for (const name of ['eslint.config.mjs', 'eslint.platform.config.mjs', 'eslint.rules.mjs', 'eslint.migration.mjs', 'commitlint.config.mjs']) {
    await copyFile(path.join(desktop, name), path.join(project, name));
  }
  await copyFile(path.join(desktop, 'scripts/lint-index.mjs'), path.join(project, 'scripts/lint-index.mjs'));
  const pkg = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
  await writeFile(path.join(project, 'package.json'), JSON.stringify({
    private: true, type: 'module', scripts: {
      lint: 'eslint scripts --max-warnings 0', 'lint:index': pkg.scripts['lint:index'], commitlint: pkg.scripts.commitlint,
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
  await writeFile(probe, "console.log('fixture');\n");
  expectSuccess(git(['add', '.']));
  return { temporary, repository, project, probe, git, install };
}

test('pre-commit rejects invalid JavaScript before the first commit without rewriting staged or working files', async (t) => {
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

test('pre-commit rejects invalid staged JavaScript even when the worktree is clean', async (t) => {
  const f = await fixture(t);
  const invalid = 'var value = process.pid; console.log(value);\n';
  const fixed = "console.log('fixed only in worktree');\n";
  const upper = path.join(f.project, 'scripts/upper.MJS');
  await writeFile(f.probe, invalid);
  await writeFile(upper, invalid);
  expectSuccess(f.git(['add', 'apps/desktop/scripts/probe.mjs', 'apps/desktop/scripts/upper.MJS']));
  await writeFile(f.probe, fixed);
  await writeFile(upper, fixed);
  const before = f.git(['status', '--porcelain=v1']).stdout;
  const result = f.git(['commit', '-m', 'chore: 初始化检查样例']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /no-var/);
  assert.match(result.stdout + result.stderr, /upper\.MJS/);
  assert.equal(f.git(['rev-parse', '--verify', 'HEAD']).status, 128);
  assert.equal(await readFile(f.probe, 'utf8'), fixed);
  assert.equal(await readFile(upper, 'utf8'), fixed);
  assert.equal(f.git(['show', ':apps/desktop/scripts/probe.mjs']).stdout, invalid);
  assert.equal(f.git(['show', ':apps/desktop/scripts/upper.MJS']).stdout, invalid);
  assert.equal(f.git(['status', '--porcelain=v1']).stdout, before);
});

test('pre-commit refuses mismatched staged lint configuration without rewriting files', async (t) => {
  const f = await fixture(t);
  const config = path.join(f.project, 'eslint.rules.mjs');
  const original = await readFile(config, 'utf8');
  await writeFile(config, `${original}\n`);
  const before = f.git(['status', '--porcelain=v1']).stdout;
  const result = f.git(['commit', '-m', 'chore: 初始化检查样例']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /配置或暂存检查脚本与索引不一致/);
  assert.equal(f.git(['rev-parse', '--verify', 'HEAD']).status, 128);
  assert.equal(await readFile(config, 'utf8'), `${original}\n`);
  assert.equal(f.git(['status', '--porcelain=v1']).stdout, before);
});

test('pre-commit refuses a lint runner that differs from its staged version', async (t) => {
  const f = await fixture(t);
  const runner = path.join(f.project, 'scripts/lint-runner.mjs');
  const staged = "console.log('staged runner');\n";
  const working = "console.log('working runner');\n";
  await writeFile(runner, staged);
  expectSuccess(f.git(['add', 'apps/desktop/scripts/lint-runner.mjs']));
  await writeFile(runner, working);
  const before = f.git(['status', '--porcelain=v1']).stdout;
  const result = f.git(['commit', '-m', 'chore: 更新检查入口']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /配置或暂存检查脚本与索引不一致/);
  assert.equal(f.git(['rev-parse', '--verify', 'HEAD']).status, 128);
  assert.equal(await readFile(runner, 'utf8'), working);
  assert.equal(f.git(['show', ':apps/desktop/scripts/lint-runner.mjs']).stdout, staged);
  assert.equal(f.git(['status', '--porcelain=v1']).stdout, before);
});

test('pre-commit refuses an untracked lint runner when JavaScript is staged', async (t) => {
  const f = await fixture(t);
  const runner = path.join(f.project, 'scripts/lint-runner.mjs');
  await writeFile(runner, "console.log('untracked runner');\n");
  const before = f.git(['status', '--porcelain=v1']).stdout;
  const result = f.git(['commit', '-m', 'chore: 更新检查入口']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /配置或暂存检查脚本与索引不一致/);
  assert.equal(f.git(['rev-parse', '--verify', 'HEAD']).status, 128);
  assert.equal(await readFile(runner, 'utf8'), "console.log('untracked runner');\n");
  assert.equal(f.git(['status', '--porcelain=v1']).stdout, before);
});

test('pre-commit refuses untracked lint regression files when JavaScript is staged', async (t) => {
  const f = await fixture(t);
  const directory = path.join(f.project, 'test');
  const names = ['lint-suppressions.test.mjs', 'lint-mixed-extensions.test.mjs', 'lint-deleted-worktree.test.mjs'];
  await mkdir(directory, { recursive: true });
  for (const name of names) {
    await writeFile(path.join(directory, name), "console.log('untracked regression');\n");
  }
  const before = f.git(['status', '--porcelain=v1']).stdout;
  const result = f.git(['commit', '-m', 'chore: 更新检查用例']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /配置或暂存检查脚本与索引不一致/);
  assert.equal(f.git(['rev-parse', '--verify', 'HEAD']).status, 128);
  for (const name of names) {
    assert.match(result.stdout + result.stderr, new RegExp(name.replaceAll('.', '\\.')));
    assert.equal(await readFile(path.join(directory, name), 'utf8'), "console.log('untracked regression');\n");
  }
  assert.equal(f.git(['status', '--porcelain=v1']).stdout, before);
});

test('pre-commit runs every parallel check and only checks the index after all pass', async (t) => {
  const f = await fixture(t);
  await copyFile(path.join(desktop, 'scripts/lint-runner.mjs'), path.join(f.project, 'scripts/lint-runner.mjs'));
  await writeFile(path.join(f.project, 'scripts/hook-check.mjs'), [
    "import { existsSync, writeFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "const markerDirectory = path.resolve('../../.git');",
    'const check = process.argv[2];',
    "writeFileSync(path.join(markerDirectory, `ran-${check}`), 'yes');",
    "if (check === 'platform' && existsSync(path.join(markerDirectory, 'fail-platform'))) {",
    '  process.exitCode = 7;',
    '}',
    '',
  ].join('\n'));
  const pkgPath = path.join(f.project, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.scripts.lint = 'node scripts/lint-runner.mjs';
  for (const name of ['eslint', 'platform', 'incremental', 'fixtures', 'docs', 'index']) {
    pkg.scripts[`lint:${name}`] = `node scripts/hook-check.mjs ${name}`;
  }
  await writeFile(pkgPath, JSON.stringify(pkg));
  await writeFile(path.join(f.repository, '.git/fail-platform'), 'fail');
  expectSuccess(f.git(['add', '.']));
  const before = f.git(['status', '--porcelain=v1']).stdout;
  const rejected = f.git(['commit', '-m', 'chore: 验证并行检查']);
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  for (const name of ['eslint', 'platform', 'incremental', 'fixtures', 'docs']) {
    assert.equal(await readFile(path.join(f.repository, `.git/ran-${name}`), 'utf8'), 'yes');
  }
  await assert.rejects(readFile(path.join(f.repository, '.git/ran-index'), 'utf8'), { code: 'ENOENT' });
  assert.equal(f.git(['status', '--porcelain=v1']).stdout, before);
  await unlink(path.join(f.repository, '.git/fail-platform'));
  expectSuccess(f.git(['commit', '--file', '-'], f.repository, 'chore: 验证并行检查\n'));
  assert.equal(f.git(['log', '-1', '--format=%s']).stdout.trim(), 'chore: 验证并行检查');
  assert.equal(await readFile(path.join(f.repository, '.git/ran-index'), 'utf8'), 'yes');
});

test('pre-commit checks a staged file that was subsequently deleted from the worktree', async (t) => {
  const f = await fixture(t);
  const staged = f.git(['show', ':apps/desktop/scripts/probe.mjs']).stdout;
  await unlink(f.probe);
  expectSuccess(f.git(['commit', '-m', 'chore: 初始化检查样例']));
  assert.equal(f.git(['show', 'HEAD:apps/desktop/scripts/probe.mjs']).stdout, staged);
  await assert.rejects(readFile(f.probe, 'utf8'), { code: 'ENOENT' });
  assert.match(f.git(['status', '--porcelain=v1']).stdout, / D apps\/desktop\/scripts\/probe\.mjs/);
});

test('pre-commit refuses a staged JavaScript symlink without modifying the index', async (t) => {
  const f = await fixture(t);
  const blob = f.git(['hash-object', '-w', 'apps/desktop/scripts/probe.mjs']);
  expectSuccess(blob);
  const link = 'apps/desktop/scripts/link.js';
  expectSuccess(f.git(['update-index', '--add', '--cacheinfo', `120000,${blob.stdout.trim()},${link}`]));
  const before = f.git(['status', '--porcelain=v1']).stdout;
  const result = f.git(['commit', '-m', 'chore: 初始化检查样例']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /无法检查暂存的非普通 JavaScript 文件/);
  assert.equal(f.git(['rev-parse', '--verify', 'HEAD']).status, 128);
  assert.equal(f.git(['status', '--porcelain=v1']).stdout, before);
});

test('pre-commit checks a staged package configuration even without staged JavaScript', async (t) => {
  const f = await fixture(t);
  expectSuccess(f.git(['commit', '-m', 'chore: 初始化检查样例']));
  const pkg = path.join(f.project, 'package.json');
  const original = await readFile(pkg, 'utf8');
  const staged = JSON.parse(original);
  delete staged.scripts['lint:index'];
  await writeFile(pkg, JSON.stringify(staged));
  expectSuccess(f.git(['add', 'apps/desktop/package.json']));
  await writeFile(pkg, original);
  const before = f.git(['status', '--porcelain=v1']).stdout;
  const result = f.git(['commit', '-m', 'chore: 更新检查配置']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /配置或暂存检查脚本与索引不一致/);
  assert.equal(await readFile(pkg, 'utf8'), original);
  assert.equal(f.git(['show', ':apps/desktop/package.json']).stdout, JSON.stringify(staged));
  assert.equal(f.git(['status', '--porcelain=v1']).stdout, before);
});

test('commit-msg rejects invalid messages and accepts Chinese Conventional Commits', async (t) => {
  const f = await fixture(t);
  for (const message of ['更新检查配置', 'unknown: 更新检查配置']) {
    const result = f.git(['commit', '-m', message]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /type-(?:empty|enum)/);
    assert.equal(f.git(['rev-parse', '--verify', 'HEAD']).status, 128);
  }
  expectSuccess(f.git(['commit', '-m', 'chore: 初始化检查样例']));
  await writeFile(f.probe, "console.log('updated');\n");
  expectSuccess(f.git(['add', '.']));
  expectSuccess(f.git(['commit', '-m', 'fix(desktop): 更新检查样例']));
});

test('hooks validate the message file supplied by Git in a linked worktree with spaces and Chinese in its path', async (t) => {
  const f = await fixture(t);
  expectSuccess(f.git(['commit', '-m', 'chore: 初始化检查样例']));
  const linked = path.join(f.temporary, 'linked worktree 中文');
  expectSuccess(f.git(['worktree', 'add', '-b', 'hook-test', linked]));
  await symlink(path.join(desktop, 'node_modules'), path.join(linked, 'apps/desktop/node_modules'), 'junction');
  f.install(linked);
  await writeFile(path.join(linked, 'apps/desktop/scripts/probe.mjs'), "console.log('linked');\n");
  expectSuccess(f.git(['add', '.'], linked));
  const result = f.git(['commit', '-m', '错误信息'], linked);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /type-empty/);
  expectSuccess(f.git(['commit', '-m', 'test(desktop): 验证工作树钩子'], linked));
});
