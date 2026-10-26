'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('../../apps/desktop/node_modules/playwright-core');
const { startServer, WEB_ROOT } = require('../web-ai-practice/harness.cjs');
const { webState } = require('./fixtures/dataset.cjs');
let browser, server;
test.before(async () => {
  server = await startServer(WEB_ROOT);
  browser = await chromium.launch({ headless: true, ...(process.env.SHIROHA_BROWSER_EXECUTABLE ? { executablePath: process.env.SHIROHA_BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
});
test.after(async () => { await browser?.close(); await server?.close(); });
async function component(t) {
  const page = await browser.newPage({ reducedMotion: 'reduce' }); t.after(() => page.close());
  await page.setContent('<button id="trigger">打开</button>');
  await page.addStyleTag({ path: path.join(WEB_ROOT, 'styles.css') });
  await page.addScriptTag({ path: path.join(WEB_ROOT, 'platform/dialogs.js') });
  await page.locator('#trigger').focus();
  return page;
}
test('确认框居中、取消无副作用、焦点循环恢复且按键不泄露', async t => {
  const page = await component(t);
  await page.evaluate(() => {
    globalThis.keys = [];
    globalThis.document.addEventListener('keydown', event => globalThis.keys.push(event.key));
    globalThis.ShirohaDialogs.confirm('危险操作').then(value => { globalThis.result = value; });
  });
  const box = await page.locator('#app-dialog').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 2);
  assert.ok(Math.abs(box.y + box.height / 2 - viewport.height / 2) < 2);
  assert.equal(await page.locator('[data-dialog-cancel]').evaluate(el => el === globalThis.document.activeElement), true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => globalThis.document.activeElement.closest('#app-dialog') !== null), true);
  }
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => globalThis.result), false);
  assert.deepEqual(await page.evaluate(() => globalThis.keys), []);
  assert.equal(await page.locator('#trigger').evaluate(el => el === globalThis.document.activeElement), true);
});
test('输入保留默认值、空字符串和取消的区别，消息不执行 HTML', async t => {
  const page = await component(t);
  await page.evaluate(() => { globalThis.ShirohaDialogs.prompt('<img src=x onerror=alert(1)>', '默认题库').then(value => { globalThis.result = value; }); });
  assert.equal(await page.locator('#app-dialog input').inputValue(), '默认题库');
  assert.equal(await page.locator('#app-dialog img').count(), 0);
  await page.locator('#app-dialog input').fill('');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => globalThis.result), '');
  await page.evaluate(() => { globalThis.ShirohaDialogs.prompt('名称', '默认').then(value => { globalThis.result = value; }); });
  await page.locator('[data-dialog-close]').click();
  assert.equal(await page.evaluate(() => globalThis.result), null);
});
test('多请求顺序显示，长文本与窄屏仍可操作', async t => {
  const page = await component(t);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(() => {
    globalThis.results = [];
    globalThis.ShirohaDialogs.alert('说明'.repeat(600)).then(() => globalThis.results.push('提示'));
    globalThis.ShirohaDialogs.confirm('第二条').then(value => globalThis.results.push(value));
  });
  assert.equal(await page.locator('dialog[open]').count(), 1);
  await page.locator('[data-dialog-accept]').click();
  await page.locator('#app-dialog-message').filter({ hasText: '第二条' }).waitFor();
  await page.locator('[data-dialog-accept]').click();
  assert.deepEqual(await page.evaluate(() => globalThis.results), ['提示', true]);
});
test('真实练习退出取消保留作答、确认保存；事务内输入弹框可操作', async t => {
  const context = await browser.newContext(); t.after(() => context.close());
  const initial = webState(); initial.records = [];
  await context.addInitScript(data => globalThis.localStorage.setItem('shiroha_quiz_state_v28_4_c1', JSON.stringify(data)), initial);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { errors.push('意外原生框：' + dialog.message()); await dialog.dismiss(); });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(server.url).origin ? route.continue() : route.abort());
  await page.goto(server.url);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card .option[data-key="A"]').click();
  await page.locator('#p-submit').click();
  await page.locator('#p-exit').click();
  await page.locator('[data-dialog-cancel]').click();
  assert.equal(await page.locator('#p-exit').isVisible(), true);
  await page.locator('#p-exit').click();
  assert.equal(await page.locator('[data-dialog-accept]').innerText(), '保存并退出');
  await page.locator('[data-dialog-accept]').click();
  await page.waitForFunction(() => !globalThis.document.body.classList.contains('practice-focus'));
  assert.equal(await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('shiroha_quiz_state_v28_4_c1')).records.length), 1);
  await page.locator('.nav[data-view="banks"]').click();
  await page.locator('#new-empty-bank-btn').click();
  await page.locator('#app-dialog-input').fill('居中弹框测试题库');
  await page.locator('[data-dialog-accept]').click();
  await page.locator('#app-dialog-message').filter({ hasText: '一级分组' }).waitFor();
  await page.locator('[data-dialog-accept]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('shiroha_quiz_state_v28_4_c1')).banks.some(bank => bank.name === '居中弹框测试题库')), true);
  assert.deepEqual(errors, []);
});

test('退出确认期间考试到时自动交卷，迟到的确认不清空成绩界面', async t => {
  const context = await browser.newContext(); t.after(() => context.close());
  const initial = webState(); initial.records = [];
  await context.addInitScript(data => globalThis.localStorage.setItem('shiroha_quiz_state_v28_4_c1', JSON.stringify(data)), initial);
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(server.url).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(server.url);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="exam"]').click();
  await page.locator('#exam-minutes').fill('1');
  await page.locator('#start-exam-btn').click();
  await page.locator('#exam-exit-focus').click();
  await page.locator('#app-dialog').waitFor();
  await page.evaluate(() => { const now = Date.now(); Date.now = () => now + 120000; });
  await page.locator('#exam-back-setup').waitFor({ state: 'attached' });
  await page.locator('[data-dialog-accept]').click();
  assert.equal(await page.locator('#exam-back-setup').isVisible(), true);
  assert.equal(await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('shiroha_quiz_state_v28_4_c1')).records.length), 1);
});
