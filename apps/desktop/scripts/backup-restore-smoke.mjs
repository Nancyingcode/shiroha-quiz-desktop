import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureBackupRestoreFixture } from './bank-operations-smoke.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('../../web/platform/contracts.d.ts').Snapshot} Snapshot */
/** @typedef {(page: Page) => Promise<Snapshot>} ReadSnapshot */
/** @typedef {{invoke(command: string, args?: Record<string, unknown>): Promise<unknown>}} NativeHost */
/** @typedef {{kind: string, id?: string}} Call */
/** @typedef {{calls: Call[], failure: string | null, secretInBackup: boolean, releaseIdle?: () => void}} Trace */
/** @typedef {{name: string, bytes: number[]}} FileData */
/** @typedef {Record<string, Record<string, {favoritedAt: number, question?: {id: string}}>>} FavoriteMeta */

/** 通过正常 IPC 运行持久化，故障只拒绝测试选中的下一步。
 * @param {Page} page @param {string | null} [failure]
 */
async function traceRestore(page, failure = null) {
  await page.evaluate((reject) => {
    const host = /** @type {NativeHost} */ (Reflect.get(globalThis, 'ShirohaDesktopHost'));
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (
      Reflect.get(globalThis, 'ShirohaPlatform')
    );
    const callNative = host.invoke;
    const trace = /** @type {Trace} */ ({ calls: [], failure: reject, secretInBackup: false });
    Reflect.set(globalThis, '__backupRestoreTrace', trace);
    const { harness } = platform;
    if (harness) {
      const cancel = harness.cancelAll;
      harness.cancelAll = async () => {
        trace.calls.push({ kind: 'cancel-harness' });
        await cancel();
      };
    }

    host.invoke = async (command, args) => {
      const query = /** @type {{kind?: string} | undefined} */ (args?.query);
      const request = /** @type {{kind?: string, id?: string, operation?: {kind?: string, body?: string}} | undefined} */ (
        args?.request
      );
      let call;
      if (command === 'local_query' && ['details', 'hydrate'].includes(query?.kind || '')) {
        call = { kind: 'read' };
      } else if (command === 'local_query' && query?.kind === 'restore') {
        call = { kind: 'restore-point' };
      } else if (command === 'local_checkpoint') {
        call = { kind: 'checkpoint' };
      } else if (['local_write', 'local_commit'].includes(command)) {
        call = { kind: 'write', id: String(args?.operationId) };
      } else if (command === 'service_credential' && ['invalidate', 'stage', 'rollback', 'commit'].includes(request?.kind || '')) {
        call = { kind: request?.kind || '', id: request?.id };
      } else if (command === 'service_request' && request?.operation?.kind === 'upload') {
        if (request.operation.body?.includes('fake-native-dav-password')
          || request.operation.body?.includes('fake-rotated-dav-password')) {
          trace.secretInBackup = true;
        }
      }

      if (call) {
        trace.calls.push(call);
        if (trace.failure === call.kind) {
          trace.failure = null;
          throw new Error('隔离恢复故障');
        }
      }

      const result = await callNative(command, args);
      if (call?.kind === 'stage') {
        call.id = String(Reflect.get(/** @type {object} */ (result), 'id'));
      }

      return result;
    };
  }, failure);
}

/** @param {Page} page @param {string | null} failure */
function armFailure(page, failure) {
  return page.evaluate((kind) => {
    const trace = /** @type {Trace} */ (Reflect.get(globalThis, '__backupRestoreTrace'));
    trace.calls.length = 0;
    trace.failure = kind;
  }, failure);
}

/** @param {Page} page */
function traceCalls(page) {
  return /** @type {Promise<Call[]>} */ (page.evaluate(() => Reflect.get(globalThis, '__backupRestoreTrace').calls));
}

/** @param {Page} page */
function readRevision(page) {
  return page.evaluate(async () => {
    const host = /** @type {NativeHost} */ (Reflect.get(globalThis, 'ShirohaDesktopHost'));
    return (/** @type {{revision: number}} */ (await host.invoke('local_initialize'))).revision;
  });
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
async function reloadSnapshot(page, readSnapshot) {
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  return readSnapshot(page);
}

/** @param {Page} page */
async function openSettings(page) {
  await page.locator('.nav[data-view="settings"]').click();
  await page.locator('#settings-backup-panel-v23').waitFor();
}

/** 由测试宿主交付文件授权，真实设置按钮、分块读取和恢复流程均照常执行。
 * @param {Page} page @param {FileData} file @param {'merge' | 'overwrite'} mode
 */
async function pickBackupFile(page, file, mode) {
  await page.locator('#settings-backup-mode-v23').selectOption(mode);
  await page.evaluate(({ name, bytes }) => {
    const host = /** @type {NativeHost} */ (Reflect.get(globalThis, 'ShirohaDesktopHost'));
    const callNative = host.invoke;
    const token = 'backup-restore-fixture';
    Reflect.set(globalThis, '__backupRestoreFileReleased', false);
    let consumed = 0;
    host.invoke = (command, args) => {
      const request = /** @type {{kind: string, token?: string, offset?: number} | undefined} */ (args?.request);
      if (command !== 'local_file' || !request) {
        return callNative(command, args);
      }

      if (request.kind === 'choose_import') {
        return Promise.resolve({ token, name, sizeBytes: bytes.length });
      }

      if (request.token !== token) {
        return callNative(command, args);
      }

      if (request.kind === 'read' && request.offset === consumed) {
        const chunk = bytes.slice(consumed, consumed + 262144);
        consumed += chunk.length;
        return Promise.resolve(chunk);
      }

      if (request.kind === 'release' && consumed === bytes.length) {
        host.invoke = callNative;
        Reflect.set(globalThis, '__backupRestoreFileReleased', true);
        return Promise.resolve(null);
      }

      throw new Error('备份文件授权使用次序不符');
    };
  }, file);
  await page.locator('#settings-import-backup-v23').click();
  await page.waitForFunction(() => Reflect.get(globalThis, '__backupRestoreFileReleased'));
}

/** @param {Page} page @param {string} message */
async function confirm(page, message) {
  await page.locator('#app-dialog-message').filter({ hasText: message }).waitFor();
  await page.locator('#app-dialog [data-dialog-accept]').click();
}

/** @param {Page} page @param {FileData} file @param {'merge' | 'overwrite'} mode */
async function pickWebdavBackup(page, file, mode) {
  const digest = createHash('sha256').update(Buffer.from(file.bytes)).digest('hex');
  const name = `shiroha-web-backup-20261119-120000-${digest.slice(0, 8)}.json`;
  await page.evaluate(({ name, digest, bytes }) => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (
      Reflect.get(globalThis, 'ShirohaPlatform')
    );
    platform.network.webdav = async (_config, _password, path, options) => {
      if (options?.method === 'PROPFIND') {
        const xml = `<multistatus xmlns="DAV:"><response><href>/${path}/${name}</href></response></multistatus>`;
        return new globalThis.Response(xml, { status: 207 });
      }

      if (path.endsWith('/latest.json')) {
        return new globalThis.Response(JSON.stringify({ fileName: name, sha256: digest }));
      }

      if (path.endsWith(`/${name}`)) {
        return new globalThis.Response(new Uint8Array(bytes));
      }

      throw new Error('模拟 WebDAV 意外请求');
    };
  }, { name, digest, bytes: file.bytes });
  await page.locator('#webdav-endpoint-v378').fill('http://127.0.0.1:1/dav');
  await page.locator('#webdav-refresh-v378').click();
  await page.locator(`[data-webdav-restore-v378="${name}"]`).click();
  await page.locator('#webdav-restore-mode-v378').selectOption(mode);
}

/** @param {Snapshot} actual @param {Snapshot} previous @param {Snapshot} source
 * @param {{merge: boolean, legacy: boolean}} mode
 */
function assertRestoredSnapshot(actual, previous, source, { merge, legacy }) {
  const preserved = merge ? previous.banks.length : 0;
  const restored = actual.banks.slice(preserved);
  assert.equal(restored.length, source.banks.length);
  if (merge) {
    assert.deepEqual(actual.banks.slice(0, preserved), previous.banks);
    assert.deepEqual(actual.records.slice(0, previous.records.length), previous.records);
  }

  source.banks.forEach((bank, i) => {
    const restoredBank = restored[i];
    assert.equal(restoredBank.groupName, bank.groupName);
    assert.equal(restoredBank.questions.length, bank.questions.length);
    bank.questions.forEach((expected, index) => {
      const question = restoredBank.questions[index];
      assert.equal(question.id, expected.id);
      assert.equal(question.type, expected.type);
      const media = /** @type {{sourceName: string, dataUrl: string}[] | undefined} */ (expected.images)?.[0];
      const restoredStem = media ? `${expected.question}\n![${media.sourceName}](${media.dataUrl})` : expected.question;
      assert.equal(question.question, restoredStem);
      assert.deepEqual(question.options, expected.options);
      assert.deepEqual(question.answer, expected.answer);
      // 自建题的解析没有答案标题，兼容导入会补齐既有前缀。
      assert.equal(question.analysis, `答案：${expected.answer[0]}。${expected.analysis}`);
      assert.deepEqual(question.extension, expected.extension);
    });

    assert.match(JSON.stringify(restoredBank.questions.at(-1)?.images), /data:image\/png/);
  });

  const [first, second] = restored;
  const wrong = /** @type {Array<{id: string, wrongCount: number}>} */ (actual.wrongBook[first.id]);
  assert.equal(wrong[0].id, 'q2');
  assert.equal(wrong[0].wrongCount, 3);
  assert.deepEqual(actual.favorites[second.id], ['q2']);
  const restoredMeta = /** @type {FavoriteMeta} */ (actual.crossPlatformMeta.favoriteQuestions);
  const sourceMeta = /** @type {FavoriteMeta} */ (source.crossPlatformMeta.favoriteQuestions);
  const favorite = restoredMeta[second.id]?.q2;
  const expectedFavorite = sourceMeta[source.banks[1].id].q2;
  assert.equal(favorite.favoritedAt, expectedFavorite.favoritedAt);
  if (legacy) {
    assert.equal(favorite.question?.id, 'q2');
  } else {
    assert.deepEqual(favorite, expectedFavorite);
  }

  const record = actual.records.at(-1);
  assert.equal(record?.bankId, first.id);
  assert.match(JSON.stringify(record), /记录中仍可读取的历史题干/);
  assert.equal(actual.settings.suppressDefaultBank, merge || legacy);
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function backupRestorePathsSmoke(page, readSnapshot) {
  const fixture = await captureBackupRestoreFixture(page, readSnapshot);
  const {
    source,
    json,
    zip,
    resetTarget,
  } = fixture;
  for (const mode of /** @type {const} */ (['merge', 'overwrite'])) {
    const before = await resetTarget();
    await openSettings(page);
    await pickBackupFile(page, mode === 'merge' ? json : zip, mode);
    if (mode === 'overwrite') {
      await confirm(page, '覆盖恢复会清空');
    }
    await page.locator('#import-summary').filter({ hasText: '导入完成' }).waitFor({ state: 'attached' });
    await page.locator('body[data-storage-state="ready"]').waitFor();
    assert.equal(await page.locator('#backup-json-file-v23').evaluate((input) => /** @type {HTMLInputElement} */ (input).value), '');
    assertRestoredSnapshot(await reloadSnapshot(page, readSnapshot), before, source, {
      merge: mode === 'merge', legacy: mode === 'overwrite',
    });
  }

  const beforeImport = await resetTarget();
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#import-text').fill(Buffer.from(json.bytes).toString('utf8'));
  await page.locator('#parse-import-btn').click();
  await confirm(page, '识别到备份');
  await page.getByText('备份导入完成', { exact: true }).waitFor();
  assert.equal(await page.locator('#confirm-import-btn').isDisabled(), true);
  assertRestoredSnapshot(await reloadSnapshot(page, readSnapshot), beforeImport, source, { merge: true, legacy: false });

  for (const mode of /** @type {const} */ (['merge', 'overwrite'])) {
    const before = await resetTarget();
    await openSettings(page);
    await pickWebdavBackup(page, json, mode);
    await page.locator('#webdav-restore-confirm-v378').click();
    await page.locator('#webdav-status-v378').filter({ hasText: '恢复完成' }).waitFor();
    assert.equal(await page.locator('#webdav-restore-modal-v378').isHidden(), true);
    assertRestoredSnapshot(await reloadSnapshot(page, readSnapshot), before, source, {
      merge: mode === 'merge', legacy: false,
    });
  }

  return { routes: 5, sizes: source.banks.map((bank) => bank.questions.length), reloaded: true };
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function backupRestoreFailuresSmoke(page, readSnapshot) {
  const { json, source, resetTarget } = await captureBackupRestoreFixture(page, readSnapshot);
  const before = await resetTarget();
  const revision = await readRevision(page);
  await openSettings(page);
  await traceRestore(page);
  const faulty = JSON.parse(Buffer.from(json.bytes).toString('utf8'));
  faulty.banks[0].questions.at(-1).images = [{ localPath: 'assets/missing.png' }];
  await pickBackupFile(page, { name: json.name, bytes: [...Buffer.from(JSON.stringify(faulty))] }, 'overwrite');
  await page.locator('#import-summary').filter({ hasText: '备份缺少图片' }).waitFor({ state: 'attached' });
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.deepEqual(await traceCalls(page), []);
  assert.equal(await readRevision(page), revision);

  const retry = page.locator('#platform-status.failed').getByRole('button', { name: '重试', exact: true });
  for (const failure of ['read', 'checkpoint', 'write']) {
    await armFailure(page, failure);
    if (failure === 'read') {
      await pickBackupFile(page, json, 'overwrite');
    } else {
      await retry.click();
    }
    await confirm(page, '覆盖恢复会清空');
    await retry.waitFor();
    const kinds = (await traceCalls(page)).map((call) => call.kind);
    const writePhases = kinds.filter((kind) => kind !== 'read');
    assert(kinds.includes('read'));
    if (failure === 'read') {
      assert.deepEqual(writePhases, []);
    } else if (failure === 'checkpoint') {
      assert.deepEqual(writePhases, ['checkpoint']);
    } else {
      assert.deepEqual(writePhases, ['checkpoint', 'cancel-harness', 'invalidate', 'write']);
    }

    assert.equal(await readRevision(page), revision);
    assert.deepEqual(await readSnapshot(page), before);
    assert.equal(await page.locator('#active-bank-select').inputValue(), before.activeBankId);
  }

  await armFailure(page, null);
  await retry.click();
  await confirm(page, '覆盖恢复会清空');
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.equal(await readRevision(page), revision + 1);
  assertRestoredSnapshot(await reloadSnapshot(page, readSnapshot), before, source, { merge: false, legacy: false });
  return { rejected: ['missing-media', 'read', 'checkpoint', 'write'], saveRetries: 1, reloaded: true };
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot */
export async function normalRecoveryPointSmoke(page, readSnapshot) {
  const { source, resetTarget } = await captureBackupRestoreFixture(page, readSnapshot);
  const name = await page.evaluate(async () => {
    const host = /** @type {NativeHost} */ (Reflect.get(globalThis, 'ShirohaDesktopHost'));
    return (/** @type {{snapshotId: string}} */ (await host.invoke('local_checkpoint'))).snapshotId;
  });
  const before = await resetTarget();
  await openSettings(page);
  await traceRestore(page);
  await page.evaluate(() => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (
      Reflect.get(globalThis, 'ShirohaPlatform')
    );
    const trace = /** @type {Trace} */ (Reflect.get(globalThis, '__backupRestoreTrace'));
    const { idle } = platform.saves;
    platform.saves.idle = async () => {
      trace.calls.push({ kind: 'idle' });
      await new Promise((resolve) => {
        trace.releaseIdle = () => resolve(undefined);
      });
      await idle();
    };
  });
  const panel = page.locator('#native-recovery-panel');
  await panel.getByRole('button', { name: '读取恢复点' }).click();
  await panel.getByRole('combobox', { name: '本机恢复点', exact: true }).selectOption(name);
  await panel.getByRole('button', { name: '恢复选中的数据' }).click();
  await confirm(page, '用选中的恢复点');
  await page.waitForFunction(() => Boolean(Reflect.get(globalThis, '__backupRestoreTrace')?.releaseIdle));
  assert.deepEqual((await traceCalls(page)).map((call) => call.kind), ['cancel-harness', 'idle']);
  assert.deepEqual(await readSnapshot(page), before);
  const reloaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
  await page.evaluate(() => Reflect.get(globalThis, '__backupRestoreTrace').releaseIdle());
  await reloaded;
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.deepEqual(await readSnapshot(page), source);
  return { waitedForIdle: true, reloaded: true };
}

/** @param {Call[]} calls @param {'rollback' | 'commit'} result */
function assertDavReceipt(calls, result) {
  const [stage, write, end] = calls;
  assert.deepEqual(calls.map((call) => call.kind), ['stage', 'write', result]);
  assert(stage.id);
  assert.equal(write.id, `credential-${stage.id}`);
  assert.equal(end.id, stage.id);
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot @param {string} origin */
export async function nativeDavConfigurationSmoke(page, readSnapshot, origin) {
  await openSettings(page);
  await traceRestore(page, 'write');
  await page.locator('#webdav-endpoint-v378').fill(`${origin}/dav`);
  await page.locator('#webdav-username-v378').fill('restore-fixture');
  await page.locator('#webdav-password-v378').fill('fake-native-dav-password');
  await page.locator('#webdav-remember-v378').check();
  const save = page.locator('#webdav-save-v378');
  const clear = page.locator('#webdav-clear-v378');
  const status = page.locator('#webdav-status-v378');
  const before = await readSnapshot(page);
  const startRevision = await readRevision(page);
  await save.click();
  await status.filter({ hasText: '本地操作未完成' }).waitFor();
  assert.equal(await readRevision(page), startRevision);
  assert.deepEqual(await readSnapshot(page), before);
  assertDavReceipt(await traceCalls(page), 'rollback');

  await armFailure(page, null);
  await save.click();
  await status.filter({ hasText: '配置已保存' }).waitFor();
  assertDavReceipt(await traceCalls(page), 'commit');
  assert.equal(await readRevision(page), startRevision + 1);
  const saved = await readSnapshot(page);
  assert.match(JSON.stringify(saved.serviceConfigurations), /restore-fixture/);
  assert(!JSON.stringify(saved).includes('fake-native-dav-password'));

  await armFailure(page, 'commit');
  await page.locator('#webdav-remote-dir-v378').fill('ShirohaQuiz/Restore');
  await page.locator('#webdav-password-v378').fill('fake-rotated-dav-password');
  await save.click();
  await status.filter({ hasText: '配置数据已写入，凭据确认未完成' }).waitFor();
  assertDavReceipt(await traceCalls(page), 'commit');
  assert.equal(await readRevision(page), startRevision + 2);
  const reconciled = await reloadSnapshot(page, readSnapshot);
  assert.match(JSON.stringify(reconciled.serviceConfigurations), /ShirohaQuiz\/Restore/);
  await openSettings(page);
  const credentialReady = await page.evaluate(() => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (
      Reflect.get(globalThis, 'ShirohaPlatform')
    );
    const config = {
      endpoint: /** @type {HTMLInputElement} */ (globalThis.document.querySelector('#webdav-endpoint-v378')).value,
      username: 'restore-fixture',
      remoteDir: 'ShirohaQuiz/Restore',
    };
    return platform.credentials.status('webdav', config);
  });
  assert.equal(credentialReady, '[已保存的凭据]');
  await traceRestore(page);

  await armFailure(page, null);
  await page.locator('#webdav-upload-v378').click();
  await status.filter({ hasText: '上传成功' }).waitFor();
  const configCalls = (await traceCalls(page)).filter((call) => call.kind !== 'read');
  assert.deepEqual(configCalls.map((call) => call.kind), ['write']);
  assert.equal(await readRevision(page), startRevision + 3);
  assert.equal(await page.evaluate(() => Reflect.get(globalThis, '__backupRestoreTrace').secretInBackup), false);
  const uploaded = await readSnapshot(page);
  assert.match(JSON.stringify(uploaded.serviceConfigurations), /shiroha-web-backup-/);

  await armFailure(page, 'write');
  await clear.click();
  await status.filter({ hasText: '清除失败' }).waitFor();
  assertDavReceipt(await traceCalls(page), 'rollback');
  assert.equal(await readRevision(page), startRevision + 3);
  assert.deepEqual(await readSnapshot(page), uploaded);

  await armFailure(page, null);
  await clear.click();
  await status.filter({ hasText: '配置和密码已清除' }).waitFor();
  assertDavReceipt(await traceCalls(page), 'commit');
  assert.equal(await readRevision(page), startRevision + 4);
  assert.equal(JSON.stringify(await reloadSnapshot(page, readSnapshot)).includes('restore-fixture'), false);
  return {
    writeFailure: ['save', 'clear'], committed: ['save', 'metadata', 'clear'], finalizeReconciled: true, secretInBackup: false,
  };
}

/** 从启动失败界面开始计量，确认修复后原文来源和 AI 选区各接收一次输入。
 * @param {Page} page
 */
export async function trackRecoveryStartup(page) {
  await page.locator('body[data-storage-state="recovery_required"]').waitFor();
  await page.evaluate(() => {
    const host = /** @type {NativeHost} */ (Reflect.get(globalThis, 'ShirohaDesktopHost'));
    const callNative = host.invoke;
    const queries = /** @type {string[]} */ ([]);
    Reflect.set(globalThis, '__recoveryStartupQueries', queries);
    host.invoke = (command, args) => {
      const query = /** @type {{kind?: string} | undefined} */ (args?.query);
      if (command === 'local_query' && (query?.kind === 'recover' || query?.kind === 'recover_import')) {
        queries.push(query.kind);
      }

      return callNative(command, args);
    };
  });
  await page.locator('#import-text').evaluate((input) => {
    const calls = /** @type {number[]} */ ([]);
    Reflect.set(globalThis, '__recoveryStartupEvents', calls);
    const add = input.addEventListener.bind(input);
    /** @param {string} type @param {EventListenerOrEventListenerObject} listener
     * @param {boolean | AddEventListenerOptions} [options]
     */
    input.addEventListener = (type, listener, options) => {
      if (type !== 'input' || typeof listener !== 'function') {
        add(type, listener, options);
        return;
      }

      const index = calls.push(0) - 1;
      add(type, (event) => {
        calls[index] += 1;
        listener.call(input, event);
      }, options);
    };
  });
  return async (/** @type {'recover' | 'recover_import'} */ expectedQuery) => {
    await page.locator('body[data-storage-state="ready"]').waitFor();
    await page.locator('#import-text').dispatchEvent('input');
    assert.deepEqual(await page.evaluate(() => Reflect.get(globalThis, '__recoveryStartupQueries')), [expectedQuery]);
    assert.deepEqual(await page.evaluate(() => Reflect.get(globalThis, '__recoveryStartupEvents')), [1, 1]);
    assert.equal(await page.locator('#settings-backup-panel-v23').count(), 1);
    assert.equal(await page.locator('#backup-json-file-v23').count(), 1);
  };
}
