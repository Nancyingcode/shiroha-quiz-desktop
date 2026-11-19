import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('../../web/platform/contracts.d.ts').Snapshot} Snapshot */
/** @typedef {import('../../web/platform/contracts.d.ts').Bank} Bank */
/** @typedef {(page: Page) => Promise<Snapshot>} ReadSnapshot */
/** @typedef {{invoke(command: string, args?: Record<string, unknown>): Promise<unknown>}} NativeHost */
/** @typedef {typeof globalThis & {ShirohaDesktopHost?: NativeHost}} TestGlobal */
/** @typedef {{kind: 'details', bankId: string, ids: string[]} | {kind: 'write'}} Call */

const PAGE_SIZE = 10;
const DUPLICATE_INDEX = 11;

/** @param {string} id @param {string} name @param {number} size */
function fixtureBank(id, name, size) {
  const stamp = '2026-10-23T00:00:00.000Z';
  return {
    id,
    name,
    groupName: '第六批自建样本',
    createdAt: stamp,
    updatedAt: stamp,
    questions: Array.from({ length: size }, (_, i) => ({
      id: `q${i + 1}`,
      number: i + 1,
      type: 'single',
      question: `${name} 正文 ${i + 1}`,
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
      answer: [i % 2 ? 'B' : 'A'],
      analysis: `${name} 解析 ${i + 1}`,
      extension: { order: i + 1, bank: id },
    })),
  };
}

/** @param {Page} page @param {Bank} bank */
async function openBanks(page, bank) {
  await page.locator('.nav[data-view="banks"]').click();
  const rows = page.locator('#bank-preview tbody tr');
  await rows.first().getByText(bank.questions[0].question, { exact: true }).waitFor();
  assert.equal(await rows.count(), PAGE_SIZE);
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
async function readAfterReload(page, readSnapshot) {
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  return readSnapshot(page);
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
async function setupFixture(page, readSnapshot) {
  const target = fixtureBank('ops-target', '第六批目标库', 13);
  const source = fixtureBank('ops-source', '第六批来源库', 14);
  const other = fixtureBank('ops-other', '第六批备用库', 12);
  // 三个题库共享题号 ID，重复题放在未显示的页里以验证实际正文参与比较。
  target.questions[DUPLICATE_INDEX].question = `${target.questions[1].question}？`;
  target.questions[12].question = '共享 题干。';
  source.questions[12].question = '共享题干！';
  await page.evaluate(async ({ banks, operationId }) => {
    const host = (/** @type {TestGlobal} */ (globalThis)).ShirohaDesktopHost;
    if (!host) { throw new Error('本地桥接缺失'); }
    const { revision } = /** @type {{revision: number}} */ (await host.invoke('local_initialize'));
    await host.invoke('local_replace', {
      operationId,
      expectedRevision: revision,
      snapshot: {
        schemaVersion: 1,
        banks,
        activeBankId: banks[0].id,
        settings: {},
        favorites: {},
        wrongBook: {},
        records: [],
        crossPlatformMeta: {},
      },
    });
  }, { banks: [target, source, other], operationId: randomUUID() });
  const snapshot = await readAfterReload(page, readSnapshot);
  await openBanks(page, snapshot.banks[0]);
  return snapshot;
}

/** @param {Page} page @param {{holdBank?: string, failWrite?: boolean}} [options] */
async function traceOperations(page, options = {}) {
  await page.evaluate(({ holdBank, failWrite }) => {
    const host = (/** @type {TestGlobal} */ (globalThis)).ShirohaDesktopHost;
    if (!host) { throw new Error('本地桥接缺失'); }
    const callNative = host.invoke;
    const trace = { calls: /** @type {Call[]} */ ([]), release: /** @type {(() => void) | null} */ (null) };
    Reflect.set(globalThis, '__bankOperationTrace', trace);
    let held = false;
    let rejectWrite = failWrite;
    // 记录 IPC 返回的正文。写入顺序以真正调用 SQLite 提交为准。
    host.invoke = async (command, args) => {
      if (command === 'local_commit' || command === 'local_write') {
        trace.calls.push({ kind: 'write' });
        if (rejectWrite) {
          rejectWrite = false;
          throw new Error('模拟题库操作保存失败');
        }
      }

      const result = await callNative(command, args);
      const query = /** @type {{kind: string, collection: string, bank_id: string, ids: string[]} | undefined} */ (args?.query);
      if (command === 'local_query' && query?.kind === 'details' && query.collection === 'questions') {
        if (!held && holdBank === query.bank_id) {
          held = true;
          await new Promise((resolve) => {
            trace.release = () => resolve(undefined);
          });
        }

        trace.calls.push({ kind: 'details', bankId: query.bank_id, ids: query.ids });
      }

      return result;
    };
  }, options);
}

/** @param {Page} page @param {Record<string, string[]>} expected */
async function expectReadsBeforeWrite(page, expected) {
  const calls = /** @type {Call[]} */ (await page.evaluate(() => Reflect.get(globalThis, '__bankOperationTrace').calls));
  const write = calls.findIndex((call) => call.kind === 'write');
  assert(write >= 0, '题库操作没有提交 SQLite 写入');
  assert.equal(calls.filter((call) => call.kind === 'write').length, 1);
  const reads = calls.slice(0, write).filter((call) => call.kind === 'details');
  assert.deepEqual(reads, Object.entries(expected).map(([bankId, ids]) => ({ kind: 'details', bankId, ids })));
}

/** @param {Bank} bank @param {number} [start] */
function questionIds(bank, start = 0) {
  return bank.questions.slice(start).map((question) => question.id);
}

/** @param {import('../../web/platform/contracts.d.ts').Question} question */
function questionContent({
  type,
  question,
  options,
  answer,
  analysis,
  extension,
}) {
  return { type, question, options, answer, analysis, extension };
}

/** @param {Page} page @param {string} text */
async function acceptDialog(page, text) {
  await page.locator('#app-dialog-message').filter({ hasText: text }).waitFor();
  await page.locator('#app-dialog [data-dialog-accept]').click();
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot @param {boolean} card */
async function copyBank(page, readSnapshot, card) {
  const before = await setupFixture(page, readSnapshot);
  const bank = before.banks[card ? 1 : 0];
  await traceOperations(page);
  if (card) {
    const button = page.locator(`[data-copybank="${bank.id}"]`);
    await page.locator('.bank-item').filter({ has: button }).locator('summary').click();
    await button.click();
  } else {
    await page.locator('#duplicate-bank-btn').click();
  }

  await page.locator('#active-bank-select option').filter({ hasText: `${bank.name} - 副本` }).waitFor({ state: 'attached' });
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await expectReadsBeforeWrite(page, { [bank.id]: questionIds(bank, card ? 0 : PAGE_SIZE) });
  const after = await readAfterReload(page, readSnapshot);
  const copy = after.banks.find((item) => item.id === after.activeBankId);
  assert(copy);
  assert(!before.banks.some((item) => item.id === copy.id));
  assert.equal(copy.name, `${bank.name} - 副本`);
  assert.equal(copy.groupName, bank.groupName);
  assert.deepEqual(after.settings.practiceScope, { type: 'bank', value: copy.id });
  assert.deepEqual(after.banks.filter((item) => item.id !== copy.id), before.banks);
  assert.deepEqual(copy.questions.map(questionContent), bank.questions.map(questionContent));
  const originalIds = new Set(before.banks.flatMap((item) => questionIds(item)));
  assert(copy.questions.every((question) => !originalIds.has(question.id)));
  assert.equal(new Set(questionIds(copy)).size, copy.questions.length);
  assert.deepEqual(copy.questions.map((question) => question.number), bank.questions.map((question) => question.number));
  return copy.questions.length;
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function bankContentOperationsSmoke(page, readSnapshot) {
  const copied = await copyBank(page, readSnapshot, false);
  const copiedFromCard = await copyBank(page, readSnapshot, true);
  const before = await setupFixture(page, readSnapshot);
  const [target, source] = before.banks;
  await page.locator('#merge-bank-select').selectOption(source.id);
  await traceOperations(page);
  await page.locator('#merge-bank-btn').click();
  await acceptDialog(page, `将“${source.name}”`);
  await acceptDialog(page, '新增 13 题，跳过重复 1 题');
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await expectReadsBeforeWrite(page, {
    [target.id]: questionIds(target, PAGE_SIZE),
    [source.id]: questionIds(source),
  });
  const after = await readAfterReload(page, readSnapshot);
  const merged = after.banks[0];
  assert.equal(after.activeBankId, target.id);
  assert.deepEqual(after.banks.slice(1), before.banks.slice(1));
  assert.deepEqual(merged.questions.slice(0, target.questions.length), target.questions);
  const added = merged.questions.slice(target.questions.length);
  assert.deepEqual(added.map(questionContent), source.questions.filter((_, i) => i !== 12).map(questionContent));
  assert.deepEqual(added.map((question) => question.number), added.map((_, i) => target.questions.length + i + 1));
  assert(added.every((question) => !questionIds(source).includes(question.id)));
  assert.equal(new Set(questionIds(merged)).size, merged.questions.length);
  return { copied, copiedFromCard, merged: merged.questions.length };
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function changedMergeSourceSmoke(page, readSnapshot) {
  const before = await setupFixture(page, readSnapshot);
  const [, source, other] = before.banks;
  const input = page.locator('#merge-bank-select');
  await input.selectOption(source.id);
  await traceOperations(page, { holdBank: source.id });
  await page.locator('#merge-bank-btn').click();
  await page.waitForFunction(() => typeof Reflect.get(globalThis, '__bankOperationTrace')?.release === 'function');
  await input.selectOption(other.id);
  await page.evaluate(() => Reflect.get(globalThis, '__bankOperationTrace').release());
  const message = await page.locator('#app-dialog-message').innerText();
  const changed = '合并的题库已变化，请重新确认。';
  if (message !== changed) {
    await page.locator('#app-dialog [data-dialog-cancel]').click();
  }

  assert.equal(message, changed);
  await acceptDialog(page, changed);
  await page.locator('body[data-storage-state="ready"]').waitFor();
  const calls = /** @type {Call[]} */ (await page.evaluate(() => Reflect.get(globalThis, '__bankOperationTrace').calls));
  assert(!calls.some((call) => call.kind === 'write'));
  assert.deepEqual(await readSnapshot(page), before);
  return { unchangedAfterSwitch: true };
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function dedupeRetrySmoke(page, readSnapshot) {
  const before = await setupFixture(page, readSnapshot);
  const [target] = before.banks;
  const ready = page.locator('body[data-storage-state="ready"]');
  await traceOperations(page, { failWrite: true });
  await page.locator('#dedupe-btn').click();
  await page.locator('#platform-status.failed').waitFor();
  await ready.waitFor();
  await expectReadsBeforeWrite(page, { [target.id]: questionIds(target, PAGE_SIZE) });
  assert.deepEqual(await readSnapshot(page), before);
  await page.locator('.nav[data-view="dashboard"]').click();
  await openBanks(page, target);
  await page.evaluate(() => {
    Reflect.get(globalThis, '__bankOperationTrace').calls.length = 0;
  });
  await page.locator('#platform-status').getByRole('button', { name: '重试' }).click();
  await acceptDialog(page, '去重完成');
  await ready.waitFor();
  const after = await readSnapshot(page);
  const expected = target.questions.filter((_, i) => i !== DUPLICATE_INDEX).map((question, i) => ({
    ...question, number: i + 1,
  }));
  assert.deepEqual(questionIds(after.banks[0]), expected.map((question) => question.id));
  await expectReadsBeforeWrite(page, { [target.id]: questionIds(target, PAGE_SIZE) });
  const reloaded = await readAfterReload(page, readSnapshot);
  assert.equal(reloaded.activeBankId, target.id);
  assert.deepEqual(reloaded.banks[0].questions, expected);
  assert.deepEqual(reloaded.banks.slice(1), before.banks.slice(1));
  return { preservedAfterReload: expected.length };
}
