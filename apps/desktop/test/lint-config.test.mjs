import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';
import { baseRules, semanticRules, styleRules } from '../eslint.rules.mjs';
import { readabilityReportRules } from '../eslint.readability.mjs';
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

test('readability pilot counts code lines and accepts comments tied to their definitions', async () => {
  const filename = 'apps/web/training.js';
  const lint = linter();
  const source = [
    'function short() {',
    '  const a = 1;',
    '',
    '  // 空行和注释不计入函数长度。',
    '  const b = {',
    '    value: 2,',
    '  };',
    '}',
    '',
    '/** @returns {number} */',
    'function long() {',
    '  const a = 1;',
    '  const b = 2;',
    '  const c = 3;',
    '  return a + b + c;',
    '}',
    '',
    'const rules = {',
    '  // 汇总导入选项的匹配值。',
    '  read() {',
    '    const a = 1;',
    '    const b = 2;',
    '    const c = 3;',
    '    return a + b + c;',
    '  },',
    '};',
  ].join('\n');
  const [pilot] = await lint.lintText(source, { filePath: filename });
  const [outsideWeb] = await lint.lintText(source, { filePath: 'test/readability-probe.js' });
  const hits = (/** @type {ESLint.LintResult} */ result) => result.messages
    .filter(({ ruleId }) => ruleId === 'readability/explain-function').map(({ line }) => line);
  assert.deepEqual(hits(pilot), [11]);
  assert.deepEqual(hits(outsideWeb), []);
});

test('readability rule locates regexp literals and global constructors', async () => {
  const [result] = await linter().lintText([
    'const base = 1; // 这条说明属于前一行。',
    'const matcher = /x/;',
    '// 用运行时输入构造精确匹配。',
    'const configured = new RegExp(input);',
    'const missing = RegExp(input);',
    'function build(RegExp) {',
    '  return new RegExp(input);',
    '}',
    '',
    '// 说明只覆盖第一个模式。',
    'const pair = [/x/, /y/];',
  ].join('\n'), { filePath: 'apps/web/training.js' });
  const matches = result.messages.filter(({ ruleId }) => ruleId === 'readability/explain-regexp');
  assert.deepEqual(matches.map(({ line }) => line), [2, 5, 11]);
});

test('readability gate checks all tracked Web modules in the lint scope', async () => {
  const lint = linter();
  const source = 'function testPattern(value) {\n  return /x/.test(value);\n}\nconsole.log(testPattern(1));\n';
  const listed = spawnSync('git', ['ls-files', '-z', '--', 'apps/web'], { cwd: root, encoding: 'utf8' });
  assert.ifError(listed.error);
  assert.equal(listed.status, 0, listed.stderr);
  const matches = (/** @type {ESLint.LintResult} */ result) => result.messages
    .filter(({ ruleId }) => ruleId && Object.hasOwn(readabilityReportRules, ruleId))
    .map(({ ruleId }) => ruleId);
  let checked = 0;
  for (const filePath of listed.stdout.split('\0').filter((file) => /\.(?:js|mjs|cjs)$/i.test(file))) {
    if (await lint.isPathIgnored(filePath)) {
      continue;
    }
    const [adopted] = await lint.lintText(source, { filePath });
    assert.deepEqual(matches(adopted), ['readability/explain-regexp', '@stylistic/padding-line-between-statements'], filePath);
    checked += 1;
  }
  assert(checked > 0);
  const [outsideWeb] = await lint.lintText(source, { filePath: 'test/readability-probe.js' });
  assert.deepEqual(matches(outsideWeb), []);
});

test('readability padding respects complete statements and leading comments', async () => {
  const lint = linter();
  const [result] = await lint.lintText([
    'if (valid) {',
    '  run();',
    '} else {',
    '  cancel();',
    '}',
    '// 记录操作结果。',
    'save();',
    'try {',
    '  run();',
    '} catch (error) {',
    '  cancel(error);',
    '} finally {',
    '  close();',
    '}',
    'const read = () => 1;',
    'run();',
    'rows.forEach((row) => save(row));',
    'run();',
    'class Builder {',
    '  create() {}',
    '  close() {}',
    '}',
    'const options = {',
    '  read() {},',
    '  write() {},',
    '};',
  ].join('\n'), { filePath: 'apps/web/training.js' });
  const matches = result.messages.filter(({ ruleId }) => ruleId && Object.hasOwn(readabilityReportRules, ruleId));
  assert.deepEqual(matches.map(({ line }) => line), [7, 15, 16, 18, 21, 25]);
  assert(matches.every(({ fix }) => fix));
});

test('readability report is read-only and counts long blocks at the boundary', async (t) => {
  const f = await repositoryFixture(t);
  const file = 'apps/web/app.js';
  const full = path.join(f.temporary, file);
  const lines = Array.from({ length: 20 }, () => '  console.log(1);');
  const source = ['if (true) {', ...lines, '}', 'if (true) {', ...lines, '  console.log(2);', '}', ''].join('\n');
  await writeFile(full, source);
  const recorded = f.run('lint-incremental.mjs', ['--readability-report']);
  assert.equal(recorded.status, 0, recorded.stderr + recorded.stdout);
  const files = /** @type {{file: string, diagnostics: {ruleId: string, line: number}[]}[]} */ (
    JSON.parse(recorded.stdout)
  );
  const blockHits = files.find((entry) => entry.file === file)?.diagnostics
    .filter(({ ruleId }) => ruleId === 'readability/review-long-block');
  assert.deepEqual(blockHits?.map(({ line }) => line), [23]);
  assert.equal(await readFile(full, 'utf8'), source);
});

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
  ['prefer-promise-reject-errors', 'Promise.reject(0);\n'],
  ['no-promise-executor-return', 'console.log(new Promise((resolve) => setTimeout(resolve, 0)));\n'],
  ['no-return-await', 'async function read() { return await Promise.resolve(1); }\nconsole.log(read());\n'],
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
  ['@stylistic/curly-newline', 'function print() { console.log(1); }\nprint();\n'],
  ['@stylistic/exp-list-style', 'const { a, b, c, d } = console;\nconsole.log(a, b, c, d);\n'],
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
    'function declared() {',
    '  return value;',
    '}',
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

test('module graph checks reject unresolved imports and accept resolvable ones', async () => {
  const lint = linter();
  const filePath = 'apps/desktop/scripts/graph-probe.mjs';
  const [unresolved] = await lint.lintText(
    "import missing from './definitely-missing.mjs';\nconsole.log(missing);\n",
    { filePath },
  );
  assert(unresolved.messages.some((message) => message.ruleId === 'import-x/no-unresolved'));
  const [resolved] = await lint.lintText(
    "import path from 'node:path';\nimport { createConfig } from '../eslint.rules.mjs';\nconsole.log(path.sep, createConfig);\n",
    { filePath },
  );
  assert.equal(resolved.errorCount + resolved.warningCount, 0, JSON.stringify(resolved.messages));
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

test('function body layout expands nonempty bodies and accepts empty bodies and expression arrows', async () => {
  const lint = linter();
  const filePath = probes[0];
  for (const source of [
    'const obj = { save() { return this.value; } };',
    'class Store { save() { return this.value; } }',
    'const read = function () { return this.value; };',
    'const print = (value) => { console.log(value); };',
  ]) {
    const [result] = await lint.lintText(source, { filePath });
    assert(result.messages.some((message) => message.ruleId === '@stylistic/curly-newline'), source);
  }
  const [valid] = await lint.lintText(
    'function noop() {}\nconst id = (item) => item.id;\nif (id) { noop(); }\n',
    { filePath },
  );
  assert.equal(valid.errorCount, 0, JSON.stringify(valid.messages));
});

test('object destructuring wraps four bindings and preserves other short lists', async () => {
  const lint = linter();
  const filePath = probes[0];
  const rule = '@stylistic/exp-list-style';
  for (const source of [
    'function print({ a, b: renamed, c = 1, ...rest }) {}',
    'const { outer: { a, b, c, d } } = console;',
    'const {\n  a, b,\n  c,\n  d,\n} = console;',
  ]) {
    const [result] = await lint.lintText(source, { filePath });
    assert(result.messages.some((message) => message.ruleId === rule), source);
  }
  const valid = [
    'const obj = { a: 1, b: 2, c: 3, d: 4 };',
    'const { a, b, c } = obj;',
    'const [first, second, third, fourth] = [a, b, c, obj.d];',
    'console.log(first, second, third, fourth);',
    '',
  ].join('\n');
  const [result] = await lint.lintText(valid, { filePath });
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});

test('line length pilot accepts 120 characters and rejects 121 in selected modules', async () => {
  const lint = linter();
  const rule = '@stylistic/max-len';
  const atLimit = `console.log('${'a'.repeat(104)}');`;
  assert.equal(atLimit.length, 120);
  const overLimit = atLimit.replace('aaa', 'aaaa');
  const source = [
    atLimit,
    overLimit,
    `// ${'a'.repeat(120)}`,
    `console.log('https://example.invalid/${'a'.repeat(120)}');`,
    `console.log(/${'a'.repeat(120)}/);`,
    '',
  ].join('\n');
  const desktopLint = new ESLint({
    cwd: desktop,
    overrideConfigFile: path.join(desktop, 'eslint.config.mjs'),
  });
  for (const filePath of [
    'apps/web/quiz-core.js', 'apps/web/text-answers.js', 'apps/web/training.js',
    'apps/web/study-sessions.js', 'apps/web/zip.js', 'apps/web/platform/index.js',
    'apps/web/platform/save-queue.js', 'apps/desktop/frontend/bridge.js',
    'apps/desktop/commitlint.config.mjs', 'apps/desktop/eslint.config.mjs',
    'apps/desktop/eslint.migration.mjs', 'apps/desktop/eslint.platform.config.mjs',
    'apps/desktop/eslint.rules.mjs', 'apps/desktop/stylelint.config.mjs',
    'apps/desktop/scripts/check-docs.mjs', 'apps/desktop/scripts/lint-debt.mjs',
    'apps/desktop/scripts/lint-incremental.mjs', 'apps/desktop/scripts/lint-index.mjs',
    'apps/desktop/scripts/lint-platform.mjs', 'apps/desktop/scripts/lint-runner.mjs',
    'apps/desktop/scripts/native-isolation.mjs', 'apps/desktop/scripts/smoke-control.mjs',
    'apps/desktop/test/benchmark.test.mjs', 'apps/desktop/test/check-docs.test.mjs',
    'apps/desktop/test/distribution.test.mjs', 'apps/desktop/test/installer-integrity.test.mjs',
    'apps/desktop/test/lint-cli.test.mjs', 'apps/desktop/test/lint-deleted-worktree.test.mjs',
    'apps/desktop/test/lint-mixed-extensions.test.mjs', 'apps/desktop/test/lint-runner.test.mjs',
    'apps/desktop/test/lint-suppressions.test.mjs', 'apps/desktop/test/lint-worktree.test.mjs',
    'apps/desktop/test/platform-checks.test.mjs', 'apps/desktop/test/titlebar.test.mjs',
    'apps/web/backup-archive.js',
    'test/codebuddy-cli-stdio/container-relay-fixture.mjs', 'test/codebuddy-cli-stdio/guard.mjs',
    'test/codebuddy-cli-stdio/verify.mjs', 'test/dual-platform/ai-fixed-bindings.test.cjs',
    'test/dual-platform/ai-settings-helper.cjs', 'test/dual-platform/ai-transport-helper.cjs',
    'test/dual-platform/backup-core.test.cjs', 'test/dual-platform/backup-entry-performance.test.cjs',
    'test/dual-platform/css-computed-style.cjs', 'test/dual-platform/desktop-inline-events.test.cjs',
    'test/dual-platform/document-lifecycle.test.cjs', 'test/dual-platform/document-page.cjs',
    'test/dual-platform/exit.test.cjs', 'test/dual-platform/import-lifecycle.test.cjs',
    'test/dual-platform/import-ownership.test.cjs', 'test/dual-platform/json-import.test.cjs',
    'test/dual-platform/pagination.test.cjs', 'test/dual-platform/parser-risk-performance.test.cjs',
    'test/dual-platform/platform-index.test.cjs', 'test/dual-platform/question-view.test.cjs',
    'test/dual-platform/quiz-core.test.cjs', 'test/dual-platform/source-tools.cjs',
    'test/dual-platform/styles.cjs', 'test/dual-platform/text-answers.test.cjs',
    'test/dual-platform/text-parser-cases.cjs', 'test/dual-platform/training-characterization.test.cjs',
    'test/web-ai-practice/dialogs.cjs', 'test/web-ai-practice/submit-modes.cjs',
    'test/web-ai-practice/training-review-analysis.cjs', 'test/web-webdav/request.test.cjs',
    'apps/desktop/frontend/titlebar.js', 'apps/desktop/scripts/lint-ci.mjs',
    'apps/desktop/scripts/release-github.mjs', 'apps/desktop/test/lint-fixture-helpers.mjs',
    'apps/web/backup-core.js', 'test/codebuddy-cli-stdio/guard.test.mjs',
    'test/codebuddy-cli-stdio/verify-guarded.mjs', 'test/dual-platform/ai-connection.test.cjs',
    'test/dual-platform/circled-stem.test.cjs', 'test/dual-platform/due-review.test.cjs',
    'apps/desktop/test/config.test.mjs', 'apps/web/ai-transport.js', 'apps/web/platform/browser.js',
    'test/dual-platform/document-formats.test.cjs', 'test/dual-platform/table-import.test.cjs',
    'test/dual-platform/text-parser.test.cjs', 'test/web-ai-practice/saved-analysis.cjs',
    'apps/desktop/scripts/installer-integrity.mjs', 'apps/desktop/test/lint-ci.test.mjs',
    'apps/desktop/test/lint-css.test.mjs', 'apps/desktop/test/prepare-web-actual.test.mjs',
    'apps/web/platform/dialogs.js', 'test/dual-platform/backup-serialization-empty.test.cjs',
    'test/dual-platform/browser-storage.test.cjs', 'test/dual-platform/zip-safety.test.cjs',
    'apps/desktop/scripts/dev-smoke.mjs', 'apps/desktop/test/git-hooks.test.mjs',
    'apps/web/ai-question-sessions.js', 'apps/web/practice-selection.js',
    'test/dual-platform/ai-results.test.cjs', 'test/dual-platform/business.test.cjs',
    'test/dual-platform/practice-selection-performance.test.cjs', 'test/dual-platform/settings-action-page.cjs',
    'test/web-ai-practice/wrong-analysis.cjs',
    'apps/desktop/test/native-services.test.mjs', 'apps/web/platform/browser-credentials.js',
    'test/codebuddy-cli-stdio/probe.mjs', 'test/dual-platform/select-page.cjs',
  ]) {
    const [result] = await lint.lintText(source, { filePath });
    assert.deepEqual(result.messages.filter((m) => m.ruleId === rule).map((m) => m.line), [2], filePath);
    if (filePath.startsWith('apps/desktop/')) {
      const desktopFile = filePath.slice('apps/desktop/'.length);
      const [desktopResult] = await desktopLint.lintText(source, { filePath: desktopFile });
      assert.deepEqual(desktopResult.messages.filter((m) => m.ruleId === rule).map((m) => m.line), [2], filePath);
    }
  }
  for (const filePath of ['apps/web/app.js', 'apps/desktop/scripts/smoke.mjs']) {
    const [outside] = await lint.lintText(source, { filePath });
    assert(!outside.messages.some((message) => message.ruleId === rule), filePath);
  }
});

test('no-shadow pilot rejects local shadowing only in the AI import panel', async () => {
  const lint = linter();
  const filePath = 'apps/web/ai-import-panel.js';
  const shadowed = [
    "const value = 'outer';",
    'function printValue() {',
    "  const value = 'inner';",
    '  console.log(value);',
    '}',
    '',
    'printValue();',
    'console.log(value);',
    '',
  ].join('\n');
  const renamed = shadowed.replace("const value = 'inner';", "const innerValue = 'inner';")
    .replace('  console.log(value);', '  console.log(innerValue);');
  const [invalid] = await lint.lintText(shadowed, { filePath });
  assert.equal(invalid.messages.filter((message) => message.ruleId === 'no-shadow').length, 1);
  const [valid] = await lint.lintText(renamed, { filePath });
  assert.equal(valid.errorCount + valid.warningCount, 0, JSON.stringify(valid.messages));
  const [outside] = await lint.lintText(shadowed, { filePath: 'apps/web/ai-import-sessions.js' });
  assert.equal(outside.errorCount + outside.warningCount, 0, JSON.stringify(outside.messages));
});

test('complexity ratchet applies to zero-baseline modules only', async (t) => {
  const lint = linter();
  const pilotFiles = [
    'apps/web/quiz-core.js',
    'apps/web/platform/index.js',
    'apps/web/platform/save-queue.js',
    'apps/web/study-sessions.js',
    'apps/web/platform/browser.js',
  ];
  const branchy = [
    'function branchy(value) {',
    ...Array.from({ length: 16 }, (_, index) => `  if (value === ${index}) { return ${index}; }`),
    '  return -1;',
    '}',
    'console.log(branchy(1));',
    '',
  ].join('\n');
  const cases = [
    ['complexity', branchy],
    ['max-params', 'function many(a, b, c, d, e, f) { return a + b + c + d + e + f; }\nconsole.log(many(1, 2, 3, 4, 5, 6));\n'],
    ['max-depth', 'function deep(list) { if (list) { while (list.length) { for (const value of list) { if (value) { if (value > 1) { return value; } } } } } return 0; }\nconsole.log(deep([1]));\n'],
    ['max-nested-callbacks', 'setTimeout(function () { setTimeout(function () { setTimeout(function () { setTimeout(function () { setTimeout(function () { console.log(1); }); }); }); }); });\n'],
  ];
  // 函数与文件规模阈值只需确认配置生效，构造超长函数会淹没用例本身。
  const expectedRules = {
    complexity: [2, 15],
    'max-depth': [2, 4],
    'max-params': [2, 5],
    'max-nested-callbacks': [2, 4],
    'max-lines-per-function': [2, { max: 120, skipBlankLines: true, skipComments: true }],
    'max-lines': [2, { max: 600, skipBlankLines: true, skipComments: true }],
  };
  for (const filePath of pilotFiles) {
    await t.test(filePath, async () => {
      for (const [rule, source] of cases) {
        const [result] = await lint.lintText(source, { filePath });
        assert(result.messages.some((message) => message.ruleId === rule), `${filePath}: ${rule}`);
      }
      const config = await lint.calculateConfigForFile(path.join(root, filePath));
      for (const [rule, expected] of Object.entries(expectedRules)) {
        assert.deepEqual(config?.rules?.[rule], expected, `${filePath}: ${rule}`);
      }
    });
  }
  const outsideFile = 'apps/web/bank-page.js';
  for (const [rule, source] of cases) {
    const [outside] = await lint.lintText(source, { filePath: outsideFile });
    assert.equal(outside.messages.filter((message) => message.ruleId === rule).length, 0, rule);
  }
  const outsideConfig = await lint.calculateConfigForFile(path.join(root, outsideFile));
  for (const rule of Object.keys(expectedRules)) {
    assert.equal(outsideConfig?.rules?.[rule]?.[0] ?? 0, 0, rule);
  }
});

test('statement-per-line pilot covers zero-hit modules without affecting other files', async (t) => {
  const lint = linter();
  const source = 'const first = 1; const second = 2;\nconsole.log(first, second);\n';
  for (const filePath of [
    'apps/web/quiz-core.js',
    'apps/web/training.js',
    'apps/web/practice-selection.js',
    'apps/web/ai-results.js',
    'apps/web/bank-editor.js',
    'apps/web/platform/index.js',
    'apps/web/text-answers.js',
    'apps/web/platform/save-queue.js',
    'apps/web/study-sessions.js',
    'apps/web/app.js',
    'apps/web/import/find-replace.js',
    'apps/web/import/dual-answers.js',
    'apps/web/import/commit.js',
    'apps/web/questions/rich-content.js',
    'apps/web/banks/metadata.js',
    'apps/web/banks/question-operations.js',
    'apps/web/banks/deletion.js', 'apps/web/backup/export.js', 'apps/web/backup/restore.js',
  ]) {
    await t.test(filePath, async () => {
      const [result] = await lint.lintText(source, { filePath });
      assert(result.messages.some((message) => message.ruleId === '@stylistic/max-statements-per-line'), filePath);
    });
  }
  for (const filePath of ['apps/web/bank-page.js', 'apps/web/platform/browser.js']) {
    const [outside] = await lint.lintText(source, { filePath });
    assert.equal(
      outside.messages.filter((message) => message.ruleId === '@stylistic/max-statements-per-line').length,
      0,
      filePath,
    );
  }
});

test('the entry and extracted modules require separate lines for statements and control block bodies', async () => {
  const lint = linter();
  const declaration = "const button = document.querySelector('#ocr-copy-btn');";
  const expanded = [declaration, 'if (button) {', '  button.onclick = () => true;', '}', ''].join('\n');
  for (const filePath of [
    'apps/web/app.js', 'apps/web/import/find-replace.js', 'apps/web/import/dual-answers.js',
    'apps/web/import/commit.js', 'apps/web/questions/rich-content.js', 'apps/web/banks/metadata.js',
    'apps/web/banks/question-operations.js', 'apps/web/banks/deletion.js', 'apps/web/backup/export.js', 'apps/web/backup/restore.js',
  ]) {
    const [compact] = await lint.lintText(
      `${declaration}if (button) { button.onclick = () => true; }\n`,
      { filePath },
    );
    const rules = compact.messages.map(({ ruleId }) => ruleId);
    assert(rules.includes('@stylistic/max-statements-per-line'), filePath);
    assert(rules.includes('@stylistic/brace-style'), filePath);

    const [result] = await lint.lintText(expanded, { filePath });
    assert.deepEqual(result.messages, [], filePath);
  }
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
