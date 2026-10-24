'use strict';

const assert = require('node:assert/strict');
const { snapshot } = require('./harness.cjs');

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
  {
    name: 'submit-modes-total-drafts-and-subjective',
    async run(h) {
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
      assert.equal(await h.page.locator('#p-submit, #p-reveal, #p-ai-v613 button').count(), 0);
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
    },
  },
  {
    name: 'submit-modes-cancel-and-discard',
    async run(h) {
      await startTotal(h);
      const before = await snapshot(h.page);
      h.page.removeAllListeners('dialog');
      h.page.on('dialog', dialog => dialog.dismiss());
      await h.page.locator('#p-submit-all').click();
      await h.page.locator('.option[data-key="A"]').click();
      await h.page.locator('#p-exit').click();
      assert(await h.page.locator('#p-submit-all').isVisible());
      h.page.removeAllListeners('dialog');
      h.page.on('dialog', dialog => dialog.accept());
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
