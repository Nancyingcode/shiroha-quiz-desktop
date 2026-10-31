'use strict';

const assert = require('node:assert/strict');
const { analysis } = require('./fixtures.cjs');
const { SEL, snapshot } = require('./harness.cjs');

const stored = h => h.page.evaluate(key => JSON.parse(localStorage.getItem(key)), h.keys.state);
async function openSaved(h, text) {
  const requests = h.mock.calls.length;
  await h.page.locator(SEL.open).click();
  await h.page.locator(`${SEL.panel} ${SEL.text}`).filter({ hasText: text }).waitFor();
  assert.equal(await h.page.locator(`${SEL.panel} ${SEL.save}`).count(), 0);
  await h.quiet();
  assert.equal(h.mock.calls.length, requests, '查看已保存解析不能重新请求 AI。');
}

const cases = [
  ...['single', 'total'].map(mode => ({
    name: `saved-analysis-${mode}-practice-reopens-and-reloads-without-network`,
    options: { emptyAnalysis: true },
    async run(h) {
      await h.page.locator('.nav[data-view="practice"]').click();
      await h.page.locator('#practice-submit-mode').selectOption(mode);
      await h.start();
      await h.generate(analysis('PERSISTED_PRACTICE_ANALYSIS'));
      await h.page.locator(SEL.save).click();
      await h.page.locator('body[data-storage-state="ready"]').waitFor();
      assert.equal((await snapshot(h.page)).question.analysis, 'PERSISTED_PRACTICE_ANALYSIS');
      await h.page.locator('#p-favorite').click();
      await h.page.locator('#p-exit').click();
      await h.start();
      await openSaved(h, 'PERSISTED_PRACTICE_ANALYSIS');
      await h.page.reload();
      await h.page.locator('body[data-storage-state="ready"]').waitFor();
      await h.start();
      await openSaved(h, 'PERSISTED_PRACTICE_ANALYSIS');
      assert.equal(h.mock.calls.length, 1);
      await h.page.locator('#p-exit').click();
      if (await h.page.locator('#back-practice-setup').isVisible()) await h.page.locator('#back-practice-setup').click();
      await h.page.locator('.nav[data-view="favorites"]').click();
      await h.page.locator('#favorites-list-v596 [data-preview-question="safe-single-1"]').click();
      assert.match(await h.page.locator('#bank-question-detail').innerText(), /PERSISTED_PRACTICE_ANALYSIS/);
    },
  })),
  {
    name: 'saved-analysis-unconfigured-practice-can-read-local-analysis',
    options: { configured: false },
    async run(h) {
      await h.start();
      await openSaved(h, 'Original local explanation.');
      assert.equal(h.mock.calls.length, 0);
      assert(await h.page.locator(SEL.settings).isVisible());
    },
  },
  {
    name: 'saved-analysis-regeneration-failure-and-unsaved-draft-preserve-local-analysis',
    async run(h) {
      await h.start();
      await openSaved(h, 'Original local explanation.');
      await h.generate('', { regenerate: true, status: 503 });
      assert.match(await h.page.locator(SEL.panel).innerText(), /Original local explanation\./);
      await h.generate(analysis('UNSAVED_REPLACEMENT'), { regenerate: true });
      await h.page.locator('#p-exit').click();
      await h.start();
      await openSaved(h, 'Original local explanation.');
      assert.doesNotMatch(await h.page.locator(SEL.panel).innerText(), /UNSAVED_REPLACEMENT/);
    },
  },
  {
    name: 'saved-analysis-result-and-reloaded-review-read-source-without-changing-history',
    options: { emptyAnalysis: true },
    async run(h) {
      await h.page.locator('.nav[data-view="practice"]').click();
      await h.page.locator('#practice-submit-mode').selectOption('total');
      await h.start();
      await h.page.locator('#practice-card .option[data-key="B"]').click();
      await h.page.locator('#p-submit-all').click();
      await h.page.locator('#practice-review-result').waitFor();
      const panel = h.page.locator('#p-wrong-overview [data-review-analysis]').first();
      const before = await stored(h);
      const entry = h.mock.enqueue('analysis', analysis('PERSISTED_RESULT_ANALYSIS'));
      await panel.locator('[data-review-ai="generate"]').click();
      await h.waitCall(entry);
      await panel.locator('[data-review-ai="save"]').click();
      await panel.locator('.review-analysis-saved').waitFor();
      assert.deepEqual((await stored(h)).records, before.records);
      await h.page.locator('#practice-review-result').click();
      await h.page.locator('#training-question .training-analysis').filter({ hasText: 'PERSISTED_RESULT_ANALYSIS' }).waitFor();
      await h.page.reload();
      await h.page.locator('body[data-storage-state="ready"]').waitFor();
      await h.page.locator('.nav[data-view="records"]').click();
      await h.page.locator('#records [data-training-review]').first().click();
      await h.page.locator('#training-question .training-analysis').filter({ hasText: 'PERSISTED_RESULT_ANALYSIS' }).waitFor();
      assert.deepEqual((await stored(h)).records, before.records);
      assert.equal(h.mock.calls.length, 1);
    },
  },
];

module.exports = { cases };
