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
  assert.match(await card.locator('.option.wrong').innerText(), /你的选择（错误）/);
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
  assert.equal(await overview.locator('[data-wrong-question-index]').count(), 13);
  assert.match(await overview.locator('[data-wrong-question-index="0"]').innerText(), /阶段A全题型/);
  const last = overview.locator('[data-wrong-question-index="12"]');
  assert.equal(await last.locator('.review-options .option').count(), 2);
  assert.match(await last.innerText(), /跨题库同ID/);
  assert.match(await last.innerText(), /正确答案[：\s]*B[.\s]*三/);
  assert.match(await last.innerText(), /未作答/);
  assert.equal(JSON.parse(await saved(page)).records[0].details.length, 13);
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
  await page.locator('[data-practice-one-fav-v596="judge"]').click();
  await page.locator('#practice-submit-mode').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#practice-number-range-v58916').inputValue(), '2');
  await page.locator('#practice-submit-mode').selectOption('total');
  await page.locator('#start-practice-btn').click();
  assert.equal(await page.locator('[data-practice-jump]').count(), 1);
  assert.match(await page.locator('#practice-card').innerText(), /一加一等于二/);
  await page.locator('#practice-card .option[data-key="A"]').click();
  await page.locator('#p-submit-all').click();
  await page.locator('#again-practice').waitFor();
  assert.equal(JSON.parse(await saved(page)).records[0].correct, 1);
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
