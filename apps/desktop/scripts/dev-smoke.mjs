import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { markNativeIsolation } from './native-isolation.mjs';

const DEV_PORT = 51736;
const DEV_ORIGIN = `http://127.0.0.1:${DEV_PORT}`;
const START_TIMEOUT_MS = 600_000;
const ACTION_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 10_000;
const POLL_MS = 200;
const LOG_LIMIT = 32_768;
const PROFILE_PREFIX = 'shiroha-native-dev-';
const ISOLATION_MARKER = 'fake-credentials\nnetwork-denied\n';
const DESKTOP_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../.reports/dev-smoke.json', import.meta.url));
const execute = promisify(execFile);

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Browser} Browser */
/** @typedef {import('node:child_process').ChildProcess} ChildProcess */
/** @typedef {{revision:number, hasData:boolean}} NativeState */
/** @typedef {Window & {ShirohaDesktopHost?: {invoke(command:string,args?:Record<string,unknown>):Promise<unknown>,window:{close():Promise<void>}},ShirohaPlatform?:{storage:{revision():number}}}} TestWindow */
/** @typedef {{name:string,ok:boolean,detail?:unknown,error?:string}} Check */

/** @param {unknown} error */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {ChildProcess} child */
function running(child) {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

/** @param {import('node:net').Server} server @param {number} [port] */
async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(undefined); });
  });
  const address = server.address();
  assert(address && typeof address !== 'string', '未取得回环端口');
  return address.port;
}

/** @param {import('node:net').Server} server */
async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)));
}

async function availablePort() {
  const reservation = createServer();
  try { return await listen(reservation); }
  finally { await closeServer(reservation); }
}

async function requireFreeDevelopmentPort() {
  const reservation = createServer();
  try { await listen(reservation, DEV_PORT); }
  catch (error) {
    throw new Error(`开发端口 ${DEV_PORT} 无法使用，请先正常关闭占用该端口的开发实例；测试不会结束其他进程。${errorText(error)}`, { cause: error });
  } finally { await closeServer(reservation); }
}

/** @param {string} value */
function localResource(value) {
  const url = new URL(value);
  return ['data:', 'blob:', 'ipc:'].includes(url.protocol)
    || url.origin === DEV_ORIGIN
    || (['http:', 'https:'].includes(url.protocol) && ['ipc.localhost', 'tauri.localhost'].includes(url.hostname))
    || (url.protocol === 'tauri:' && url.hostname === 'localhost');
}

/** @param {ChildProcess} child @param {number} port @param {() => Error|undefined} launchError */
async function waitForDebugger(child, port, launchError) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const error = launchError();
    if (error) throw error;
    assert(running(child), 'npm run dev 在 WebView2 就绪前退出，详见开发进程日志');
    const ready = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) })
      .then(response => response.ok).catch(() => false);
    if (ready) return endpoint;
    await delay(POLL_MS);
  }
  throw new Error(`npm run dev 未在 ${START_TIMEOUT_MS / 1000} 秒内启动 WebView2`);
}

/** @param {Page} page @returns {Promise<NativeState>} */
async function nativeState(page) {
  const result = await page.evaluate(async () => {
    const host = (/** @type {TestWindow} */ (window)).ShirohaDesktopHost;
    if (!host) throw new Error('原生桥接缺失');
    try { return await host.invoke('local_initialize'); }
    catch (error) { throw new Error(`local_initialize: ${JSON.stringify(error)}`, { cause: error }); }
  });
  assert(result && typeof result === 'object' && 'revision' in result && 'hasData' in result, '原生初始化回包无效');
  assert(typeof result.revision === 'number' && Number.isSafeInteger(result.revision), '原生修订号无效');
  assert.equal(typeof result.hasData, 'boolean', '原生数据状态无效');
  return /** @type {NativeState} */ (result);
}

/** @param {Page} page */
async function assertReady(page) {
  await page.waitForFunction(() => ['ready', 'recovery_required'].includes(document.body.dataset.storageState || ''));
  const state = await page.evaluate(() => ({
    state: document.body.dataset.storageState,
    inert: document.querySelector('.app')?.hasAttribute('inert'),
    status: document.getElementById('platform-status')?.textContent || '',
  }));
  assert.equal(state.state, 'ready', `启动进入恢复状态：${state.status}`);
  assert.equal(state.inert, false, '主界面的 inert 锁未解除');
  assert.equal(await page.locator('#platform-status').isVisible(), false, `仍显示启动提示：${state.status}`);
  return state;
}

/** @param {ChildProcess} child @param {Page|undefined} page */
async function stopDevelopment(child, page) {
  // 先让本次窗口完成正常关闭；随后只结束本脚本持有的 npm PID 及其子进程树。
  if (page && !page.isClosed()) {
    await Promise.race([
      page.evaluate(async () => { await (/** @type {TestWindow} */ (window)).ShirohaDesktopHost?.window.close(); }).catch(() => undefined),
      delay(CLOSE_TIMEOUT_MS, undefined, { ref: false }),
    ]);
  }
  if (!running(child)) return;
  await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: CLOSE_TIMEOUT_MS })
    .catch(error => { if (running(child)) throw error; });
  const deadline = Date.now() + CLOSE_TIMEOUT_MS;
  while (running(child) && Date.now() < deadline) await delay(POLL_MS);
  assert(!running(child), '本次开发进程尚未退出，保留隔离目录');
}

/** @param {string} profile @param {string} temporaryRoot */
async function removeProfile(profile, temporaryRoot) {
  const metadata = await lstat(profile);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), '拒绝清理链接或非目录');
  const actual = await realpath(profile);
  assert.equal(actual.toLowerCase(), path.resolve(profile).toLowerCase(), '隔离目录实际路径已变化');
  assert.equal(path.dirname(actual).toLowerCase(), temporaryRoot.toLowerCase(), '隔离目录不在本次临时根内');
  assert(path.basename(actual).startsWith(PROFILE_PREFIX), '拒绝清理非开发测试目录');
  assert.equal(await readFile(path.join(actual, 'test-isolation'), 'utf8'), ISOLATION_MARKER, '隔离标记不匹配');
  await rm(actual, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

async function main() {
  assert.equal(process.platform, 'win32', '开发模式回归仅支持 Windows WebView2');
  const npm = process.env.npm_execpath;
  assert(npm, '请通过 npm run test:dev 运行，以使用当前 npm 启动开发脚本');
  const temporaryRoot = await realpath(tmpdir());
  /** @type {Check[]} */
  const checks = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const blockedRequests = [];
  /** @type {ChildProcess|undefined} */
  let child;
  /** @type {Browser|undefined} */
  let browser;
  /** @type {Page|undefined} */
  let page;
  /** @type {string|undefined} */
  let profile;
  /** @type {Promise<void>|undefined} */
  let cleaning;
  /** @type {Promise<void>|undefined} */
  let stopping;
  let complete = false;
  let retainedProfile = false;
  let interrupted = false;
  let developmentLog = '';
  let cleanupError = '';
  // 在 CDP 接入之前也拦截浏览器外网请求；Rust native-test 使用隔离标记提供假凭据并拒绝真实网络。
  const proxy = createServer(socket => { socket.on('error', () => undefined); socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  const stop = () => stopping ??= child ? stopDevelopment(child, page) : Promise.resolve();
  const cleanup = () => cleaning ??= (async () => {
    let stopped = false;
    try { await stop(); stopped = true; }
    finally {
      await browser?.close().catch(() => undefined);
      await closeServer(proxy);
      if (profile) {
        retainedProfile = true;
        if (stopped && complete) { await removeProfile(profile, temporaryRoot); retainedProfile = false; }
      }
    }
  })();
  const interrupt = () => {
    interrupted = true;
    void stop().catch(error => { cleanupError = errorText(error); });
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  /** @param {string} name @param {() => Promise<unknown>} action */
  const check = async (name, action) => {
    assert(!interrupted, '开发模式回归已中断');
    try { const detail = await action(); checks.push({ name, ok: true, detail }); console.log(`通过：${name}`); }
    catch (error) { checks.push({ name, ok: false, error: errorText(error) }); throw error; }
  };
  try {
    await check('开发端口可用', requireFreeDevelopmentPort);
    profile = await mkdtemp(path.join(temporaryRoot, PROFILE_PREFIX));
    await markNativeIsolation(profile);
    const proxyPort = await listen(proxy);
    const debugPort = await availablePort();
    assert(!interrupted, '开发模式回归已中断');
    child = spawn(process.execPath, [npm, 'run', 'dev', '--', '--features', 'native-test', '--no-watch'], {
      cwd: DESKTOP_DIRECTORY,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SHIROHA_TEST_ROOT: profile,
        WEBVIEW2_USER_DATA_FOLDER: profile,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${debugPort} --proxy-server=http://127.0.0.1:${proxyPort} --proxy-bypass-list=127.0.0.1;localhost;tauri.localhost;ipc.localhost --disable-background-networking`,
      },
    });
    /** @type {Error|undefined} */
    let launchError;
    child.on('error', error => { launchError = error; });
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
      const text = String(chunk);
      developmentLog = (developmentLog + text).slice(-LOG_LIMIT);
      process.stdout.write(text);
    });
    const endpoint = await waitForDebugger(child, debugPort, () => launchError);
    browser = await chromium.connectOverCDP(endpoint, { timeout: ACTION_TIMEOUT_MS });
    const context = browser.contexts()[0];
    assert(context, '未取得本次 WebView2 context');
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (localResource(url)) await route.continue();
      else { blockedRequests.push(url); await route.abort('blockedbyclient'); }
    });
    page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: ACTION_TIMEOUT_MS });
    const activePage = page;
    activePage.setDefaultTimeout(ACTION_TIMEOUT_MS);
    activePage.on('pageerror', error => errors.push(error.message));
    await activePage.waitForURL(url => url.protocol === 'http:', { timeout: ACTION_TIMEOUT_MS });
    await check('实际开发来源', async () => {
      assert.equal(new URL(activePage.url()).origin, DEV_ORIGIN, '开发来源改变，需复核原生允许列表');
      return activePage.url();
    });
    // 重新加载使启动错误可观测；所有存储均为本脚本创建的空白测试 profile。
    await activePage.reload({ waitUntil: 'load' });
    await activePage.waitForFunction(() => Boolean((/** @type {TestWindow} */ (window)).ShirohaDesktopHost));
    await check('原始 local_initialize 调用', () => nativeState(activePage));
    await check('初始化完成且主界面解除锁定', () => assertReady(activePage));
    await check('首页、导入与设置导航可点击', async () => {
      for (const view of ['import', 'settings', 'dashboard']) {
        await activePage.locator(`.nav[data-view="${view}"]`).click();
        await activePage.locator(`#${view}.view.active`).waitFor({ state: 'visible' });
      }
      return { views: ['import', 'settings', 'dashboard'] };
    });
    await check('保存递增原生修订且重载后可读', async () => {
      const before = await nativeState(activePage);
      await activePage.locator('#save-all-btn').click();
      await activePage.waitForFunction(revision => {
        const storage = (/** @type {TestWindow} */ (window)).ShirohaPlatform?.storage;
        return storage && storage.revision() > revision;
      }, before.revision);
      await assertReady(activePage);
      const saved = await nativeState(activePage);
      assert(saved.revision > before.revision, '保存没有递增原生修订');
      assert(saved.hasData, '原生存储未写入数据');
      await activePage.reload({ waitUntil: 'load' });
      await assertReady(activePage);
      const reloaded = await nativeState(activePage);
      assert.equal(reloaded.revision, saved.revision, '重载后原生修订发生意外变化');
      assert(reloaded.hasData, '重载后未读取到已保存数据');
      return { before, saved, reloaded };
    });
    await check('无页面异常或外网请求', async () => {
      assert.deepEqual(errors, [], 'WebView2 存在未处理异常');
      assert.deepEqual(blockedRequests, [], '开发回归触发了外网请求');
      return { pageErrors: errors.length, blockedRequests: blockedRequests.length };
    });
    assert(!interrupted, '开发模式回归已中断');
    complete = true;
  } finally {
    await cleanup().catch(error => { cleanupError = errorText(error); });
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, JSON.stringify({
      measuredAt: new Date().toISOString(), complete: complete && !cleanupError && !interrupted,
      checks, profile, retainedProfile, cleanupError, interrupted, errors, blockedRequests, developmentLog,
    }, null, 2));
    console.log(`开发模式回归报告：${REPORT_PATH}`);
    if (retainedProfile) console.log(`保留本次隔离目录：${profile}`);
    if (cleanupError) console.error(`清理未完成：${cleanupError}`);
  }
  if (cleanupError) throw new Error(`清理未完成：${cleanupError}`);
}

main().catch(error => { console.error(errorText(error)); process.exitCode = 1; });
