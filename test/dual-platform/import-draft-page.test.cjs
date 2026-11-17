'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('../../apps/desktop/node_modules/playwright-core');
const { startServer, WEB_ROOT } = require('../web-ai-practice/harness.cjs');
const { observeAppDialogs } = require('../web-ai-practice/dialogs.cjs');
const { IMAGE, image } = require('./fixtures/dataset.cjs');

let browser; let server;
test.before(async () => {
  server = await startServer(WEB_ROOT);
  browser = await chromium.launch({ headless: true, ...(process.env.SHIROHA_BROWSER_EXECUTABLE ? { executablePath: process.env.SHIROHA_BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
});
test.after(async () => { await browser?.close();await server?.close(); });

async function openPage(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await observeAppDialogs(page);
  page.on('app-dialog', (dialog) => dialog.accept());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(server.url);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  return page;
}

async function createPreview(page) {
  const questions = [
    { id: 'draft-image', type: 'single', question: `图片题 ![图](${IMAGE})`, options: [{ key: 'A', text: '选项' }], answer: ['A'], images: [image()] },
    { id: 'draft-warning', type: 'single', question: '缺少答案的题目', options: [{ key: 'A', text: '选项' }], answer: [] },
  ];
  await page.locator('#import-mode').selectOption('json');
  await page.locator('#import-text').fill(JSON.stringify(questions));
  await page.locator('#parse-import-btn').click();
  await page.locator('#import-preview [data-edit-import="0"]').click();
  await page.locator('#edit-question').fill(`已编辑图片题 ![图](${IMAGE})`);
  await page.locator('#edit-save-btn').click();
  await page.locator('#edit-close-btn').click();
  await page.locator('#import-bank-name').fill('本机待核对');
  await page.locator('#import-preview-filter').selectOption('problem');
}

test('保存的导入草稿刷新后恢复编辑、图片、异常和筛选，确认入库后删除', async (t) => {
  const page = await openPage(t);
  await createPreview(page);
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  assert.equal(await page.locator('#import-bank-name').inputValue(), '本机待核对');
  assert.equal(await page.locator('#import-preview-filter').inputValue(), 'problem');
  assert.match(await page.locator('#import-preview tbody').innerText(), /缺少答案的题目/);
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '当前预览已是' }).waitFor();
  await page.locator('#import-preview-filter').selectOption('all');
  await page.locator('#import-preview [data-edit-import="0"]').click();
  assert.match(await page.locator('#edit-question').inputValue(), /已编辑图片题/);
  assert.match(await page.locator('#edit-question').inputValue(), /data:image\/png;base64/);
  await page.locator('#edit-close-btn').click();
  await page.locator('#confirm-import-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已清除' }).waitFor();
  const imported = await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('shiroha_quiz_state_v28_4_c1')).banks.find((bank) => bank.name === '本机待核对'));
  assert.equal(imported.questions[0].images[0].dataUrl, IMAGE);
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '没有保存的草稿' }).waitFor();
});

test('恢复使单文件和双文件的迟到读取失效', async (t) => {
  const page = await openPage(t);
  await createPreview(page);
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.evaluate(() => {
    globalThis.__draftReads = {};
    globalThis.ShirohaPlatform.files.readText = (file) => new Promise((resolve) => { globalThis.__draftReads[file.name] = resolve; });
  });
  for (const [selector, name] of [['#import-file', '旧单文件.txt'], ['#dual-question-file', '旧题目.txt'], ['#dual-answer-file', '旧答案.txt']]) {
    await page.locator(selector).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('测试') });
  }
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  const before = await page.locator('#import-text').inputValue();
  await page.evaluate(() => Object.values(globalThis.__draftReads).forEach((resolve) => resolve('迟到内容')));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#import-text').inputValue(), before);
  assert.equal(await page.locator('#dual-question-text').inputValue(), '');
  assert.equal(await page.locator('#dual-answer-text').inputValue(), '');
  assert.equal(await page.locator('#import-bank-name').inputValue(), '本机待核对');
});

test('覆盖确认期间其他窗口更新草稿时拒绝覆盖', async (t) => {
  const page = await openPage(t);
  await createPreview(page);
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.locator('#import-bank-name').fill('本页新名称');
  page.removeAllListeners('app-dialog');
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#app-dialog[open]').waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = globalThis.indexedDB.open('shiroha-import-draft', 1);request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('draft', 'readwrite');const store = transaction.objectStore('draft');const request = store.get('current');
      request.onsuccess = () => { const record = request.result;record.revision = 'other-window';record.data.fields['import-bank-name'] = '另一窗口';store.put(record, 'current'); };
      transaction.oncomplete = resolve;transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  });
  await page.locator('#app-dialog [data-dialog-accept]').click();
  await page.locator('#import-draft-status').filter({ hasText: '其他窗口变化' }).waitFor();
  assert.equal(await page.locator('#import-bank-name').inputValue(), '本页新名称');
  page.on('app-dialog', (dialog) => dialog.accept());
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  assert.equal(await page.locator('#import-bank-name').inputValue(), '另一窗口');
});

test('入库失败或题目继续修改均保留已保存草稿', async (t) => {
  const page = await openPage(t);
  await createPreview(page);
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.evaluate(() => {
    const { write } = globalThis.ShirohaPlatform.storage;
    globalThis.__restoreDraftWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };
    globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('模拟写入失败'); };
  });
  await page.locator('#confirm-import-btn').click();
  await page.locator('#import-summary').waitFor();
  await page.getByText('导入未保存', { exact: true }).first().waitFor();
  await page.evaluate(() => globalThis.__restoreDraftWrite());
  await page.locator('#import-preview-filter').selectOption('all');
  await page.locator('[data-edit-import="0"]').click();
  await page.locator('#edit-question').fill('保存之后继续修改');
  await page.locator('#edit-save-btn').click();
  await page.locator('#edit-close-btn').click();
  await page.locator('#confirm-import-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '草稿仍保留' }).waitFor();
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  await page.locator('#import-preview-filter').selectOption('all');
  assert.match(await page.locator('#import-preview tbody').innerText(), /已编辑图片题/);
});

test('恢复保留未采纳的 AI 建议并丢弃恢复前迟到的整理结果', async (t) => {
  const page = await openPage(t);
  await page.evaluate(() => {
    globalThis.ShirohaPlatform.network.ai = async (_config, payload) => {
      const input = JSON.parse(payload.messages[1].content);
      const response = (content) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) });
      if (input.task === 'refactor_questions') { return new Promise((resolve) => { globalThis.__lateAi = () => resolve(response({ mode: 'direct_questions', questions: [{ type: 'short', question: '迟到的旧结果', options: [], answer: [] }] })); }); }
      return response({ results: [{ id: input.questions[0].id, analysis: '尚未采纳的解析建议', needsReview: true }] });
    };
  });
  await page.locator('.nav[data-view="ai-settings"]').click();
  await page.locator('#ai-provider-v99').selectOption('custom');
  await page.locator('#ai-endpoint-v99').fill('https://mock-ai.invalid/v1/chat/completions');
  await page.locator('#ai-model-v99').fill('fixture');
  await page.locator('#ai-save-settings-v99').click();
  await page.locator('#ai-settings-status-v99').filter({ hasText: '设置已保存' }).waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await createPreview(page);
  await page.locator('#import-preview-filter').selectOption('all');
  await page.locator('#ai-analysis-import-btn-v991').click();
  await page.locator('#ai-preview-start-btn-v991').click();
  await page.locator('#ai-preview-status-v991').filter({ hasText: '生成 1 条建议' }).waitFor();
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.locator('#clear-import-btn').click();
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  assert.match(await page.locator('#import-preview').innerText(), /尚未采纳的解析建议/);
  await page.locator('#import-text').fill('等待旧 AI 结果');
  await page.locator('#ai-organize-import-btn-v99').click();
  await page.locator('#ai-import-start-btn-v99').click();
  await page.waitForFunction(() => typeof globalThis.__lateAi === 'function');
  await page.locator('#import-draft-status').evaluate((element) => { element.textContent = ''; });
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  await page.evaluate(() => globalThis.__lateAi());
  await page.waitForTimeout(100);
  assert.doesNotMatch(await page.locator('#import-preview').innerText(), /迟到的旧结果/);
  assert.match(await page.locator('#import-preview').innerText(), /尚未采纳的解析建议/);
});

test('取消覆盖和存储错误保留已保存的草稿与当前预览', async (t) => {
  const page = await openPage(t);
  await createPreview(page);
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.locator('#import-bank-name').fill('当前未保存');
  page.removeAllListeners('app-dialog');
  page.on('app-dialog', (dialog) => dialog.dismiss());
  await page.locator('#restore-import-draft-btn').click();
  assert.equal(await page.locator('#import-bank-name').inputValue(), '当前未保存');
  await page.evaluate(() => { globalThis.indexedDB.open = () => { throw new globalThis.DOMException('空间不足', 'QuotaExceededError'); }; });
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '失败' }).waitFor();
  assert.equal(await page.locator('#import-bank-name').inputValue(), '当前未保存');
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  assert.equal(await page.locator('#import-bank-name').inputValue(), '本机待核对');
});

test('写入事务失败不会替换旧草稿', async (t) => {
  const page = await openPage(t);
  await createPreview(page);
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.locator('#import-bank-name').fill('写入失败的名称');
  await page.evaluate(() => {
    const { put } = globalThis.IDBObjectStore.prototype;
    globalThis.__restorePut = () => { globalThis.IDBObjectStore.prototype.put = put; };
    globalThis.IDBObjectStore.prototype.put = () => { throw new globalThis.DOMException('空间不足', 'QuotaExceededError'); };
  });
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '失败' }).waitFor();
  await page.evaluate(() => globalThis.__restorePut());
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  assert.equal(await page.locator('#import-bank-name').inputValue(), '本机待核对');
});

test('从题目行保存后恢复到对应阅读位置', async (t) => {
  const page = await openPage(t);
  await page.locator('#import-mode').selectOption('json');
  const questions = Array.from({ length: 30 }, (_, index) => ({ type: 'short', question: `位置测试 ${index + 1}`, options: [], answer: ['答案'] }));
  await page.locator('#import-text').fill(JSON.stringify(questions));
  await page.locator('#parse-import-btn').click();
  await page.locator('#import-preview-filter').selectOption('all');
  await page.locator('[data-save-import-draft="24"]').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  await page.waitForFunction(() => {
    const row = globalThis.document.querySelector('[data-edit-import="24"]');
    const rect = row?.getBoundingClientRect();
    return rect && rect.top >= 0 && rect.top < globalThis.innerHeight;
  });
});

test('保存时的追加目标已消失，恢复后必须重新选择', async (t) => {
  const page = await openPage(t);
  await createPreview(page);
  await page.locator('#import-save-mode-v59').selectOption('append');
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = globalThis.indexedDB.open('shiroha-import-draft', 1);request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('draft', 'readwrite');const store = tx.objectStore('draft');const request = store.get('current');
      request.onsuccess = () => { const record = request.result;record.data.fields['import-target-bank-v59'] = 'missing-bank';store.put(record, 'current'); };
      tx.oncomplete = resolve;tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复' }).waitFor();
  assert.equal(await page.locator('#import-target-bank-v59').inputValue(), '');
  await page.locator('#confirm-import-btn').click();
  await page.getByText('原目标题库不存在，请重新选择要追加的题库。').waitFor();
});

test('损坏的草稿不会被保存操作静默覆盖', async (t) => {
  const page = await openPage(t);
  await createPreview(page);
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = globalThis.indexedDB.open('shiroha-import-draft', 1);request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('draft', 'readwrite');tx.objectStore('draft').put(false, 'current');tx.oncomplete = resolve;tx.onabort = () => reject(tx.error); });
    db.close();
  });
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '损坏' }).waitFor();
  const stored = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = globalThis.indexedDB.open('shiroha-import-draft', 1);request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error); });
    return new Promise((resolve, reject) => { const tx = db.transaction('draft', 'readonly');const request = tx.objectStore('draft').get('current');request.onsuccess = () => resolve(request.result);tx.oncomplete = () => db.close();tx.onabort = () => reject(tx.error); });
  });
  assert.equal(stored, false);
});
