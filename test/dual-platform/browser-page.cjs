'use strict';
const { observeAppDialogs } = require('../web-ai-practice/dialogs.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('../../apps/desktop/node_modules/playwright-core');
const { startServer, WEB_ROOT } = require('../web-ai-practice/harness.cjs');
const { webState, androidBackup, PNG_BASE64, IMAGE } = require('./fixtures/dataset.cjs');
const { loadWeb, plain } = require('./web-source.cjs');
const { createWebSource } = require('./source-tools.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const KEY = 'shiroha_quiz_state_v28_4_c1';
let browser; let server;
test.before(async () => {
  server = await startServer(WEB_ROOT);
  browser = await chromium.launch({ headless: true, ...(process.env.SHIROHA_BROWSER_EXECUTABLE ? { executablePath: process.env.SHIROHA_BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
});
test.after(async () => { await browser?.close(); await server?.close(); });
async function pageFor(t, raw, injection = '', appTransform = null, sourceTransforms = {}) {
  const context = await browser.newContext(); t.after(() => context.close());
  await context.addInitScript(({ raw, key }) => { if (!globalThis.sessionStorage.getItem('__stage_b_seed')) { if (raw !== null) { globalThis.localStorage.setItem(key, raw); }globalThis.sessionStorage.setItem('__stage_b_seed', '1'); } }, { raw, key: KEY });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(server.url).origin) { return route.abort(); }
    if (url.pathname === '/platform/index.js' && injection) {
      const response = await route.fetch(); return route.fulfill({ response, body: `${await response.text()}\n${injection}` });
    }
    if (url.pathname === '/app.js' && appTransform) {
      const response = await route.fetch(); return route.fulfill({ response, body: appTransform(await response.text()) });
    }
    if (sourceTransforms[url.pathname]) {
      const response = await route.fetch();
      return route.fulfill({ response, body: sourceTransforms[url.pathname](await response.text()) });
    }
    return route.continue();
  });
  const page = await context.newPage();
  await observeAppDialogs(page);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  page.on('app-dialog', (dialog) => dialog.accept());
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(server.url);
  return page;
}
const saved = (page) => page.evaluate((key) => globalThis.localStorage.getItem(key), KEY);

function recordDeletionState() {
  const initial = webState();
  const sample = initial.records[0];
  initial.records = [
    { ...sample, id: 'delete-target', name: '顺序练习 <img src=x>', mode: '练习', date: '2026-11-10T06:30:00.000Z' },
    { ...sample, id: 'keep-record', name: '保留记录', mode: '练习', date: '2026-11-09T06:30:00.000Z' },
  ];
  return initial;
}

test('训练记录删除：取消保留数据，确认只删除目标并刷新首页', async (t) => {
  const page = await pageFor(t, JSON.stringify(recordDeletionState()));
  page.setDefaultTimeout(3000);page.removeAllListeners('app-dialog');
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();
  const before = JSON.parse(await saved(page));
  await page.locator('.nav[data-view="records"]').click();
  const button = page.locator('[data-training-delete="delete-target"]');
  assert.match(await button.getAttribute('aria-label'), /顺序练习/);
  await button.click();
  assert.equal(await page.locator('#app-dialog-title').innerText(), '删除训练记录？');
  assert.match(await page.locator('#app-dialog').innerText(), /删除后将无法查看该次训练复盘/);
  assert.match(await page.locator('#app-dialog').innerText(), /题库、错题本和收藏不会被删除/);
  assert.equal(await page.locator('#app-dialog img').count(), 0);
  assert.equal(await page.locator('#app-dialog [data-dialog-cancel]').evaluate((element) => element === globalThis.document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.deepEqual(JSON.parse(await saved(page)), before);
  assert.equal(await button.evaluate((element) => element === globalThis.document.activeElement), true);
  await button.click();
  await page.locator('#app-dialog [data-dialog-accept]').click();
  await page.waitForFunction((key) => JSON.parse(globalThis.localStorage.getItem(key)).records.length === 1, KEY);
  await page.waitForFunction(() => globalThis.document.activeElement === globalThis.document.querySelector('#record-mode-filter'));
  const after = JSON.parse(await saved(page));
  assert.deepEqual(after.records, before.records.filter((record) => record.id === 'keep-record'));
  for (const key of ['banks', 'wrongBook', 'favorites', 'crossPlatformMeta']) { assert.deepEqual(after[key], before[key]); }
  assert.equal(await page.locator('[data-training-delete="delete-target"]').count(), 0);
  await page.locator('.nav[data-view="dashboard"]').click();
  assert.equal(await page.locator('#stat-records').innerText(), '1');
  assert.equal(await page.locator('#recent-training').getByText('保留记录', { exact: true }).count(), 1);
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.deepEqual(JSON.parse(await saved(page)).records, after.records);
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('[data-training-delete="keep-record"]').click();
  await page.locator('#app-dialog [data-dialog-accept]').click();
  await page.locator('#records-list').getByText('暂无练习或考试记录。', { exact: true }).waitFor();
  assert.equal(await page.locator('#records-list-pager .list-pagination-status').innerText(), '共 0 项');
  await page.locator('.nav[data-view="dashboard"]').click();
  assert.equal(await page.locator('#stat-records').innerText(), '0');
});

test('训练记录删除：保存失败回滚，重试只删除原目标', async (t) => {
  const page = await pageFor(t, JSON.stringify(recordDeletionState()));
  page.setDefaultTimeout(3000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const before = JSON.parse(await saved(page));
  await page.evaluate(() => {
    const original = globalThis.ShirohaPlatform.storage.write;
    globalThis.__restoreRecordWrite = () => { globalThis.ShirohaPlatform.storage.write = original; };
    globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('模拟记录保存失败'); };
  });
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('[data-training-delete="delete-target"]').click();
  await page.locator('#platform-status.failed').waitFor();
  assert.deepEqual(JSON.parse(await saved(page)), before);
  assert.equal(await page.locator('#records-list .record-item').count(), 2);
  await page.evaluate(() => globalThis.__restoreRecordWrite());
  await page.locator('#platform-status').getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction((key) => JSON.parse(globalThis.localStorage.getItem(key)).records.length === 1, KEY);
  assert.equal(JSON.parse(await saved(page)).records[0].id, 'keep-record');
});

test('训练记录删除：重复 ID 不允许删除，避免误删多条记录', async (t) => {
  const initial = recordDeletionState();
  initial.records[1].id = initial.records[0].id;
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(3000);page.removeAllListeners('app-dialog');
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const before = await saved(page);
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('[data-training-delete="delete-target"]').first().click();
  await page.locator('.toast-item').filter({ hasText: '记录 ID 重复' }).waitFor();
  assert.equal(await page.locator('#app-dialog').count(), 0);
  assert.equal(await saved(page), before);
});

test('训练记录删除：缺失 ID 的历史记录不能删除', async (t) => {
  const initial = recordDeletionState();
  initial.records[0].id = '';
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);page.removeAllListeners('app-dialog');
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const before = await saved(page);
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('[data-training-delete=""]').click();
  await page.locator('.toast-item').filter({ hasText: '记录 ID 缺失' }).waitFor();
  assert.equal(await page.locator('#app-dialog').count(), 0);
  assert.equal(await saved(page), before);
});

test('训练记录删除：末页删除后回到有效分页，窄屏操作不重叠', async (t) => {
  const initial = recordDeletionState();
  const sample = initial.records[0];
  initial.records = Array.from({ length: 11 }, (_, index) => ({ ...sample, id: `page-record-${index}`, name: `分页记录 ${index}`, date: new Date(Date.parse('2026-11-10T06:30:00.000Z') - (index * 60000)).toISOString() }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(3000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('#records-list-pager').getByRole('button', { name: '第 2 页', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 760 });
  const card = page.locator('#records-list .record-item');
  const layout = await card.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const review = element.querySelector('[data-training-review]').getBoundingClientRect();
    const remove = element.querySelector('[data-training-delete]').getBoundingClientRect();
    return { fits: remove.left >= bounds.left && remove.right <= bounds.right, separate: review.right <= remove.left || remove.right <= review.left || review.bottom <= remove.top || remove.bottom <= review.top };
  });
  assert.deepEqual(layout, { fits: true, separate: true });
  await page.locator('[data-training-delete="page-record-10"]').click();
  await page.waitForFunction((key) => JSON.parse(globalThis.localStorage.getItem(key)).records.length === 10, KEY);
  await page.locator('#records-list-pager .list-pagination-status').filter({ hasText: '第 1 / 1 页' }).waitFor();
  assert.equal(await page.locator('#records-list .record-item').count(), 10);
});

test('子路径入口加载全部共享样式且关键控件样式生效', async (t) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' }); t.after(() => context.close());
  const responses = new Map();
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(server.url).origin || !url.pathname.startsWith('/quiz/')) { return route.abort(); }
    const response = await route.fetch({ url: new URL(url.pathname.slice('/quiz/'.length) + url.search, server.url).href });
    if (route.request().resourceType() === 'stylesheet') { responses.set(url.pathname, response.status()); }
    return route.fulfill({ response });
  });
  const page = await context.newPage();
  await page.goto(new URL('quiz/index.html', server.url).href);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => ({
    path: new URL(link.href).pathname, loaded: Boolean(link.sheet && link.sheet.cssRules.length),
  })));
  assert.deepEqual(styles.map((item) => item.path), [
    '/quiz/styles.css',
    '/quiz/styles/responsive-artwork.css',
    '/quiz/styles/app-shell.css',
    '/quiz/styles/dashboard-and-media.css',
    '/quiz/styles/focus-panels-and-stats.css',
    '/quiz/styles/bank-and-study-tools.css',
    '/quiz/styles/ai-panels.css',
    '/quiz/styles/controls-and-feedback.css',
  ]);
  for (const item of styles) {
    assert.equal(responses.get(item.path), 200, item.path);
    assert.equal(item.loaded, true, item.path);
  }
  const field = await page.locator('#import-bank-name').evaluate((element) => globalThis.getComputedStyle(element).borderRadius);
  assert.equal(field, '14px');
});

for (const format of ['json', 'zip']) {
  test(`旧 Android v3 ${format} 实际导入保留图片、多空、收藏和记录`, async (t) => {
    const page = await pageFor(t, JSON.stringify(webState()));
    await page.locator('body[data-storage-state="ready"]').waitFor();
    const backup = androidBackup();
    const { api } = loadWeb();
    let buffer;
    if (format === 'zip') {
      const zip = api.zipStoreFiles([
        { name: 'backup.json', text: JSON.stringify(backup) },
        { name: 'assets/pixel.png', data: new Uint8Array(Buffer.from(PNG_BASE64, 'base64')) },
      ]);
      buffer = Buffer.from(await zip.arrayBuffer());
    } else {
      backup.banks[0].questions[0].images[0].dataUrl = IMAGE;
      buffer = Buffer.from(JSON.stringify(backup));
    }
    const file = { name: `legacy-android.${format}`, mimeType: format === 'zip' ? 'application/zip' : 'application/json', buffer };
    if (format === 'zip') {
      await page.locator('.nav[data-view="settings"]').click();
      await page.locator('#settings-backup-mode-v23').selectOption('merge');
      const chooserEvent = page.waitForEvent('filechooser');
      await page.locator('#settings-import-backup-v23').click();
      await (await chooserEvent).setFiles(file);
      await page.waitForFunction((key) => JSON.parse(globalThis.localStorage.getItem(key)).banks.some((bank) => bank.id === 'native-bank'), KEY);
    } else {
      await page.locator('.nav[data-view="import"]').click();
      await page.locator('#import-mode').selectOption('json');
      await page.locator('#import-file').setInputFiles(file);
      await page.waitForFunction(() => globalThis.document.getElementById('import-text').value.includes('native-record'));
      await page.locator('#parse-import-btn').click();
      await page.getByText('备份导入完成', { exact: true }).waitFor();
    }
    const after = JSON.parse(await saved(page));
    const bank = after.banks.find((item) => item.id === 'native-bank');
    assert.equal(bank.questions[0].images[0].dataUrl, IMAGE);
    assert.deepEqual(bank.questions[0].blankAnswers, [['北京', '北京市'], ['京']]);
    assert.deepEqual(after.favorites['native-bank'], ['native-blank']);
    assert.equal(after.wrongBook['native-bank'][0].wrongCount, 2);
    assert.deepEqual(after.records.find((item) => item.id === 'native-record').details[0].userBlankAnswers, ['北京市', '京']);
  });
}

test('设置页以含图片备份展示 ZIP，实际下载仍使用旧兼容载荷', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="settings"]').click();
  const before = await saved(page);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出含图片备份 ZIP', exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /^shiroha-quiz-native-backup-.*\.zip$/);
  const bytes = require('node:fs').readFileSync(await download.path());
  const { api } = loadWeb();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const entries = api.parseZipEntries(buffer);
  const payload = JSON.parse(await api.unzipEntry(buffer, entries.find((entry) => entry.name === 'backup.json')));
  assert.equal(payload.kind, 'shiroha_quiz_web_native_backup');
  assert.equal(payload.version, 3);
  assert.equal(payload.banks.length, 2);
  assert(entries.some((entry) => entry.name.startsWith('assets/')));
  assert.equal(await saved(page), before);
});

for (const mode of ['merge', 'overwrite']) {
  test(`WebDAV mock 上传、校验与${mode}失败重试保全数据`, async (t) => {
    const page = await pageFor(t, JSON.stringify(webState()));
    await page.locator('body[data-storage-state="ready"]').waitFor();
    await page.evaluate(() => {
      const files = new Map();
      const requests = [];
      globalThis.__davMock = { files, requests };
      globalThis.ShirohaPlatform.network.webdav = async (config, password, relativePath, options = {}) => {
        requests.push({ relativePath, method: options.method, password });
        if (options.method === 'PUT') {
          const bytes = typeof options.body === 'string' ? new TextEncoder().encode(options.body) : options.body;
          files.set(relativePath, new Uint8Array(bytes));
          return { status: 201 };
        }
        if (options.method === 'MKCOL') { return { status: 201 }; }
        if (options.method === 'PROPFIND') {
          const rows = [...files.keys()].filter((name) => /shiroha-web-backup-.*\.json$/.test(name));
          return { status: 207, text: async () => `<multistatus xmlns="DAV:">${rows.map((name) => `<response><href>/${name}</href><getcontentlength>${files.get(name).length}</getcontentlength></response>`).join('')}</multistatus>` };
        }
        const bytes = files.get(relativePath);
        if (!bytes) { return { status: 404, text: async () => '' }; }
        return { status: 200, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer };
      };
    });
    await page.locator('.nav[data-view="settings"]').click();
    await page.locator('#webdav-endpoint-v378').fill('https://dav.example.invalid/root');
    await page.locator('#webdav-remote-dir-v378').fill('ShirohaQuiz/Web');
    await page.locator('#webdav-username-v378').fill('fixture');
    await page.locator('#webdav-password-v378').fill('fake-password');
    const before = JSON.parse(await saved(page));
    await page.locator('#webdav-upload-v378').click();
    await page.locator('#webdav-status-v378').filter({ hasText: '上传成功' }).waitFor();
    const remote = page.locator('#webdav-list-v378 [data-webdav-restore-v378]');
    assert.equal(await remote.count(), 1);
    if (mode === 'merge') {
      await page.evaluate(() => {
        const name = [...globalThis.__davMock.files.keys()].find((value) => /shiroha-web-backup-.*\.json$/.test(value));
        const original = globalThis.__davMock.files.get(name);
        globalThis.__restoreDavBytes = () => globalThis.__davMock.files.set(name, original);
        const corrupt = original.slice();
        corrupt[corrupt.length - 1] ^= 1;
        globalThis.__davMock.files.set(name, corrupt);
      });
      await remote.click();
      await page.locator('#webdav-status-v378').filter({ hasText: 'SHA-256' }).waitFor();
      assert.equal(await page.locator('#webdav-restore-modal-v378').isHidden(), true);
      assert.deepEqual(JSON.parse(await saved(page)), before);
      await page.evaluate(() => globalThis.__restoreDavBytes());
      await remote.waitFor({ state: 'visible' });
    }
    await remote.click();
    await page.locator('#webdav-restore-modal-v378').waitFor({ state: 'visible' });
    await page.locator('#webdav-restore-cancel-v378').click();
    await page.locator('#webdav-restore-modal-v378').waitFor({ state: 'hidden' });
    assert.deepEqual(JSON.parse(await saved(page)), before);
    await remote.click();
    await page.locator('#webdav-restore-modal-v378').waitFor({ state: 'visible' });
    await page.locator('#webdav-restore-mode-v378').selectOption(mode);
    await page.evaluate(() => {
      const { write } = globalThis.ShirohaPlatform.storage;
      globalThis.__resumeDavWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };
      globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('Synthetic WebDAV restore failure'); };
    });
    await page.locator('#webdav-restore-confirm-v378').click();
    await page.locator('#platform-status.failed').waitFor();
    assert.deepEqual(JSON.parse(await saved(page)), before);
    assert.equal(await page.locator('#webdav-restore-modal-v378').isVisible(), true);
    await page.evaluate(() => globalThis.__resumeDavWrite());
    await page.locator('#webdav-restore-confirm-v378').click();
    await page.locator('#webdav-status-v378').filter({ hasText: '恢复完成' }).waitFor();
    const after = JSON.parse(await saved(page));
    if (mode === 'merge') {
      assert.equal(after.banks.length, before.banks.length * 2);
      assert.equal(after.records.length, before.records.length * 2);
      assert.notEqual(after.records.at(-1).bankId, before.records[0].bankId);
    } else {
      assert.equal(after.banks.length, before.banks.length);
      assert.deepEqual(after.banks.map((bank) => bank.id), before.banks.map((bank) => bank.id));
      assert.equal(after.records[0].id, before.records[0].id);
    }
    const requests = await page.evaluate(() => globalThis.__davMock.requests);
    assert.equal(requests.filter((request) => request.method === 'PUT' && /shiroha-web-backup-/.test(request.relativePath)).length, 1);
    assert(requests.some((request) => request.method === 'GET' && /shiroha-web-backup-/.test(request.relativePath)));
  });
}

test('WebDAV 取消网络任务后释放忙碌状态并保留当前数据', async (t) => {
  const injection = `
    globalThis.__davCancelCount = 0;
    globalThis.ShirohaPlatform.network.webdav = () => new Promise((resolve, reject) => {
      globalThis.__davAbort = () => reject(Object.assign(new Error('测试取消'), { code: 'cancelled' }));
    });
    globalThis.ShirohaPlatform.network.cancelAll = async () => {
      globalThis.__davCancelCount++;
      globalThis.__davAbort?.();
    };
  `;
  const page = await pageFor(t, JSON.stringify(webState()), injection);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const before = await saved(page);
  await page.locator('.nav[data-view="settings"]').click();
  await page.locator('#webdav-endpoint-v378').fill('https://dav.example.invalid');
  await page.locator('#webdav-test-v378').click();
  await page.waitForFunction(() => typeof globalThis.__davAbort === 'function');
  const stop = page.locator('#webdav-stop-native');
  assert.equal(await stop.isEnabled(), true);
  assert.equal(await page.locator('#webdav-test-v378').isDisabled(), true);
  await stop.click();
  await page.waitForFunction(() => !globalThis.document.getElementById('webdav-test-v378').disabled);
  assert.equal(await page.evaluate(() => globalThis.__davCancelCount), 1);
  assert.equal(await stop.isDisabled(), true);
  assert.equal(await saved(page), before);
});

test('恢复后重复初始化不会重复挂载 WebDAV 面板或绑定处理器', async (t) => {
  const transform = (source) => createWebSource(source).replaceStartup('globalThis.__repeatAppStart = startApplication;\nstartApplication();');
  const page = await pageFor(t, JSON.stringify(webState()), '', transform);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const result = await page.evaluate(async () => {
    const button = globalThis.document.getElementById('webdav-test-v378');
    const previousHandler = button.onclick;
    const targets = new Map([
      [globalThis, 'window'],
      [globalThis.document, 'document'],
      [globalThis.document.getElementById('import-text'), 'import-text'],
      [globalThis.document.getElementById('import-bank-name'), 'import-bank-name'],
      [globalThis.document.getElementById('edit-question'), 'edit-question'],
    ]);
    const rebound = [];
    const add = globalThis.EventTarget.prototype.addEventListener;
    globalThis.EventTarget.prototype.addEventListener = function (type, ...args) {
      if (targets.has(this)) { rebound.push(`${targets.get(this)}:${type}`); }
      return add.call(this, type, ...args);
    };
    try {
      await globalThis.__repeatAppStart();
    } finally {
      globalThis.EventTarget.prototype.addEventListener = add;
    }
    return {
      panels: globalThis.document.querySelectorAll('#webdav-panel-v378').length,
      modals: globalThis.document.querySelectorAll('#webdav-restore-modal-v378').length,
      sameButton: globalThis.document.getElementById('webdav-test-v378') === button,
      sameHandler: button.onclick === previousHandler,
      rebound,
    };
  });
  assert.deepEqual(result, { panels: 1, modals: 1, sameButton: true, sameHandler: true, rebound: [] });
});

for (const mode of ['merge', 'overwrite']) {
  test(`本地备份${mode}写入失败保留原数据并可重试`, async (t) => {
    const page = await pageFor(t, JSON.stringify(webState()));
    await page.locator('body[data-storage-state="ready"]').waitFor();
    const before = JSON.parse(await saved(page));
    const backup = importBackupFixture();
    await page.evaluate(() => {
      const { write } = globalThis.ShirohaPlatform.storage;
      globalThis.__resumeLocalBackupWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };
      globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('Synthetic local backup failure'); };
    });
    await page.locator('.nav[data-view="settings"]').click();
    await page.locator('#settings-backup-mode-v23').selectOption(mode);
    await page.locator('#settings-import-backup-v23').click();
    await page.locator('#backup-json-file-v23').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.locator('#platform-status.failed').waitFor();
    assert.deepEqual(JSON.parse(await saved(page)), before);
    assert.equal(await page.locator('#backup-json-file-v23').evaluate((element) => element.files.length), 1);
    await page.evaluate(() => globalThis.__resumeLocalBackupWrite());
    await page.locator('#platform-status').getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForFunction(() => globalThis.document.getElementById('import-summary').textContent.includes('导入完成'));
    const after = JSON.parse(await saved(page));
    assert.equal(after.banks.length, mode === 'merge' ? before.banks.length + backup.banks.length : backup.banks.length);
    assert.equal(after.records.length, mode === 'merge' ? before.records.length + backup.records.length : backup.records.length);
  });
}

test('需要原生检查点时缺少备份图片不会开始替换', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const before = await saved(page);
  await page.evaluate(() => {
    globalThis.ShirohaPlatform.storage.checkpoint = async () => { throw new Error('缺失图片时不应进入检查点'); };
  });
  await page.locator('.nav[data-view="settings"]').click();
  await page.locator('#settings-backup-mode-v23').selectOption('overwrite');
  await page.locator('#backup-json-file-v23').setInputFiles({
    name: 'legacy-missing-image.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(androidBackup())),
  });
  await page.waitForFunction(() => globalThis.document.getElementById('import-summary').textContent.includes('备份缺少图片'));
  assert.equal(await saved(page), before);
});

function importBackupFixture() {
  const initial = webState();
  initial.records[0].id = 'backup-record';
  initial.banks.push({ ...initial.banks[1], id: 'bank-c', name: '第三个题库', groupName: '另一分组' });
  const { api } = loadWeb({ state: initial });
  return plain(api.buildBackupPayloadV23(api.snapshot().banks, 'all_data', true));
}

for (const mode of ['auto', 'json']) {
  test(`完整备份从开始识别合并恢复，分组和学习数据重启后保留：${mode}`, async (t) => {
    const page = await pageFor(t, JSON.stringify(webState()));
    await page.locator('body[data-storage-state="ready"]').waitFor();
    await page.locator('#save-all-btn').click();
    await page.locator('body[data-storage-state="ready"]').waitFor();
    const before = JSON.parse(await saved(page));
    const backup = importBackupFixture();
    const confirmations = [];
    page.on('app-dialog', (dialog) => confirmations.push(dialog.message()));
    await page.locator('.nav[data-view="import"]').click();
    await page.locator('#import-mode').selectOption(mode);
    await page.locator('#import-file').setInputFiles({ name: 'shiroha-quiz-all-data-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => globalThis.document.getElementById('import-text').value.includes('backup-record'));
    await page.locator('#parse-import-btn').click();
    await page.getByText('备份导入完成', { exact: true }).waitFor();
    const after = JSON.parse(await saved(page));
    const imported = after.banks.slice(before.banks.length);
    assert.equal(imported.length, 3);
    assert.match(confirmations[0], /3 个题库，9 道题，1 条学习记录/);
    assert.deepEqual(after.banks.slice(0, before.banks.length), before.banks);
    assert.deepEqual(imported.map((bank) => bank.groupName), backup.banks.map((bank) => bank.groupName));
    assert.deepEqual(imported.map((bank) => bank.questions.length), [7, 1, 1]);
    assert.notEqual(imported[0].id, before.banks[0].id);
    assert.match(imported[0].name, /导入/);
    assert.deepEqual(imported[0].questions[6].extensions, backup.banks[0].questions[6].extensions);
    assert.deepEqual(after.wrongBook[imported[0].id], backup.wrongBook['bank-a']);
    assert.deepEqual(after.favorites[imported[0].id], backup.favorites['bank-a']);
    assert.deepEqual(after.favorites[imported[1].id], backup.favorites['bank-b']);
    assert.deepEqual(after.records.slice(0, before.records.length), before.records);
    const record = after.records.at(-1);
    assert.equal(record.id, 'backup-record');
    assert.equal(record.bankId, imported[0].id);
    assert.equal(record.details[0].sourceBankId, imported[0].id);
    assert.deepEqual(record.details[0].userBlankAnswers, backup.records[0].details[0].userBlankAnswers);
    assert.deepEqual(after.crossPlatformMeta.favoriteQuestions[imported[0].id], backup.webState.crossPlatformMeta.favoriteQuestions['bank-a']);
    assert.equal(await page.locator('#confirm-import-btn').isDisabled(), true);
    await page.reload();
    await page.locator('body[data-storage-state="ready"]').waitFor();
    assert.deepEqual(JSON.parse(await saved(page)), after);
  });
}

test('取消开始识别中的备份合并，保留当前数据和原始 JSON', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const before = await saved(page);
  const text = JSON.stringify(importBackupFixture());
  page.removeAllListeners('app-dialog');
  page.on('app-dialog', (dialog) => dialog.dismiss());
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#import-text').fill(text);
  const opened = page.waitForEvent('app-dialog');
  await page.locator('#parse-import-btn').click();
  await opened;
  await page.locator('#app-dialog').waitFor({ state: 'hidden' });
  assert.equal(await saved(page), before);
  assert.equal(await page.locator('#import-text').inputValue(), text);
});

test('开始识别中的备份保存失败保全原数据，重试成功只合并一次', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const before = JSON.parse(await saved(page));
  const text = JSON.stringify(importBackupFixture());
  await page.evaluate(() => {
    const { write } = globalThis.ShirohaPlatform.storage;
    globalThis.__resumeBackupWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };
    globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('Synthetic backup save failure'); };
  });
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#import-text').fill(text);
  await page.locator('#parse-import-btn').click();
  await page.locator('#platform-status.failed').waitFor();
  assert.deepEqual(JSON.parse(await saved(page)), before);
  assert.equal(await page.locator('#import-text').inputValue(), text);
  await page.evaluate(() => globalThis.__resumeBackupWrite());
  await page.locator('#platform-status').getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText('备份导入完成', { exact: true }).waitFor();
  const after = JSON.parse(await saved(page));
  assert.equal(after.banks.length, before.banks.length + 3);
  assert.equal(after.records.length, before.records.length + 1);
});

test('训练复盘：按选题补读保存解析，离开页面后忽略迟到渲染', async (t) => {
  const initial = webState();
  const bank = initial.banks[0];
  bank.questions = bank.questions.slice(0, 2).map((q) => ({ ...q, analysis: '' }));
  initial.banks = [bank];
  initial.records = [{ ...initial.records[0], bankId: bank.id, details: bank.questions.map((q) => ({ questionId: q.id, sourceBankId: bank.id, nativeQuestion: q, chosen: ['B'], correct: false })) }];
  const page = await pageFor(t, JSON.stringify(initial)); page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const before = JSON.parse(await saved(page)).records;
  await page.evaluate(() => {
    globalThis.__reviewReads = [];
    globalThis.ShirohaPlatform.storage.ensureQuestions = async (snapshot, refs) => {
      globalThis.__reviewReads.push(refs);
      await new Promise((resolve) => { globalThis.__finishReviewRead = resolve; });
      for (const ref of refs) { snapshot.banks.find((bank) => bank.id === ref.bankId).questions.find((q) => q.id === ref.questionId).analysis = `已保存的来源解析：${ref.questionId}`; }
    };
  });
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('#records [data-training-review]').click();
  await page.waitForFunction(() => globalThis.__reviewReads.length === 1);
  assert.deepEqual(await page.evaluate(() => globalThis.__reviewReads), [[{ bankId: bank.id, questionId: bank.questions[0].id }]]);
  await page.evaluate(() => globalThis.__finishReviewRead());
  await page.locator('.training-analysis').filter({ hasText: `已保存的来源解析：${bank.questions[0].id}` }).waitFor();
  await page.waitForFunction(() => globalThis.document.activeElement?.id === 'training-review-back');
  await page.locator('#training-next').click();
  await page.waitForFunction(() => globalThis.__reviewReads.length === 2);
  await page.locator('.nav[data-view="dashboard"]').click();
  await page.evaluate(() => globalThis.__finishReviewRead());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#training-review-content').innerHTML(), '');
  assert.equal(await page.locator('#dashboard.active').count(), 1);
  assert.deepEqual(JSON.parse(await saved(page)).records, before);
});

test('训练复盘：未知来源不读取当前题库的同 ID 解析', async (t) => {
  const initial = webState();
  const q = { ...initial.banks[0].questions[0], analysis: '' };
  initial.records = [{ ...initial.records[0], bankId: '', details: [{ questionId: q.id, nativeQuestion: q, chosen: ['B'], correct: false }] }];
  const page = await pageFor(t, JSON.stringify(initial)); page.setDefaultTimeout(3000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.evaluate(() => {
    globalThis.__unknownSourceReads = 0;
    globalThis.ShirohaPlatform.storage.ensureQuestions = async () => { globalThis.__unknownSourceReads += 1; throw new Error('未知来源不能补读当前库'); };
  });
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('#records [data-training-review]').click();
  await page.locator('#training-question .training-analysis').filter({ hasText: '暂无解析' }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__unknownSourceReads), 0);
});

test('训练计时：宽屏统计栏不遮挡暂停按钮', async (t) => {
  const initial = webState(); initial.records = [];
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = initial.banks[0].questions.filter((q) => q.type === 'single').slice(0, 1);
  const page = await pageFor(t, JSON.stringify(initial)); page.setDefaultTimeout(3000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#start-practice-btn').click();
  await page.locator('.toast-item button').evaluateAll((buttons) => buttons.forEach((button) => button.click()));
  for (const width of [1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 720 });
    const overlap = await page.evaluate(() => {
      const button = globalThis.document.querySelector('#p-pause').getBoundingClientRect();
      const rail = globalThis.document.querySelector('.practice-side-v31').getBoundingClientRect();
      return button.left < rail.right && button.right > rail.left && button.top < rail.bottom && button.bottom > rail.top;
    });
    assert.equal(overlap, false, `${width}px 下统计栏不能覆盖暂停按钮`);
    await page.locator('#p-pause').click();
    await page.locator('#practice-resume').click();
  }
});

for (const mode of ['single', 'total']) {
  test(`训练计时：${mode} 暂停保留作答、阻止快捷键并恢复焦点`, async (t) => {
    const initial = webState(); initial.records = [];
    initial.banks = [initial.banks[0]]; initial.banks[0].questions = initial.banks[0].questions.filter((q) => q.type === 'single').slice(0, 1);
    const page = await pageFor(t, JSON.stringify(initial)); page.setDefaultTimeout(3000);
    await page.locator('.nav[data-view="practice"]').click();
    await page.locator('#practice-submit-mode').selectOption(mode);
    await page.locator('#start-practice-btn').click();
    await page.locator('.toast-item button').evaluateAll((buttons) => buttons.forEach((button) => button.click()));
    await page.locator('#practice-card .option[data-key="B"]').click();
    await page.locator('#p-pause').click();
    const time = await page.locator('#practice-pause-time').textContent();
    await page.keyboard.press('2'); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#practice-pause-time').textContent(), time);
    await page.locator('#practice-resume').click();
    assert(await page.locator('#practice-card input[value="B"]').isChecked());
    assert(await page.locator('#p-pause').evaluate((node) => node === globalThis.document.activeElement));
    await page.locator('#p-pause').click(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#practice-pause-dialog').count(), 0);
  });
}

test('练习：重置后忽略迟到的题目读取', async (t) => {
  const initial = webState();
  initial.records = [];
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="practice"]').click();
  await page.evaluate(() => {
    globalThis.ShirohaPlatform.storage.ensureQuestions = () => new Promise((resolve) => {
      globalThis.__finishOldPracticeRead = resolve;
    });
  });
  await page.locator('#start-practice-btn').click();
  await page.waitForFunction(() => typeof globalThis.__finishOldPracticeRead === 'function');
  await page.locator('#reset-practice-btn').click();
  await page.evaluate(() => globalThis.__finishOldPracticeRead());
  await page.waitForTimeout(100);
  assert.match(await page.locator('#practice-card').innerText(), /选择条件后点击“开始练习”/);
  assert.equal(await page.locator('#practice-card .question-title').count(), 0);
});

test('练习：旧题量确认迟到时不能重置已开始的新一轮', async (t) => {
  const initial = webState();
  initial.records = [];
  const question = initial.banks[0].questions[0];
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = Array.from({ length: 201 }, (_, index) => ({
    ...question, id: `practice-confirm-${index}`, question: `确认轮次 ${index + 1}`, answer: ['A'],
  }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-limit').selectOption('all');
  await page.evaluate(() => {
    let calls = 0;
    globalThis.ShirohaDialogs.confirm = () => {
      calls += 1;
      if (calls === 1) { return new Promise((resolve) => { globalThis.__resolveOldPracticeConfirm = resolve; }); }
      return Promise.resolve(true);
    };
  });
  await page.locator('#start-practice-btn').click();
  await page.waitForFunction(() => typeof globalThis.__resolveOldPracticeConfirm === 'function');
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .question-title').waitFor();
  await page.evaluate(() => globalThis.__resolveOldPracticeConfirm(false));
  await page.waitForTimeout(100);
  await page.locator('#p-next').click();
  assert.match(await page.locator('#practice-card .question-title').innerText(), /确认轮次 2/);
  assert.equal(await page.locator('#practice-progress').innerText(), '2 / 201');
});

test('训练复盘：提前结束保留全部快照，选错与未答可筛选，重开后仍能复盘', async (t) => {
  const initial = webState(); initial.records = [];
  const q = initial.banks[0].questions.find((value) => value.type === 'single');
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = Array.from({ length: 12 }, (_, i) => ({ ...q, id: `training-${i}`, question: `历史快照第${i + 1}题`, answer: ['A'] }));
  const page = await pageFor(t, JSON.stringify(initial)); page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-limit').selectOption('all'); await page.locator('#start-practice-btn').click();
  await page.locator('.toast-item button').evaluateAll((buttons) => buttons.forEach((button) => button.click()));
  await page.locator('#practice-card .option[data-key="B"]').click(); await page.locator('#p-submit').click();
  await page.locator('#p-exit').click(); await page.locator('#practice-review-result').click();
  assert.match(await page.locator('#training-review').textContent(), /提前结束/);
  await page.locator('[data-training-filter="wrong"]').click();
  assert.match(await page.locator('#training-question .option.wrong').textContent(), /B/);
  assert.match(await page.locator('#training-question .option.correct').textContent(), /A/);
  await page.locator('[data-training-filter="unanswered"]').click();
  assert.match(await page.locator('#training-question').textContent(), /未作答/);
  await page.locator('[data-training-filter="all"]').click();
  await page.locator('#training-answer-card-pager .is-wide [aria-label="下一页"]').click();
  await page.locator('[data-training-question="11"]').click();
  assert.match(await page.locator('#training-question').textContent(), /历史快照第12题/);
  await page.setViewportSize({ width: 320, height: 900 });
  const layout = await page.locator('#training-review-content').evaluate((node) => ({ width: node.clientWidth, scrollWidth: node.scrollWidth }));
  assert(layout.scrollWidth <= layout.width + 1, '320px 复盘内容不能水平溢出');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#training-review-back').click();
  await page.waitForFunction(() => globalThis.document.activeElement?.id === 'practice-review-result');
  const snapshot = JSON.parse(await saved(page));
  assert.equal(snapshot.records[0].details.length, 1);
  assert.equal(snapshot.records[0].review.items.length, 12);
  snapshot.banks[0].questions = [];
  await page.evaluate(({ key, value }) => globalThis.localStorage.setItem(key, JSON.stringify(value)), { key: KEY, value: snapshot });
  await page.reload(); await page.locator('.nav[data-view="records"]').click();
  await page.locator('#records [data-training-review]').first().click();
  assert.match(await page.locator('#training-question').textContent(), /历史快照第1题/);
});

test('练习设置自定义题量控件不被裁切，结果页查看复盘按钮与提示条留出间距', async (t) => {
  const initial = webState(); initial.records = [];
  initial.banks = [initial.banks[0]];
  const page = await pageFor(t, JSON.stringify(initial)); page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="practice"]').click();
  const overflow = await page.locator('#practice-custom-count').evaluate((node) => {
    const label = node.closest('label');
    return { overRight: node.getBoundingClientRect().right - label.getBoundingClientRect().right, clipped: label.scrollWidth - label.clientWidth };
  });
  assert(overflow.overRight <= 1, `自定义题量输入框超出所在 label：${overflow.overRight}px`);
  assert(overflow.clipped <= 1, `自定义题量控件被 overflow 裁切：${overflow.clipped}px`);
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .option[data-key="B"]').click();
  await page.locator('#p-submit').click();
  await page.locator('#p-exit').click();
  const gap = await page.locator('#practice-review-result').evaluate((button) => {
    const notice = button.closest('.actions').nextElementSibling;
    return notice ? notice.getBoundingClientRect().top - button.getBoundingClientRect().bottom : -1;
  });
  assert(gap >= 12, `查看复盘按钮与提示条间距不足 12px：${gap}px`);
});

for (const mode of ['single', 'total']) {
  test(`训练计时：${mode} 设置往返暂停、保存失败重试保持冻结用时`, async (t) => {
    const initial = webState(); initial.records = [];
    initial.settings.aiImportV99 = {};
    initial.banks = [initial.banks[0]]; initial.banks[0].questions = [initial.banks[0].questions[0]];
    const page = await pageFor(t, JSON.stringify(initial)); page.setDefaultTimeout(5000);
    await page.clock.install();
    await page.locator('.nav[data-view="practice"]').click(); await page.locator('#practice-submit-mode').selectOption(mode); await page.locator('#start-practice-btn').click();
    await page.locator('.toast-item button').evaluateAll((buttons) => buttons.forEach((button) => button.click()));
    await page.locator('#practice-card .option[data-key="B"]').click();
    await page.clock.fastForward(2000);
    await page.locator('[data-ai-single-open-v613]').click();await page.locator('[data-ai-single-settings-v613]').click(); await page.clock.fastForward(60000);
    await page.locator('.nav[data-view="practice"]').click();
    assert.equal(await page.locator('#practice-pause-time').textContent(), '00:02');
    await page.locator('#practice-resume').click();
    assert(await page.locator('#practice-card input[value="B"]').isChecked());
    assert(!(await page.locator('#practice-card input[value="B"]').isDisabled()));
    await page.evaluate(() => { const { write } = globalThis.ShirohaPlatform.storage;globalThis.__resumeTrainingWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('Synthetic training failure'); }; });
    await page.clock.fastForward(1000);
    await page.locator(mode === 'single' ? '#p-next' : '#p-submit-all').click();
    await page.locator('#platform-status.failed button').waitFor();
    assert(await page.locator('#practice-card input[value="B"]').isDisabled());
    assert.equal(JSON.parse(await saved(page)).records.length, 0);
    await page.clock.fastForward(120000);
    await page.evaluate(() => globalThis.__resumeTrainingWrite());
    await page.locator('#platform-status button').click();
    await page.locator('#practice-review-result').waitFor();
    const record = JSON.parse(await saved(page)).records[0];
    assert.equal(record.duration, 3);
    assert.equal(record.reviewSummary.unanswered, mode === 'single' ? 1 : 0);
    assert.equal(JSON.parse(await saved(page)).records.length, 1);
  });
}

for (const mode of ['single', 'total', 'exam']) {
  for (const type of ['single', 'multiple', 'judge']) {
    test(`清空选项：${mode} ${type} 同步草稿、统计与键盘焦点`, async (t) => {
      const initial = webState();
      const question = initial.banks[0].questions.find((value) => value.type === type);
      initial.banks = [initial.banks[0]];
      initial.banks[0].questions = [question, { ...initial.banks[0].questions[0], id: 'clear-next' }];
      initial.records = [];
      const page = await pageFor(t, JSON.stringify(initial));
      page.setDefaultTimeout(3000);
      const view = mode === 'exam' ? 'exam' : 'practice';
      await page.locator(`.nav[data-view="${view}"]`).click();
      if (mode === 'exam') {
        await page.locator('#exam-count').fill('2');
        await page.locator('#exam-minutes').fill('0');
        await page.locator('#exam-order').selectOption('sequence');
      } else {
        await page.locator('#practice-submit-mode').selectOption(mode);
        await page.locator('#practice-limit').selectOption('all');
      }
      await page.locator(`#start-${view}-btn`).click();
      const root = mode === 'exam' ? page.locator('#exam-card .exam-q').first() : page.locator('#practice-card');
      const clear = root.getByRole('button', { name: '清空第 1 题选项', exact: true });
      assert.equal(await clear.count(), 1);
      assert(await clear.isDisabled());
      const before = await saved(page);
      const choose = (key) => root.locator(`.option[data-key="${key}"]`).click();
      await choose('A');
      if (type === 'multiple') { await choose('C'); }
      assert(!(await clear.isDisabled()));
      if (mode === 'exam') {
        await page.locator('#exam-card .exam-q').nth(1).locator('.option[data-key="B"]').click();
      } else {
        await page.locator('#p-next').click();
        await page.locator('#practice-card .option[data-key="B"]').click();
        await page.locator('#p-prev').click();
      }
      await clear.focus();
      await page.keyboard.press(mode === 'exam' ? 'Space' : 'Enter');
      assert.equal(await root.locator('input:checked, .option.selected').count(), 0);
      assert(await clear.isDisabled());
      assert.equal(await root.locator('.option input').first().evaluate((node) => node === globalThis.document.activeElement), true);
      assert.match(await root.locator('[data-answer-options-status]').innerText(), /已清空本题选项/);
      assert.equal(await page.locator('#app-dialog').count(), 0);
      assert.equal(await saved(page), before, '清空不持久化学习数据或改历史错选');
      if (mode === 'exam') {
        assert.match(await page.locator('#exam-answer-card-v30').innerText(), /已答 1 \/ 2，未答 1/);
        assert(await page.locator('#exam-card .exam-q').nth(1).locator('.option[data-key="B"] input').isChecked());
      } else {
        await page.locator('#p-next').click();
        assert(await page.locator('#practice-card .option[data-key="B"] input').isChecked());
        await page.locator('#p-prev').click();
        assert.equal(await root.locator('input:checked, .option.selected').count(), 0);
        await page.locator('#p-favorite').click();
        assert.equal(await root.locator('input:checked, .option.selected').count(), 0);
        if (mode === 'total') { assert.match(await page.locator('#p-total-status').innerText(), /已填写 1.*未填写 1/); }
      }
      await choose('A');
      assert(!(await clear.isDisabled()));
      await clear.click();
      if (mode === 'single') {
        await page.locator('#p-submit').click();
        assert.match(await page.locator('#p-feedback').innerText(), /请先作答/);
        await choose('A');
        await page.locator('#p-submit').click();
        assert(await clear.isDisabled());
        assert(await root.locator('.option input').first().isDisabled());
        await clear.evaluate((node) => node.click());
        assert(await root.locator('.option[data-key="A"] input').isChecked());
      } else {
        await page.locator(mode === 'exam' ? '#exam-submit-focus-bottom' : '#p-submit-all').click();
        await page.locator(mode === 'exam' ? '#exam-back-setup' : '#back-practice-setup').waitFor();
        const record = JSON.parse(await saved(page)).records[0];
        assert.deepEqual(record.details[0].chosen, []);
        assert.deepEqual(record.details[1].chosen, ['B']);
        assert.equal(await page.locator('[data-clear-answer-options]').count(), 0);
      }
    });
  }
}

test('清空选项：看答案与总提交确认/自评锁定，取消确认后恢复', async (t) => {
  const initial = webState();
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = [initial.banks[0].questions[0], initial.banks[0].questions[4]];
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(3000);
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#start-practice-btn').click();
  const clear = page.locator('[data-clear-answer-options]');
  await page.locator('#practice-card .option[data-key="B"]').click();
  await page.locator('#p-reveal').click();
  assert(await clear.isDisabled());
  await clear.evaluate((node) => node.click());
  assert(await page.locator('#practice-card .option[data-key="B"] input').isChecked());
  await page.locator('#p-exit').focus();
  await page.keyboard.press('Enter');
  await page.locator('#start-practice-btn').waitFor({ state: 'visible' });
  await page.locator('#app-toast .toast-item').last().waitFor({ state: 'hidden', timeout: 10000 });
  await page.locator('#practice-submit-mode').selectOption('total');
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#practice-start-mode-v58916').selectOption('from_start');
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .option[data-key="A"]').click();
  page.removeAllListeners('app-dialog');
  await page.locator('#p-submit-all').click();
  await page.locator('#app-dialog[open]').waitFor();
  assert(await clear.isDisabled());
  await clear.evaluate((node) => node.click());
  assert(await page.locator('#practice-card .option[data-key="A"] input').isChecked());
  await page.locator('#app-dialog [data-dialog-cancel]').click();
  assert(!(await clear.isDisabled()));
  await clear.click();
  await page.locator('#p-next').click();
  assert.equal(await clear.count(), 0, '简答题不显示清空选项');
  await page.locator('#practice-card textarea').fill('待自评草稿');
  await page.locator('#p-prev').click();
  await page.locator('#p-submit-all').click();
  await page.locator('#app-dialog [data-dialog-accept]').click();
  await page.locator('#p-self-right').waitFor();
  await page.locator('#p-self-right').click();
  await page.locator('#back-practice-setup').waitFor();
  assert.deepEqual(JSON.parse(await saved(page)).records[0].details[0].chosen, []);
});

for (const type of ['single', 'judge', 'multiple']) {
  test(`清空选项：考试 ${type} 再次选择取消并同步未答`, async (t) => {
    const initial = webState();
    initial.banks = [initial.banks[0]];
    initial.banks[0].questions = [initial.banks[0].questions.find((value) => value.type === type)];
    const page = await pageFor(t, JSON.stringify(initial));
    await page.locator('.nav[data-view="exam"]').click();
    await page.locator('#exam-minutes').fill('0');
    await page.locator('#start-exam-btn').click();
    const input = page.locator('#exam-card .option[data-key="A"] input');
    await input.focus();
    for (let index = 0; index < 2; index += 1) {
      await page.keyboard.press('Space');
      assert(await input.isChecked());
      await page.keyboard.press('Space');
      assert(!(await input.isChecked()));
      assert(await page.locator('[data-clear-answer-options]').isDisabled());
      assert.match(await page.locator('#exam-answer-card-v30').innerText(), /已答 0 \/ 1，未答 1/);
    }
    const option = page.locator('#exam-card .option[data-key="A"]');
    await option.locator('.option-text').click();
    await option.click();
    assert(!(await input.isChecked()));
  });
}

for (const mode of ['total', 'exam']) {
  test(`清空选项：${mode} 跨库同 ID 与迟到旧控件隔离`, async (t) => {
    const initial = webState();
    initial.banks[0].questions = [initial.banks[0].questions[0]];
    initial.settings.practiceScope = { type: 'group', value: '自建样本' };
    const page = await pageFor(t, JSON.stringify(initial));
    const view = mode === 'exam' ? 'exam' : 'practice';
    await page.locator(`.nav[data-view="${view}"]`).click();
    if (mode === 'exam') {
      await page.locator('#exam-order').selectOption('sequence');
      await page.locator('#exam-minutes').fill('0');
    } else {
      await page.locator('#practice-submit-mode').selectOption('total');
      await page.locator('#practice-limit').selectOption('all');
    }
    await page.locator(`#start-${view}-btn`).click();
    const first = mode === 'exam' ? page.locator('#exam-card .exam-q').nth(0) : page.locator('#practice-card');
    await first.locator('.option[data-key="A"]').click();
    if (mode === 'total') {
      await first.locator('[data-clear-answer-options]').evaluate((node) => { globalThis.__oldClearOptions = node; });
      await page.locator('#p-next').click();
      await page.evaluate(() => globalThis.__oldClearOptions.click());
    }
    const second = mode === 'exam' ? page.locator('#exam-card .exam-q').nth(1) : page.locator('#practice-card');
    await second.locator('.option[data-key="B"]').click();
    await second.locator('[data-clear-answer-options]').click();
    if (mode === 'total') { await page.locator('#p-prev').click(); }
    assert(await first.locator('.option[data-key="A"] input').isChecked());
    await page.locator(mode === 'exam' ? '#exam-submit-focus-bottom' : '#p-submit-all').click();
    await page.locator(mode === 'exam' ? '#exam-back-setup' : '#back-practice-setup').waitFor();
    const { details } = JSON.parse(await saved(page)).records[0];
    assert.deepEqual(details.map((detail) => [detail.sourceBankId, detail.chosen]), [['bank-a', ['A']], ['bank-b', []]]);
  });
}

test('清空选项：考试到时交卷及保存失败重试保留空答案，忙碌和迟到事件不能改卷', async (t) => {
  const initial = webState();
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = [initial.banks[0].questions[0]];
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.clock.install();
  await page.locator('.nav[data-view="exam"]').click();
  await page.locator('#exam-minutes').fill('1');
  await page.locator('#start-exam-btn').click();
  await page.locator('#exam-card .option[data-key="A"]').click();
  await page.locator('[data-clear-answer-options]').click();
  await page.locator('[data-clear-answer-options]').evaluate((node) => { globalThis.__oldClearOptions = node; });
  await page.evaluate(() => {
    const { write } = globalThis.ShirohaPlatform.storage;
    globalThis.__resumeExamWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };
    globalThis.ShirohaPlatform.storage.write = () => new Promise((_resolve, reject) => { globalThis.__failExamWrite = () => reject(new Error('Synthetic exam write failure')); });
  });
  await page.clock.fastForward(60001);
  await page.locator('body[data-storage-state="pending"]').waitFor();
  assert(await page.locator('[data-clear-answer-options]').isDisabled());
  await page.evaluate(() => globalThis.__oldClearOptions.click());
  assert.equal(await page.locator('#exam-card input:checked').count(), 0);
  await page.evaluate(() => globalThis.__failExamWrite());
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(JSON.parse(await saved(page)).records.length, initial.records.length);
  await page.evaluate(() => globalThis.__resumeExamWrite());
  await page.locator('#platform-status button').click();
  await page.locator('#exam-back-setup').waitFor();
  await page.evaluate(() => globalThis.__oldClearOptions.click());
  const { records } = JSON.parse(await saved(page));
  assert.equal(records.length, initial.records.length + 1);
  assert.equal(records[0].autoSubmitted, true);
  assert.equal(records[0].answered, 0);
  assert.deepEqual(records[0].details[0].chosen, []);
});

test('列表分页：直接跳页、四档条数、跨页选择、键盘与窄屏', async (t) => {
  const initial = webState();
  initial.banks[0].questions = Array.from({ length: 503 }, (_, i) => ({ ...initial.banks[0].questions[0], id: `page-${i}`, question: `分页题干 ${i + 1}` }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  const beforePaging = await saved(page);
  const pager = page.locator('#bank-preview-pager');
  const current = () => pager.locator('[aria-current="page"]:visible');
  assert.equal(await page.locator('[data-select-bank-question]').count(), 10);
  assert.equal(await pager.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
  assert.equal(await pager.locator('select').inputValue(), '10');
  await page.locator('[data-select-bank-question="page-0"]').check();
  await pager.getByRole('button', { name: '第 3 页', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#bank-preview tbody tr').first().locator('td').nth(1).innerText(), '21');
  assert.equal(await current().innerText(), '3');
  assert.equal(await current().evaluate((node) => node === globalThis.document.activeElement), true);
  await page.locator('[data-preview-question="page-20"]').click();
  await pager.getByRole('button', { name: '第 51 页', exact: true }).click();
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
  assert.equal(await page.locator('[data-select-bank-question]').count(), 3);
  assert.equal(await pager.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
  for (const size of [20, 50, 100, 10]) {
    await pager.locator('select').selectOption(String(size));
    assert.equal(await page.locator('[data-select-bank-question]').count(), size);
    assert.equal(await current().innerText(), '1');
    assert.equal(await page.locator('[data-select-bank-question="page-0"]').isChecked(), true);
  }
  assert.equal(await saved(page), beforePaging);
  await page.locator('#select-bank-question-page').click();
  assert.match(await page.locator('#bank-question-selection').innerText(), /已选择 10/);
  await pager.getByRole('button', { name: '下一页', exact: true }).click();
  await page.locator('#select-bank-question-page').click();
  assert.match(await page.locator('#bank-question-selection').innerText(), /已选择 20/);
  await page.locator('[data-openbank="bank-b"]').click();
  await page.locator('[data-openbank="bank-a"]').click();
  assert.equal(await current().innerText(), '1');
  await pager.getByRole('button', { name: '第 3 页', exact: true }).click();
  for (const width of [390, 480, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await pager.scrollIntoViewIfNeeded();
    const layout = await pager.evaluate((node) => ({ outsideTable: !node.closest('.table-wrap'), width: node.scrollWidth, available: node.clientWidth, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
    assert.equal(layout.outsideTable, true);
    assert.ok(layout.width <= layout.available + 1);
    assert.ok(layout.left >= 0 && layout.right <= width);
    const sizeStyle = await pager.locator('select').evaluate((node) => ({ height: node.getBoundingClientRect().height, radius: globalThis.getComputedStyle(node).borderRadius }));
    assert.equal(sizeStyle.height, 32);
    assert.equal(sizeStyle.radius, '6px');
    await current().focus();
    await page.keyboard.press('Enter');
    assert.equal(await current().innerText(), '3');
  }
});

test('列表分页：浏览器题库、错题、收藏、记录独立分页和筛选回首页', async (t) => {
  const initial = webState();
  const bank = initial.banks[0];
  bank.questions = Array.from({ length: 23 }, (_, i) => ({ ...bank.questions[0], id: `list-${i}`, question: `列表题干 ${i}` }));
  initial.banks.push(...Array.from({ length: 21 }, (_, i) => ({ ...initial.banks[1], id: `bank-extra-${i}`, name: `分页题库 ${i}` })));
  initial.wrongBook = { 'bank-a': bank.questions.map((q) => ({ id: q.id, status: '未掌握', wrongCount: 1 })) };
  initial.favorites = { 'bank-a': bank.questions.map((q) => q.id) };
  initial.records = Array.from({ length: 23 }, (_, i) => ({ ...initial.records[0], id: `page-record-${i}`, mode: i < 12 ? '考试' : '练习' }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  for (const [view, id, row] of [['banks', 'bank-list', '.bank-item'], ['wrongbook', 'wrongbook-list', '.wrong-item'], ['favorites', 'favorites-list-v596', '.favorite-question-row'], ['records', 'records-list', 'details']]) {
    await page.locator(`.nav[data-view="${view}"]`).click();
    const pager = page.locator(`#${id}-pager`);
    assert.equal(await page.locator(`#${id}`).locator(row).count(), 10);
    await pager.getByRole('button', { name: '第 3 页', exact: true }).click();
    assert.equal(await page.locator(`#${id}`).locator(row).count(), 3);
    if (view === 'favorites') { assert.equal(await page.locator('.favorite-question-number').first().innerText(), '21'); }
    if (view === 'wrongbook') {
      await page.locator('#wrong-sort-mode').selectOption('wrongCount');
      assert.equal(await pager.locator('[aria-current="page"]:visible').innerText(), '1');
      await pager.getByRole('button', { name: '第 3 页', exact: true }).click();
      await page.locator('#wrong-sort-mode').selectOption('lastWrong');
      assert.equal(await pager.locator('[aria-current="page"]:visible').innerText(), '1');
      await page.locator('#wrong-status-filter').selectOption('已掌握');
      assert.equal(await pager.getByRole('button').count(), 0);
      assert.match(await page.locator('#wrongbook-list').innerText(), /暂无错题/);
    }
    if (view === 'records') {
      await page.locator('#record-mode-filter').selectOption('练习');
      assert.equal(await pager.locator('[aria-current="page"]:visible').innerText(), '1');
      assert.match(await pager.innerText(), /共 11 项/);
    }
    if (await pager.locator('select').count()) { await pager.locator('select').selectOption('20'); }
  }
  await page.locator('.nav[data-view="banks"]').click();
  assert.equal(await page.locator('#bank-preview-pager select').inputValue(), '10');
  assert.equal(await page.locator('#bank-list-pager select').inputValue(), '20');
});

test('列表分页：删掉末页后回退，空库保留空态', async (t) => {
  const initial = webState();
  initial.banks[0].questions = Array.from({ length: 21 }, (_, i) => ({ ...initial.banks[0].questions[0], id: `delete-page-${i}` }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  const pager = page.locator('#bank-preview-pager');
  await pager.getByRole('button', { name: '第 3 页', exact: true }).click();
  await page.locator('[data-delete-bank-question="delete-page-20"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(await pager.locator('[aria-current="page"]:visible').innerText(), '2');
  await pager.locator('select').selectOption('100');
  await page.locator('#select-bank-question-page').click();
  await page.locator('#delete-selected-questions').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(await pager.getByRole('button').count(), 0);
  assert.match(await pager.innerText(), /共 0 项/);
  assert.match(await page.locator('#bank-preview').innerText(), /当前题库暂无试题/);
});

test('列表分页：快速翻页拒绝迟到正文，加载失败可在当前页重试', async (t) => {
  const initial = webState();
  initial.banks[0].questions = Array.from({ length: 41 }, (_, i) => ({ ...initial.banks[0].questions[0], id: `delay-${i}`, question: `异步分页 ${i}` }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.evaluate(() => {
    globalThis.__pageLoads = [];
    globalThis.ShirohaPlatform.storage.ensureQuestions = async (_snapshot, refs) => {
      globalThis.__pageLoads.push(refs.map((ref) => ref.questionId));
      if (refs[0]?.questionId === 'delay-10') { await new Promise((resolve) => { globalThis.__finishPageLoad = resolve; }); }
      if (refs[0]?.questionId === 'delay-30' && !globalThis.__allowRetry) { throw Error('分页加载模拟失败'); }
    };
  });
  const pager = page.locator('#bank-preview-pager');
  await pager.getByRole('button', { name: '第 2 页', exact: true }).click();
  await page.waitForFunction(() => globalThis.__finishPageLoad);
  await pager.getByRole('button', { name: '第 3 页', exact: true }).click();
  await page.locator('[data-select-bank-question="delay-20"]').waitFor();
  await page.evaluate(() => globalThis.__finishPageLoad());
  assert.equal(await page.locator('#bank-preview tbody tr').first().locator('td').nth(1).innerText(), '21');
  await pager.getByRole('button', { name: '第 4 页', exact: true }).click();
  await page.locator('#retry-bank-preview').waitFor();
  assert.match(await page.locator('#bank-preview').innerText(), /题目加载失败/);
  assert.equal(await page.locator('[data-select-bank-question]').count(), 0);
  await page.evaluate(() => { globalThis.__allowRetry = true; });
  await page.locator('#retry-bank-preview').click();
  await page.locator('[data-select-bank-question="delay-30"]').waitFor();
  assert.equal(await pager.locator('[aria-current="page"]:visible').innerText(), '4');
  const loads = await page.evaluate(() => globalThis.__pageLoads);
  assert.deepEqual(loads.map((refs) => [refs[0], refs.length]), [['delay-10', 10], ['delay-20', 10], ['delay-30', 10], ['delay-30', 10]]);
});

for (const mode of ['single', 'total']) {
  for (const type of ['single', 'multiple', 'judge']) {
    test(`${mode} 模式 ${type} 支持取消选中，切题后仍未作答`, async (t) => {
      const initial = webState();
      const question = initial.banks[0].questions.find((value) => value.type === type);
      initial.banks = [initial.banks[0]];
      initial.banks[0].questions = [question, { ...initial.banks[0].questions[0], id: 'deselect-next' }];
      initial.records = [];
      initial.wrongBook = {};
      const page = await pageFor(t, JSON.stringify(initial));
      await page.locator('.nav[data-view="practice"]').click();
      await page.locator('#practice-submit-mode').selectOption(mode);
      await page.locator('#practice-limit').selectOption('all');
      await page.locator('#start-practice-btn').click();
      const option = (key) => page.locator(`#practice-card .option[data-key="${key}"]`);
      const assertChosen = async (expected) => {
        assert.deepEqual(await page.locator('#practice-card input:checked').evaluateAll((inputs) => inputs.map((input) => input.value)), expected);
        assert.deepEqual(await page.locator('#practice-card .option.selected').evaluateAll((options) => options.map((option) => option.dataset.key)), expected);
      };
      await option('A').locator('.option-text').click();
      await assertChosen(['A']);
      await option('A').locator('input').click();
      await assertChosen([]);
      await page.locator('#p-next').click();
      await page.locator('#p-prev').click();
      await assertChosen([]);

      await option('A').locator('input').focus();
      await page.keyboard.press('Space');
      await assertChosen(['A']);
      await page.keyboard.press('Space');
      await assertChosen([]);
      await page.keyboard.press('1');
      await assertChosen(['A']);
      await page.keyboard.press('1');
      await assertChosen([]);
      await option('A').dblclick();
      await assertChosen([]);

      await option('A').click();
      await option('B').click();
      await assertChosen(type === 'multiple' ? ['A', 'B'] : ['B']);
      await option('B').click();
      await assertChosen(type === 'multiple' ? ['A'] : []);
      if (type === 'multiple') { await option('A').click(); }
      await page.locator('#p-favorite').click();
      await assertChosen([]);
      if (mode === 'total') {
        assert.match(await page.locator('#p-total-status').innerText(), /已填写 0.*未填写 2/);
        assert.equal(await page.locator('#practice-nav-v26 .done').count(), 0);
        await page.locator('#p-submit-all').click();
        await page.locator('#back-practice-setup').waitFor();
        const record = JSON.parse(await saved(page)).records[0];
        assert.equal(record.correct, 0);
        assert.deepEqual(record.details[0].chosen, []);
      } else {
        await page.locator('#p-submit').click();
        assert.match(await page.locator('#p-feedback').innerText(), /请先作答/);
        assert.deepEqual(JSON.parse(await saved(page)).records, []);
        await option('A').click();
        await page.locator('#p-submit').click();
        await page.locator('#practice-card .option.correct').first().waitFor();
        if (type !== 'multiple') {
          assert(await option('A').locator('input').isDisabled());
          await option('A').evaluate((node) => node.click());
          await assertChosen(['A']);
        }
      }
    });
  }
}

for (const mode of ['single', 'total', 'exam']) {
  test(`${mode} 答错后保存当时选项，重载错题本仍标红`, async (t) => {
    const initial = webState();
    initial.banks = [initial.banks[0]];
    initial.banks[0].questions = [initial.banks[0].questions[0]];
    initial.wrongBook = {};
    const page = await pageFor(t, JSON.stringify(initial));
    const view = mode === 'exam' ? 'exam' : 'practice';
    await page.locator(`.nav[data-view="${view}"]`).click();
    if (mode !== 'exam') { await page.locator('#practice-submit-mode').selectOption(mode); }
    await page.locator(`#start-${view}-btn`).click();
    await page.locator(`#${view}-card .option[data-key="B"]`).click();
    if (mode === 'single') {
      await page.locator('#p-submit').click();
      await page.locator('#practice-card .option.wrong').waitFor();
      await page.locator('#p-next').click();
    } else {
      await page.locator(mode === 'exam' ? '#exam-submit-focus-bottom' : '#p-submit-all').click();
    }
    await page.locator(mode === 'exam' ? '#exam-back-setup' : '#back-practice-setup').waitFor();
    assert.deepEqual(JSON.parse(await saved(page)).wrongBook['bank-a'][0].lastAnswer, ['B']);
    await page.reload();
    await page.locator('.nav[data-view="wrongbook"]').click();
    const wrong = page.locator('#wrongbook-list .option.wrong');
    await wrong.waitFor();
    assert.equal(await wrong.getAttribute('data-key'), 'B');
    assert.match(await wrong.innerText(), /✕ 当时选择/);
    assert.match(await page.locator('#wrongbook-list .review-answer-summary').innerText(), /当时错误答案/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  });
}

test('错题本显示完整题干、全部选项和已保存的错选标记', async (t) => {
  const initial = webState();
  const q = initial.banks[0].questions[0];
  q.question = '完整题干'.repeat(30);
  initial.wrongBook = { [initial.banks[0].id]: [{ id: q.id, status: '未掌握', lastAnswer: ['B'], wrongCount: 1 }] };
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('.nav[data-view="wrongbook"]').click();
  const card = page.locator('#wrongbook-list .wrong-item').first();
  await card.waitFor();
  assert.equal(await card.locator('.question-title').innerText(), q.question);
  assert.deepEqual(await card.locator('.option-text').allTextContents(), ['二', '三']);
  assert.match(await card.locator('.option.correct').innerText(), /正确答案/);
  assert.match(await card.locator('.option.wrong').innerText(), /✕ 当时选择/);
  assert.equal(await card.locator('input').count(), 0);
});

test('启动检查完成后已打开的错题和训练复盘原地启用 AI', async (t) => {
  const initial = webState();
  const question = initial.banks[0].questions[0]; question.analysis = '';
  initial.wrongBook = { 'bank-a': [{ id: question.id, status: '未掌握', lastAnswer: ['B'], wrongCount: 1 }] };
  const injection = `
    let notifyReadiness = () => {};
    const execution = { mode: 'harness', adapter: 'codex', model: 'fixture-model', timeoutSeconds: 120,
      credentialStatus: 'subscription', runtimePath: 'fixture.exe', runtimeVersion: 'fixture', runtimeSource: 'custom',
      runtimeState: 'ready', runtimeReceivedBytes: 0, runtimeTotalBytes: 0, revision: 1, busy: false,
      ready: false, readiness: 'checking', reason: '正在检查 AI 状态…' };
    globalThis.__readinessChecks = 0; globalThis.__readinessRetries = 0; globalThis.__modelCalls = 0;
    globalThis.ShirohaPlatform.harness = {
      initialize: async () => {}, snapshot: () => Object.freeze({ ...execution }), status: () => ({ ...execution }),
      ensureReady: async () => { globalThis.__readinessChecks += 1; }, bind: (changed) => { notifyReadiness = changed; },
      render: () => {}, formMode: () => 'harness', formAdapter: () => 'codex',
      retryReadiness: async () => { globalThis.__readinessRetries += 1; execution.ready = true; delete execution.readiness; execution.reason = ''; notifyReadiness(); },
      execute: async () => { globalThis.__modelCalls += 1; throw new Error('不应自动请求模型'); },
    };
    globalThis.__finishReadiness = () => { execution.ready = true; delete execution.readiness; execution.reason = ''; notifyReadiness(); };
    globalThis.__failReadiness = () => { execution.ready = false; execution.readiness = 'error'; execution.reason = '隔离检查失败'; notifyReadiness(); };
  `;
  const page = await pageFor(t, JSON.stringify(initial), injection);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="wrongbook"]').click();
  const wrong = page.locator('#wrongbook-list [data-review-analysis]').first();
  await wrong.getByText('正在检查 AI 状态…').waitFor();
  assert.equal(await wrong.locator('[data-review-ai="generate"]').isDisabled(), true);
  assert.equal(await wrong.getByText('前往 AI 设置').count(), 0);
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('#records [data-training-review]').first().click();
  const review = page.locator('#training-question [data-review-analysis]');
  await review.getByText('正在检查 AI 状态…').waitFor();
  await page.evaluate(() => globalThis.__finishReadiness());
  await review.locator('[data-review-ai="generate"]').waitFor({ state: 'visible' });
  assert.equal(await review.locator('[data-review-ai="generate"]').isEnabled(), true);
  await page.locator('#training-review-back').click();
  await page.locator('.nav[data-view="wrongbook"]').click();
  assert.equal(await wrong.locator('[data-review-ai="generate"]').isEnabled(), true);
  await page.evaluate(() => globalThis.__failReadiness());
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#import-text').fill('1. 隔离样本题目');
  await page.locator('#ai-organize-import-btn-v99').click();
  const retry = page.locator('#ai-import-settings-btn-v99');
  assert.equal(await retry.innerText(), '重试检查');
  assert.match(await page.locator('#ai-import-privacy-v99').innerText(), /隔离检查失败/);
  await retry.click();
  assert.equal(await page.locator('#ai-import-start-btn-v99').isEnabled(), true);
  assert.equal(await page.locator('#ai-import-privacy-v99').getAttribute('aria-busy'), 'false');
  assert.equal(await page.evaluate(() => globalThis.__readinessRetries), 1);
  assert.equal(await page.evaluate(() => globalThis.__readinessChecks), 1);
  assert.equal(await page.evaluate(() => globalThis.__modelCalls), 0);
});

test('题库预览的题型、分类、分值与操作在宽窄窗口均保持单行', async (t) => {
  const initial = webState();
  initial.banks[0].questions[0].category = '较长的分类名称：综合基础知识';
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  for (const width of [480, 900, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    const failures = await page.locator('#bank-preview').evaluate((table) => {
      const failures = [];
      for (const row of table.rows) {
        for (const index of [2, 5, 6, 7]) {
          const cell = row.cells[index];
          if (!cell) { continue; }
          const nodes = index === 7 && cell.querySelector('button') ? [...cell.querySelectorAll('button')] : [cell];
          const tops = new Set();
          for (const node of nodes) {
            const range = globalThis.document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) { tops.add(Math.round(rect.top)); }
          }
          if (tops.size !== 1 || cell.scrollWidth > cell.clientWidth + 1) { failures.push(cell.textContent); }
        }
      }
      return failures;
    });
    assert.deepEqual(failures, [], `窗口宽度 ${width}`);
  }
});

test('旧组合题练习显示陈述与组合选项，作答仍使用原答案键', async (t) => {
  const initial = webState();
  const statements = ['①有关法律、法规、规章和标准的规定', '②本地区、本部门、本单位的安全生产实际情况', '③应急组织和人员的职责分工明确，并有具体的落实措施', '④有明确的应急保障措施'];
  const combinations = ['①②', '①②③', '②③④', '①②③④'];
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = [{ id: 'legacy-combination', type: 'single', question: '应急预案应当符合下列（ ）基本要求。', answer: ['D'], options: statements.map((text, i) => ({ key: 'ABCD'[i], text: `${text} ${combinations[i]}` })) }];
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#start-practice-btn').click();
  const title = await page.locator('#practice-card .question-title').innerText();
  for (const statement of statements) { assert.ok(title.includes(statement), title); }
  assert.deepEqual(await page.locator('#practice-card .option-text').allTextContents(), combinations);
  await page.locator('#practice-card .option[data-key="D"]').click();
  await page.locator('#p-submit').click();
  assert.match(await page.locator('#p-feedback').innerText(), /回答正确/);
  assert.deepEqual(await page.locator('#practice-card .option-text').allTextContents(), combinations);
});

test('总提交结果列出全部错题，保留跨库来源且不截断到八题', async (t) => {
  const initial = webState();
  const first = initial.banks[0].questions[0];
  initial.banks[0].questions = Array.from({ length: 12 }, (_, index) => ({ ...first, id: index ? `review-${index}` : first.id, question: `完整错题题干 ${index + 1}` }));
  initial.settings.practiceScope = { type: 'group', value: '自建样本' };
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-submit-mode').selectOption('total');
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .option[data-key="B"]').click();
  await page.locator('#p-submit-all').click();
  await page.locator('#again-practice').waitFor();
  const overview = page.locator('#p-wrong-overview');
  assert.equal(await overview.locator('[data-wrong-question-index]').count(), 10);
  assert.match(await overview.locator('[data-wrong-question-index="0"]').innerText(), /阶段A全题型/);
  await page.locator('#p-wrong-overview-list-pager').getByRole('button', { name: '第 2 页', exact: true }).click();
  assert.equal(await overview.locator('[data-wrong-question-index]').count(), 3);
  const last = overview.locator('[data-wrong-question-index="12"]');
  assert.equal(await last.locator('.review-options .option').count(), 2);
  assert.match(await last.innerText(), /跨题库同ID/);
  assert.equal(await last.locator('.review-answer-correct .review-answer-value').innerText(), 'B');
  assert.equal(await last.locator('.option.correct .option-text').innerText(), '三');
  assert.match(await last.innerText(), /未作答/);
  assert.equal(JSON.parse(await saved(page)).records[0].details.length, 13);
  const after = await saved(page);
  await page.locator('#p-wrong-overview-list-pager select').selectOption('20');
  assert.equal(await overview.locator('[data-wrong-question-index]').count(), 13);
  assert.equal(await saved(page), after);
  await page.locator('#again-practice').click();
  await page.locator('#p-submit-all').click();
  await page.locator('#p-wrong-overview').waitFor();
  assert.equal(await page.locator('#p-wrong-overview-list-pager [aria-current="page"]:visible').innerText(), '1');
});

test('总提交：全题型、跨库同 ID、键盘与草稿不提前计分', async (t) => {
  const initial = webState();
  initial.settings.practiceScope = { type: 'group', value: '自建样本' };
  initial.banks[0].questions.push({ id: 'plain-blank', type: 'blank', question: '一加一是___。', answer: ['二'], options: [], analysis: '' });
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-submit-mode').selectOption('total');
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .option[data-key="A"]').click();
  await page.locator('[data-practice-jump="1"]').click();
  await page.locator('#practice-card .option[data-key="A"]').click();
  await page.locator('#practice-card .option[data-key="C"]').click();
  await page.keyboard.press('ArrowRight');
  await page.locator('#practice-card .option[data-key="A"]').click();
  await page.locator('[data-practice-jump="3"]').click();
  await page.locator('.multi-blank-answer-input-v58914').nth(0).fill('北京市');
  await page.locator('.multi-blank-answer-input-v58914').nth(1).fill('京');
  await page.locator('[data-practice-jump="7"]').click();
  await page.locator('#practice-card .text-answer').fill('二');
  await page.locator('[data-practice-jump="8"]').click();
  await page.locator('#practice-card .option[data-key="B"]').click();
  await page.locator('[data-practice-jump="0"]').click();
  assert(await page.locator('#practice-card .option[data-key="A"] input').isChecked());
  await page.locator('[data-practice-jump="1"]').click();
  assert.equal(await page.locator('#practice-card input:checked').count(), 2);
  await page.locator('[data-practice-jump="7"]').click();
  assert.equal(await page.locator('#practice-card .text-answer').inputValue(), '二');
  assert.deepEqual(JSON.parse(await saved(page)).records, initial.records);
  assert.equal(await page.locator('#practice-card .correct, #practice-card .wrong, #p-reveal').count(), 0);
  await page.locator('#p-submit-all').click();
  await page.locator('#again-practice').waitFor();
  const after = JSON.parse(await saved(page));
  assert.equal(after.records.length, initial.records.length + 1);
  assert.equal(after.records[0].correct, 6);
  assert.equal(after.records[0].wrong, 3);
  const twins = after.records[0].details.filter((detail) => detail.questionId === 'same-id');
  assert.deepEqual(twins.map((detail) => [detail.sourceBankId, detail.chosen]), [['bank-a', ['A']], ['bank-b', ['B']]]);
});

test('收藏单题快捷入口先选择提交方式，并保留单题范围', async (t) => {
  const initial = webState();
  initial.favorites['bank-a'] = ['multiple', 'judge', 'unanswered'];
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="favorites"]').click();
  await page.locator('#favorites-list-v596 [data-preview-question="judge"]').click();
  await page.locator('[data-practice-one-fav-v596="judge"]').click();
  await page.locator('#practice-submit-mode').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
  assert.equal(await page.locator('#practice-number-range-v58916').inputValue(), '2-2');
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#practice-submit-mode').selectOption('total');
  await page.locator('#start-practice-btn').click();
  assert.equal(await page.locator('[data-practice-jump]').count(), 1);
  assert.equal(await page.locator('#practice-card .practice-source-number').innerText(), '题库第 3 题');
  assert.match(await page.locator('#practice-card').innerText(), /一加一等于二/);
  await page.locator('#practice-card .option[data-key="A"]').click();
  await page.locator('#p-submit-all').click();
  await page.locator('#again-practice').waitFor();
  assert.equal(JSON.parse(await saved(page)).records[0].correct, 1);
});

test('自选题号和练习题量同时可选，切换起点保留输入且窄屏不溢出', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-custom-count').fill('2');
  await page.locator('#practice-start-mode-v58916').selectOption('custom');
  const range = page.locator('#practice-number-range-v58916');
  await range.fill('2,4-7');
  assert(await page.locator('#practice-limit').isVisible());
  assert(await page.locator('#practice-custom-count').isVisible());
  assert(await range.isVisible());
  assert(await page.locator('#practice-number-hint-v58916').isVisible());
  assert.match(await range.getAttribute('aria-describedby'), /practice-number-hint-v58916/);
  await page.setViewportSize({ width: 360, height: 740 });
  for (const control of [range, page.locator('#practice-limit'), page.locator('#practice-custom-count')]) {
    const bounds = await control.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 360);
  }
  await page.locator('#practice-limit').selectOption('all');
  assert.equal(await page.locator('#practice-custom-count').isVisible(), false);
  await page.locator('#practice-start-mode-v58916').selectOption('from_start');
  assert.equal(await range.isVisible(), false);
  assert.equal(await range.isDisabled(), true);
  assert(await page.locator('#practice-limit').isVisible());
  await page.locator('#practice-start-mode-v58916').selectOption('custom');
  await page.locator('#practice-limit').selectOption('custom');
  assert.equal(await range.inputValue(), '2,4-7');
  assert.equal(await page.locator('#practice-custom-count').inputValue(), '2');
});

const singleStartCases = [
  { name: '顺序和自定义数量', start: '2', limit: 'custom', count: '3', expected: [2, 3, 4] },
  { name: '50题超过剩余数量', start: '2', limit: '50', expected: [2, 3, 4, 5, 6, 7] },
  { name: '一半按起点之后计算', start: '2', limit: 'half', expected: [2, 3, 4] },
  { name: '全部从起点练到末尾', start: '2', limit: 'all', expected: [2, 3, 4, 5, 6, 7] },
  { name: '末尾不足时保留剩余题目', start: '6', limit: 'custom', count: '20', expected: [6, 7] },
  { name: '随机从起点后的范围取题', start: '2', limit: 'custom', count: '3', order: 'random', expected: [3, 4, 5] },
  { name: '收藏来源按筛选结果计算起点', start: '2', limit: 'custom', count: '2', source: 'favorite', expected: [2, 3] },
];

for (const scenario of singleStartCases) {
  test(`单个自选题号作为练习起点：${scenario.name}`, async (t) => {
    const initial = webState();
    initial.favorites['bank-a'] = ['same-id', 'multiple', 'judge', 'unanswered'];
    const page = await pageFor(t, JSON.stringify(initial));
    page.setDefaultTimeout(5000);
    await page.locator('body[data-storage-state="ready"]').waitFor();
    await page.locator('.nav[data-view="practice"]').click();
    await page.locator('#practice-submit-mode').selectOption('total');
    if (scenario.source) { await page.locator('#practice-source').selectOption(scenario.source); }
    if (scenario.order) { await page.locator('#practice-order').selectOption(scenario.order); }
    await page.locator('#practice-limit').selectOption(scenario.limit);
    if (scenario.count) { await page.locator('#practice-custom-count').fill(scenario.count); }
    await page.locator('#practice-start-mode-v58916').selectOption('custom');
    await page.locator('#practice-number-range-v58916').fill(scenario.start);
    await page.evaluate(() => { Math.random = () => 0; });
    await page.locator('#start-practice-btn').click();
    await page.locator('[data-practice-jump="0"]').waitFor();
    assert.equal(await page.locator('[data-practice-jump]').count(), scenario.expected.length);
    const numbers = [];
    for (let index = 0; index < scenario.expected.length; index += 1) {
      await page.locator(`[data-practice-jump="${index}"]`).click();
      numbers.push(await page.locator('#practice-card .practice-source-number').innerText());
    }
    assert.deepEqual(numbers, scenario.expected.map((number) => `题库第 ${number} 题`));
  });
}

test('自选起点拒绝无效题号，单题范围仍只选择一题', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-start-mode-v58916').selectOption('custom');
  const range = page.locator('#practice-number-range-v58916');
  for (const invalid of ['0', '8', 'abc']) {
    await range.fill(invalid);
    await page.locator('#start-practice-btn').click();
    assert.match(await page.locator('#practice-card').innerText(), /题号格式或范围有误/);
    assert.equal(await page.locator('[data-practice-jump]').count(), 0);
  }
  await range.fill('2-2');
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#start-practice-btn').click();
  assert.equal(await page.locator('[data-practice-jump]').count(), 1);
  assert.equal(await page.locator('#practice-card .practice-source-number').innerText(), '题库第 2 题');
});

test('训练复盘重练单道错题时，只包含这道题', async (t) => {
  const initial = webState();
  const question = initial.banks[0].questions[0];
  initial.records = [];
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = Array.from({ length: 3 }, (_, index) => ({
    ...question, id: `retry-single-${index}`, question: `错题重练样本 ${index + 1}`, answer: ['A'],
  }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .option[data-key="B"]').click();
  await page.locator('#p-submit').click();
  await page.locator('#p-exit').click();
  await page.locator('#practice-review-result').click();
  await page.locator('#training-retry').click();
  assert.equal(await page.locator('#practice-number-range-v58916').inputValue(), '1-1');
  await page.locator('#start-practice-btn').click();
  assert.equal(await page.locator('[data-practice-jump]').count(), 1);
  assert.match(await page.locator('#practice-card .question-title').innerText(), /错题重练样本 1/);
});

for (const order of ['sequence', 'random']) {
  for (const [limit, expectedCount] of [['custom', 2], ['half', 3], ['all', 5], ['50', 5], ['100', 5]]) {
    test(`自选题号按所选范围限制题量：${order} / ${limit}`, async (t) => {
      const page = await pageFor(t, JSON.stringify(webState()));
      page.setDefaultTimeout(5000);
      await page.locator('body[data-storage-state="ready"]').waitFor();
      await page.locator('.nav[data-view="practice"]').click();
      await page.locator('#practice-submit-mode').selectOption('total');
      await page.locator('#practice-order').selectOption(order);
      await page.locator('#practice-limit').selectOption(limit);
      if (limit === 'custom') { await page.locator('#practice-custom-count').fill('2'); }
      await page.locator('#practice-start-mode-v58916').selectOption('custom');
      await page.locator('#practice-number-range-v58916').fill('2,4-7,4');
      await page.evaluate(() => { Math.random = () => 0; });
      await page.locator('#start-practice-btn').click();
      await page.locator('[data-practice-jump="0"]').waitFor();
      assert.equal(await page.locator('[data-practice-jump]').count(), expectedCount);
      const numbers = [];
      for (let index = 0; index < expectedCount; index += 1) {
        await page.locator(`[data-practice-jump="${index}"]`).click();
        numbers.push(await page.locator('#practice-card .practice-source-number').innerText());
      }
      const expected = order === 'sequence' ? [2, 4, 5, 6, 7] : [4, 5, 6, 7, 2];
      assert.deepEqual(numbers, expected.slice(0, expectedCount).map((number) => `题库第 ${number} 题`));
    });
  }
}

for (const mode of ['single', 'total']) {
  test(`刷题题号：${mode} 模式按所属题库定位，独立于本轮和导入题号`, async (t) => {
    const initial = webState();
    initial.settings.practiceScope = { type: 'group', value: '自建样本' };
    const page = await pageFor(t, JSON.stringify(initial));
    page.setDefaultTimeout(5000);
    await page.locator('body[data-storage-state="ready"]').waitFor();
    await page.locator('.nav[data-view="practice"]').click();
    await page.locator('#practice-submit-mode').selectOption(mode);
    await page.locator('#practice-order').selectOption('random');
    await page.locator('#practice-start-mode-v58916').selectOption('custom');
    await page.locator('#practice-number-range-v58916').fill('2,8');
    await page.locator('#start-practice-btn').click();
    for (const index of [0, 1]) {
      await page.locator(`[data-practice-jump="${index}"]`).click();
      const multiple = (await page.locator('#practice-card .question-title').innerText()).includes('偶数');
      assert.equal(await page.locator('#practice-card .practice-source-number').innerText(), `题库第 ${multiple ? 2 : 1} 题`);
      assert.match(await page.locator('#practice-card .practice-source-bank').innerText(), multiple ? /阶段A全题型/ : /跨题库同ID/);
      assert.equal(await page.locator('.practice-focus-head > .practice-round-progress').innerText(), `本轮进度 · 第 ${index + 1} / 2 题`);
      await page.locator('#practice-card .option').first().click();
      await page.getByRole('button', { name: `清空第 ${index + 1} 题选项`, exact: true }).click();
      assert.equal(await page.locator('#practice-card input:checked').count(), 0);
      assert.equal(await page.locator('#practice-card .practice-source-number').innerText(), `题库第 ${multiple ? 2 : 1} 题`);
      assert.equal(await page.locator('.practice-focus-head > .practice-round-progress').innerText(), `本轮进度 · 第 ${index + 1} / 2 题`);
    }
  });
}

test('收藏详情：题库题号、完整选项解析、键盘关闭和只读查看', async (t) => {
  const initial = webState();
  initial.favorites['bank-a'] = ['rich', 'multiple', 'blank', 'same-id'];
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="favorites"]').click();
  const before = await saved(page);
  assert.deepEqual(await page.locator('#favorites-list-v596 .favorite-question-number').allTextContents(), ['7', '2', '4', '1']);
  await page.locator('#favorites-list-v596 [data-preview-question="multiple"]').focus();
  await page.keyboard.press('Enter');
  const detail = page.locator('#bank-question-detail');
  assert.equal(await detail.locator('.bank-detail-option').count(), 3);
  assert.equal(await detail.locator('.bank-detail-option.is-answer').count(), 2);
  assert.match(await detail.locator('.bank-detail-analysis').innerText(), /二和四是偶数/);
  await detail.locator('[data-close-detail]').click();
  assert.equal(await page.locator('#favorites-list-v596 [data-preview-question="multiple"]').evaluate((node) => node === globalThis.document.activeElement), true);
  await page.locator('#favorites-list-v596 [data-preview-question="rich"]').click();
  assert.equal(await detail.locator('.bank-detail-option img').count(), 1);
  await page.locator('#favorites-list-v596 [data-preview-question="blank"]').click();
  assert.equal(await detail.count(), 1);
  assert.match(await detail.innerText(), /该题型无需选项/);
  assert.equal(await saved(page), before);
  await page.locator('#favorites-list-v596 [data-unfav-v27="multiple"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(await detail.count(), 0);
  const after = JSON.parse(await saved(page));
  assert.deepEqual(after.favorites['bank-a'], ['rich', 'blank', 'same-id']);
  assert.equal(after.banks[0].questions.length, initial.banks[0].questions.length);
  await page.locator('#favorites-list-v596 [data-preview-question="blank"]').click();
  await page.locator('#practice-favorites-btn-v596').click();
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
});

test('收藏详情：翻页、切库与窄屏工具栏', async (t) => {
  const initial = webState();
  const bank = initial.banks[0];
  bank.questions = Array.from({ length: 21 }, (_, index) => ({ ...bank.questions[0], id: `favorite-${index}` }));
  initial.favorites = { 'bank-a': bank.questions.map((question) => question.id), 'bank-b': ['same-id'] };
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="favorites"]').click();
  await page.locator('#favorites-list-v596 [data-preview-question="favorite-0"]').click();
  const pager = page.locator('#favorites-list-v596-pager');
  await pager.getByRole('button', { name: '第 3 页', exact: true }).click();
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
  assert.equal(await page.locator('#favorites-list-v596 .favorite-question-number').innerText(), '21');
  assert.equal(await pager.evaluate((node) => !node.closest('.table-wrap')), true);
  await page.locator('#favorites-list-v596 [data-preview-question="favorite-20"]').click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator('#bank-question-detail').scrollIntoViewIfNeeded();
  const layout = await page.locator('#bank-question-detail .bank-detail').evaluate((node) => ({ width: node.getBoundingClientRect().width, available: node.closest('.table-wrap').clientWidth }));
  assert.ok(layout.width <= layout.available + 1);
  const button = page.locator('#bank-question-detail [data-close-detail]');
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.locator('#active-bank-select').selectOption('bank-b');
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
  assert.equal(await page.locator('#favorites-list-v596 .favorite-question-number').innerText(), '1');
});

test('收藏详情：迟到正文不覆盖当前页，失败可重试', async (t) => {
  const initial = webState();
  const bank = initial.banks[0];
  bank.questions = Array.from({ length: 21 }, (_, index) => ({ ...bank.questions[0], id: `favorite-load-${index}` }));
  initial.favorites = { 'bank-a': bank.questions.map((question) => question.id) };
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="favorites"]').click();
  await page.evaluate(() => {
    globalThis.ShirohaPlatform.storage.ensureQuestions = async (_snapshot, refs) => {
      if (refs[0]?.questionId === 'favorite-load-10') { await new Promise((resolve) => { globalThis.__finishFavoriteLoad = resolve; }); }
      if (refs[0]?.questionId === 'favorite-load-20' && !globalThis.__favoriteRetry) { throw Error('收藏加载模拟失败'); }
    };
  });
  const pager = page.locator('#favorites-list-v596-pager');
  await pager.getByRole('button', { name: '第 2 页', exact: true }).click();
  await page.waitForFunction(() => globalThis.__finishFavoriteLoad);
  await pager.getByRole('button', { name: '第 3 页', exact: true }).click();
  await page.locator('#retry-favorites').waitFor();
  assert.match(await page.locator('#favorites-list-v596').innerText(), /收藏题加载失败/);
  await page.evaluate(() => { globalThis.__favoriteRetry = true; });
  await page.locator('#retry-favorites').click();
  await page.locator('[data-preview-question="favorite-load-20"]').waitFor();
  await page.evaluate(() => globalThis.__finishFavoriteLoad());
  assert.equal(await page.locator('.favorite-question-number').innerText(), '21');
});

test('题库批量操作栏保留表格间距，选择提示居中且零选择隐藏', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  const selection = page.locator('#bank-question-selection');
  const button = page.locator('#select-bank-question-page');
  await button.waitFor();
  assert.equal(await selection.isVisible(), false);
  await button.click();
  assert.equal(await selection.isVisible(), true);
  const textBox = await selection.boundingBox();
  const buttonBox = await button.boundingBox();
  assert.ok(Math.abs(textBox.y + (textBox.height / 2) - buttonBox.y - (buttonBox.height / 2)) < 2);
  const toolbar = await page.locator('[aria-label="试题批量管理"]').boundingBox();
  const table = await page.locator('#bank-preview').boundingBox();
  assert.ok(table.y - toolbar.y - toolbar.height >= 12);
  await page.locator('#clear-bank-question-selection').click();
  assert.equal(await selection.isVisible(), false);
});

test('题库删除：单题取消、跨页批量、关联清理和重载保全', async (t) => {
  const initial = webState();
  initial.banks[0].questions = Array.from({ length: 302 }, (_, i) => ({ ...initial.banks[0].questions[0], id: `q${i}`, number: `原${i}`, question: `删除回归 ${i}`, extensions: { preserve: i } }));
  initial.wrongBook['bank-a'] = ['q0', { id: 'q300', wrongCount: 2 }, 'q2'];
  initial.favorites['bank-a'] = ['q0', 'q300', 'q2'];
  initial.crossPlatformMeta.favoriteQuestions['bank-a'] = { q0: { favoritedAt: 1 }, q300: { favoritedAt: 2 }, q2: { favoritedAt: 3 } };
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  const baseline = JSON.parse(await saved(page));
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-delete-bank-question="q0"]').waitFor();
  await page.locator('#bank-preview-pager select').selectOption('50');
  page.removeAllListeners('app-dialog');page.once('app-dialog', (dialog) => dialog.dismiss());
  await page.locator('[data-delete-bank-question="q0"]').click();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 302);
  page.on('app-dialog', (dialog) => dialog.accept());
  await page.locator('[data-select-bank-question="q0"]').check();
  for (let i = 0;i < 6;i += 1) { await page.locator('#bank-preview-pager').getByRole('button', { name: '下一页', exact: true }).click(); }
  await page.locator('[data-select-bank-question="q300"]').check();
  assert.match(await page.locator('#bank-question-selection').textContent(), /2/);
  await page.locator('#delete-selected-questions').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const result = JSON.parse(await saved(page));
  assert.deepEqual(result.banks[0].questions, baseline.banks[0].questions.filter((q) => !['q0', 'q300'].includes(q.id)));
  assert.deepEqual(result.banks[1], baseline.banks[1]);
  assert.deepEqual(result.records, baseline.records);
  assert.deepEqual(result.wrongBook['bank-a'], baseline.wrongBook['bank-a'].filter((q) => (q.id || q) === 'q2'));
  assert.deepEqual(result.favorites['bank-a'], ['q2']);
  assert.deepEqual(result.crossPlatformMeta.favoriteQuestions['bank-a'], { q2: { favoritedAt: 3 } });
  assert.match(await page.locator('#bank-preview-pager').textContent(), /第 6 \/ 6 页/);
  await page.reload();await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 300);
});

test('题库删除：切库清空选择、写入失败保留选择、重试删空', async (t) => {
  const initial = webState();const page = await pageFor(t, JSON.stringify(initial));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  const baseline = JSON.parse(await saved(page));
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('#select-bank-question-page').click();
  await page.locator('[data-openbank="bank-b"]').click();
  assert.match(await page.locator('#bank-question-selection').textContent(), /已选择 0/);
  await page.locator('#select-bank-question-page').click();
  await page.evaluate(() => { const { write } = globalThis.ShirohaPlatform.storage;globalThis.__resumeWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('Synthetic deletion failure'); }; });
  await page.locator('#delete-selected-questions').click();await page.locator('#platform-status.failed').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[1].questions.length, 1);
  assert.equal(await page.locator('[data-select-bank-question="same-id"]').isChecked(), true);
  await page.evaluate(() => globalThis.__resumeWrite());
  await page.locator('#platform-status button').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[1].questions.length, 0);
  assert.deepEqual(JSON.parse(await saved(page)).banks[0], baseline.banks[0]);
  await page.locator('#bank-preview').getByText('当前题库暂无试题。', { exact: true }).waitFor();
  await page.reload();await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[1].questions.length, 0);
});

test('题库删除：二次编辑删除保留未编辑题目，允许保存空库', async (t) => {
  const initial = webState();const page = await pageFor(t, JSON.stringify(initial));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  const baseline = JSON.parse(await saved(page));
  const edit = async () => { await page.locator('.nav[data-view="banks"]').click();await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();await page.locator('[data-editbank-v45="bank-a"]').click(); };
  await edit();
  // 桌面释放正文再加载会重建对象；属性插入顺序变化不代表题目被修改。
  await page.evaluate(() => { globalThis.ShirohaPlatform.storage.ensureQuestions = async (snapshot) => { for (const bank of snapshot.banks) { bank.questions = bank.questions.map((q) => Object.fromEntries(Object.entries(q).reverse())); } }; });
  await page.locator('[data-delete-import="0"]').click();await page.locator('#bank-edit-save-v45').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.deepEqual(JSON.parse(await saved(page)).banks[0].questions, baseline.banks[0].questions.slice(1));
  await edit();await page.locator('#import-select-all-visible').check();await page.locator('#batch-delete-import-btn').click();
  assert.equal(await page.locator('#confirm-import-btn').isDisabled(), false);
  await page.locator('#confirm-import-btn').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 0);
});

test('题库删除：进行中练习阻止删除和编辑绕过，其他题库不受影响，完成后可删除', async (t) => {
  const initial = webState();initial.banks[0].questions = initial.banks[0].questions.slice(0, 1);
  const page = await pageFor(t, JSON.stringify(initial));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="practice"]').click();await page.locator('#start-practice-btn').click();
  await page.locator('.nav[data-view="banks"]').dispatchEvent('click');
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 1);
  await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();
  await page.locator('[data-editbank-v45="bank-a"]').click();await page.locator('[data-delete-import="0"]').click();
  await page.locator('#bank-edit-save-v45').click();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 1);
  assert.equal(await page.locator('#bank-edit-panel-v45').isVisible(), true);
  await page.locator('#bank-edit-cancel-v45').click();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();
  await page.locator('[data-openbank="bank-b"]').click();
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[1].questions.length, 0);
  await page.locator('[data-openbank="bank-a"]').click();
  await page.locator('.nav[data-view="practice"]').click();await page.locator('#practice-resume').click();await page.locator('#p-next').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').dispatchEvent('click');
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 0);
});

test('题库删除：未交卷阻止删除，交卷后保留成绩并允许删除', async (t) => {
  const initial = webState();initial.banks[0].questions = initial.banks[0].questions.slice(0, 1);
  const page = await pageFor(t, JSON.stringify(initial));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="exam"]').click();await page.locator('#start-exam-btn').click();
  await page.locator('.nav[data-view="banks"]').dispatchEvent('click');
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 1);
  await page.locator('.nav[data-view="exam"]').click();await page.locator('#submit-exam-btn').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const { records } = JSON.parse(await saved(page));
  await page.locator('.nav[data-view="banks"]').dispatchEvent('click');
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 0);
  assert.deepEqual(JSON.parse(await saved(page)).records, records);
});

test('题库删除：失效 ID 不写入，重复点击只删除一次，旧编辑不能恢复已删除题目', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();
  await page.locator('[data-editbank-v45="bank-a"]').click();
  await page.locator('.nav[data-view="banks"]').click();
  const before = await saved(page);let confirmations = 0;page.on('app-dialog', () => { confirmations += 1; });
  await page.locator('[data-delete-bank-question="same-id"]').evaluate((button) => { button.dataset.deleteBankQuestion = 'missing-id';button.click(); });
  assert.equal(await saved(page), before);assert.equal(confirmations, 0);
  await page.evaluate(() => { const { write } = globalThis.ShirohaPlatform.storage;globalThis.ShirohaPlatform.storage.write = async (...args) => { await new Promise((resolve) => setTimeout(resolve, 150));return write(...args); }; });
  await page.locator('[data-delete-bank-question="missing-id"]').evaluate((button) => { button.dataset.deleteBankQuestion = 'same-id';button.click();button.click(); });
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(confirmations, 1);assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 6);
  await page.locator('.nav[data-view="import"]').click();await page.locator('#bank-edit-save-v45').click();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length, 6);
  assert.equal(await page.locator('#bank-edit-panel-v45').isVisible(), true);
});

test('拖放复用导入解析并拒绝多文件和非法扩展', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  const drop = async (names) => page.evaluate((names) => {
    const transfer = new globalThis.DataTransfer();
    for (const name of names) { transfer.items.add(new globalThis.File(['1. 拖放题目\nA. 甲\nB. 乙\n答案：A'], name)); }
    globalThis.document.getElementById('import').dispatchEvent(new globalThis.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, names);
  await drop(['sample.exe']);
  assert.equal(await page.locator('#import-text').inputValue(), '');
  await drop(['one.txt', 'two.txt']);
  assert.equal(await page.locator('#import-text').inputValue(), '');
  await drop(['sample.txt']);
  await page.waitForFunction(() => globalThis.document.getElementById('import-text').value.includes('拖放题目'));
});
test('延迟初始化不允许编辑，失败原值保留并提供恢复出口', async (t) => {
  const page = await pageFor(t, '{broken', 'const original=globalThis.ShirohaPlatform.storage.initialize;globalThis.ShirohaPlatform.storage.initialize=async()=>{await new Promise(r=>setTimeout(r,250));return original()};');
  assert.equal(await page.locator('.app').getAttribute('inert'), '');
  await page.locator('body[data-storage-state="recovery_required"]').waitFor();
  assert.equal(await saved(page), '{broken');
  const exportButton = page.getByRole('button', { name: '导出原始数据', exact: true });
  assert.equal(await exportButton.count(), 1);
  const downloadEvent = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'shiroha-recovery.json');
  assert.equal(require('node:fs').readFileSync(await download.path(), 'utf8'), '{broken');
  assert.equal(await saved(page), '{broken');
});
test('明确空库重启保持为空；全量重置重新初始化默认题库', async (t) => {
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
test('延迟保存只显示待保存状态；其他标签变化拒绝覆盖', async (t) => {
  const initial = JSON.stringify(webState());
  const page = await pageFor(t, initial, 'const write=globalThis.ShirohaPlatform.storage.write;globalThis.ShirohaPlatform.storage.write=async(...args)=>{await new Promise(r=>setTimeout(r,350));return write(...args)};');
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();
  assert.equal(await page.locator('body').getAttribute('data-storage-state'), 'pending');
  assert.equal(await saved(page), initial);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.evaluate((key) => globalThis.localStorage.setItem(key, 'external-change'), KEY);
  await page.locator('#save-all-btn').click();
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(await saved(page), 'external-change');
});
test('保存锁定期间阻止交互，完成后原有监听器恢复放行', async (t) => {
  const initial = JSON.stringify(webState());
  const injection = 'const write=globalThis.ShirohaPlatform.storage.write;globalThis.ShirohaPlatform.storage.write=async(...args)=>{await new Promise(resolve=>{globalThis.__releaseSyntheticWrite=resolve});return write(...args)};';
  const page = await pageFor(t, initial, injection);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const dispatch = () => page.evaluate(() => {
    const target = globalThis.document.createElement('button');
    globalThis.document.body.appendChild(target);
    const results = ['click', 'change', 'input', 'keydown'].map((type) => target.dispatchEvent(new globalThis.Event(type, { bubbles: true, cancelable: true })));
    target.remove();
    return results;
  });
  assert.deepEqual(await dispatch(), [true, true, true, true]);
  await page.locator('#save-all-btn').click();
  await page.waitForFunction(() => typeof globalThis.__releaseSyntheticWrite === 'function');
  assert.deepEqual(await dispatch(), [false, false, false, false]);
  await page.evaluate(() => globalThis.__releaseSyntheticWrite());
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.deepEqual(await dispatch(), [true, true, true, true]);
});
test('容量不足不清空编辑内容，重试成功后再离开编辑态', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('#bank-rename-input').fill('保存失败时保留名称');
  await page.evaluate(() => { const original = globalThis.Storage.prototype.setItem;globalThis.__restoreStorage = () => { globalThis.Storage.prototype.setItem = original; };globalThis.Storage.prototype.setItem = function (key, value) { if (key === 'shiroha_quiz_state_v28_4_c1') { throw new globalThis.DOMException('Synthetic quota', 'QuotaExceededError'); } return original.call(this, key, value); }; });
  await page.locator('#rename-bank-btn').click();
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(await page.locator('#bank-rename-input').inputValue(), '保存失败时保留名称');
  assert.equal(JSON.parse(await saved(page)).banks[0].name, webState().banks[0].name);
  await page.evaluate(() => globalThis.__restoreStorage());
  await page.locator('#rename-bank-btn').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].name, '保存失败时保留名称');
});
test('考试：旧倒计时回调不能交新一轮的试卷', async (t) => {
  const initial = webState();
  initial.records = [];
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="exam"]').click();
  await page.locator('#exam-minutes').fill('1');
  await page.evaluate(() => {
    const start = Date.now();
    let current = start;
    const setTimer = globalThis.setInterval;
    const clearTimer = globalThis.clearInterval;
    globalThis.__examTicks = [];
    Date.now = () => current;
    globalThis.setInterval = (callback, delay, ...args) => {
      if (delay !== 1000) { return setTimer(callback, delay, ...args); }
      globalThis.__examTicks.push(callback);
      return 1000000 + globalThis.__examTicks.length;
    };
    globalThis.clearInterval = (id) => {
      if (id < 1000000) { clearTimer(id); }
    };
    globalThis.__expireExams = () => { current = start + 61000; };
  });
  await page.locator('#start-exam-btn').click();
  await page.waitForFunction(() => globalThis.__examTicks.length === 1);
  await page.locator('#start-exam-btn').evaluate((button) => button.click());
  await page.waitForFunction(() => globalThis.__examTicks.length === 2);
  await page.evaluate(() => { globalThis.__expireExams(); globalThis.__examTicks[0](); });
  await page.waitForTimeout(100);
  assert.equal(JSON.parse(await saved(page)).records.length, 0);
  assert.equal(await page.locator('#exam-submit-focus').isDisabled(), false);
  await page.evaluate(() => globalThis.__examTicks[1]());
  await page.waitForFunction((key) => JSON.parse(globalThis.localStorage.getItem(key)).records.length === 1, KEY);
  assert.equal(JSON.parse(await saved(page)).records[0].autoSubmitted, true);
});

test('考试提交失败保全记录，重试与重复点击只新增一次', async (t) => {
  const initial = webState();const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="exam"]').click();
  await page.locator('#start-exam-btn').click();
  await page.evaluate(() => { const { write } = globalThis.ShirohaPlatform.storage;globalThis.__resumeWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('Synthetic disk failure'); }; });
  await page.locator('#exam-submit-focus').click();
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(JSON.parse(await saved(page)).records.length, initial.records.length);
  assert.equal(await page.locator('#submit-exam-btn').isDisabled(), false);
  await page.evaluate(() => { globalThis.__resumeWrite();globalThis.document.querySelector('#submit-exam-btn').click();globalThis.document.querySelector('#submit-exam-btn').click(); });
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).records.length, initial.records.length + 1);
  assert.equal(await page.locator('#submit-exam-btn').isDisabled(), true);
});
test('Web 和 file 入口均可解压 DEFLATE 条目', async (t) => {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const archive = 'UEsDBBQAAAAIAI9MaF0mOfTLCwAAAAkAAAALAAAAYmFja3VwLmpzb24zNDI2MTUzt7AEAFBLAQIUABQAAAAIAI9MaF0mOfTLCwAAAAkAAAALAAAAAAAAAAAAAAAAAAAAAABiYWNrdXAuanNvblBLBQYAAAAAAQABADkAAAA0AAAAAAA=';
  for (const url of [server.url, pathToFileURL(path.join(WEB_ROOT, 'index.html')).href]) {
    await page.goto(url);
    await page.locator('body[data-storage-state="ready"]').waitFor();
    const result = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(globalThis.atob(base64), (char) => char.charCodeAt(0));
      const [entry] = globalThis.ShirohaZip.parseZipEntries(bytes.buffer);
      return { method: entry.method, text: await globalThis.ShirohaZip.unzipEntry(bytes.buffer, entry) };
    }, archive);
    assert.deepEqual(result, { method: 8, text: '123456789' });
  }
});
test('file URL 支持 ZIP 与文本导入且不依赖可选 PDF/OCR', async (t) => {
  const context = await browser.newContext();t.after(() => context.close());
  const page = await context.newPage();
  const scriptErrors = [];
  page.on('pageerror', (error) => scriptErrors.push(error.message));
  await context.route('**/libs/**', (route) => route.abort());
  await page.goto(pathToFileURL(path.join(WEB_ROOT, 'index.html')).href);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(
    (nodes) => nodes.map((node) => ({ href: node.getAttribute('href'), loaded: Boolean(node.sheet) })),
  );
  assert.equal(styles.length, 8);
  assert(styles.every((item) => item.loaded), JSON.stringify(styles));
  assert.equal(await page.locator('#import-bank-name').evaluate((element) => globalThis.getComputedStyle(element).borderRadius), '14px');
  const scripts = await page.locator('script[src]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('src')),
  );
  const appIndex = scripts.indexOf('./app.js');
  for (const name of ['./quiz-core.js', './text-answers.js', './text-parser.js', './backup-core.js', './zip.js', './backup-archive.js', './backup-data.js', './webdav-panel.js', './docx-import.js', './pdf-import.js', './ocr-import.js', './table-import.js', './import-preview.js', './ai-results.js', './ai-import-sessions.js', './ai-question-sessions.js', './ai-settings.js', './ai-transport.js', './ai-prompts.js', './question-view.js', './bank-page.js', './saved-questions-page.js', './training-review-page.js', './bank-editor.js', './study-sessions.js', './exam-page.js', './practice-selection.js', './practice-page.js', './ai-import-panel.js', './ai-question-panels.js', './question-editor.js']) {
    assert(scripts.indexOf(name) >= 0 && scripts.indexOf(name) < appIndex);
  }
  assert.deepEqual(
    await page.evaluate(() => [
      typeof globalThis.ShirohaQuizCore,
      typeof globalThis.ShirohaTextAnswers,
      typeof globalThis.ShirohaTextParser,
      typeof globalThis.ShirohaBackupCore,
      typeof globalThis.ShirohaZip,
    ]),
    ['object', 'object', 'object', 'object', 'object'],
  );
  assert.deepEqual(scriptErrors, []);
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#import-mode').selectOption('normal');
  await page.locator('#import-strategy').selectOption('compact');
  await page.locator('#import-save-mode-v59').selectOption('new');
  await page.locator('#import-text').fill('1. 本地文本测试？ A. 甲 B. 乙\n答案：B\n2. 下一题？\nA. 左\nB. 右\n答案：A');
  await page.locator('#parse-import-btn').click();
  await page.locator('#import-summary').filter({ hasText: '最终识别：2题' }).waitFor();
  assert.equal(await page.locator('#import-preview tbody tr').count(), 2);
  await page.locator('#import-bank-name').fill('本地文本解析测试');
  await page.locator('#confirm-import-btn').click();
  await page.locator('#active-bank-select option').filter({ hasText: '本地文本解析测试' }).waitFor({ state: 'attached' });
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const bank = JSON.parse(await saved(page)).banks.find((item) => item.name === '本地文本解析测试');
  assert.deepEqual(bank.questions.map((question) => question.answer), [['B'], ['A']]);
  assert.deepEqual(bank.questions.map((question) => question.options.map((option) => option.text)), [['甲', '乙'], ['左', '右']]);
  assert.deepEqual(scriptErrors, []);
  await page.locator('#save-all-btn').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert(JSON.parse(await saved(page)).banks.length > 0);
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .option[data-key="B"]').first().waitFor();
});
test('恢复写入失败保留原库与文件选择，重试才提交恢复', async (t) => {
  const original = JSON.stringify(webState());const page = await pageFor(t, original);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.evaluate(() => { const { write } = globalThis.ShirohaPlatform.storage;globalThis.__resumeWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('Synthetic restore failure'); }; });
  const backup = webState();backup.banks[0].name = '恢复测试新题库';
  await page.locator('#backup-json-file-v23').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(await saved(page), original);
  assert.equal(await page.locator('#backup-json-file-v23').evaluate((el) => el.files.length), 1);
  await page.evaluate(() => globalThis.__resumeWrite());
  await page.locator('#platform-status button').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert(JSON.parse(await saved(page)).banks.some((bank) => bank.name === '恢复测试新题库'));
});
test('导出与重置失败可见，取消文件选择不修改数据', async (t) => {
  const original = JSON.stringify(webState());const page = await pageFor(t, original);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#import-file').dispatchEvent('change');assert.equal(await saved(page), original);
  await page.evaluate(() => { globalThis.ShirohaPlatform.download = () => { throw new Error('Synthetic export failure'); }; });
  await page.locator('.nav[data-view="settings"]').click();
  await page.locator('#export-all-btn').click();await page.locator('#platform-status.failed').waitFor();
  assert.match(await page.locator('#platform-status').textContent(), /导出失败/);
  await page.locator('.nav[data-view="settings"]').click();
  await page.evaluate(() => { globalThis.ShirohaPlatform.credentials.reset = () => { throw new Error('Synthetic reset failure'); }; });
  await page.locator('#reset-data-btn').click();await page.locator('#platform-status.failed').waitFor();
  assert.equal(await saved(page), original);
  assert.match(await page.locator('#platform-status').textContent(), /reset failure/);
});

test('题库详情：旧组合题的陈述、选项和复制一致且不改写数据', async (t) => {
  const initial = webState();
  const statements = ['①有关法律、法规、规章和标准的规定', '②本地区的安全生产实际情况', '③人员职责明确并有落实措施', '④有明确的应急保障措施'];
  const combinations = ['①②', '①②③', '②③④', '①②③④'];
  const question = initial.banks[0].questions[0];
  question.question = '应急预案应当符合下列（ ）基本要求。';
  question.options = statements.map((text, i) => ({ key: 'ABCD'[i], text: `${text} ${combinations[i]}` }));
  question.answer = ['D'];
  question.richContent = { fields: { question: { text: question.question }, options: question.options.map((option) => ({ ...option })) } };
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('.nav[data-view="banks"]').click();
  const before = await saved(page);
  await page.locator('[data-preview-question="same-id"]').click();
  const body = await page.locator('.bank-detail-body').innerText();
  for (const statement of statements) { assert.ok(body.includes(statement), body); }
  assert.deepEqual(await page.locator('.bank-detail-option > div').allTextContents(), combinations);
  assert.match(await page.locator('.bank-detail-option.is-answer').innerText(), /D/);
  await page.evaluate(() => Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { globalThis.__copied = text; } } }));
  await page.locator('[data-copy-question]').click();
  assert.equal(await page.evaluate(() => globalThis.__copied), [question.question, ...statements].join('\n'));
  await page.evaluate(() => { globalThis.navigator.clipboard.writeText = async () => { throw Error('denied'); }; });
  await page.locator('[data-copy-question]').click();
  assert.equal(await page.locator('#bank-question-manual-copy').inputValue(), [question.question, ...statements].join('\n'));
  assert.equal(await saved(page), before);
});

test('题库详情：完整长题干复制、拒绝回退与选择隔离', async (t) => {
  const initial = webState();
  let full = `${'长题干材料。'.repeat(2000)}\n第二段 $x^2$。`;
  initial.banks[0].questions[0].question = full;
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('#banks.active').waitFor();
  await page.locator('#save-all-btn').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  full = JSON.parse(await saved(page)).banks[0].questions[0].question;
  const before = await saved(page);
  await page.locator('[data-preview-full="same-id"]').click();
  const body = await page.locator('#bank-question-detail .bank-detail-body').innerText();
  assert.ok(body.startsWith('长题干材料。'.repeat(2000)));
  assert.ok(body.includes('第二段'));
  assert.equal(await page.locator('#bank-question-detail .bank-detail-option').count(), 2);
  await page.evaluate(() => Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { globalThis.__copied = text; } } }));
  await page.locator('[data-copy-question]').click();
  assert.equal(await page.evaluate(() => globalThis.__copied), full);
  await page.locator('[data-select-bank-question="same-id"]').check();
  assert.equal(await page.locator('#bank-question-detail').count(), 1);
  await page.evaluate(() => { globalThis.navigator.clipboard.writeText = async () => { throw Error('denied'); }; });
  await page.locator('[data-copy-question]').click();
  assert.equal(await page.locator('#bank-question-manual-copy').inputValue(), full);
  await page.locator('[data-preview-question="multiple"]').click();
  assert.equal(await page.locator('#bank-question-detail').count(), 1);
  assert.equal(await page.locator('.bank-detail-option.is-answer').count(), 2);
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('.nav[data-view="banks"]').click();
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
  assert.equal(await saved(page), before);
});

test('题库详情：富内容复制、分页重置与异步反馈隔离', async (t) => {
  const initial = webState();
  initial.banks[0].questions.push(...Array.from({ length: 50 }, (_, i) => ({ ...initial.banks[0].questions[0], id: `extra-${i}` })));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-preview-question="rich"]').click();
  await page.evaluate(() => Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { globalThis.__copied = text; } } }));
  await page.locator('[data-copy-question]').click();
  const copied = await page.evaluate(() => globalThis.__copied);
  assert.match(copied, /\$x\^2\$/);
  assert.match(copied, /\[图片：题干图\]/);
  assert.equal((copied.match(/\[图片/g) || []).length, 1);
  assert.doesNotMatch(copied, /base64|data:image|选项图|解析图/);
  await page.evaluate(() => { globalThis.navigator.clipboard.writeText = () => new Promise((resolve) => { globalThis.__finishCopy = resolve; }); });
  await page.locator('[data-copy-question]').click();
  await page.locator('[data-preview-question="multiple"]').click();
  await page.evaluate(() => globalThis.__finishCopy());
  assert.equal(await page.locator('[data-copy-question]').textContent(), '复制题干');
  await page.locator('#bank-preview-pager').getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
  await page.locator('#bank-preview-pager').getByRole('button', { name: '上一页', exact: true }).click();
  await page.locator('[data-preview-question="blank"]').focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#bank-question-detail').innerText(), /该题型无需选项/);
  await page.locator('[data-close-detail]').click();
  assert.equal(await page.locator('[data-preview-question="blank"]').evaluate((e) => e === globalThis.document.activeElement), true);
});

test('题库详情：段落、表格和代码复制保留原意', async (t) => {
  const initial = webState();
  const source = '第一段 &amp; 条件。\n\n第二段 $x^2$。\n【DOCX表格开始】\n| 项目 | 值 |\n| --- | --- |\n| 甲 | 乙 |\n【DOCX表格结束】\n```html\n<div>代码原文</div>\n```';
  initial.banks[0].questions[0].richContent = { fields: { question: { text: source } } };
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-preview-question="same-id"]').click();
  await page.evaluate(() => Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { globalThis.__copied = text; } } }));
  await page.locator('[data-copy-question]').click();
  assert.equal(await page.evaluate(() => globalThis.__copied), '第一段 & 条件。\n\n第二段 $x^2$。\n项目\t值\n甲\t乙\n```html\n<div>代码原文</div>\n```');
  await page.setViewportSize({ width: 480, height: 900 });
  await page.locator('[data-copy-question]').scrollIntoViewIfNeeded();
  const layout = await page.locator('.bank-detail').evaluate((node) => ({ width: node.getBoundingClientRect().width, viewport: globalThis.document.getElementById('bank-preview').parentElement.clientWidth }));
  assert.ok(layout.width <= layout.viewport + 1);
  const buttonBounds = await page.locator('[data-copy-question]').boundingBox();
  assert.ok(buttonBounds.x >= 0 && buttonBounds.x + buttonBounds.width <= 480);
});

test('AI 导入与批量建议在页面核对后才写入题库', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.evaluate(() => {
    globalThis.__aiTasks = [];
    globalThis.ShirohaPlatform.network.ai = async (_config, payload) => {
      const input = JSON.parse(payload.messages[1].content);
      globalThis.__aiTasks.push(input.task || 'batch_analysis');
      const content = input.task === 'refactor_questions'
        ? { mode: 'direct_questions', questions: [{ type: 'single', question: '模拟整理题目', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: ['A'] }] }
        : { results: [{ id: input.questions[0].id, analysis: '模拟解析草稿', needsReview: false }] };
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
    };
  });
  await page.locator('.nav[data-view="ai-settings"]').click();
  await page.locator('#ai-provider-v99').selectOption('custom');
  await page.locator('#ai-endpoint-v99').fill('https://mock-ai.invalid/v1/chat/completions');
  await page.locator('#ai-model-v99').fill('fixture');
  await page.locator('#ai-save-settings-v99').click();
  await page.locator('#ai-settings-status-v99').filter({ hasText: '设置已保存' }).waitFor();
  const before = await saved(page);
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#import-mode').selectOption('normal');
  await page.locator('#import-text').fill('自建题目原文');
  await page.locator('#ai-organize-import-btn-v99').click();
  await page.locator('#ai-import-start-btn-v99').click();
  await page.locator('#ai-import-status-v99').filter({ hasText: '整理完成' }).waitFor();
  assert.equal(await saved(page), before);
  await page.locator('#ai-analysis-import-btn-v991').click();
  await page.locator('#ai-preview-start-btn-v991').click();
  await page.locator('#ai-preview-status-v991').filter({ hasText: '生成 1 条建议' }).waitFor();
  assert.equal(await saved(page), before);
  await page.locator('[data-ai-analysis-apply-v991]').click();
  assert.equal(await saved(page), before);
  await page.locator('#import-save-mode-v59').selectOption('new');
  await page.locator('#import-bank-name').fill('AI 测试题库');
  await page.locator('#confirm-import-btn').click();
  await page.waitForFunction((key) => JSON.parse(globalThis.localStorage.getItem(key)).banks.some((bank) => bank.name === 'AI 测试题库'), KEY);
  const after = JSON.parse(await saved(page));
  const bank = after.banks.find((item) => item.name === 'AI 测试题库');
  assert.equal(bank.questions[0].question, '模拟整理题目');
  assert.equal(bank.questions[0].analysis, '答案：A。模拟解析草稿');
  assert.deepEqual(await page.evaluate(() => globalThis.__aiTasks), ['refactor_questions', 'batch_analysis']);
});

async function configureMockImportAi(page) {
  await page.evaluate(() => {
    globalThis.__batchRequests = [];
    globalThis.ShirohaPlatform.network.ai = async (_config, payload) => {
      const input = JSON.parse(payload.messages[1].content);
      return new Promise((resolve) => {
        globalThis.__batchRequests.push({ input, resolve: (content) => resolve({
          ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
        }) });
      });
    };
  });
  await page.locator('.nav[data-view="ai-settings"]').click();
  await page.locator('#ai-provider-v99').selectOption('custom');
  await page.locator('#ai-endpoint-v99').fill('https://mock-ai.invalid/v1/chat/completions');
  await page.locator('#ai-model-v99').fill('fixture');
  await page.locator('#ai-save-settings-v99').click();
  await page.locator('#ai-settings-status-v99').filter({ hasText: '设置已保存' }).waitFor();
  await page.locator('.nav[data-view="import"]').click();
}

async function seedImportQuestions(page, count) {
  const questions = Array.from({ length: count }, (_, index) => ({
    id: `fixture-${index}`, type: 'short', question: `测试题目 ${index + 1}`, options: [], answer: [],
  }));
  await page.locator('#import-mode').selectOption('json');
  await page.locator('#import-text').fill(JSON.stringify({ questions }));
  await page.locator('#parse-import-btn').click();
  await page.locator('#import-summary').filter({ hasText: `识别到 ${count} 道题` }).waitFor();
}

test('AI 面板批量输入、预计次数与双任务互斥', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);
  await seedImportQuestions(page, 31);
  await page.locator('#ai-organize-import-btn-v99').click();
  for (const [button, defaultValue] of [['#ai-review-import-btn-v991', '20'], ['#ai-analysis-import-btn-v991', '10']]) {
    await page.locator(button).click();
    const batch = page.locator('#ai-preview-batch-v991');
    assert.equal(await batch.inputValue(), defaultValue);
    await page.locator('#ai-preview-scope-v991').selectOption('all');
    for (const value of ['', '0', '-1', '1.5', '31']) {
      await batch.fill(value);
      assert.equal(await batch.inputValue(), value);
      assert.equal(await page.locator('#ai-preview-start-btn-v991').isDisabled(), true);
      assert.match(await page.locator('#ai-preview-request-count-v992').innerText(), /—/);
    }
    await batch.fill('1');
    assert.equal(await page.locator('#ai-preview-start-btn-v991').isEnabled(), true);
    await batch.fill('30');
    assert.equal(await page.locator('#ai-preview-request-count-v992').innerText(), '2 次');
    assert.equal(await batch.inputValue(), '30');
  }
  await page.locator('#ai-preview-start-btn-v991').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
  assert.equal(await page.locator('#ai-import-start-btn-v99').isDisabled(), true);
  assert.equal(await page.locator('#ai-preview-start-btn-v991').isDisabled(), true);
  assert.equal(await page.evaluate(() => globalThis.__batchRequests[0].input.questions.length), 30);
  await page.evaluate(() => globalThis.__batchRequests[0].resolve({ results: [] }));
  await page.waitForFunction(() => globalThis.__batchRequests.length === 2);
  assert.equal(await page.evaluate(() => globalThis.__batchRequests[1].input.questions.length), 1);
  await page.evaluate(() => globalThis.__batchRequests[1].resolve({ results: [] }));
  await page.locator('#ai-preview-status-v991').filter({ hasText: '处理 31 道题' }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__batchRequests.length), 2);

  await page.locator('#ai-preview-start-btn-v991').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 3);
  await page.locator('#ai-preview-cancel-btn-v991').click();
  assert.equal(await page.locator('#ai-import-start-btn-v99').isEnabled(), true);
  await page.locator('#ai-import-start-btn-v99').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 4);
  assert.equal(await page.locator('#ai-import-start-btn-v99').isDisabled(), true);
  assert.equal(await page.locator('#ai-preview-start-btn-v991').isDisabled(), true);
  await page.locator('#ai-import-cancel-btn-v99').click();
  await page.evaluate(() => globalThis.__batchRequests.slice(2).forEach((request) => request.resolve({ results: [] })));
});

test('AI 整理期间选区变更后复原仍令旧请求失效', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);
  await seedImportQuestions(page, 1);
  const input = page.locator('#import-text');
  await input.fill('相同 x 相同');
  await input.evaluate((element) => { element.setSelectionRange(0, 2);element.dispatchEvent(new globalThis.Event('select')); });
  await page.locator('#ai-organize-import-btn-v99').click();
  await page.locator('#ai-import-scope-selection-v992').check();
  await page.locator('#ai-import-start-btn-v99').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
  await input.evaluate((element) => { element.setSelectionRange(5, 7);element.dispatchEvent(new globalThis.Event('select')); });
  await input.evaluate((element) => { element.setSelectionRange(0, 2);element.dispatchEvent(new globalThis.Event('select')); });
  assert.equal(await page.locator('#ai-import-start-btn-v99').isEnabled(), true);
  assert.match(await page.locator('#ai-import-status-v99').innerText(), /变化.*停止/);
  const before = await page.locator('#import-summary').innerText();
  await page.evaluate(() => globalThis.__batchRequests[0].resolve({
    mode: 'direct_questions', questions: [{ type: 'short', question: '迟到旧题', options: [], answer: [] }],
  }));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#import-summary').innerText(), before);
  assert.equal(await page.locator('#import-summary').innerText().then((text) => text.includes('迟到旧题')), false);
});

test('AI 全文整理期间仅移动光标或高亮不取消请求', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);
  await seedImportQuestions(page, 1);
  const input = page.locator('#import-text');
  await input.fill('完整原文');
  await page.locator('#ai-organize-import-btn-v99').click();
  await page.locator('#ai-import-start-btn-v99').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
  await input.evaluate((element) => { element.setSelectionRange(0, 2);element.dispatchEvent(new globalThis.Event('select')); });
  await page.evaluate(() => globalThis.__batchRequests[0].resolve({
    mode: 'direct_questions', questions: [{ type: 'short', question: '全文整理结果', options: [], answer: [] }],
  }));
  await page.locator('#ai-import-status-v99').filter({ hasText: '整理完成' }).waitFor();
  assert.match(await page.locator('#import-summary').innerText(), /识别到 1 道题/);
  assert.equal(await page.locator('#import-preview').innerText().then((text) => text.includes('全文整理结果')), true);
});

for (const change of ['重新识别', '编辑后复原']) {
  test(`AI 整理期间${change}立即使旧请求失效`, async (t) => {
    const page = await pageFor(t, JSON.stringify(webState()));
    page.setDefaultTimeout(5000);
    await page.locator('body[data-storage-state="ready"]').waitFor();
    await configureMockImportAi(page);
    await seedImportQuestions(page, 1);
    await page.locator('#ai-organize-import-btn-v99').click();
    await page.locator('#ai-import-start-btn-v99').click();
    await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
    if (change === '重新识别') {
      await page.locator('#parse-import-btn').click();
    } else {
      await page.locator('[data-edit-import="0"]').click();
      await page.locator('#edit-question').fill('新内容');
      await page.locator('#edit-save-btn').click();
      await page.locator('#edit-question').fill('测试题目 1');
      await page.locator('#edit-save-btn').click();
      await page.locator('#edit-close-btn').click();
    }
    assert.equal(await page.locator('#ai-import-start-btn-v99').isEnabled(), true);
    assert.match(await page.locator('#ai-import-status-v99').innerText(), /变化.*停止/);
    const before = await page.locator('#import-preview').innerText();
    await page.evaluate(() => globalThis.__batchRequests[0].resolve({
      mode: 'direct_questions', questions: [{ type: 'short', question: '迟到旧题', options: [], answer: [] }],
    }));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#import-preview').innerText(), before);
  });
}

test('AI 批量建议在无关题删除后仍归属原题并经人工采纳或编辑', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);
  await seedImportQuestions(page, 5);
  const persisted = await saved(page);
  await page.locator('[data-select-import="1"]').check();
  await page.locator('[data-select-import="3"]').check();
  await page.locator('#ai-analysis-import-btn-v991').click();
  await page.locator('#ai-preview-scope-v991').selectOption('selected');
  await page.locator('#ai-preview-batch-v991').fill('1');
  await page.locator('#ai-preview-start-btn-v991').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
  assert.equal(await page.evaluate(() => globalThis.__batchRequests[0].input.questions[0].question), '测试题目 2');
  await page.locator('[data-delete-import="0"]').click();
  await page.locator('#import-summary').filter({ hasText: '识别到 4 道题' }).waitFor();
  assert.equal(await page.locator('[data-select-import="0"]').isChecked(), true);
  assert.equal(await page.locator('[data-select-import="2"]').isChecked(), true);
  await page.evaluate(() => {
    const first = globalThis.__batchRequests[0];
    first.resolve({ results: [{ id: first.input.questions[0].id, analysis: '第二题建议' }] });
  });
  await page.waitForFunction(() => globalThis.__batchRequests.length === 2);
  assert.equal(await page.evaluate(() => globalThis.__batchRequests[1].input.questions[0].question), '测试题目 4');
  await page.evaluate(() => {
    const second = globalThis.__batchRequests[1];
    second.resolve({ results: [{ id: second.input.questions[0].id, analysis: '第四题建议' }] });
  });
  await page.locator('#ai-preview-status-v991').filter({ hasText: '生成 2 条建议' }).waitFor();
  const keys = await page.evaluate(() => globalThis.__batchRequests.map((request) => request.input.questions[0].id));
  await page.locator(`[data-ai-analysis-apply-v991="${keys[0]}"]`).click();
  await page.locator('[data-edit-import="0"]').click();
  assert.match(await page.locator('#edit-analysis').inputValue(), /第二题建议/);
  await page.locator('#edit-close-btn').click();
  await page.locator(`[data-ai-analysis-edit-v991="${keys[1]}"]`).click();
  assert.match(await page.locator('#edit-question').inputValue(), /测试题目 4/);
  assert.equal(await page.locator('#edit-analysis').inputValue(), '第四题建议');
  await page.locator('#edit-analysis').fill('第四题人工编辑');
  await page.locator('#edit-save-btn').click();
  await page.locator('#edit-close-btn').click();
  await page.locator('[data-edit-import="2"]').click();
  assert.match(await page.locator('#edit-question').inputValue(), /测试题目 4/);
  assert.match(await page.locator('#edit-analysis').inputValue(), /第四题人工编辑/);
  assert.equal(await saved(page), persisted);
});

test('编辑弹窗删除无关题后保留其他题目的勾选', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await seedImportQuestions(page, 3);
  await page.locator('[data-select-import="1"]').check();
  await page.locator('[data-select-import="2"]').check();
  await page.locator('[data-edit-import="0"]').click();
  await page.locator('#edit-delete-btn').click();
  await page.locator('#import-summary').filter({ hasText: '识别到 2 道题' }).waitFor();
  assert.equal(await page.locator('[data-select-import="0"]').isChecked(), true);
  assert.equal(await page.locator('[data-select-import="1"]').isChecked(), true);
});

test('AI 整理期间表格替换草稿后丢弃迟到结果', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);
  await seedImportQuestions(page, 1);
  await page.locator('#ai-organize-import-btn-v99').click();
  await page.locator('#ai-import-start-btn-v99').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
  const csv = '题号,题干,A,B,答案\n1,表格新题,甲,乙,A';
  await page.locator('#import-file').setInputFiles({ name: '自建.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.locator('#import-preview').getByText('表格新题', { exact: true }).waitFor();
  assert.equal(await page.locator('#ai-import-start-btn-v99').isEnabled(), true);
  assert.match(await page.locator('#ai-import-status-v99').innerText(), /变化.*停止/);
  const before = await page.locator('#import-preview').innerText();
  await page.evaluate(() => globalThis.__batchRequests[0].resolve({
    mode: 'direct_questions', questions: [{ type: 'short', question: '迟到旧题', options: [], answer: [] }],
  }));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#import-preview').innerText(), before);
});

test('批量期间目标题编辑后复原仍停止余批并保留先前建议', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);
  await seedImportQuestions(page, 5);
  await page.locator('[data-select-import="1"]').check();
  await page.locator('[data-select-import="3"]').check();
  await page.locator('#ai-analysis-import-btn-v991').click();
  await page.locator('#ai-preview-scope-v991').selectOption('selected');
  await page.locator('#ai-preview-batch-v991').fill('1');
  await page.locator('#ai-preview-start-btn-v991').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
  await page.locator('[data-edit-import="3"]').click();
  await page.locator('#edit-question').fill('临时编辑');
  await page.locator('#edit-save-btn').click();
  await page.locator('#edit-question').fill('测试题目 4');
  await page.locator('#edit-save-btn').click();
  await page.locator('#edit-close-btn').click();
  await page.evaluate(() => {
    const first = globalThis.__batchRequests[0];
    first.resolve({ results: [{ id: first.input.questions[0].id, analysis: 'B 建议' }] });
  });
  await page.locator('#ai-preview-status-v991').filter({ hasText: '目标题目已变化' }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__batchRequests.length), 1);
  assert.match(await page.locator('#import-preview').innerText(), /B 建议/);
});

test('AI 整理输入先清除旧选区，隐藏面板也立即回到全文', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);
  const input = page.locator('#import-text');
  await input.fill('原始题库文本');
  await input.evaluate((element) => { element.setSelectionRange(0, 2);element.dispatchEvent(new globalThis.Event('select')); });
  await page.locator('#ai-organize-import-btn-v99').click();
  await page.locator('#ai-import-scope-selection-v992').check();
  await page.evaluate(() => {
    globalThis.__batch2PanelWrites = 0;
    const provider = globalThis.document.querySelector('#ai-import-provider-v99');
    globalThis.__batch2PanelObserver = new globalThis.MutationObserver((records) => { globalThis.__batch2PanelWrites += records.length; });
    globalThis.document.querySelector('#import-text').addEventListener('input', () => {
      globalThis.__batch2PanelObserver.observe(provider, { childList: true, subtree: true, characterData: true });
    }, { capture: true, once: true });
  });
  await input.evaluate((element) => { element.value = '更新后的完整文本';element.dispatchEvent(new globalThis.Event('input', { bubbles: true })); });
  assert.equal(await page.locator('#ai-import-scope-all-v992').isChecked(), true);
  assert.match(await page.locator('#ai-import-range-hint-v992').innerText(), /全部原始文本/);
  assert.equal(await page.evaluate(() => globalThis.__batch2PanelWrites), 1);
  await page.evaluate(() => globalThis.__batch2PanelObserver.disconnect());
  await input.evaluate((element) => { element.setSelectionRange(0, 2);element.dispatchEvent(new globalThis.Event('select')); });
  await page.locator('#ai-import-scope-selection-v992').check();
  await page.locator('#ai-import-cancel-btn-v99').click();
  await input.fill('隐藏时替换的新全文');
  assert.equal(await page.locator('#ai-import-scope-all-v992').isChecked(), true);
  await page.locator('#ai-organize-import-btn-v99').click();
  assert.equal(await page.locator('#ai-import-scope-all-v992').isChecked(), true);
  assert.match(await page.locator('#ai-import-range-hint-v992').innerText(), /全部原始文本/);
  await input.evaluate((element) => { element.setSelectionRange(0, 2);element.dispatchEvent(new globalThis.Event('select')); });
  await page.locator('#ai-import-scope-selection-v992').check();
  await page.locator('#ai-import-cancel-btn-v99').click();
  await input.evaluate((element) => { element.setSelectionRange(1, 1);element.dispatchEvent(new globalThis.Event('select')); });
  assert.equal(await page.locator('#ai-import-scope-all-v992').isChecked(), true);
  await page.locator('#ai-organize-import-btn-v99').click();
  assert.equal(await page.locator('#ai-import-scope-all-v992').isChecked(), true);
});

test('AI 成功结束只同步一次，中间批次仍立即展示建议', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);await seedImportQuestions(page, 2);
  await page.locator('#ai-organize-import-btn-v99').click();
  await page.locator('#ai-analysis-import-btn-v991').click();
  await page.locator('#ai-preview-scope-v991').selectOption('all');
  await page.locator('#ai-preview-batch-v991').fill('1');
  await page.locator('#ai-preview-start-btn-v991').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
  await page.evaluate(() => {
    globalThis.__batch2Refreshes = { import: 0, preview: 0 };
    const text = Object.getOwnPropertyDescriptor(globalThis.Node.prototype, 'textContent');
    for (const [selector, key] of [['#ai-import-provider-v99', 'import'], ['#ai-preview-title-v991', 'preview']]) {
      const node = globalThis.document.querySelector(selector);
      Object.defineProperty(node, 'textContent', { configurable: true,
        get() { return text.get.call(this); },
        set(value) { globalThis.__batch2Refreshes[key] += 1;text.set.call(this, value); } });
    }
  });
  await page.evaluate(() => { const request = globalThis.__batchRequests[0];request.resolve({ results: [{ id: request.input.questions[0].id, analysis: '第一批建议', needsReview: false }] }); });
  await page.waitForFunction(() => globalThis.__batchRequests.length === 2);
  assert.equal(await page.locator('[data-ai-analysis-apply-v991]').count(), 1);
  assert.equal(await page.locator('#ai-preview-start-btn-v991').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => globalThis.__batch2Refreshes), { import: 0, preview: 1 });
  await page.evaluate(() => { globalThis.__batch2Refreshes = { import: 0, preview: 0 };const request = globalThis.__batchRequests[1];request.resolve({ results: [{ id: request.input.questions[0].id, analysis: '第二批建议', needsReview: false }] }); });
  await page.locator('#ai-preview-status-v991').filter({ hasText: '处理 2 道题' }).waitFor();
  assert.equal(await page.locator('[data-ai-analysis-apply-v991]').count(), 2);
  assert.equal(await page.locator('#ai-preview-start-btn-v991').isEnabled(), true);
  const previewEnd = await page.evaluate(() => globalThis.__batch2Refreshes);
  await page.locator('#import-text').fill('待整理的原文');
  await page.locator('#ai-import-start-btn-v99').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 3);
  await page.evaluate(() => { globalThis.__batch2Refreshes = { import: 0, preview: 0 };globalThis.__batchRequests[2].resolve({ mode: 'direct_questions', questions: [{ type: 'short', question: '整理后的题', options: [], answer: [] }] }); });
  await page.locator('#ai-import-status-v99').filter({ hasText: '整理完成' }).waitFor();
  assert.equal(await page.locator('#ai-import-start-btn-v99').isEnabled(), true);
  const importEnd = await page.evaluate(() => globalThis.__batch2Refreshes);
  console.log(`successful completion refreshes: ${JSON.stringify({ previewEnd, importEnd })}`);
  assert.deepEqual(previewEnd, { import: 1, preview: 1 });
  assert.deepEqual(importEnd, { import: 1, preview: 1 });
});

function examInstrumentation(source) {
  return `(() => {
    const create = globalThis.ShirohaExamPage.create;
    globalThis.__examCounts = { keys: 0, answers: 0, cardWrites: 0 };
    globalThis.ShirohaExamPage.create = (args) => {
      const key = args.question.key;
      const hasAnswer = args.question.hasAnswer;
      args.question.key = (...values) => { globalThis.__examCounts.keys += 1; return key(...values); };
      args.question.hasAnswer = (...values) => { globalThis.__examCounts.answers += 1; return hasAnswer(...values); };
      const controller = create(args);
      globalThis.__examFixture = { controller, session: args.session };
      return controller;
    };
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    Object.defineProperty(Element.prototype, 'outerHTML', {
      ...descriptor,
      set(value) {
        if (this.id === 'exam-answer-card-v30') { globalThis.__examCounts.cardWrites += 1; }
        descriptor.set.call(this, value);
      },
    });
  })();\n${source}`;
}

function exposeExamRender(source) {
  const from = 'return { exitExamFocus, startExam, startExamTicker, submitExam, examQuestionV113 };';
  assert(source.includes(from));
  return source.replace(from, 'return { exitExamFocus, startExam, startExamTicker, submitExam, examQuestionV113, renderExamPaper };');
}

test('第三批考试：局部更新计数、焦点与同卷重绘后的迟到事件', async (t) => {
  const initial = webState();
  const single = initial.banks[0].questions[0];
  const short = initial.banks[0].questions.find((question) => question.type === 'short');
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = [single, short, ...Array.from({ length: 38 }, (_, index) => ({ ...single, id: `exam-extra-${index}` }))];
  initial.records = [];
  const page = await pageFor(t, JSON.stringify(initial), '', examInstrumentation, { '/exam-page.js': exposeExamRender });
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="exam"]').click();
  await page.locator('#exam-order').selectOption('sequence');
  await page.locator('#exam-count').fill('40');
  await page.locator('#exam-minutes').fill('0');
  await page.locator('#start-exam-btn').click();
  await page.evaluate(() => {
    globalThis.__examCard = globalThis.document.querySelector('#exam-answer-card-v30');
    globalThis.__examOtherJump = globalThis.document.querySelector('[data-exam-jump="2"]');
  });
  const reset = () => page.evaluate(() => { Object.assign(globalThis.__examCounts, { keys: 0, answers: 0, cardWrites: 0 }); });
  const check = async (answered) => {
    assert.match(await page.locator('#exam-answer-card-v30').innerText(), new RegExp(`已答 ${answered} / 40，未答 ${40 - answered}`));
    const observed = await page.evaluate(() => ({
      ...globalThis.__examCounts,
      cardSame: globalThis.__examCard === globalThis.document.querySelector('#exam-answer-card-v30'),
      otherSame: globalThis.__examOtherJump === globalThis.document.querySelector('[data-exam-jump="2"]'),
    }));
    console.log(`exam answer update: ${JSON.stringify(observed)}`);
    assert.equal(observed.cardWrites, 0, JSON.stringify(observed));
    assert.equal(observed.cardSame, true);
    assert.equal(observed.otherSame, true);
    assert.ok(observed.keys <= 2, JSON.stringify(observed));
    assert.ok(observed.answers <= 2, JSON.stringify(observed));
  };
  await reset();
  await page.locator('#exam-card .exam-q').first().locator('.option[data-key="A"]').click();
  await check(1);
  const input = page.locator('#exam-card .exam-q').nth(1).locator('textarea');
  for (const [value, answered] of [['第一版', 2], ['修改后的答案', 2], ['', 1]]) {
    await reset();await input.fill(value);await check(answered);
    assert.equal(await input.evaluate((node) => node === globalThis.document.activeElement), true);
  }
  await page.evaluate(() => {
    globalThis.__oldExamText = globalThis.document.querySelector('#exam-card textarea');
    globalThis.__oldExamOption = globalThis.document.querySelector('#exam-card .option[data-key="A"] input');
    globalThis.__examFixture.controller.renderExamPaper();
  });
  const before = await page.evaluate(() => JSON.stringify(globalThis.__examFixture.session.current.answers));
  await page.evaluate(() => {
    globalThis.__oldExamText.value = '迟到答案';
    globalThis.__oldExamText.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
    globalThis.__oldExamOption.checked = false;
    globalThis.__oldExamOption.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => JSON.stringify(globalThis.__examFixture.session.current.answers)), before);
  assert.match(await page.locator('#exam-answer-card-v30').innerText(), /已答 1 \/ 40，未答 39/);
  await page.evaluate(() => globalThis.__examFixture.controller.startExam());
  const next = await page.evaluate(() => JSON.stringify(globalThis.__examFixture.session.current.answers));
  await page.evaluate(() => {
    globalThis.__oldExamText.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
    globalThis.__oldExamOption.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => JSON.stringify(globalThis.__examFixture.session.current.answers)), next);
});

test('第三批考试：保存失败后继续编辑、重试与重复提交保持最新答案', async (t) => {
  const initial = webState();
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = [initial.banks[0].questions[0], initial.banks[0].questions.find((question) => question.type === 'short')];
  initial.records = [];
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="exam"]').click();
  await page.locator('#exam-order').selectOption('sequence');
  await page.locator('#exam-minutes').fill('0');
  await page.locator('#start-exam-btn').click();
  await page.locator('#exam-card .option[data-key="A"]').first().click();
  await page.locator('#exam-card textarea').fill('原答案');
  await page.evaluate(() => {
    const { write } = globalThis.ShirohaPlatform.storage;
    globalThis.__restoreThirdExamWrite = () => { globalThis.ShirohaPlatform.storage.write = write; };
    globalThis.ShirohaPlatform.storage.write = async () => { throw new Error('模拟考试保存失败'); };
  });
  await page.locator('#exam-submit-focus').click();
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(JSON.parse(await saved(page)).records.length, 0);
  await page.locator('[data-clear-answer-options]').first().click();
  await page.locator('#exam-card textarea').fill('重试前的新答案');
  assert.match(await page.locator('#exam-answer-card-v30').innerText(), /已答 1 \/ 2，未答 1/);
  await page.evaluate(() => globalThis.__restoreThirdExamWrite());
  await page.locator('#platform-status button').click();
  await page.locator('#exam-back-setup').waitFor();
  await page.locator('#submit-exam-btn').evaluate((button) => { button.click();button.click(); });
  const { records } = JSON.parse(await saved(page));
  assert.equal(records.length, 1);
  assert.equal(records[0].answered, 1);
  assert.deepEqual(records[0].details.map((detail) => detail.chosen), [[], ['重试前的新答案']]);
});

test('第三批题库：局部勾选保留节点、跨页选择并拒绝迟到事件', async (t) => {
  const initial = webState();
  initial.banks.push(...Array.from({ length: 11 }, (_, index) => ({
    ...initial.banks[1], id: `bulk-${index}`, name: `批量题库 ${index}`,
  })));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('#export-bank-all-v23').uncheck();
  const first = page.locator('#bank-list [data-bank-bulk-v23]').first();
  await first.evaluate((node) => {
    globalThis.__oldBankCheckbox = node;
    globalThis.__oldBankListFirst = globalThis.document.querySelector('#bank-list .bank-item');
    globalThis.__bankWrites = 0;
    globalThis.__bankObserver = new globalThis.MutationObserver((records) => {
      globalThis.__bankWrites += records.filter((record) => record.target.id === 'bank-list' && record.type === 'childList').length;
    });
    globalThis.__bankObserver.observe(globalThis.document.querySelector('#bank-list'), { childList: true });
  });
  await first.focus();
  await page.keyboard.press('Space');
  assert.equal(await first.evaluate((node) => node === globalThis.document.activeElement), true);
  assert.equal(await page.evaluate(() => globalThis.__bankWrites), 0);
  assert.equal(await page.evaluate(() => globalThis.__oldBankListFirst === globalThis.document.querySelector('#bank-list .bank-item')), true);
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /已选择 1 个题库/);
  await page.locator('#bank-list-pager').getByRole('button', { name: '第 2 页', exact: true }).click();
  const selectedBefore = await page.locator('#export-bank-summary-v23').innerText();
  await page.evaluate(() => {
    globalThis.__oldBankCheckbox.checked = false;
    globalThis.__oldBankCheckbox.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
  });
  assert.equal(await page.locator('#export-bank-summary-v23').innerText(), selectedBefore);
  await page.locator('#bank-list [data-bank-bulk-v23]').first().check();
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /已选择 2 个题库/);
  await page.locator('#export-bank-all-v23').check();
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /已选择 13 个题库/);
  await page.locator('#export-bank-invert-v23').click();
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /请至少选择一个题库/);
  await page.evaluate(() => {
    const { write } = globalThis.ShirohaPlatform.storage;
    globalThis.__releaseBulkWrite = null;
    globalThis.ShirohaPlatform.storage.write = (...args) => new Promise((resolve, reject) => {
      globalThis.__releaseBulkWrite = () => { globalThis.ShirohaPlatform.storage.write = write;write(...args).then(resolve, reject); };
    });
  });
  await page.locator('#bank-list [data-openbank]').first().evaluate((node) => node.click());
  await page.locator('body[data-storage-state="pending"]').waitFor();
  await page.locator('#bank-list [data-bank-bulk-v23]').first().evaluate((node) => {
    node.checked = true;node.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
  });
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /请至少选择一个题库/);
  assert(await page.locator('#export-selected-banks-v23').isDisabled());
  assert(await page.locator('#delete-selected-banks-v32').isDisabled());
  await page.waitForFunction(() => !!globalThis.__releaseBulkWrite);
  await page.evaluate(() => globalThis.__releaseBulkWrite());
  await page.locator('body[data-storage-state="ready"]').waitFor();
});

test('第三批装配：启动和恢复各一次题库选择器渲染并同步默认全选', async (t) => {
  const initial = webState();
  const transform = (source) => {
    const instrument = `(() => {
      const create = globalThis.ShirohaBankPage.create;
      globalThis.__bankSelectRenders = 0;
      globalThis.ShirohaBankPage.create = (...args) => {
        const controller = create(...args);
        const render = controller.renderBankSelect;
        controller.renderBankSelect = (...values) => { globalThis.__bankSelectRenders += 1;return render(...values); };
        return controller;
      };
    })();\n`;
    const entry = '  startApplication();';
    assert(source.includes(entry));
    const exposed = ['  globalThis.__restartApplicationForTest = startApplication;', entry].join('\n');
    return `${instrument}${source.replace(entry, exposed)}`;
  };
  const page = await pageFor(t, JSON.stringify(initial), '', transform);
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(await page.evaluate(() => globalThis.__bankSelectRenders), 1);
  await page.locator('.nav[data-view="banks"]').click();
  assert(await page.locator('#export-bank-all-v23').isChecked());
  assert.equal(await page.locator('#bank-list [data-bank-bulk-v23]:checked').count(), 2);
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /已选择 2 个题库/);
  await page.evaluate(async () => { globalThis.__bankSelectRenders = 0;await globalThis.__restartApplicationForTest(); });
  assert.equal(await page.evaluate(() => globalThis.__bankSelectRenders), 1);
  assert.equal(await page.locator('#bank-list [data-bank-bulk-v23]:checked').count(), 2);
  await page.locator('#export-bank-all-v23').uncheck();
  await page.locator('#bank-list [data-bank-bulk-v23]').first().check();
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /已选择 1 个题库/);
});

test('第三批装配：覆盖恢复后题库默认勾选与摘要一致', async (t) => {
  const initial = webState();
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const backup = importBackupFixture();
  backup.banks = [backup.banks.find((bank) => bank.id === 'bank-c')];
  backup.activeBankId = 'bank-c';
  backup.records = [];
  await page.locator('.nav[data-view="settings"]').click();
  await page.locator('#settings-backup-mode-v23').selectOption('overwrite');
  await page.locator('#settings-import-backup-v23').click();
  await page.locator('#backup-json-file-v23').setInputFiles({
    name: 'third-batch-restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.waitForFunction((key) => JSON.parse(globalThis.localStorage.getItem(key)).banks.length === 1, KEY);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /已选择 1 个题库/);
  assert.equal(await page.locator('#bank-list [data-bank-bulk-v23]:checked').count(), 1);
  assert.equal(await page.locator('#bank-list [data-bank-bulk-v23]:checked').getAttribute('data-bank-bulk-v23'), 'bank-c');
});

for (const scenario of ['离页', '离页后返回', '切库事务等待']) {
  test(`第三批收藏：${scenario}时迟到读取不能跳转或选错同 ID 题目`, async (t) => {
    const initial = webState();
    initial.favorites['bank-a'] = ['same-id'];
    initial.favorites['bank-b'] = ['same-id'];
    const page = await pageFor(t, JSON.stringify(initial));
    page.setDefaultTimeout(5000);
    await page.locator('.nav[data-view="favorites"]').click();
    await page.locator('[data-practice-one-fav-v596="same-id"]').waitFor();
    await page.evaluate(() => {
      const { storage } = globalThis.ShirohaPlatform;
      const original = storage.ensureQuestions;
      storage.ensureQuestions = () => new Promise((resolve) => {
        globalThis.__finishFavoriteRead = () => {
          if (original) { storage.ensureQuestions = original; } else { delete storage.ensureQuestions; }
          resolve();
        };
      });
    });
    await page.locator('[data-practice-one-fav-v596="same-id"]').click();
    await page.waitForFunction(() => typeof globalThis.__finishFavoriteRead === 'function');
    if (scenario === '离页' || scenario === '离页后返回') {
      await page.locator('.nav[data-view="dashboard"]').click();
      if (scenario === '离页后返回') { await page.locator('.nav[data-view="favorites"]').click(); }
    } else {
      await page.locator('#active-bank-select').evaluate((node) => {
        node.value = 'bank-b';node.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
      });
      await page.locator('body[data-storage-state="pending"]').waitFor();
    }
    await page.evaluate(() => globalThis.__finishFavoriteRead());
    if (scenario === '切库事务等待') {
      await page.locator('body[data-storage-state="ready"]').waitFor();
      assert.equal(JSON.parse(await saved(page)).activeBankId, 'bank-b');
    } else {
      await page.waitForTimeout(100);
    }
    const expected = scenario === '离页' ? 'dashboard' : 'favorites';
    assert.equal(await page.locator(`#${expected}.active`).count(), 1);
  });
}

test('第三批收藏：两道题的后发读取先返回时只进入最后选择', async (t) => {
  const initial = webState();
  initial.favorites['bank-a'] = ['multiple', 'judge'];
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="favorites"]').click();
  await page.locator('[data-practice-one-fav-v596="judge"]').waitFor();
  await page.evaluate(() => {
    const { storage } = globalThis.ShirohaPlatform;
    const original = storage.ensureQuestions;
    globalThis.__favoriteReads = [];
    storage.ensureQuestions = (_state, refs) => new Promise((resolve) => {
      globalThis.__favoriteReads.push({ refs, resolve });
    });
    globalThis.__restoreFavoriteReads = () => {
      if (original) { storage.ensureQuestions = original; } else { delete storage.ensureQuestions; }
    };
  });
  await page.locator('[data-practice-one-fav-v596="multiple"]').click();
  await page.locator('[data-practice-one-fav-v596="judge"]').click();
  await page.waitForFunction(() => globalThis.__favoriteReads.length === 2);
  assert.deepEqual(await page.evaluate(() => globalThis.__favoriteReads.map((read) => read.refs.map((ref) => [ref.bankId, ref.questionId]))), [[['bank-a', 'multiple']], [['bank-a', 'judge']]]);
  await page.evaluate(() => { globalThis.__restoreFavoriteReads();globalThis.__favoriteReads[1].resolve(); });
  await page.locator('#practice.active').waitFor();
  assert.equal(await page.locator('#practice-number-range-v58916').inputValue(), '2-2');
  await page.evaluate(() => globalThis.__favoriteReads[0].resolve());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#practice-number-range-v58916').inputValue(), '2-2');
});

for (const leave of [false, true]) {
  test(`第三批收藏：${leave ? '离页后' : '当前页面'}读取失败的提示归属`, async (t) => {
    const initial = webState();
    initial.favorites['bank-a'] = ['same-id'];
    const page = await pageFor(t, JSON.stringify(initial));
    page.setDefaultTimeout(5000);
    await page.locator('.nav[data-view="favorites"]').click();
    await page.locator('[data-practice-one-fav-v596="same-id"]').waitFor();
    await page.evaluate(() => {
      const { storage } = globalThis.ShirohaPlatform;
      storage.ensureQuestions = () => new Promise((_resolve, reject) => {
        globalThis.__failFavoriteRead = () => reject(new Error('模拟收藏旧读取失败'));
      });
    });
    await page.locator('[data-practice-one-fav-v596="same-id"]').click();
    await page.waitForFunction(() => typeof globalThis.__failFavoriteRead === 'function');
    if (leave) { await page.locator('.nav[data-view="dashboard"]').click(); }
    await page.evaluate(() => globalThis.__failFavoriteRead());
    if (leave) {
      await page.waitForTimeout(100);
      assert.doesNotMatch(await page.locator('#platform-status').innerText(), /模拟收藏旧读取失败/);
      assert.equal(await page.locator('#dashboard.active').count(), 1);
    } else {
      await page.locator('#platform-status.failed').filter({ hasText: '模拟收藏旧读取失败' }).waitFor();
      assert.equal(await page.locator('#favorites.active').count(), 1);
    }
  });
}

test('第三批入口：五处导航、图片出错与折叠按钮保持原行为', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const links = [
    ['.dashboard-action-card.blue', 'practice'],
    ['.dashboard-action-card.green', 'import'],
    ['.dashboard-action-card.violet', 'banks'],
    ['.dashboard-action-card.amber', 'settings'],
    ['.dashboard-card-actions button', 'settings'],
  ];
  for (const [selector, view] of links) {
    await page.locator(selector).click();
    assert.equal(await page.locator(`#${view}.active`).count(), 1);
    await page.locator('.nav[data-view="dashboard"]').click();
  }
  const icon = page.locator('img[onerror]');
  assert.equal(await icon.count(), 1);
  await icon.dispatchEvent('error');
  assert.equal(await icon.evaluate((node) => node.style.display), 'none');
  await page.setViewportSize({ width: 1600, height: 900 });
  const toggle = page.locator('.web-peeking-toggle');
  await toggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await toggle.innerText(), '显示');
  assert(await toggle.evaluate((node) => node.parentElement.classList.contains('collapsed')));
  await page.keyboard.press('Space');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await toggle.innerText(), '隐藏');
});

test('第三批复盘：跨库同 ID 只重练错误来源并保持返回焦点', async (t) => {
  const initial = webState();
  initial.banks[0].questions = [initial.banks[0].questions[0]];
  initial.settings.practiceScope = { type: 'group', value: '自建样本' };
  initial.records = [];
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-submit-mode').selectOption('total');
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .option[data-key="A"]').click();
  await page.locator('[data-practice-jump="1"]').click();
  await page.locator('#practice-card .option[data-key="A"]').click();
  await page.locator('#p-submit-all').click();
  await page.locator('#practice-review-result').click();
  await page.locator('#training-review-back').click();
  await page.waitForFunction(() => globalThis.document.activeElement?.id === 'practice-review-result');
  await page.locator('#practice-review-result').click();
  await page.locator('#training-retry').click();
  assert.equal(await page.locator('#practice-number-range-v58916').inputValue(), '1-1');
  await page.locator('#start-practice-btn').click();
  assert.equal(await page.locator('[data-practice-jump]').count(), 1);
  assert.match(await page.locator('#practice-card .question-title').innerText(), /第二题库同 ID/);
});

test('第三批题库：跨页选择导出内容及取消、确认删除保留未选库', async (t) => {
  const initial = webState();
  initial.banks.push(...Array.from({ length: 11 }, (_, index) => ({
    ...initial.banks[1], id: `export-bulk-${index}`, name: `导出样本 ${index}`,
  })));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('#save-all-btn').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  page.removeAllListeners('app-dialog');
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('#export-bank-all-v23').uncheck();
  const first = page.locator('#bank-list [data-bank-bulk-v23]').first();
  const firstId = await first.getAttribute('data-bank-bulk-v23');
  await first.check();
  await page.locator('#bank-list-pager').getByRole('button', { name: '第 2 页', exact: true }).click();
  const second = page.locator('#bank-list [data-bank-bulk-v23]').first();
  const secondId = await second.getAttribute('data-bank-bulk-v23');
  await second.check();
  const before = JSON.parse(await saved(page));
  const download = page.waitForEvent('download');
  await page.locator('#export-selected-banks-v23').click();
  const file = await download;
  const payload = JSON.parse(require('node:fs').readFileSync(await file.path(), 'utf8'));
  assert.equal(payload.exportType, 'question_banks');
  assert.deepEqual(payload.banks.map((bank) => bank.id).sort(), [firstId, secondId].sort());
  for (const bank of payload.banks) {
    assert.deepEqual(bank.questions.map((question) => question.id), before.banks.find((value) => value.id === bank.id).questions.map((question) => question.id));
  }
  await page.locator('#delete-selected-banks-v32').click();
  await page.locator('#app-dialog [data-dialog-cancel]').click();
  assert.deepEqual(JSON.parse(await saved(page)), before);
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /已选择 2 个题库/);
  await page.locator('#delete-selected-banks-v32').click();
  await page.locator('#app-dialog [data-dialog-accept]').click();
  await page.waitForFunction((key) => JSON.parse(globalThis.localStorage.getItem(key)).banks.length === 11, KEY);
  const after = JSON.parse(await saved(page));
  assert.deepEqual(after.banks, before.banks.filter((bank) => ![firstId, secondId].includes(bank.id)));
});

for (const mode of ['single', 'total']) {
  test(`第三批练习：${mode} 切题后旧文本输入不能覆盖原草稿`, async (t) => {
    const initial = webState();
    const short = initial.banks[0].questions.find((question) => question.type === 'short');
    initial.banks = [initial.banks[0]];
    initial.banks[0].questions = [short, { ...short, id: 'short-second', question: '第二道简答题' }];
    const page = await pageFor(t, JSON.stringify(initial));
    page.setDefaultTimeout(5000);
    await page.locator('.nav[data-view="practice"]').click();
    await page.locator('#practice-submit-mode').selectOption(mode);
    await page.locator('#practice-limit').selectOption('all');
    await page.locator('#start-practice-btn').click();
    await page.locator('#practice-card textarea').fill('第一题原答案');
    await page.locator('#practice-card textarea').evaluate((node) => { globalThis.__oldPracticeText = node; });
    await page.locator('#p-next').click();
    await page.locator('#practice-card textarea').fill('第二题答案');
    await page.evaluate(() => {
      globalThis.__oldPracticeText.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
    });
    await page.locator('#p-prev').click();
    assert.equal(await page.locator('#practice-card textarea').inputValue(), '第一题原答案');
  });

  test(`第三批练习：${mode} 同题重绘后旧清空按钮不能清除新节点`, async (t) => {
    const initial = webState();
    initial.banks = [initial.banks[0]];
    initial.banks[0].questions = [initial.banks[0].questions[0]];
    const page = await pageFor(t, JSON.stringify(initial));
    page.setDefaultTimeout(5000);
    await page.locator('.nav[data-view="practice"]').click();
    await page.locator('#practice-submit-mode').selectOption(mode);
    await page.locator('#start-practice-btn').click();
    await page.locator('#practice-card .option[data-key="A"]').click();
    await page.locator('[data-clear-answer-options]').evaluate((node) => { globalThis.__oldPracticeClear = node; });
    await page.locator('#p-favorite').click();
    await page.locator('body[data-storage-state="ready"]').waitFor();
    await page.locator('#practice-card .option[data-key="B"]').click();
    await page.evaluate(() => globalThis.__oldPracticeClear.click());
    assert(await page.locator('#practice-card .option[data-key="B"] input').isChecked());
  });
}

for (const mode of ['practice', 'exam', 'bank-edit']) {
  for (const returnToPage of [false, true]) {
    test(`第三批入口迟到：${mode} 离页${returnToPage ? '后返回' : ''}不能继续旧操作`, async (t) => {
      const initial = webState();
      const page = await pageFor(t, JSON.stringify(initial));
      page.setDefaultTimeout(5000);
      const view = mode === 'bank-edit' ? 'banks' : mode;
      await page.locator(`.nav[data-view="${view}"]`).click();
      await page.evaluate(() => {
        const { storage } = globalThis.ShirohaPlatform;
        const original = storage.ensureQuestions;
        storage.ensureQuestions = () => new Promise((resolve) => {
          globalThis.__finishEntryRead = () => {
            if (original) { storage.ensureQuestions = original; } else { delete storage.ensureQuestions; }
            resolve();
          };
        });
      });
      if (mode === 'bank-edit') {
        await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();
        await page.locator('[data-editbank-v45="bank-a"]').click();
      } else {
        await page.locator(`#start-${mode}-btn`).click();
      }
      await page.waitForFunction(() => typeof globalThis.__finishEntryRead === 'function');
      await page.locator('.nav[data-view="dashboard"]').click();
      if (returnToPage) { await page.locator(`.nav[data-view="${view}"]`).click(); }
      await page.evaluate(() => globalThis.__finishEntryRead());
      await page.waitForTimeout(100);
      assert.equal(await page.locator(`#${returnToPage ? view : 'dashboard'}.active`).count(), 1);
      assert.equal(await page.locator('body').evaluate((body) => body.classList.contains('practice-focus') || body.classList.contains('exam-focus')), false);
      assert.equal(await page.locator('#bank-edit-panel-v45:not(.hidden)').count(), 0);
    });
  }
}

test('第三批题库编辑：当前按钮目标不存在时保留原提示', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()));
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="banks"]').click();
  const button = page.locator('[data-editbank-v45="bank-a"]');
  await button.locator('..').locator('..').locator('summary').click();
  await button.evaluate((node) => { node.dataset.editbankV45 = 'missing-bank';node.click(); });
  await page.locator('.toast-item').filter({ hasText: '没有找到该题库' }).waitFor();
  assert.equal(await page.locator('#banks.active').count(), 1);
});

for (const mode of ['practice', 'exam', 'bank-edit']) {
  for (const leave of [false, true]) {
    test(`第三批入口失败：${mode} ${leave ? '离页后' : '当前页面'}的读取提示归属`, async (t) => {
      const page = await pageFor(t, JSON.stringify(webState()));
      page.setDefaultTimeout(5000);
      const view = mode === 'bank-edit' ? 'banks' : mode;
      await page.locator(`.nav[data-view="${view}"]`).click();
      await page.evaluate(() => {
        const { storage } = globalThis.ShirohaPlatform;
        storage.ensureQuestions = () => new Promise((_resolve, reject) => {
          globalThis.__failEntryRead = () => reject(new Error('模拟入口读取失败'));
        });
      });
      if (mode === 'bank-edit') {
        await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();
        await page.locator('[data-editbank-v45="bank-a"]').click();
      } else {
        await page.locator(`#start-${mode}-btn`).click();
      }
      await page.waitForFunction(() => typeof globalThis.__failEntryRead === 'function');
      if (leave) { await page.locator('.nav[data-view="dashboard"]').click(); }
      await page.evaluate(() => globalThis.__failEntryRead());
      if (leave) {
        await page.waitForTimeout(100);
        assert.doesNotMatch(await page.locator('#platform-status').innerText(), /模拟入口读取失败/);
        assert.equal(await page.locator('#dashboard.active').count(), 1);
      } else {
        await page.locator('#platform-status.failed').filter({ hasText: '模拟入口读取失败' }).waitFor();
        assert.equal(await page.locator(`#${view}.active`).count(), 1);
      }
    });
  }
}

test('第三批收藏：快捷练习直接切页后返回不能恢复旧读取跳转', async (t) => {
  const initial = webState();
  initial.favorites['bank-a'] = ['same-id'];
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="favorites"]').click();
  await page.locator('[data-practice-one-fav-v596="same-id"]').waitFor();
  await page.evaluate(() => {
    const { storage } = globalThis.ShirohaPlatform;
    const original = storage.ensureQuestions;
    storage.ensureQuestions = () => new Promise((resolve) => {
      globalThis.__finishDirectFavoriteRead = () => {
        if (original) { storage.ensureQuestions = original; } else { delete storage.ensureQuestions; }
        resolve();
      };
    });
  });
  await page.locator('[data-practice-one-fav-v596="same-id"]').click();
  await page.waitForFunction(() => typeof globalThis.__finishDirectFavoriteRead === 'function');
  await page.locator('#practice-favorites-btn-v596').click();
  await page.locator('#practice.active').waitFor();
  await page.locator('.nav[data-view="favorites"]').click();
  await page.evaluate(() => globalThis.__finishDirectFavoriteRead());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#favorites.active').count(), 1);
});

test('第三批错题：快捷入口保留错题范围并正常开始', async (t) => {
  const initial = webState();
  initial.wrongBook['bank-a'] = [{ id: 'same-id', status: '未掌握', wrongCount: 1 }];
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('.nav[data-view="wrongbook"]').click();
  await page.locator('#practice-wrong-btn').click();
  assert.equal(await page.locator('#practice.active').count(), 1);
  assert.equal(await page.locator('#practice-source').inputValue(), 'wrong');
  await page.locator('#start-practice-btn').click();
  assert.match(await page.locator('#practice-card .question-title').innerText(), /一加一等于多少/);
  assert.equal(await page.locator('[data-practice-jump]').count(), 1);
});

for (const scenario of ['当前页', '翻页后', '离页后返回']) {
  test(`第三批分页失败：${scenario}读取的提示与重试归属`, async (t) => {
    const initial = webState();
    initial.banks[0].questions = Array.from({ length: 31 }, (_, index) => ({
      ...initial.banks[0].questions[0], id: `failure-page-${index}`, question: `失败分页 ${index}`,
    }));
    const page = await pageFor(t, JSON.stringify(initial));
    page.setDefaultTimeout(5000);
    await page.locator('.nav[data-view="banks"]').click();
    await page.locator('[data-select-bank-question="failure-page-0"]').waitFor();
    await page.evaluate(() => {
      const { storage } = globalThis.ShirohaPlatform;
      let calls = 0;
      storage.ensureQuestions = () => {
        calls += 1;
        if (calls > 1) { return Promise.resolve(); }
        return new Promise((_resolve, reject) => {
          globalThis.__failPagedRead = () => { delete storage.ensureQuestions;reject(new Error('模拟分页旧读取失败')); };
        });
      };
    });
    const pager = page.locator('#bank-preview-pager');
    await pager.getByRole('button', { name: '下一页', exact: true }).click();
    await page.waitForFunction(() => typeof globalThis.__failPagedRead === 'function');
    if (scenario === '翻页后') {
      await pager.getByRole('button', { name: '下一页', exact: true }).click();
      await page.locator('[data-select-bank-question="failure-page-20"]').waitFor();
    } else if (scenario === '离页后返回') {
      await page.locator('.nav[data-view="dashboard"]').click();
      await page.locator('.nav[data-view="banks"]').click();
    }
    await page.evaluate(() => globalThis.__failPagedRead());
    if (scenario === '当前页') {
      await page.locator('#platform-status.failed').filter({ hasText: '模拟分页旧读取失败' }).waitFor();
      await page.locator('#retry-bank-preview').click();
      await page.locator('[data-select-bank-question="failure-page-10"]').waitFor();
    } else {
      await page.waitForTimeout(100);
      assert.doesNotMatch(await page.locator('#platform-status').innerText(), /模拟分页旧读取失败/);
      assert.equal(await page.locator('#retry-bank-preview').count(), 0);
      if (scenario === '翻页后') { assert.equal(await page.locator('[data-select-bank-question="failure-page-20"]').count(), 1); }
    }
  });
}

for (const leave of [false, true]) {
  test(`第三批记录详情失败：${leave ? '离页后返回' : '当前页'}的提示归属`, async (t) => {
    const page = await pageFor(t, JSON.stringify(webState()));
    page.setDefaultTimeout(5000);
    await page.locator('.nav[data-view="records"]').click();
    await page.evaluate(() => {
      const { storage } = globalThis.ShirohaPlatform;
      storage.ensureRecords = () => new Promise((_resolve, reject) => {
        globalThis.__failRecordDetails = () => { delete storage.ensureRecords;reject(new Error('模拟记录详情旧读取失败')); };
      });
    });
    await page.locator('#records [data-training-review]').first().click();
    await page.waitForFunction(() => typeof globalThis.__failRecordDetails === 'function');
    if (leave) {
      await page.locator('.nav[data-view="dashboard"]').click();
      await page.locator('.nav[data-view="records"]').click();
    }
    await page.evaluate(() => globalThis.__failRecordDetails());
    if (leave) {
      await page.waitForTimeout(100);
      assert.doesNotMatch(await page.locator('#platform-status').innerText(), /复盘加载失败|模拟记录详情旧读取失败/);
    } else {
      await page.locator('#platform-status.failed').filter({ hasText: '复盘加载失败' }).waitFor();
      await page.locator('#records [data-training-review]').first().click();
      await page.locator('#training-review-back').waitFor();
    }
  });
}

for (const leave of [false, true]) {
  test(`第三批复盘详情失败：${leave ? '离页后返回' : '当前页'}的提示归属`, async (t) => {
    const initial = webState();
    const question = { ...initial.banks[0].questions[0], analysis: '' };
    initial.banks[0].questions = [question];
    initial.records = [{ ...initial.records[0], details: [{ questionId: question.id, sourceBankId: 'bank-a', nativeQuestion: question, chosen: ['B'], correct: false }] }];
    const page = await pageFor(t, JSON.stringify(initial));
    page.setDefaultTimeout(5000);
    await page.locator('.nav[data-view="records"]').click();
    await page.evaluate(() => {
      const { storage } = globalThis.ShirohaPlatform;
      let calls = 0;
      storage.ensureQuestions = () => {
        calls += 1;
        if (calls > 1) { return Promise.resolve(); }
        return new Promise((_resolve, reject) => {
          globalThis.__failReviewDetails = () => { delete storage.ensureQuestions;reject(new Error('模拟复盘详情旧读取失败')); };
        });
      };
    });
    await page.locator('#records [data-training-review]').first().click();
    await page.waitForFunction(() => typeof globalThis.__failReviewDetails === 'function');
    if (leave) {
      await page.locator('.nav[data-view="dashboard"]').click();
      await page.locator('.nav[data-view="records"]').click();
      await page.locator('#records [data-training-review]').first().click();
      await page.locator('#training-review-back').waitFor();
    }
    await page.evaluate(() => globalThis.__failReviewDetails());
    if (leave) {
      await page.waitForTimeout(100);
      assert.doesNotMatch(await page.locator('#platform-status').innerText(), /模拟复盘详情旧读取失败/);
      assert.equal(await page.locator('#training-review.active').count(), 1);
    } else {
      await page.locator('#platform-status.failed').filter({ hasText: '模拟复盘详情旧读取失败' }).waitFor();
      await page.locator('.nav[data-view="records"]').click();
      await page.locator('#records [data-training-review]').first().click();
      await page.locator('#training-review-back').waitFor();
    }
  });
}

for (const view of ['favorites', 'wrongbook']) {
  for (const leave of [false, true]) {
    test(`第三批收藏错题失败：${view} ${leave ? '离页后返回' : '当前页'}的提示归属`, async (t) => {
      const initial = webState();
      initial.banks[0].questions = Array.from({ length: 21 }, (_, index) => ({
        ...initial.banks[0].questions[0], id: `saved-failure-${index}`, question: `收藏错题 ${index}`,
      }));
      initial.favorites['bank-a'] = initial.banks[0].questions.map((question) => question.id);
      initial.wrongBook['bank-a'] = initial.banks[0].questions.map((question) => ({ id: question.id, status: '未掌握', wrongCount: 1 }));
      const page = await pageFor(t, JSON.stringify(initial));
      page.setDefaultTimeout(5000);
      await page.locator(`.nav[data-view="${view}"]`).click();
      await page.locator(view === 'favorites' ? '.favorite-question-row' : '#wrongbook-list .wrong-item').first().waitFor();
      await page.evaluate(() => {
        const { storage } = globalThis.ShirohaPlatform;
        storage.ensureQuestions = () => new Promise((_resolve, reject) => {
          globalThis.__failSavedRead = () => { delete storage.ensureQuestions;reject(new Error('模拟收藏错题旧读取失败')); };
        });
      });
      if (view === 'favorites') {
        await page.locator('#favorites-list-v596-pager').getByRole('button', { name: '下一页', exact: true }).click();
      } else {
        await page.locator('#wrong-sort-mode').selectOption('wrongCount');
      }
      await page.waitForFunction(() => typeof globalThis.__failSavedRead === 'function');
      if (leave) {
        await page.locator('.nav[data-view="dashboard"]').click();
        await page.locator(`.nav[data-view="${view}"]`).click();
      }
      await page.evaluate(() => globalThis.__failSavedRead());
      if (leave) {
        await page.waitForTimeout(100);
        assert.doesNotMatch(await page.locator('#platform-status').innerText(), /模拟收藏错题旧读取失败/);
        if (view === 'favorites') { assert.equal(await page.locator('#retry-favorites').count(), 0); }
      } else {
        await page.locator('#platform-status.failed').filter({ hasText: '模拟收藏错题旧读取失败' }).waitFor();
        if (view === 'favorites') {
          await page.locator('#retry-favorites').click();
          await page.locator('[data-practice-one-fav-v596="saved-failure-10"]').waitFor();
        } else {
          await page.locator('#wrong-sort-mode').selectOption('lastWrong');
          await page.locator('#wrongbook-list .wrong-item').first().waitFor();
        }
      }
    });
  }
}

for (const scenario of ['当前失败', '关闭后成功', '关闭后失败', '离页返回后成功', '离页返回后失败']) {
  test(`第三批记录列表明细：${scenario}的读取归属`, async (t) => {
    const page = await pageFor(t, JSON.stringify(webState()));
    page.setDefaultTimeout(5000);
    await page.evaluate(() => {
      const { storage } = globalThis.ShirohaPlatform;
      storage.lazy = true;
      let requested = false;
      storage.ensureRecords = (_snapshot, ids) => {
        if (!ids.length || requested) { return Promise.resolve(); }
        requested = true;
        return new Promise((resolve, reject) => {
          globalThis.__finishRecordListRead = (fail) => {
            delete storage.ensureRecords;
            if (fail) { reject(new Error('模拟记录列表旧读取失败')); } else { resolve(); }
          };
        });
      };
    });
    await page.locator('.nav[data-view="records"]').click();
    const details = page.locator('#records-list [data-native-record]').first();
    await details.locator('summary').click();
    await page.waitForFunction(() => typeof globalThis.__finishRecordListRead === 'function');
    if (scenario.startsWith('关闭')) {
      await details.locator('summary').click();
      await page.waitForFunction(() => !globalThis.document.querySelector('#records-list [data-native-record]')?.open);
    } else if (scenario.startsWith('离页')) {
      await page.locator('.nav[data-view="dashboard"]').click();
      await page.locator('.nav[data-view="records"]').click();
      await page.waitForFunction(() => globalThis.document.querySelector('#records-list [data-native-record]')?.open);
    }
    await page.evaluate((fail) => globalThis.__finishRecordListRead(fail), scenario.endsWith('失败'));
    if (scenario === '当前失败') {
      await page.locator('#platform-status.failed').filter({ hasText: '模拟记录列表旧读取失败' }).waitFor();
      await details.locator('summary').click();
      await details.locator('summary').click();
      await page.waitForFunction(() => globalThis.document.querySelector('#records-list [data-native-record]')?.open);
    } else {
      await page.waitForTimeout(100);
      assert.doesNotMatch(await page.locator('#platform-status').innerText(), /模拟记录列表旧读取失败/);
      assert.equal(await page.locator('#records.active').count(), 1);
      assert.equal(await page.locator('#records-list [data-native-record]').first().evaluate((node) => node.open), scenario.startsWith('离页'));
    }
  });
}

test('第三批记录列表明细：关闭一项后其余展开明细继续补读', async (t) => {
  const initial = webState();
  initial.records.push({ ...initial.records[0], id: 'record-two', date: '2026-10-22T00:00:00.000Z' });
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.evaluate(() => {
    const { storage } = globalThis.ShirohaPlatform;
    storage.lazy = true;
    globalThis.__recordBatchReads = [];
    storage.ensureRecords = (_snapshot, ids) => {
      globalThis.__recordBatchReads.push(ids);
      if (ids.length !== 2) { return Promise.resolve(); }
      return new Promise((resolve) => { globalThis.__finishRecordBatch = resolve; });
    };
  });
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('[data-native-record="record-1"] summary').click();
  await page.waitForFunction(() => globalThis.document.querySelector('[data-native-record="record-1"]')?.open);
  await page.locator('[data-native-record="record-two"] summary').click();
  await page.waitForFunction(() => typeof globalThis.__finishRecordBatch === 'function');
  await page.locator('[data-native-record="record-1"] summary').click();
  await page.evaluate(() => globalThis.__finishRecordBatch());
  await page.waitForFunction(() => globalThis.__recordBatchReads.some((ids) => ids.length === 1 && ids[0] === 'record-two'));
  await page.waitForFunction(() => {
    const first = globalThis.document.querySelector('[data-native-record="record-1"]');
    const second = globalThis.document.querySelector('[data-native-record="record-two"]');
    return first && !first.open && second?.open && second.querySelector('tbody tr');
  });
});

test('第三批记录列表明细：无展开记录时初始化、分页与筛选保持正常', async (t) => {
  const initial = webState();
  initial.records = Array.from({ length: 12 }, (_, index) => ({
    ...initial.records[0], id: `record-list-${index}`, mode: index % 2 ? '练习' : '考试',
  }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.evaluate(() => {
    const { storage } = globalThis.ShirohaPlatform;
    storage.lazy = true;
    globalThis.__emptyRecordReads = [];
    storage.ensureRecords = async (_snapshot, ids) => { globalThis.__emptyRecordReads.push(ids); };
  });
  await page.locator('.nav[data-view="records"]').click();
  await page.locator('#records-list-pager').getByRole('button', { name: '第 2 页', exact: true }).click();
  assert.equal(await page.locator('#records-list .record-item').count(), 2);
  await page.locator('#record-mode-filter').selectOption('考试');
  assert.equal(await page.locator('#records-list .record-item').count(), 6);
  assert.equal(await page.locator('#records-list [data-native-record][open]').count(), 0);
  assert(await page.evaluate(() => globalThis.__emptyRecordReads.length >= 3 && globalThis.__emptyRecordReads.every((ids) => ids.length === 0)));
});

const batch4DelayedFileInjection = `
  globalThis.__batch4Reads = {};
  globalThis.ShirohaPlatform.files = { ...globalThis.ShirohaPlatform.files,
    readText(file) { return new Promise((resolve, reject) => { globalThis.__batch4Reads[file.name] = { resolve, reject }; }); } };
`;

async function batch4SelectDelayed(page, selector, name) {
  await page.locator(selector).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('模拟文件') });
  await page.waitForFunction((fileName) => !!globalThis.__batch4Reads[fileName], name);
}

test('第四批导入：单文件重选、清空、手动编辑复原和程序替换后拒绝迟到读取', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  const text = page.locator('#import-text');
  await text.fill('原文本');
  await batch4SelectDelayed(page, '#import-file', '旧.txt');
  await text.fill('编辑后');
  await text.fill('原文本');
  await page.evaluate(() => globalThis.__batch4Reads['旧.txt'].resolve('迟到文本'));
  await page.waitForTimeout(50);
  assert.equal(await text.inputValue(), '原文本');

  await batch4SelectDelayed(page, '#import-file', '样例前.txt');
  await page.locator('#load-sample-btn').click();
  const sample = await text.inputValue();
  await page.evaluate(() => globalThis.__batch4Reads['样例前.txt'].resolve('迟到覆盖'));
  await page.waitForTimeout(50);
  assert.equal(await text.inputValue(), sample);

  await batch4SelectDelayed(page, '#import-file', 'OCR前.txt');
  await page.locator('#ocr-result').evaluate((field) => { field.value = '人工核对过的 OCR 文本'; });
  await page.locator('#ocr-use-text-btn').evaluate((button) => { button.disabled = false;button.click(); });
  await page.evaluate(() => globalThis.__batch4Reads['OCR前.txt'].resolve('旧文件覆盖 OCR'));
  await page.waitForTimeout(50);
  assert.equal(await text.inputValue(), '人工核对过的 OCR 文本');

  await batch4SelectDelayed(page, '#import-file', '清空前.txt');
  await page.locator('#clear-import-btn').click();
  await page.evaluate(() => globalThis.__batch4Reads['清空前.txt'].resolve('旧文件覆盖清空'));
  await page.waitForTimeout(50);
  assert.equal(await text.inputValue(), '');
});

test('第四批导入：双文件各槽位并行，手动复原、示例和清空不被旧读取覆盖', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  const question = page.locator('#dual-question-text');
  const answer = page.locator('#dual-answer-text');
  await batch4SelectDelayed(page, '#dual-question-file', '旧题.txt');
  await batch4SelectDelayed(page, '#dual-question-file', '新题.txt');
  await batch4SelectDelayed(page, '#dual-answer-file', '答案.txt');
  await page.evaluate(() => {
    globalThis.__batch4Reads['答案.txt'].resolve('并行答案');
    globalThis.__batch4Reads['新题.txt'].resolve('新题目');
  });
  await page.waitForFunction(() => globalThis.document.querySelector('#dual-question-text').value === '新题目'
    && globalThis.document.querySelector('#dual-answer-text').value === '并行答案');
  await page.evaluate(() => globalThis.__batch4Reads['旧题.txt'].resolve('旧题迟到'));
  await page.waitForTimeout(50);
  assert.equal(await question.inputValue(), '新题目');
  assert.equal(await answer.inputValue(), '并行答案');

  await batch4SelectDelayed(page, '#dual-answer-file', '编辑答案.txt');
  await answer.fill('临时改动');
  await answer.fill('并行答案');
  await page.evaluate(() => globalThis.__batch4Reads['编辑答案.txt'].resolve('旧答案迟到'));
  await page.waitForTimeout(50);
  assert.equal(await answer.inputValue(), '并行答案');

  await batch4SelectDelayed(page, '#dual-question-file', '示例前题目.txt');
  await batch4SelectDelayed(page, '#dual-answer-file', '示例前答案.txt');
  await page.locator('#dual-load-sample-btn').click();
  const sampleQuestion = await question.inputValue();
  const sampleAnswer = await answer.inputValue();
  await page.evaluate(() => {
    globalThis.__batch4Reads['示例前题目.txt'].resolve('迟到题目');
    globalThis.__batch4Reads['示例前答案.txt'].resolve('迟到答案');
  });
  await page.waitForTimeout(50);
  assert.equal(await question.inputValue(), sampleQuestion);
  assert.equal(await answer.inputValue(), sampleAnswer);

  await batch4SelectDelayed(page, '#dual-question-file', '清空前题目.txt');
  await batch4SelectDelayed(page, '#dual-answer-file', '清空前答案.txt');
  await page.locator('#clear-dual-import-btn').click();
  await page.evaluate(() => {
    globalThis.__batch4Reads['清空前题目.txt'].resolve('迟到题目');
    globalThis.__batch4Reads['清空前答案.txt'].reject(new Error('迟到错误'));
  });
  await page.waitForTimeout(50);
  assert.equal(await question.inputValue(), '');
  assert.equal(await answer.inputValue(), '');
  assert.equal(await page.locator('.toast-item').filter({ hasText: '迟到错误' }).count(), 0);
});

test('第四批导入：读取中空文本误点识别后结果仍可使用', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
  page.setDefaultTimeout(3000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await batch4SelectDelayed(page, '#import-file', '尚在读取.txt');
  await page.locator('#parse-import-btn').click();
  await page.evaluate(() => globalThis.__batch4Reads['尚在读取.txt'].resolve('1. 等待读取题目？\nA. 是\nB. 否\n答案：A'));
  await page.waitForFunction(() => globalThis.document.querySelector('#import-text').value.includes('等待读取题目'));
  await page.locator('#parse-import-btn').click();
  await page.locator('#import-preview tbody').getByText('等待读取题目？').waitFor();

  await batch4SelectDelayed(page, '#dual-question-file', '等待读取题.txt');
  await batch4SelectDelayed(page, '#dual-answer-file', '等待读取答.txt');
  await page.locator('#parse-dual-import-btn').click();
  await page.evaluate(() => {
    globalThis.__batch4Reads['等待读取题.txt'].resolve('1. 双文件等待读取？\nA. 是\nB. 否');
    globalThis.__batch4Reads['等待读取答.txt'].resolve('1. A');
  });
  await page.waitForFunction(() => globalThis.document.querySelector('#dual-question-text').value.includes('双文件等待读取')
    && globalThis.document.querySelector('#dual-answer-text').value === '1. A');
  await page.locator('#parse-dual-import-btn').click();
  await page.locator('#import-preview tbody').getByText('双文件等待读取？').waitFor();
});

test('第四批导入：双文件清空和识别不会废弃独立的单文件文本读取', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
  page.setDefaultTimeout(3000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await batch4SelectDelayed(page, '#import-file', '并行文本.txt');
  await page.locator('#clear-dual-import-btn').click();
  await page.evaluate(() => globalThis.__batch4Reads['并行文本.txt'].resolve('双文件清空后的单文件文本'));
  await page.waitForFunction(() => globalThis.document.querySelector('#import-text').value === '双文件清空后的单文件文本');

  await batch4SelectDelayed(page, '#import-file', '并行识别.txt');
  await page.locator('#dual-load-sample-btn').click();
  await page.locator('#parse-dual-import-btn').click();
  await page.evaluate(() => globalThis.__batch4Reads['并行识别.txt'].resolve('双文件识别后的单文件文本'));
  await page.waitForFunction(() => globalThis.document.querySelector('#import-text').value === '双文件识别后的单文件文本');
  assert.notEqual(await page.locator('#import-preview tbody tr').count(), 0);
});

for (const change of ['编辑', '删除']) {
  test(`第四批导入：表格读取期间${change}预览后旧表格不覆盖草稿`, async (t) => {
    const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
    page.setDefaultTimeout(3000);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.locator('body[data-storage-state="ready"]').waitFor();
    await page.locator('.nav[data-view="import"]').click();
    await page.locator('#load-sample-btn').click();
    await page.locator('#parse-import-btn').click();
    await page.locator('[data-edit-import="0"]').waitFor();
    const before = await page.locator('[data-edit-import]').count();
    await batch4SelectDelayed(page, '#import-file', `旧表格-${change}.csv`);
    if (change === '编辑') {
      await page.locator('[data-edit-import="0"]').click();
      await page.locator('#edit-question').fill('人工修改后的预览题目');
      await page.locator('#edit-save-btn').click();
      await page.locator('#edit-close-btn').focus();
      await page.keyboard.press('Enter');
    } else {
      await page.locator('[data-delete-import="0"]').click();
      await page.waitForFunction((count) => globalThis.document.querySelectorAll('[data-edit-import]').length === count, before - 1);
    }
    const html = await page.locator('#import-preview tbody').innerHTML();
    await page.evaluate((name) => globalThis.__batch4Reads[name].resolve('题干,选项A,选项B,答案\n旧表格题,甲,乙,A'), `旧表格-${change}.csv`);
    await page.waitForTimeout(80);
    assert.equal(await page.locator('#import-preview tbody').innerHTML(), html);
    assert.equal(await page.locator('[data-edit-import]').count(), change === '编辑' ? before : before - 1);
    if (change === '编辑') { assert.match(await page.locator('#import-preview tbody').innerText(), /人工修改后的预览题目/); }
  });
}

test('第四批导入：旧表格不覆盖进入题库二次编辑后的草稿', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await batch4SelectDelayed(page, '#import-file', '二次编辑前.csv');
  await page.locator('.nav[data-view="banks"]').click();
  const button = page.locator('[data-editbank-v45="bank-a"]');
  await button.locator('..').locator('..').locator('summary').click();
  await button.click();
  await page.locator('#bank-edit-panel-v45').waitFor({ state: 'visible' });
  const before = await page.locator('#import-preview tbody').innerHTML();
  assert.notEqual(before, '');
  await page.evaluate(() => globalThis.__batch4Reads['二次编辑前.csv'].resolve('题干,选项A,选项B,答案\n旧表格题,甲,乙,A'));
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#import-preview tbody').innerHTML(), before);
  assert.equal(await page.locator('#bank-edit-panel-v45').isVisible(), true);
});

test('第四批导入：旧表格不覆盖人工采纳的 AI 解析', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);
  await seedImportQuestions(page, 1);
  await page.locator('#ai-analysis-import-btn-v991').click();
  await page.locator('#ai-preview-start-btn-v991').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
  await page.evaluate(() => {
    const request = globalThis.__batchRequests[0];
    request.resolve({ results: [{ id: request.input.questions[0].id, analysis: '人工采纳的模拟解析' }] });
  });
  await page.locator('#ai-preview-status-v991').filter({ hasText: '生成 1 条建议' }).waitFor();
  await batch4SelectDelayed(page, '#import-file', '采纳前.csv');
  await page.locator('[data-ai-analysis-apply-v991]').click();
  const before = await page.locator('#import-preview tbody').innerHTML();
  await page.evaluate(() => globalThis.__batch4Reads['采纳前.csv'].resolve('题干,选项A,选项B,答案\n旧表格题,甲,乙,A'));
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#import-preview tbody').innerHTML(), before);
  await page.locator('[data-edit-import="0"]').click();
  assert.match(await page.locator('#edit-analysis').inputValue(), /人工采纳的模拟解析/);
});

const batch4DavInjection = `
  globalThis.__davRows = [{ name: 'shiroha-web-backup-20261111-010101-aabbccdd.json', size: 10, etag: 'v1' }];
  globalThis.__davLatest = globalThis.__davRows[0].name;
  globalThis.__davPending = [];
  globalThis.__davCancels = 0;
  globalThis.__davRenders = 0;
  globalThis.ShirohaPlatform.network.webdav = (_config, _password, relativePath, options = {}) => {
    if (options.method === 'PROPFIND' && options.headers?.Depth === '1') {
      const body = '<multistatus xmlns="DAV:">' + globalThis.__davRows.map((item) =>
        '<response><href>/' + item.name + '</href><getcontentlength>' + item.size
        + '</getcontentlength><getetag>' + item.etag + '</getetag></response>').join('') + '</multistatus>';
      return Promise.resolve({ status: 207, text: async () => body });
    }
    if (options.method === 'GET' && relativePath.endsWith('latest.json')) {
      return Promise.resolve({ status: 200, text: async () => JSON.stringify({ fileName: globalThis.__davLatest }) });
    }
    return new Promise((resolve, reject) => globalThis.__davPending.push({ relativePath, resolve, reject }));
  };
  globalThis.ShirohaPlatform.network.cancelAll = async () => { globalThis.__davCancels += 1; };
`;
const batch4DavTransform = (source) => {
  const marker = '    function renderWebdavPanelV378(forceForm = false) {';
  assert.equal(source.split(marker).length, 2);
  return source.replace(marker, `${marker}\n      globalThis.__davRenders += 1;`);
};

async function batch4DavPage(t) {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DavInjection, null, { '/webdav-panel.js': batch4DavTransform });
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="settings"]').click();
  await page.locator('#webdav-endpoint-v378').fill('https://dav.example.invalid');
  await page.locator('#webdav-refresh-v378').click();
  await page.locator('#webdav-status-v378').filter({ hasText: '远程列表已刷新' }).waitFor();
  await page.waitForFunction(() => !globalThis.document.querySelector('#webdav-refresh-v378').disabled);
  return page;
}

test('第四批 WebDAV：开始只同步一次，保留列表节点并同步停止、迟到成功失败和重试', async (t) => {
  const page = await batch4DavPage(t);
  await page.evaluate(() => {
    globalThis.__davNode = globalThis.document.querySelector('[data-webdav-restore-v378]');
    globalThis.__davRenders = 0;
  });
  await page.locator('#webdav-test-v378').click();
  await page.waitForFunction(() => globalThis.__davPending.length === 1);
  assert.equal(await page.evaluate(() => globalThis.__davRenders), 1);
  assert.equal(await page.evaluate(() => globalThis.document.querySelector('[data-webdav-restore-v378]') === globalThis.__davNode), true);
  assert.equal(await page.locator('[data-webdav-restore-v378]').isDisabled(), true);
  await page.locator('#webdav-stop-native').click();
  assert.match(await page.locator('#webdav-status-v378').innerText(), /已请求取消/);
  await page.evaluate(() => globalThis.__davPending[0].resolve({ status: 207 }));
  await page.locator('#webdav-status-v378').filter({ hasText: '连接成功' }).waitFor();
  await page.waitForFunction(() => !globalThis.document.querySelector('#webdav-test-v378').disabled);
  assert.equal(await page.locator('[data-webdav-restore-v378]').isEnabled(), true);
  assert.equal(await page.evaluate(() => globalThis.document.querySelector('[data-webdav-restore-v378]') === globalThis.__davNode), true);

  await page.locator('#webdav-test-v378').click();
  await page.waitForFunction(() => globalThis.__davPending.length === 2);
  await page.locator('#webdav-stop-native').click();
  await page.evaluate(() => globalThis.__davPending[1].reject(Object.assign(new Error('模拟取消失败'), { code: 'cancelled' })));
  await page.locator('#webdav-status-v378').filter({ hasText: '测试连接失败' }).waitFor();
  await page.waitForFunction(() => !globalThis.document.querySelector('#webdav-test-v378').disabled);
  assert.equal(await page.locator('[data-webdav-restore-v378]').isEnabled(), true);
  await page.locator('#webdav-test-v378').click();
  await page.waitForFunction(() => globalThis.__davPending.length === 3);
  await page.evaluate(() => globalThis.__davPending[2].resolve({ status: 207 }));
  await page.locator('#webdav-status-v378').filter({ hasText: '连接成功' }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__davCancels), 2);
  assert.equal(await page.evaluate(() => globalThis.document.querySelector('[data-webdav-restore-v378]') === globalThis.__davNode), true);
});

test('第四批 WebDAV：列表内容变化和节点替换后重绘并保持恢复入口', async (t) => {
  const page = await batch4DavPage(t);
  await page.evaluate(() => { globalThis.__davNode = globalThis.document.querySelector('[data-webdav-restore-v378]'); });
  await page.locator('#webdav-refresh-v378').click();
  await page.waitForFunction(() => !globalThis.document.querySelector('#webdav-refresh-v378').disabled);
  assert.equal(await page.evaluate(() => globalThis.document.querySelector('[data-webdav-restore-v378]') === globalThis.__davNode), true);

  await page.evaluate(() => {
    globalThis.__davRows = [
      { name: 'shiroha-web-backup-20261111-010101-aabbccdd.json', size: 20, etag: 'v2' },
      { name: 'shiroha-web-backup-20261111-020202-aabbccdd.json', size: 40, etag: 'v3' },
    ];
    globalThis.__davLatest = globalThis.__davRows[1].name;
  });
  await page.locator('#webdav-refresh-v378').click();
  await page.waitForFunction(() => !globalThis.document.querySelector('#webdav-refresh-v378').disabled);
  const rows = page.locator('#webdav-list-v378 .webdav-row-v378');
  assert.equal(await rows.count(), 2);
  assert.match(await rows.nth(0).innerText(), /020202/);
  assert.match(await rows.nth(0).innerText(), /latest/);
  assert.match(await rows.nth(1).innerText(), /v2/);
  assert.notEqual(await page.evaluate(() => globalThis.document.querySelector('[data-webdav-restore-v378]') === globalThis.__davNode), true);

  for (const field of ['latest', 'size', 'etag']) {
    await page.evaluate((kind) => {
      globalThis.__davNode = globalThis.document.querySelector('[data-webdav-restore-v378]');
      if (kind === 'latest') { globalThis.__davLatest = globalThis.__davRows[0].name; }
      if (kind === 'size') { globalThis.__davRows[0].size = 21; }
      if (kind === 'etag') { globalThis.__davRows[0].etag = '独立变化'; }
    }, field);
    await page.locator('#webdav-refresh-v378').click();
    await page.waitForFunction(() => !globalThis.document.querySelector('#webdav-refresh-v378').disabled);
    assert.notEqual(await page.evaluate(() => globalThis.document.querySelector('[data-webdav-restore-v378]') === globalThis.__davNode), true);
    if (field === 'latest') { assert.match(await rows.nth(1).innerText(), /latest/); }
    if (field === 'size') { assert.match(await rows.nth(1).innerText(), /21/); }
    if (field === 'etag') { assert.match(await rows.nth(1).innerText(), /独立变化/); }
  }

  await page.evaluate(() => {
    const old = globalThis.document.querySelector('#webdav-list-v378');
    old.replaceWith(old.cloneNode(false));
  });
  await page.locator('#webdav-test-v378').click();
  await page.waitForFunction(() => globalThis.__davPending.length === 1);
  assert.equal(await page.locator('#webdav-list-v378 [data-webdav-restore-v378]').count(), 2);
  assert.equal(await page.evaluate(() => typeof globalThis.document.querySelector('#webdav-list-v378').onclick), 'function');
  await page.evaluate(() => globalThis.__davPending[0].resolve({ status: 207 }));
  await page.waitForFunction(() => !globalThis.document.querySelector('#webdav-test-v378').disabled);
  await page.locator('#webdav-list-v378 [data-webdav-restore-v378]').first().click();
  await page.waitForFunction(() => globalThis.__davPending.length === 2);
});

test('第四批导入：表格读取期间修改预览勾选后不丢失选择，普通重新校验仍允许读取完成', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#load-sample-btn').click();
  await page.locator('#parse-import-btn').click();
  await page.locator('[data-select-import="0"]').waitFor();
  await batch4SelectDelayed(page, '#import-file', '勾选前.csv');
  await page.locator('[data-select-import="0"]').check();
  await page.evaluate(() => globalThis.__batch4Reads['勾选前.csv'].resolve('题干,选项A,选项B,答案\n旧表格题,甲,乙,A'));
  await page.waitForTimeout(80);
  assert.equal(await page.locator('[data-select-import="0"]').isChecked(), true);
  assert.equal(await page.locator('[data-edit-import]').count(), 3);

  await batch4SelectDelayed(page, '#import-file', '重校验前.csv');
  await page.locator('#revalidate-import-btn').click();
  await page.evaluate(() => globalThis.__batch4Reads['重校验前.csv'].resolve('题干,选项A,选项B,答案\n新表格题,甲,乙,A'));
  await page.locator('#import-preview tbody').getByText('新表格题').waitFor();
});

test('第四批导入：AI 整理完成后旧表格不能覆盖整理草稿', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await configureMockImportAi(page);
  await page.locator('#import-text').fill('待整理的自建原文');
  await batch4SelectDelayed(page, '#import-file', '整理前.csv');
  await page.locator('#ai-organize-import-btn-v99').click();
  await page.locator('#ai-import-start-btn-v99').click();
  await page.waitForFunction(() => globalThis.__batchRequests.length === 1);
  await page.evaluate(() => globalThis.__batchRequests[0].resolve({
    mode: 'direct_questions', questions: [{ type: 'single', question: 'AI 已整理题目', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: ['A'] }],
  }));
  await page.locator('#ai-import-status-v99').filter({ hasText: '整理完成' }).waitFor();
  await page.locator('#import-preview tbody').getByText('AI 已整理题目').waitFor();
  await page.evaluate(() => globalThis.__batch4Reads['整理前.csv'].resolve('题干,选项A,选项B,答案\n旧表格题,甲,乙,A'));
  await page.waitForTimeout(80);
  await page.locator('#import-preview tbody').getByText('AI 已整理题目').waitFor();
});

test('第四批导入：跨入口题库名称与双文件识别不被旧读取覆盖', async (t) => {
  const page = await pageFor(t, JSON.stringify(webState()), batch4DelayedFileInjection);
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="import"]').click();
  await batch4SelectDelayed(page, '#dual-question-file', '旧题目名称.txt');
  await batch4SelectDelayed(page, '#import-file', '新单文件名称.txt');
  await page.evaluate(() => globalThis.__batch4Reads['新单文件名称.txt'].resolve('新单文件正文'));
  await page.waitForFunction(() => globalThis.document.querySelector('#import-text').value === '新单文件正文');
  const name = await page.locator('#import-bank-name').inputValue();
  await page.evaluate(() => globalThis.__batch4Reads['旧题目名称.txt'].resolve('旧双文件正文'));
  await page.waitForFunction(() => globalThis.document.querySelector('#dual-question-text').value === '旧双文件正文');
  assert.equal(await page.locator('#import-bank-name').inputValue(), name);

  await batch4SelectDelayed(page, '#dual-question-file', '示例前名称.txt');
  await page.locator('#load-sample-btn').click();
  const sampleName = await page.locator('#import-bank-name').inputValue();
  await page.evaluate(() => globalThis.__batch4Reads['示例前名称.txt'].resolve('示例前旧题目'));
  await page.waitForFunction(() => globalThis.document.querySelector('#dual-question-text').value === '示例前旧题目');
  assert.equal(await page.locator('#import-bank-name').inputValue(), sampleName);

  await batch4SelectDelayed(page, '#import-file', '双文件识别前.csv');
  await page.locator('#dual-load-sample-btn').click();
  await page.locator('#parse-dual-import-btn').click();
  const before = await page.locator('#import-preview tbody').innerHTML();
  await page.evaluate(() => globalThis.__batch4Reads['双文件识别前.csv'].resolve('题干,选项A,选项B,答案\n旧表格题,甲,乙,A'));
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#import-preview tbody').innerHTML(), before);
});
