'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('../../apps/desktop/node_modules/playwright-core');
const { startServer, WEB_ROOT } = require('../web-ai-practice/harness.cjs');
const { observeAppDialogs } = require('../web-ai-practice/dialogs.cjs');
const { IMAGE, image, webState } = require('./fixtures/dataset.cjs');

const STATE_KEY = 'shiroha_quiz_state_v28_4_c1';
let browser; let server;
test.before(async () => {
  server = await startServer(WEB_ROOT);
  browser = await chromium.launch({ headless: true, ...(process.env.SHIROHA_BROWSER_EXECUTABLE ? { executablePath: process.env.SHIROHA_BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
});
test.after(async () => {
  await browser?.close();await server?.close();
});

async function openPage(t, snapshot) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await observeAppDialogs(page);
  page.on('app-dialog', (dialog) => dialog.accept());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  if (snapshot) {
    await page.addInitScript(({ key, initial }) => {
      if (globalThis.localStorage.getItem(key) === null) {
        globalThis.localStorage.setItem(key, JSON.stringify(initial));
      }
    }, { key: STATE_KEY, initial: snapshot });
  }

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

async function openAppendPreview(t) {
  const initial = webState();
  initial.settings.practiceScope = { type: 'group', value: initial.banks[0].groupName };
  const page = await openPage(t, initial);
  await createPreview(page);
  await page.locator('#import-save-mode-v59').selectOption('append');
  return page;
}

async function controlAppendStorage(page, failFirstWrite = false) {
  await page.evaluate((failWrite) => {
    const { storage } = globalThis.ShirohaPlatform;
    const { write } = storage;
    const probe = { reads: [], writes: 0 };
    const pendingRead = new Promise((resolve, reject) => {
      probe.releaseRead = resolve;
      probe.rejectRead = () => reject(new Error('模拟正文读取失败'));
    });
    globalThis.__appendStorage = probe;
    storage.ensureQuestions = async (snapshot, refs) => {
      if (globalThis.document.body.dataset.storageState !== 'ready') {
        return undefined;
      }

      const { banks, activeBankId, settings } = snapshot;
      probe.reads.push({
        ids: [...new Set(refs.map((ref) => ref.bankId))],
        // 对照实际保存的 JSON，忽略会被序列化省略的可选字段。
        before: JSON.parse(JSON.stringify({ banks, activeBankId, scope: settings.practiceScope })),
      });
      return pendingRead;
    };
    storage.write = async (...args) => {
      probe.writes += 1;
      if (failWrite && probe.writes === 1) {
        await new Promise((_resolve, reject) => {
          probe.failWrite = () => reject(new Error('模拟追加写入失败'));
        });
      }

      return write(...args);
    };
  }, failFirstWrite);
}

for (const { name, selector, value } of [
  { name: '改选题库', selector: '#import-target-bank-v59', value: 'bank-b' },
  { name: '改为新建', selector: '#import-save-mode-v59', value: 'new' },
]) {
  test(`追加读取期间${name}须重新确认，旧确认不写入`, async (t) => {
    const page = await openAppendPreview(t);
    const persisted = await page.evaluate((key) => globalThis.localStorage.getItem(key), STATE_KEY);
    await controlAppendStorage(page);
    await page.locator('#confirm-import-btn').click();
    await page.waitForFunction(() => globalThis.__appendStorage.reads.length > 0);
    await page.locator(selector).selectOption(value);
    await page.evaluate(() => {
      globalThis.__appendStorage.releaseRead();
    });
    const notice = page.locator('#app-toast p')
      .filter({ hasText: /保存方式或目标题库已变化|已追加到|已创建题库/ });
    await notice.waitFor();
    const { reads, writes } = await page.evaluate(() => globalThis.__appendStorage);
    assert.equal(writes, 0, await notice.innerText());
    assert.deepEqual(reads.map((read) => read.ids), [['bank-a']]);
    assert.match(await notice.innerText(), /保存方式或目标题库已变化/);
    assert.equal(await page.evaluate((key) => globalThis.localStorage.getItem(key), STATE_KEY), persisted);
    assert.match(await page.locator('#import-summary').innerText(), /识别到 2 道题/);
  });
}

test('追加正文读取失败保留预览，未写入题库', async (t) => {
  const page = await openAppendPreview(t);
  await controlAppendStorage(page);
  await page.locator('#confirm-import-btn').click();
  await page.waitForFunction(() => globalThis.__appendStorage.reads.length > 0);
  await page.evaluate(() => {
    globalThis.__appendStorage.rejectRead();
  });
  await page.locator('#platform-status').filter({ hasText: '模拟正文读取失败' }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__appendStorage.writes), 0);
  assert.match(await page.locator('#import-summary').innerText(), /识别到 2 道题/);
  assert.equal(await page.locator('#confirm-import-btn').isEnabled(), true);
});

test('两个确认入口共用追加，写入失败回滚并保留草稿，重试只追加一次', async (t) => {
  const page = await openAppendPreview(t);
  const targetSelect = page.locator('#import-target-bank-v59');
  await targetSelect.selectOption('bank-b');
  await page.locator('#save-import-draft-btn').click();
  const draftStatus = page.locator('#import-draft-status');
  await draftStatus.filter({ hasText: '已保存' }).waitFor();
  const persisted = await page.evaluate((key) => globalThis.localStorage.getItem(key), STATE_KEY);
  await controlAppendStorage(page, true);

  const single = page.locator('#confirm-import-btn');
  const dual = page.locator('#dual-confirm-import-btn');
  await single.click();
  await page.waitForFunction(() => globalThis.__appendStorage.reads.length > 0);
  await dual.click();
  await page.evaluate(() => {
    globalThis.__appendStorage.releaseRead();
  });
  await page.waitForFunction(() => typeof globalThis.__appendStorage.failWrite === 'function');
  for (const button of [single, dual]) {
    assert.equal(await button.isDisabled(), true);
    assert.equal(await button.getAttribute('aria-busy'), 'true');
    assert.equal(await button.textContent(), '正在追加…');
  }

  await page.evaluate(() => {
    globalThis.__appendStorage.failWrite();
  });
  await page.locator('#app-toast p').filter({ hasText: '模拟追加写入失败' }).waitFor();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  for (const button of [single, dual]) {
    assert.equal(await button.isEnabled(), true);
    assert.equal(await button.getAttribute('aria-busy'), null);
    assert.equal(await button.textContent(), '确认追加');
  }

  assert.equal(await page.evaluate((key) => globalThis.localStorage.getItem(key), STATE_KEY), persisted);
  assert.equal(await page.locator('#active-bank-select').inputValue(), 'bank-a');
  await targetSelect.selectOption('bank-a');
  await page.locator('#platform-status').getByRole('button', { name: '重试', exact: true }).click();
  await page.locator('#app-toast p').filter({ hasText: '保存方式或目标题库已变化' }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__appendStorage.writes), 1);
  await targetSelect.selectOption('bank-b');
  await page.locator('#restore-import-draft-btn').click();
  await draftStatus.filter({ hasText: '当前预览已是保存的草稿' }).waitFor();
  await dual.click();
  await draftStatus.filter({ hasText: '已清除' }).waitFor();
  const { reads, writes } = await page.evaluate(() => globalThis.__appendStorage);
  assert.deepEqual(reads.map((read) => read.ids), [['bank-b'], ['bank-b']]);
  assert.deepEqual(reads[1].before, reads[0].before);
  assert.equal(writes, 2);

  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const stored = await page.evaluate((key) => JSON.parse(globalThis.localStorage.getItem(key)), STATE_KEY);
  const source = stored.banks.find((bank) => bank.id === 'bank-a');
  const target = stored.banks.find((bank) => bank.id === 'bank-b');
  const original = reads[0].before.banks.find((bank) => bank.id === 'bank-b');
  assert.deepEqual(source, reads[0].before.banks.find((bank) => bank.id === 'bank-a'));
  assert.deepEqual(target.questions[0], original.questions[0]);
  assert.notEqual(target.updatedAt, original.updatedAt);
  assert.deepEqual(target.questions.slice(1).map(({ number, answer }) => [number, answer]), [[2, ['A']], [3, []]]);
  assert.equal(new Set(target.questions.map((question) => question.id)).size, 3);
  assert.equal(stored.activeBankId, 'bank-b');
  assert.deepEqual(stored.settings.practiceScope, { type: 'bank', value: 'bank-b' });
});

test('入库后重绘失败保留已提交的数据和待核对草稿', async (t) => {
  const page = await openPage(t);
  await createPreview(page);
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已保存' }).waitFor();
  await page.evaluate(() => {
    const { storage } = globalThis.ShirohaPlatform;
    const { write } = storage;
    storage.write = async (...args) => {
      const receipt = await write(...args);
      const bankSelect = globalThis.document.getElementById('active-bank-select');
      // 故障发生在持久化回执之后，触发重绘的第一处题库控件写入。
      Object.defineProperty(bankSelect, 'innerHTML', {
        configurable: true,
        set() {
          Reflect.deleteProperty(this, 'innerHTML');
          throw new Error('模拟重绘失败');
        },
      });
      return receipt;
    };
  });
  await page.locator('#confirm-import-btn').click();
  const status = page.locator('#platform-status');
  await status.filter({ hasText: '数据已保存，但界面刷新失败' }).waitFor();
  assert.equal(await status.getByRole('button', { name: '重试' }).count(), 0);
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#active-bank-select option').filter({ hasText: '本机待核对' }).waitFor({ state: 'attached' });
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#restore-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '已恢复本地草稿' }).waitFor();
  assert.match(await page.locator('#import-summary').innerText(), /识别到 2 道题/);
});

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
    globalThis.ShirohaPlatform.files.readText = (file) => new Promise((resolve) => {
      globalThis.__draftReads[file.name] = resolve;
    });
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
    const db = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open('shiroha-import-draft', 1);request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('draft', 'readwrite');const store = transaction.objectStore('draft');const request = store.get('current');
      request.onsuccess = () => {
        const record = request.result;record.revision = 'other-window';record.data.fields['import-bank-name'] = '另一窗口';store.put(record, 'current');
      };
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
    globalThis.__restoreDraftWrite = () => {
      globalThis.ShirohaPlatform.storage.write = write;
    };
    globalThis.ShirohaPlatform.storage.write = async () => {
      throw new Error('模拟写入失败');
    };
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
      if (input.task === 'refactor_questions') {
        return new Promise((resolve) => {
          globalThis.__lateAi = () => resolve(response({ mode: 'direct_questions', questions: [{ type: 'short', question: '迟到的旧结果', options: [], answer: [] }] }));
        });
      }
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
  await page.locator('#import-draft-status').evaluate((element) => {
    element.textContent = '';
  });
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
  await page.evaluate(() => {
    globalThis.indexedDB.open = () => {
      throw new globalThis.DOMException('空间不足', 'QuotaExceededError');
    };
  });
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
    globalThis.__restorePut = () => {
      globalThis.IDBObjectStore.prototype.put = put;
    };
    globalThis.IDBObjectStore.prototype.put = () => {
      throw new globalThis.DOMException('空间不足', 'QuotaExceededError');
    };
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
    const db = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open('shiroha-import-draft', 1);request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('draft', 'readwrite');const store = tx.objectStore('draft');const request = store.get('current');
      request.onsuccess = () => {
        const record = request.result;record.data.fields['import-target-bank-v59'] = 'missing-bank';store.put(record, 'current');
      };
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
    const db = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open('shiroha-import-draft', 1);request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('draft', 'readwrite');tx.objectStore('draft').put(false, 'current');tx.oncomplete = resolve;tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.locator('#save-import-draft-btn').click();
  await page.locator('#import-draft-status').filter({ hasText: '损坏' }).waitFor();
  const stored = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open('shiroha-import-draft', 1);request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('draft', 'readonly');const request = tx.objectStore('draft').get('current');request.onsuccess = () => resolve(request.result);tx.oncomplete = () => db.close();tx.onabort = () => reject(tx.error);
    });
  });
  assert.equal(stored, false);
});
