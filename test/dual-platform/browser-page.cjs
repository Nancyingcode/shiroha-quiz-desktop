'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('../../apps/desktop/node_modules/playwright-core');
const { startServer, WEB_ROOT } = require('../web-ai-practice/harness.cjs');
const { webState } = require('./fixtures/dataset.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const KEY = 'shiroha_quiz_state_v28_4_c1';
let browser, server;
test.before(async () => {
  server = await startServer(WEB_ROOT);
  browser = await chromium.launch({ headless: true, ...(process.env.SHIROHA_BROWSER_EXECUTABLE ? { executablePath: process.env.SHIROHA_BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
});
test.after(async () => { await browser?.close(); await server?.close(); });
async function pageFor(t, raw, injection = '') {
  const context = await browser.newContext(); t.after(() => context.close());
  await context.addInitScript(({ raw, key }) => { if (!globalThis.sessionStorage.getItem('__stage_b_seed')){if (raw !== null) globalThis.localStorage.setItem(key, raw);globalThis.sessionStorage.setItem('__stage_b_seed','1')} }, { raw, key: KEY });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(server.url).origin) return route.abort();
    if (url.pathname === '/platform/index.js' && injection) {
      const response = await route.fetch(); return route.fulfill({ response, body: await response.text() + '\n' + injection });
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(server.url);
  return page;
}
const saved = page => page.evaluate(key => globalThis.localStorage.getItem(key), KEY);

test('拖放复用导入解析并拒绝多文件和非法扩展', async t => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  const drop = async names => page.evaluate(names => {
    const transfer = new globalThis.DataTransfer();
    for (const name of names) transfer.items.add(new globalThis.File(['1. 拖放题目\nA. 甲\nB. 乙\n答案：A'], name));
    globalThis.document.getElementById('import').dispatchEvent(new globalThis.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, names);
  await drop(['sample.exe']);
  assert.equal(await page.locator('#import-text').inputValue(), '');
  await drop(['one.txt', 'two.txt']);
  assert.equal(await page.locator('#import-text').inputValue(), '');
  await drop(['sample.txt']);
  await page.waitForFunction(() => globalThis.document.getElementById('import-text').value.includes('拖放题目'));
});
test('延迟初始化不允许编辑，失败原值保留并提供恢复出口', async t => {
  const page = await pageFor(t, '{broken', 'const original=globalThis.ShirohaPlatform.storage.initialize;globalThis.ShirohaPlatform.storage.initialize=async()=>{await new Promise(r=>setTimeout(r,250));return original()};');
  assert.equal(await page.locator('.app').getAttribute('inert'), '');
  await page.locator('body[data-storage-state="recovery_required"]').waitFor();
  assert.equal(await saved(page), '{broken');
  assert.equal(await page.getByRole('button', { name: '导出原始数据', exact: true }).count(), 1);
});
test('明确空库重启保持为空；全量重置重新初始化默认题库', async t => {
  const initial = { ...webState(), banks: [], activeBankId: '' };
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();
  assert.equal(JSON.parse(await saved(page)).banks.length, 0);
  await page.locator('.nav[data-view="settings"]').click();
  await page.locator('#reset-data-btn').click();
  await page.waitForLoadState('load');
  await page.locator('body[data-storage-state="ready"]').waitFor();
  // 重置后不再注入初始样本；在当前上下文检查真实默认库。
  await page.locator('.nav[data-view="dashboard"]').click();
  await page.locator('#save-all-btn').click();
  assert.equal(JSON.parse(await saved(page)).banks.length, 1);
});
test('延迟保存只显示待保存状态；其他标签变化拒绝覆盖', async t => {
  const initial = JSON.stringify(webState());
  const page = await pageFor(t, initial, 'const write=globalThis.ShirohaPlatform.storage.write;globalThis.ShirohaPlatform.storage.write=async(...args)=>{await new Promise(r=>setTimeout(r,350));return write(...args)};');
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();
  assert.equal(await page.locator('body').getAttribute('data-storage-state'), 'pending');
  assert.equal(await saved(page), initial);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.evaluate(key => globalThis.localStorage.setItem(key, 'external-change'), KEY);
  await page.locator('#save-all-btn').click();
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(await saved(page), 'external-change');
});
test('容量不足不清空编辑内容，重试成功后再离开编辑态', async t => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('#bank-rename-input').fill('保存失败时保留名称');
  await page.evaluate(() => { const original=globalThis.Storage.prototype.setItem;globalThis.__restoreStorage=()=>{globalThis.Storage.prototype.setItem=original};globalThis.Storage.prototype.setItem=function(key,value){if(key==='shiroha_quiz_state_v28_4_c1')throw new globalThis.DOMException('Synthetic quota','QuotaExceededError');return original.call(this,key,value)}; });
  await page.locator('#rename-bank-btn').click();
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(await page.locator('#bank-rename-input').inputValue(), '保存失败时保留名称');
  assert.equal(JSON.parse(await saved(page)).banks[0].name,webState().banks[0].name);
  await page.evaluate(() => globalThis.__restoreStorage());
  await page.locator('#rename-bank-btn').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].name,'保存失败时保留名称');
});
test('考试提交失败保全记录，重试与重复点击只新增一次',async t=>{
  const initial=webState();const page=await pageFor(t,JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="exam"]').click();
  await page.locator('#start-exam-btn').click();
  await page.evaluate(()=>{const write=globalThis.ShirohaPlatform.storage.write;globalThis.__resumeWrite=()=>{globalThis.ShirohaPlatform.storage.write=write};globalThis.ShirohaPlatform.storage.write=async()=>{throw new Error('Synthetic disk failure')};});
  await page.locator('#exam-submit-focus').click();
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(JSON.parse(await saved(page)).records.length,initial.records.length);
  assert.equal(await page.locator('#submit-exam-btn').isDisabled(),false);
  await page.evaluate(()=>{globalThis.__resumeWrite();globalThis.document.querySelector('#submit-exam-btn').click();globalThis.document.querySelector('#submit-exam-btn').click()});
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).records.length,initial.records.length+1);
  assert.equal(await page.locator('#submit-exam-btn').isDisabled(),true);
});
test('file URL 的静态 ZIP 入口可启动且不依赖可选 PDF/OCR',async t=>{
  const context=await browser.newContext();t.after(()=>context.close());
  const page=await context.newPage();
  await context.route('**/libs/**',route=>route.abort());
  await page.goto(pathToFileURL(path.join(WEB_ROOT,'index.html')).href);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert(JSON.parse(await saved(page)).banks.length>0);
});
test('恢复写入失败保留原库与文件选择，重试才提交恢复',async t=>{
  const original=JSON.stringify(webState());const page=await pageFor(t,original);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.evaluate(()=>{const write=globalThis.ShirohaPlatform.storage.write;globalThis.__resumeWrite=()=>{globalThis.ShirohaPlatform.storage.write=write};globalThis.ShirohaPlatform.storage.write=async()=>{throw new Error('Synthetic restore failure')};});
  const backup=webState();backup.banks[0].name='恢复测试新题库';
  await page.locator('#backup-json-file-v23').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(await saved(page),original);
  assert.equal(await page.locator('#backup-json-file-v23').evaluate(el=>el.files.length),1);
  await page.evaluate(()=>globalThis.__resumeWrite());
  await page.locator('#platform-status button').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert(JSON.parse(await saved(page)).banks.some(bank=>bank.name==='恢复测试新题库'));
});
test('导出与重置失败可见，取消文件选择不修改数据',async t=>{
  const original=JSON.stringify(webState());const page=await pageFor(t,original);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#import-file').dispatchEvent('change');assert.equal(await saved(page),original);
  await page.evaluate(()=>{globalThis.ShirohaPlatform.download=()=>{throw new Error('Synthetic export failure')};});
  await page.locator('.nav[data-view="settings"]').click();
  await page.locator('#export-all-btn').click();await page.locator('#platform-status.failed').waitFor();
  assert.match(await page.locator('#platform-status').textContent(),/导出失败/);
  await page.locator('.nav[data-view="settings"]').click();
  await page.evaluate(()=>{globalThis.ShirohaPlatform.credentials.reset=()=>{throw new Error('Synthetic reset failure')};});
  await page.locator('#reset-data-btn').click();await page.locator('#platform-status.failed').waitFor();
  assert.equal(await saved(page),original);
  assert.match(await page.locator('#platform-status').textContent(),/reset failure/);
});
