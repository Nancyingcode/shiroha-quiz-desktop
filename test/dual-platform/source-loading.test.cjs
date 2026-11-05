'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

// 只改测试进程读取的副本，磁盘源码、沙箱和现有业务断言保持原样。
function equivalentLayout(source, style) {
  const semicolon = style === 'multiline-asi' ? '' : ';';
  return source
    .replace(/^const (KEY|AI_KEY_SESSION_V99|AI_KEY_LOCAL_V99)\s*=\s*(['"])([^'"\r\n]+)\2;?/gm,
      (_match, name, _quote, value) => `const ${name} = "${value}"${semicolon}`)
    .replace(/^(\s*)(async )?function ([\w$]+)\(/gm,
      (_match, indent, asyncKeyword = '', name) => `${indent}${asyncKeyword}function ${name} (\n`)
    .replace(/^\(function\(\)\{/m, '( function () {')
    .replace(/^startApplication\(\);/m, `startApplication (\n)${semicolon}`)
    .replace(/^\}\)\(\);/m, `} ) ( )${semicolon}`)
    .replace(/^if\(globalThis\.ShirohaDesktopHost\)globalThis\.ShirohaDesktopHost\.canClose=async\(\)=>\{/m,
      'if (globalThis.ShirohaDesktopHost) globalThis.ShirohaDesktopHost.canClose = async () => {')
    .replace(/^(function aiTasksBusyV99 \(\n\)\{)(.*)(\})$/m, '$1\n$2\n$3');
}

const runner = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[1];
const style = process.argv[2];
const target = path.join(root, 'apps/web/app.js');
const read = fs.readFileSync;
const layout = (${equivalentLayout.toString()});
const original = read(target, 'utf8');
const formatted = layout(original, style);
const { Linter } = require(path.join(root, 'apps/desktop/node_modules/eslint'));
function syntax(text) {
  const parser = new Linter();
  const messages = parser.verify(text, { languageOptions: { sourceType: 'script' }, rules: {} });
  assert(!messages.some(message => message.fatal), '排版变体必须保留合法语法');
  return JSON.stringify(parser.getSourceCode().ast, function (key, value) {
    if (['loc', 'range', 'start', 'end', 'tokens', 'comments', 'parent'].includes(key)) return undefined;
    if (key === 'raw' && this.type === 'Literal') return undefined;
    return value;
  });
}
assert(syntax(original) === syntax(formatted), '排版变体必须保留语法树和所有字面量值');
fs.readFileSync = function(file, options) {
  const value = read.call(this, file, options);
  return typeof file === 'string' && path.resolve(file) === target && typeof value === 'string'
    ? layout(value, style) : value;
};
const keys = require(path.join(root, 'test/web-ai-practice/harness.cjs')).storageKeys();
assert.equal(keys.state, 'shiroha_quiz_state_v28_4_c1');
assert.notEqual(keys.session, keys.local);
for (const file of [
  'business', 'format', 'pagination', 'json-import', 'document-lifecycle', 'exit',
  'ai-connection', 'ai-harness', 'ai-import-retry', 'ai-codebuddy-execution',
]) require(path.join(root, 'test/dual-platform', file + '.test.cjs'));
require(path.join(root, 'test/web-webdav/request.test.cjs'));
`;

for (const style of ['spaced-quotes', 'multiline-asi']) {
  test(`真实业务断言接受等价源码排版：${style}`, (t) => {
    const result = spawnSync(process.execPath, ['--test-reporter=tap', '-e', runner, root, style], {
      cwd: root,
      // 子进程独立运行测试，不能继承父 runner 的二进制事件协议。
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /# fail 0/);
    t.diagnostic(`${style}: ${result.stdout.match(/# tests (\d+)/)?.[1]} 项既有业务回归通过`);
  });
}

const vm = require('node:vm');
const { createWebSource, runWebScripts } = require('./source-tools.cjs');

for (const wrap of [
  (body) => `(function () { ${body} })();`,
  (body) => `(function () { ${body} }());`,
]) {
  test('桥接只改真实 IIFE 启动节点，忽略注释与字符串中的伪边界', () => {
    const source = wrap(`
      const privateValue = 42;
      const decoy = 'startApplication(); })();';
      /* startApplication(); })(); */
      function startApplication () { globalThis.started = true; }
      startApplication ()
    `);
    const tools = createWebSource(source);
    const replaced = vm.createContext({});
    vm.runInContext(tools.replaceStartup('globalThis.value = privateValue;'), replaced);
    assert.equal(replaced.value, 42);
    assert.equal(replaced.started, undefined);
    const injected = tools.injectIife('\nglobalThis.value = privateValue;\n');
    const running = vm.createContext({});
    vm.runInContext(injected.source, running);
    assert.equal(injected.bridgeUsed, true);
    assert.equal(running.value, 42);
    assert.equal(running.started, true);
    assert.equal(running.process, undefined);
    assert.equal(running.require, undefined);
  });
}

test('缺失、重复、非末尾启动及不唯一 IIFE 均拒绝注入', () => {
  for (const body of [
    'function startApplication() {}',
    'startApplication(); startApplication();',
    'startApplication(); globalThis.afterStartup = true;',
  ]) {
    const source = createWebSource(`(function () { ${body} })();`);
    assert.throws(() => source.replaceStartup(''), /启动/);
    assert.throws(() => source.injectIife(''), /启动/);
  }
  assert.throws(() => createWebSource('(function () {})(); (function () {})();'), /IIFE/);
  assert.throws(() => createWebSource('(function () {})(); globalThis.extra = true;'), /IIFE/);
  assert.throws(() => createWebSource('(function (value) {})();'), /IIFE/);
  assert.throws(() => createWebSource('(function () {'), /无法解析/);
});

test('global lexical 模式保留原文，不误报为 IIFE 桥接', () => {
  const text = 'const state = {}; const practice = {};';
  assert.deepEqual(createWebSource(text).injectIife('ignored'), { source: text, bridgeUsed: false });
});

test('函数只按当前作用域唯一名称定位，并保留异步声明与完整函数体', async () => {
  const source = createWebSource(`(function () {
    const text = 'function first() {';
    function holder () { function first() { return -1; } }
    async function first (value) { return { value, text: '}' }; }
    function second () {}
    startApplication();
  })();`);
  const context = vm.createContext({});
  vm.runInContext(source.functionSource('first'), context);
  assert.equal((await context.first(7)).value, 7);
  assert.match(source.between('first', 'second'), /^async function first/);
  assert.throws(() => source.functionSource('missing'), /必须存在且唯一/);
  assert.throws(() => source.between('second', 'first'), /顺序/);
  assert.throws(() => createWebSource('function repeated() {} function repeated() {}')
    .functionSource('repeated'), /必须存在且唯一/);
});

test('状态键读取兼容引号与 ASI，只接受唯一字符串字面量', () => {
  assert.equal(createWebSource('const KEY = "state-key"\n').stringConstant('KEY'), 'state-key');
  assert.equal(createWebSource("const KEY = 'state-key';").stringConstant('KEY'), 'state-key');
  assert.throws(() => createWebSource('const KEY = getKey();').stringConstant('KEY'), /字面量/);
  assert.throws(() => createWebSource('const OTHER = "key";').stringConstant('KEY'), /必须存在且唯一/);
});

test('关闭钩子支持格式化后的条件块，拒绝缺失或重复定位', () => {
  const hook = 'if (globalThis.ShirohaDesktopHost) { globalThis.ShirohaDesktopHost.canClose = async () => true; }';
  const source = createWebSource(`(function () { ${hook} startApplication(); })();`);
  assert.equal(source.closeHookSource(), hook);
  assert.throws(() => createWebSource('const unrelated = true;').closeHookSource(), /关闭钩子/);
  assert.throws(() => createWebSource(`${hook}\n${hook}`).closeHookSource(), /关闭钩子/);
});

test('共享脚本在同一沙箱按显式次序加载，不允许越界路径', () => {
  const context = vm.createContext({});
  const loaded = [];
  const names = ['ShirohaPlatformValidation', 'ShirohaBrowser', 'ShirohaTraining', 'ShirohaQuizCore', 'ShirohaTextAnswers', 'ShirohaBackupCore'];
  for (const name of names) {
    Object.defineProperty(context, name, {
      configurable: true,
      set(value) {
        loaded.push(name);
        Object.defineProperty(context, name, { value, configurable: true, writable: true });
      },
    });
  }
  runWebScripts(context, ['platform/validation.js', 'platform/browser.js', 'training.js', 'quiz-core.js', 'text-answers.js', 'backup-core.js']);
  assert.deepEqual(loaded, names);
  assert.equal(typeof context.ShirohaPlatformValidation, 'object');
  assert.equal(typeof context.ShirohaBrowser, 'object');
  assert.equal(typeof context.ShirohaTraining, 'object');
  assert.equal(typeof context.ShirohaQuizCore, 'object');
  assert.equal(typeof context.ShirohaTextAnswers, 'object');
  assert.equal(typeof context.ShirohaBackupCore, 'object');
  assert.equal(context.process, undefined);
  assert.equal(context.require, undefined);
  assert.throws(() => runWebScripts(context, ['../desktop/frontend/adapter.js']), /apps\/web/);
});
