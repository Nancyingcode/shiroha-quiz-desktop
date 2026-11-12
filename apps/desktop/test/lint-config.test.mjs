import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';
import { baseRules, semanticRules, styleRules } from '../eslint.rules.mjs';
import { repositoryFixture } from './lint-fixture-helpers.mjs';

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
  ['no-undef', 'console.log(unknownName);\n'],
  ['eqeqeq', 'console.log(1 == "1");\n'],
  ['no-nested-ternary', 'console.log(true ? 1 : false ? 2 : 3);\n'],
  ['no-param-reassign', 'function change(value) { value = 2; return value; }\nconsole.log(change(1));\n'],
  ['no-eval', 'eval("1");\n'],
  ['no-new-func', 'console.log(new Function("return 1"));\n'],
  ['guard-for-in', 'for (const key in {}) { console.log(key); }\n'],
  ['curly', 'if (true) console.log(1);\n'],
  ['no-new-object', 'console.log(new Object());\n'],
  ['object-shorthand', 'const value = 1; console.log({ value: value });\n'],
  ['no-array-constructor', 'console.log(new Array(1, 2));\n'],
  ['array-callback-return', 'console.log([1].map((value) => { console.log(value); }));\n'],
  ['prefer-rest-params', 'function first() { return arguments[0]; }\nconsole.log(first(1));\n'],
  ['prefer-spread', 'const values = [1, 2]; console.log(Math.max.apply(Math, values));\n'],
  ['prefer-arrow-callback', 'console.log([1].map(function (value) { return value; }));\n'],
  ['no-useless-constructor', 'class Value { constructor() {} }\nconsole.log(Value);\n'],
  ['dot-notation', "console.log(Math['abs'](-1));\n"],
  ['prefer-exponentiation-operator', 'console.log(Math.pow(2, 3));\n'],
  ['no-unneeded-ternary', 'console.log(true ? true : false);\n'],
  ['no-else-return', 'function choose(value) { if (value) { return 1; } else { return 0; } }\nconsole.log(choose(true));\n'],
  ['no-new-wrappers', "console.log(new String('value'));\n"],
  ['radix', "console.log(parseInt('11'));\n"],
  ['no-restricted-globals', 'console.log(isNaN(0));\n'],
  ['no-restricted-globals', 'console.log(isFinite(1));\n'],
  ['prefer-object-spread', 'const source = { value: 1 }; console.log(Object.assign({}, source));\n'],
  ['default-param-last', 'function pick(first = 1, second) { return first + second; }\nconsole.log(pick(1, 2));\n'],
  ['no-multi-assign', 'let first; let second; first = second = 1; console.log(first, second);\n'],
  ['one-var', 'const first = 1, second = 2; console.log(first, second);\n'],
  ['arrow-body-style', 'const next = (value) => { return value + 1; }; console.log(next(1));\n'],
  ['new-cap', 'function value() {}\nconsole.log(new value());\n'],
  ['camelcase', 'const bad_name = 1; console.log(bad_name);\n'],
  ['class-methods-use-this', 'class Example { method() { return 1; } }\nconsole.log(Example);\n'],
  ['prefer-destructuring', 'const source = { value: 1 }; const value = source.value; console.log(value);\n'],
  ['no-use-before-define', 'console.log(value);\nconst value = 1;\n'],
  ['no-loop-func', 'let index = 0; while (index < 2) { setTimeout(() => console.log(index), 0); index += 1; }\n'],
  ['no-plusplus', 'let value = 0; value++; console.log(value);\n'],
  ['prefer-template', "const value = 1; console.log('value: ' + value);\n"],
  ['no-unused-expressions', 'const value = 1;\nvalue;\nconsole.log(value);\n'],
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
  ['@stylistic/array-bracket-newline', 'console.log([1,\n  2,\n]);\n'],
  ['@stylistic/template-curly-spacing', 'console.log(`${ 1 }`);\n'],
  ['@stylistic/wrap-iife', 'const value = function () { return 1; }();\nconsole.log(value);\n'],
  ['@stylistic/implicit-arrow-linebreak', 'console.log([1].map((value) =>\n  value));\n'],
  ['@stylistic/generator-star-spacing', 'function *values() { yield 1; }\nconsole.log(values());\n'],
  ['@stylistic/spaced-comment', '//comment\nconsole.log(1);\n'],
  ['@stylistic/computed-property-spacing', "console.log(Math[ 'abs' ](-1));\n"],
  ['@stylistic/function-call-spacing', 'console.log (1);\n'],
  ['@stylistic/no-trailing-spaces', 'console.log(1);  \n'],
  ['@stylistic/comma-style', 'console.log([\n  1\n  , 2,\n]);\n'],
  ['@stylistic/arrow-spacing', 'console.log([1].map((value)=>value));\n'],
  ['@stylistic/block-spacing', 'if (true) {console.log(1);}\n'],
  ['@stylistic/space-before-function-paren', 'function value () { return 1; }\nconsole.log(value());\n'],
  ['@stylistic/function-paren-newline', 'console.log(\n  1, 2);\n'],
  ['@stylistic/operator-linebreak', 'console.log(1 +\n  2);\n'],
  ['@stylistic/brace-style', 'if (true) {\n  console.log(1);\n}\nelse {\n  console.log(2);\n}\n'],
  ['@stylistic/padded-blocks', 'if (true) {\n\n  console.log(1);\n}\n'],
  ['@stylistic/no-multiple-empty-lines', 'console.log(1);\n\n\nconsole.log(2);\n'],
  ['@stylistic/nonblock-statement-body-position', 'if (true)\n  console.log(1);\n'],
  ['@stylistic/quote-props', "console.log({ 'value': 1 });\n"],
  ['@stylistic/no-confusing-arrow', 'console.log([1].map((value) => value ? 1 : 0));\n'],
  ['@stylistic/no-mixed-operators', 'console.log(1 + 2 * 3);\n'],
  ['@stylistic/object-property-newline', 'const value = {\n  first: 1,\n  second: 2, third: 3,\n};\nconsole.log(value);\n'],
  ['@stylistic/object-curly-newline', 'const {\n  first } = { first: 1 };\nconsole.log(first);\n'],
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

test('desktop ESLint entry rejects the same target violations', async () => {
  const lint = new ESLint({
    cwd: desktop,
    overrideConfigFile: path.join(desktop, 'eslint.config.mjs'),
  });
  for (const [rule, source] of invalidCases) {
    const [result] = await lint.lintText(source, { filePath: 'scripts/new-probe.mjs' });
    assert(result.messages.some((message) => message.ruleId === rule), rule);
  }
});

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

test('callbacks with dynamic this and intentional array lengths remain valid', async () => {
  const source = [
    'const sparse = new Array(3);',
    'const context = { offset: 2 };',
    '[1].forEach(function (value) {',
    '  console.log(this.offset + value);',
    '}, context);',
    'console.log(sparse.length, Number.isNaN(NaN), Number.isFinite(1));',
    "const payload = { question_id: 'sample' };",
    'console.log(payload.question_id);',
    'const list = [1];',
    'const first = list[0];',
    'const renamed = payload.question_id;',
    'console.log(first, renamed);',
    '(function () {',
    "  console.log('wrapped');",
    '}());',
    '',
  ].join('\n');
  for (const filePath of probes) {
    const [result] = await linter().lintText(source, { filePath });
    assert.equal(result.errorCount + result.warningCount, 0, JSON.stringify(result.messages));
  }
});

test('definition order rejects immediate reads but permits delayed closures and hoisted functions', async () => {
  const lint = linter();
  const filePath = probes[0];
  for (const source of [
    'const result = (() => value)();\nconst value = 1;\nconsole.log(result, value);\n',
    'class Example { static value = later; }\nconst later = 1;\nconsole.log(Example, later);\n',
  ]) {
    const [result] = await lint.lintText(source, { filePath });
    assert(result.messages.some((message) => message.ruleId === 'no-use-before-define'));
  }
  const delayed = [
    'const read = () => value;',
    'const value = 1;',
    'console.log(read(), declared());',
    'function declared() { return value; }',
    '',
  ].join('\n');
  const [result] = await lint.lintText(delayed, { filePath });
  assert.equal(result.errorCount + result.warningCount, 0, JSON.stringify(result.messages));
});

test('loop callbacks may capture per-iteration bindings and live state objects', async () => {
  const source = [
    'const state = { current: 1 };',
    'for (const value of [1, 2]) {',
    '  setTimeout(() => console.log(value, state.current), 0);',
    '}',
    '',
  ].join('\n');
  const [result] = await linter().lintText(source, { filePath: probes[0] });
  assert.equal(result.errorCount + result.warningCount, 0, JSON.stringify(result.messages));
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

test('browser callback and application state globals stay limited to their test files', async () => {
  const lint = linter();
  const source = 'console.log(window, document, state, practiceSession);\n';
  const [harness] = await lint.lintText(source, { filePath: 'test/web-ai-practice/harness.cjs' });
  assert.equal(harness.errorCount + harness.warningCount, 0, JSON.stringify(harness.messages));
  const [runner] = await lint.lintText(source, { filePath: 'test/web-ai-practice/runner.cjs' });
  assert.equal(runner.messages.filter((message) => message.ruleId === 'no-undef').length, 4);
});

test('handwritten JavaScript under the Tauri project is checked while generated files stay excluded', async () => {
  const lint = linter();
  const source = 'var value = 1; console.log(value);\n';
  const filePath = 'apps/desktop/src-tauri/new-probe.js';
  assert.equal(await lint.isPathIgnored(path.join(root, filePath)), false);
  const [result] = await lint.lintText(source, { filePath });
  assert(result.messages.some((message) => message.ruleId === 'no-var'));
  for (const generated of ['apps/desktop/src-tauri/target/probe.js', 'apps/desktop/src-tauri/gen/probe.js']) {
    assert.equal(await lint.isPathIgnored(path.join(root, generated)), true);
  }
});

test('all discovered handwritten JavaScript keeps every target rule at error severity', async () => {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(listed.status, 0, listed.stderr);
  const lint = linter();
  const rules = Object.keys({ ...baseRules, ...semanticRules, ...styleRules });
  let checked = 0;
  for (const file of listed.stdout.split('\0').filter((name) => /\.(?:js|mjs|cjs)$/i.test(name))) {
    const target = path.join(root, file);
    if (await lint.isPathIgnored(target)) { continue; }
    const config = await lint.calculateConfigForFile(target);
    assert(config, file);
    for (const rule of rules) {
      assert.equal(config.rules?.[rule]?.[0], 2, `${file}: ${rule}`);
    }
    checked += 1;
  }
  assert(checked > 0);
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

test('object and destructuring layout rules apply to every handwritten file', async () => {
  const lint = linter();
  for (const filePath of [
    'apps/web/ai-import-panel.js',
    'apps/web/ai-question-panels.js',
    'apps/web/ai-settings.js',
  ]) {
    for (const [rule, source] of [
      ['@stylistic/object-property-newline', 'const value = {\n  first: 1,\n  second: 2, third: 3,\n};\nconsole.log(value);\n'],
      ['@stylistic/object-curly-newline', 'const {\n  first } = { first: 1 };\nconsole.log(first);\n'],
    ]) {
      const [result] = await lint.lintText(source, { filePath });
      assert(result.messages.some((message) => message.ruleId === rule), `${filePath}: ${rule}`);
    }
  }
  // 全局启用后，作用域外的存量文件同样命中规则。
  const [outside] = await lint.lintText(
    'const value = {\n  first: 1,\n  second: 2, third: 3,\n};\nconsole.log(value);\n',
    { filePath: 'apps/web/training.js' },
  );
  assert(outside.messages.some((message) => message.ruleId === '@stylistic/object-property-newline'));
});

test('statement-per-line pilot covers zero-hit modules without affecting other files', async () => {
  const lint = linter();
  const source = 'const first = 1; const second = 2;\nconsole.log(first, second);\n';
  for (const filePath of ['apps/web/quiz-core.js', 'apps/web/training.js', 'apps/web/practice-selection.js']) {
    const [result] = await lint.lintText(source, { filePath });
    assert(result.messages.some((message) => message.ruleId === '@stylistic/max-statements-per-line'), filePath);
  }
  const [outside] = await lint.lintText(source, { filePath: 'apps/web/bank-page.js' });
  assert.equal(
    outside.messages.filter((message) => message.ruleId === '@stylistic/max-statements-per-line').length,
    0,
  );
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

test('new mixed-case paths do not inherit file-specific globals or exclusions', async () => {
  const lint = linter();
  for (const [filePath, source] of [
    ['apps/web/app.JS', 'console.log(ShirohaPlatform);\n'],
    ['apps/desktop/scripts/smoke.MJS', 'console.log(window.location, document.title);\n'],
    ['test/web-ai-practice/harness.CjS', 'console.log(state, practiceSession, sessionStorage);\n'],
  ]) {
    const [result] = await lint.lintText(source, { filePath });
    assert(result.messages.some((message) => message.ruleId === 'no-undef'), filePath);
  }
  const [bridge] = await lint.lintText("import path from 'node:path';\nconsole.log(path);\n", {
    filePath: 'apps/desktop/frontend/bridge.Js',
  });
  assert(bridge.messages.some((message) => message.fatal));
  assert.equal(await lint.isPathIgnored(path.join(root, 'apps/web/question-bank.JS')), false);
});

test('app.js enforces the full target rules and incremental CLI does not rewrite it', async (t) => {
  const f = await repositoryFixture(t);
  const app = path.join(f.temporary, 'apps/web/app.js');
  const lint = linter();
  for (const [rule, source] of invalidCases) {
    const [result] = await lint.lintText(source, { filePath: 'apps/web/app.js' });
    assert(result.messages.some((message) => message.ruleId === rule), rule);
  }
  const invalid = 'var value = 1; console.log(value);\n';
  await writeFile(app, invalid);
  const rejected = f.run('lint-incremental.mjs');
  assert.equal(rejected.status, 1, rejected.stderr + rejected.stdout);
  assert.match(rejected.stdout, /no-var/);
  assert.equal(await readFile(app, 'utf8'), invalid);
  await writeFile(app, "console.log('valid');\n");
  const accepted = f.run('lint-incremental.mjs');
  assert.equal(accepted.status, 0, accepted.stderr + accepted.stdout);
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
  'apps/web/platform/save-queue.js',
  'apps/desktop/frontend/adapter.js',
  'apps/desktop/scripts/lint-platform.mjs',
  'apps/desktop/scripts/smoke.mjs',
  'test/dual-platform/ai-harness.test.cjs',
]) {
  test(`graduated target rejects all applicable violations: ${filePath}`, async () => {
    const lint = linter();
    for (const [rule, source] of invalidCases) {
      const [result] = await lint.lintText(source, { filePath });
      assert(result.messages.some((message) => message.ruleId === rule), `${filePath}: ${rule}`);
    }
  });
}
