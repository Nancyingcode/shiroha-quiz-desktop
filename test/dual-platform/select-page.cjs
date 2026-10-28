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

async function component(t, desktop = false) {
  const page = await browser.newPage({ reducedMotion: 'reduce' }); t.after(() => page.close());
  await page.setContent(`<body class="${desktop ? 'desktop-mist-blue' : ''}"><label>题型<select id="type"><option value="all">全部题型</option><option value="single">单选题</option><option value="disabled" disabled>不可用题型</option><option value="multiple">多选题</option></select></label><button id="next">下一项</button></body>`);
  await page.addStyleTag({ path: path.join(WEB_ROOT, 'styles.css') });
  if (desktop) await page.addStyleTag({ path: path.join(WEB_ROOT, '../desktop/frontend/desktop.css') });
  return page;
}

for (const desktop of [false, true]) {
  test(`${desktop ? '桌面' : 'Web'}下拉菜单具有统一浮层、选中提示和禁用态`, async t => {
    const page = await component(t, desktop);
    const select = page.locator('#type');
    const style = await select.evaluate(el => ({
      appearance: globalThis.getComputedStyle(el).appearance,
      radius: globalThis.getComputedStyle(el).borderRadius,
      popup: globalThis.getComputedStyle(el, '::picker(select)').borderRadius,
      disabled: globalThis.getComputedStyle(el.options[2]).cursor,
      selected: globalThis.getComputedStyle(el.options[0], '::checkmark').content,
    }));
    assert.equal(style.appearance, 'base-select');
    assert.equal(style.radius, '6px');
    assert.equal(style.popup, '8px');
    assert.equal(style.disabled, 'not-allowed');
    assert.notEqual(style.selected, 'none');
    await select.click();
    assert.equal(await select.evaluate(el => el.matches(':open')), true);
    await select.getByRole('option', { name: '全部题型', exact: true }).hover();
    assert.equal(await select.evaluate(el => globalThis.getComputedStyle(el.options[0]).backgroundColor), 'rgb(230, 244, 255)');
    await page.getByRole('option', { name: '单选题', exact: true }).click();
    assert.equal(await select.inputValue(), 'single');
    assert.equal(await select.evaluate(el => el.matches(':open')), false);
    assert.equal(await select.evaluate(el => el === globalThis.document.activeElement), true);
    await select.evaluate(el => { el.disabled = true; });
    assert.equal(await select.isDisabled(), true);
    assert.equal(await select.evaluate(el => globalThis.getComputedStyle(el).cursor), 'not-allowed');
  });
}

test('键盘选择跳过禁用项，Escape 取消且 Tab 可离开', async t => {
  const page = await component(t);
  const select = page.locator('#type');
  await select.evaluate(el => {
    globalThis.changes = [];
    el.addEventListener('change', () => globalThis.changes.push(el.value));
  });
  await select.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await select.inputValue(), 'multiple');
  assert.deepEqual(await page.evaluate(() => globalThis.changes), ['multiple']);
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Escape');
  assert.equal(await select.inputValue(), 'multiple');
  assert.deepEqual(await page.evaluate(() => globalThis.changes), ['multiple']);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#next').evaluate(el => el === globalThis.document.activeElement), true);
});

test('窄屏长选项可换行滚动，弹窗内的浮层可点击', async t => {
  const page = await component(t);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(() => {
    const dialog = globalThis.document.createElement('dialog');
    dialog.innerHTML = '<label>来源<select id="long"></select></label>';
    dialog.style.cssText = 'width:280px;max-height:180px;overflow:hidden';
    const select = dialog.querySelector('select');
    for (let i = 0; i < 30; i++) {
      const option = globalThis.document.createElement('option');
      option.value = String(i); option.textContent = `题库 ${i}：` + '超长题库名称用于核对窄屏显示'.repeat(3);
      select.append(option);
    }
    globalThis.document.body.append(dialog); dialog.showModal();
  });
  const select = page.locator('#long');
  await select.click();
  const option = page.getByRole('option').last();
  await option.scrollIntoViewIfNeeded();
  const bounds = await option.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 361);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 641);
  assert.ok(bounds.height > 32, '长选项应换行而非溢出');
  await option.click();
  assert.equal(await select.inputValue(), '29');
  assert.equal(await select.evaluate(el => el.matches(':open')), false);
});

test('下拉菜单优先向下展开，靠近视口底部时向上避让', async t => {
  const page = await component(t);
  const select = page.locator('#type');
  await select.click();
  let control = await select.boundingBox();
  let first = await select.getByRole('option').first().boundingBox();
  assert.ok(first.y >= control.y + control.height);
  await page.keyboard.press('Escape');
  await select.evaluate(el => { el.style.cssText = 'position:fixed;bottom:8px;left:16px;width:240px'; });
  await select.click();
  control = await select.boundingBox();
  first = await select.getByRole('option').first().boundingBox();
  const last = await select.getByRole('option').last().boundingBox();
  assert.ok(first.y >= 0 && last.y + last.height <= control.y);
});

test('收起的长题库名称不会挤掉下拉箭头', async t => {
  const page = await component(t, true);
  const select = page.locator('#type');
  await select.evaluate(el => {
    el.style.width = '220px';
    el.options[0].textContent = '未分组 / C1驾照科目一模拟练习超长题库名称（393题）';
  });
  const session = await page.context().newCDPSession(page);
  const { root } = await session.send('DOM.getDocument');
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#type' });
  const { node } = await session.send('DOM.describeNode', { nodeId });
  const arrow = node.pseudoElements.find(element => element.pseudoType === 'picker-icon');
  const { model } = await session.send('DOM.getBoxModel', { backendNodeId: arrow.backendNodeId });
  const control = await select.boundingBox();
  const horizontal = model.border.filter((_, index) => index % 2 === 0);
  assert.ok(Math.min(...horizontal) >= control.x && Math.max(...horizontal) <= control.x + control.width, '箭头必须完整留在选择框内');
});

test('真实页面动态下拉框保留题型筛选、题量联动与紧凑分页', async t => {
  const context = await browser.newContext(); t.after(() => context.close());
  await context.addInitScript(data => globalThis.localStorage.setItem('shiroha_quiz_state_v28_4_c1', JSON.stringify(data)), webState());
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(server.url).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(server.url);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-type').click();
  await page.locator('#practice-type').getByRole('option', { name: '单选', exact: true }).click();
  assert.equal(await page.locator('#practice-type').inputValue(), 'single');
  await page.locator('#practice-limit').click();
  await page.locator('#practice-limit').getByRole('option', { name: '全部', exact: true }).click();
  assert.equal(await page.locator('#practice-custom-count').isVisible(), false);
  await page.locator('#practice-limit').click();
  await page.locator('#practice-limit').getByRole('option', { name: '自定义', exact: true }).click();
  assert.equal(await page.locator('#practice-custom-count').isVisible(), true);
  await page.locator('.nav[data-view="banks"]').click();
  const size = page.locator('#bank-preview-pager .list-page-size');
  assert.equal((await size.boundingBox()).height, 32);
  await size.click();
  await size.getByRole('option', { name: '50 条/页', exact: true }).click();
  assert.equal(await page.locator('#bank-preview-pager .list-page-size').inputValue(), '50');
});
