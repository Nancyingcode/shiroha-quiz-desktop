'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { loadWebSource, runWebScripts } = require('./source-tools.cjs');

function element() {
  return { classList: { add() {}, remove() {} }, innerHTML: '', value: '', checked: false, indeterminate: false };
}

function editorFixture() {
  const nodes = Object.fromEntries(['#import-report-panel', '#import-preview tbody', '#import-summary', '#import-preview-filter', '#confirm-import-btn', '#import-select-all-visible'].map((name) => [name, element()]));
  const checkbox = { dataset: { selectImport: '1' }, checked: false };
  const questions = Array.from({ length: 500 }, (_, index) => {
    let issue = '异常：需核对';
    if (index % 3 === 0) { issue = '正常'; } else if (index % 3 === 1) { issue = '缺少答案'; }
    return { id: `q-${index}`, type: 'single', question: `题${index + 1}`, options: [], answer: [], issue };
  });
  const draft = { questions, selected: new Set([10]), warnings: [], report: '样本报告', filter: 'priority', diagnostics: { profile: {}, expected: { total: 500 } } };
  let diagnostics = 0;
  const context = vm.createContext({});
  runWebScripts(context, ['question-editor.js']);
  const editor = context.ShirohaQuestionEditor.create({
    state: {},
    draft,
    session: {},
    select: (name) => nodes[name] || null,
    selectAll: (name) => (name === '[data-select-import]' ? [checkbox] : []),
    escape: (value) => String(value),
    label: (value) => String(value),
    short: (value) => value,
    parser: { countTypes: (items) => ({ single: items.length }), issueStatus: (question) => { diagnostics += 1;return question.issue; } },
    suggestions: { renderRow: () => '', bind() {}, sync() {}, invalidateImport() {} },
    editor: { updateBankUi() {}, syncAppend() {} },
    practice: {},
    view: {},
    storage: {},
  });
  return { editor, draft, nodes, checkbox, count: () => diagnostics, reset: () => { diagnostics = 0; } };
}

test('普通预览一轮复用诊断且编辑后重新计算排序和报告', () => {
  const f = editorFixture();
  const counts = [];
  f.editor.renderImportPreview(f.draft.questions);
  counts.push(f.count());
  assert.match(f.nodes['#import-report-panel'].innerHTML, /错误\/异常<\/span><b>167\/166<\/b>/);
  const ordered = [...f.nodes['#import-preview tbody'].innerHTML.matchAll(/data-select-import="(\d+)"/g)].map((match) => Number(match[1]));
  const expected = [...Array(500).keys()].sort((a, b) => Number(a % 3 === 0) - Number(b % 3 === 0) || a - b);
  assert.deepEqual(ordered, expected);
  f.reset();f.checkbox.checked = true;f.checkbox.onchange();counts.push(f.count());
  assert.deepEqual([...f.draft.selected].sort((a, b) => a - b), [1, 10]);
  assert.match(f.nodes['#import-summary'].innerHTML, /已选择 2 道/);
  f.reset();f.draft.questions[0].issue = '缺少答案';f.editor.renderImportPreview(f.draft.questions);counts.push(f.count());
  assert.match(f.nodes['#import-report-panel'].innerHTML, /错误\/异常<\/span><b>168\/166<\/b>/);
  assert.match(f.nodes['#import-preview tbody'].innerHTML, /data-select-import="0"/);
  console.log(`ordinary preview diagnostics: ${JSON.stringify(counts)}`);
  assert.deepEqual(counts, [500, 500, 500]);
});

function targetFixture() {
  const questions = Array.from({ length: 500 }, (_, index) => ({ id: `q-${index}`, issue: index % 3 === 0 ? '正常' : '异常：需核对', analysis: ['', 'x'.repeat(19), 'x'.repeat(20), '   x   '][index % 4] }));
  const draft = { questions, selected: new Set([499, 4, -1, 9, 700]), filter: 'all', diagnostics: { profile: {} } };
  const nodes = { '#ai-preview-range-start-v992': { value: '17' }, '#ai-preview-range-end-v992': { value: '40' } };
  let diagnostics = 0;
  const context = vm.createContext({});
  runWebScripts(context, ['ai-import-panel.js']);
  const panel = context.ShirohaAiImportPanel.create({ draft, sessions: { importRequest: {}, previewRequest: {} }, platform: {}, select: (name) => nodes[name] || null, selectAll: () => [], settings: {}, requests: {}, editor: {}, preview: { status: (question) => { diagnostics += 1;return question.issue; } }, limits: {} });
  return { draft, nodes, panel, count: () => diagnostics, reset: () => { diagnostics = 0; } };
}

function expectedTargets(draft, mode, scope, condition) {
  let base = [...draft.questions.keys()];
  if (scope === 'range') { base = base.slice(16, 40); }
  if (scope === 'selected') { base = [...draft.selected].filter((index) => index >= 0 && index < draft.questions.length).sort((a, b) => a - b); }
  if (scope === 'problem') { base = base.filter((index) => draft.questions[index].issue !== '正常'); }
  if (scope === 'visible' && draft.filter === 'problem') { base = base.filter((index) => draft.questions[index].issue !== '正常'); }
  if (scope === 'visible' && draft.filter === 'normal') { base = base.filter((index) => draft.questions[index].issue === '正常'); }
  if (scope === 'visible' && draft.filter === 'priority') { base.sort((a, b) => Number(draft.questions[a].issue === '正常') - Number(draft.questions[b].issue === '正常') || a - b); }
  let indexes = base;
  if (mode === 'analysis' && condition === 'missing') { indexes = base.filter((index) => !draft.questions[index].analysis.trim()); }
  if (mode === 'analysis' && condition === 'short') { indexes = base.filter((index) => draft.questions[index].analysis.trim().length < 20); }
  return { base, indexes };
}

test('AI 目标的 108 组范围与筛选保持索引和顺序并按需诊断', () => {
  const f = targetFixture();
  const measurements = {};
  const excessive = [];
  let combinations = 0;
  for (const mode of ['review', 'analysis']) {
    const scopes = mode === 'review' ? ['range', 'problem', 'selected', 'visible', 'all'] : ['range', 'selected', 'visible', 'all'];
    for (const scope of scopes) {
      for (const filter of ['all', 'problem', 'normal', 'priority']) {
        for (const condition of ['missing', 'short', 'all']) {
          f.draft.filter = filter;f.reset();
          const result = f.panel.collectAiPreviewTargetDetailsV992(mode, scope, condition);
          const expected = expectedTargets(f.draft, mode, scope, condition);
          assert.deepEqual(Array.from(result.baseIndexes), expected.base, `${mode}/${scope}/${filter}/${condition} 基础索引`);
          assert.deepEqual(Array.from(result.indexes), expected.indexes, `${mode}/${scope}/${filter}/${condition} 最终索引`);
          assert.equal(result.error, '');
          const needsStatus = scope === 'problem' || (scope === 'visible' && filter !== 'all');
          const limit = needsStatus ? 500 : 0;
          const count = f.count();
          measurements[`${scope}/${filter}`] = count;
          if (count > limit) { excessive.push(`${mode}/${scope}/${filter}/${condition}: ${count} > ${limit}`); }
          combinations += 1;
        }
      }
    }
  }
  assert.equal(combinations, 108);
  console.log(`AI target diagnostics: ${JSON.stringify(measurements)}`);
  assert.deepEqual(excessive, []);
});

test('AI 自定义题号范围错误保留原有提示且不做题目诊断', () => {
  const f = targetFixture();
  for (const [start, end, message] of [['', '3', /从 1 开始/], ['1.5', '3', /完整/], ['0', '3', /从 1 开始/], ['5', '4', /不能大于/], ['1', '501', /不能超过/]]) {
    f.nodes['#ai-preview-range-start-v992'].value = start;f.nodes['#ai-preview-range-end-v992'].value = end;f.reset();
    const result = f.panel.collectAiPreviewTargetDetailsV992('review', 'range', 'all');
    assert.match(result.error, message);
    assert.deepEqual(Array.from(result.baseIndexes), []);
    assert.deepEqual(Array.from(result.indexes), []);
    assert.equal(f.count(), 0);
  }
});

function uiElement(hidden = false) {
  const classes = new Set(hidden ? ['ai-hidden-v99'] : []);
  return {
    dataset: {},
    value: '',
    textContent: '',
    className: '',
    disabled: false,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, enabled) { if (enabled) { classes.add(name); } else { classes.delete(name); } },
    },
    setAttribute() {},
    scrollIntoView() {},
  };
}

function panelUiFixture() {
  const counts = { import: 0, preview: 0, options: 0, pill: 0, practice: 0, review: 0 };
  const nodes = {};
  for (const name of ['ai-import-panel-v99', 'ai-preview-panel-v991', 'ai-import-provider-v99', 'ai-preview-title-v991', 'ai-preview-status-v991', 'ai-organize-import-btn-v99', 'ai-review-import-btn-v991', 'ai-analysis-import-btn-v991', 'ai-preview-range-start-v992', 'ai-preview-range-end-v992', 'ai-preview-condition-v992', 'ai-preview-batch-v991']) { nodes[`#${name}`] = uiElement(); }
  for (const [name, key] of [['#ai-import-provider-v99', 'import'], ['#ai-preview-title-v991', 'preview']]) {
    let value = '';
    Object.defineProperty(nodes[name], 'textContent', { get: () => value, set: (next) => { value = next;counts[key] += 1; } });
  }
  function makeScope() {
    const node = uiElement();let html = '';
    Object.defineProperty(node, 'innerHTML', {
      get: () => html,
      set: (value) => {
        html = value;counts.options += 1;
        node.value = [...html.matchAll(/value="([^"]+)"/g)][0]?.[1] || '';
      },
    });
    return node;
  }
  nodes['#ai-preview-scope-v991'] = makeScope();
  nodes['#ai-preview-range-start-v992'].value = '1';nodes['#ai-preview-range-end-v992'].value = '3';
  nodes['#ai-preview-condition-v992'].value = 'missing';nodes['#ai-preview-batch-v991'].value = '20';
  let selectedScope = 'all';
  const all = uiElement();const selection = uiElement();
  function bindRadio(node, scope) {
    Object.defineProperty(node, 'checked', { get: () => selectedScope === scope, set: (value) => { if (value) { selectedScope = scope; } } });
  }
  bindRadio(all, 'all');bindRadio(selection, 'selection');
  nodes['#ai-import-scope-all-v992'] = all;nodes['#ai-import-scope-selection-v992'] = selection;
  const listeners = new Map();
  const field = uiElement();field.value = 'abcdefghij';field.selectionStart = 0;field.selectionEnd = 3;
  field.addEventListener = (name, callback) => { if (!listeners.has(name)) { listeners.set(name, []); } listeners.get(name).push(callback); };
  nodes['#import-text'] = field;
  const draft = { questions: [{ id: '1', analysis: '' }, { id: '2', analysis: '' }, { id: '3', analysis: '' }], selected: new Set(), filter: 'all', diagnostics: {} };
  const sessions = { importRequest: { running: false }, previewRequest: { running: false } };
  let notification = () => { throw new Error('未绑定通知'); };
  const context = vm.createContext({});runWebScripts(context, ['ai-import-sessions.js', 'ai-import-panel.js']);
  const panel = context.ShirohaAiImportPanel.create({
    draft,
    sessions,
    platform: { harness: { bind: (callback) => { notification = callback; } } },
    select: (name) => nodes[name] || null,
    selectAll: (name) => (name === 'input[name="ai-import-scope-v992"]' ? [all, selection] : []),
    settings: {
      presets: {},
      config: () => ({ execution: 'api', endpoint: 'https://example.invalid', model: 'mock' }),
      configured: () => true,
      availability: () => ({ state: 'ready' }),
      isHarness: () => false,
      executionLabel: () => 'mock',
      localEndpoint: () => false,
      updatePill: () => { counts.pill += 1; },
      render() {},
    },
    requests: { busy: () => false, invalidateImport() {} },
    editor: { isEditing: () => false },
    preview: { status: () => '正常', renderPracticeAi: () => { counts.practice += 1; }, updateReview: () => { counts.review += 1; } },
    limits: { importChars: 50000, items: 200, analysisBatch: 10, reviewBatch: 20 },
  });
  const reset = () => { for (const key of Object.keys(counts)) { counts[key] = 0; } };
  const fire = (name) => { for (const callback of listeners.get(name) || []) { callback(); } };
  return { panel, nodes, counts, reset, fire, notify: () => notification(), makeScope, field, all, selection };
}

test('绑定与 Harness 通知对每个可见面板只同步一次', () => {
  const f = panelUiFixture();f.panel.bindAiImportEventsV99();
  const bind = { ...f.counts };f.reset();f.notify();const notify = { ...f.counts };
  console.log(`panel refresh baseline: ${JSON.stringify({ bind, notify })}`);
  assert.equal(bind.import, 1);assert.equal(bind.preview, 1);
  assert.equal(notify.import, 1);assert.equal(notify.preview, 1);
  assert.equal(notify.pill, 1);assert.equal(notify.practice, 1);assert.equal(notify.review, 1);
});

test('范围选项同模式刷新不重建，模式或节点更换时重建并保留重置语义', () => {
  const f = panelUiFixture();f.panel.bindAiImportEventsV99();f.reset();
  f.nodes['#ai-preview-scope-v991'].value = 'all';
  f.panel.refreshAiPreviewPanelV991();f.panel.refreshAiPreviewPanelV991();
  const ordinaryWrites = f.counts.options;
  assert.equal(f.nodes['#ai-preview-scope-v991'].value, 'all');
  f.reset();f.nodes['#ai-analysis-import-btn-v991'].onclick();
  assert.equal(f.counts.options, 1);assert.equal(f.nodes['#ai-preview-scope-v991'].value, 'range');
  assert.equal(f.nodes['#ai-preview-batch-v991'].value, '10');
  assert.equal(f.nodes['#ai-preview-range-start-v992'].value, '1');assert.equal(f.nodes['#ai-preview-range-end-v992'].value, '3');
  assert.equal(f.nodes['#ai-preview-condition-v992'].value, 'missing');
  assert.doesNotMatch(f.nodes['#ai-preview-scope-v991'].innerHTML, /value="problem"/);
  f.reset();f.nodes['#ai-review-import-btn-v991'].onclick();assert.equal(f.counts.options, 1);
  assert.match(f.nodes['#ai-preview-scope-v991'].innerHTML, /value="problem"/);
  assert.equal(f.nodes['#ai-preview-batch-v991'].value, '20');
  f.reset();f.nodes['#ai-preview-scope-v991'] = f.makeScope();f.panel.refreshAiPreviewPanelV991();assert.equal(f.counts.options, 1);
  f.panel.setAiPreviewStatusV991('保留提示', 'ok');f.panel.refreshAiPreviewPanelV991();
  assert.equal(f.nodes['#ai-preview-status-v991'].textContent, '保留提示');
  console.log(`ordinary scope option writes: ${ordinaryWrites}`);
  assert.equal(ordinaryWrites, 0);
});

test('隐藏导入面板时失效选区立即改回全文并在重开后保持', () => {
  const f = panelUiFixture();f.panel.bindAiImportEventsV99();f.fire('select');f.selection.checked = true;
  assert.equal(f.panel.aiImportRangeV992().scope, 'selection');
  f.panel.closeAiImportPanelV99();f.field.value = '新的全文';f.fire('input');
  assert.equal(f.panel.aiImportRangeV992().scope, 'all');
  assert.equal(f.panel.aiImportRangeV992().text, '新的全文');
  f.nodes['#ai-organize-import-btn-v99'].onclick();
  assert.equal(f.panel.aiImportRangeV992().scope, 'all');
});

test('隐藏导入面板在取消或结束同步时纠正已失效选区', () => {
  for (const reason of ['cancel', 'finish']) {
    const f = panelUiFixture();f.panel.bindAiImportEventsV99();f.fire('select');f.selection.checked = true;
    f.panel.closeAiImportPanelV99();f.field.value = `变化后的全文-${reason}`;
    f.panel.syncAiImportActionV99();
    assert.equal(f.panel.aiImportRangeV992().scope, 'all');
    assert.equal(f.panel.aiImportRangeV992().text, `变化后的全文-${reason}`);
    f.nodes['#ai-organize-import-btn-v99'].onclick();
    assert.equal(f.panel.aiImportRangeV992().scope, 'all');
  }
});

test('主动修改范围清除旧提示，普通刷新保留提示', () => {
  const f = panelUiFixture();f.panel.bindAiImportEventsV99();
  f.panel.setAiPreviewStatusV991('保留提示', 'ok');f.panel.refreshAiPreviewPanelV991();
  assert.equal(f.nodes['#ai-preview-status-v991'].textContent, '保留提示');
  f.nodes['#ai-preview-scope-v991'].value = 'all';f.nodes['#ai-preview-scope-v991'].onchange();
  assert.notEqual(f.nodes['#ai-preview-status-v991'].textContent, '保留提示');
  assert.equal(f.nodes['#ai-preview-status-v991'].dataset.stickyV991, undefined);
});

test('全局渲染只通过导入同步入口刷新一次预览面板', () => {
  const counts = { import: 0, preview: 0 };
  const names = ['ensureBankGroupUiV58', 'ensurePracticeScopeV8916', 'updateAiConnectionPillV99', 'renderStats', 'renderBankSelect', 'renderMergeSelect', 'renderBankList', 'renderBankPreview', 'renderWrongBook', 'renderFavoritesPageV596', 'renderRecords', 'renderRecentTraining', 'renderBankInputs', 'renderBuiltInPanelV252', 'renderPracticeScopeUiV8916', 'renderExportBankSelectorV23', 'renderImportTargetBankOptionsV59', 'syncImportAppendUiV59', 'syncHomeVersionPromptV586', 'syncPracticeStartUiV58916'];
  const context = vm.createContext({
    ...Object.fromEntries(names.map((name) => [name, () => {}])),
    syncAiImportActionV99() { counts.import += 1;counts.preview += 1; },
    syncAiPreviewToolsV991() { counts.preview += 1; },
  });
  vm.runInContext(`${loadWebSource().functionSource('renderAll')}\nrenderAll();`, context);
  assert.deepEqual(counts, { import: 1, preview: 1 });
});

test('隐藏面板内选区变空时立即切回全文且不重绘面板', () => {
  const f = panelUiFixture();f.panel.bindAiImportEventsV99();f.fire('select');f.selection.checked = true;
  f.panel.closeAiImportPanelV99();f.reset();
  f.field.selectionStart = 2;f.field.selectionEnd = 2;f.fire('select');
  assert.equal(f.panel.aiImportRangeV992().scope, 'all');
  assert.equal(f.panel.aiImportRangeV992().text, 'abcdefghij');
  assert.equal(f.counts.import, 0);assert.equal(f.counts.preview, 0);
});

test('同模式范围值失效时恢复默认而不重建选项', () => {
  const f = panelUiFixture();f.panel.bindAiImportEventsV99();f.reset();
  f.nodes['#ai-preview-scope-v991'].value = '';
  f.panel.refreshAiPreviewPanelV991();
  assert.equal(f.nodes['#ai-preview-scope-v991'].value, 'range');
  assert.equal(f.counts.options, 0);
});
