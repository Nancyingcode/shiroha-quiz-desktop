import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** @param {string} root */
export async function createNativeMock(root) {
  /** @type {{method:string|undefined,url:string|undefined,authenticated:boolean}[]} */ const requests = [];
  const files = new Map();
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, authenticated: request.headers.authorization === 'Bearer native-fixture-key' });
    /** @type {Buffer[]} */ const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      if (request.url === '/slow') { setTimeout(() => { response.end('{}'); }, 500); return; }
      if (request.url === '/chat') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: 'native mock response' } }] })); return; }
      if (request.method === 'PUT') {
        if (request.url?.endsWith('/latest.json')) { response.writeHead(507); response.end(); return; }
        files.set(request.url, Buffer.concat(chunks)); response.writeHead(201); response.end(); return;
      }
      if (request.method === 'GET' && files.has(request.url)) { response.end(files.get(request.url)); return; }
      if (request.method === 'PROPFIND') { response.writeHead(207, { 'Content-Type': 'application/xml' }); response.end('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/ShirohaQuiz/Web/</d:href></d:response></d:multistatus>'); return; }
      response.writeHead(404); response.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  await writeFile(path.join(root, 'network-mock-origin'), origin, { flag: 'wx' });
  return { origin, requests, close: () => { server.closeAllConnections(); server.close(); } };
}

/** @param {import('playwright-core').Page} page @param {string} origin */
export async function nativeServiceSmoke(page, origin) {
  await page.locator('.nav[data-view="ai-settings"]').click();
  await page.locator('#ai-provider-v99').selectOption('custom');
  await page.locator('#ai-endpoint-v99').fill(origin + '/chat');
  await page.locator('#ai-model-v99').fill('mock-model');
  await page.locator('#ai-api-key-v99').fill('native-fixture-key');
  await page.locator('#ai-remember-key-v99').check();
  await page.locator('#ai-test-connection-v99').click();
  await page.waitForFunction(() => document.querySelector('#ai-settings-status-v99')?.textContent?.includes('连接测试成功'));
  await page.locator('#ai-save-settings-v99').click();
  await page.waitForFunction(() => document.querySelector('#ai-settings-status-v99')?.textContent?.includes('设置已保存'));
  return page.evaluate(async origin => {
    const platform = /** @type {import('../../web/platform/runtime.d.ts').BrowserGlobals['ShirohaPlatform']} */ (Reflect.get(window, 'ShirohaPlatform'));
    const config = { endpoint: origin + '/chat', apiKey: '[已保存的凭据]', rememberKey: true };
    if (platform.credentials.status('ai', config) !== '[已保存的凭据]') throw new Error('凭据状态未确认');
    const response = await platform.network.ai(config, { messages: [{ role: 'user', content: 'synthetic' }], stream: false });
    if (!(await response.text()).includes('native mock response')) throw new Error('原生 AI 未返回 mock');
    const dav = { endpoint: origin + '/dav', remoteDir: 'ShirohaQuiz/Web' };
    const list = await platform.network.webdav(dav, '', 'ShirohaQuiz/Web', { method: 'PROPFIND', acceptStatuses: [207] });
    if (list.status !== 207) throw new Error('原生 WebDAV 目录失败');
    const backupPath = 'ShirohaQuiz/Web/shiroha-web-backup-20261023-120000-12345678.json';
    const body = JSON.stringify({ banks: [{ id: 'fake', questions: [] }], exportedAt: 'synthetic', text: '中文完整备份' });
    await platform.network.webdav(dav, '', backupPath, { method: 'PUT', body });
    await platform.network.webdav(dav, '', backupPath, { method: 'PUT', body });
    const downloaded = await platform.network.webdav(dav, '', backupPath, { method: 'GET' });
    if (await downloaded.text() !== body) throw new Error('备份正文往返改变');
    let partial = false;
    try { await platform.network.webdav(dav, '', 'ShirohaQuiz/Web/latest.json', { method: 'PUT', body: '{}' }); } catch { partial = true; }
    if (!partial || (await platform.network.webdav(dav, '', backupPath, { method: 'GET' })).status !== 200) throw new Error('latest 失败丢失历史备份');
    const controller = new window.AbortController();
    const delayed = platform.network.ai({ endpoint: origin + '/slow' }, { messages: [] }, controller.signal);
    controller.abort();
    let cancelled = false;
    try { await delayed; } catch { cancelled = true; }
    if (!cancelled) throw new Error('取消未生效');
    const host = /** @type {{invoke(command:string):Promise<unknown>}} */ (Reflect.get(window, 'ShirohaDesktopHost'));
    const before = await host.invoke('local_read');
    if (JSON.stringify(before).includes('native-fixture-key')) throw new Error('秘密进入数据快照');
    await platform.credentials.reset();
    if (platform.credentials.status('ai', config)) throw new Error('撤销后仍显示已绑定');
    let revoked = false;
    try { await platform.network.ai({ ...config }, { messages: [] }); } catch { revoked = true; }
    if (!revoked) throw new Error('撤销后仍使用旧凭据');
    return { nativeAi: true, nativeDav: true, backupRoundtrip: true, partialLatest: partial, cancelled, revoked, snapshotSecretFree: true };
  }, origin);
}
