import assert from 'node:assert/strict';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repositoryFixture } from './lint-fixture-helpers.mjs';

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
