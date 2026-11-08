import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repositoryFixture } from './lint-fixture-helpers.mjs';
test('fixture repositories ignore Git hook repository variables', async (t) => {
  const tempRoot = await realpath(os.tmpdir());
  const decoy = await mkdtemp(path.join(tempRoot, 'shiroha-hook-decoy-'));
  t.after(async () => {
    const actual = await realpath(decoy);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith('shiroha-hook-decoy-'));
    await rm(actual, { recursive: true, force: true });
  });
  const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const init = spawnSync('git', ['init'], { cwd: decoy, env: cleanEnvironment, encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr);
  const hookEnvironment = { ...cleanEnvironment, GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy };
  const fixture = await repositoryFixture(t, hookEnvironment);
  const probe = path.join(fixture.temporary, 'test/new-slice/probe.cjs');
  await writeFile(probe, 'console.log("invalid");\n');
  const result = fixture.run('lint-incremental.mjs');
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stdout, /@stylistic\/quotes/);
  const bare = spawnSync('git', ['config', '--local', '--get', 'core.bare'], {
    cwd: decoy, env: cleanEnvironment, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(bare.stdout.trim(), 'false');
});

test('incremental CLI finds untracked code outside the old scopes and reads complete files without rewriting', async (t) => {
  const f = await repositoryFixture(t);
  const probe = path.join(f.temporary, 'test/new-slice/probe.cjs');
  const invalid = 'console.log(1);\nconsole.log("new violation");\n';
  await writeFile(probe, invalid);
  const rejected = f.run('lint-incremental.mjs');
  assert.ifError(rejected.error);
  assert.equal(rejected.status, 1, rejected.stderr + rejected.stdout);
  assert.match(rejected.stdout, /@stylistic\/quotes/);
  assert.equal(await readFile(probe, 'utf8'), invalid);
  await writeFile(probe, "console.log('valid');\n");
  const valid = f.run('lint-incremental.mjs');
  assert.equal(valid.status, 0, valid.stderr + valid.stdout);
  assert.match(valid.stdout, /Checked 7 complete/);
});

test('incremental CLI skips deleted tracked files while checking the remaining worktree', async (t) => {
  const f = await repositoryFixture(t);
  const deleted = path.join(f.temporary, 'apps/web/removed.js');
  await writeFile(deleted, "console.log('tracked');\n");
  const added = f.git(['add', 'apps/web/removed.js']);
  assert.equal(added.status, 0, added.stderr);
  await unlink(deleted);
  const clean = f.run('lint-incremental.mjs');
  assert.equal(clean.status, 0, clean.stderr + clean.stdout);
  const renamed = path.join(f.temporary, 'apps/web/renamed.js');
  await writeFile(renamed, 'var value = 1; console.log(value);\n');
  const rejected = f.run('lint-incremental.mjs');
  assert.equal(rejected.status, 1, rejected.stderr + rejected.stdout);
  assert(rejected.stdout.includes(renamed));
  assert.match(rejected.stdout, /no-var/);
});
