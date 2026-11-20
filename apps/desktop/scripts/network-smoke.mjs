import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** 启动失败且监听器未确认关闭时，不得删除可能仍被使用的隔离目录。 */
export class NativeMockStartupCleanupError extends AggregateError {
  /** @param {unknown} startupError @param {unknown} cleanupError @param {string} root */
  constructor(startupError, cleanupError, root) {
    const describe = (/** @type {unknown} */ error) => {
      if (!(error instanceof Error)) { return String(error); }
      const code = 'code' in error ? ` (${String(error.code)})` : '';
      return `${error.message}${code}`;
    };
    super(
      [startupError, cleanupError],
      `模拟网络服务启动失败：${describe(startupError)}；关闭未确认：${describe(cleanupError)}；隔离目录保留：${root}`,
      { cause: startupError },
    );
  }
}

/** @param {string} root */
export async function createNativeMock(root) {
  /** @type {{method:string|undefined,url:string|undefined,authenticated:boolean}[]} */ const requests = [];
  const files = new Map();
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, authenticated: request.headers.authorization === 'Bearer native-fixture-key' });
    /** @type {Buffer[]} */ const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (request.url === '/slow') {
        setTimeout(() => {
          response.end('{}');
        }, 500); return;
      }
      if (request.url === '/chat') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: 'native mock response' } }] })); return; }
      if (request.url === '/practice-analysis') {
        const content = JSON.stringify({ suggestedAnswer: 'A', matchesLocalAnswer: true, analysis: 'NATIVE_PRACTICE_AI: 1 + 1 = 2', confidence: 'HIGH', needsReview: false, warning: '' });
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content } }] })); return;
      }
      if (request.method === 'PUT') {
        if (request.url?.endsWith('/latest.json')) { response.writeHead(507); response.end(); return; }
        files.set(request.url, Buffer.concat(chunks)); response.writeHead(201); response.end(); return;
      }
      if (request.method === 'MKCOL') {
        response.writeHead(201);
        response.end();
        return;
      }
      if (request.method === 'GET' && files.has(request.url)) { response.end(files.get(request.url)); return; }
      if (request.method === 'PROPFIND') { response.writeHead(207, { 'Content-Type': 'application/xml' }); response.end('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/ShirohaQuiz/Web/</d:href></d:response></d:multistatus>'); return; }
      response.writeHead(404); response.end();
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject); resolve(undefined);
      });
    });
    const address = server.address();
    assert(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    await writeFile(path.join(root, 'network-mock-origin'), origin, { flag: 'wx' });
    return {
      origin,
      requests,
      close: () => {
        server.closeAllConnections(); server.close();
      },
    };
  } catch (error) {
    if (server.listening) {
      try {
        server.closeAllConnections();
        await new Promise((resolve, reject) => {
          server.close((failure) => (failure ? reject(failure) : resolve(undefined)));
        });
      } catch (cleanupError) {
        throw new NativeMockStartupCleanupError(error, cleanupError, root);
      }
    }
    throw error;
  }
}

/** @param {import('playwright-core').Page} page @param {string} origin */
export async function nativeServiceSmoke(page, origin) {
  await page.locator('.nav[data-view="ai-settings"]').click();
  await page.locator('#ai-provider-v99').selectOption('custom');
  await page.locator('#ai-endpoint-v99').fill(`${origin}/chat`);
  await page.locator('#ai-model-v99').fill('mock-model');
  await page.locator('#ai-api-key-v99').fill('native-fixture-key');
  await page.locator('#ai-remember-key-v99').check();
  await page.locator('#ai-test-connection-v99').click();
  await page.waitForFunction(() => document.querySelector('#ai-settings-status-v99')?.textContent?.includes('连接测试成功'));
  await page.locator('#ai-save-settings-v99').click();
  await page.waitForFunction(() => document.querySelector('#ai-settings-status-v99')?.textContent?.includes('设置已保存'));
  return page.evaluate(async (origin) => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window, 'ShirohaPlatform'));
    const config = { endpoint: `${origin}/chat`, apiKey: '[已保存的凭据]', rememberKey: true };
    if (platform.credentials.status('ai', config) !== '[已保存的凭据]') { throw new Error('凭据状态未确认'); }
    const response = await platform.network.ai(config, { messages: [{ role: 'user', content: 'synthetic' }], stream: false });
    if (!(await response.text()).includes('native mock response')) { throw new Error('原生 AI 未返回 mock'); }
    const dav = { endpoint: `${origin}/dav`, remoteDir: 'ShirohaQuiz/Web' };
    const list = await platform.network.webdav(dav, '', 'ShirohaQuiz/Web', { method: 'PROPFIND', acceptStatuses: [207] });
    if (list.status !== 207) { throw new Error('原生 WebDAV 目录失败'); }
    const backupPath = 'ShirohaQuiz/Web/shiroha-web-backup-20261023-120000-12345678.json';
    const body = JSON.stringify({ banks: [{ id: 'fake', questions: [] }], exportedAt: 'synthetic', text: '中文完整备份' });
    await platform.network.webdav(dav, '', backupPath, { method: 'PUT', body });
    await platform.network.webdav(dav, '', backupPath, { method: 'PUT', body });
    const downloaded = await platform.network.webdav(dav, '', backupPath, { method: 'GET' });
    if (await downloaded.text() !== body) { throw new Error('备份正文往返改变'); }
    let partial = false;
    try { await platform.network.webdav(dav, '', 'ShirohaQuiz/Web/latest.json', { method: 'PUT', body: '{}' }); } catch { partial = true; }
    if (!partial || (await platform.network.webdav(dav, '', backupPath, { method: 'GET' })).status !== 200) { throw new Error('latest 失败丢失历史备份'); }
    const controller = new window.AbortController();
    const delayed = platform.network.ai({ endpoint: `${origin}/slow` }, { messages: [] }, controller.signal);
    controller.abort();
    let cancelled = false;
    try { await delayed; } catch { cancelled = true; }
    if (!cancelled) { throw new Error('取消未生效'); }
    const host = /** @type {{invoke(command:string):Promise<unknown>}} */ (Reflect.get(window, 'ShirohaDesktopHost'));
    const before = await host.invoke('local_read');
    if (JSON.stringify(before).includes('native-fixture-key')) { throw new Error('秘密进入数据快照'); }
    await platform.credentials.reset();
    if (platform.credentials.status('ai', config)) { throw new Error('撤销后仍显示已绑定'); }
    let revoked = false;
    try { await platform.network.ai({ ...config }, { messages: [] }); } catch { revoked = true; }
    if (!revoked) { throw new Error('撤销后仍使用旧凭据'); }
    return { nativeAi: true, nativeDav: true, backupRoundtrip: true, partialLatest: partial, cancelled, revoked, snapshotSecretFree: true };
  }, origin);
}

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('../../web/platform/contracts.d.ts').Snapshot} Snapshot */
/** @typedef {(page: Page) => Promise<Snapshot>} ReadSnapshot */
/** @typedef {{invoke(command: string, args?: Record<string, unknown>): Promise<unknown>}} NativeHost */

/** 沿用隔离实例中的真实凭据和 SQLite 命令，按需拒绝写入或确认。仅记录操作类型与 ID。
 * @param {Page} page @param {'write' | 'commit' | null} failure
 * @param {() => Promise<void>} click @param {string} feedback
 */
async function checkAiCredentialWrite(page, failure, click, feedback) {
  const trace = await page.evaluateHandle((failAt) => {
    const host = /** @type {NativeHost} */ (Reflect.get(globalThis, 'ShirohaDesktopHost'));
    const original = host.invoke;
    /** @type {{kind: string, id?: string}[]} */
    const calls = [];
    host.invoke = async (command, args) => {
      const request = /** @type {{kind?: string, id?: string} | undefined} */ (args?.request);
      let call;
      if (['local_commit', 'local_write'].includes(command)) {
        call = { kind: 'write', id: String(args?.operationId) };
      } else if (command === 'service_credential' && request?.kind && ['stage', 'commit', 'rollback'].includes(request.kind)) {
        call = { kind: request.kind, id: request.id };
      }

      if (call) {
        calls.push(call);
        if (call.kind === failAt) {
          throw Object.assign(new Error('模拟 AI 配置事务故障'), { code: failAt === 'commit' ? 'credential_unavailable' : 'storage_unavailable' });
        }
      }

      const result = await original(command, args);
      if (call?.kind === 'stage') {
        call.id = String(Reflect.get(/** @type {object} */ (result), 'id'));
      }

      return result;
    };

    return {
      calls,
      async revision() {
        return (/** @type {{revision: number}} */ (await original('local_initialize'))).revision;
      },
      stop() {
        host.invoke = original;
      },
    };
  }, failure);
  try {
    const revision = await trace.evaluate((value) => value.revision());
    await click();
    await page.locator('#ai-settings-status-v99').filter({ hasText: feedback }).waitFor();
    await page.locator('body[data-storage-state="ready"]').waitFor();
    const calls = await trace.evaluate((value) => value.calls);
    const [stage, write, end] = calls;
    assert.deepEqual(calls.map(({ kind }) => kind), ['stage', 'write', failure === 'write' ? 'rollback' : 'commit']);
    assert(stage.id);
    assert.equal(write.id, `credential-${stage.id}`);
    assert.equal(end.id, stage.id);
    const expectedRevision = failure === 'write' ? revision : revision + 1;
    assert.equal(await trace.evaluate((value) => value.revision()), expectedRevision);
  } finally {
    await trace.evaluate((value) => value.stop());
    await trace.dispose();
  }
}

/** @param {Page} page @param {string} endpoint */
function aiCredentialStatus(page, endpoint) {
  return page.evaluate((url) => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (
      Reflect.get(globalThis, 'ShirohaPlatform')
    );
    return platform.credentials.status('ai', { endpoint: url, rememberKey: true });
  }, endpoint);
}

/** @param {Page} page @param {ReadSnapshot} readSnapshot @param {string} origin */
export async function aiSettingsCredentialSmoke(page, readSnapshot, origin) {
  const endpoint = `${origin}/chat`;
  await page.locator('.nav[data-view="ai-settings"]').click();
  await page.locator('#ai-provider-v99').selectOption('custom');
  await page.locator('#ai-endpoint-v99').fill(endpoint);
  await page.locator('#ai-model-v99').fill('fixture-saved-model');
  await page.locator('#ai-api-key-v99').fill('synthetic-ai-write-key');
  await page.locator('#ai-remember-key-v99').check();
  const save = page.locator('#ai-save-settings-v99');
  const clear = page.locator('#ai-clear-settings-v99');
  const retry = page.locator('#platform-status').getByRole('button', { name: '重试' });
  const before = await readSnapshot(page);
  const clickSave = () => save.click();
  await checkAiCredentialWrite(page, 'write', clickSave, '本地操作未完成');
  assert.deepEqual(await readSnapshot(page), before);
  assert.equal(await aiCredentialStatus(page, endpoint), '');

  await checkAiCredentialWrite(page, null, () => retry.click(), '设置已保存');
  const saved = await readSnapshot(page);
  assert.match(JSON.stringify(saved.settings.aiImportV99), /fixture-saved-model/);
  assert.doesNotMatch(JSON.stringify(saved), /synthetic-ai-write-key/);
  assert.equal(await aiCredentialStatus(page, endpoint), '[已保存的凭据]');

  const reconciledEndpoint = `${origin}/chat-reconciled`;
  await page.locator('#ai-endpoint-v99').fill(reconciledEndpoint);
  await page.locator('#ai-model-v99').fill('fixture-reconciled-model');
  await checkAiCredentialWrite(page, 'commit', clickSave, '系统凭据不可用');
  await page.locator('#platform-status').filter({ hasText: '数据已保存' }).waitFor();
  assert.match(JSON.stringify((await readSnapshot(page)).settings.aiImportV99), /fixture-reconciled-model/);
  assert.equal(await aiCredentialStatus(page, reconciledEndpoint), '');
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="ai-settings"]').click();
  assert.equal(await page.locator('#ai-model-v99').inputValue(), 'fixture-reconciled-model');
  assert.equal(await page.locator('#ai-endpoint-v99').inputValue(), reconciledEndpoint);
  assert.equal(await aiCredentialStatus(page, reconciledEndpoint), '[已保存的凭据]');
  const reconciled = await readSnapshot(page);

  await clear.click();
  await page.locator('#app-dialog [data-dialog-cancel]').click();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  assert.deepEqual(await readSnapshot(page), reconciled);
  assert.equal(await aiCredentialStatus(page, reconciledEndpoint), '[已保存的凭据]');

  const accept = page.locator('#app-dialog [data-dialog-accept]');
  await checkAiCredentialWrite(page, 'write', async () => {
    await clear.click();
    await accept.click();
  }, '清除失败，原配置已保留');
  assert.deepEqual(await readSnapshot(page), reconciled);
  assert.equal(await aiCredentialStatus(page, reconciledEndpoint), '[已保存的凭据]');
  await checkAiCredentialWrite(page, null, async () => {
    await retry.click();
    await accept.click();
  }, 'AI 配置已清除');
  assert.equal(await aiCredentialStatus(page, reconciledEndpoint), '');
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="ai-settings"]').click();
  assert.equal(await page.locator('#ai-provider-v99').inputValue(), 'ollama');
  assert.equal(await page.locator('#ai-model-v99').inputValue(), '');
  assert.equal(await aiCredentialStatus(page, reconciledEndpoint), '');
  return { saveRollback: true, clearRollback: true, confirmedAndRetried: true, reconciled: true };
}
