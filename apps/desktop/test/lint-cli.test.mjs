import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { repositoryFixture } from './lint-fixture-helpers.mjs';
test('incremental CLI rejects violations in formerly excluded handwritten scripts', async (t) => {
  const f = await repositoryFixture(t);
  const files = [
    'test/codebuddy-cli-stdio/container-relay-fixture.mjs',
    'test/codebuddy-cli-stdio/guard.mjs',
    'test/codebuddy-cli-stdio/guard.test.mjs',
    'test/codebuddy-cli-stdio/probe.mjs',
    'test/codebuddy-cli-stdio/verify-guarded.mjs',
    'test/codebuddy-cli-stdio/verify.mjs',
    'test/web-ai-practice/cases.cjs',
    'test/web-ai-practice/dialogs.cjs',
    'test/web-ai-practice/fixtures.cjs',
    'test/web-ai-practice/harness.cjs',
    'test/web-ai-practice/runner.cjs',
    'test/web-ai-practice/saved-analysis.cjs',
    'test/web-ai-practice/submit-modes.cjs',
    'test/web-ai-practice/wrong-analysis.cjs',
    'test/web-webdav/request.test.cjs',
  ];
  const invalid = 'var value = 1; console.log(value);\n';
  for (const file of files) {
    const target = path.join(f.temporary, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, invalid);
  }
  const rejected = f.run('lint-incremental.mjs');
  assert.equal(rejected.status, 1, rejected.stderr + rejected.stdout);
  for (const file of files) {
    const target = path.join(f.temporary, file);
    assert(rejected.stdout.includes(target), file);
    assert.equal(await readFile(target, 'utf8'), invalid);
  }
});

test('debt CLI reports rule locations but rejects missing files and syntax failures', async (t) => {
  const f = await repositoryFixture(t);
  const probe = path.join(f.temporary, 'apps/web/app.js');
  const debt = 'function update(value) { value = 2; return value; }\n';
  await writeFile(probe, debt);
  const reported = f.run('lint-debt.mjs', ['--file', 'apps/web/app.js']);
  assert.equal(reported.status, 0, reported.stderr);
  const report = JSON.parse(reported.stdout);
  assert.equal(report.files[0].counts['no-param-reassign'], 1);
  assert.equal(report.files[0].diagnostics[0].line, 1);
  assert.equal(await readFile(probe, 'utf8'), debt);
  await writeFile(probe, 'function (');
  const syntax = f.run('lint-debt.mjs', ['--file', 'apps/web/app.js']);
  assert.equal(syntax.status, 1);
  assert.match(syntax.stderr, /Parsing error/);
  const missing = f.run('lint-debt.mjs', ['--file', 'apps/web/missing.js']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No files matching/);
});

test('debt CLI reports an empty list when all historical rules have graduated', async (t) => {
  const f = await repositoryFixture(t);
  const migration = path.join(f.temporary, 'apps/desktop/eslint.migration.mjs');
  await writeFile(migration, [
    'export const styleDebt = {};',
    'export const semanticDebt = {};',
    'export const legacyStyleFiles = [];',
    '',
  ].join('\n'));
  const reported = f.run('lint-debt.mjs');
  assert.equal(reported.status, 0, reported.stderr);
  assert.deepEqual(JSON.parse(reported.stdout).files, []);
});
