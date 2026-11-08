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
    .replace(
      /^([ \t]*)const (KEY)\s*=\s*(['"])([^'"\r\n]+)\3;?/gm,
      (_match, indent, name, _quote, value) => `${indent}const ${name} = "${value}"${semicolon}`,
    )
    .replace(
      /^([ \t]*)(async )?function ([\w$]+)\(/gm,
      (_match, indent, asyncKeyword, name) => `${indent}${asyncKeyword ?? ''}function ${name} (\n`,
    )
    .replace(/^\(function\(\)\s*\{/m, '( function () {')
    .replace(/^([ \t]*)startApplication\(\);/m, (_match, indent) => `${indent}startApplication (\n${indent})${semicolon}`)
    .replace(/^\}\)\(\);/m, `} ) ( )${semicolon}`)
    .replace(
      /^([ \t]*)if \(globalThis\.ShirohaDesktopHost\) \{globalThis\.ShirohaDesktopHost\.canClose = async\(\)=>\{/m,
      '$1if (globalThis.ShirohaDesktopHost)\n$1{ globalThis.ShirohaDesktopHost.canClose = async () => {',
    )
    .replace(/^([ \t]*function aiTasksBusyV99 \(\n\) \{)(.*)(\})$/m, '$1\n$2\n$3');
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
assert.notEqual(formatted, original, '排版变体必须实际改变源码');
assert.match(formatted, /^\\s*const KEY = "/m, '状态键必须覆盖不同引号和缩进');
assert.match(formatted, /^\\s*startApplication \\(\\n/m, '启动边界必须覆盖多行排版');
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
  const names = ['ShirohaPlatformValidation', 'ShirohaBrowser', 'ShirohaTraining', 'ShirohaQuizCore', 'ShirohaTextAnswers', 'ShirohaTextParser', 'ShirohaBackupCore', 'ShirohaZip', 'ShirohaBackupArchive', 'ShirohaBackupData', 'ShirohaWebdavPanel', 'ShirohaDocx', 'ShirohaPdf', 'ShirohaOcrImport', 'ShirohaTableImport', 'ShirohaImportPreview', 'ShirohaAiResults', 'ShirohaAiImportSessions', 'ShirohaAiQuestionSessions', 'ShirohaAiSettings', 'ShirohaAiTransport', 'ShirohaAiPrompts', 'ShirohaQuestionView', 'ShirohaBankPage', 'ShirohaSavedQuestionsPage', 'ShirohaTrainingReviewPage', 'ShirohaBankEditor', 'ShirohaStudySessions', 'ShirohaExamPage', 'ShirohaPracticeSelection', 'ShirohaPracticePage', 'ShirohaAiImportPanel', 'ShirohaAiQuestionPanels', 'ShirohaQuestionEditor'];
  for (const name of names) {
    Object.defineProperty(context, name, {
      configurable: true,
      set(value) {
        loaded.push(name);
        Object.defineProperty(context, name, { value, configurable: true, writable: true });
      },
    });
  }
  runWebScripts(context, ['platform/validation.js', 'platform/browser.js', 'training.js', 'quiz-core.js', 'text-answers.js', 'text-parser.js', 'backup-core.js', 'zip.js', 'backup-archive.js', 'backup-data.js', 'webdav-panel.js', 'docx-import.js', 'pdf-import.js', 'ocr-import.js', 'table-import.js', 'import-preview.js', 'ai-results.js', 'ai-import-sessions.js', 'ai-question-sessions.js', 'ai-settings.js', 'ai-transport.js', 'ai-prompts.js', 'question-view.js', 'bank-page.js', 'saved-questions-page.js', 'training-review-page.js', 'bank-editor.js', 'study-sessions.js', 'exam-page.js', 'practice-selection.js', 'practice-page.js', 'ai-import-panel.js', 'ai-question-panels.js', 'question-editor.js']);
  assert.deepEqual(loaded, names);
  assert.equal(typeof context.ShirohaPlatformValidation, 'object');
  assert.equal(typeof context.ShirohaBrowser, 'object');
  assert.equal(typeof context.ShirohaTraining, 'object');
  assert.equal(typeof context.ShirohaTraining.parsePracticeNumberRangeV58916, 'function');
  assert.equal(typeof context.ShirohaTraining.formatExactPracticeNumbersV58916, 'function');
  assert.equal(typeof context.ShirohaQuizCore, 'object');
  assert.equal(typeof context.ShirohaQuizCore.normalizeBlankAnswersV58914, 'function');
  assert.equal(typeof context.ShirohaQuizCore.sameAnswerForQuestion, 'function');
  assert.equal(typeof context.ShirohaTextAnswers, 'object');
  assert.equal(typeof context.ShirohaTextParser.create, 'function');
  assert.equal(typeof context.ShirohaBackupCore, 'object');
  assert.equal(typeof context.ShirohaBackupArchive.create, 'function');
  assert.equal(typeof context.ShirohaBackupData.create, 'function');
  assert.equal(typeof context.ShirohaWebdavPanel.create, 'function');
  assert.equal(typeof context.ShirohaZip, 'object');
  assert.equal(typeof context.ShirohaZip.parseZipEntries, 'function');
  assert.equal(typeof context.ShirohaZip.zipStoreFiles, 'function');
  assert.equal(typeof context.ShirohaDocx.create, 'function');
  assert.equal(typeof context.ShirohaPdf.create, 'function');
  assert.equal(typeof context.ShirohaOcrImport.create, 'function');
  assert.equal(typeof context.ShirohaImportPreview.create, 'function');
  assert.equal(typeof context.ShirohaAiResults.create, 'function');
  assert.equal(typeof context.ShirohaAiImportSessions.create, 'function');
  assert.equal(typeof context.ShirohaAiQuestionSessions.createPractice, 'function');
  assert.equal(typeof context.ShirohaAiQuestionSessions.createReview, 'function');
  assert.equal(typeof context.ShirohaAiSettings.create, 'function');
  assert.equal(typeof context.ShirohaAiTransport.create, 'function');
  assert.equal(typeof context.ShirohaAiPrompts.create, 'function');
  assert.equal(typeof context.ShirohaQuestionView.create, 'function');
  assert.equal(typeof context.ShirohaBankPage.create, 'function');
  assert.equal(typeof context.ShirohaSavedQuestionsPage.create, 'function');
  assert.equal(typeof context.ShirohaTrainingReviewPage.create, 'function');
  assert.equal(typeof context.ShirohaBankEditor.create, 'function');
  assert.equal(typeof context.ShirohaStudySessions.createPractice, 'function');
  assert.equal(typeof context.ShirohaStudySessions.createExam, 'function');
  assert.equal(typeof context.ShirohaExamPage.create, 'function');
  assert.equal(typeof context.ShirohaPracticeSelection.create, 'function');
  assert.equal(typeof context.ShirohaPracticePage.create, 'function');
  assert.equal(typeof context.ShirohaAiImportPanel.create, 'function');
  assert.equal(typeof context.ShirohaAiQuestionPanels.create, 'function');
  assert.equal(typeof context.ShirohaQuestionEditor.create, 'function');
  assert.equal(typeof context.ShirohaTableImport.create, 'function');
  assert.equal(context.process, undefined);
  assert.equal(context.require, undefined);
  assert.throws(() => runWebScripts(context, ['../desktop/frontend/adapter.js']), /apps\/web/);
});

test('页面工厂装配不访问 DOM，事件绑定留给页面初始化', () => {
  const context = vm.createContext({});
  Object.defineProperty(context, 'document', {
    get() { throw new Error('页面工厂在装配时访问了 DOM'); },
  });
  runWebScripts(context, [
    'question-view.js', 'bank-page.js', 'saved-questions-page.js', 'training-review-page.js',
    'bank-editor.js', 'study-sessions.js', 'exam-page.js', 'practice-selection.js',
    'practice-page.js', 'ai-import-panel.js', 'ai-question-panels.js', 'question-editor.js',
  ]);
  const empty = {};
  const practice = context.ShirohaStudySessions.createPractice();
  const exam = context.ShirohaStudySessions.createExam();
  const factories = [
    () => context.ShirohaQuestionView.create({}),
    () => context.ShirohaBankPage.create({ scope: empty, paging: empty, rendering: empty, selection: empty, actions: empty, content: empty }),
    () => context.ShirohaSavedQuestionsPage.create({ paging: empty, bank: empty, favorites: empty, wrong: empty, review: empty, practice: empty, actions: empty }),
    () => context.ShirohaTrainingReviewPage.create({ paging: empty, content: empty, review: empty, navigation: empty, practice: empty }),
    () => context.ShirohaBankEditor.create({ scope: empty, data: empty, preview: empty, navigation: empty, actions: empty }),
    () => context.ShirohaExamPage.create({ session: exam, question: empty, practice: empty, view: empty, storage: empty }),
    () => context.ShirohaPracticeSelection.create({ session: practice, scope: empty, questions: empty, progress: empty }),
    () => context.ShirohaPracticePage.create({ session: practice, selection: empty, scope: empty, question: empty, review: empty, favorites: empty, ai: empty, shell: empty, storage: empty }),
    () => context.ShirohaAiImportPanel.create({ settings: empty, requests: empty, editor: empty, preview: empty, limits: empty }),
    () => context.ShirohaAiQuestionPanels.create({ session: practice, question: empty, settings: empty, actions: empty }),
    () => context.ShirohaQuestionEditor.create({ parser: empty, suggestions: empty, editor: empty, practice: empty, view: empty, storage: empty }),
  ];
  for (const create of factories) {
    assert.equal(typeof create(), 'object');
  }
});

test('切换练习或考试时请求序号沿用数值转换并使旧读取失效', () => {
  const context = vm.createContext({});
  runWebScripts(context, ['study-sessions.js']);
  for (const create of [context.ShirohaStudySessions.createPractice, context.ShirohaStudySessions.createExam]) {
    const session = create();
    assert.equal(session.request, 0);
    session.current = { timer: null };
    assert.equal(session.request, 1);
    session.request = '9';
    session.current = { timer: null };
    assert.equal(session.request, 10);
    session.request = 10n;
    session.current = { timer: null };
    assert.equal(session.request, 11n);
  }
});
