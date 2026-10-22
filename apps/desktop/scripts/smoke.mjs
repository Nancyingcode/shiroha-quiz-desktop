import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const START_TIMEOUT_MS = 30_000;
const RESOURCE_TIMEOUT_MS = 120_000;
const CLOSE_TIMEOUT_MS = 8_000;
const POLL_MS = 200;
const PROFILE_PREFIX = 'shiroha-desktop-smoke-';
const FIXTURE_QUESTION = 'TAURI PROTOTYPE 1+1 = ?';
const SCREENSHOT_PATH = fileURLToPath(new URL('../.reports/prototype.png', import.meta.url));
const execute = promisify(execFile);

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {{name: string, ok: boolean, detail?: unknown, error?: string}} Check */
/** @typedef {{child: import('node:child_process').ChildProcess, browser: import('playwright-core').Browser, page: Page, errors: string[], blocked: string[], requests: string[]}} Runtime */
/** @typedef {{startup?: {promise?: Promise<void>}, typesetPromise: (nodes: Element[]) => Promise<void>}} MathApi */
/** @typedef {{recognize: (canvas: HTMLCanvasElement) => Promise<{data: {text: string, confidence: number}}>, terminate: () => Promise<void>}} OcrWorker */
/** @typedef {{createWorker: (language: string, mode: number, options: {workerPath: string, corePath: string, langPath: string, workerBlobURL: boolean, cacheMethod: string}) => Promise<OcrWorker>}} OcrApi */
/** @typedef {Window & {MathJax?: MathApi, Tesseract?: OcrApi, __smokeCsp?: string[]}} TestWindow */
/** @typedef {{getTextContent: () => Promise<{items: Array<{str?: string}>}>}} PdfPage */
/** @typedef {{promise: Promise<void>, port: unknown, destroy: () => void}} PdfWorker */
/** @typedef {{getPage: (page: number) => Promise<PdfPage>, destroy: () => Promise<void>}} PdfDocument */
/** @typedef {{data: Uint8Array, worker: PdfWorker, cMapUrl: string, cMapPacked: boolean, standardFontDataUrl: string, wasmUrl: string}} PdfOptions */
/** @typedef {{GlobalWorkerOptions: {workerSrc: string}, PDFWorker: new (options: {name: string}) => PdfWorker, getDocument: (options: PdfOptions) => {promise: Promise<PdfDocument>}}} PdfApi */

/** @param {unknown} error */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @template T @param {Promise<T>} operation @param {number} timeoutMs @returns {Promise<T>} */
async function deadline(operation, timeoutMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`操作超过 ${timeoutMs} ms`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** @param {import('node:net').Server} server */
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(undefined); });
  });
  const address = server.address();
  assert(address && typeof address !== 'string', '未取得回环端口');
  return address.port;
}

async function availablePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)));
  return port;
}

/** @param {import('node:child_process').ChildProcess} child */
function running(child) {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

/** @param {import('node:child_process').ChildProcess} child */
async function stopChild(child) {
  if (!running(child)) return;
  // 只关闭本脚本启动的 PID；正常关闭允许 WebView2 刷新本次隔离测试的存储。
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if($p){[void]$p.CloseMainWindow()}`,
  ], { windowsHide: true, timeout: CLOSE_TIMEOUT_MS }).catch(() => undefined);
  const end = Date.now() + CLOSE_TIMEOUT_MS;
  while (running(child) && Date.now() < end) await delay(POLL_MS);
  if (running(child)) {
    await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: CLOSE_TIMEOUT_MS });
    const forcedEnd = Date.now() + CLOSE_TIMEOUT_MS;
    while (running(child) && Date.now() < forcedEnd) await delay(POLL_MS);
    assert(!running(child), '测试进程仍在运行，未尝试清理其数据目录');
  }
}

/** @param {Runtime} runtime */
async function stop(runtime) {
  await stopChild(runtime.child);
  await runtime.browser.close().catch(() => undefined);
}

/** @param {string} url */
function localResource(url) {
  const parsed = new URL(url);
  return ['data:', 'blob:', 'ipc:'].includes(parsed.protocol)
    || (['http:', 'https:'].includes(parsed.protocol) && ['tauri.localhost', 'ipc.localhost'].includes(parsed.hostname))
    || (parsed.protocol === 'tauri:' && parsed.hostname === 'localhost');
}

/** @param {string} executable @param {string} profile @param {number} proxyPort @returns {Promise<Runtime>} */
async function launch(executable, profile, proxyPort) {
  const port = await availablePort();
  // 官方接入方式：https://playwright.dev/docs/webview2 。环境变量仅传给测试子进程，避免复用真实 profile 或改变系统调试设置。
  const child = spawn(executable, [], {
    cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port} --proxy-server=http://127.0.0.1:${proxyPort} --proxy-bypass-list=tauri.localhost;ipc.localhost --disable-background-networking`,
    },
  });
  /** @type {Error | undefined} */
  let launchError;
  child.on('error', error => { launchError = error; });
  /** @type {import('playwright-core').Browser | undefined} */
  let browser;
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    const end = Date.now() + START_TIMEOUT_MS;
    while (true) {
      if (launchError) throw launchError;
      assert(running(child), '桌面测试进程在 CDP 就绪前退出');
      const ready = await fetch(`${endpoint}/json/version`, { signal: globalThis.AbortSignal.timeout(1_000) }).then(response => response.ok).catch(() => false);
      if (ready) break;
      assert(Date.now() < end, 'WebView2 调试端口未就绪');
      await delay(POLL_MS);
    }
    browser = await chromium.connectOverCDP(endpoint, { timeout: START_TIMEOUT_MS });
    const context = browser.contexts()[0];
    assert(context, 'CDP 未返回 WebView2 context');
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const blocked = [];
    /** @type {string[]} */
    const requests = [];
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (localResource(url)) { requests.push(url); await route.continue(); }
      else { blocked.push(url); await route.abort('blockedbyclient'); }
    });
    const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: START_TIMEOUT_MS });
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(START_TIMEOUT_MS);
    await page.waitForURL(url => localResource(url.href) && !['about:', 'data:', 'blob:', 'ipc:'].includes(url.protocol), { timeout: START_TIMEOUT_MS });
    await page.addInitScript(() => {
      const target = /** @type {TestWindow} */ (window);
      target.__smokeCsp = [];
      document.addEventListener('securitypolicyviolation', event => target.__smokeCsp?.push(`${event.violatedDirective}: ${event.blockedURI}`));
    });
    // 接入完成后重新加载，确保启动错误与本地资源请求都落入监听范围。
    await page.reload({ waitUntil: 'load' });
    await page.locator('.app-splash').waitFor({ state: 'hidden' });
    return { child, browser, page, errors, blocked, requests };
  } catch (error) {
    await stopChild(child);
    await browser?.close().catch(() => undefined);
    throw error;
  }
}

function textPdf() {
  const content = 'BT /F1 24 Tf 30 100 Td (DESKTOP SMOKE) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Array.from(Buffer.from(pdf));
}

/** @param {Page} page */
async function mathSmoke(page) {
  const loaded = await page.evaluate(() => typeof (/** @type {TestWindow} */ (window)).MathJax?.typesetPromise === 'function');
  if (!loaded) {
    const script = page.locator('script[src$="/libs/mathjax/tex-mml-chtml.js"]');
    if (await script.count()) {
      await page.waitForFunction(() => typeof (/** @type {TestWindow} */ (window)).MathJax?.typesetPromise === 'function');
    } else await page.addScriptTag({ url: new URL('./libs/mathjax/tex-mml-chtml.js', page.url()).href });
  }
  return page.evaluate(async () => {
    const math = (/** @type {TestWindow} */ (window)).MathJax;
    if (!math) throw new Error('本地 MathJax 未加载');
    await math.startup?.promise;
    const node = document.createElement('div');
    node.textContent = '\\(x^2 + 1\\)';
    document.body.append(node);
    try {
      await math.typesetPromise([node]);
      if (!node.querySelector('mjx-container')) throw new Error('公式未生成 MathJax 输出');
      return { rendered: true };
    } finally { node.remove(); }
  });
}

/** @param {Page} page */
async function pdfSmoke(page) {
  return page.evaluate(async bytes => {
    const moduleUrl = new URL('./libs/pdf.min.mjs', location.href).href;
    const pdf = /** @type {PdfApi} */ (await import(moduleUrl));
    pdf.GlobalWorkerOptions.workerSrc = new URL('./libs/pdf.worker.min.mjs', location.href).href;
    const worker = new pdf.PDFWorker({ name: 'desktop-smoke' });
    try {
      await worker.promise;
      if (!(worker.port instanceof window.Worker)) throw new Error('PDF.js 降级为 fake worker，未证明模块 Worker 可用');
      const base = new URL('./libs/', location.href).href;
      const document = await pdf.getDocument({ data: new Uint8Array(bytes), worker, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/` }).promise;
      try {
        const page = await document.getPage(1);
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str ?? '').join(' ');
        if (!text.includes('DESKTOP SMOKE')) throw new Error('最小 PDF 文本提取失败');
        return { text, realWorker: true };
      } finally { await document.destroy(); }
    } finally { worker.destroy(); }
  }, textPdf());
}

/** @param {Page} page */
async function ocrSmoke(page) {
  await page.addScriptTag({ url: new URL('./libs/ocr/tesseract/tesseract.min.js', page.url()).href });
  return page.evaluate(async () => {
    const tesseract = (/** @type {TestWindow} */ (window)).Tesseract;
    if (!tesseract) throw new Error('本地 Tesseract 未加载');
    const base = new URL('./libs/ocr/', location.href).href;
    // 禁用语言缓存，防止“缓存命中”掩盖安装包遗漏 eng 语言资源。
    const worker = await tesseract.createWorker('eng', 1, { workerPath: `${base}tesseract/worker.min.js`, corePath: `${base}core`, langPath: `${base}lang`, workerBlobURL: true, cacheMethod: 'none' });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 600; canvas.height = 180;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D 不可用');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000'; context.font = '100px Arial'; context.fillText('TEST', 40, 125);
      const { data } = await worker.recognize(canvas);
      if (!data.text.trim()) throw new Error('OCR 未返回非空文本');
      return { text: data.text.trim(), confidence: data.confidence };
    } finally { await worker.terminate(); }
  });
}

/** @param {Page} page @param {string} bankName */
async function practiceImportedBank(page, bankName) {
  const option = page.locator('#active-bank-select option').filter({ hasText: bankName });
  await option.waitFor({ state: 'attached' });
  const bankId = await option.getAttribute('value');
  assert(bankId, '题库选择器没有导入题库');
  await page.locator('#active-bank-select').selectOption(bankId);
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-source').selectOption('all');
  await page.locator('#practice-type').selectOption('all');
  await page.locator('#practice-limit').selectOption('all');
  await page.locator('#start-practice-btn').click();
  await page.locator('#practice-card').getByText(FIXTURE_QUESTION, { exact: true }).waitFor({ state: 'visible' });
  assert.match(await page.locator('#practice-progress').innerText(), /1\s*\/\s*1/);
  return { bankId, question: FIXTURE_QUESTION };
}

/** @param {Page} page @param {string} bankName */
async function importAndPractice(page, bankName) {
  // 用实际导入与练习控件证明业务保存链路，避免直接写入应用 state 掩盖绑定或持久化错误。
  await page.locator('.nav[data-view="import"]').click();
  await page.locator('#import-bank-name').fill(bankName);
  await page.locator('#import-mode').selectOption('json');
  await page.locator('#import-save-mode-v59').selectOption('new');
  await page.locator('#import-text').fill(JSON.stringify({ questions: [{
    type: 'single', question: FIXTURE_QUESTION,
    options: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }],
    answer: ['A'], analysis: '1 + 1 = 2',
  }] }));
  await page.locator('#parse-import-btn').click();
  await page.locator('#import-preview tbody tr').filter({ hasText: FIXTURE_QUESTION }).waitFor({ state: 'visible' });
  await page.locator('#confirm-import-btn').click();
  const result = await practiceImportedBank(page, bankName);
  await page.locator('#app-toast .toast-item').first().waitFor({ state: 'hidden' });
  await mkdir(path.dirname(SCREENSHOT_PATH), { recursive: true });
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  return { ...result, screenshot: SCREENSHOT_PATH };
}

async function main() {
  assert.equal(process.platform, 'win32', '此 smoke 仅支持 Windows WebView2');
  const argument = process.argv[2];
  assert(argument && process.argv.length === 3, '用法：node apps/desktop/scripts/smoke.mjs <已构建的 exe 路径>');
  const executable = await realpath(path.resolve(argument));
  assert(/\.exe$/i.test(executable) && (await stat(executable)).isFile(), '参数必须是现有 EXE');
  const tempRoot = await realpath(tmpdir());
  const profile = await mkdtemp(path.join(tempRoot, PROFILE_PREFIX));
  /** @type {Check[]} */
  const checks = [];
  /** @type {Runtime | undefined} */
  let runtime;
  /** @type {Promise<void> | undefined} */
  let cleaning;
  // CDP 连接前也拒绝互联网流量；代理不转发任何请求，不依赖系统代理或用户网络设置。
  const proxy = createServer(socket => { socket.on('error', () => undefined); socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); });
  const cleanup = () => cleaning ??= (async () => {
    if (runtime) await stop(runtime);
    proxy.close();
    const actual = await realpath(profile);
    assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
    assert(path.basename(actual).startsWith(PROFILE_PREFIX), '拒绝清理非测试目录');
    await rm(actual, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  })();
  const interrupt = () => { void cleanup().then(() => process.exit(130), error => { console.error(errorText(error)); process.exit(1); }); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  /** @param {string} name @param {() => Promise<unknown>} action */
  const check = async (name, action) => {
    try { checks.push({ name, ok: true, detail: await deadline(action(), RESOURCE_TIMEOUT_MS) }); }
    catch (error) { checks.push({ name, ok: false, error: errorText(error) }); }
  };
  try {
    const proxyPort = await listen(proxy);
    runtime = await launch(executable, profile, proxyPort);
    const { page } = runtime;
    await check('启动资源与按需插画', async () => {
      assert.equal(await page.locator('.app-splash').count(), 0, '桌面不应保留启动遮罩');
      const initial = await page.evaluate(() => window.performance.getEntriesByType('resource').map(entry => entry.name));
      assert(!initial.some(url => /home_welcome_avatar|import_question_bank_folder/.test(url)), '首页提前加载了非首页插画');
      await page.locator('.nav[data-view="import"]').click();
      const art = page.locator('#import img.import-art-main');
      await art.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const img = document.querySelector('#import img.import-art-main');
        return img instanceof window.HTMLImageElement && img.complete && img.naturalWidth > 0;
      });
      await page.locator('.nav[data-view="dashboard"]').click();
      return { splashRemoved: true, deferredImageLoaded: true };
    });
    await check('页面与导航', async () => {
      assert.match(await page.title(), /Shiroha Quiz/);
      await page.locator('.nav[data-view="dashboard"]').click();
      await page.locator('.dashboard-action-card.blue').click();
      await page.locator('#practice.view.active').waitFor({ state: 'visible' });
      await page.locator('.nav[data-view="settings"]').click();
      await page.locator('#settings.view.active').waitFor({ state: 'visible' });
      return { title: await page.title(), origin: new URL(page.url()).origin };
    });
    const marker = { key: `${PROFILE_PREFIX}${randomUUID()}`, value: randomUUID() };
    const bankName = `桌面原型验证-${randomUUID().slice(0, 8)}`;
    await check('LocalStorage 写入回读', async () => page.evaluate(({ key, value }) => {
      localStorage.setItem(key, value);
      if (localStorage.getItem(key) !== value) throw new Error('LocalStorage 即时回读失败');
      return { readable: true };
    }, marker));
    await check('界面导入题库并练习', () => importAndPractice(page, bankName));
    await check('MathJax 本地公式', () => mathSmoke(page));
    await check('PDF.js 本地模块与 Worker', () => pdfSmoke(page));
    await check('Tesseract 本地 OCR', () => ocrSmoke(page));
    const first = runtime;
    await check('离线与脚本错误', async () => {
      const violations = await page.evaluate(() => (/** @type {TestWindow} */ (window)).__smokeCsp ?? []);
      assert.deepEqual(first.errors, [], '出现未捕获 JS 错误');
      assert.deepEqual(violations, [], '出现 CSP 违例');
      assert.deepEqual(first.blocked, [], '应用尝试请求远程资源');
      return { localRequests: first.requests.length, remoteRequests: first.blocked.length, jsErrors: first.errors.length };
    });
    await stop(runtime); runtime = undefined;
    runtime = await launch(executable, profile, proxyPort);
    const restarted = runtime;
    await check('重启后数据保留', async () => {
      await restarted.page.evaluate(({ key, value }) => {
        if (localStorage.getItem(key) !== value) throw new Error('重启后 LocalStorage 值不匹配');
        localStorage.removeItem(key);
      }, marker);
      assert.deepEqual(restarted.errors, [], '重启出现 JS 错误');
      return { persisted: true };
    });
    await check('重启后题库仍可练习', async () => {
      const result = await practiceImportedBank(restarted.page, bankName);
      assert.deepEqual(restarted.errors, [], '重启练习出现 JS 错误');
      assert.deepEqual(restarted.blocked, [], '重启练习尝试请求远程资源');
      return { ...result, persisted: true };
    });
  } catch (error) { checks.push({ name: '启动或运行', ok: false, error: errorText(error) }); }
  finally {
    try { await cleanup(); }
    catch (error) { checks.push({ name: '隔离资源清理', ok: false, error: errorText(error), detail: { profile } }); }
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  }
  const ok = checks.length > 0 && checks.every(result => result.ok);
  console.log(JSON.stringify({ ok, executable, checks }));
  process.exitCode = ok ? 0 : 1;
}

await main().catch(error => { console.log(JSON.stringify({ ok: false, error: errorText(error) })); process.exitCode = 1; });
