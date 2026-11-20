import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('../../web/platform/contracts.d.ts').Snapshot} Snapshot */
/** @typedef {import('../../web/platform/contracts.d.ts').Bank} Bank */
/** @typedef {(page: Page) => Promise<Snapshot>} ReadSnapshot */
/** @typedef {{invoke(command: string, args?: Record<string, unknown>): Promise<unknown>}} NativeHost */
/** @typedef {typeof globalThis & {ShirohaDesktopHost?: NativeHost}} TestGlobal */
/** @typedef {{kind: 'details' | 'read-failure', bankId: string, ids: string[]} | {kind: 'write'}} Call */
/** @typedef {{kind: string, collection?: string, bank_id?: string, ids?: string[]}} ExportQuery */
/** @typedef {{name: string, bytes: number[], finished: boolean}} ExportFile */
/** @typedef {{kind: string, name?: string, token?: string, bytes?: number[], offset?: number, size?: number}} ExportRequest */

const PAGE_SIZE = 10;
const DUPLICATE_INDEX = 11;
const EXPORT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const EXPORT_IMAGE = `data:image/png;base64,${EXPORT_PNG}`;

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

/** @param {Page} page @param {Snapshot} snapshot */
async function replaceFixture(page, snapshot) {
  await page.evaluate(async ({ json, operationId }) => {
    const host = (/** @type {TestGlobal} */ (globalThis)).ShirohaDesktopHost;
    if (!host) { throw new Error('本地桥接缺失'); }
    const { revision } = /** @type {{revision: number}} */ (await host.invoke('local_initialize'));
    await host.invoke('local_replace', { operationId, expectedRevision: revision, snapshot: JSON.parse(json) });
  }, { json: JSON.stringify(snapshot), operationId: randomUUID() });
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
  await replaceFixture(page, {
    schemaVersion: 1,
    banks: [target, source, other],
    activeBankId: target.id,
    settings: {},
    favorites: {},
    wrongBook: {},
    records: [],
    crossPlatformMeta: {},
  });
  const snapshot = await readAfterReload(page, readSnapshot);
  await openBanks(page, snapshot.banks[0]);
  return snapshot;
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
async function setupExportFixture(page, readSnapshot) {
  const banks = [
    fixtureBank('export-a', '导出甲库', 13),
    fixtureBank('export-b', '导出乙库', 14),
    fixtureBank('export-c', '导出未选库', 12),
  ];
  for (const bank of banks) {
    // 图片落在末页，确保导出实际经过 SQLite 的媒体水合。
    Object.assign(bank.questions[0], { images: [] });
    Object.assign(bank.questions.at(-1) || {}, {
      images: [{ id: 'pixel', dataUrl: EXPORT_IMAGE, sourceName: 'pixel.png' }],
    });
  }

  const [first, second] = banks;
  await replaceFixture(page, {
    schemaVersion: 1,
    banks,
    activeBankId: banks[0].id,
    settings: { suppressDefaultBank: false, aiImportV99: { provider: 'custom', rememberKey: false } },
    favorites: { [second.id]: ['q2'] },
    wrongBook: { [first.id]: [{ id: 'q2', wrongCount: 3, lastAnswer: ['A'], status: '未掌握' }] },
    records: [{
      id: 'export-record',
      mode: '练习',
      name: '导出历史成绩',
      bankId: first.id,
      bankName: '删除后保留的题库名称',
      date: banks[0].createdAt,
      total: 1,
      correct: 1,
      details: [{ question: '记录中仍可读取的历史题干', type: 'single', answer: ['A'], chosen: ['A'], correct: true }],
    }],
    crossPlatformMeta: {
      favoriteQuestions: { [second.id]: { q2: { favoritedAt: 1792713600000, extension: { source: 'restore-fixture' } } } },
    },
  });
  return readAfterReload(page, readSnapshot);
}

/** @param {Page} page */
async function captureExportFiles(page) {
  await page.evaluate(() => {
    const { ShirohaDesktopHost: host } = /** @type {TestGlobal} */ (globalThis);
    if (!host) { throw new Error('本地桥接缺失'); }

    const callNative = host.invoke;
    const files = /** @type {ExportFile[]} */ ([]);
    const queries = /** @type {ExportQuery[]} */ ([]);
    const grants = new Map();
    Reflect.set(globalThis, '__nativeExportTrace', { files, queries });
    // 测试宿主替代交互式保存授权，接收真实桌面适配器输出的文件名与分块字节。
    host.invoke = (command, args) => {
      const query = /** @type {ExportQuery | undefined} */ (args?.query);
      if (command === 'local_query' && query && ['details', 'hydrate'].includes(query.kind)) {
        const {
          kind,
          collection,
          bank_id: bankId,
          ids,
        } = query;
        queries.push({ kind, collection, bank_id: bankId, ids });
      }

      if (command !== 'local_file') {
        return callNative(command, args);
      }

      const request = /** @type {ExportRequest} */ (args?.request);
      if (request.kind === 'choose_export') {
        const token = `export-fixture-${files.length}`;
        const file = { name: request.name || '', bytes: [], finished: false };
        files.push(file);
        grants.set(token, { file, finalized: false });
        return Promise.resolve({ token });
      }

      const grant = grants.get(request.token);
      if (!grant) {
        return callNative(command, args);
      }

      const { file } = grant;
      if (request.kind === 'append') {
        if (file.bytes.length !== request.offset) { throw new Error('文件分块位置不连续'); }
        file.bytes = file.bytes.concat(request.bytes);
      } else if (request.kind === 'finish') {
        if (file.bytes.length !== request.size) { throw new Error('实际导出长度与声明不同'); }
        grant.finalized = true;
      } else if (request.kind === 'release') {
        file.finished = grant.finalized;
        grants.delete(request.token);
      }

      return Promise.resolve(null);
    };
  });
}

/** @param {Page} page */
function exportCapture(page) {
  return /** @type {Promise<{files: ExportFile[], queries: ExportQuery[]}>} */ (page.evaluate(
    () => Reflect.get(globalThis, '__nativeExportTrace'),
  ));
}

/** @param {Page} page @param {import('playwright-core').Locator} button */
async function exportFile(page, button) {
  await button.click();
  await page.waitForFunction(() => Reflect.get(globalThis, '__nativeExportTrace').files[0]?.finished);
  const { files, queries } = await exportCapture(page);
  assert.equal(files.length, 1);
  const [{ name, bytes }] = files;
  await page.evaluate(() => {
    const { files: capturedFiles, queries: capturedQueries } = Reflect.get(globalThis, '__nativeExportTrace');
    capturedFiles.length = 0;
    capturedQueries.length = 0;
  });
  return { name, bytes, queries };
}

/** 从真实下载入口获取用于恢复对照的同一份多页样本。
 * @param {Page} page @param {ReadSnapshot} readSnapshot
 */
export async function captureBackupRestoreFixture(page, readSnapshot) {
  const source = await setupExportFixture(page, readSnapshot);
  await page.locator('.nav[data-view="settings"]').click();
  await captureExportFiles(page);
  const json = await exportFile(page, page.locator('#export-all-btn'));
  const zip = await exportFile(page, page.locator('#settings-export-native-backup-v611'));
  const existing = fixtureBank('restore-existing', '恢复前的题库', 12);
  const resetTarget = async () => {
    await replaceFixture(page, {
      schemaVersion: 1,
      banks: [existing],
      activeBankId: existing.id,
      settings: { suppressDefaultBank: true },
      favorites: {},
      wrongBook: {},
      records: [{ id: 'restore-existing-record', mode: '练习', name: '恢复前的记录' }],
      crossPlatformMeta: {},
    });
    return readAfterReload(page, readSnapshot);
  };
  return { source, json, zip, resetTarget };
}

/** @param {Bank} bank @param {number} [start] */
function exportBankQuery(bank, start = 0) {
  return { kind: 'details', collection: 'questions', bank_id: bank.id, ids: questionIds(bank, start) };
}

/** @param {Snapshot} snapshot */
function exportRecordQuery(snapshot) {
  return { kind: 'details', collection: 'records', bank_id: '', ids: snapshot.records.map((record) => record.id) };
}

/** @param {Bank} exported @param {Bank} bank */
function assertExportedBank(exported, bank) {
  assert.equal(exported.id, bank.id);
  assert.equal(exported.name, bank.name);
  assert.deepEqual(questionIds(exported), questionIds(bank));
  assert.deepEqual(exported.questions.map(questionContent), bank.questions.map((question) => ({
    ...questionContent(question), type: 'SINGLE',
  })));
  assert.deepEqual(exported.questions[0].images, []);
  assert.equal(Object.hasOwn(exported.questions[1], 'images'), false);
}

/** @param {Bank} bank */
function firstExportedImage(bank) {
  return /** @type {{dataUrl?: string, localPath?: string}[] | undefined} */ (bank.questions.at(-1)?.images)?.[0];
}

/** @param {Page} page @param {{holdBank?: string, failWrite?: boolean, failReadBank?: string}} [options] */
async function traceOperations(page, options = {}) {
  await page.evaluate(({ holdBank, failWrite, failReadBank }) => {
    const host = (/** @type {TestGlobal} */ (globalThis)).ShirohaDesktopHost;
    if (!host) { throw new Error('本地桥接缺失'); }
    const callNative = host.invoke;
    const trace = { calls: /** @type {Call[]} */ ([]), release: /** @type {(() => void) | null} */ (null) };
    Reflect.set(globalThis, '__bankOperationTrace', trace);
    let held = false;
    let rejectWrite = failWrite;
    let rejectReadFor = failReadBank;
    // 记录 IPC 返回的正文。写入顺序以真正调用 SQLite 提交为准。
    host.invoke = async (command, args) => {
      if (command === 'local_commit' || command === 'local_write') {
        trace.calls.push({ kind: 'write' });
        if (rejectWrite) {
          rejectWrite = false;
          throw new Error('模拟题库操作保存失败');
        }
      }

      const query = /** @type {{kind: string, collection: string, bank_id: string, ids: string[]} | undefined} */ (args?.query);
      const isQuestionRead = command === 'local_query' && query?.kind === 'details' && query.collection === 'questions';
      if (isQuestionRead && query.bank_id === rejectReadFor) {
        rejectReadFor = undefined;
        trace.calls.push({ kind: 'read-failure', bankId: query.bank_id, ids: query.ids });
        throw new Error('模拟试题正文读取失败');
      }

      const result = await callNative(command, args);
      if (isQuestionRead) {
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

/** @param {Page} page */
function operationCalls(page) {
  return /** @type {Promise<Call[]>} */ (page.evaluate(() => Reflect.get(globalThis, '__bankOperationTrace').calls));
}

/** @param {Page} page @param {Record<string, string[]>} expected */
async function expectReadsBeforeWrite(page, expected) {
  const calls = await operationCalls(page);
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

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function bankExportScopeSmoke(page, readSnapshot) {
  const before = await setupExportFixture(page, readSnapshot);
  const [active, other] = before.banks;
  const revision = await localRevision(page);
  await openBanks(page, active);
  await captureExportFiles(page);

  const card = page.locator(`[data-exportbank="${other.id}"]`);
  await page.locator('.bank-item').filter({ has: card }).locator('summary').click();
  const cardFile = await exportFile(page, card);
  assert.equal(cardFile.name, `${other.name}.json`);
  assert.deepEqual(cardFile.queries, [exportBankQuery(other)]);
  const cardBank = JSON.parse(Buffer.from(cardFile.bytes).toString('utf8'));
  assertExportedBank(cardBank, other);
  assert.equal(firstExportedImage(cardBank)?.dataUrl, EXPORT_IMAGE);

  const activeFile = await exportFile(page, page.locator('#export-json-btn'));
  assert.equal(activeFile.name, `${active.name}.json`);
  assert.deepEqual(activeFile.queries, [exportBankQuery(active, PAGE_SIZE)]);
  const activeBank = JSON.parse(Buffer.from(activeFile.bytes).toString('utf8'));
  assertExportedBank(activeBank, active);
  assert.equal(firstExportedImage(activeBank)?.dataUrl, EXPORT_IMAGE);

  await readAfterReload(page, readSnapshot);
  await openBanks(page, active);
  await page.locator('#export-bank-current-v23').click();
  await page.locator(`[data-bank-bulk-v23="${other.id}"]`).check();
  await captureExportFiles(page);
  const bulk = await exportFile(page, page.locator('#export-selected-banks-v23'));
  assert.match(bulk.name, /^shiroha-quiz-question-banks-\d{4}-\d{2}-\d{2}\.json$/);
  assert.deepEqual(bulk.queries, [exportBankQuery(active, PAGE_SIZE), exportBankQuery(other)]);
  const selection = JSON.parse(Buffer.from(bulk.bytes).toString('utf8'));
  assert.equal(selection.exportType, 'question_banks');
  assert.equal(selection.banks.length, 2);
  assertExportedBank(selection.banks[0], active);
  assertExportedBank(selection.banks[1], other);
  assert.equal(firstExportedImage(selection.banks[1])?.dataUrl, EXPORT_IMAGE);
  assert.equal(Object.hasOwn(selection, 'records'), false);
  assert.equal(Object.hasOwn(selection, 'settings'), false);

  await page.locator('.nav[data-view="records"]').click();
  const records = await exportFile(page, page.locator('#export-records-btn'));
  assert.equal(records.name, '学习记录.json');
  assert.deepEqual(records.queries, [exportRecordQuery(before)]);
  assert.deepEqual(JSON.parse(Buffer.from(records.bytes).toString('utf8')), before.records);
  assert.equal(await localRevision(page), revision);
  assert.deepEqual(await readAfterReload(page, readSnapshot), before);
  return { selectedBanks: 2, scopedReads: true, records: before.records.length, originalPreserved: true };
}

/** @param {Page} page */
async function setExportPreviewSentinel(page) {
  await page.locator('#export-output').evaluate((element) => {
    /** @type {HTMLTextAreaElement} */ (element).value = '上一次导出';
  });
}

/** @param {Page} page */
async function assertNoExport(page) {
  assert.equal((await exportCapture(page)).files.length, 0);
  assert.equal(await page.locator('#export-output').inputValue(), '上一次导出');
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function bankExportChangesSmoke(page, readSnapshot) {
  const before = await setupExportFixture(page, readSnapshot);
  const [active, other] = before.banks;
  const revision = await localRevision(page);
  await openBanks(page, active);
  await traceOperations(page, { holdBank: active.id, failReadBank: other.id });
  await captureExportFiles(page);
  await setExportPreviewSentinel(page);

  const card = page.locator(`[data-exportbank="${other.id}"]`);
  await page.locator('.bank-item').filter({ has: card }).locator('summary').click();
  await card.click();
  await page.locator('#platform-status.failed').filter({
    hasText: '本地操作未完成，原数据已保留。请检查权限、空间或重新启动。',
  }).waitFor();
  await assertNoExport(page);
  assert.deepEqual(await operationCalls(page), [{ kind: 'read-failure', bankId: other.id, ids: questionIds(other) }]);

  await page.locator('#export-bank-current-v23').click();
  await page.locator('#export-selected-banks-v23').click();
  await page.waitForFunction(() => typeof Reflect.get(globalThis, '__bankOperationTrace')?.release === 'function');
  await page.locator(`[data-bank-bulk-v23="${other.id}"]`).check();
  await page.locator(`[data-bank-bulk-v23="${active.id}"]`).uncheck();
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /已选择 1 个题库/);
  await page.evaluate(() => Reflect.get(globalThis, '__bankOperationTrace').release());
  const changed = page.locator('#app-toast').getByText('导出目标已变化，请重新导出。', { exact: true });
  await changed.waitFor();
  await assertNoExport(page);
  assert.deepEqual((await operationCalls(page)).slice(1), [
    { kind: 'details', bankId: active.id, ids: questionIds(active, PAGE_SIZE) },
  ]);
  assert.equal(await localRevision(page), revision);

  await readAfterReload(page, readSnapshot);
  await openBanks(page, active);
  await traceOperations(page, { holdBank: active.id });
  await captureExportFiles(page);
  await setExportPreviewSentinel(page);
  await page.locator('#export-json-btn').click();
  await page.waitForFunction(() => typeof Reflect.get(globalThis, '__bankOperationTrace')?.release === 'function');
  await page.locator('#bank-current-select-v28').selectOption(other.id);
  await page.locator('body[data-storage-state="pending"]').waitFor();
  await page.evaluate(() => Reflect.get(globalThis, '__bankOperationTrace').release());
  await changed.waitFor();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await assertNoExport(page);
  assert.equal((await operationCalls(page)).filter((call) => call.kind === 'write').length, 1);
  assert.equal(await localRevision(page), revision + 1);
  const after = await readAfterReload(page, readSnapshot);
  assert.equal(after.activeBankId, other.id);
  assert.deepEqual(after.banks, before.banks);
  assert.deepEqual(after.records, before.records);
  return { failedReads: 1, cancelledAfterChange: 2, exports: 0, switchWrites: 1 };
}

/** @param {ExportQuery[]} queries @param {Snapshot} snapshot */
function assertFullBackupReads(queries, snapshot) {
  assert.deepEqual(queries.filter((query) => query.kind === 'details'), [
    ...snapshot.banks.map((bank) => exportBankQuery(bank)), exportRecordQuery(snapshot),
  ]);
  assert.equal(queries.filter((query) => query.kind === 'hydrate').length, 2);
}

/** @param {Page} page @param {number[]} bytes */
function readExportedZip(page, bytes) {
  return page.evaluate(async (content) => {
    const zip = Reflect.get(globalThis, 'ShirohaZip');
    const { buffer } = Uint8Array.from(content);
    const entries = /** @type {{name: string}[]} */ (zip.parseZipEntries(buffer));
    const manifest = entries.find((entry) => entry.name === 'backup.json');
    const asset = entries.find((entry) => entry.name.startsWith('assets/'));
    if (!manifest || !asset) { throw new Error('ZIP 缺少清单或媒体'); }
    return {
      payload: JSON.parse(await zip.unzipEntry(buffer, manifest)),
      asset: asset.name,
      media: Array.from(/** @type {Uint8Array} */ (await zip.unzipEntryBytes(buffer, asset))),
      assetCount: entries.filter((entry) => entry.name.startsWith('assets/')).length,
    };
  }, bytes);
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function fullBackupExportSmoke(page, readSnapshot) {
  const before = await setupExportFixture(page, readSnapshot);
  const revision = await localRevision(page);
  const settings = page.locator('.nav[data-view="settings"]');
  await settings.click();
  await captureExportFiles(page);
  const json = await exportFile(page, page.locator('#export-all-btn'));
  assert.match(json.name, /^shiroha-quiz-all-data-\d{4}-\d{2}-\d{2}\.json$/);
  assertFullBackupReads(json.queries, before);
  const full = JSON.parse(Buffer.from(json.bytes).toString('utf8'));
  assert.equal(full.exportType, 'all_data');
  assert.equal(full.banks.length, before.banks.length);
  before.banks.forEach((bank, index) => assertExportedBank(full.banks[index], bank));
  assert.equal(firstExportedImage(full.banks[0])?.dataUrl, EXPORT_IMAGE);
  assert.deepEqual(full.records, before.records);
  assert.equal(full.settings.suppressDefaultBank, false);
  assert.equal(full.settings.aiImportV99.rememberKey, false);

  await readAfterReload(page, readSnapshot);
  await settings.click();
  await captureExportFiles(page);
  const zip = await exportFile(page, page.locator('#settings-export-native-backup-v611'));
  assert.match(zip.name, /^shiroha-quiz-native-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  assertFullBackupReads(zip.queries, before);
  const archive = await readExportedZip(page, zip.bytes);
  assert.equal(archive.payload.kind, 'shiroha_quiz_web_native_backup');
  assert.equal(archive.payload.version, 3);
  assert.equal(archive.payload.banks.length, before.banks.length);
  before.banks.forEach((bank, index) => assertExportedBank(archive.payload.banks[index], bank));
  assert.equal(firstExportedImage(archive.payload.banks[0])?.localPath, archive.asset);
  assert.deepEqual(Buffer.from(archive.media), Buffer.from(EXPORT_PNG, 'base64'));
  assert.equal(archive.assetCount, 1);
  assert.equal(archive.payload.crossPlatform.studyRecords[0].id, before.records[0].id);
  assert.equal(
    archive.payload.crossPlatform.studyRecords[0].questionResults[0].question.question,
    '记录中仍可读取的历史题干',
  );

  await readAfterReload(page, readSnapshot);
  await settings.click();
  await captureExportFiles(page);
  await page.evaluate(() => Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (/** @type {string} */ text) => {
        Reflect.set(globalThis, '__fullBackupClipboard', text);
        return Promise.resolve();
      },
    },
  }));
  await page.locator('#settings-copy-all-backup-v23').click();
  await page.locator('#app-toast').getByText('已复制全部数据备份文本。', { exact: true }).waitFor();
  const copied = await page.evaluate(() => JSON.parse(Reflect.get(globalThis, '__fullBackupClipboard')));
  assert.deepEqual(copied.banks, full.banks);
  assert.deepEqual(copied.records, full.records);
  assert.deepEqual(copied.settings, full.settings);
  const { queries, files } = await exportCapture(page);
  assertFullBackupReads(queries, before);
  assert.equal(files.length, 0);
  assert.equal(await localRevision(page), revision);
  assert.deepEqual(await readAfterReload(page, readSnapshot), before);
  return { fullJson: true, zipAssets: archive.assetCount, copied: true, originalPreserved: true };
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot @param {Bank[]} [extraBanks] */
async function setupDeletionFixture(page, readSnapshot, extraBanks = []) {
  const target = {
    ...fixtureBank('delete-target', '待删题库', 23), groupName: '待删分组',
  };
  const other = {
    ...fixtureBank('delete-other', '旁库', 22), groupName: '旁库分组',
  };
  const references = ['q1', 'q13', 'q2'];
  await replaceFixture(page, {
    schemaVersion: 1,
    banks: [target, other, ...extraBanks],
    activeBankId: target.id,
    settings: { practiceScope: { type: 'group', value: target.groupName } },
    favorites: { [target.id]: references, [other.id]: ['q1'] },
    wrongBook: { [target.id]: references, [other.id]: ['q1'] },
    records: [{
      id: 'deleted-question-record',
      name: '历史成绩',
      bankName: target.name,
      mode: 'practice',
      date: target.createdAt,
      details: [{ question: target.questions[0].question, type: 'single', chosen: ['A'], answer: ['A'], correct: true }],
    }],
    crossPlatformMeta: {
      favoriteQuestions: {
        [target.id]: { q1: { favoritedAt: 1 }, q13: { favoritedAt: 2 }, q2: { favoritedAt: 3 } },
        [other.id]: { q1: { favoritedAt: 4 } },
      },
    },
  });
  const before = await readAfterReload(page, readSnapshot);
  await openBanks(page, target);
  return before;
}

/** @param {Page} page */
async function resetOperationCalls(page) {
  await page.evaluate(() => {
    Reflect.get(globalThis, '__bankOperationTrace').calls.length = 0;
  });
}

/** @param {Page} page */
async function localRevision(page) {
  return page.evaluate(async () => {
    const host = (/** @type {TestGlobal} */ (globalThis)).ShirohaDesktopHost;
    if (!host) { throw new Error('本地桥接缺失'); }
    const { revision } = /** @type {{revision: number}} */ (await host.invoke('local_initialize'));
    return revision;
  });
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function questionDeletionRetrySmoke(page, readSnapshot) {
  const before = await setupDeletionFixture(page, readSnapshot);
  const [target, other] = before.banks;
  const revision = await localRevision(page);
  const ready = page.locator('body[data-storage-state="ready"]');
  const status = page.locator('#platform-status');
  const preview = page.locator('#bank-preview-pager');
  await traceOperations(page, { failReadBank: target.id, failWrite: true });

  const deleteFirst = page.locator('[data-delete-bank-question="q1"]');
  await deleteFirst.click();
  await page.locator('#platform-status.failed').waitFor();
  assert.equal(await page.locator('#app-dialog').isVisible(), false);
  assert.deepEqual(await operationCalls(page), [
    { kind: 'read-failure', bankId: target.id, ids: questionIds(target, PAGE_SIZE) },
  ]);
  await deleteFirst.click();
  await page.locator('#app-dialog [data-dialog-cancel]').click();
  await ready.waitFor();
  assert(!(await operationCalls(page)).some((call) => call.kind === 'write'));
  assert.deepEqual(await readSnapshot(page), before);
  assert.equal(await localRevision(page), revision);

  await page.locator('[data-select-bank-question="q1"]').check();
  await preview.getByRole('button', { name: '下一页', exact: true }).click();
  await page.locator('[data-select-bank-question="q13"]').check();
  await preview.getByRole('button', { name: '上一页', exact: true }).click();
  await page.locator('[data-select-bank-question="q1"]').waitFor();
  await resetOperationCalls(page);
  await page.locator('#delete-selected-questions').click();
  await acceptDialog(page, '删除 2 道试题');
  await page.locator('#platform-status.failed').waitFor();
  await ready.waitFor();
  assert.equal((await operationCalls(page)).filter((call) => call.kind === 'write').length, 1);
  assert.deepEqual(await readSnapshot(page), before);
  assert.equal(await localRevision(page), revision);
  assert.equal(await page.locator('[data-select-bank-question="q1"]').isChecked(), true);

  await resetOperationCalls(page);
  await page.locator('.nav[data-view="dashboard"]').click();
  await page.locator('#dashboard.active').waitFor();
  await openBanks(page, target);
  assert.deepEqual(await operationCalls(page), [
    { kind: 'details', bankId: target.id, ids: questionIds(target).slice(0, PAGE_SIZE) },
  ]);
  await resetOperationCalls(page);
  await status.getByRole('button', { name: '重试' }).click();
  await acceptDialog(page, `从“${target.name}”删除 2 道试题`);
  await ready.waitFor();
  await page.locator('[data-select-bank-question="q1"]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#bank-question-selection').isVisible(), false);
  const calls = await operationCalls(page);
  const reloaded = await readAfterReload(page, readSnapshot);
  assert.equal(await localRevision(page), revision + 1);
  assert.deepEqual(reloaded.banks[0].questions, target.questions.filter((question) => !['q1', 'q13'].includes(question.id)));
  assert.deepEqual(reloaded.banks[1], other);
  assert.deepEqual(reloaded.records, before.records);
  assert.deepEqual(reloaded.favorites, { [target.id]: ['q2'], [other.id]: ['q1'] });
  assert.deepEqual(reloaded.crossPlatformMeta.favoriteQuestions, {
    [target.id]: { q2: { favoritedAt: 3 } }, [other.id]: { q1: { favoritedAt: 4 } },
  });
  const { wrongBook } = /** @type {Snapshot & {wrongBook: Record<string, {id: string}[]>}} */ (reloaded);
  assert.deepEqual(wrongBook[target.id].map(({ id }) => id), ['q2']);
  assert.deepEqual(wrongBook[other.id].map(({ id }) => id), ['q1']);
  assert.equal(calls.filter((call) => call.kind === 'write').length, 1);
  assert.deepEqual(calls.slice(0, calls.findIndex((call) => call.kind === 'write')), [
    { kind: 'details', bankId: target.id, ids: questionIds(target, PAGE_SIZE) },
  ], '离开题库页释放正文后，全局重试必须补读目标题库再写入');
  return { remaining: target.questions.length - 2, otherBank: other.questions.length, writes: 1 };
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function bankDeletionSmoke(page, readSnapshot) {
  const unselected = fixtureBank('delete-keep', '保留样本库', 12);
  const before = await setupDeletionFixture(page, readSnapshot, [unselected]);
  const [target, other, keep] = before.banks;
  const revision = await localRevision(page);
  const ready = page.locator('body[data-storage-state="ready"]');
  const targetCard = page.locator(`[data-delbank="${target.id}"]`);
  const deleteSelected = page.locator('#delete-selected-banks-v32');
  await traceOperations(page, { failWrite: true });
  await page.locator('#export-bank-current-v23').click();
  await targetCard.click();
  await page.locator('#app-dialog [data-dialog-cancel]').click();
  await ready.waitFor();
  assert.deepEqual(await operationCalls(page), []);
  assert.equal(await localRevision(page), revision);

  await targetCard.click();
  await acceptDialog(page, `“${target.name}”`);
  await page.locator('#platform-status.failed').waitFor();
  await ready.waitFor();
  assert.deepEqual(await readSnapshot(page), before);
  assert.equal(await localRevision(page), revision);
  // 反选两次重绘卡片，让断言读取回滚后的共享选择集合。
  const invert = page.locator('#export-bank-invert-v23');
  await invert.click();
  await invert.click();
  assert.equal(await page.locator('#bank-current-select-v28').inputValue(), target.id);
  assert.equal(await page.locator('.practice-group-active-v8916 .bank-group-head-v58 b').innerText(), '待删分组');
  assert.equal(await page.locator(`[data-bank-bulk-v23="${target.id}"]`).isChecked(), true);
  assert.equal(await page.locator(`[data-bank-bulk-v23="${other.id}"]`).isChecked(), false);
  assert.match(await page.locator('#export-bank-summary-v23').innerText(), /已选择 1 个题库/);

  await page.locator('#platform-status').getByRole('button', { name: '重试' }).click();
  await acceptDialog(page, `“${target.name}”`);
  await ready.waitFor();
  await targetCard.waitFor({ state: 'detached' });
  assert.match(await page.locator('#app-toast').innerText(), /原练习分组已无题库/);
  const afterCard = await readSnapshot(page);
  assert.deepEqual(afterCard.banks, [other, keep]);
  assert.deepEqual(afterCard.records, before.records);
  assert.equal(afterCard.activeBankId, other.id);
  assert.deepEqual(afterCard.settings.practiceScope, { type: 'bank', value: other.id });
  assert.deepEqual(Object.keys(afterCard.wrongBook), [other.id]);
  assert.deepEqual(Object.keys(afterCard.favorites), [other.id]);
  assert.deepEqual(afterCard.crossPlatformMeta.favoriteQuestions, { [other.id]: { q1: { favoritedAt: 4 } } });
  assert.equal(await localRevision(page), revision + 1);

  await page.locator('#export-bank-current-v23').click();
  await deleteSelected.click();
  await acceptDialog(page, `“${other.name}”`);
  await ready.waitFor();
  const afterBatch = await readSnapshot(page);
  assert.deepEqual(afterBatch.banks, [keep]);
  assert.deepEqual(afterBatch.records, before.records);
  await page.locator('#export-bank-all-v23').check();
  await deleteSelected.click();
  await acceptDialog(page, `“${keep.name}”`);
  await ready.waitFor();
  const empty = await readSnapshot(page);
  assert.deepEqual(empty.banks, []);
  assert.equal(empty.activeBankId, '');
  assert.deepEqual(empty.settings.practiceScope, { type: 'bank', value: '' });
  assert.equal(empty.settings.suppressDefaultBank, true);
  assert.deepEqual(empty.records, before.records);
  assert.equal(await localRevision(page), revision + 3);
  return { rollback: true, cardAndBatchPreservedOtherBanks: true, empty: true };
}
