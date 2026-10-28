'use strict';
const { observeAppDialogs } = require('../web-ai-practice/dialogs.cjs');
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
  await observeAppDialogs(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('app-dialog', dialog => dialog.accept());
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(server.url);
  return page;
}
const saved = page => page.evaluate(key => globalThis.localStorage.getItem(key), KEY);

for (const mode of ['single', 'total', 'exam']) for (const type of ['single', 'multiple', 'judge']) test(`清空选项：${mode} ${type} 同步草稿、统计与键盘焦点`, async t => {
  const initial = webState();
  const question = initial.banks[0].questions.find(value => value.type === type);
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
  const choose = key => root.locator(`.option[data-key="${key}"]`).click();
  await choose('A');
  if (type === 'multiple') await choose('C');
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
  assert.equal(await root.locator('.option input').first().evaluate(node => node === globalThis.document.activeElement), true);
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
    if (mode === 'total') assert.match(await page.locator('#p-total-status').innerText(), /已填写 1.*未填写 1/);
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
    await clear.evaluate(node => node.click());
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

test('清空选项：看答案与总提交确认/自评锁定，取消确认后恢复', async t => {
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
  await clear.evaluate(node => node.click());
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
  await clear.evaluate(node => node.click());
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

for (const type of ['single', 'judge', 'multiple']) test(`清空选项：考试 ${type} 再次选择取消并同步未答`, async t => {
  const initial = webState();
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = [initial.banks[0].questions.find(value => value.type === type)];
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('.nav[data-view="exam"]').click();
  await page.locator('#exam-minutes').fill('0');
  await page.locator('#start-exam-btn').click();
  const input = page.locator('#exam-card .option[data-key="A"] input');
  await input.focus();
  for (let index = 0; index < 2; index++) {
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

for (const mode of ['total', 'exam']) test(`清空选项：${mode} 跨库同 ID 与迟到旧控件隔离`, async t => {
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
    await first.locator('[data-clear-answer-options]').evaluate(node => { globalThis.__oldClearOptions = node; });
    await page.locator('#p-next').click();
    await page.evaluate(() => globalThis.__oldClearOptions.click());
  }
  const second = mode === 'exam' ? page.locator('#exam-card .exam-q').nth(1) : page.locator('#practice-card');
  await second.locator('.option[data-key="B"]').click();
  await second.locator('[data-clear-answer-options]').click();
  if (mode === 'total') await page.locator('#p-prev').click();
  assert(await first.locator('.option[data-key="A"] input').isChecked());
  await page.locator(mode === 'exam' ? '#exam-submit-focus-bottom' : '#p-submit-all').click();
  await page.locator(mode === 'exam' ? '#exam-back-setup' : '#back-practice-setup').waitFor();
  const details = JSON.parse(await saved(page)).records[0].details;
  assert.deepEqual(details.map(detail => [detail.sourceBankId, detail.chosen]), [['bank-a', ['A']], ['bank-b', []]]);
});

test('清空选项：考试到时交卷及保存失败重试保留空答案，忙碌和迟到事件不能改卷', async t => {
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
  await page.locator('[data-clear-answer-options]').evaluate(node => { globalThis.__oldClearOptions = node; });
  await page.evaluate(() => {
    const write = globalThis.ShirohaPlatform.storage.write;
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
  const records = JSON.parse(await saved(page)).records;
  assert.equal(records.length, initial.records.length + 1);
  assert.equal(records[0].autoSubmitted, true);
  assert.equal(records[0].answered, 0);
  assert.deepEqual(records[0].details[0].chosen, []);
});

test('列表分页：直接跳页、四档条数、跨页选择、键盘与窄屏', async t => {
  const initial = webState();
  initial.banks[0].questions = Array.from({ length: 503 }, (_, i) => ({ ...initial.banks[0].questions[0], id: 'page-' + i, question: '分页题干 ' + (i + 1) }));
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
  assert.equal(await current().evaluate(node => node === globalThis.document.activeElement), true);
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
    const layout = await pager.evaluate(node => ({ outsideTable: !node.closest('.table-wrap'), width: node.scrollWidth, available: node.clientWidth, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
    assert.equal(layout.outsideTable, true);
    assert.ok(layout.width <= layout.available + 1);
    assert.ok(layout.left >= 0 && layout.right <= width);
    const sizeStyle = await pager.locator('select').evaluate(node => ({ height: node.getBoundingClientRect().height, radius: globalThis.getComputedStyle(node).borderRadius }));
    assert.equal(sizeStyle.height, 32);
    assert.equal(sizeStyle.radius, '6px');
    await current().focus();
    await page.keyboard.press('Enter');
    assert.equal(await current().innerText(), '3');
  }
});

test('列表分页：浏览器题库、错题、收藏、记录独立分页和筛选回首页', async t => {
  const initial = webState();
  const bank = initial.banks[0];
  bank.questions = Array.from({ length: 23 }, (_, i) => ({ ...bank.questions[0], id: 'list-' + i, question: '列表题干 ' + i }));
  initial.banks.push(...Array.from({ length: 21 }, (_, i) => ({ ...initial.banks[1], id: 'bank-extra-' + i, name: '分页题库 ' + i })));
  initial.wrongBook = { 'bank-a': bank.questions.map(q => ({ id: q.id, status: '未掌握', wrongCount: 1 })) };
  initial.favorites = { 'bank-a': bank.questions.map(q => q.id) };
  initial.records = Array.from({ length: 23 }, (_, i) => ({ ...initial.records[0], id: 'page-record-' + i, mode: i < 12 ? '考试' : '练习' }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  for (const [view, id, row] of [['banks', 'bank-list', '.bank-item'], ['wrongbook', 'wrongbook-list', '.wrong-item'], ['favorites', 'favorites-list-v596', '.favorite-question-row'], ['records', 'records-list', 'details']]) {
    await page.locator(`.nav[data-view="${view}"]`).click();
    const pager = page.locator('#' + id + '-pager');
    assert.equal(await page.locator('#' + id).locator(row).count(), 10);
    await pager.getByRole('button', { name: '第 3 页', exact: true }).click();
    assert.equal(await page.locator('#' + id).locator(row).count(), 3);
    if (view === 'favorites') assert.equal(await page.locator('.favorite-question-number').first().innerText(), '21');
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
    if (await pager.locator('select').count()) await pager.locator('select').selectOption('20');
  }
  await page.locator('.nav[data-view="banks"]').click();
  assert.equal(await page.locator('#bank-preview-pager select').inputValue(), '10');
  assert.equal(await page.locator('#bank-list-pager select').inputValue(), '20');
});

test('列表分页：删掉末页后回退，空库保留空态', async t => {
  const initial = webState();
  initial.banks[0].questions = Array.from({ length: 21 }, (_, i) => ({ ...initial.banks[0].questions[0], id: 'delete-page-' + i }));
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

test('列表分页：快速翻页拒绝迟到正文，加载失败可在当前页重试', async t => {
  const initial = webState();
  initial.banks[0].questions = Array.from({ length: 41 }, (_, i) => ({ ...initial.banks[0].questions[0], id: 'delay-' + i, question: '异步分页 ' + i }));
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.evaluate(() => {
    globalThis.__pageLoads = [];
    globalThis.ShirohaPlatform.storage.ensureQuestions = async (_snapshot, refs) => {
      globalThis.__pageLoads.push(refs.map(ref => ref.questionId));
      if (refs[0]?.questionId === 'delay-10') await new Promise(resolve => { globalThis.__finishPageLoad = resolve; });
      if (refs[0]?.questionId === 'delay-30' && !globalThis.__allowRetry) throw Error('分页加载模拟失败');
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
  assert.deepEqual(loads.map(refs => [refs[0], refs.length]), [['delay-10', 10], ['delay-20', 10], ['delay-30', 10], ['delay-30', 10]]);
});

for (const mode of ['single', 'total']) for (const type of ['single', 'multiple', 'judge']) test(`${mode} 模式 ${type} 支持取消选中，切题后仍未作答`, async t => {
  const initial = webState();
  const question = initial.banks[0].questions.find(value => value.type === type);
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = [question, { ...initial.banks[0].questions[0], id: 'deselect-next' }];
  initial.records = [];
  initial.wrongBook = {};
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-submit-mode').selectOption(mode);
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#start-practice-btn').click();
  const option = key => page.locator(`#practice-card .option[data-key="${key}"]`);
  const assertChosen = async expected => {
    assert.deepEqual(await page.locator('#practice-card input:checked').evaluateAll(inputs => inputs.map(input => input.value)), expected);
    assert.deepEqual(await page.locator('#practice-card .option.selected').evaluateAll(options => options.map(option => option.dataset.key)), expected);
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
  if (type === 'multiple') await option('A').click();
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
      await option('A').evaluate(node => node.click());
      await assertChosen(['A']);
    }
  }
});

for (const mode of ['single', 'total', 'exam']) test(`${mode} 答错后保存当时选项，重载错题本仍标红`, async t => {
  const initial = webState();
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = [initial.banks[0].questions[0]];
  initial.wrongBook = {};
  const page = await pageFor(t, JSON.stringify(initial));
  const view = mode === 'exam' ? 'exam' : 'practice';
  await page.locator(`.nav[data-view="${view}"]`).click();
  if (mode !== 'exam') await page.locator('#practice-submit-mode').selectOption(mode);
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

test('错题本显示完整题干、全部选项和已保存的错选标记', async t => {
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

test('题库预览的题型、分类、分值与操作在宽窄窗口均保持单行', async t => {
  const initial = webState();
  initial.banks[0].questions[0].category = '较长的分类名称：综合基础知识';
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  for (const width of [480, 900, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    const failures = await page.locator('#bank-preview').evaluate(table => {
      const failures = [];
      for (const row of table.rows) {
        for (const index of [2, 5, 6, 7]) {
          const cell = row.cells[index];
          if (!cell) continue;
          const nodes = index === 7 && cell.querySelector('button') ? [...cell.querySelectorAll('button')] : [cell];
          const tops = new Set();
          for (const node of nodes) {
            const range = globalThis.document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
          }
          if (tops.size !== 1 || cell.scrollWidth > cell.clientWidth + 1) failures.push(cell.textContent);
        }
      }
      return failures;
    });
    assert.deepEqual(failures, [], `窗口宽度 ${width}`);
  }
});

test('旧组合题练习显示陈述与组合选项，作答仍使用原答案键', async t => {
  const initial = webState();
  const statements = ['①有关法律、法规、规章和标准的规定', '②本地区、本部门、本单位的安全生产实际情况', '③应急组织和人员的职责分工明确，并有具体的落实措施', '④有明确的应急保障措施'];
  const combinations = ['①②', '①②③', '②③④', '①②③④'];
  initial.banks = [initial.banks[0]];
  initial.banks[0].questions = [{ id: 'legacy-combination', type: 'single', question: '应急预案应当符合下列（ ）基本要求。', answer: ['D'], options: statements.map((text, i) => ({ key: 'ABCD'[i], text: text + ' ' + combinations[i] })) }];
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#start-practice-btn').click();
  const title = await page.locator('#practice-card .question-title').innerText();
  for (const statement of statements) assert.ok(title.includes(statement), title);
  assert.deepEqual(await page.locator('#practice-card .option-text').allTextContents(), combinations);
  await page.locator('#practice-card .option[data-key="D"]').click();
  await page.locator('#p-submit').click();
  assert.match(await page.locator('#p-feedback').innerText(), /回答正确/);
  assert.deepEqual(await page.locator('#practice-card .option-text').allTextContents(), combinations);
});

test('总提交结果列出全部错题，保留跨库来源且不截断到八题', async t => {
  const initial = webState();
  const first = initial.banks[0].questions[0];
  initial.banks[0].questions = Array.from({ length: 12 }, (_, index) => ({ ...first, id: index ? 'review-' + index : first.id, question: '完整错题题干 ' + (index + 1) }));
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

test('总提交：全题型、跨库同 ID、键盘与草稿不提前计分', async t => {
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
  const twins = after.records[0].details.filter(detail => detail.questionId === 'same-id');
  assert.deepEqual(twins.map(detail => [detail.sourceBankId, detail.chosen]), [['bank-a', ['A']], ['bank-b', ['B']]]);
});

test('收藏单题快捷入口先选择提交方式，并保留单题范围', async t => {
  const initial = webState();
  initial.favorites['bank-a'] = ['multiple', 'judge'];
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="favorites"]').click();
  await page.locator('#favorites-list-v596 [data-preview-question="judge"]').click();
  await page.locator('[data-practice-one-fav-v596="judge"]').click();
  await page.locator('#practice-submit-mode').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
  assert.equal(await page.locator('#practice-number-range-v58916').inputValue(), '2');
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

for (const mode of ['single', 'total']) test(`刷题题号：${mode} 模式按所属题库定位，独立于本轮和导入题号`, async t => {
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

test('收藏详情：题库题号、完整选项解析、键盘关闭和只读查看', async t => {
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
  assert.equal(await page.locator('#favorites-list-v596 [data-preview-question="multiple"]').evaluate(node => node === globalThis.document.activeElement), true);
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

test('收藏详情：翻页、切库与窄屏工具栏', async t => {
  const initial = webState();
  const bank = initial.banks[0];
  bank.questions = Array.from({ length: 21 }, (_, index) => ({ ...bank.questions[0], id: 'favorite-' + index }));
  initial.favorites = { 'bank-a': bank.questions.map(question => question.id), 'bank-b': ['same-id'] };
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="favorites"]').click();
  await page.locator('#favorites-list-v596 [data-preview-question="favorite-0"]').click();
  const pager = page.locator('#favorites-list-v596-pager');
  await pager.getByRole('button', { name: '第 3 页', exact: true }).click();
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
  assert.equal(await page.locator('#favorites-list-v596 .favorite-question-number').innerText(), '21');
  assert.equal(await pager.evaluate(node => !node.closest('.table-wrap')), true);
  await page.locator('#favorites-list-v596 [data-preview-question="favorite-20"]').click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator('#bank-question-detail').scrollIntoViewIfNeeded();
  const layout = await page.locator('#bank-question-detail .bank-detail').evaluate(node => ({ width: node.getBoundingClientRect().width, available: node.closest('.table-wrap').clientWidth }));
  assert.ok(layout.width <= layout.available + 1);
  const button = page.locator('#bank-question-detail [data-close-detail]');
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.locator('#active-bank-select').selectOption('bank-b');
  assert.equal(await page.locator('#bank-question-detail').count(), 0);
  assert.equal(await page.locator('#favorites-list-v596 .favorite-question-number').innerText(), '1');
});

test('收藏详情：迟到正文不覆盖当前页，失败可重试', async t => {
  const initial = webState();
  const bank = initial.banks[0];
  bank.questions = Array.from({ length: 21 }, (_, index) => ({ ...bank.questions[0], id: 'favorite-load-' + index }));
  initial.favorites = { 'bank-a': bank.questions.map(question => question.id) };
  const page = await pageFor(t, JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="favorites"]').click();
  await page.evaluate(() => {
    globalThis.ShirohaPlatform.storage.ensureQuestions = async (_snapshot, refs) => {
      if (refs[0]?.questionId === 'favorite-load-10') await new Promise(resolve => { globalThis.__finishFavoriteLoad = resolve; });
      if (refs[0]?.questionId === 'favorite-load-20' && !globalThis.__favoriteRetry) throw Error('收藏加载模拟失败');
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

test('题库批量操作栏保留表格间距，选择提示居中且零选择隐藏', async t => {
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
  assert.ok(Math.abs(textBox.y + textBox.height / 2 - buttonBox.y - buttonBox.height / 2) < 2);
  const toolbar = await page.locator('[aria-label="试题批量管理"]').boundingBox();
  const table = await page.locator('#bank-preview').boundingBox();
  assert.ok(table.y - toolbar.y - toolbar.height >= 12);
  await page.locator('#clear-bank-question-selection').click();
  assert.equal(await selection.isVisible(), false);
});

test('题库删除：单题取消、跨页批量、关联清理和重载保全', async t => {
  const initial=webState();
  initial.banks[0].questions=Array.from({length:302},(_,i)=>({...initial.banks[0].questions[0],id:'q'+i,number:'原'+i,question:'删除回归 '+i,extensions:{preserve:i}}));
  initial.wrongBook['bank-a']=['q0',{id:'q300',wrongCount:2},'q2'];
  initial.favorites['bank-a']=['q0','q300','q2'];
  initial.crossPlatformMeta.favoriteQuestions['bank-a']={q0:{favoritedAt:1},q300:{favoritedAt:2},q2:{favoritedAt:3}};
  const page=await pageFor(t,JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  const baseline=JSON.parse(await saved(page));
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-delete-bank-question="q0"]').waitFor();
  await page.locator('#bank-preview-pager select').selectOption('50');
  page.removeAllListeners('app-dialog');page.once('app-dialog',dialog=>dialog.dismiss());
  await page.locator('[data-delete-bank-question="q0"]').click();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,302);
  page.on('app-dialog',dialog=>dialog.accept());
  await page.locator('[data-select-bank-question="q0"]').check();
  for(let i=0;i<6;i++)await page.locator('#bank-preview-pager').getByRole('button',{name:'下一页',exact:true}).click();
  await page.locator('[data-select-bank-question="q300"]').check();
  assert.match(await page.locator('#bank-question-selection').textContent(),/2/);
  await page.locator('#delete-selected-questions').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const result=JSON.parse(await saved(page));
  assert.deepEqual(result.banks[0].questions,baseline.banks[0].questions.filter(q=>!['q0','q300'].includes(q.id)));
  assert.deepEqual(result.banks[1],baseline.banks[1]);
  assert.deepEqual(result.records,baseline.records);
  assert.deepEqual(result.wrongBook['bank-a'],baseline.wrongBook['bank-a'].filter(q=>(q.id||q)==='q2'));
  assert.deepEqual(result.favorites['bank-a'],['q2']);
  assert.deepEqual(result.crossPlatformMeta.favoriteQuestions['bank-a'],{q2:{favoritedAt:3}});
  assert.match(await page.locator('#bank-preview-pager').textContent(),/第 6 \/ 6 页/);
  await page.reload();await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,300);
});

test('题库删除：切库清空选择、写入失败保留选择、重试删空',async t=>{
  const initial=webState();const page=await pageFor(t,JSON.stringify(initial));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  const baseline=JSON.parse(await saved(page));
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('#select-bank-question-page').click();
  await page.locator('[data-openbank="bank-b"]').click();
  assert.match(await page.locator('#bank-question-selection').textContent(),/已选择 0/);
  await page.locator('#select-bank-question-page').click();
  await page.evaluate(()=>{const write=globalThis.ShirohaPlatform.storage.write;globalThis.__resumeWrite=()=>{globalThis.ShirohaPlatform.storage.write=write};globalThis.ShirohaPlatform.storage.write=async()=>{throw new Error('Synthetic deletion failure')};});
  await page.locator('#delete-selected-questions').click();await page.locator('#platform-status.failed').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[1].questions.length,1);
  assert.equal(await page.locator('[data-select-bank-question="same-id"]').isChecked(),true);
  await page.evaluate(()=>globalThis.__resumeWrite());
  await page.locator('#platform-status button').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[1].questions.length,0);
  assert.deepEqual(JSON.parse(await saved(page)).banks[0],baseline.banks[0]);
  await page.locator('#bank-preview').getByText('当前题库暂无试题。',{exact:true}).waitFor();
  await page.reload();await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[1].questions.length,0);
});

test('题库删除：二次编辑删除保留未编辑题目，允许保存空库',async t=>{
  const initial=webState();const page=await pageFor(t,JSON.stringify(initial));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('#save-all-btn').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  const baseline=JSON.parse(await saved(page));
  const edit=async()=>{await page.locator('.nav[data-view="banks"]').click();await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();await page.locator('[data-editbank-v45="bank-a"]').click();};
  await edit();
  // 桌面释放正文再加载会重建对象；属性插入顺序变化不代表题目被修改。
  await page.evaluate(()=>{globalThis.ShirohaPlatform.storage.ensureQuestions=async snapshot=>{for(const bank of snapshot.banks)bank.questions=bank.questions.map(q=>Object.fromEntries(Object.entries(q).reverse()))};});
  await page.locator('[data-delete-import="0"]').click();await page.locator('#bank-edit-save-v45').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.deepEqual(JSON.parse(await saved(page)).banks[0].questions,baseline.banks[0].questions.slice(1));
  await edit();await page.locator('#import-select-all-visible').check();await page.locator('#batch-delete-import-btn').click();
  assert.equal(await page.locator('#confirm-import-btn').isDisabled(),false);
  await page.locator('#confirm-import-btn').click();await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,0);
});

test('题库删除：进行中练习阻止删除和编辑绕过，其他题库不受影响，完成后可删除',async t=>{
  const initial=webState();initial.banks[0].questions=initial.banks[0].questions.slice(0,1);
  const page=await pageFor(t,JSON.stringify(initial));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="practice"]').click();await page.locator('#start-practice-btn').click();
  await page.locator('.nav[data-view="banks"]').dispatchEvent('click');
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,1);
  await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();
  await page.locator('[data-editbank-v45="bank-a"]').click();await page.locator('[data-delete-import="0"]').click();
  await page.locator('#bank-edit-save-v45').click();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,1);
  assert.equal(await page.locator('#bank-edit-panel-v45').isVisible(),true);
  await page.locator('#bank-edit-cancel-v45').click();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();
  await page.locator('[data-openbank="bank-b"]').click();
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[1].questions.length,0);
  await page.locator('[data-openbank="bank-a"]').click();
  await page.locator('.nav[data-view="practice"]').click();await page.locator('#p-next').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').dispatchEvent('click');
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,0);
});

test('题库删除：未交卷阻止删除，交卷后保留成绩并允许删除',async t=>{
  const initial=webState();initial.banks[0].questions=initial.banks[0].questions.slice(0,1);
  const page=await pageFor(t,JSON.stringify(initial));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="exam"]').click();await page.locator('#start-exam-btn').click();
  await page.locator('.nav[data-view="banks"]').dispatchEvent('click');
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,1);
  await page.locator('.nav[data-view="exam"]').click();await page.locator('#submit-exam-btn').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const records=JSON.parse(await saved(page)).records;
  await page.locator('.nav[data-view="banks"]').dispatchEvent('click');
  await page.locator('[data-delete-bank-question="same-id"]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,0);
  assert.deepEqual(JSON.parse(await saved(page)).records,records);
});

test('题库删除：失效 ID 不写入，重复点击只删除一次，旧编辑不能恢复已删除题目',async t=>{
  const page=await pageFor(t,JSON.stringify(webState()));page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-editbank-v45="bank-a"]').locator('..').locator('..').locator('summary').click();
  await page.locator('[data-editbank-v45="bank-a"]').click();
  await page.locator('.nav[data-view="banks"]').click();
  const before=await saved(page);let confirmations=0;page.on('app-dialog',()=>{confirmations++});
  await page.locator('[data-delete-bank-question="same-id"]').evaluate(button=>{button.dataset.deleteBankQuestion='missing-id';button.click()});
  assert.equal(await saved(page),before);assert.equal(confirmations,0);
  await page.evaluate(()=>{const write=globalThis.ShirohaPlatform.storage.write;globalThis.ShirohaPlatform.storage.write=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,150));return write(...args)};});
  await page.locator('[data-delete-bank-question="missing-id"]').evaluate(button=>{button.dataset.deleteBankQuestion='same-id';button.click();button.click()});
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(confirmations,1);assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,6);
  await page.locator('.nav[data-view="import"]').click();await page.locator('#bank-edit-save-v45').click();
  assert.equal(JSON.parse(await saved(page)).banks[0].questions.length,6);
  assert.equal(await page.locator('#bank-edit-panel-v45').isVisible(),true);
});

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

test('题库详情：旧组合题的陈述、选项和复制一致且不改写数据', async t => {
  const initial = webState();
  const statements = ['①有关法律、法规、规章和标准的规定', '②本地区的安全生产实际情况', '③人员职责明确并有落实措施', '④有明确的应急保障措施'];
  const combinations = ['①②', '①②③', '②③④', '①②③④'];
  const question = initial.banks[0].questions[0];
  question.question = '应急预案应当符合下列（ ）基本要求。';
  question.options = statements.map((text, i) => ({ key: 'ABCD'[i], text: text + ' ' + combinations[i] }));
  question.answer = ['D'];
  question.richContent = { fields: { question: { text: question.question }, options: question.options.map(option => ({ ...option })) } };
  const page = await pageFor(t, JSON.stringify(initial));
  await page.locator('.nav[data-view="banks"]').click();
  const before = await saved(page);
  await page.locator('[data-preview-question="same-id"]').click();
  const body = await page.locator('.bank-detail-body').innerText();
  for (const statement of statements) assert.ok(body.includes(statement), body);
  assert.deepEqual(await page.locator('.bank-detail-option > div').allTextContents(), combinations);
  assert.match(await page.locator('.bank-detail-option.is-answer').innerText(), /D/);
  await page.evaluate(() => Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { globalThis.__copied = text; } } }));
  await page.locator('[data-copy-question]').click();
  assert.equal(await page.evaluate(() => globalThis.__copied), [question.question, ...statements].join('\n'));
  await page.evaluate(() => { globalThis.navigator.clipboard.writeText = async () => { throw Error('denied'); }; });
  await page.locator('[data-copy-question]').click();
  assert.equal(await page.locator('#bank-question-manual-copy').inputValue(), [question.question, ...statements].join('\n'));
  assert.equal(await saved(page), before);
});

test('题库详情：完整长题干复制、拒绝回退与选择隔离', async t => {
  const initial = webState();
  let full = '长题干材料。'.repeat(2000) + '\n第二段 $x^2$。';
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
  await page.evaluate(() => Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { globalThis.__copied = text; } } }));
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

test('题库详情：富内容复制、分页重置与异步反馈隔离', async t => {
  const initial = webState();
  initial.banks[0].questions.push(...Array.from({length:50},(_,i)=>({...initial.banks[0].questions[0],id:'extra-'+i})));
  const page = await pageFor(t,JSON.stringify(initial));
  page.setDefaultTimeout(5000);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-preview-question="rich"]').click();
  await page.evaluate(()=>Object.defineProperty(globalThis.navigator,'clipboard',{configurable:true,value:{writeText:async text=>{globalThis.__copied=text}}}));
  await page.locator('[data-copy-question]').click();
  const copied=await page.evaluate(()=>globalThis.__copied);
  assert.match(copied,/\$x\^2\$/);
  assert.match(copied,/\[图片：题干图\]/);
  assert.equal((copied.match(/\[图片/g)||[]).length,1);
  assert.doesNotMatch(copied,/base64|data:image|选项图|解析图/);
  await page.evaluate(()=>{globalThis.navigator.clipboard.writeText=()=>new Promise(resolve=>{globalThis.__finishCopy=resolve})});
  await page.locator('[data-copy-question]').click();
  await page.locator('[data-preview-question="multiple"]').click();
  await page.evaluate(()=>globalThis.__finishCopy());
  assert.equal(await page.locator('[data-copy-question]').textContent(),'复制题干');
  await page.locator('#bank-preview-pager').getByRole('button',{name:'下一页',exact:true}).click();
  assert.equal(await page.locator('#bank-question-detail').count(),0);
  await page.locator('#bank-preview-pager').getByRole('button',{name:'上一页',exact:true}).click();
  await page.locator('[data-preview-question="blank"]').focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#bank-question-detail').innerText(),/该题型无需选项/);
  await page.locator('[data-close-detail]').click();
  assert.equal(await page.locator('[data-preview-question="blank"]').evaluate(e=>e===globalThis.document.activeElement),true);
});

test('题库详情：段落、表格和代码复制保留原意', async t => {
  const initial=webState();
  const source='第一段 &amp; 条件。\n\n第二段 $x^2$。\n【DOCX表格开始】\n| 项目 | 值 |\n| --- | --- |\n| 甲 | 乙 |\n【DOCX表格结束】\n```html\n<div>代码原文</div>\n```';
  initial.banks[0].questions[0].richContent={fields:{question:{text:source}}};
  const page=await pageFor(t,JSON.stringify(initial));
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('[data-preview-question="same-id"]').click();
  await page.evaluate(()=>Object.defineProperty(globalThis.navigator,'clipboard',{configurable:true,value:{writeText:async text=>{globalThis.__copied=text}}}));
  await page.locator('[data-copy-question]').click();
  assert.equal(await page.evaluate(()=>globalThis.__copied),'第一段 & 条件。\n\n第二段 $x^2$。\n项目\t值\n甲\t乙\n```html\n<div>代码原文</div>\n```');
  await page.setViewportSize({width:480,height:900});
  await page.locator('[data-copy-question]').scrollIntoViewIfNeeded();
  const layout=await page.locator('.bank-detail').evaluate(node=>({width:node.getBoundingClientRect().width,viewport:globalThis.document.getElementById('bank-preview').parentElement.clientWidth}));
  assert.ok(layout.width<=layout.viewport+1);
  const buttonBounds=await page.locator('[data-copy-question]').boundingBox();
  assert.ok(buttonBounds.x>=0&&buttonBounds.x+buttonBounds.width<=480);
});
