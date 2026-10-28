'use strict';

const assert = require('node:assert/strict');
const { analysis, BANK_ID } = require('./fixtures.cjs');
const { snapshot, assertPayload } = require('./harness.cjs');

const options = { emptyAnalysis: true };
const button = (panel, action) => panel.locator(`[data-review-ai="${action}"]`);
const stored = h => h.page.evaluate(key => JSON.parse(localStorage.getItem(key)), h.keys.state);
async function generate(h, panel, text, responseOptions = {}) {
  const entry = h.mock.enqueue('analysis', analysis(text), responseOptions);
  await button(panel, 'generate').click();
  const call = await h.waitCall(entry);
  if (!responseOptions.status) await panel.locator('.q-multiline-text').filter({ hasText: text }).waitFor();
  else await panel.locator('[role="alert"]').waitFor();
  return call;
}
async function save(h, panel) {
  await button(panel, 'save').click();
  await h.page.locator('body[data-storage-state="ready"]').waitFor();
  await panel.locator('.review-analysis-saved').waitFor();
}
async function wrongBook(h) {
  if (await h.page.locator('#back-practice-setup').isVisible()) await h.page.locator('#back-practice-setup').click();
  await h.page.locator('.nav[data-view="wrongbook"]').click();
  return h.page.locator('#wrongbook-list .wrong-item').filter({ hasText: 'SAFE_Q1' }).locator('[data-review-analysis]');
}
async function totalResult(h) {
  await h.page.locator('.nav[data-view="practice"]').click();
  await h.page.locator('#practice-submit-mode').selectOption('total');
  await h.page.locator('#practice-limit').selectOption('all');
  await h.page.locator('#start-practice-btn').click();
  await h.page.locator('#practice-card .option[data-key="B"]').click();
  await h.page.locator('#p-submit-all').click();
  await h.page.locator('#again-practice').waitFor();
  return h.page.locator('#p-wrong-overview [data-review-analysis]').first();
}

const cases = [
  {
    name: 'wrong-analysis-book-generates-draft-and-saves-only-analysis', options,
    async run(h) {
      const panel = await wrongBook(h);
      await button(panel, 'generate').waitFor();
      await h.quiet();
      const before = await stored(h);
      const beforeMemory = await snapshot(h.page);
      const call = await generate(h, panel, 'WRONG_BOOK_DRAFT');
      assertPayload(call, 'SAFE_Q1', ['SAFE_Q2', 'SAFE_BLANK', 'SAFE_SHORT', 'SAFE_IMAGE']);
      assert(call.body.messages.find(message => message.role === 'user').content.includes('"userAnswer":["B"]'));
      assert.deepEqual(await stored(h), before, 'Generating persisted an unconfirmed draft.');
      assert.match(await panel.innerText(), /草稿 · 未保存/);
      await save(h, panel);
      const after = await stored(h);
      assert.equal(after.banks[0].questions[0].analysis, 'WRONG_BOOK_DRAFT');
      const expected = structuredClone(beforeMemory);
      expected.bank.questions[0].analysis = 'WRONG_BOOK_DRAFT';
      expected.bank.updatedAt = after.banks[0].updatedAt;
      assert.deepEqual(await snapshot(h.page), expected, 'Saving changed answers, learning data or history.');
      assert.deepEqual(after.banks[0], expected.bank);
      assert.deepEqual(after.records, before.records);
      await h.page.locator('.nav[data-view="records"]').click();
      const reopened = await wrongBook(h);
      assert.match(await reopened.innerText(), /WRONG_BOOK_DRAFT/);
      assert.equal(await button(reopened, 'generate').count(), 0);
    },
  },
  {
    name: 'wrong-analysis-feedback-preserves-draft-on-regeneration-error-and-discard', options,
    async run(h) {
      await h.start(); await h.submitChoice('B');
      const panel = h.page.locator('#p-feedback [data-review-analysis]');
      await button(panel, 'generate').waitFor();
      assert.equal(await h.page.locator('#p-ai-v613 button').count(), 0, 'Two AI entries appeared for the empty wrong answer.');
      const before = await stored(h);
      await generate(h, panel, 'PRESERVED_WRONG_DRAFT');
      await generate(h, panel, 'IGNORED_ERROR', { status: 503 });
      assert.match(await panel.innerText(), /PRESERVED_WRONG_DRAFT/);
      assert(await button(panel, 'save').isEnabled());
      await button(panel, 'discard').click();
      assert.match(await panel.innerText(), /暂无解析/);
      assert.equal(await button(panel, 'save').count(), 0);
      assert.deepEqual(await stored(h), before);
    },
  },
  {
    name: 'wrong-analysis-result-save-preserves-record-snapshot-and-refreshes-book', options,
    async run(h) {
      const panel = await totalResult(h);
      const before = await stored(h);
      assert.equal(before.records[0].details[0].nativeQuestion.analysis, '');
      await generate(h, panel, 'RESULT_SAVED_ANALYSIS');
      await save(h, panel);
      const after = await stored(h);
      assert.deepEqual(after.records, before.records);
      assert.equal(after.banks[0].questions[0].analysis, 'RESULT_SAVED_ANALYSIS');
      assert.match(await (await wrongBook(h)).innerText(), /RESULT_SAVED_ANALYSIS/);
    },
  },
  {
    name: 'wrong-analysis-quota-rollback-keeps-draft-and-retry', options,
    async run(h) {
      await h.start(); await h.submitChoice('B');
      const panel = h.page.locator('#p-feedback [data-review-analysis]');
      await generate(h, panel, 'QUOTA_REVIEW_DRAFT');
      const before = await snapshot(h.page), savedBefore = await stored(h);
      await h.page.evaluate(key => {
        window.__reviewOriginalSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (this === localStorage && name === key) throw new DOMException('Synthetic quota', 'QuotaExceededError');
          return window.__reviewOriginalSet.call(this, name, value);
        };
      }, h.keys.state);
      try {
        await button(panel, 'save').click();
        await h.page.locator('body[data-storage-state="ready"]').waitFor();
        await panel.locator('[role="alert"]').waitFor();
        assert.match(await panel.innerText(), /QUOTA_REVIEW_DRAFT/);
        assert.deepEqual(await snapshot(h.page), before);
        assert.deepEqual(await stored(h), savedBefore);
        assert(await button(panel, 'save').isEnabled());
      } finally { await h.page.evaluate(() => { Storage.prototype.setItem = window.__reviewOriginalSet; }); }
      await save(h, panel);
      assert.equal((await stored(h)).banks[0].questions[0].analysis, 'QUOTA_REVIEW_DRAFT');
    },
  },
  {
    name: 'wrong-analysis-unconfigured-settings-no-network', options: { ...options, configured: false },
    async run(h) {
      const panel = await wrongBook(h);
      assert.match(await panel.innerText(), /暂无解析/);
      await button(panel, 'settings').click();
      await h.page.locator('#ai-settings.active #ai-endpoint-v99').waitFor({ state: 'visible' });
      await h.quiet();
      assert.equal(h.mock.calls.length, 0);
    },
  },
  {
    name: 'wrong-analysis-stop-and-late-response-cannot-replace-another-question', options: { ...options, ignoreAbort: true },
    async run(h) {
      await h.start(); await h.submitChoice('B');
      const first = h.page.locator('#p-feedback [data-review-analysis]');
      const pending = h.mock.enqueue('analysis', analysis('STALE_WRONG_RESPONSE'), { hold: true });
      await button(first, 'generate').click(); await h.waitCall(pending);
      await button(first, 'stop').click();
      assert.match(await first.innerText(), /暂无解析/);
      await h.jump(1); await h.submitChoice('A');
      const second = h.page.locator('#p-feedback [data-review-analysis]');
      const call = await generate(h, second, 'SECOND_QUESTION_DRAFT');
      assertPayload(call, 'SAFE_Q2', ['SAFE_Q1']);
      await h.deliver(pending);
      assert.match(await second.innerText(), /SECOND_QUESTION_DRAFT/);
      assert.doesNotMatch(await second.innerText(), /STALE_WRONG_RESPONSE/);
      await save(h, second);
      const saved = await stored(h);
      assert.equal(saved.banks[0].questions[0].analysis, '');
      assert.equal(saved.banks[0].questions[1].analysis, 'SECOND_QUESTION_DRAFT');
    },
  },
  {
    name: 'wrong-analysis-deleted-source-retains-result-draft', options,
    async run(h) {
      const panel = await totalResult(h);
      await generate(h, panel, 'ORPHAN_RESULT_DRAFT');
      await h.page.locator('#back-practice-setup').click();
      await h.page.locator('.nav[data-view="banks"]').click();
      await h.page.locator('[data-delete-bank-question="safe-single-1"]').click();
      await h.page.locator('body[data-storage-state="ready"]').waitFor();
      await h.page.locator('.nav[data-view="practice"]').click();
      await button(panel, 'save').click();
      await panel.locator('[role="alert"]').waitFor();
      assert.match(await panel.innerText(), /来源题库或题目不存在/);
      assert.match(await panel.innerText(), /ORPHAN_RESULT_DRAFT/);
      assert.equal((await stored(h)).banks.find(bank => bank.id === BANK_ID).questions.some(q => q.id === 'safe-single-1'), false);
    },
  },
  {
    name: 'wrong-analysis-exam-result-can-generate-and-save', options,
    async run(h) {
      await h.page.locator('.nav[data-view="exam"]').click();
      await h.page.locator('#exam-count').fill('5');
      await h.page.locator('#start-exam-btn').click();
      await h.page.locator('#exam-submit-focus').click();
      const panel = h.page.locator('#exam-card [data-review-analysis]').first();
      await button(panel, 'generate').waitFor();
      const before = await stored(h);
      await generate(h, panel, 'EXAM_RESULT_DRAFT');
      await save(h, panel);
      const after = await stored(h);
      assert.deepEqual(after.records, before.records);
      assert.equal(after.banks[0].questions.filter(q => q.analysis === 'EXAM_RESULT_DRAFT').length, 1);
    },
  },
];

module.exports = { cases };
