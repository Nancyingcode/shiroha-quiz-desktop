'use strict';
const { runWebScripts } = require('./source-tools.cjs');

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { loadWeb, plain } = require('./web-source.cjs');
const { webState } = require('./fixtures/dataset.cjs');

function setup(data, {
  mode = 'auto',
  accepted = true,
  onConfirm,
  beforeMutation,
  save = async () => {},
} = {}) {
  const { api } = loadWeb();
  const original = [{ question: '之前的识别预览', answer: ['A'] }];
  const input = { value: JSON.stringify(data), dataset: {} };
  const elements = {
    '#import-text': input,
    '#import-strategy': { value: 'auto' },
    '#import-mode': { value: mode },
    '#confirm-import-btn': { disabled: true },
    '#import': { classList: { contains: (name) => name === 'active' } },
  };
  const confirmations = []; const imports = []; const notices = []; const previews = [];
  let retry;
  const context = vm.createContext({ Blob });
  runWebScripts(context, ['ui/i18n-messages.js', 'ui/i18n.js']);
  runWebScripts(context, ['import-preview.js', 'backup/restore.js', 'import/page.js']);
  const draft = context.ShirohaImportPreview.create({ readers: {}, ocr: {} });
  const backupRestore = context.ShirohaBackupRestore.create({
    platform: { storage: {}, credentials: {} },
    data: {
      merge: (normalized) => imports.push([normalized, 'merge']),
      upgrade() {},
      ensureDefaultBank() {},
    },
    storage: { save, saveFailed: () => false },
    view: { refresh() {}, toast() {} },
  });
  draft.questions = original;
  draft.sourceMeta = { name: 'fixture.json' };
  const page = context.ShirohaImportPage.create({
    draft,
    view: {
      select: (selector) => elements[selector],
      renderImportPreview: (questions) => previews.push(plain(questions)),
      formatBytesV376() {},
      showNotice: (...args) => notices.push(args),
      toast: (...args) => notices.push(args),
    },
    parsing: {
      normalizeQuestion: api.normalizeQuestion,
      countTypes: () => ({}),
      collectImportWarnings: () => [],
      collectSoftRiskWarnings: () => [],
    },
    banks: {},
    editor: {},
    actions: {},
    ai: { invalidateAiImportRequestV99() {}, cancelAiPreviewRequestV991() {}, resetAiSuggestionsV991() {} },
    panel: { closeAiPreviewPanelV991() {} },
    ocr: {},
    backup: {
      confirm: async (message) => {
        confirmations.push(message);
        await onConfirm?.(input, draft);
        return accepted;
      },
      normalizeBackupPayloadV23: api.normalizeBackupPayloadV23,
      countUnresolvedBackupImagesV24: api.countUnresolvedBackupImagesV24,
      applyLocalBackup: backupRestore.applyLocalBackup,
      runMutation: async (action, onRetry) => {
        retry = onRetry;
        await beforeMutation?.(input, draft);
        return action();
      },
    },
  });
  return {
    page,
    draft,
    input,
    original,
    confirmations,
    imports,
    notices,
    previews,
    elements,
    retry: () => retry(),
  };
}

for (const mode of ['auto', 'json']) {
  test(`${mode} 模式识别完整备份后确认合并，保留题库分组与学习数据`, async () => {
    const payload = webState();
    const run = setup(payload, { mode });
    await run.page.parseImport();
    assert.equal(run.confirmations.length, 1);
    assert.match(run.confirmations[0], /2 个题库/);
    assert.match(run.confirmations[0], /8 道题/);
    assert.match(run.confirmations[0], /合并/);
    assert.equal(run.imports.length, 1);
    const [normalized, importMode] = run.imports[0];
    assert.equal(importMode, 'merge');
    assert.deepEqual(
      plain(normalized.banks.map((bank) => [bank.id, bank.name, bank.groupName])),
      payload.banks.map((bank) => [bank.id, bank.name, bank.groupName]),
    );
    for (const key of ['wrongBook', 'favorites', 'records']) { assert.deepEqual(plain(normalized[key]), payload[key]); }
    assert.deepEqual(run.previews, [[]]);
  });
}

test('取消备份合并不写入，也不替换之前的识别预览和原始文本', async () => {
  const run = setup(webState(), { accepted: false });
  const text = run.input.value;
  await run.page.parseImport();
  assert.equal(run.confirmations.length, 1);
  assert.deepEqual(run.imports, []);
  assert.equal(run.draft.questions, run.original);
  assert.equal(run.input.value, text);
  assert.deepEqual(run.previews, []);
});

test('未来版本备份拒绝导入，不能作为普通题目绕过备份版本校验', async () => {
  const run = setup({ ...webState(), schemaVersion: 999 });
  await run.page.parseImport();
  assert.deepEqual(run.confirmations, []);
  assert.deepEqual(run.imports, []);
  assert(run.notices.some((args) => args.some((value) => /不支持此备份版本/.test(String(value)))));
});

for (const shape of ['bank', 'array']) {
  test(`原有单题库和题目数组仍生成识别预览：${shape}`, async () => {
    const bank = webState().banks[0];
    const run = setup(shape === 'bank' ? bank : bank.questions);
    await run.page.parseImport();
    assert.deepEqual(run.confirmations, []);
    assert.deepEqual(run.imports, []);
    assert.equal(run.previews[0].length, bank.questions.length);
    assert.equal(run.elements['#confirm-import-btn'].disabled, false);
  });
}

test('确认合并期间更换输入后，旧备份不进入事务', async () => {
  const run = setup(webState(), {
    onConfirm(input, draft) {
      draft.invalidateRead('single');
      input.value = '已换成新原文';
    },
  });
  await run.page.parseImport();
  assert.equal(run.confirmations.length, 1);
  assert.deepEqual(run.imports, []);
  assert.deepEqual(run.previews, []);
  assert.equal(run.input.value, '已换成新原文');
  assert.equal(run.draft.questions, run.original);
});

test('事务等待原生读取时来源代次变化，保留字面相同的新输入', async () => {
  const run = setup(webState(), {
    beforeMutation(_input, draft) {
      draft.invalidateRead('single');
    },
  });
  const input = run.input.value;
  await run.page.parseImport();
  assert.equal(run.confirmations.length, 1);
  assert.equal(run.imports.length, 0);
  assert.equal(run.input.value, input);
  assert.equal(run.draft.questions, run.original);
});

test('备份合并保存失败保留原预览、勾选、报告及诊断', async () => {
  const run = setup(webState(), {
    save: async () => {
      throw new Error('测试保存失败');
    },
  });
  run.draft.report = '之前的识别报告';
  run.draft.diagnostics = { mode: '之前的识别方式' };
  run.draft.warnings = ['之前的诊断提示'];
  run.draft.selected.add(0);
  await run.page.parseImport();
  assert.equal(run.confirmations.length, 1);
  assert.deepEqual(run.previews, []);
  assert.equal(run.draft.questions, run.original);
  assert.equal(run.draft.report, '之前的识别报告');
  assert.equal(run.draft.diagnostics.mode, '之前的识别方式');
  assert.deepEqual(run.draft.warnings, ['之前的诊断提示']);
  assert.deepEqual([...run.draft.selected], [0]);
  assert(run.notices.some((args) => args.some((value) => /测试保存失败/.test(String(value)))));
});

test('备份合并失败后换源，全局重试不再应用旧备份', async () => {
  const run = setup(webState(), {
    save: async () => {
      throw new Error('测试保存失败');
    },
  });
  await run.page.parseImport();
  assert.equal(run.imports.length, 1);
  run.draft.invalidateRead('single');
  run.input.value = '当前待识别题目';
  assert.equal(await run.retry(), false);
  assert.equal(run.confirmations.length, 1);
  assert.equal(run.imports.length, 1);
  assert.deepEqual(run.previews, []);
  assert.equal(run.input.value, '当前待识别题目');
  assert(run.notices.some((args) => args[0] === '备份来源已变化，请重新识别。'));
});
