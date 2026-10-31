'use strict';

const assert = require('node:assert/strict');
const { snapshot, SEL, assertPayload } = require('./harness.cjs');
const { analysis, MOCK_ENDPOINT, MODEL, FAKE_KEY } = require('./fixtures.cjs');

async function startTotal(h) {
  await h.page.locator('.nav[data-view="practice"]').click();
  await h.page.locator('#practice-submit-mode').selectOption('total');
  await h.page.locator('#practice-limit').selectOption('all');
  await h.page.locator('#start-practice-btn').click();
  await h.page.locator('#p-submit-all').waitFor();
}

async function ready(h) {
  await h.page.locator('body[data-storage-state="ready"]').waitFor();
}

const cases = [
  ...['single', 'total'].map(mode => ({
    name: `practice-clear-options-ai-draft-${mode}`,
    async run(h) {
      if (mode === 'total') await startTotal(h); else await h.start();
      await h.page.locator('#practice-card .option[data-key="B"]').click();
      await h.generate(analysis('BEFORE_CLEAR'));
      const before = await snapshot(h.page);
      const calls = h.mock.calls.length;
      await h.page.locator('[data-clear-answer-options]').click();
      await h.quiet();
      assert.equal(h.mock.calls.length, calls);
      const after = await snapshot(h.page);
      assert.deepEqual(after.records, before.records);
      assert.deepEqual(after.wrongBook, before.wrongBook);
      assert((await h.page.locator(SEL.panel).innerText()).includes('BEFORE_CLEAR'));
      const request = await h.generate(analysis('AFTER_CLEAR'), { regenerate: true });
      assert(request.body.messages.find(message => message.role === 'user').content.includes('"userAnswer":[]'));
      assert.equal((await snapshot(h.page)).practice.answered, 0);
    },
  })),
  ...['single', 'total'].map(mode => ({
    name: `practice-review-ai-unsubmitted-${mode}`,
    async run(h) {
      if (mode === 'total') await startTotal(h); else await h.start();
      await h.page.locator('#practice-card .option[data-key="B"]').click();
      const before = await snapshot(h.page);
      await h.quiet();
      const call = await h.generate(analysis('UNSUBMITTED_AI'));
      assertPayload(call, 'SAFE_Q1', ['SAFE_Q2']);
      assert(call.body.messages.find(message => message.role === 'user').content.includes('"userAnswer":["B"]'));
      assert.equal((await snapshot(h.page)).practice.answered, 0);
      assert.deepEqual((await snapshot(h.page)).records, before.records);
      assert.deepEqual((await snapshot(h.page)).practice.answerState, before.practice.answerState);
      await h.jump(3);
      await h.page.locator('#practice-card .text-answer').fill('DRAFT_AI_SHORT_ANSWER');
      const shortCall = await h.generate(analysis('UNSUBMITTED_SHORT_AI'));
      assertPayload(shortCall, 'DRAFT_AI_SHORT_ANSWER', ['SAFE_Q1']);
      await h.page.locator(SEL.save).click();
      await ready(h);
      assert.equal(await h.page.locator('#p-self-right').count(), 0, 'Saving AI must not start self-assessment.');
      assert.equal((await snapshot(h.page)).practice.answered, 0);
      assert.equal(await h.page.locator('#practice-card .text-answer').inputValue(), 'DRAFT_AI_SHORT_ANSWER');
      await h.jump(0);
      assert(await h.page.locator('#practice-card .option[data-key="B"] input').isChecked());
    },
  })),
  {
    name: 'practice-review-ai-total-settings-preserves-draft', options: { configured: false },
    async run(h) {
      await startTotal(h);
      await h.page.locator('#practice-card .option[data-key="B"]').click();
      const before = await snapshot(h.page);
      await h.page.locator(SEL.open).click();
      await h.page.locator(SEL.settings).click();
      await h.page.locator('#ai-endpoint-v99').waitFor({ state: 'visible' });
      assert.deepEqual((await snapshot(h.page)).practice, before.practice);
      await h.page.locator('#ai-endpoint-v99').fill(MOCK_ENDPOINT);
      await h.page.locator('#ai-model-v99').fill(MODEL);
      await h.page.locator('#ai-api-key-v99').fill(FAKE_KEY);
      await h.page.locator('#ai-save-settings-v99').click();
      await ready(h);
      await h.page.locator('.nav[data-view="practice"]').click();
      await h.page.locator('#p-submit-all').waitFor();
      assert(await h.page.locator('#practice-card .option[data-key="B"] input').isChecked());
      assert.deepEqual((await snapshot(h.page)).records, before.records);
      assert.equal(h.mock.calls.length, 0);
      await h.page.locator('#practice-resume').click();
      await h.generate(analysis('AI_AFTER_SETTINGS'), { regenerate: true });
      assert.equal((await snapshot(h.page)).practice.answered, 0);
    },
  },
  {
    name: 'practice-review-ai-wrong-overview',
    async run(h) {
      await startTotal(h);
      await h.page.locator('#practice-card .option[data-key="B"]').click();
      await h.jump(2);
      await h.page.locator('.multi-blank-answer-input-v58914').nth(0).fill('one');
      await h.page.locator('.multi-blank-answer-input-v58914').nth(1).fill('wrong');
      await h.page.locator('#p-submit-all').click();
      await h.page.locator('#again-practice').waitFor();
      const overview = h.page.locator('#p-wrong-overview');
      await overview.waitFor();
      assert.equal(await overview.locator('[data-wrong-question-index]').count(), 5);
      const first = overview.locator('[data-wrong-question-index="0"]');
      assert.match(await first.innerText(), /SAFE_Q1/);
      assert.equal(await first.locator('.review-answer-wrong .review-answer-value').innerText(), 'B');
      assert.equal(await first.locator('.review-answer-correct .review-answer-value').innerText(), 'A');
      assert.equal(await first.locator('.option.wrong .option-text').innerText(), '5');
      assert.equal(await first.locator('.option.correct .option-text').innerText(), '4');
      assert.match(await first.locator('.review-answer-wrong').innerText(), /当时错误答案/);
      assert.match(await first.locator('.option[data-key="B"] .review-option-status').innerText(), /当时选择/);
      assert.match(await first.locator('.option[data-key="A"] .review-option-status').innerText(), /正确答案/);
      assert.match(await overview.locator('[data-wrong-question-index="1"]').innerText(), /未作答/);
      assert.match(await overview.locator('[data-wrong-question-index="2"]').innerText(), /wrong/);
      assert.match(await overview.locator('[data-wrong-question-index="2"]').innerText(), /2 \/ two/);
      assert.equal(await overview.locator('input,textarea').count(), 0);
    },
  },
  {
    name: 'submit-modes-total-drafts-and-subjective',
    async run(h) {
      const sidebarBefore = await h.page.locator('body').evaluate(body => body.classList.contains('side-collapsed'));
      await startTotal(h);
      const before = await snapshot(h.page);
      await h.page.locator('#practice-card .option[data-key="A"]').click();
      await h.jump(2);
      const blanks = h.page.locator('.multi-blank-answer-input-v58914');
      await blanks.nth(0).fill('one');
      await blanks.nth(1).fill('two');
      await h.jump(3);
      await h.page.locator('#practice-card .text-answer').fill('A controlled response.');
      await h.jump(0);
      assert(await h.page.locator('.option[data-key="A"] input').isChecked());
      assert.equal(await h.page.locator('#p-submit, #p-reveal').count(), 0);
      assert(await h.page.locator(SEL.open).isVisible());
      assert(await h.page.locator('#p-edit-v120').isDisabled());
      await h.page.keyboard.press('v');
      assert.equal((await snapshot(h.page)).practice.answered, 0);
      assert.deepEqual((await snapshot(h.page)).records, before.records);
      await h.page.locator('#p-submit-all').click();
      await h.page.locator('#p-self-right').waitFor();
      assert(await h.page.locator('#practice-card .text-answer').isDisabled());
      await h.page.locator('.nav[data-view="records"]').dispatchEvent('click');
      assert(await h.page.locator('#p-self-right').isVisible());
      await h.page.locator('#p-self-right').click();
      await h.page.locator('#again-practice').waitFor();
      const after = await snapshot(h.page);
      assert.equal(after.records.length, before.records.length + 1);
      assert.equal(after.records[0].answered, 5);
      assert.equal(after.records[0].correct, 3);
      assert.equal(after.records[0].wrong, 2);
      assert.equal(after.records[0].details.length, 5);
      assert.equal(h.mock.calls.length, 0);
      await h.page.locator('#again-practice').click();
      await h.page.locator('#p-submit-all').waitFor();
      assert.equal((await snapshot(h.page)).practice.answered, 0);
      await h.page.locator('#p-exit').click();
      await h.page.locator('#start-practice-btn').waitFor({ state: 'visible' });
      assert.equal(await h.page.locator('body').evaluate(body => body.classList.contains('side-collapsed')), sidebarBefore);
    },
  },
  {
    name: 'submit-modes-cancel-and-discard',
    async run(h) {
      await startTotal(h);
      const before = await snapshot(h.page);
      h.page.removeAllListeners('app-dialog');
      h.page.on('app-dialog', dialog => dialog.dismiss());
      await h.page.locator('#p-submit-all').click();
      await h.page.locator('.option[data-key="A"]').click();
      await h.page.locator('#p-exit').click();
      assert(await h.page.locator('#p-submit-all').isVisible());
      h.page.removeAllListeners('app-dialog');
      h.page.on('app-dialog', dialog => dialog.accept());
      await h.page.locator('#p-exit').click();
      await h.page.locator('#start-practice-btn').waitFor({ state: 'visible' });
      const after = await snapshot(h.page);
      assert.deepEqual(after.records, before.records);
      assert.deepEqual(after.wrongBook, before.wrongBook);
      assert.deepEqual(after.progress, before.progress);
    },
  },
  {
    name: 'submit-modes-save-retry-no-duplicate',
    async run(h) {
      await startTotal(h);
      await h.page.locator('.option[data-key="A"]').click();
      await h.jump(3);
      await h.page.locator('#practice-card .text-answer').fill('Self-assessed wrong answer.');
      const before = await snapshot(h.page);
      await h.page.evaluate(key => {
        const original = Storage.prototype.setItem;
        window.__restoreSubmitStorage = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function(name, value) {
          if (name === key) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
          return original.call(this, name, value);
        };
      }, h.keys.state);
      await h.page.locator('#p-submit-all').evaluate(button => { button.click(); button.click(); });
      await h.page.locator('#p-self-wrong').evaluate(button => { button.click(); button.click(); });
      await h.page.locator('#platform-status.failed button').waitFor();
      await ready(h);
      const failed = await snapshot(h.page);
      assert.deepEqual(failed.records, before.records);
      assert.deepEqual(failed.wrongBook, before.wrongBook);
      assert.equal(failed.practice.answered, 0);
      await h.page.evaluate(() => window.__restoreSubmitStorage());
      await h.page.locator('#platform-status button').click();
      await h.page.locator('#again-practice').waitFor();
      const after = await snapshot(h.page);
      assert.equal(after.records.length, before.records.length + 1);
      assert.equal(after.records[0].correct, 1);
      assert.equal(after.records[0].wrong, 4);
      assert.equal(after.records[0].details.length, 5);
    },
  },
];

module.exports = { cases };
