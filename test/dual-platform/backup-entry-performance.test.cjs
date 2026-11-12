'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { loadWebSource } = require('./source-tools.cjs');
const { loadWeb, plain } = require('./web-source.cjs');

const source = loadWebSource();
const { api } = loadWeb();

function payload(path = '') {
  return { banks: [{ id: 'fixture-bank', questions: [{ id: 'fixture-question', images: path ? [{ localPath: path }] : [] }] }], records: [] };
}
function setup(entry, data, assets) {
  const calls = { apply: 0, unresolved: 0, imports: [], messages: [] };
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const elements = [];
  const context = vm.createContext({
    CURRENT_SCHEMA_VERSION: 1,
    readBackupFileV24: async () => ({ text: JSON.stringify(data), assets }),
    applyBackupAssetsV24(value, map) { calls.apply += 1;api.applyBackupAssetsV24(value, map); },
    countUnresolvedBackupImagesV24(value) { calls.unresolved += 1;return api.countUnresolvedBackupImagesV24(value); },
    normalizeBackupPayloadV23: (value) => value,
    setBackupPreviewV23() {},
    backupImportModeV23: 'merge',
    mutationSaveError: null,
    runMutation: (action) => action(),
    applyBackupImportV23: async (...args) => { calls.imports.push(args);finish(); },
    toast: (message) => { calls.messages.push(message);finish(); },
    ShirohaDialogs: { confirm: async () => true },
    ShirohaPlatform: {
      storage: {
        recoverySnapshots: async () => [],
        recoverImport: async (snapshot) => { calls.imports.push([snapshot]); },
      },
    },
    startApplication: async () => {},
    document: {
      createElement(tag) {
        const element = { tag, setAttribute() {}, appendChild() {}, replaceChildren() {} };
        elements.push(element);
        return element;
      },
    },
  });
  vm.runInContext(source.functionSource(entry), context);
  return { context, calls, elements, finished };
}

for (const entry of ['importBackupJsonFileV23', 'offerNativeRecovery']) {
  for (const scenario of ['空资产', '缺图', '含图']) {
    test(`${entry}：${scenario}仅在资产非空时替换，始终检测缺图`, async () => {
      const path = scenario === '空资产' ? '' : 'assets/pixel.png';
      const data = payload(path);
      const assets = scenario === '含图' ? { 'assets/pixel.png': 'data:image/png;base64,AAE=' } : {};
      const run = setup(entry, data, assets);
      const file = { name: 'fixture.json' };
      if (entry === 'importBackupJsonFileV23') {
        run.context.importBackupJsonFileV23({ target: { files: [file], value: 'selected' } });
        await run.finished;
      } else {
        const container = { append() {} };
        run.context.offerNativeRecovery(container);
        const input = run.elements.find((element) => element.tag === 'input');
        input.files = [file];
        await input.onchange();
      }
      assert.equal(run.calls.apply, scenario === '含图' ? 1 : 0);
      assert.equal(run.calls.unresolved, 1);
      if (entry === 'offerNativeRecovery' && scenario === '缺图') {
        assert.equal(run.calls.imports.length, 0);
        assert(run.elements.some((element) => String(element.textContent || '').includes('备份缺少图片')));
      } else {
        assert.equal(run.calls.imports.length, 1);
        const result = run.calls.imports[0][0];
        if (scenario === '缺图') { assert.equal(run.calls.imports[0][2], 1); }
        if (scenario === '含图') { assert.match(plain(result).banks[0].questions[0].images[0].localPath, /^data:image\/png/); }
      }
    });
  }
}

test('恢复入口失败保留原数据和文件选择，修复后同文件可重试', async () => {
  const data = payload();
  const run = setup('offerNativeRecovery', data, {});
  const original = { banks: [{ id: 'old-bank', questions: [{ id: 'old-question' }] }] };
  let persisted = structuredClone(original);
  let attempts = 0;
  let starts = 0;
  run.context.ShirohaPlatform.storage.recoverImport = async (snapshot) => {
    attempts += 1;
    if (attempts === 1) { throw new Error('模拟恢复失败'); }
    persisted = plain(snapshot);
  };
  run.context.startApplication = async () => { starts += 1; };
  run.context.offerNativeRecovery({ append() {} });
  const input = run.elements.find((element) => element.tag === 'input');
  const file = { name: 'fixture.json' };
  input.files = [file];
  await input.onchange();
  assert.deepEqual(persisted, original);
  assert.equal(input.files[0], file);
  assert.equal(input.disabled, false);
  assert.equal(starts, 0);
  assert(run.elements.some((element) => String(element.textContent || '').includes('模拟恢复失败')));

  await input.onchange();
  assert.equal(attempts, 2);
  assert.equal(starts, 1);
  assert.equal(input.files[0], file);
  assert.equal(input.disabled, false);
  assert.equal(persisted.banks[0].id, 'fixture-bank');
  assert.equal(persisted.banks[0].questions[0].id, 'fixture-question');
});
