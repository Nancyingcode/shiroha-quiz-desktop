import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(desktop, '../..');

function linter() {
  return new ESLint({
    cwd: root,
    overrideConfigFile: path.join(desktop, 'eslint.platform.config.mjs'),
  });
}

const probes = [
  'apps/desktop/scripts/new-probe.mjs',
  'test/dual-platform/new-probe.cjs',
  'apps/web/platform/new-probe.js',
  'apps/desktop/eslint.config.mjs',
  'apps/desktop/new-probe.js',
  'test/new-probe.js',
];

const invalidCases = [
  ['no-var', 'var value = 1; console.log(value);\n'],
  ['prefer-const', 'let value = 1; console.log(value);\n'],
  ['no-unused-vars', 'const unused = 1;\n'],
  ['eqeqeq', 'console.log(1 == "1");\n'],
  ['no-nested-ternary', 'console.log(true ? 1 : false ? 2 : 3);\n'],
  ['no-param-reassign', 'function change(value) { value = 2; return value; }\nconsole.log(change(1));\n'],
  ['no-eval', 'eval("1");\n'],
  ['no-new-func', 'console.log(new Function("return 1"));\n'],
  ['guard-for-in', 'for (const key in {}) { console.log(key); }\n'],
  ['curly', 'if (true) console.log(1);\n'],
  ['@stylistic/indent', 'if (true) {\n console.log(1);\n}\n'],
  ['@stylistic/quotes', 'console.log("double");\n'],
  ['@stylistic/semi', "console.log('missing')\n"],
  ['@stylistic/comma-dangle', 'console.log({\n  value: 1\n});\n'],
  ['@stylistic/arrow-parens', 'console.log([1].map(value => value));\n'],
  ['@stylistic/space-infix-ops', 'console.log(1+2);\n'],
  ['@stylistic/keyword-spacing', 'if(true) { console.log(1); }\n'],
  ['@stylistic/comma-spacing', 'console.log(1,2);\n'],
  ['@stylistic/key-spacing', 'console.log({ value :1 });\n'],
  ['@stylistic/object-curly-spacing', 'console.log({value: 1});\n'],
  ['@stylistic/array-bracket-spacing', 'console.log([ 1 ]);\n'],
  ['@stylistic/space-in-parens', 'console.log( 1 );\n'],
  ['@stylistic/eol-last', 'console.log(1);'],
  ['@stylistic/space-before-blocks', 'if (true){ console.log(1); }\n'],
];

for (const filePath of probes) {
  test(`full target rejects violations in new ${path.extname(filePath)} files`, async () => {
    const lint = linter();
    for (const [rule, source] of invalidCases) {
      const [result] = await lint.lintText(source, { filePath });
      assert(result.messages.some((message) => message.ruleId === rule), `${filePath}: ${rule}`);
    }
  });
}

test('project exceptions pass all three runtimes with no warnings', async () => {
  const source = [
    'function update(state, value) {',
    '  state.value = value == null ? 0 : value;',
    '  return state;',
    '}',
    'for (const value of [1, 2]) {',
    '  console.log(update({}, value));',
    '}',
    '',
  ].join('\n');
  for (const filePath of probes) {
    const [result] = await linter().lintText(source, { filePath });
    assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
    assert.equal(result.warningCount, 0);
  }
});

test('Node ESM, CommonJS and classic scripts keep separate readonly globals', async () => {
  for (const [filePath, valid, invalid] of [
    [probes[0], "import path from 'node:path';\nconsole.log(path.sep, process.pid);\n", 'window.alert(1);\n'],
    [probes[1], "const path = require('node:path');\nmodule.exports = path.sep;\n", 'window.alert(1);\n'],
    [probes[2], '(function () {\n  window.document.title = document.title;\n}());\n', 'console.log(process.pid);\n'],
  ]) {
    const lint = linter();
    const [accepted] = await lint.lintText(valid, { filePath });
    assert.equal(accepted.errorCount + accepted.warningCount, 0, JSON.stringify(accepted.messages));
    const [rejected] = await lint.lintText(invalid, { filePath });
    assert(rejected.messages.some((message) => message.ruleId === 'no-undef'));
    const name = filePath.endsWith('.js') ? 'window' : 'process';
    const [readonly] = await lint.lintText(`${name} = {};\n`, { filePath });
    assert(readonly.messages.some((message) => message.ruleId === 'no-global-assign'));
  }
  const [esmInScript] = await linter().lintText('export const value = 1;\n', { filePath: probes[2] });
  assert(esmInScript.messages.some((message) => message.fatal));
});

test('duplicate ESM imports are rejected while explicit extensions and named exports pass', async () => {
  const lint = linter();
  const filePath = probes[0];
  const [invalid] = await lint.lintText(
    "import path from 'node:path';\nimport { sep } from 'node:path';\nconsole.log(path, sep);\n",
    { filePath },
  );
  assert(invalid.messages.some((message) => message.ruleId === 'no-duplicate-imports'));
  const [valid] = await lint.lintText(
    "export { markNativeIsolation } from './native-isolation.mjs';\n",
    { filePath },
  );
  assert.equal(valid.errorCount + valid.warningCount, 0);
});

test('clean semantic and formatting rules remain blocking across complete legacy files', async () => {
  for (const filePath of ['apps/web/training.js', 'apps/desktop/scripts/prepare-web.mjs']) {
    for (const [rule, source] of invalidCases.filter(([rule]) => [
      'no-var', 'prefer-const', 'no-unused-vars', 'eqeqeq', 'no-eval', 'no-new-func', 'guard-for-in',
      '@stylistic/quotes', '@stylistic/comma-dangle', '@stylistic/eol-last',
    ].includes(rule))) {
      const [result] = await linter().lintText(source, { filePath });
      assert(result.messages.some((message) => message.ruleId === rule), `${filePath}: ${rule}`);
    }
  }
});

test('the bundled bridge source stays ESM while browser scripts reject import declarations', async () => {
  const source = "import { invoke } from '@tauri-apps/api/core';\nconsole.log(invoke);\n";
  const [bridge] = await linter().lintText(source, { filePath: 'apps/desktop/frontend/bridge.js' });
  assert.equal(bridge.errorCount + bridge.warningCount, 0);
  const [classic] = await linter().lintText(source, { filePath: probes[2] });
  assert(classic.messages.some((message) => message.fatal));
});

/** @param {import('node:test').TestContext} t */
async function repositoryFixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shiroha lint fixture-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, 'apps/desktop');
  await mkdir(path.join(project, 'scripts'), { recursive: true });
  await mkdir(path.join(temporary, 'apps/web'), { recursive: true });
  await mkdir(path.join(temporary, 'test/new-slice'), { recursive: true });
  for (const name of ['eslint.rules.mjs', 'eslint.migration.mjs', 'eslint.platform.config.mjs']) {
    await copyFile(path.join(desktop, name), path.join(project, name));
  }
  for (const name of ['lint-incremental.mjs', 'lint-debt.mjs']) {
    await copyFile(path.join(desktop, 'scripts', name), path.join(project, 'scripts', name));
  }
  await symlink(path.join(desktop, 'node_modules'), path.join(project, 'node_modules'), 'junction');
  const init = spawnSync('git', ['init'], { cwd: temporary, encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr);
  const run = (/** @type {string} */ script, /** @type {string[]} */ args = []) => spawnSync(
    process.execPath, [path.join(project, 'scripts', script), ...args],
    { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true },
  );
  return { temporary, run };
}

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
  assert.match(valid.stdout, /Checked 6 complete/);
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

test('plain .js Node files follow their package runtime without leaking globals into browser scripts', async () => {
  for (const [filePath, valid, invalid] of [
    ['apps/desktop/new-probe.js', "import path from 'node:path';\nconsole.log(path.sep);\n", 'console.log(require);\n'],
    ['test/new-probe.js', "const path = require('node:path');\nmodule.exports = [path.sep, __dirname];\n", 'window.alert(1);\n'],
  ]) {
    const [accepted] = await linter().lintText(valid, { filePath });
    assert.equal(accepted.errorCount + accepted.warningCount, 0, JSON.stringify(accepted.messages));
    const [rejected] = await linter().lintText(invalid, { filePath });
    assert(rejected.messages.some((message) => message.ruleId === 'no-undef'));
  }
  const [browser] = await linter().lintText('console.log(process.pid, require);\n', { filePath: probes[2] });
  assert.equal(browser.messages.filter((message) => message.ruleId === 'no-undef').length, 2);
});

for (const filePath of [
  'apps/web/training.js',
  'apps/web/platform/index.js',
  'apps/desktop/scripts/lint-platform.mjs',
]) {
  test(`graduated target rejects all applicable violations: ${filePath}`, async () => {
    const lint = linter();
    for (const [rule, source] of invalidCases) {
      const [result] = await lint.lintText(source, { filePath });
      assert(result.messages.some((message) => message.ruleId === rule), `${filePath}: ${rule}`);
    }
  });
}
