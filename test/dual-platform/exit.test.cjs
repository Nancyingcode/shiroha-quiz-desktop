'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const source = readFileSync(require.resolve('../../apps/web/app.js'), 'utf8');
const start = source.indexOf('if(globalThis.ShirohaDesktopHost)globalThis.ShirohaDesktopHost.canClose=async()=>{');
const end = source.indexOf('\n};', start) + 3;

function fixture(overrides = {}) {
  const prompts = [];
  const status = [];
  const context = vm.createContext({
    ShirohaDesktopHost: {}, mutationBusy: false, mutationSaveError: null,
    exam: { items: [], submitted: false }, ocrImportState: { running: false },
    practice: { items: [] }, totalPracticeFilledCount: () => 0,
    $: () => null,
    webdavRuntimeV378: { busy: false }, aiImportRequestV99: { running: false }, aiPreviewRequestV991: { running: false }, aiSingleSessionsV613: new Map(),
    confirm: message => { prompts.push(message); return false; }, platformStatus: message => status.push(message),
    ShirohaPlatform: { network: { cancelAll: async () => {} }, saves: { idle: async () => {} } }, ...overrides,
  });
  const busyStart = source.indexOf('function aiTasksBusyV99(');
  vm.runInContext(source.slice(busyStart,source.indexOf('\n',busyStart)),context);
  vm.runInContext(source.slice(start, end), context);
  return { close: context.ShirohaDesktopHost.canClose, prompts, status };
}

test('saving and failed saves retain the window until an explicit decision', async () => {
  assert.equal(await fixture({ mutationBusy: true }).close(), false);
  assert.equal(await fixture({ mutationSaveError: new Error('disk full') }).close(), false);
  assert.equal(await fixture().close(), true);
});

test('unfinished exam, OCR and single-question AI can cancel exit', async () => {
  for (const override of [
    { exam: { items: [{}], submitted: false } },
    { ocrImportState: { running: true } },
    { aiSingleSessionsV613: new Map([['question', { loading: 'analysis' }]]) },
  ]) {
    const f = fixture(override);
    assert.equal(await f.close(), false);
    assert.equal(f.prompts.length, 1);
  }
});

test('failed native cancellation keeps the window open and reports failure', async () => {
  const f = fixture({ ShirohaPlatform: { network: { cancelAll: async () => { throw new Error('cancel failed'); } } } });
  assert.equal(await f.close(), false);
  assert.deepEqual(f.status, ['cancel failed']);
});

test('退出协调等待 Harness 取消，失败时保留窗口', async () => {
  let cancelled = false;
  const f = fixture({ confirm:()=>true, ShirohaPlatform:{harness:{status:()=>({busy:true}),async cancelAll(){cancelled=true;throw new Error('Harness 尚未停止');}},network:{},saves:{idle:async()=>{}}} });
  assert.equal(await f.close(),false);
  assert.equal(cancelled,true);
  assert.deepEqual(f.status,['Harness 尚未停止']);
});

test('总提交草稿关闭需确认，已锁定自评须先完成', async () => {
  const draft = { practice: { submitMode: 'total' }, totalPracticeFilledCount: () => 1 };
  const cancelled = fixture(draft);
  assert.equal(await cancelled.close(), false);
  assert.equal(cancelled.prompts.length, 1);
  assert.equal(await fixture({ ...draft, confirm: () => true }).close(), true);
  assert.equal(await fixture({ practice: { submitMode: 'total', totalLocked: true }, confirm: () => true }).close(), false);
  assert.equal(await fixture({ practice: { submitMode: 'total', totalLocked: true, completed: true } }).close(), true);
});
