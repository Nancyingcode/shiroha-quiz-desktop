'use strict';

const assert = require('node:assert/strict');
const { analysis } = require('./fixtures.cjs');
const { assertPayload } = require('./harness.cjs');

const button = (panel, action) => panel.locator(`[data-review-ai="${action}"]`);
const stored = (h) => h.page.evaluate((key) => JSON.parse(globalThis.localStorage.getItem(key)), h.keys.state);

async function seedReview(h, { unknownSource = false, changedSnapshot = false, crossBankCollision = false } = {}) {
  await h.page.evaluate(({ key, unknown, changed, collision }) => {
    const state = JSON.parse(globalThis.localStorage.getItem(key));
    const bank = state.banks[0];
    const source = unknown ? '' : bank.id;
    const questions = bank.questions.slice(0, 3).map((q) => structuredClone(q));
    if (changed) {
      questions[0].question = '历史题干已与来源不同';
    }
    const items = questions.map((q, index) => ({
      bankId: source,
      bankName: bank.name,
      bankQuestionNumber: index + 1,
      question: q,
    }));
    const details = questions.slice(0, 2).map((q, index) => ({
      questionId: q.id,
      question: q.question,
      type: q.type,
      sourceBankId: source,
      sourceBankName: bank.name,
      nativeQuestion: q,
      chosen: ['A'],
      answer: q.answer,
      correct: index === 0,
    }));
    const review = globalThis.ShirohaTraining.buildReview(items, details, {
      completion: 'ended_early', submitMode: 'single', timing: 'active',
    });
    state.records = [{
      id: 'training-ai-record', mode: '练习', bankId: source, bankName: bank.name,
      date: '2026-01-02T00:00:00.000Z', total: 3, answered: 2, correct: 1,
      wrong: 1, accuracy: 50, duration: 20, details, review,
      reviewSummary: globalThis.ShirohaTraining.reviewSummary(review, details),
    }];
    if (collision) {
      state.banks.push({ ...structuredClone(bank), id: 'other-review-bank', name: '同 ID 的其他题库' });
      state.activeBankId = 'other-review-bank';
    }
    globalThis.localStorage.setItem(key, JSON.stringify(state));
  }, { key: h.keys.state, unknown: unknownSource, changed: changedSnapshot, collision: crossBankCollision });
  await h.page.reload();
  await h.page.locator('body[data-storage-state="ready"]').waitFor();
  await h.page.locator('#save-all-btn').click();
  await h.page.waitForFunction((key) => JSON.parse(globalThis.localStorage.getItem(key)).banks[0].questions[0].normalized, h.keys.state);
}

async function openReview(h) {
  await h.page.locator('.nav[data-view="records"]').click();
  await h.page.locator('#records [data-training-review]').first().click();
  await h.page.locator('#training-review.active').waitFor();
  return h.page.locator('#training-question [data-review-analysis]');
}

async function generate(h, panel, text) {
  const pending = h.mock.enqueue('analysis', analysis(text));
  await button(panel, 'generate').click();
  const call = await h.waitCall(pending);
  await panel.locator('.q-multiline-text').filter({ hasText: text }).waitFor();
  return call;
}

const cases = [
  {
    name: 'training-review-ai-entry-draft-save-and-history', options: { emptyAnalysis: true },
    async run(h) {
      await seedReview(h, { crossBankCollision: true });
      const panel = await openReview(h);
      for (let index = 0; index < 3; index += 1) {
        await h.page.locator(`[data-training-question="${index}"]`).click();
        await button(panel, 'generate').waitFor();
        assert.match(await panel.innerText(), /暂无解析/);
      }
      await h.page.locator('[data-training-question="0"]').click();
      await h.quiet();
      const before = await stored(h);
      const call = await generate(h, panel, 'TRAINING_REVIEW_DRAFT');
      assertPayload(call, 'SAFE_Q1', ['SAFE_Q2', 'SAFE_BLANK']);
      assert(call.body.messages.find((message) => message.role === 'user').content.includes('"userAnswer":["A"]'));
      assert.deepEqual(await stored(h), before, '未确认的草稿不得写入存储');
      assert.match(await panel.innerText(), /草稿 · 未保存/);
      await h.page.setViewportSize({ width: 320, height: 844 });
      assert(await h.page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
      await h.page.setViewportSize({ width: 1440, height: 1000 });
      await h.page.locator('[data-training-filter="correct"]').click();
      assert.match(await panel.innerText(), /TRAINING_REVIEW_DRAFT/);
      await button(panel, 'save').click();
      await panel.locator('.review-analysis-saved').waitFor();
      const after = await stored(h);
      assert.equal(after.banks[0].questions[0].analysis, 'TRAINING_REVIEW_DRAFT');
      assert.deepEqual(after.records, before.records, '保存解析不得改写历史记录');
      assert.deepEqual(after.banks[1], before.banks[1], '同 ID 的当前题库不得被误写');
      assert.deepEqual(after.banks[0].questions.slice(1), before.banks[0].questions.slice(1));
      const expectedQuestion = { ...before.banks[0].questions[0], analysis: 'TRAINING_REVIEW_DRAFT' };
      assert.deepEqual(after.banks[0].questions[0], expectedQuestion);
      await h.page.locator('#training-review-back').click();
      await h.page.locator('#records [data-training-review]').first().click();
      await panel.filter({ hasText: 'TRAINING_REVIEW_DRAFT' }).waitFor();
      assert.equal(await button(panel, 'generate').count(), 0);
      assert.deepEqual((await stored(h)).records, before.records);
    },
  },
  {
    name: 'training-review-ai-late-response-after-switch-and-leave',
    options: { emptyAnalysis: true, ignoreAbort: true },
    async run(h) {
      await seedReview(h);
      const panel = await openReview(h);
      const first = h.mock.enqueue('analysis', analysis('STALE_FIRST_DRAFT'), { hold: true });
      await button(panel, 'generate').click();
      await h.waitCall(first);
      await h.page.evaluate(() => {
        globalThis.ShirohaPlatform.storage.ensureQuestions = async () => {
          await new Promise((resolve) => { globalThis.__finishTrainingSourceRead = resolve; });
        };
      });
      await h.page.locator('[data-training-question="1"]').click();
      await h.page.waitForFunction(() => typeof globalThis.__finishTrainingSourceRead === 'function');
      await h.deliver(first);
      assert.doesNotMatch(await panel.innerText(), /STALE_FIRST_DRAFT/);
      await h.page.evaluate(() => {
        globalThis.__finishTrainingSourceRead();
        delete globalThis.ShirohaPlatform.storage.ensureQuestions;
      });
      await button(panel, 'generate').waitFor();
      const second = h.mock.enqueue('analysis', analysis('STALE_SECOND_DRAFT'), { hold: true });
      await button(panel, 'generate').click();
      await h.waitCall(second);
      await h.page.locator('#training-review-back').click();
      await h.deliver(second);
      await h.page.locator('#records [data-training-review]').first().click();
      await button(panel, 'generate').waitFor();
      assert.doesNotMatch(await panel.innerText(), /STALE_FIRST_DRAFT|STALE_SECOND_DRAFT/);
      assert.equal((await stored(h)).banks[0].questions[0].analysis, '');
      assert.equal((await stored(h)).banks[0].questions[1].analysis, '');
    },
  },
  {
    name: 'training-review-ai-missing-or-changed-source-keeps-draft', options: { emptyAnalysis: true },
    async run(h) {
      await seedReview(h, { unknownSource: true });
      let panel = await openReview(h);
      const before = await stored(h);
      await generate(h, panel, 'UNKNOWN_SOURCE_DRAFT');
      await button(panel, 'save').click();
      await panel.locator('[role="alert"]').waitFor();
      assert.match(await panel.innerText(), /来源题库或题目不存在/);
      assert.match(await panel.innerText(), /UNKNOWN_SOURCE_DRAFT/);
      assert.deepEqual(await stored(h), before, '未知来源不得写入当前题库同 ID 的题目');
      await seedReview(h, { changedSnapshot: true });
      panel = await openReview(h);
      await generate(h, panel, 'CHANGED_SOURCE_DRAFT');
      await button(panel, 'save').click();
      await panel.locator('[role="alert"]').waitFor();
      assert.match(await panel.innerText(), /来源题目已发生变化/);
      assert.match(await panel.innerText(), /CHANGED_SOURCE_DRAFT/);
      assert.equal((await stored(h)).banks[0].questions[0].analysis, '');
    },
  },
  {
    name: 'training-review-ai-save-failure-retains-draft', options: { emptyAnalysis: true },
    async run(h) {
      await seedReview(h);
      const panel = await openReview(h);
      await generate(h, panel, 'TRAINING_QUOTA_DRAFT');
      const before = await stored(h);
      await h.page.evaluate((key) => {
        globalThis.__trainingOriginalSet = globalThis.Storage.prototype.setItem;
        globalThis.Storage.prototype.setItem = function (name, value) {
          if (this === globalThis.localStorage && name === key) {
            throw new globalThis.DOMException('Synthetic quota', 'QuotaExceededError');
          }
          return globalThis.__trainingOriginalSet.call(this, name, value);
        };
      }, h.keys.state);
      try {
        await button(panel, 'save').click();
        await panel.locator('[role="alert"]').waitFor();
        assert.match(await panel.innerText(), /TRAINING_QUOTA_DRAFT/);
        assert.deepEqual(await stored(h), before);
      } finally {
        await h.page.evaluate(() => { globalThis.Storage.prototype.setItem = globalThis.__trainingOriginalSet; });
      }
      await button(panel, 'save').click();
      await panel.locator('.review-analysis-saved').waitFor();
      assert.equal((await stored(h)).banks[0].questions[0].analysis, 'TRAINING_QUOTA_DRAFT');
    },
  },
  {
    name: 'training-review-ai-unconfigured-offers-settings',
    options: { emptyAnalysis: true, configured: false },
    async run(h) {
      await seedReview(h);
      const panel = await openReview(h);
      await button(panel, 'settings').waitFor();
      assert.match(await panel.innerText(), /尚未配置 AI 服务/);
      await button(panel, 'settings').click();
      await h.page.locator('#ai-settings.active').waitFor();
      await h.quiet();
      assert.equal(h.mock.calls.length, 0);
    },
  },
];

module.exports = { cases };
