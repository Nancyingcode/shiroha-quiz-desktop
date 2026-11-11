'use strict';
const { loadWebSource, runWebScripts } = require('./source-tools.cjs');

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { loadWeb, plain } = require('./web-source.cjs');
const { webState } = require('./fixtures/dataset.cjs');

const source = loadWebSource();

function setup(data, { mode = 'auto', accepted = true } = {}) {
  const { api } = loadWeb();
  const original = [{ question: '之前的识别预览', answer: ['A'] }];
  const input = { value: JSON.stringify(data), dataset: {} };
  const elements = {
    '#import-text': input, '#import-strategy': { value: 'auto' },
    '#import-mode': { value: mode }, '#confirm-import-btn': { disabled: true },
  };
  const confirmations = []; const imports = []; const notices = []; const previews = [];
  const context = vm.createContext({
    $: (selector) => elements[selector],
    invalidateAiImportRequestV99() {}, cancelAiPreviewRequestV991() {}, resetAiSuggestionsV991() {}, closeAiPreviewPanelV991() {},
    normalizeQuestion: api.normalizeQuestion, normalizeBackupPayloadV23: api.normalizeBackupPayloadV23,
    countUnresolvedBackupImagesV24: api.countUnresolvedBackupImagesV24,
    ShirohaPlatform: { storage: {} },
    ShirohaDialogs: { confirm: async (message) => { confirmations.push(message); return accepted; } },
    runMutation: async (action) => action(),
    applyBackupImportV23: async (...args) => { imports.push(args); },
    renderImportPreview: (questions) => previews.push(plain(questions)),
    collectImportWarnings: () => [], collectSoftRiskWarnings: () => [], countTypes: () => ({}),
    largeImportRiskMessageV376: () => '', summarizeImportResultV376: () => '识别完成',
    showNotice: (...args) => notices.push(args), toast: (...args) => notices.push(args),
  });
  runWebScripts(context, ['import-preview.js']);
  context.importDraft = context.ShirohaImportPreview.create({ readers: {}, ocr: {} });
  context.importDraft.questions = original;
  context.importDraft.sourceMeta = { name: 'fixture.json' };
  vm.runInContext(source.between('tryParseAutoJsonImportV58922', 'loadDualSample'), context);
  return { context, input, original, confirmations, imports, notices, previews, elements };
}

for (const mode of ['auto', 'json']) {
  test(`${mode} 模式识别完整备份后确认合并，保留题库分组与学习数据`, async () => {
    const payload = webState();
    const run = setup(payload, { mode });
    await run.context.parseImport();
    assert.equal(run.confirmations.length, 1);
    assert.match(run.confirmations[0], /2 个题库/);
    assert.match(run.confirmations[0], /8 道题/);
    assert.match(run.confirmations[0], /合并/);
    assert.equal(run.imports.length, 1);
    const [normalized, importMode] = run.imports[0];
    assert.equal(importMode, 'merge');
    assert.deepEqual(plain(normalized.banks.map((bank) => [bank.id, bank.name, bank.groupName])), payload.banks.map((bank) => [bank.id, bank.name, bank.groupName]));
    for (const key of ['wrongBook', 'favorites', 'records']) { assert.deepEqual(plain(normalized[key]), payload[key]); }
    assert.deepEqual(run.previews, [[]]);
  });
}

test('取消备份合并不写入，也不替换之前的识别预览和原始文本', async () => {
  const run = setup(webState(), { accepted: false });
  const text = run.input.value;
  await run.context.parseImport();
  assert.equal(run.confirmations.length, 1);
  assert.deepEqual(run.imports, []);
  assert.equal(run.context.importDraft.questions, run.original);
  assert.equal(run.input.value, text);
  assert.deepEqual(run.previews, []);
});

test('未来版本备份拒绝导入，不能作为普通题目绕过备份版本校验', async () => {
  const run = setup({ ...webState(), schemaVersion: 999 });
  await run.context.parseImport();
  assert.deepEqual(run.confirmations, []);
  assert.deepEqual(run.imports, []);
  assert(run.notices.some((args) => args.some((value) => /不支持此备份版本/.test(String(value)))));
});

for (const shape of ['bank', 'array']) {
  test(`原有单题库和题目数组仍生成识别预览：${shape}`, async () => {
    const bank = webState().banks[0];
    const run = setup(shape === 'bank' ? bank : bank.questions);
    await run.context.parseImport();
    assert.deepEqual(run.confirmations, []);
    assert.deepEqual(run.imports, []);
    assert.equal(run.previews[0].length, bank.questions.length);
    assert.equal(run.elements['#confirm-import-btn'].disabled, false);
  });
}
