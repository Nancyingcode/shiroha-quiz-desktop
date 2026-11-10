'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('../../apps/desktop/node_modules/playwright-core');
const { startServer, WEB_ROOT } = require('../web-ai-practice/harness.cjs');
const { addSharedStyles } = require('./styles.cjs');

let browser; let server;
test.before(async () => {
  server = await startServer(WEB_ROOT);
  browser = await chromium.launch({ headless: true, ...(process.env.SHIROHA_BROWSER_EXECUTABLE ? { executablePath: process.env.SHIROHA_BROWSER_EXECUTABLE } : { channel: 'msedge' }) });
});
test.after(async () => { await browser?.close(); await server?.close(); });

// 必须包在 #exam 里：快捷操作的对齐规则都以 #exam / #practice 作用域书写，脱离该作用域测不到真实样式。
const FORM = [
  '<section id="exam"><div class="form-grid">',
  '<label>题型范围<select id="type"><option>全部题型</option></select></label>',
  '<label>抽题方式<select id="order"><option>随机抽题</option></select></label>',
  '<div class="settings-action-cell web-settings-action-cell"><span class="control-label">快捷操作</span>',
  '<div class="settings-action-buttons"><button id="start" class="primary" type="button">开始考试</button>',
  '<button id="submit" class="danger" type="button" disabled>交卷评分</button></div></div>',
  '</div></section>',
].join('');

async function component(t, desktop = false) {
  const page = await browser.newPage({ reducedMotion: 'reduce' }); t.after(() => page.close());
  await page.setContent(`<body class="${desktop ? 'desktop-mist-blue' : ''}">${FORM}</body>`);
  await addSharedStyles(page);
  if (desktop) { await page.addStyleTag({ path: path.join(WEB_ROOT, '../desktop/frontend/desktop.css') }); }
  return page;
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const box = globalThis.document.querySelector(selector).getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    return {
      select: rect('#order'),
      label: rect('#exam .form-grid > label:nth-child(2)'),
      caption: rect('#exam .control-label'),
      row: rect('#exam .settings-action-buttons'),
      start: rect('#start'),
      submit: rect('#submit'),
      cell: rect('#exam .web-settings-action-cell'),
    };
  });
}

for (const desktop of [false, true]) {
  // 1020px 是三列布局里每列约 240px 的临界宽度：两个按钮并排放不下时，
  // 只有「单行可收缩」的实现才不会把快捷操作单元撑高、导致标题行整体上移。
  for (const width of [1020, 1280]) {
    test(`${desktop ? '桌面' : 'Web'} ${width}px 快捷操作按钮组与同排输入框对齐`, async (t) => {
      const page = await component(t, desktop);
      await page.setViewportSize({ width, height: 900 });
      const box = await geometry(page);
      const label = `${desktop ? '桌面' : 'Web'} ${width}px`;
      assert.ok(Math.abs(box.start.bottom - box.select.bottom) <= 1, `${label}：开始考试按钮底边未与下拉框底边对齐 ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.submit.bottom - box.select.bottom) <= 1, `${label}：交卷评分按钮底边未与下拉框底边对齐 ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.start.height - box.select.height) <= 1, `${label}：按钮高度与输入框不一致 ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.row.height - box.select.height) <= 1, `${label}：按钮行换行导致高度超过输入框 ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.cell.height - box.label.height) <= 1, `${label}：快捷操作单元高度与左侧单元不一致 ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.caption.top - box.label.top) <= 1, `${label}：快捷操作标题行未与左侧标签行对齐 ${JSON.stringify(box)}`);
    });
  }
}

test('窄屏快捷操作按钮与输入框同高', async (t) => {
  const page = await component(t);
  await page.setViewportSize({ width: 420, height: 800 });
  const box = await geometry(page);
  assert.ok(Math.abs(box.start.height - box.select.height) <= 1, `窄屏按钮高度应与输入框一致 ${JSON.stringify(box)}`);
  assert.ok(Math.abs(box.cell.height - (box.caption.height + box.row.height + 7)) <= 1, `窄屏快捷操作单元高度应等于标题 + 间距 + 按钮行 ${JSON.stringify(box)}`);
});

// 选中态“被遮挡”回归：.form-grid > label 带 overflow:hidden !important（styles/responsive-artwork.css，
// 窄屏防止数字步进器把控件撑出轨道），向控件外侧扩的 outline 会被这个裁剪盒切掉，
// 实际只剩上缘一段弧线。这里断言聚焦环整个画在控件盒内部，且控件盒不越出裁剪边界。
const FOCUS_FORM = [
  '<section id="exam"><div class="form-grid">',
  '<label>考试名称<input id="exam-name" value="模拟考试" /></label>',
  '<label>题量<input id="exam-count" type="number" value="50" min="1" /></label>',
  '</div></section>',
].join('');

async function focusComponent(t, desktop = false) {
  const page = await browser.newPage({ reducedMotion: 'reduce' }); t.after(() => page.close());
  await page.setContent(`<body class="${desktop ? 'desktop-mist-blue' : ''}">${FOCUS_FORM}</body>`);
  await addSharedStyles(page);
  if (desktop) { await page.addStyleTag({ path: path.join(WEB_ROOT, '../desktop/frontend/desktop.css') }); }
  return page;
}

async function focusRing(page, selector) {
  return page.evaluate((sel) => {
    const input = globalThis.document.querySelector(sel);
    input.focus();
    const style = globalThis.getComputedStyle(input);
    const box = input.getBoundingClientRect();
    const clip = input.closest('label');
    const clipBox = clip.getBoundingClientRect();
    return {
      outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow,
      overflow: globalThis.getComputedStyle(clip).overflow,
      leftGap: box.left - clipBox.left,
      rightGap: clipBox.right - box.right,
      topGap: box.top - clipBox.top,
      bottomGap: clipBox.bottom - box.bottom,
    };
  }, selector);
}

for (const desktop of [false, true]) {
  for (const selector of ['#exam-name', '#exam-count']) {
    test(`${desktop ? '桌面' : 'Web'} ${selector} 聚焦态完整落在裁剪盒内`, async (t) => {
      const page = await focusComponent(t, desktop);
      await page.setViewportSize({ width: 1280, height: 900 });
      const ring = await focusRing(page, selector);
      const label = `${desktop ? '桌面' : 'Web'} ${selector}`;
      assert.equal(ring.overflow, 'hidden', `${label}：label 裁剪盒应为 hidden，否则本断言失去意义 ${JSON.stringify(ring)}`);
      assert.equal(ring.outlineStyle, 'none', `${label}：不应再使用会被裁剪的外扩 outline ${JSON.stringify(ring)}`);
      assert.match(ring.boxShadow, /inset/, `${label}：聚焦环应改为内嵌 box-shadow ${JSON.stringify(ring)}`);
      assert.ok(ring.leftGap >= 0 && ring.rightGap >= 0 && ring.topGap >= 0 && ring.bottomGap >= 0, `${label}：控件盒越出 label 裁剪边界，内嵌聚焦环会被切边 ${JSON.stringify(ring)}`);
    });
  }
}
