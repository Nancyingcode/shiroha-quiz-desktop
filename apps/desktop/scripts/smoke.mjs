import assert from 'node:assert/strict';
import { markNativeIsolation } from './native-isolation.mjs';
import { createNativeMock, nativeServiceSmoke } from './network-smoke.mjs';
import { documentSmoke } from './document-smoke.mjs';
import { harnessSmoke, harnessSwitchingSmoke } from './harness-smoke.mjs';
import { codebuddyLoginSmoke, codebuddyLoginAfterRestart, codebuddyLoginPersistenceSmoke } from './codebuddy-login-smoke.mjs';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, stat, readFile, writeFile } from 'node:fs/promises';
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
const PROFILE_PREFIX = 'shiroha-native-smoke-';
const FIXTURE_QUESTION = 'TAURI PROTOTYPE 1+1 = ?';
const SCREENSHOT_PATH = fileURLToPath(new URL('../.reports/prototype.png', import.meta.url));
const VISUAL_WINDOW_SIZES = [
  { name: 'default', width: 1280, height: 860 },
  { name: 'minimum', width: 900, height: 640 },
  { name: 'wide', width: 1600, height: 1000 },
];
const execute = promisify(execFile);

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {{name: string, ok: boolean, detail?: unknown, error?: string}} Check */
/** @typedef {{child: import('node:child_process').ChildProcess, browser: import('playwright-core').Browser, page: Page, errors: string[], blocked: string[], requests: string[], nativeHandle?: number}} Runtime */
/** @typedef {{startup?: {promise?: Promise<void>}, typesetPromise: (nodes: Element[]) => Promise<void>}} MathApi */
/** @typedef {{recognize: (canvas: HTMLCanvasElement) => Promise<{data: {text: string, confidence: number}}>, terminate: () => Promise<void>}} OcrWorker */
/** @typedef {{createWorker: (language: string, mode: number, options: {workerPath: string, corePath: string, langPath: string, workerBlobURL: boolean, cacheMethod: string}) => Promise<OcrWorker>}} OcrApi */
/** @typedef {Window & {MathJax?: MathApi, Tesseract?: OcrApi, __smokeCsp?: string[]}} TestWindow */
/** @typedef {Window & {ShirohaDesktopHost?: {invoke(command:string,args?:Record<string,unknown>):Promise<unknown>}}} NativeTestWindow */
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
      SHIROHA_TEST_ROOT: profile,
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

/** @param {Runtime} runtime @param {{width: number, height: number}} size */
async function resizeTestWindow(runtime, size) {
  assert(running(runtime.child), '测试进程已退出，拒绝调整窗口');
  assert(Number.isInteger(size.width) && size.width > 0 && Number.isInteger(size.height) && size.height > 0, '窗口尺寸必须是正整数');
  // CDP 的 viewport 仿真不等于原生窗口变化；仅调整本脚本持有的子进程窗口，按其 DPI 换算客户区。
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SmokeWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClientRect(IntPtr hWnd, out Rect rect);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@
[void][SmokeWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
$smokeProcess=Get-Process -Id ${runtime.child.pid} -ErrorAction Stop
$smokeWindow=$smokeProcess.MainWindowHandle
if($smokeWindow -eq [IntPtr]::Zero){throw '测试进程没有主窗口'}
$smokeOuter=New-Object SmokeWindow+Rect
$smokeClient=New-Object SmokeWindow+Rect
if(-not [SmokeWindow]::GetWindowRect($smokeWindow,[ref]$smokeOuter)){throw '无法读取测试窗口尺寸'}
if(-not [SmokeWindow]::GetClientRect($smokeWindow,[ref]$smokeClient)){throw '无法读取测试客户区尺寸'}
$smokeDpi=[SmokeWindow]::GetDpiForWindow($smokeWindow)
if($smokeDpi -eq 0){throw '无法读取测试窗口 DPI'}
$smokeWidth=[int][Math]::Round(${size.width}*$smokeDpi/96)+($smokeOuter.Right-$smokeOuter.Left)-($smokeClient.Right-$smokeClient.Left)
$smokeHeight=[int][Math]::Round(${size.height}*$smokeDpi/96)+($smokeOuter.Bottom-$smokeOuter.Top)-($smokeClient.Bottom-$smokeClient.Top)
if(-not [SmokeWindow]::SetWindowPos($smokeWindow,[IntPtr]::Zero,0,0,$smokeWidth,$smokeHeight,0x0016)){throw '调整测试窗口失败'}
`], { windowsHide: true, timeout: START_TIMEOUT_MS });
  await runtime.page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
}

/** @param {Page} page @param {string} screenshotName */
async function visualLayout(page, screenshotName) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => undefined))));
  const layout = await page.evaluate(() => {
    const main = document.querySelector('.main');
    const side = document.querySelector('.side');
    const active = document.querySelector('.view.active');
    if (!main || !side || !active) throw new Error('没有找到桌面布局主体');
    const focus = document.body.classList.contains('practice-focus') || document.body.classList.contains('exam-focus');
    const collapsed = document.body.classList.contains('side-collapsed');
    const sideStyle = window.getComputedStyle(side);
    const color = sideStyle.backgroundColor;
    const backgroundAlpha = color === 'transparent' ? 0 : color.startsWith('rgba(') ? Number(color.slice(color.lastIndexOf(',') + 1, -1)) : 1;
    const rect = active.getBoundingClientRect();
    const caption = document.getElementById('desktop-titlebar');
    const captionRect = caption?.getBoundingClientRect();
    const sideRect = side.getBoundingClientRect();
    const toggle = document.getElementById('sidebar-toggle');
    const toggleRect = toggle?.getBoundingClientRect();
    const titleRect = document.querySelector('#desktop-window-drag span')?.getBoundingClientRect();
    const controlsRect = document.querySelector('.desktop-window-controls')?.getBoundingClientRect();
    if (!toggle || !toggleRect || !titleRect || !captionRect || !controlsRect) throw new Error('没有找到标题文字、导航开关或窗口控制区');
    const toggleHit = document.elementFromPoint(toggleRect.left + toggleRect.width / 2, toggleRect.top + toggleRect.height / 2);
    const navigationFits = Array.from(side.querySelectorAll('.nav')).every(item => {
      const itemRect = item.getBoundingClientRect();
      return itemRect.left >= sideRect.left && itemRect.right <= sideRect.right + 1
        && itemRect.top >= sideRect.top - 1 && itemRect.bottom <= Math.min(sideRect.bottom, window.innerHeight) + 1;
    });
    return {
      view: active.id,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      mainLeft: main.getBoundingClientRect().left,
      mainWidth: main.getBoundingClientRect().width,
      navigationRight: side.getBoundingClientRect().right,
      contentLeft: rect.left, contentRight: rect.right,
      focus, collapsed,
      navigationTransparent: backgroundAlpha === 0 && sideStyle.backgroundImage === 'none',
      navigationHasShadow: sideStyle.boxShadow !== 'none',
      navigationFits,
      navigationToggle: {
        left: toggleRect.left, top: toggleRect.top, width: toggleRect.width, height: toggleRect.height,
        titleGap: toggleRect.left - titleRect.right,
        insideTitlebar: toggleRect.top >= captionRect.top && toggleRect.bottom <= captionRect.bottom,
        beforeWindowControls: toggleRect.right <= controlsRect.left,
        receivesPointer: toggle === toggleHit || toggle.contains(toggleHit),
      },
      titlebarHeight: captionRect?.height ?? 0,
      titlebarAtTop: captionRect?.top === 0,
      navigationBrandCount: side.querySelectorAll('.brand').length,
    };
  });
  const screenshot = path.join(path.dirname(SCREENSHOT_PATH), screenshotName);
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  assert(layout.horizontalOverflow <= 1, `${layout.view} 出现页面级横向溢出：${JSON.stringify(layout)}`);
  assert.equal(layout.titlebarHeight, 36, '沉浸标题栏高度不正确');
  assert(layout.titlebarAtTop, '沉浸标题栏未固定在顶部');
  assert(layout.navigationToggle.titleGap >= 4 && layout.navigationToggle.titleGap <= 16, '导航开关没有紧邻标题文字右侧');
  assert(layout.navigationToggle.insideTitlebar && layout.navigationToggle.beforeWindowControls, '导航开关越过标题栏或覆盖窗口控制区');
  assert(layout.navigationToggle.width >= 28 && layout.navigationToggle.height >= 28 && layout.navigationToggle.receivesPointer, '导航开关点击区域不足或被标题栏遮挡');
  assert.equal(layout.navigationBrandCount, 0, '导航不应重复显示品牌区');
  assert(layout.contentLeft >= -1 && layout.contentRight <= layout.viewport.width + 1, `${layout.view} 正文越过可视宽度：${JSON.stringify(layout)}`);
  if (!layout.focus && !layout.collapsed) {
    assert(layout.navigationTransparent, '普通页面导航出现独立背景');
    assert(!layout.navigationHasShadow, '普通页面导航出现独立阴影');
    assert(layout.mainLeft >= layout.navigationRight - 1, `${layout.view} 导航与正文边界重叠：${JSON.stringify(layout)}`);
  }
  if (!layout.collapsed) assert(layout.navigationFits, '导航文字越过侧栏可视边界');
  if (layout.focus && !layout.collapsed) assert(!layout.navigationTransparent, '专注模式临时导航缺少阅读底色');
  return { ...layout, screenshot };
}

/** @param {Runtime} runtime @param {boolean} [restore] */
async function nativeWindowState(runtime, restore = false) {
  assert(running(runtime.child), '测试窗口已退出');
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CaptionWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
}
'@
$captionWindow=${runtime.nativeHandle ? `[IntPtr]${runtime.nativeHandle}` : `(Get-Process -Id ${runtime.child.pid} -ErrorAction Stop).MainWindowHandle`}
if($captionWindow -eq [IntPtr]::Zero){throw '测试窗口不存在'}
$captionOwner=0
[void][CaptionWindow]::GetWindowThreadProcessId($captionWindow,[ref]$captionOwner)
if($captionOwner -ne ${runtime.child.pid}){throw '窗口不属于测试进程'}
${restore ? '[void][CaptionWindow]::ShowWindow($captionWindow,9)' : ''}
[void][CaptionWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
$captionRect=New-Object CaptionWindow+Rect
if(-not [CaptionWindow]::GetWindowRect($captionWindow,[ref]$captionRect)){throw '无法读取测试窗口位置'}
@{handle=$captionWindow.ToInt64();x=$captionRect.Left;y=$captionRect.Top;minimized=[CaptionWindow]::IsIconic($captionWindow);maximized=[CaptionWindow]::IsZoomed($captionWindow)} | ConvertTo-Json -Compress
`], { windowsHide: true, timeout: START_TIMEOUT_MS });
  const state = /** @type {{handle: number, x: number, y: number, minimized: boolean, maximized: boolean}} */ (JSON.parse(stdout));
  // 最小化后 .NET MainWindowHandle 可能选中辅助窗口；句柄仅保存在本次隔离进程生命周期内。
  runtime.nativeHandle = state.handle;
  return state;
}

/** @param {Runtime} runtime */
async function titlebarSmoke(runtime) {
  const { page } = runtime;
  await page.locator('#desktop-window-maximize:not([disabled])').waitFor();
  await page.locator('#desktop-window-maximize').click();
  await page.waitForFunction(() => document.getElementById('desktop-titlebar')?.dataset.maximized === 'true');
  assert((await nativeWindowState(runtime)).maximized, '最大化按钮未改变原生窗口状态');
  await page.screenshot({ path: path.join(path.dirname(SCREENSHOT_PATH), 'titlebar-maximized.png') });
  await page.locator('#desktop-window-maximize').click();
  await page.waitForFunction(() => document.getElementById('desktop-titlebar')?.dataset.maximized === 'false');
  assert(!(await nativeWindowState(runtime)).maximized, '还原按钮未还原原生窗口');
  await page.locator('#desktop-window-drag').dispatchEvent('mousedown', { button: 0, detail: 2 });
  await page.waitForFunction(() => document.getElementById('desktop-titlebar')?.dataset.maximized === 'true');
  assert((await nativeWindowState(runtime)).maximized, '标题双击未最大化原生窗口');
  await page.locator('#desktop-window-maximize').click();
  await page.waitForFunction(() => document.getElementById('desktop-titlebar')?.dataset.maximized === 'false');
  assert(!(await nativeWindowState(runtime)).maximized, '双击最大化后还原失败');
  const collapsedBeforeDoubleClick = await page.locator('body.side-collapsed').count();
  await page.locator('#sidebar-toggle').dblclick();
  assert.equal(await page.locator('body.side-collapsed').count(), collapsedBeforeDoubleClick, '双击导航开关未完成两次切换');
  assert(!(await nativeWindowState(runtime)).maximized, '双击导航开关错误触发了窗口最大化');
  await page.locator('#desktop-window-minimize').click();
  let minimized = (await nativeWindowState(runtime)).minimized;
  const minimizeDeadline = Date.now() + CLOSE_TIMEOUT_MS;
  while (!minimized && Date.now() < minimizeDeadline) {
    await delay(POLL_MS);
    minimized = (await nativeWindowState(runtime)).minimized;
  }
  assert(minimized, `最小化按钮未最小化原生窗口：${await page.locator('#desktop-window-status').textContent()}`);
  await nativeWindowState(runtime, true);
  await page.locator('#desktop-window-maximize:not([disabled])').waitFor();
  assert(await page.locator('#desktop-window-status').isHidden(), '窗口控制报告错误');
  assert.equal(await page.locator('.side .brand').count(), 0);
  return { maximize: true, restore: true, doubleClickHandler: true, navigationDoubleClickIsolated: true, minimize: true, navigationBrandRemoved: true };
}

/** @param {Page} page @param {string} label */
async function navigationTooltipSmoke(page, label) {
  const toggle = page.locator('#sidebar-toggle');
  await toggle.hover();
  await page.waitForFunction(expected => {
    const node = document.getElementById('sidebar-toggle');
    if (!node) return false;
    const tooltip = window.getComputedStyle(node, '::after');
    return node.matches(':hover') && tooltip.content.includes(expected)
      && Number(tooltip.opacity) >= 0.99 && tooltip.visibility !== 'hidden';
  }, label);
  assert.equal(await toggle.getAttribute('aria-label'), label, '导航开关的悬停提示与可访问名称不一致');
  return { label, visible: true };
}

/** @param {Page} page */
async function navigationKeyboardSmoke(page) {
  const toggle = page.locator('#sidebar-toggle');
  assert.equal(await page.locator('body.side-collapsed').count(), 0, '键盘验证应从展开导航开始');
  await toggle.focus();
  await toggle.press('Enter');
  await page.waitForFunction(() => document.body.classList.contains('side-collapsed'));
  assert.equal(await toggle.getAttribute('aria-label'), '展开左侧导航');
  assert(await toggle.evaluate(node => node === document.activeElement && node.matches(':focus-visible')), 'Enter 切换后导航开关丢失键盘焦点');
  await page.waitForFunction(() => {
    const node = document.getElementById('sidebar-toggle');
    return !!node && window.getComputedStyle(node, '::after').content.includes('展开左侧导航')
      && Number(window.getComputedStyle(node, '::after').opacity) >= 0.99;
  });
  await toggle.press('Space');
  await page.waitForFunction(() => !document.body.classList.contains('side-collapsed'));
  assert.equal(await toggle.getAttribute('aria-label'), '收起左侧导航');
  assert(await toggle.evaluate(node => node === document.activeElement && node.matches(':focus-visible')), 'Space 切换后导航开关丢失键盘焦点');
  await toggle.evaluate(node => node.blur());
  return { enterCollapsed: true, spaceExpanded: true, focusRetained: true, focusTooltipVisible: true };
}

/** @param {Page} page */
async function toggleNavigationMotion(page) {
  return page.evaluate(async () => {
    const main = document.querySelector('.main');
    const app = document.querySelector('.app');
    const side = document.querySelector('.side');
    const toggle = document.getElementById('sidebar-toggle');
    if (!main || !app || !side || !toggle) throw new Error('没有找到导航切换布局');
    const start = main.getBoundingClientRect().left;
    toggle.click();
    const positions = [main.getBoundingClientRect().left];
    const animations = [...app.getAnimations(), ...main.getAnimations()];
    const end = window.performance.now() + 1_000;
    do {
      await new Promise(resolve => window.requestAnimationFrame(resolve));
      positions.push(main.getBoundingClientRect().left);
    } while (animations.some(animation => animation.playState === 'running') && window.performance.now() < end);
    const finish = positions.at(-1) ?? start;
    return {
      start, finish,
      intermediateFrames: positions.filter(left => left > Math.min(start, finish) + 1 && left < Math.max(start, finish) - 1).length,
      animationCount: animations.length,
      completed: animations.every(animation => animation.playState !== 'running'),
      navigationVisibility: window.getComputedStyle(side).visibility,
    };
  });
}

/** @param {Page} page */
async function scrollbarSmoke(page) {
  const input = page.locator('#import-text');
  const original = await input.inputValue();
  const scrollTop = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
  try {
    await input.fill(Array.from({ length: 80 }, (_, index) => `滚动验证 ${index + 1}`).join('\n'));
    await input.scrollIntoViewIfNeeded();
    const styles = await input.evaluate(node => [document.documentElement, node].map(element => {
      const scrollbar = window.getComputedStyle(element, '::-webkit-scrollbar');
      const thumb = window.getComputedStyle(element, '::-webkit-scrollbar-thumb');
      const track = window.getComputedStyle(element, '::-webkit-scrollbar-track');
      const button = window.getComputedStyle(element, '::-webkit-scrollbar-button');
      return { element: element.tagName, width: Number.parseFloat(scrollbar.width), color: thumb.backgroundColor, radius: Number.parseFloat(thumb.borderRadius), track: track.backgroundColor, buttonDisplay: button.display };
    }));
    for (const style of styles) {
      assert(style.width > 0 && style.width <= 10, `${style.element} 滚动条过宽或被隐藏`);
      const channels = style.color.match(/[\d.]+/g)?.map(Number).slice(0, 3) ?? [];
      assert(channels.length === 3 && Math.min(...channels) >= 150 && Math.max(...channels) <= 230 && Math.max(...channels) - Math.min(...channels) <= 20, `${style.element} 滑块未使用浅灰色`);
      assert(style.radius > 0, `${style.element} 滑块缺少圆角`);
      assert(['transparent', 'rgba(0, 0, 0, 0)'].includes(style.track), `${style.element} 滚动轨道不透明`);
      assert.equal(style.buttonDisplay, 'none', `${style.element} 滚动条仍显示箭头按钮`);
    }
    await input.evaluate(node => { node.scrollTop = 0; });
    await input.hover();
    await page.mouse.wheel(0, 360);
    await page.waitForFunction(() => (document.getElementById('import-text')?.scrollTop ?? 0) > 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    await page.mouse.move(viewport.width - 30, viewport.height / 2);
    await page.mouse.wheel(0, 360);
    await page.waitForFunction(() => (document.scrollingElement?.scrollTop ?? 0) > 0);
    return { styles, pageScrolled: true, textareaScrolled: true };
  } finally {
    await input.fill(original);
    await page.evaluate(top => window.scrollTo(0, top), scrollTop);
  }
}

/** @param {Runtime} runtime */
async function desktopVisualSmoke(runtime) {
  const { page } = runtime;
  await page.locator('body.desktop-mist-blue').waitFor({ state: 'attached' });
  assert(await page.evaluate(() => Array.from(document.styleSheets).some(sheet => sheet.href && new URL(sheet.href).pathname.endsWith('/desktop.css') && sheet.cssRules.length > 0)), '桌面本地样式未加载');
  const original = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const snapshots = [];
  let scrollbars;
  let navigationKeyboard;
  const navigationTooltips = [];
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const size of VISUAL_WINDOW_SIZES) {
      await resizeTestWindow(runtime, size);
      await page.locator('.nav[data-view="dashboard"]').click();
      for (const selector of ['#home-version-label', '#stat-total', '#stat-wrong', '#stat-records', '#stat-today-count', '#stat-today-rate', '#stat-review-due', '#stat-total-practice']) {
        const text = page.locator(selector);
        assert(await text.isVisible() && (await text.innerText()).trim(), `首页文字不可见或为空：${selector}`);
      }
      const home = await visualLayout(page, `mist-blue-home-${size.name}.png`);
      if (size.name === 'default') navigationTooltips.push(await navigationTooltipSmoke(page, '收起左侧导航'));
      const collapseMotion = await toggleNavigationMotion(page);
      await page.waitForFunction(() => document.body.classList.contains('side-collapsed'));
      const collapsed = await visualLayout(page, `mist-blue-home-${size.name}-collapsed.png`);
      assert(Math.abs(home.navigationToggle.left - collapsed.navigationToggle.left) <= 1 && Math.abs(home.navigationToggle.top - collapsed.navigationToggle.top) <= 1, '收起导航导致标题栏开关位置移动');
      if (size.name === 'default') navigationTooltips.push(await navigationTooltipSmoke(page, '展开左侧导航'));
      assert(home.mainLeft - collapsed.mainLeft > 100 && collapsed.mainWidth - home.mainWidth > 100, '普通页面收起导航后正文没有左移并扩展');
      assert(collapseMotion.completed && collapseMotion.intermediateFrames > 0, '收起导航缺少正文连续移动的动画');
      const expandMotion = await toggleNavigationMotion(page);
      await page.waitForFunction(() => !document.body.classList.contains('side-collapsed'));
      assert(expandMotion.completed && expandMotion.intermediateFrames > 0 && Math.abs(expandMotion.finish - home.mainLeft) <= 1, '展开导航动画未恢复正文位置');
      if (size.name === 'default') {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const reducedMotion = await toggleNavigationMotion(page);
        assert(reducedMotion.animationCount === 0 && reducedMotion.intermediateFrames === 0 && Math.abs(reducedMotion.finish - collapsed.mainLeft) <= 1, '减少动态效果时收起导航仍有动画或未完成布局');
        assert.equal(reducedMotion.navigationVisibility, 'hidden', '减少动态效果时导航未立即隐藏');
        await toggleNavigationMotion(page);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.mouse.move(home.viewport.width / 2, 80);
        navigationKeyboard = await navigationKeyboardSmoke(page);
      }
      await page.locator('.nav[data-view="import"]').click();
      await page.locator('#import.view.active').waitFor({ state: 'visible' });
      const importLayout = await visualLayout(page, `mist-blue-import-${size.name}.png`);
      if (size.name === 'minimum') scrollbars = await scrollbarSmoke(page);
      snapshots.push({ requestedWindow: size, home, collapsed, collapseMotion, expandMotion, import: importLayout });
    }
  } finally {
    await page.emulateMedia({ reducedMotion: null });
    await resizeTestWindow(runtime, original);
    if (await page.locator('body.side-collapsed').count()) await page.locator('#sidebar-toggle').click();
    await page.locator('.nav[data-view="dashboard"]').click();
  }
  return { nativeWindowResized: true, scrollbars, navigationKeyboard, navigationTooltips, snapshots };
}

/** @param {Page} page */
async function notificationVisualSmoke(page) {
  const original = await page.evaluate(() => ['platform-status', 'desktop-window-status', 'import-summary'].map(id => {
    const node = document.getElementById(id);
    return { id, exists: !!node, hidden: node?.hidden ?? true, text: node?.textContent ?? '', className: node?.className ?? '' };
  }));
  const input = page.locator('#import-text'), mode = page.locator('#import-mode');
  const importState = { text: await input.inputValue(), mode: await mode.inputValue(), view: await page.locator('.view.active').getAttribute('id') };
  /** @param {string} type @param {string} title */
  const markNotice = async (type, title) => page.locator(`#app-toast .toast-item.${type}:not([data-visual-smoke])`).last().evaluate((node, fixture) => {
    node.setAttribute('data-visual-smoke', fixture.type);
    const heading = node.querySelector('b'), paragraph = node.querySelector('p');
    if (!heading || !paragraph) throw new Error('业务通知缺少标题或正文');
    heading.textContent = fixture.title;
    paragraph.textContent = `通知外观验证：${'QuizBackupFilename'.repeat(8)}.json`;
  }, { type, title });
  /** @param {string} selector */
  const appearance = async selector => page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    const style = window.getComputedStyle(node), rect = node.getBoundingClientRect();
    const paragraph = node.querySelector('p');
    return { background: style.backgroundColor, border: Number.parseFloat(style.borderTopWidth), radius: Number.parseFloat(style.borderRadius), shadow: style.boxShadow,
      fits: rect.left >= 0 && rect.right <= window.innerWidth + 1 && rect.top >= (document.getElementById('desktop-titlebar')?.getBoundingClientRect().bottom ?? 0) && rect.bottom <= window.innerHeight + 1 && node.scrollWidth <= node.clientWidth + 1,
      wrapped: !paragraph || paragraph.getBoundingClientRect().height > Number.parseFloat(window.getComputedStyle(paragraph).lineHeight) * 1.5 };
  }));
  /** @param {Awaited<ReturnType<typeof appearance>>} styles */
  const verify = styles => styles.forEach(style => {
    const channels = style.background.match(/[\d.]+/g)?.map(Number).slice(0, 3) ?? [];
    assert(channels.length === 3 && Math.min(...channels) >= 240 && channels[2] > channels[0], '通知未使用浅雾蓝底色');
    assert(style.border > 0 && style.border <= 1 && style.radius >= 10, '通知缺少细边框或圆角');
    assert(style.shadow === 'none' || Number(style.shadow.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1]) <= 0.15, '通知阴影过重');
    assert(style.fits && style.wrapped, '通知越过视口、标题栏或长文件名未换行');
  });
  const screenshot = path.join(path.dirname(SCREENSHOT_PATH), 'mist-blue-notifications.png');
  try {
    await page.locator('.nav[data-view="import"]').click();
    await input.fill(''); await mode.selectOption('json');
    await page.locator('#save-all-btn').click();
    await markNotice('ok', '保存完成');
    await page.locator('#parse-import-btn').click();
    await markNotice('warn', '请核对内容');
    await input.fill('{invalid-json');
    await page.locator('#parse-import-btn').click();
    await markNotice('danger', '识别失败');
    await page.locator('[data-visual-smoke]').evaluateAll(nodes => Promise.all(nodes.flatMap(node => node.getAnimations().map(animation => animation.finished))));
    const notices = await appearance('[data-visual-smoke]');
    assert.equal(notices.length, 3); verify(notices);
    await page.screenshot({ path: screenshot });
    for (const type of ['ok', 'warn', 'danger']) {
      const notice = page.locator(`[data-visual-smoke="${type}"]`), close = notice.getByRole('button', { name: '关闭', exact: true });
      assert.match(await notice.innerText(), /通知外观验证：/);
      await close.focus(); await close.press('Enter');
      assert.equal(await notice.count(), 0, '通知关闭按钮无法通过键盘操作');
    }
    await page.evaluate(() => {
      const platform = document.getElementById('platform-status');
      const status = document.getElementById('desktop-window-status');
      if (!platform || !status) throw new Error('平台或窗口状态提示缺失');
      platform.hidden = false; platform.className = 'platform-status'; platform.textContent = '正在保存：通知外观验证';
      status.hidden = false; status.textContent = '窗口操作提示：通知外观验证';
    });
    const normal = await appearance('#platform-status, #desktop-window-status'); assert.equal(normal.length, 2); verify(normal);
    await page.evaluate(() => {
      const platform = document.getElementById('platform-status');
      if (!platform) throw new Error('平台状态提示缺失');
      platform.classList.add('failed'); platform.textContent = '保存失败：通知外观验证';
      const retry = document.createElement('button'); retry.textContent = '测试恢复';
      retry.onclick = () => { retry.dataset.activated = 'true'; };
      document.getElementById('platform-status')?.append(retry);
    });
    const failed = await appearance('#platform-status.failed'); verify(failed);
    const retry = page.locator('#platform-status').getByRole('button', { name: '测试恢复', exact: true });
    await retry.focus(); await retry.press('Enter');
    assert.equal(await retry.getAttribute('data-activated'), 'true', '失败提示的恢复按钮不可用');
    return { notices, normal, failed, keyboardClose: true, recoveryButton: true, screenshot };
  } finally {
    await input.fill(importState.text); await mode.selectOption(importState.mode);
    await page.evaluate(saved => {
      document.querySelectorAll('[data-visual-smoke]').forEach(node => node.remove());
      saved.forEach(state => { const node = document.getElementById(state.id); if (node) { if (!state.exists) node.remove(); else { node.hidden = state.hidden; node.textContent = state.text; node.className = state.className; } } });
    }, original);
    if (importState.view) await page.locator(`.nav[data-view="${importState.view}"]`).click();
  }
}

/** @param {Runtime} runtime @param {'practice' | 'exam'} mode */
async function focusVisualSmoke(runtime, mode) {
  const { page } = runtime;
  const original = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const snapshots = [];
  try {
    await page.locator(`body.${mode}-focus.side-collapsed`).waitFor({ state: 'attached' });
    for (const size of VISUAL_WINDOW_SIZES) {
      await resizeTestWindow(runtime, size);
      const question = page.locator(`#${mode}-card .question-title`).first();
      await question.scrollIntoViewIfNeeded();
      assert.match(await question.innerText(), /TAURI PROTOTYPE 1\+1 = \?/);
      const controls = mode === 'practice' ? ['#p-submit', '#p-exit'] : ['#exam-submit-focus', '#exam-exit-focus'];
      for (const selector of controls) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        assert(await control.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return [0.25, 0.5, 0.75].every(fraction => {
            const hit = document.elementFromPoint(rect.left + rect.width * fraction, rect.top + rect.height / 2);
            return node === hit || node.contains(hit);
          });
        }), `专注模式按钮被遮挡或超出视口：${selector}`);
      }
      await question.scrollIntoViewIfNeeded();
      snapshots.push({ requestedWindow: size, ...await visualLayout(page, `mist-blue-${mode}-${size.name}.png`) });
      if (mode === 'practice') {
        await page.locator('#sidebar-toggle').click();
        await page.waitForFunction(() => !document.body.classList.contains('side-collapsed'));
        await visualLayout(page, `mist-blue-${mode}-${size.name}-navigation.png`);
        await page.locator('#sidebar-toggle').click();
        await page.waitForFunction(() => document.body.classList.contains('side-collapsed'));
      }
    }
  } finally { await resizeTestWindow(runtime, original); }
  return snapshots;
}

/** @param {Runtime} runtime */
async function practiceAndExamFocusSmoke(runtime) {
  const { page } = runtime;
  const practice = await focusVisualSmoke(runtime, 'practice');
  await page.locator('#p-exit').click();
  const dialog = page.locator('#app-dialog');
  await dialog.waitFor();
  await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: path.join(path.dirname(SCREENSHOT_PATH), 'centered-dialog.png'), fullPage: true });
  const bounds = await dialog.boundingBox();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  assert(bounds && Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 2, '弹框未水平居中');
  assert(bounds && Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) < 2, '弹框未垂直居中');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#p-exit').isVisible(), true);
  await page.locator('#p-exit').click();
  await page.locator('#app-dialog [data-dialog-accept]').click();
  // 手动切换会取代自动收起状态；考试不切换导航，另行覆盖退出后的自动恢复。
  await page.waitForFunction(() => !document.body.classList.contains('practice-focus') && document.body.classList.contains('side-collapsed'));
  await page.locator('#sidebar-toggle').click();
  await page.locator('.nav[data-view="exam"]').click();
  await page.locator('#exam-count').fill('1');
  await page.locator('#exam-minutes').fill('0');
  await page.locator('#exam-type').selectOption('all');
  await page.locator('#start-exam-btn').click();
  const exam = await focusVisualSmoke(runtime, 'exam');
  await page.locator('#exam-exit-focus').click();
  await page.locator('#app-dialog [data-dialog-accept]').click();
  await page.waitForFunction(() => !document.body.classList.contains('exam-focus') && !document.body.classList.contains('side-collapsed'));
  await page.locator('#exam-setup').waitFor({ state: 'visible' });
  return { practice, exam, manualNavigationRetained: true, automaticNavigationRestored: true };
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

/** @param {Page} page */
async function practiceDeselectSmoke(page) {
  const option = page.locator('#practice-card .option[data-key="A"]');
  const input = option.locator('input');
  for (const target of [option.locator('.option-text'), input]) {
    await target.click();
    assert(await input.isChecked());
    await target.click();
    assert(!(await input.isChecked()), '再次点击应取消选中');
    assert.equal(await page.locator('#practice-card .option.selected').count(), 0);
  }
  await input.focus();
  for (const key of ['Space', '1']) {
    await page.keyboard.press(key);
    assert(await input.isChecked());
    await page.keyboard.press(key);
    assert(!(await input.isChecked()), '键盘重复选择应取消选中');
    assert.equal(await page.locator('#practice-card .option.selected').count(), 0);
  }
  if (await page.locator('#p-total-status').count()) assert.match(await page.locator('#p-total-status').innerText(), /已填写 0 题/);
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
  await practiceDeselectSmoke(page);
  await page.locator('#app-toast .toast-item').first().waitFor({ state: 'hidden' });
  await mkdir(path.dirname(SCREENSHOT_PATH), { recursive: true });
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  return { ...result, deselect: true, screenshot: SCREENSHOT_PATH };
}

/** @param {Page} page @param {string} bankName @param {string} origin */
async function totalPracticeSmoke(page, bankName, origin) {
  await page.locator('.nav[data-view="ai-settings"]').click();
  await page.locator('#ai-provider-v99').selectOption('custom');
  await page.locator('#ai-endpoint-v99').fill(origin + '/practice-analysis');
  await page.locator('#ai-model-v99').fill('mock-model');
  await page.locator('#ai-api-key-v99').fill('native-fixture-key');
  await page.locator('#ai-remember-key-v99').uncheck();
  await page.locator('#ai-save-settings-v99').click();
  await page.waitForFunction(() => document.querySelector('#ai-settings-status-v99')?.textContent?.includes('设置已保存'));
  await page.locator('.nav[data-view="practice"]').click();
  await page.locator('#practice-submit-mode').selectOption('total');
  await practiceImportedBank(page, bankName);
  await practiceDeselectSmoke(page);
  await page.locator('#practice-card .option[data-key="B"]').click();
  assert.equal(await page.locator('#p-reveal, #p-submit').count(), 0);
  await page.locator('[data-ai-single-open-v613]').click();
  await page.waitForFunction(() => document.querySelector('#p-ai-v613')?.textContent?.includes('NATIVE_PRACTICE_AI'));
  assert(await page.locator('#practice-card .option[data-key="B"] input').isChecked());
  assert.match(await page.locator('#p-total-status').innerText(), /已填写 1 题/);
  await page.screenshot({ path: path.join(path.dirname(SCREENSHOT_PATH), 'practice-total.png'), fullPage: true });
  await page.locator('#p-submit-all').click();
  await page.locator('#app-dialog [data-dialog-accept]').click();
  await page.locator('#again-practice').waitFor();
  const metrics = await page.locator('#practice-card .metric b').allTextContents();
  assert.deepEqual(metrics, ['1', '0', '1', '0%']);
  assert.equal(await page.locator('#p-wrong-overview .review-answer-wrong .review-answer-value').innerText(), 'B');
  assert.equal(await page.locator('#p-wrong-overview .review-answer-correct .review-answer-value').innerText(), 'A');
  assert.deepEqual(await page.locator('#p-wrong-overview .option-text').allTextContents(), ['2', '3']);
  assert.match(await page.locator('#p-wrong-overview .option.wrong').innerText(), /✕ 当时选择/);
  await page.screenshot({ path: path.join(path.dirname(SCREENSHOT_PATH), 'practice-wrong-overview.png'), fullPage: true });
  await page.locator('#again-practice').click();
  await page.locator('#practice-card .option[data-key="A"]').click();
  await page.locator('#p-submit-all').click();
  await page.locator('#app-dialog [data-dialog-accept]').click();
  await page.locator('#again-practice').waitFor();
  assert.match(await page.locator('#p-wrong-overview').innerText(), /本轮没有错题/);
  await page.locator('#back-practice-setup').click();
  await page.locator('#practice-submit-mode').selectOption('single');
  await page.reload();
  await page.locator('body[data-storage-state="ready"]').waitFor();
  await page.locator('.nav[data-view="wrongbook"]').click();
  const originalWrong = page.locator('#wrongbook-list .wrong-item').filter({ hasText: FIXTURE_QUESTION });
  await originalWrong.waitFor();
  assert.equal(await originalWrong.locator('.option.wrong').getAttribute('data-key'), 'B');
  assert.equal(await originalWrong.locator('.review-answer-wrong .review-answer-value').innerText(), 'B');
  await page.screenshot({ path: path.join(path.dirname(SCREENSHOT_PATH), 'wrongbook-original-choice.png'), fullPage: true });
  return { mode: 'total', answered: 1, nativeAi: true, wrongOverview: true, allCorrect: true, saved: true, originalWrongChoiceAfterReload: true };
}

async function main() {
  assert.equal(process.platform, 'win32', '此 smoke 仅支持 Windows WebView2');
  const argument = process.argv[2];
  assert(argument && process.argv.length === 3, '用法：node apps/desktop/scripts/smoke.mjs <已构建的 exe 路径>');
  const executable = await realpath(path.resolve(argument));
  assert(/\.exe$/i.test(executable) && (await stat(executable)).isFile(), '参数必须是现有 EXE');
  const tempRoot = await realpath(tmpdir());
  const profile = await mkdtemp(path.join(tempRoot, PROFILE_PREFIX));
  await markNativeIsolation(profile);
  const networkMock = await createNativeMock(profile);
  const profiles = [profile];
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
    networkMock.close();
    for (const item of profiles) {
      const actual = await realpath(item);
      assert.equal(path.dirname(actual).toLowerCase(), tempRoot.toLowerCase());
      assert(path.basename(actual).startsWith(PROFILE_PREFIX), '拒绝清理非测试目录');
      await rm(actual, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
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
    await check('原生 AI、WebDAV、凭据保存与取消撤销', async () => {
      const result=await nativeServiceSmoke(page, networkMock.origin);
      assert(networkMock.requests.some(request=>request.url==='/chat'&&request.authenticated),'原生请求未使用已保存假凭据');
      assert.equal(networkMock.requests.filter(request=>request.method==='PUT'&&request.url?.includes('shiroha-web-backup-')).length,1,'重试重复写入历史文件');
      return result;
    });
    await check('原生 IPC 白名单与非法输入保全', async () => page.evaluate(async () => {
      const host = (/** @type {NativeTestWindow} */ (window)).ShirohaDesktopHost;
      if (!host) throw new Error('本地桥接缺失');
      const before = JSON.stringify(await host.invoke('local_initialize'));
      for (const [command, args] of /** @type {Array<[string,Record<string,unknown>]>} */ ([
        ['unknown_native_command', {}], ['plugin:fs|read_text_file', { path: 'C:/outside' }],
        ['local_file', { request: { kind: 'read', token: 'forged', offset: 0 } }],
        ['local_write', { snapshot: { schemaVersion: 999 }, operationId: 'invalid', expectedRevision: 0 }],
      ])) {
        let rejected = false; try { await host.invoke(command,args); } catch { rejected = true; }
        if (!rejected) throw new Error('未拒绝非法调用');
      }
      if (JSON.stringify(await host.invoke('local_initialize')) !== before) throw new Error('非法调用改变了数据修订');
      return { rejected: 4, dataPreserved: true };
    }));
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
      for (const view of ['import', 'banks', 'exam', 'wrongbook', 'favorites', 'records', 'ai-settings', 'settings']) {
        await page.locator(`.nav[data-view="${view}"]`).click();
        await page.locator(`#${view}.view.active`).waitFor({ state: 'visible' });
      }
      return { title: await page.title(), origin: new URL(page.url()).origin };
    });
    const visualRuntime = runtime;
    await check('沉浸标题栏原生窗口操作', () => titlebarSmoke(visualRuntime));
    await check('雾蓝首页、导入与原生窗口尺寸', () => desktopVisualSmoke(visualRuntime));
    await check('原生 WebView2 下拉样式、鼠标与键盘选择', async () => {
      await page.locator('.nav[data-view="practice"]').click();
      const select = page.locator('#practice-type');
      const original = await select.inputValue();
      try {
        const style = await select.evaluate(element => ({
          appearance: window.getComputedStyle(element).appearance,
          radius: window.getComputedStyle(element).borderRadius,
          popupRadius: window.getComputedStyle(element, '::picker(select)').borderRadius,
        }));
        assert.equal(style.appearance, 'base-select');
        assert.equal(style.radius, '6px');
        assert.equal(style.popupRadius, '8px');
        await select.click();
        assert(await select.evaluate(element => element.matches(':open')));
        await select.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
        await page.screenshot({ path: path.join(path.dirname(SCREENSHOT_PATH), 'select-menu.png') });
        await select.getByRole('option', { name: '多选兼容', exact: true }).click();
        assert.equal(await select.inputValue(), 'multi');
        await page.keyboard.press('Space');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Enter');
        assert.equal(await select.inputValue(), 'multiple');
        await page.keyboard.press('Space');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Escape');
        assert.equal(await select.inputValue(), 'multiple');
        return { ...style, mouse: true, keyboard: true, escape: true };
      } finally {
        await page.keyboard.press('Escape');
        await select.selectOption(original);
      }
    });
    await check('雾蓝全局通知与键盘操作', () => notificationVisualSmoke(page));
    const marker = { key: `${PROFILE_PREFIX}${randomUUID()}`, value: randomUUID() };
    const bankName = `桌面原型验证-${randomUUID().slice(0, 8)}`;
    await check('LocalStorage 写入回读', async () => page.evaluate(({ key, value }) => {
      localStorage.setItem(key, value);
      if (localStorage.getItem(key) !== value) throw new Error('LocalStorage 即时回读失败');
      return { readable: true };
    }, marker));
    await check('界面导入题库并练习', () => importAndPractice(page, bankName));
    await check('练习与考试专注布局、进入及退出', () => practiceAndExamFocusSmoke(visualRuntime));
    await check('总提交错题对照、答题 AI 与原生记录保存', async () => {
      const result = await totalPracticeSmoke(page, bankName, networkMock.origin);
      assert(networkMock.requests.some(request => request.url === '/practice-analysis' && request.authenticated), '答题 AI 未通过原生请求使用隔离假凭据');
      return result;
    });
    await check('订阅 Harness 登录、既有 AI 任务与取消草稿保全',()=>harnessSmoke(page,()=>practiceImportedBank(page,bankName)));
    await check('Harness 下载中切换与组件缓存复用',()=>harnessSwitchingSmoke(page,profile));
    await check('CodeBuddy 登录、单题解析、追问与配置保全',()=>codebuddyLoginSmoke(page,()=>practiceImportedBank(page,bankName)));
    await check('MathJax 本地公式', () => mathSmoke(page));
    await check('PDF.js 本地模块与 Worker', () => pdfSmoke(page));
    await check('Tesseract 本地 OCR', () => ocrSmoke(page));
    await check('中文扫描 PDF、DOCX、XLSX 实际导入保存重载', () => documentSmoke(page));
    const first = runtime;
    await check('离线与脚本错误', async () => {
      const violations = await page.evaluate(() => (/** @type {TestWindow} */ (window)).__smokeCsp ?? []);
      assert.deepEqual(first.errors, [], '出现未捕获 JS 错误');
      assert.deepEqual(violations, [], '出现 CSP 违例');
      assert.deepEqual(first.blocked, [], '应用尝试请求远程资源');
      return { localRequests: first.requests.length, remoteRequests: first.blocked.length, jsErrors: first.errors.length };
    });
    await check('标题栏关闭窗口', async () => {
      await resizeTestWindow(first, { width: 1100, height: 760 });
      await page.locator('#desktop-window-close').click();
      const end = Date.now() + CLOSE_TIMEOUT_MS;
      while (running(first.child) && Date.now() < end) await delay(POLL_MS);
      assert(!running(first.child), '关闭按钮未关闭测试进程');
      return { closed: true };
    });
    await stop(runtime); runtime = undefined;
    runtime = await launch(executable, profile, proxyPort);
    const memoryRestart = runtime;
    await check('CodeBuddy 仅内存登录在重启后清除',()=>codebuddyLoginAfterRestart(memoryRestart.page));
    await check('CodeBuddy 记住登录、关闭记住与退出跨重启验证',()=>codebuddyLoginPersistenceSmoke(memoryRestart.page, async()=>{
      assert(runtime);
      await stop(runtime); runtime = undefined;
      runtime = await launch(executable, profile, proxyPort);
      return runtime.page;
    }));
    const restarted = runtime;
    await check('重启按保存位置和尺寸创建普通窗口', async () => {
      const size = await restarted.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      assert.deepEqual(size, { width: 1100, height: 760 });
      const saved = JSON.parse(await readFile(path.join(profile, 'window-state.json'), 'utf8'));
      const actual = await nativeWindowState(restarted);
      assert.deepEqual({ x: actual.x, y: actual.y }, { x: saved.x, y: saved.y });
      return { ...size, x: actual.x, y: actual.y };
    });
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
    await check('真实 IPC 覆盖快照与恢复', async () => restarted.page.evaluate(async () => {
      const host = (/** @type {NativeTestWindow} */ (window)).ShirohaDesktopHost;
      if (!host) throw new Error('本地桥接缺失');
      const harnessStatus = async () => /** @type {import('../../web/platform/runtime.d.ts').HarnessStatus} */ (await host.invoke('harness_control',{request:{kind:'status'}}));
      if ((await harnessStatus()).runtimePath !== 'isolated-fake-codex.exe') throw new Error('恢复验收只允许隔离假 Harness');
      await host.invoke('harness_control',{request:{kind:'inspect'}});
      await host.invoke('harness_control',{request:{kind:'login'}});
      const loginDeadline = Date.now() + 5000;
      while (!(await harnessStatus()).ready) {
        if (Date.now() >= loginDeadline) throw new Error('恢复前假订阅未就绪');
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      await host.invoke('service_credential',{request:{kind:'invalidate'}});
      if ((await harnessStatus()).ready) throw new Error('覆盖导入的凭据失效入口未撤销 Harness 就绪状态');
      await host.invoke('harness_control',{request:{kind:'inspect'}});
      if (!(await harnessStatus()).ready) throw new Error('恢复后主动检测不能重新启用隔离订阅');
      const before = await host.invoke('local_read');
      const state = /** @type {{revision:number}} */ (await host.invoke('local_initialize'));
      const checkpoint = /** @type {{snapshotId:string}} */ (await host.invoke('local_checkpoint'));
      const empty = { schemaVersion: 1, banks: [], activeBankId: '', wrongBook: {}, favorites: {}, records: [], settings: {}, crossPlatformMeta: {} };
      const replaced = /** @type {{revision:number}} */ (await host.invoke('local_replace', {snapshot:empty, operationId:'smoke-replace', expectedRevision:state.revision}));
      const result = /** @type {{banks:unknown[]}} */ (await host.invoke('local_read'));
      if (result.banks.length) throw new Error('覆盖未提交');
      if ((await harnessStatus()).ready) throw new Error('覆盖数据未要求重新检测 Harness');
      await host.invoke('harness_control',{request:{kind:'inspect'}});
      await host.invoke('local_query', {query:{kind:'restore',snapshot_id:checkpoint.snapshotId,operation_id:'smoke-restore',expected_revision:replaced.revision}});
      if (JSON.stringify(await host.invoke('local_read')) !== JSON.stringify(before)) throw new Error('恢复内容不一致');
      if ((await harnessStatus()).ready) throw new Error('恢复点恢复未要求重新检测 Harness');
      return { restored: true, snapshotRetained: true, harnessRequiresInspect: true };
    }));
    await stop(runtime); runtime = undefined;
    const migrationProfile = await mkdtemp(path.join(tempRoot, PROFILE_PREFIX));
    profiles.push(migrationProfile); await markNativeIsolation(migrationProfile);
    runtime = await launch(executable, migrationProfile, proxyPort);
    const migrated = runtime;
    await check('C7/D2 同来源旧原型与凭据联合迁移', async () => {
      await migrated.page.evaluate(() => {
        const snapshot = {schemaVersion:1,banks:[{id:'legacy-bank',name:'阶段C迁移样本',questions:[{id:'legacy-q',type:'single',question:'迁移题目',options:[],answer:[],extension:{preserved:true}}]}],activeBankId:'legacy-bank',wrongBook:{},favorites:{},records:[],settings:{},crossPlatformMeta:{}};
        localStorage.setItem('shiroha_quiz_state_v28_4_c1',JSON.stringify(snapshot));
        localStorage.setItem('shiroha_webdav_config_local_v378',JSON.stringify({endpoint:'https://fixture.invalid',username:'fixture',remoteDir:'backup',rememberPassword:true}));
        localStorage.setItem('shiroha_webdav_password_local_v378','fake-migration-password');
        localStorage.setItem('unknown-legacy-key','preserve');
      });
      await migrated.page.reload();
      await migrated.page.getByText('确认迁移旧原型数据', {exact:true}).waitFor();
      await migrated.page.getByText('确认迁移旧原型数据', {exact:true}).click();
      await migrated.page.locator('#app-dialog [data-dialog-accept]').click();
      await migrated.page.locator('#active-bank-select option[value="legacy-bank"]').waitFor({state:'attached'});
      await migrated.page.waitForFunction(()=>localStorage.getItem('shiroha_webdav_password_local_v378')===null);
      await migrated.page.evaluate(async () => {
        const host=(/** @type {NativeTestWindow} */ (window)).ShirohaDesktopHost;
        if(!host)throw new Error('本地桥接缺失');
        const data=/** @type {{banks:Array<{questions:Array<{extension:{preserved:boolean}}>}>,serviceConfigurations:{webdav:{endpoint:string}}}} */ (await host.invoke('local_read'));
        if(!data.banks[0].questions[0].extension.preserved||data.serviceConfigurations.webdav.endpoint!=='https://fixture.invalid')throw new Error('迁移丢失字段');
        if(!localStorage.getItem('shiroha_quiz_state_v28_4_c1')||localStorage.getItem('shiroha_webdav_password_local_v378')!==null||localStorage.getItem('unknown-legacy-key')!=='preserve')throw new Error('旧来源被清理');
      });
      const credentialState=await migrated.page.evaluate(async()=>{const host=(/** @type {NativeTestWindow} */(window)).ShirohaDesktopHost;if(!host)throw new Error('bridge');return host.invoke('service_credential',{request:{kind:'status',config:{service:'webdav',endpoint:'https://fixture.invalid',username:'fixture',remoteDir:'backup'}}});});
      assert.deepEqual(credentialState,{state:'remembered'});
      return {dataMigrated:true,credentialsMigrated:true,legacyDataPreserved:true};
    });
    await stop(runtime); runtime=undefined;
    runtime=await launch(executable,migrationProfile,proxyPort);
    const migratedRestart=runtime;
    await check('迁移后重启使用 SQLite',async()=>{
      await migratedRestart.page.locator('#active-bank-select option[value="legacy-bank"]').waitFor({state:'attached'});
      assert.equal(await migratedRestart.page.getByText('确认迁移旧原型数据',{exact:true}).count(),0);
      return {restarted:true};
    });
    await check('C8 题库分页、按需正文与完整导出',async()=>{
      await migratedRestart.page.evaluate(async()=>{
        const host=(/** @type {NativeTestWindow} */(window)).ShirohaDesktopHost;if(!host)throw new Error('bridge');
        const current=/** @type {{revision:number}} */(await host.invoke('local_initialize'));
        const banks=['lazy-a','lazy-b'].map(id=>({id,name:id,groupName:'C8',questions:Array.from({length:65},(_,i)=>({id:'q'+i,number:i+1,type:'single',question:id+' 正文 '+i,options:[{key:'A',text:'正确'},{key:'B',text:'错误'}],answer:['A'],extension:{preserved:true}}))}));
        Object.assign(banks[0].questions[0],{category:'较长的分类名称：综合基础知识',score:12.5});
        await host.invoke('local_replace',{operationId:'lazy-fixture',expectedRevision:current.revision,snapshot:{schemaVersion:1,banks,activeBankId:'lazy-a',wrongBook:{},favorites:{},records:[{id:'old-record',mode:'practice',name:'历史记录',bankName:'已删除题库',date:'2026-10-23T00:00:00Z',total:1,answered:1,correct:0,wrong:1,accuracy:0,duration:1,details:[{question:'已删除题目的历史正文',type:'single',chosen:['B'],answer:['A'],correct:false}]}],settings:{},crossPlatformMeta:{}}});
      });
      await migratedRestart.page.addInitScript(()=>{
        const calls=/** @type {string[]} */([]);
        Object.defineProperty(window,'__nativeCalls',{value:calls});
        Object.defineProperty(window,'ShirohaDesktopHost',{configurable:true,set(host){
          const original=host.invoke;host.invoke=(/** @type {string} */command,/** @type {{query?:{kind?:string}}} */args)=>{calls.push(command+':'+(args?.query?.kind||''));return original(command,args)};
          Object.defineProperty(window,'ShirohaDesktopHost',{value:host,configurable:true});
        }});
      });
      await migratedRestart.page.reload();
      await migratedRestart.page.locator('#active-bank-select option[value="lazy-a"]').waitFor({state:'attached'});
      const initialCalls=await migratedRestart.page.evaluate(()=>Reflect.get(window,'__nativeCalls'));
      assert(!initialCalls.includes('local_read:')&&!initialCalls.includes('local_query:details'),'startup loaded bodies');
      await migratedRestart.page.locator('.nav[data-view="banks"]').click();
      await migratedRestart.page.locator('#bank-preview tbody tr').first().getByText('lazy-a 正文 0',{exact:true}).waitFor();
      assert.equal(await migratedRestart.page.locator('#bank-preview tbody tr').count(),10);
      const previewPager=migratedRestart.page.locator('#bank-preview-pager');
      assert.equal(await previewPager.locator('select').inputValue(),'10');
      await previewPager.locator('select').selectOption('20');
      await migratedRestart.page.locator('[data-select-bank-question="q19"]').waitFor();
      assert.equal(await migratedRestart.page.locator('#bank-preview tbody tr').count(),20);
      await previewPager.getByRole('button',{name:'第 4 页',exact:true}).click();
      await migratedRestart.page.locator('#bank-preview tbody tr').first().getByText('lazy-a 正文 60',{exact:true}).waitFor();
      assert.equal(await migratedRestart.page.locator('#bank-preview tbody tr').count(),5);
      assert(await previewPager.getByRole('button',{name:'下一页',exact:true}).isDisabled());
      await previewPager.locator('select').selectOption('50');
      await migratedRestart.page.locator('#bank-preview tbody tr').first().getByText('lazy-a 正文 0',{exact:true}).waitFor();
      assert.equal(await migratedRestart.page.locator('#bank-preview tbody tr').count(),50);
      await migratedRestart.page.locator('[data-preview-question]').first().click();
      assert.equal(await migratedRestart.page.locator('#bank-question-detail .bank-detail-body').innerText(),'lazy-a 正文 0');
      assert(await migratedRestart.page.locator('#bank-question-detail .bank-detail-option').count()>0);
      await migratedRestart.page.evaluate(()=>Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async(/** @type {string} */ text)=>{Reflect.set(window,'__previewCopied',text)}}}));
      await migratedRestart.page.locator('[data-copy-question]').click();
      assert.equal(await migratedRestart.page.evaluate(()=>Reflect.get(window,'__previewCopied')),'lazy-a 正文 0');
      await previewPager.getByRole('button',{name:'下一页',exact:true}).click();
      await migratedRestart.page.locator('#bank-preview tbody tr').first().getByText('lazy-a 正文 50',{exact:true}).waitFor();
      assert.equal(await migratedRestart.page.locator('#bank-question-detail').count(),0);
      assert.equal(await migratedRestart.page.locator('#bank-preview tbody tr').count(),15);
      await migratedRestart.page.locator('.nav[data-view="records"]').click();
      await migratedRestart.page.locator('#records-list details').waitFor();
      assert.equal(await migratedRestart.page.locator('#records-list tbody tr').count(),0);
      await migratedRestart.page.locator('#records-list summary').click();
      await migratedRestart.page.locator('#records-list').getByText('已删除题目的历史正文',{exact:true}).waitFor();
      await migratedRestart.page.locator('.nav[data-view="banks"]').click();
      await migratedRestart.page.locator('[data-practice-group-v8916="C8"]').click();
      await migratedRestart.page.locator('.nav[data-view="practice"]').click();
      await migratedRestart.page.locator('#practice-start-mode-v58916').selectOption('custom');
      await migratedRestart.page.locator('#practice-number-range-v58916').fill('65-66');
      await migratedRestart.page.locator('#start-practice-btn').click();
      await migratedRestart.page.locator('#practice-card').getByText('lazy-a 正文 64',{exact:true}).waitFor();
      assert.match(await migratedRestart.page.locator('#practice-progress').innerText(),/1\s*\/\s*2/);
      await migratedRestart.page.locator('#p-next').click();
      await migratedRestart.page.locator('#practice-card').getByText('lazy-b 正文 0',{exact:true}).waitFor();
      await migratedRestart.page.locator('#p-exit').click();
      await migratedRestart.page.locator('#app-dialog [data-dialog-accept]').click();
      await migratedRestart.page.waitForFunction(()=>!document.body.classList.contains('practice-focus'));
      if(await migratedRestart.page.evaluate(()=>document.body.classList.contains('side-collapsed')))await migratedRestart.page.locator('#sidebar-toggle').click();
      await migratedRestart.page.locator('.nav[data-view="dashboard"]').click();
      await migratedRestart.page.locator('.nav[data-view="banks"]').click();
      const bankMenu=migratedRestart.page.locator('.bank-item').filter({has:migratedRestart.page.locator('[data-editbank-v45="lazy-a"]')});
      await bankMenu.locator('summary').click();
      await bankMenu.locator('[data-editbank-v45="lazy-a"]').click();
      await migratedRestart.page.locator('#import-bank-name').fill('lazy-a edited');
      await migratedRestart.page.locator('#bank-edit-save-v45').click();
      await migratedRestart.page.locator('#active-bank-select option[value="lazy-a"]').filter({hasText:'lazy-a edited'}).waitFor({state:'attached'});
      await migratedRestart.page.evaluate(async()=>{
        const storage=/** @type {import('../../web/platform/runtime.d.ts').BrowserStorage} */(Reflect.get(window,'ShirohaPlatform').storage);
        await storage.initialize();const data=/** @type {import('../../web/platform/contracts.d.ts').Snapshot} */(await storage.read());
        await storage.ensureQuestions?.(data,[{bankId:'lazy-a',questionId:'q0'},{bankId:'lazy-b',questionId:'q0'}]);
        if(data.banks[0].questions[0].question===data.banks[1].questions[0].question)throw new Error('跨库同 ID 混淆');
        await storage.ensureAll?.(data);
        if(data.banks.some(bank=>bank.questions.some(q=>!q.question||!q.extension)))throw new Error('完整导出缺失正文或扩展');
      });
      return {questions:130,defaultPageSize:10,pageSizes:[20,50],directLastPage:5,lastPage:15,initialBodies:0,crossBankIdentity:true};
    });
    await check('本轮错题一览分页保留题号、全部选项和完整题量',async()=>{
      const page=migratedRestart.page;
      // 前一用例用独立快照读取完整导出；重载后页面与适配器重新共享同一读取基线。
      await page.reload();await page.locator('body[data-storage-state="ready"]').waitFor();
      await page.locator('.nav[data-view="practice"]').click();
      await page.locator('#practice-submit-mode').selectOption('total');
      await page.locator('#practice-start-mode-v58916').selectOption('custom');
      await page.locator('#practice-number-range-v58916').fill('1-13');
      await page.locator('#start-practice-btn').click();
      await page.locator('#p-submit-all').click();
      await page.locator('#app-dialog [data-dialog-accept]').click();
      await page.locator('#again-practice').waitFor();
      const overview=page.locator('#p-wrong-overview'),pager=page.locator('#p-wrong-overview-list-pager');
      assert.equal(await overview.locator('[data-wrong-question-index]').count(),10);
      assert.match(await overview.locator('h3').innerText(),/13/);
      await pager.getByRole('button',{name:'第 2 页',exact:true}).click();
      assert.equal(await overview.locator('[data-wrong-question-index]').count(),3);
      assert.match(await overview.locator('[data-wrong-question-index="10"] .qmeta').innerText(),/第 11 题/);
      assert.equal(await overview.locator('[data-wrong-question-index="12"] .option').count(),2);
      await pager.locator('select').selectOption('20');
      assert.equal(await overview.locator('[data-wrong-question-index]').count(),13);
      assert.equal(await pager.locator('[aria-current="page"]:visible').innerText(),'1');
      await page.locator('#back-practice-setup').click();
      await page.locator('#practice-submit-mode').selectOption('single');
      await page.locator('.nav[data-view="banks"]').click();
      return {totalWrong:13,defaultPageSize:10,secondPage:3,expandedPageSize:20};
    });
    await check('题库预览四列文字与操作按钮保持单行',async()=>{
      const page=migratedRestart.page;
      const original=await page.evaluate(()=>({width:window.innerWidth,height:window.innerHeight}));
      await page.reload();await page.locator('body[data-storage-state="ready"]').waitFor();
      await page.locator('.nav[data-view="banks"]').click();
      await page.locator('#bank-preview').getByText('较长的分类名称：综合基础知识',{exact:true}).waitFor();
      try {
        for(const size of VISUAL_WINDOW_SIZES){
          await resizeTestWindow(migratedRestart,size);
          const failures=await page.locator('#bank-preview').evaluate(table=>{
            const failures=[];
            for(const row of /** @type {HTMLTableElement} */(table).rows){
              for(const index of [2,5,6,7]){
                const cell=row.cells[index];
                if(!cell)continue;
                const nodes=index===7&&cell.querySelector('button')?[...cell.querySelectorAll('button')]:[cell];
                const tops=new Set();
                for(const node of nodes){
                  const range=document.createRange();range.selectNodeContents(node);
                  for(const rect of range.getClientRects())tops.add(Math.round(rect.top));
                }
                if(tops.size>1||cell.scrollWidth>cell.clientWidth+1)failures.push(cell.textContent);
              }
            }
            return failures;
          });
          assert.deepEqual(failures,[],size.name);
          await page.locator('#bank-preview thead').scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(path.dirname(SCREENSHOT_PATH),`bank-preview-${size.name}.png`)});
        }
      } finally { await resizeTestWindow(migratedRestart,original); }
      return {sizes:VISUAL_WINDOW_SIZES};
    });
    await check('题库试题跨页批量删除、未加载正文保全与持久化',async()=>{
      const page=migratedRestart.page;
      await page.reload();await page.locator('body[data-storage-state="ready"]').waitFor();
      await page.locator('.nav[data-view="banks"]').click();
      await page.locator('#bank-preview-pager select').selectOption('50');
      await page.locator('[data-select-bank-question="q0"]').check();
      await page.locator('#bank-preview-pager').getByRole('button',{name:'下一页',exact:true}).click();
      await page.locator('[data-select-bank-question="q50"]').waitFor();
      await page.locator('#select-bank-question-page').click();
      assert.match(await page.locator('#bank-question-selection').textContent()||'',/已选择 16/);
      await page.locator('#delete-selected-questions').click();
      await page.locator('#app-dialog [data-dialog-accept]').click();
      await page.locator('body[data-storage-state="ready"]').waitFor();
      await page.locator('[data-select-bank-question="q1"]').waitFor();
      assert.equal(await page.locator('[data-select-bank-question]').count(),49);
      await page.screenshot({path:fileURLToPath(new URL('../.reports/question-deletion.png',import.meta.url))});
      await page.reload();await page.locator('body[data-storage-state="ready"]').waitFor();
      await page.evaluate(async()=>{
        const host=(/** @type {NativeTestWindow} */(window)).ShirohaDesktopHost;if(!host)throw new Error('bridge');
        const data=/** @type {import('../../web/platform/contracts.d.ts').Snapshot} */(await host.invoke('local_read'));
        const a=data.banks.find(bank=>bank.id==='lazy-a'),b=data.banks.find(bank=>bank.id==='lazy-b');
        if(!a||a.questions.length!==49||!b||b.questions.length!==65)throw new Error('删除数量或题库隔离错误');
        if(a.questions.some(q=>q.id==='q0'||Number(q.id.slice(1))>=50))throw new Error('已删除题目重载后恢复');
        if(data.banks.some(bank=>bank.questions.some(q=>!q.question||!q.extension)))throw new Error('未删除题目正文或扩展丢失');
        if(!data.records.some(record=>record.id==='old-record'))throw new Error('历史记录丢失');
      });
      return {deleted:16,remaining:49,otherBank:65,reloaded:true};
    });
    const repairCheckpoint=/** @type {{snapshotId:string}} */(await migratedRestart.page.evaluate(async()=>{
      const host=(/** @type {NativeTestWindow} */(window)).ShirohaDesktopHost;if(!host)throw new Error('bridge');return host.invoke('local_checkpoint');
    }));
    await stop(runtime);runtime=undefined;
    const broken=Buffer.from('C8 synthetic corrupt database');
    await writeFile(path.join(migrationProfile,'library.sqlite3'),broken);
    await writeFile(path.join(migrationProfile,'library.sqlite3-wal'),Buffer.from('invalid WAL fixture'));
    runtime=await launch(executable,migrationProfile,proxyPort);
    const repaired=runtime;
    await check('损坏数据库界面恢复且保留原文件',async()=>{
      const status=repaired.page.locator('#platform-status');
      await status.getByRole('button',{name:'查找本机恢复点',exact:true}).click();
      await status.getByLabel('修复使用的恢复点').selectOption(repairCheckpoint.snapshotId);
      await status.getByRole('button',{name:'从恢复点修复数据',exact:true}).click();
      await repaired.page.locator('#app-dialog [data-dialog-accept]').click();
      await repaired.page.locator('#active-bank-select option[value="lazy-a"]').waitFor({state:'attached'});
      assert.deepEqual(await readFile(path.join(migrationProfile,'library.sqlite3')),broken);
      assert.match(await readFile(path.join(migrationProfile,'active.json'),'utf8'),/[a-f0-9-]{36}/);
      return {recovered:true,originalPreserved:true};
    });
    await stop(runtime);runtime=undefined;
    runtime=await launch(executable,migrationProfile,proxyPort);
    const repairedRestart=runtime;
    await check('修复后重启读取活动数据库',async()=>{
      await repairedRestart.page.locator('#active-bank-select option[value="lazy-a"]').waitFor({state:'attached'});
      assert.deepEqual(repairedRestart.errors,[]);
      return {restarted:true};
    });
    const repairBackup=await repairedRestart.page.evaluate(async()=>{
      const host=(/** @type {NativeTestWindow} */(window)).ShirohaDesktopHost;if(!host)throw new Error('bridge');return host.invoke('local_read');
    });
    await stop(runtime);runtime=undefined;
    const generation=JSON.parse(await readFile(path.join(migrationProfile,'active.json'),'utf8'));
    assert.match(generation,/^[a-f0-9-]{36}$/);
    const damaged=path.join(migrationProfile,'generations',generation);
    await writeFile(path.join(damaged,'library.sqlite3'),broken);
    await writeFile(path.join(damaged,'library.sqlite3-wal'),Buffer.from('invalid WAL fixture'));
    runtime=await launch(executable,migrationProfile,proxyPort);
    const importedRecovery=runtime;
    await check('损坏数据库从兼容备份修复',async()=>{
      const input=importedRecovery.page.locator('#platform-status').getByLabel('选择兼容备份修复数据');
      await input.waitFor();
      await input.setInputFiles({name:'synthetic-recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(repairBackup))});
      await importedRecovery.page.locator('#app-dialog [data-dialog-accept]').click();
      await importedRecovery.page.locator('#active-bank-select option[value="lazy-a"]').waitFor({state:'attached'});
      assert.deepEqual(await readFile(path.join(damaged,'library.sqlite3')),broken);
      return {imported:true,originalPreserved:true};
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
