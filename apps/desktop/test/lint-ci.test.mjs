import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { hasPassedBaseline, lintChangedFiles, planCiLint } from '../scripts/lint-ci.mjs';
import { repositoryFixture } from './lint-fixture-helpers.mjs';

/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const f = await repositoryFixture(t);
  await writeFile(path.join(f.temporary, '.gitignore'), 'node_modules/\n');
  return f;
}

/** @param {ReturnType<typeof import('./lint-fixture-helpers.mjs').repositoryFixture> extends Promise<infer T> ? T : never} f
 * @param {string[]} args */
function git(f, args) {
  const result = f.git(['-c', 'user.name=CI Fixture', '-c', 'user.email=ci@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** @param {ReturnType<typeof import('./lint-fixture-helpers.mjs').repositoryFixture> extends Promise<infer T> ? T : never} f
 * @param {string} message */
function commit(f, message) {
  git(f, ['add', '-A']);
  git(f, ['commit', '-m', message]);
  return git(f, ['rev-parse', 'HEAD']);
}

/** @param {ReturnType<typeof import('./lint-fixture-helpers.mjs').repositoryFixture> extends Promise<infer T> ? T : never} f
 * @param {string} base @param {string} head */
function event(f, base, head) {
  return {
    root: f.temporary,
    eventName: 'pull_request',
    event: { pull_request: { base: { sha: base, ref: 'main' }, head: { sha: head } } },
    sha: git(f, ['rev-parse', 'HEAD']),
    hasBaseline: async () => true,
  };
}

test('PR scope checks the merged result across commits and retains deleted and renamed paths for impact', async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.temporary, 'apps/web'), { recursive: true });
  await writeFile(path.join(f.temporary, 'apps/web/old.js'), "console.log('old');\n");
  await writeFile(path.join(f.temporary, 'apps/web/deleted.js'), "console.log('deleted');\n");
  const initial = commit(f, 'initial');
  git(f, ['switch', '-c', 'feature']);
  await rename(path.join(f.temporary, 'apps/web/old.js'), path.join(f.temporary, 'apps/web/题库 [新].js'));
  git(f, ['rm', 'apps/web/deleted.js']);
  commit(f, 'first');
  await writeFile(path.join(f.temporary, 'apps/web/second.js'), "console.log('second');\n");
  const head = commit(f, 'second');
  git(f, ['switch', '--detach', initial]);
  await writeFile(path.join(f.temporary, 'target.md'), '# updated target\n');
  const base = commit(f, 'target updated');
  git(f, ['merge', '--no-ff', '--no-edit', head]);
  const plan = await planCiLint(event(f, base, head));
  assert.equal(plan.mode, 'changed');
  assert.deepEqual(plan.files.sort(), ['apps/web/second.js', 'apps/web/题库 [新].js'].sort());
  assert(plan.changed.includes('apps/web/old.js'));
  assert(plan.changed.includes('apps/web/deleted.js'));
  assert.equal(await lintChangedFiles(f.temporary, plan.files), true);
});

test('configuration changes, missing history, mismatched parents and untrusted baselines require full checks', async (t) => {
  const f = await fixture(t);
  const base = commit(f, 'initial');
  git(f, ['switch', '-c', 'feature']);
  await writeFile(path.join(f.temporary, 'apps/web/change.js'), "console.log('changed');\n");
  const head = commit(f, 'change');
  git(f, ['switch', '--detach', base]);
  git(f, ['merge', '--no-ff', '--no-edit', head]);
  const input = event(f, base, head);
  assert.equal((await planCiLint({ ...input, hasBaseline: async () => false })).mode, 'full');
  const missing = 'f'.repeat(40);
  assert.equal((await planCiLint({ ...input, event: { pull_request: {
    base: { sha: missing, ref: 'main' }, head: { sha: head },
  } } })).mode, 'full');
  assert.equal((await planCiLint({ ...input, eventName: 'push' })).mode, 'full');
  assert.equal((await planCiLint({ ...input, eventName: 'merge_group' })).mode, 'full');
  await assert.rejects(planCiLint({ ...input, sha: 'a'.repeat(40) }), /检出的提交与预期提交不一致/);
  assert.equal((await planCiLint({ ...input, event: { pull_request: {
    base: { sha: head, ref: 'main' }, head: { sha: base },
  } } })).mode, 'full');
  const shallow = path.join(f.temporary, '.git/shallow');
  await writeFile(shallow, `${input.sha}\n`);
  assert.equal((await planCiLint(input)).mode, 'full');
  await unlink(shallow);
  git(f, ['switch', '--detach', head]);
  await writeFile(path.join(f.temporary, 'apps/desktop/eslint.rules.mjs'), 'export const changed = true;\n');
  const configHead = commit(f, 'change configuration');
  git(f, ['switch', '--detach', base]);
  git(f, ['merge', '--no-ff', '--no-edit', configHead]);
  const configPlan = await planCiLint(event(f, base, configHead));
  assert.equal(configPlan.mode, 'full');
  assert.match(configPlan.reason, /eslint\.rules\.mjs/);
});

test('deleting or renaming a configuration or lock file forces a full check', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.temporary, 'apps/desktop/package-lock.json'), '{}\n');
  const base = commit(f, 'initial');
  git(f, ['switch', '-c', 'feature']);
  git(f, ['rm', 'apps/desktop/package-lock.json']);
  await rename(
    path.join(f.temporary, 'apps/desktop/eslint.rules.mjs'),
    path.join(f.temporary, 'apps/desktop/previous-rules.mjs'),
  );
  const head = commit(f, 'remove configuration');
  git(f, ['switch', '--detach', base]);
  git(f, ['merge', '--no-ff', '--no-edit', head]);
  assert.equal((await planCiLint(event(f, base, head))).mode, 'full');
});

test('empty changes succeed and changed lint errors fail without scanning unrelated files', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.temporary, 'apps/web/app.js'), 'var invalid = 1; console.log(invalid);\n');
  const base = commit(f, 'initial');
  git(f, ['switch', '-c', 'feature']);
  await writeFile(path.join(f.temporary, 'notes.md'), '# notes\n');
  const head = commit(f, 'docs');
  git(f, ['switch', '--detach', base]);
  git(f, ['merge', '--no-ff', '--no-edit', head]);
  const plan = await planCiLint(event(f, base, head));
  assert.equal(plan.mode, 'changed');
  assert.deepEqual(plan.files, []);
  assert.equal(await lintChangedFiles(f.temporary, plan.files), true);
  const file = 'apps/web/题库 [新].js';
  await writeFile(path.join(f.temporary, file), "console.log('valid');\n");
  git(f, ['add', '--', file]);
  assert.equal(await lintChangedFiles(f.temporary, [file]), true);
  await writeFile(path.join(f.temporary, file), 'var broken = 1; console.log(broken);\n');
  assert.equal(await lintChangedFiles(f.temporary, [file]), false);
  await writeFile(path.join(f.temporary, file), 'console.log("wrong quotes");\n');
  assert.equal(await lintChangedFiles(f.temporary, [file]), false);
});

test('a JavaScript symlink checked out as a regular file cannot bypass CI', async (t) => {
  const f = await fixture(t);
  git(f, ['config', 'core.symlinks', 'false']);
  const base = commit(f, 'initial');
  git(f, ['switch', '-c', 'feature']);
  const target = path.join(f.temporary, 'link-target.txt');
  await writeFile(target, "console.log('valid');\n");
  const blob = git(f, ['hash-object', '-w', 'link-target.txt']);
  await unlink(target);
  const file = 'apps/web/link.js';
  git(f, ['update-index', '--add', '--cacheinfo', `120000,${blob},${file}`]);
  git(f, ['checkout-index', '--force', '--', file]);
  git(f, ['commit', '-m', 'add symlink']);
  const head = git(f, ['rev-parse', 'HEAD']);
  git(f, ['switch', '--detach', base]);
  git(f, ['merge', '--no-ff', '--no-edit', head]);
  assert.equal((await lstat(path.join(f.temporary, file))).isFile(), true);
  const plan = await planCiLint(event(f, base, head));
  assert.equal(plan.mode, 'changed');
  assert.deepEqual(plan.files, [file]);
  await assert.rejects(lintChangedFiles(f.temporary, plan.files), /非普通 JavaScript 文件/);
});

test('a baseline requires the matching successful push job and its full lint step', async () => {
  const baseSha = 'a'.repeat(40);
  const run = { id: 42, path: '.github/workflows/desktop.yml', head_sha: baseSha,
    head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' };
  const options = { baseSha, baseRef: 'main', repository: 'owner/repo', token: 'fixture',
    apiUrl: 'https://example.invalid' };
  const request = async (/** @type {string} */ url) => ({
    ok: true,
    json: async () => (url.includes('/jobs?')
      ? { jobs: [{ name: 'checks', conclusion: 'success', steps: [{ name: 'Run npm run lint', conclusion: 'success' }] }] }
      : { workflow_runs: [run] }),
  });
  assert.equal(await hasPassedBaseline({ ...options, request }), true);
  assert.equal(await hasPassedBaseline({ ...options, request: async () => ({ ok: false, json: async () => ({}) }) }), false);
  assert.equal(await hasPassedBaseline({ ...options, token: '' }), false);
  assert.equal(await hasPassedBaseline({ ...options, request: async () => { throw new Error('offline'); } }), false);
  assert.equal(await hasPassedBaseline({ ...options, request: async () => ({ ok: true,
    json: async () => ({ workflow_runs: [{ ...run, head_branch: 'other' }] }) }) }), false);
});

/** @param {import('node:test').TestContext} t @param {(root: string) => Promise<void>} change */
async function ciEntryFixture(t, change) {
  const f = await fixture(t);
  const ciScript = path.join(f.temporary, 'apps/desktop/scripts/lint-ci.mjs');
  await copyFile(new URL('../scripts/lint-ci.mjs', import.meta.url), ciScript);
  const driver = path.join(f.temporary, 'npm-driver.mjs');
  await writeFile(driver, [
    'console.log(process.argv[3]);',
    "if (['lint', 'lint:css'].includes(process.argv[3])) { process.exitCode = 7; }",
  ].join('\n'));
  await writeFile(path.join(f.temporary, 'apps/web/styles.css'), 'body { color: black; }\n');
  const base = commit(f, 'initial');
  git(f, ['switch', '-c', 'feature']);
  await change(f.temporary);
  const head = commit(f, 'PR change');
  git(f, ['switch', '--detach', base]);
  git(f, ['merge', '--no-ff', '--no-edit', head]);
  const merge = git(f, ['rev-parse', 'HEAD']);
  const eventPath = path.join(f.temporary, 'event.json');
  await writeFile(eventPath, JSON.stringify({ pull_request: { base: { sha: base, ref: 'main' }, head: { sha: head } } }));
  const run = { id: 42, path: '.github/workflows/desktop.yml', head_sha: base, head_branch: 'main',
    event: 'push', status: 'completed', conclusion: 'success' };
  const script = [
    "import { pathToFileURL } from 'node:url';",
    'globalThis.fetch = async (url) => ({',
    "  ok: process.env.MOCK_BASELINE === 'yes',",
    '  json: async () => url.includes(\'/jobs?\')',
    "    ? { jobs: [{ name: 'checks', conclusion: 'success', steps: [{ name: 'CI lint', conclusion: 'success' }] }] }",
    `    : { workflow_runs: [${JSON.stringify(run)}] },`,
    '});',
    'await import(pathToFileURL(process.argv[1]).href);',
  ].join('\n');
  const environment = { ...process.env, npm_execpath: driver, GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: 'pull_request', LINT_EXPECTED_SHA: merge, GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_TOKEN: 'fixture', GITHUB_API_URL: 'https://example.invalid' };
  const runCi = (/** @type {string} */ baseline) => spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, ciScript],
    {
      cwd: f.temporary, env: { ...environment, MOCK_BASELINE: baseline }, encoding: 'utf8', windowsHide: true,
    },
  );
  return { runCi, temporary: f.temporary };
}

test('CI entry rejects lint errors and a failed full fallback using the actual checkout', async (t) => {
  const { runCi, temporary } = await ciEntryFixture(t, (root) => writeFile(
    path.join(root, 'apps/web/题库 测试.js'),
    'var broken = 1; console.log(broken);\n',
  ));
  const incremental = runCi('yes');
  assert.equal(incremental.status, 1, incremental.stderr + incremental.stdout);
  assert.match(incremental.stdout, /CI lint: changed/, incremental.stderr);
  assert.match(incremental.stdout, /no-var/);
  assert.match(incremental.stdout, /^lint:docs$/m);
  assert.doesNotMatch(incremental.stdout, /^lint:css$/m);
  const fallback = runCi('no');
  assert.equal(fallback.status, 1, fallback.stderr + fallback.stdout);
  assert.match(fallback.stdout, /CI lint: full/);
  await writeFile(path.join(temporary, 'apps/web/题库 测试.js'), "console.log('different worktree');\n");
  const dirty = runCi('yes');
  assert.notEqual(dirty.status, 0);
});

test('a CSS-only deletion runs the CSS check once and propagates its failure', async (t) => {
  const { runCi } = await ciEntryFixture(t, (root) => unlink(path.join(root, 'apps/web/styles.css')));
  const result = runCi('yes');
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stdout, /CI lint: changed/);
  assert.deepEqual(result.stdout.split(/\r?\n/).filter((line) => line === 'lint:css'), ['lint:css']);
  assert.match(result.stdout, /^lint:docs$/m);
});

test('changing only the Stylelint suppression baseline requires the full check', async (t) => {
  const { runCi } = await ciEntryFixture(t, (root) => writeFile(
    path.join(root, 'apps/desktop/stylelint-suppressions.json'),
    '{}\n',
  ));
  const result = runCi('yes');
  assert.match(result.stdout, /CI lint: full .*stylelint-suppressions\.json/);
  assert.equal(result.status, 1, result.stderr + result.stdout);
});
