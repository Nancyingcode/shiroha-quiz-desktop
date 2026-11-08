'use strict';
const { installAiSettings } = require('./ai-settings-helper.cjs');
const { installAiTransport } = require('./ai-transport-helper.cjs');
const { runWebScripts } = require('./source-tools.cjs');

const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');

function installSessions(context) {
  runWebScripts(context, ['ai-import-sessions.js']);
  const sessions = context.ShirohaAiImportSessions.create({
    draft: context.importDraft,
    configuration: { isEditing: () => !!context.bankEditSessionV45, current: context.aiExecutionConfigV99,
      configured: context.aiConfiguredV99, unavailable: context.aiUnavailableReasonV99,
      request: context.aiRequestConfigV99, label: context.aiExecutionLabelV99 },
    organizer: { range: context.aiImportRangeV992, context: context.aiRefactorContextV384,
      messages: context.buildAiMessagesV99, parse: context.parseAiRefactorPayloadV384,
      parseText: context.parseTextQuestions,
      risk: context.largeImportRiskMessageV376 },
    preview: { mode: () => context.aiPreviewPanelModeV991, collectTargets: context.collectAiPreviewTargetDetailsV992,
      key: context.aiQuestionKeyV991, fingerprint: context.aiQuestionFingerprintV991,
      payload: context.aiQuestionPayloadV991, issueStatus: context.importIssueStatus,
      label: context.aiPreviewModeLabelV991, analysisMessages: context.buildAiAnalysisMessagesV991,
      reviewMessages: context.buildAiReviewMessagesV991, resultArray: context.aiResultArrayV991,
      normalizeReview: context.normalizeAiReviewResultV991, normalizeAnalysis: context.normalizeAiAnalysisResultV991,
      findIndex: context.findImportIndexByAiKeyV991 },
    view: { select: context.$, sync: context.syncAiImportActionV99,
      refreshImport: context.refreshAiImportPanelV99, refreshPreview: context.refreshAiPreviewPanelV991,
      importStatus: context.setAiImportStatusV99, previewStatus: context.setAiPreviewStatusV991,
      notice: context.showNotice, render: context.renderImportPreview },
    transport: { request: context.requestAiChatV99, timeout: context.withAiTimeoutV99 },
    limits: { importChars: 50000, previewItems: 200, analysisBatch: 10, reviewBatch: 20 },
  });
  Object.assign(context, sessions);
  Object.defineProperties(context, {
    aiImportRequestV99: { get: () => sessions.importRequest },
    aiPreviewRequestV991: { get: () => sessions.previewRequest },
  });
}

function setup(respond) {
  const requests = [];
  const original = [{ question: '原题', answer: ['A'] }];
  const context = vm.createContext({
    aiImportRequestV99: { running: false }, aiPreviewRequestV991: { running: false },
    bankEditSessionV45: null, AI_IMPORT_MAX_CHARS_V99: 50000,
    ShirohaPlatform: {},
    ensureAiImportStateV99: () => ({ endpoint: 'https://example.invalid', model: 'fixture', timeoutSeconds: 10 }),
    readStoredAiKeyV99: () => '', aiImportRangeV992: () => ({ text: '待整理题目', label: '全文' }),
    aiRefactorContextV384: () => ({}), syncAiImportActionV99() {}, setAiImportStatusV99() {},
    showNotice() {}, refreshAiImportPanelV99() {},
    withAiTimeoutV99: (_timeout, run) => run({}),
    buildAiMessagesV99: (_text, options) => options,
    requestAiChatV99: async (_config, options) => { requests.push(options.requestedMode); return respond(requests.length); },
    parseAiRefactorPayloadV384: () => { throw new Error('模型业务 JSON 无效'); },
  });
  runWebScripts(context, ['import-preview.js']);
  context.importDraft = context.ShirohaImportPreview.create({ readers: {}, ocr: {} });
  context.importDraft.questions = original;
  context.importDraft.filter = '';
  installAiSettings(context);
  installSessions(context);
  return { context, requests, original };
}

for (const failure of [
  { code: 'timeout' }, { code: 'cancelled', name: 'AbortError' },
  { code: 'outcome_unknown' }, { code: 'network_unavailable' },
  { status: 401 }, { status: 429 }, { status: 503 },
  { aiStage: 'json' }, { message: '无法连接接口' },
]) {
  test(`导入请求失败不另发文本兜底：${JSON.stringify(failure)}`, async () => {
    const { context, requests, original } = setup(async () => { throw Object.assign(new Error('执行失败'), failure); });
    await context.startAiImportV99();
    assert.deepEqual(requests, ['direct_questions']);
    assert.equal(context.importDraft.questions, original);
    assert.equal(context.aiImportRequestV99.running, false);
  });
}

test('已收到模型内容但业务结构无效时仍可请求一次文本兜底', async () => {
  const { context, requests, original } = setup(async () => ({ content: '模型返回的无效业务结构' }));
  await context.startAiImportV99();
  assert.deepEqual(requests, ['direct_questions', 'clean_text']);
  assert.equal(context.importDraft.questions, original);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function cancellationFixture(overrides = {}) {
  const pending = [];
  const status = [];
  const notices = [];
  const context = vm.createContext({
    aiImportRequestV99: { running: false, controller: null },
    aiPreviewRequestV991: { running: false, mode: '', cancelled: false, controller: null },
    aiImportSilentCancelV99: false, aiPreviewPanelModeV991: 'analysis',
    bankEditSessionV45: null, AI_IMPORT_MAX_CHARS_V99: 50000, AI_PREVIEW_MAX_ITEMS_V991: 200,
    AI_ANALYSIS_DEFAULT_BATCH_V991: 10, AI_REVIEW_DEFAULT_BATCH_V991: 20,
    AbortController, setTimeout: () => 0, clearTimeout() {},
    ShirohaPlatform: { credentials: { status: () => '' } },
    ensureAiImportStateV99: () => ({ endpoint: 'https://example.invalid', model: 'fixture', timeoutSeconds: 10 }),
    readStoredAiKeyV99: () => '',
    aiProviderLabelV99: () => 'fixture',
    aiImportRangeV992: () => ({ text: '待整理题目', label: '全文' }),
    aiRefactorContextV384: () => ({ currentQuestions: [], warnings: [] }),
    syncAiImportActionV99() {}, refreshAiImportPanelV99() {}, refreshAiPreviewPanelV991() {},
    setAiImportStatusV99: (message) => status.push(message),
    setAiPreviewStatusV991: (message) => status.push(message),
    showNotice: (...args) => notices.push(args),
    buildAiMessagesV99: () => [], buildAiAnalysisMessagesV991: () => [], buildAiReviewMessagesV991: () => [],
    requestAiChatV99: (_config, _messages, options) => {
      const request = deferred();
      request.controller = options.controller;
      pending.push(request);
      return request.promise;
    },
    withAiTimeoutV99: (_timeout, run) => run(new AbortController()),
    parseAiRefactorPayloadV384: (content) => ({ mode: 'direct_questions', structuredUsable: true,
      questions: [{ id: content, question: content }], structuredIssues: [], notes: [] }),
    aiExecutionLabelV99: () => 'fixture',
    resetAiSuggestionsV991() {}, renderImportPreview() {}, largeImportRiskMessageV376: () => '',
    collectAiPreviewTargetDetailsV992: () => ({ indexes: [0], baseIndexes: [0] }),
    aiQuestionKeyV991: (question) => question.id, aiQuestionFingerprintV991: (question) => question.question,
    aiQuestionPayloadV991: (question) => question, importIssueStatus: () => ({}),
    aiPreviewModeLabelV991: () => 'AI 补解析',
    aiResultArrayV991: (content) => [{ analysis: content }],
    normalizeAiAnalysisResultV991: (raw) => ({ questionId: 'original', index: 0, analysis: raw.analysis, note: '' }),
    findImportIndexByAiKeyV991: () => 0,
    $: () => null, ...overrides,
  });
  runWebScripts(context, ['import-preview.js']);
  context.importDraft = context.ShirohaImportPreview.create({ readers: {}, ocr: {} });
  context.importDraft.questions = [{ id: 'original', question: '原草稿' }];
  installAiSettings(context);
  if (context.useRealTimeout) {
    const request = context.requestAiChatV99;
    installAiTransport(context);
    context.requestAiChatV99 = request;
  }
  installSessions(context);
  return { context, pending, status, notices };
}

for (const kind of ['import', 'preview']) {
  test(`${kind} 超时后忽略中止的传输成功也必须丢弃结果并释放忙碌状态`, async () => {
    const timers = new Set();
    const { context, pending, status } = cancellationFixture({
      useRealTimeout: kind === 'import',
      setTimeout: (callback) => { timers.add(callback); return callback; },
      clearTimeout: (timer) => { timers.delete(timer); },
    });
    const task = kind === 'import' ? context.startAiImportV99() : context.startAiPreviewTaskV991();
    assert.equal(timers.size, 1);
    [...timers][0]();
    assert.equal(pending[0].controller.signal.aborted, true);
    pending[0].resolve({ content: '超时迟到结果' });
    await task;
    assert.match(status.at(-1), /超过 10 秒/);
    assert.equal(context.importDraft.questions[0].question, '原草稿');
    assert.equal(context.getAnalysis('original'), undefined);
    const current = kind === 'import' ? context.aiImportRequestV99 : context.aiPreviewRequestV991;
    assert.equal(current.running, false);
    assert.equal(current.controller, null);
    assert.equal(timers.size, 0);
    assert.equal(pending.length, 1);
  });

  test(`${kind} 超时后取消并重启，旧清理不得影响新请求`, async () => {
    const timers = new Set();
    const { context, pending, status } = cancellationFixture({
      useRealTimeout: kind === 'import',
      setTimeout: (callback) => { timers.add(callback); return callback; },
      clearTimeout: (timer) => { timers.delete(timer); },
    });
    const start = kind === 'import' ? () => context.startAiImportV99() : () => context.startAiPreviewTaskV991();
    const cancel = kind === 'import' ? () => context.cancelAiImportRequestV99(true) : () => context.cancelAiPreviewRequestV991(true);
    const current = () => kind === 'import' ? context.aiImportRequestV99 : context.aiPreviewRequestV991;
    const oldTask = start();
    [...timers][0]();
    cancel();
    const newTask = start();
    const owner = current();
    const controller = pending[1].controller;
    const statusBeforeOld = status.slice();
    pending[0].resolve({ content: '旧超时结果' });
    await oldTask;
    assert.equal(current(), owner);
    assert.equal(owner.running, true);
    assert.equal(owner.controller, controller);
    assert.equal(timers.size, 1);
    assert.deepEqual(status, statusBeforeOld);
    pending[1].resolve({ content: '新结果' });
    await newTask;
    assert.equal(current().running, false);
    assert.equal(timers.size, 0);
  });
}

test('文本兜底在取消后迟到，即使新整理已完成也不能恢复旧快照', async () => {
  const { context, pending, status } = cancellationFixture({
    parseAiRefactorPayloadV384: (content) => {
      if (content === '无效结构') {throw new Error('结构无效');}
      return { mode: 'direct_questions', structuredUsable: true,
        questions: [{ id: content, question: content }], structuredIssues: [], notes: [] };
    },
  });
  const first = context.startAiImportV99();
  pending[0].resolve({ content: '无效结构' });
  await new Promise(setImmediate);
  assert.equal(pending.length, 2);
  context.cancelAiImportRequestV99(true);
  assert.equal(pending[1].controller.signal.aborted, true);
  const second = context.startAiImportV99();
  assert.equal(pending.length, 3);
  pending[2].resolve({ content: '新结果' });
  await second;
  const finishedOwner = context.aiImportRequestV99;
  const statusAfterNew = status.slice();
  pending[1].reject(new Error('旧兜底迟到'));
  await first;
  assert.equal(context.aiImportRequestV99, finishedOwner);
  assert.equal(finishedOwner.running, false);
  assert.equal(context.importDraft.questions[0].question, '新结果');
  assert.deepEqual(status, statusAfterNew);
});

test('旧批次在新批次完成后返回，不得追加建议或改写完成状态', async () => {
  const { context, pending, status } = cancellationFixture();
  const first = context.startAiPreviewTaskV991();
  context.cancelAiPreviewRequestV991(true);
  const second = context.startAiPreviewTaskV991();
  pending[1].resolve({ content: '新建议' });
  await second;
  const finishedOwner = context.aiPreviewRequestV991;
  const statusAfterNew = status.slice();
  pending[0].resolve({ content: '旧建议' });
  await first;
  assert.equal(context.aiPreviewRequestV991, finishedOwner);
  assert.equal(finishedOwner.running, false);
  assert.equal(context.getAnalysis('original').analysis, '新建议');
  assert.deepEqual(status, statusAfterNew);
});

for (const kind of ['import', 'preview']) {
  test(`${kind} 显示已请求取消，迟到成功不会冒充取消已完成`, async () => {
    const { context, pending, status } = cancellationFixture();
    const task = kind === 'import' ? context.startAiImportV99() : context.startAiPreviewTaskV991();
    if (kind === 'import') {context.cancelAiImportRequestV99(false);}
    else {context.cancelAiPreviewRequestV991(false);}
    assert.match(status.at(-1), /已请求取消/);
    const statusAfterCancel = status.slice();
    pending[0].resolve({ content: '迟到结果' });
    await task;
    assert.deepEqual(status, statusAfterCancel);
    assert.equal(context.importDraft.questions[0].question, '原草稿');
    assert.equal(context.getAnalysis('original'), undefined);
  });
}

for (const kind of ['import', 'preview']) {
  for (const oldOutcome of ['response', 'error']) {
    test(`${kind} 取消旧任务并重启后，忽略中止的旧${oldOutcome}不得改写新任务`, async () => {
      const { context, pending, status, notices } = cancellationFixture();
      const start = kind === 'import' ? () => context.startAiImportV99() : () => context.startAiPreviewTaskV991();
      const cancel = kind === 'import' ? () => context.cancelAiImportRequestV99(true) : () => context.cancelAiPreviewRequestV991(true);
      const current = () => kind === 'import' ? context.aiImportRequestV99 : context.aiPreviewRequestV991;
      const first = start();
      assert.equal(pending.length, 1);
      cancel();
      assert.equal(pending[0].controller.signal.aborted, true);
      const second = start();
      assert.equal(pending.length, 2, '取消后应允许新任务接管');
      const owner = current();
      const controller = pending[1].controller;
      const statusesBefore = status.slice();
      const noticesBefore = notices.slice();
      if (oldOutcome === 'response') {pending[0].resolve({ content: '旧结果' });}
      else {pending[0].reject(new Error('旧请求失败'));}
      await first;
      assert.equal(current(), owner);
      assert.equal(current().running, true);
      assert.equal(current().controller, controller);
      assert.deepEqual(status, statusesBefore);
      assert.deepEqual(notices, noticesBefore);
      assert.equal(context.importDraft.questions[0].question, '原草稿');
      assert.equal(context.getAnalysis('original'), undefined);
      pending[1].resolve({ content: '新结果' });
      await second;
      assert.equal(current().running, false);
      if (kind === 'import') {assert.equal(context.importDraft.questions[0].question, '新结果', status.join(' / '));}
      else {assert.equal(context.getAnalysis('original').analysis, '新结果');}
    });
  }
}
