import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repositoryFixture } from './lint-fixture-helpers.mjs';

test('incremental CLI checks mixed-case JavaScript extensions in each runtime', async (t) => {
  const f = await repositoryFixture(t);
  const commonJsValid = "const path = require('node:path');\nmodule.exports = path.sep;\n";
  const cases = [
    ['apps/web/new.JS', 'console.log(window.location.href);\n'],
    ['apps/web/question-bank.JS', 'console.log(window.location.href);\n'],
    ['apps/desktop/scripts/new.MjS', "import path from 'node:path';\nconsole.log(path.sep, process.pid);\n"],
    ['test/new-slice/new.CjS', commonJsValid],
  ];
  for (const [file] of cases) {
    await writeFile(path.join(f.temporary, file), 'var value = 1; console.log(value);\n');
  }
  const rejected = f.run('lint-incremental.mjs');
  assert.equal(rejected.status, 1, rejected.stderr + rejected.stdout);
  for (const [file, valid] of cases) {
    assert(rejected.stdout.includes(path.join(f.temporary, file)), file);
    await writeFile(path.join(f.temporary, file), valid);
  }
  const clean = f.run('lint-incremental.mjs');
  assert.equal(clean.status, 0, clean.stderr + clean.stdout);
  const commonJs = path.join(f.temporary, 'test/new-slice/new.CjS');
  await writeFile(commonJs, 'function change(value) { value = 2; return value; }\n');
  const debt = f.run('lint-debt.mjs', ['--file', 'test/new-slice/new.CjS']);
  assert.equal(debt.status, 0, debt.stderr);
  assert.equal(JSON.parse(debt.stdout).files[0].counts['no-param-reassign'], 1);
  await writeFile(commonJs, commonJsValid);
  await writeFile(path.join(f.temporary, 'apps/web/new.JS'), 'console.log(process.pid);\n');
  const wrongRuntime = f.run('lint-incremental.mjs');
  assert.equal(wrongRuntime.status, 1, wrongRuntime.stderr + wrongRuntime.stdout);
  assert.match(wrongRuntime.stdout, /no-undef/);
});
