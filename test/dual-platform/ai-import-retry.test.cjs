'use strict';
const { installAiSettings } = require('./ai-settings-helper.cjs');
const { installAiTransport } = require('./ai-transport-helper.cjs');
const { loadWebSource, runWebScripts } = require('./source-tools.cjs');

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
      request.messages = _messages;
      request.isCurrent = options.isCurrent;
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
    $: (selector) => (selector === '#ai-preview-batch-v991' ? { value: '10' } : null), ...overrides,
  });
  runWebScripts(context, ['import-preview.js']);
  context.importDraft = context.ShirohaImportPreview.create({ readers: {}, ocr: {} });
  context.importDraft.questions = [{ id: 'original', question: '原草稿' }];
  if (context.useRealIdentity) {
    const source = loadWebSource();
    const names = ['aiQuestionKeyV991', 'aiQuestionFingerprintV991', 'findImportIndexByAiKeyV991'];
    vm.runInContext(`const aiImportAnonymousKeysV991 = new WeakMap(); let aiImportAnonymousSequenceV991 = 0;\n${names.map((name) => source.functionSource(name)).join('\n')}\nObject.assign(globalThis, { ${names.join(', ')} });`, context);
  }
  if (context.useRealResults) {
    runWebScripts(context, ['ai-prompts.js', 'ai-results.js']);
    const prompts = context.ShirohaAiPrompts.create({ question: () => null, importKey: context.aiQuestionKeyV991,
      validate: () => ({}), maxChars: 50000 });
    const results = context.ShirohaAiResults.create({ normalizeType: (type) => type, normalizeQuestion: (question) => question,
      makeId: (_prefix, index) => `new-${index}`, trimMultilineBoundaryV5910: (value) => String(value).trim(),
      splitAnswer: (value) => String(value || '').split(',') });
    Object.assign(context, results, { aiQuestionPayloadV991: prompts.aiQuestionPayloadV991,
      buildAiAnalysisMessagesV991: (items) => items, buildAiReviewMessagesV991: (items) => items });
  }
  installAiSettings(context);
  if (context.useRealTimeout) {
    const request = context.requestAiChatV99;
    installAiTransport(context);
    context.requestAiChatV99 = request;
  } else if (context.useRealNetworkTransport) {
    installAiTransport(context);
  }
  installSessions(context);
  return { context, pending, status, notices };
}

for (const cancelled of [true, false]) {
  test(`导入${cancelled ? '取消' : '失败'}提示与保留草稿一致`, async () => {
    const { context, pending, status, notices } = cancellationFixture();
    const task = context.startAiImportV99();
    const error = new Error('测试失败');
    if (cancelled) { error.name = 'AbortError'; }
    pending[0].reject(error);
    await task;
    assert.equal(context.importDraft.questions[0].question, '原草稿');
    assert.match(status.at(-1), cancelled ? /已取消/ : /测试失败/);
    assert.equal(notices.at(-1)[2], cancelled ? 'warn' : 'danger');
  });
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
    const current = () => (kind === 'import' ? context.aiImportRequestV99 : context.aiPreviewRequestV991);
    const oldTask = start();
    [...timers][0]();
    cancel();
    const newTask = start();
    const owner = current();
    const { controller } = pending[1];
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
      if (content === '无效结构') { throw new Error('结构无效'); }
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
    if (kind === 'import') { context.cancelAiImportRequestV99(false); } else { context.cancelAiPreviewRequestV991(false); }
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
      const current = () => (kind === 'import' ? context.aiImportRequestV99 : context.aiPreviewRequestV991);
      const first = start();
      assert.equal(pending.length, 1);
      cancel();
      assert.equal(pending[0].controller.signal.aborted, true);
      const second = start();
      assert.equal(pending.length, 2, '取消后应允许新任务接管');
      const owner = current();
      const { controller } = pending[1];
      const statusesBefore = status.slice();
      const noticesBefore = notices.slice();
      if (oldOutcome === 'response') { pending[0].resolve({ content: '旧结果' }); } else { pending[0].reject(new Error('旧请求失败')); }
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
      if (kind === 'import') { assert.equal(context.importDraft.questions[0].question, '新结果', status.join(' / ')); } else { assert.equal(context.getAnalysis('original').analysis, '新结果'); }
    });
  }
}

function draftState(draft) {
  return JSON.stringify({ questions: draft.questions, selected: [...draft.selected], warnings: draft.warnings,
    report: draft.report, diagnostics: draft.diagnostics, filter: draft.filter,
    tableResult: draft.tableResult, sourceMeta: draft.sourceMeta });
}

for (const stage of ['首次成功', '首次失败', '兜底之前', '兜底成功', '兜底失败']) {
  for (const change of ['重新识别', '表格替换', '摘要外原位编辑', '选区外原文', '相同文字新选区']) {
    test(`整理期间${change}，${stage}不得覆盖新草稿或提示`, async () => {
      let range = { scope: 'selection', text: '相同', label: '选区', sourceText: '相同 x 相同', selectionStart: 0, selectionEnd: 2 };
      const { context, pending, status, notices } = cancellationFixture({
        aiImportRangeV992: () => ({ ...range }),
        parseAiRefactorPayloadV384: (content) => {
          if (content === '结构无效') { throw new Error('结构无效'); }
          if (content === '清洗结果') { return { cleanedText: '可解析文本', structuredIssues: [], notes: [] }; }
          return { structuredUsable: true, questions: [{ id: 'ai', question: '旧任务返回' }], structuredIssues: [], notes: [] };
        },
        parseTextQuestions: () => [{ id: 'clean', question: '旧兜底' }],
      });
      const draft = context.importDraft;
      draft.questions = Array.from({ length: 201 }, (_, index) => ({ id: `q-${index}`, question: `题目 ${index}` }));
      draft.selected = new Set([1, 200]);
      draft.warnings = ['新旧诊断'];
      draft.report = '识别报告';
      draft.diagnostics = { profile: { source: '原始' }, candidates: ['候选'] };
      draft.filter = 'all';
      draft.tableResult = { source: '旧表格' };
      draft.sourceMeta = { name: '原文', size: 11, type: 'text' };
      const task = context.startAiImportV99();
      if (stage.startsWith('兜底') && stage !== '兜底之前') {
        pending[0].resolve({ content: '结构无效' });
        await new Promise(setImmediate);
        assert.equal(pending.length, 2);
      }
      if (change === '重新识别') {
        draft.questions = [{ id: 'new', question: '新识别' }];
        draft.selected = new Set([0]);
        draft.report = '新报告';
        draft.diagnostics = { profile: { source: '新识别' } };
      } else if (change === '表格替换') {
        draft.tableResult = { source: '新表格' };
        draft.questions = [{ id: 'table', question: '新表格题' }];
        draft.selected = new Set([0]);
        draft.warnings = ['表格提示'];
      } else if (change === '摘要外原位编辑') {
        draft.questions[200].question = '第 201 题的新内容';
        draft.selected.add(2);
        draft.diagnostics.profile.source = '新诊断';
      } else if (change === '选区外原文') {
        range = { ...range, sourceText: '相同 y 相同' };
      } else {
        range = { ...range, selectionStart: 5, selectionEnd: 7 };
      }
      const expected = draftState(draft);
      const expectedStatus = status.slice();
      const expectedNotices = notices.slice();
      const current = pending.at(-1);
      if (stage.endsWith('失败')) {
        current.reject(new Error('旧任务迟到失败'));
      } else if (stage === '兜底之前') {
        current.resolve({ content: '结构无效' });
      } else if (stage === '兜底成功') {
        current.resolve({ content: '清洗结果' });
      } else {
        current.resolve({ content: '成功' });
      }
      if (stage === '兜底之前') {
        await new Promise(setImmediate);
        if (pending[1]) { pending[1].resolve({ content: '清洗结果' }); }
      }
      await task;
      assert.equal(draftState(draft), expected);
      assert.deepEqual(status, expectedStatus);
      assert.deepEqual(notices, expectedNotices);
      assert.equal(pending.length, stage.startsWith('兜底') && stage !== '兜底之前' ? 2 : 1);
      assert.equal(context.aiImportRequestV99.running, false);
      assert.equal(context.aiPreviewRequestV991.running, false);
    });
  }
}

for (const outcome of ['空结果', '抛错']) {
  test(`清洗文本本地解析${outcome}时恢复解析器临时诊断和原草稿引用`, async () => {
    const state = {};
    const { context, pending, status } = cancellationFixture({
      parseAiRefactorPayloadV384: () => ({ cleanedText: '文本', structuredUsable: false, structuredIssues: [], notes: [] }),
      parseTextQuestions: () => {
        state.draft.warnings.push('临时警告');
        state.draft.report = '临时报告';
        state.draft.diagnostics = { temporary: true };
        if (outcome === '抛错') { throw new Error('本地解析失败'); }
        return [];
      },
    });
    const draft = context.importDraft;
    state.draft = draft;
    draft.selected.add(0);
    draft.warnings = ['原警告'];
    draft.report = '原报告';
    draft.diagnostics = { original: true };
    draft.filter = 'all';
    const refs = draft.snapshot();
    const expected = draftState(draft);
    const task = context.startAiImportV99();
    pending[0].resolve({ content: '清洗文本' });
    await task;
    assert.equal(draftState(draft), expected);
    assert.equal(draft.questions, refs.cache);
    assert.equal(draft.selected, refs.selected);
    assert.equal(draft.warnings, refs.warnings);
    assert.equal(draft.diagnostics, refs.diagnostics);
    assert.match(status.at(-1), /本地解析器没有识别到有效题目/);
    assert.equal(context.aiImportRequestV99.running, false);
  });
}

function batchFixture() {
  const fixture = cancellationFixture({
    useRealIdentity: true, useRealResults: true,
    collectAiPreviewTargetDetailsV992: () => ({ indexes: [1, 3], baseIndexes: [1, 3] }),
    $: (selector) => (selector === '#ai-preview-batch-v991' ? { value: '1' } : null),
  });
  fixture.context.importDraft.questions = ['A', 'B', 'C', 'D', 'E'].map((id) => ({
    id, question: id === 'B' || id === 'D' ? '相同题干' : `题干 ${id}`, type: 'short', answer: [], options: [],
  }));
  return fixture;
}

for (const mutation of ['删除无关 A', '重排']) {
  test(`批量固定初始 B、D，${mutation}后仍发送原目标并按 ID 保存建议`, async () => {
    const { context, pending } = batchFixture();
    const task = context.startAiPreviewTaskV991();
    assert.equal(pending[0].messages[0].id, 'B');
    if (mutation === '删除无关 A') { context.importDraft.questions.shift(); } else {
      context.importDraft.questions.unshift(context.importDraft.questions.pop());
    }
    pending[0].resolve({ content: JSON.stringify({ results: [{ index: 2, analysis: 'B 解析' }] }) });
    await new Promise(setImmediate);
    assert.equal(pending.length, 2);
    const secondId = pending[1].messages[0].id;
    pending[1].resolve({ content: JSON.stringify({ results: [{ id: secondId, analysis: '第二题解析' }] }) });
    await task;
    assert.equal(secondId, 'D');
    assert.equal(context.getAnalysis('B').analysis, 'B 解析');
    assert.equal(context.getAnalysis('D').analysis, '第二题解析');
    assert.equal(context.getAnalysis('E'), undefined);
    assert.equal(context.aiPreviewRequestV991.running, false);
  });
}

for (const mutation of ['删除', '修改']) {
  test(`首批等待期间${mutation} D 时保留 B 建议并停止剩余批次`, async () => {
    const { context, pending, status } = batchFixture();
    const task = context.startAiPreviewTaskV991();
    if (mutation === '删除') { context.importDraft.questions.splice(3, 1); } else {
      context.importDraft.questions[3].question = '已修改';
    }
    pending[0].resolve({ content: JSON.stringify({ results: [{ id: 'B', analysis: 'B 解析' }] }) });
    await new Promise(setImmediate);
    if (pending[1]) { pending[1].resolve({ content: '{"results":[]}' }); }
    await task;
    assert.equal(pending.length, 1);
    assert.equal(context.getAnalysis('B').analysis, 'B 解析');
    assert.match(status.at(-1), /变化|重新选择/);
    assert.equal(context.aiPreviewRequestV991.running, false);
  });
}

test('批量目标重复 ID 时不发送任何请求', async () => {
  const { context, pending, status } = batchFixture();
  context.importDraft.questions[2].id = 'B';
  const task = context.startAiPreviewTaskV991();
  assert.equal(pending.length, 0);
  await task;
  assert.match(status.at(-1), /身份|重新选择/);
  assert.equal(context.aiPreviewRequestV991.running, false);
});

for (const mode of ['review', 'analysis']) {
  for (const value of ['', '0', '-1', '1.5', '31', 'Infinity', 'NaN']) {
    test(`${mode} 的非法批量 ${JSON.stringify(value)} 不发送请求`, async () => {
      const { context, pending, status } = cancellationFixture({
        aiPreviewPanelModeV991: mode,
        $: (selector) => (selector === '#ai-preview-batch-v991' ? { value } : null),
      });
      const task = context.startAiPreviewTaskV991();
      assert.equal(pending.length, 0);
      await task;
      assert.match(status.at(-1), /1.*30|批/);
    });
  }
}

for (const mode of ['review', 'analysis']) {
  test(`${mode} 31 题每批 30 道时实际发送 30 + 1`, async () => {
    const indexes = Array.from({ length: 31 }, (_, index) => index);
    const { context, pending } = cancellationFixture({
      useRealIdentity: true, useRealResults: true, aiPreviewPanelModeV991: mode,
      collectAiPreviewTargetDetailsV992: () => ({ indexes, baseIndexes: indexes }),
      $: (selector) => (selector === '#ai-preview-batch-v991' ? { value: '30' } : null),
    });
    context.importDraft.questions = indexes.map((index) => ({ id: `q-${index}`, question: `题 ${index}`, type: 'short', options: [], answer: [] }));
    const task = context.startAiPreviewTaskV991();
    assert.equal(pending[0].messages.length, 30);
    pending[0].resolve({ content: '{"results":[]}' });
    await new Promise(setImmediate);
    assert.equal(pending[1].messages.length, 1);
    pending[1].resolve({ content: '{"results":[]}' });
    await task;
    assert.equal(pending.length, 2);
  });
}

test('无 ID 的同一题目对象可在删除无关题后继续按原对象发送和归属', async () => {
  const { context, pending } = batchFixture();
  delete context.importDraft.questions[1].id;
  delete context.importDraft.questions[3].id;
  const task = context.startAiPreviewTaskV991();
  assert.equal(pending.length, 1);
  const firstKey = pending[0].messages[0].id;
  context.importDraft.questions.shift();
  pending[0].resolve({ content: JSON.stringify({ results: [{ id: firstKey, analysis: 'B 解析' }] }) });
  await new Promise(setImmediate);
  assert.equal(pending.length, 2);
  const secondKey = pending[1].messages[0].id;
  assert.notEqual(firstKey, secondKey);
  pending[1].resolve({ content: JSON.stringify({ results: [{ id: secondKey, analysis: 'D 解析' }] }) });
  await task;
  assert.equal(context.getAnalysis(firstKey).analysis, 'B 解析');
  assert.equal(context.getAnalysis(secondKey).analysis, 'D 解析');
});

test('无 ID 的同一对象重复出现在草稿时身份不唯一', async () => {
  const { context, pending, status } = batchFixture();
  delete context.importDraft.questions[1].id;
  context.importDraft.questions[3] = context.importDraft.questions[1];
  await context.startAiPreviewTaskV991();
  assert.equal(pending.length, 0);
  assert.match(status.at(-1), /身份/);
});

test('第三批目标提前变化时立即停止后续所有批次并保留首批建议', async () => {
  const { context, pending, status } = cancellationFixture({
    useRealIdentity: true, useRealResults: true,
    collectAiPreviewTargetDetailsV992: () => ({ indexes: [0, 1, 2], baseIndexes: [0, 1, 2] }),
    $: (selector) => (selector === '#ai-preview-batch-v991' ? { value: '1' } : null),
  });
  context.importDraft.questions = ['B', 'C', 'D'].map((id) => ({ id, question: id, type: 'short', options: [], answer: [] }));
  const task = context.startAiPreviewTaskV991();
  context.importDraft.questions[2].question = '已修改 D';
  pending[0].resolve({ content: JSON.stringify({ results: [{ id: 'B', analysis: 'B 建议' }] }) });
  await new Promise(setImmediate);
  if (pending[1]) {
    pending[1].resolve({ content: '{"results":[]}' });
    await new Promise(setImmediate);
    if (pending[2]) { pending[2].resolve({ content: '{"results":[]}' }); }
  }
  await task;
  assert.equal(pending.length, 1);
  assert.equal(context.getAnalysis('B').analysis, 'B 建议');
  assert.match(status.at(-1), /变化|重新选择/);
});

test('无 ID 目标题被同内容新对象替换时停止，不把建议附给新对象', async () => {
  const { context, pending, status } = batchFixture();
  delete context.importDraft.questions[3].id;
  const task = context.startAiPreviewTaskV991();
  context.importDraft.questions[3] = { ...context.importDraft.questions[3] };
  pending[0].resolve({ content: JSON.stringify({ results: [{ id: 'B', analysis: 'B 建议' }] }) });
  await new Promise(setImmediate);
  if (pending[1]) { pending[1].resolve({ content: '{"results":[]}' }); }
  await task;
  assert.equal(pending.length, 1);
  assert.equal(context.getAnalysis('B').analysis, 'B 建议');
  assert.match(status.at(-1), /变化|重新选择/);
});

test('已生成建议的题目内容或身份不再唯一时不能读取或采纳', async () => {
  const { context, pending } = batchFixture();
  const task = context.startAiPreviewTaskV991();
  pending[0].resolve({ content: JSON.stringify({ results: [{ id: 'B', analysis: 'B 建议' }] }) });
  await new Promise(setImmediate);
  pending[1].resolve({ content: JSON.stringify({ results: [{ id: 'D', analysis: 'D 建议' }] }) });
  await task;
  assert.equal(context.getAnalysis('B').analysis, 'B 建议');
  context.importDraft.questions[1].question = '更改后的 B';
  assert.equal(context.getAnalysis('B'), undefined);
  context.importDraft.questions[0].id = 'D';
  assert.equal(context.getAnalysis('D'), undefined);
});

for (const mode of ['review', 'analysis']) {
  test(`${mode} 上限允许 200 题，201 题不发送`, async () => {
    let total = 201;
    const { context, pending, status } = cancellationFixture({
      useRealIdentity: true, useRealResults: true, aiPreviewPanelModeV991: mode,
      collectAiPreviewTargetDetailsV992: () => {
        const indexes = Array.from({ length: total }, (_, index) => index);
        return { indexes, baseIndexes: indexes };
      },
      $: (selector) => (selector === '#ai-preview-batch-v991' ? { value: '30' } : null),
    });
    context.importDraft.questions = Array.from({ length: 201 }, (_, index) => ({ id: `limit-${index}`, question: `题 ${index}`, type: 'short', options: [], answer: [] }));
    await context.startAiPreviewTaskV991();
    assert.equal(pending.length, 0);
    assert.match(status.at(-1), /200/);
    total = 200;
    const task = context.startAiPreviewTaskV991();
    for (let index = 0;index < 7;index += 1) {
      assert.equal(pending[index].messages.length, index === 6 ? 20 : 30);
      pending[index].resolve({ content: '{"results":[]}' });
      await new Promise(setImmediate);
    }
    await task;
    assert.equal(pending.length, 7);
  });
}

for (const code of [400, 422]) {
  test(`第三批目标变化后首次 API 返回 ${code} 不再发兼容重试`, async () => {
    const response = deferred();
    const calls = [];
    const platform = { credentials: { native: false, status: () => '' }, network: { ai: async (_config, payload) => {
      calls.push(payload);
      if (calls.length === 1) { return response.promise; }
      return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"{\\"results\\":[]}"}}]}' };
    } } };
    const { context, status } = cancellationFixture({
      useRealIdentity: true, useRealResults: true, useRealNetworkTransport: true, ShirohaPlatform: platform,
      collectAiPreviewTargetDetailsV992: () => ({ indexes: [0, 1, 2], baseIndexes: [0, 1, 2] }),
      $: (selector) => (selector === '#ai-preview-batch-v991' ? { value: '1' } : null),
    });
    context.importDraft.questions = ['B', 'C', 'D'].map((id) => ({ id, question: id, type: 'short', options: [], answer: [] }));
    const task = context.startAiPreviewTaskV991();
    assert.equal(calls.length, 1);
    context.importDraft.questions[2].question = '已修改 D';
    response.resolve({ ok: false, status: code, text: async () => '不支持格式' });
    await task;
    assert.equal(calls.length, 1);
    assert.match(status.at(-1), /变化|重新选择/);
    assert.equal(context.aiPreviewRequestV991.running, false);
  });
}

test('草稿失效提示保持准确，旧结果不能覆盖随后启动的整理', async () => {
  const { context, pending, status, notices } = cancellationFixture();
  const old = context.startAiImportV99();
  context.invalidateAiImportRequestV99();
  assert.match(status.at(-1), /变化.*停止/);
  assert.equal(context.aiImportRequestV99.running, false);
  const next = context.startAiImportV99();
  const newStatus = status.slice();
  const newNotices = notices.slice();
  pending[0].resolve({ content: '旧结果' });
  await old;
  assert.deepEqual(status, newStatus);
  assert.deepEqual(notices, newNotices);
  assert.equal(context.aiImportRequestV99.running, true);
  pending[1].resolve({ content: '新结果' });
  await next;
  assert.equal(context.importDraft.questions[0].question, '新结果');
  assert.equal(context.aiImportRequestV99.running, false);
});

for (const target of ['B', 'D']) {
  test(`批量运行时目标题 ${target} 编辑后复原仍使该目标失效`, async () => {
    const { context, pending, status } = batchFixture();
    const task = context.startAiPreviewTaskV991();
    const index = target === 'B' ? 1 : 3;
    const question = context.importDraft.questions[index];
    const original = question.question;
    context.removeAiSuggestionsForQuestionV991(question, index);
    question.question = '临时编辑';
    question.question = original;
    pending[0].resolve({ content: JSON.stringify({ results: [{ id: 'B', analysis: 'B 建议' }] }) });
    await new Promise(setImmediate);
    if (pending[1]) { pending[1].resolve({ content: '{"results":[]}' }); }
    await task;
    assert.equal(pending.length, 1);
    assert.match(status.at(-1), /变化|重新选择/);
    if (target === 'D') { assert.equal(context.getAnalysis('B').analysis, 'B 建议'); } else {
      assert.equal(context.getAnalysis('B'), undefined);
    }
  });
}

test('目标失效后取消并重启，新批次不继承旧任务的失效记录', async () => {
  const { context, pending, status } = batchFixture();
  const old = context.startAiPreviewTaskV991();
  context.removeAiSuggestionsForQuestionV991(context.importDraft.questions[1], 1);
  context.cancelAiPreviewRequestV991(true);
  const next = context.startAiPreviewTaskV991();
  assert.equal(pending.length, 2);
  const statusBeforeOld = status.slice();
  pending[0].resolve({ content: '{"results":[]}' });
  await old;
  assert.deepEqual(status, statusBeforeOld);
  pending[1].resolve({ content: JSON.stringify({ results: [{ id: 'B', analysis: '新 B' }] }) });
  await new Promise(setImmediate);
  assert.equal(pending.length, 3);
  pending[2].resolve({ content: JSON.stringify({ results: [{ id: 'D', analysis: '新 D' }] }) });
  await next;
  assert.equal(context.getAnalysis('B').analysis, '新 B');
  assert.equal(context.getAnalysis('D').analysis, '新 D');
  assert.equal(context.aiPreviewRequestV991.running, false);
});

for (const kind of ['import', 'preview']) {
  for (const ending of ['cancel', 'failure', 'success']) {
    test(`${kind} ${ending} 结束时每个可见面板只同步一次`, async () => {
      const counts = { import: 0, preview: 0 };
      const { context, pending } = cancellationFixture({
        syncAiImportActionV99: () => { counts.import += 1;counts.preview += 1; },
        refreshAiImportPanelV99: () => { counts.import += 1; },
        refreshAiPreviewPanelV991: () => { counts.preview += 1; },
      });
      const task = kind === 'import' ? context.startAiImportV99() : context.startAiPreviewTaskV991();
      assert.equal(pending.length, 1);
      counts.import = 0;counts.preview = 0;
      if (ending === 'cancel') {
        if (kind === 'import') { context.cancelAiImportRequestV99(false); } else { context.cancelAiPreviewRequestV991(false); }
        pending[0].resolve({ content: '迟到结果' });
      } else if (ending === 'failure') {
        pending[0].reject(new Error('测试失败'));
      } else {
        pending[0].resolve({ content: '成功结果' });
      }
      await task;
      console.log(`session ${kind}/${ending} refresh: ${JSON.stringify(counts)}`);
      assert.deepEqual(counts, { import: 1, preview: 1 });
    });
  }
}
